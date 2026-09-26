use tauri::{AppHandle, Emitter, Manager};

use crate::services::editors::wayland_session;
use crate::services::runtime_log::log_line;
use tauri_plugin_global_shortcut::{
    GlobalShortcutExt, Shortcut, ShortcutState,
};

fn err_of(result: tauri::Result<()>) -> Option<String> {
    result.err().map(|e| e.to_string())
}

/// One line naming every raise step that failed, or None when all succeeded.
///
/// Split out from the raise itself because it is the part a test can reach:
/// the calls below need a live window, this does not.
fn raise_failure(steps: &[(&str, Option<String>)]) -> Option<String> {
    let failed: Vec<String> = steps
        .iter()
        .filter_map(|(name, err)| err.as_ref().map(|e| format!("{name}: {e}")))
        .collect();
    if failed.is_empty() {
        None
    } else {
        Some(failed.join("; "))
    }
}

/// Bring the main window up: unhide the app, then show, unminimize, focus.
///
/// The order is the whole point. tao's set_focus is the call that activates
/// the application (makeKeyAndOrderFront plus activateIgnoringOtherApps on a
/// mac, SetForegroundWindow with the alt-key foreground-lock hack on windows),
/// but it silently does nothing, and still returns Ok, unless the window
/// is both visible and not minimized. So a minimized window needs the
/// unminimize first, and on a mac an app hidden with cmd+h needs the app-level
/// unhide first: a hidden app's window reports isVisible false, window.show()
/// does not unhide the app, and set_focus then skips. That last case is a
/// second copy of DevGo that prints its line and raises nothing.
pub fn raise_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        // close hides the window and never destroys it, so an absent "main"
        // means the setup builder never produced one. nothing here can
        // rebuild it (setup owns the config and the saved geometry), and
        // returning quietly is exactly what made this undiagnosable
        log_line!(
            "[DevGo] cannot raise: no webview window named 'main'; it was never built or has been destroyed"
        );
        return;
    };

    // macos only: NSApplication unhide. a no-op when the app is not hidden
    #[cfg(target_os = "macos")]
    let app_unhide = err_of(app.show());
    #[cfg(not(target_os = "macos"))]
    let app_unhide = None;

    let steps = [
        ("app unhide", app_unhide),
        ("show", err_of(window.show())),
        ("unminimize", err_of(window.unminimize())),
        ("set_focus", err_of(window.set_focus())),
    ];
    if let Some(line) = raise_failure(&steps) {
        // to the log file and to stderr: the terminal user sees it now, and
        // the mac or linux user who cannot be watched sends the file. this
        // is the line the silent set_focus of c0e20ce would have produced
        log_line!("[DevGo] could not raise the window - {line}");
    }
}

/// Show, focus, and tell the frontend to select the search box.
pub fn show_and_focus(app: &AppHandle) {
    raise_main(app);
    // The frontend owns focus of its own input; emitting is how we ask.
    let _ = app.emit("devgo://summoned", ());
}

/// Toggle: a window that is already up and focused is dismissed, so the same
/// keystroke that summons DevGo also gets it out of the way.
fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let up = window.is_visible().unwrap_or(false)
        && window.is_focused().unwrap_or(false);
    if up {
        let _ = window.hide();
    } else {
        show_and_focus(app);
    }
}

fn parse(accelerator: &str) -> Result<Shortcut, String> {
    accelerator
        .parse::<Shortcut>()
        .map_err(|e| format!("not a valid accelerator: {e}"))
}

/// The line the log gets when a register returns Ok, and the reason there is
/// one at all.
///
/// Do not delete this as noise. Until it existed, success wrote nothing, so
/// an empty log was ambiguous in the worst way available: it meant either
/// "the hotkey is bound" or "nothing was ever bound and no layer said so".
/// The second is real — `global-hotkey`'s x11 backend opens its X connection
/// on a worker thread and returns Ok before that connection is attempted,
/// then answers Ok to a register whose worker is already dead, and the one
/// `tracing::error!` that would have explained it is behind a feature this
/// build does not enable. A line on success is what makes the absence of a
/// line mean something.
///
/// `wayland` and `no_x` weaken the wording rather than changing it, because
/// on linux "registered" is not always a claim this process can make. The
/// crate has no wayland backend at all, only x11, so there are three cases
/// and the log should not read the same in all of them: no X server to reach
/// (the Ok is fabricated and nothing is bound), a compositor with XWayland
/// (the grab can be taken and still never be delivered a key, which is the
/// ubuntu report), and a plain X11 session (the Ok means what it says).
fn bound_line(accelerator: &str, wayland: bool, no_x: bool) -> String {
    let session = if wayland { "wayland" } else { "no" };
    if no_x {
        format!(
            "[DevGo] summon hotkey '{accelerator}' reported registered, but DISPLAY is unset in a {session} session: global-hotkey binds through x11 only and its x11 backend answers Ok without ever reaching a server, so nothing is bound - raise the window from the tray"
        )
    } else if wayland {
        format!(
            "[DevGo] summon hotkey '{accelerator}' registered through x11, but this is a wayland session: global-hotkey has no wayland backend, so the compositor may never deliver the key however this line reads - raise the window from the tray if it does not"
        )
    } else {
        format!("[DevGo] summon hotkey '{accelerator}' registered")
    }
}

/// Is the x11 backend flying blind - linux, and no DISPLAY for it to open?
///
/// `cfg!` rather than `#[cfg]`: windows and macos bind through their own os
/// api and never set DISPLAY, so the question is only linux's, but both arms
/// keep compiling everywhere and there is no second code path to maintain.
fn x11_blind() -> bool {
    cfg!(target_os = "linux")
        && !std::env::var_os("DISPLAY").is_some_and(|v| !v.is_empty())
}

/// Register `accelerator` as the summon hotkey.
///
/// Returns Err rather than panicking when the combination is already owned by
/// another application — a launcher that refuses to start because something
/// else holds Ctrl+Alt+Space would be worse than one without a hotkey.
///
/// The Ok branch logs, here rather than at the call sites, so that startup,
/// the settings rebind and a settings import all leave the same evidence.
///
/// What is deliberately *not* asked: `GlobalShortcut::is_registered`. It is
/// callable from here and it is cheap, but it only looks the shortcut up in
/// the plugin's own HashMap, which `on_shortcut` has just inserted into on
/// the line above - it can answer nothing but true, and a log line that
/// cannot be false is worse than no line.
pub fn register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut = parse(accelerator)?;
    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            // Fire on press only; without this the handler also runs on release
            // and the window toggles straight back.
            if event.state == ShortcutState::Pressed {
                toggle(&handle);
            }
        })
        .map_err(|e| format!("{e}"))?;
    // windows and macos never set WAYLAND_DISPLAY and x11_blind is false for
    // them, so both get the plain wording with no cfg here
    log_line!(
        "{}",
        bound_line(accelerator, wayland_session(), x11_blind())
    );
    Ok(())
}

pub fn unregister(app: &AppHandle, accelerator: &str) {
    if let Ok(shortcut) = parse(accelerator) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

// register first: if the new one fails the user keeps a working hotkey
pub fn rebind(
    app: &AppHandle,
    previous: &str,
    next: &str,
) -> Result<(), String> {
    if previous == next {
        return Ok(());
    }
    register(app, next)?;
    unregister(app, previous);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{bound_line, raise_failure};

    #[test]
    fn success_says_the_key_it_bound() {
        let line = bound_line("Ctrl+Alt+Space", false, false);
        assert!(line.contains("Ctrl+Alt+Space"), "{line}");
        assert!(line.contains("registered"), "{line}");
        assert!(!line.contains("wayland"), "{line}");
    }

    #[test]
    fn wayland_success_admits_it_may_not_work() {
        let line = bound_line("Ctrl+Alt+Space", true, false);
        assert!(line.contains("wayland"), "{line}");
        assert!(line.contains("x11"), "{line}");
        assert!(line.contains("tray"), "{line}");
    }

    // the case the crate lies about: no server, Ok anyway. the line must not
    // say the bare "registered" the caller would otherwise trust
    #[test]
    fn without_a_display_the_line_says_nothing_is_bound() {
        for wayland in [false, true] {
            let line = bound_line("Ctrl+Alt+Space", wayland, true);
            assert!(line.contains("DISPLAY is unset"), "{line}");
            assert!(line.contains("nothing is bound"), "{line}");
        }
    }

    #[test]
    fn says_nothing_when_every_step_succeeds() {
        let steps: [(&str, Option<String>); 3] =
            [("show", None), ("unminimize", None), ("set_focus", None)];
        assert_eq!(raise_failure(&steps), None);
    }

    #[test]
    fn names_the_step_that_refused() {
        let steps: [(&str, Option<String>); 2] = [
            ("show", None),
            ("set_focus", Some("window not found".into())),
        ];
        assert_eq!(
            raise_failure(&steps).as_deref(),
            Some("set_focus: window not found")
        );
    }

    #[test]
    fn reports_every_failure_not_only_the_first() {
        let steps: [(&str, Option<String>); 3] = [
            ("app unhide", Some("no main thread".into())),
            ("unminimize", None),
            ("set_focus", Some("window not found".into())),
        ];
        assert_eq!(
            raise_failure(&steps).as_deref(),
            Some("app unhide: no main thread; set_focus: window not found")
        );
    }
}
