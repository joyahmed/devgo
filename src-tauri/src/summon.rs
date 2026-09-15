use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{
    GlobalShortcutExt, Shortcut, ShortcutState,
};

/// Show, focus, and tell the frontend to select the search box.
pub fn show_and_focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        // The frontend owns focus of its own input; emitting is how we ask.
        let _ = app.emit("devgo://summoned", ());
    }
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

/// Register `accelerator` as the summon hotkey.
///
/// Returns Err rather than panicking when the combination is already owned by
/// another application — a launcher that refuses to start because something
/// else holds Ctrl+Alt+Space would be worse than one without a hotkey.
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
        .map_err(|e| format!("{e}"))
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
