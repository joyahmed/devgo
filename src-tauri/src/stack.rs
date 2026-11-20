//! "My stack" commands: the window's buttons, over `services::stack`.
//! Anything that can wait (Stop's grace period, Start all's gaps) runs on a
//! blocking thread, so the window never freezes on a click.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::services::runtime_log::log_line;
use crate::services::stack::{self, AppStatus, StackApp, StackFile};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn find(app: &AppHandle, name: &str) -> Result<StackApp, String> {
    stack::load(&data_dir(app)?)
        .apps
        .into_iter()
        .find(|a| a.name == name)
        .ok_or_else(|| format!("{name} is not in the stack"))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn stack_list(app: AppHandle) -> Result<StackFile, String> {
    Ok(stack::load(&data_dir(&app)?))
}

#[tauri::command]
pub fn stack_save(
    app: AppHandle,
    file: StackFile,
) -> Result<StackFile, String> {
    let dir = data_dir(&app)?;
    stack::save(&dir, &file)?;
    log_line!("[DevGo] stack: saved {} app(s)", file.apps.len());
    Ok(stack::load(&dir))
}

/// The poll: one process snapshot, one row per app.
#[tauri::command]
pub async fn stack_status(app: AppHandle) -> Result<Vec<AppStatus>, String> {
    let dir = data_dir(&app)?;
    blocking(move || Ok(stack::status(&stack::load(&dir), &stack::snapshot())))
        .await
}

#[tauri::command]
pub async fn stack_start(app: AppHandle, name: String) -> Result<bool, String> {
    let entry = find(&app, &name)?;
    blocking(move || {
        let started = stack::start(&entry)?;
        log_line!(
            "[DevGo] stack: {} {}",
            entry.name,
            if started {
                "started"
            } else {
                "already running"
            }
        );
        Ok(started)
    })
    .await
}

#[tauri::command]
pub async fn stack_stop(app: AppHandle, name: String) -> Result<bool, String> {
    let entry = find(&app, &name)?;
    blocking(move || {
        let killed = stack::stop(&entry)?;
        log_line!(
            "[DevGo] stack: {} stopped{}",
            entry.name,
            if killed {
                " (killed after the grace period)"
            } else {
                ""
            }
        );
        Ok(killed)
    })
    .await
}

#[tauri::command]
pub async fn stack_restart(
    app: AppHandle,
    name: String,
) -> Result<bool, String> {
    let entry = find(&app, &name)?;
    blocking(move || {
        stack::stop(&entry)?;
        let started = stack::start(&entry)?;
        log_line!("[DevGo] stack: {} restarted", entry.name);
        Ok(started)
    })
    .await
}

/// Starts the stopped apps in order; returns their names. Failures are
/// joined into the error only when nothing at all could start.
#[tauri::command]
pub async fn stack_start_all(app: AppHandle) -> Result<Vec<String>, String> {
    let file = stack::load(&data_dir(&app)?);
    blocking(move || {
        let (started, failed) = stack::start_all(&file);
        log_line!(
            "[DevGo] stack: start all - started {}, failed {}",
            started.len(),
            failed.len()
        );
        if started.is_empty() && !failed.is_empty() {
            return Err(failed.join("; "));
        }
        Ok(started)
    })
    .await
}

// ─── the window ─────────────────────────────────────────────────────────────

pub const WINDOW: &str = "stack";
const POSITION_FILE: &str = "stack-window.json";
const WIDTH: f64 = 300.0;
const HEIGHT: f64 = 340.0;

static LAUNCHED_FOR_STACK: AtomicBool = AtomicBool::new(false);

/// `DevGo --stack` as the FIRST launch: the main window stays hidden.
pub fn set_launched_for_stack(yes: bool) {
    LAUNCHED_FOR_STACK.store(yes, Ordering::SeqCst);
}

/// Asked once by the main window before it shows itself.
#[tauri::command]
pub fn stack_launch_hides_main() -> bool {
    LAUNCHED_FOR_STACK.load(Ordering::SeqCst)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct Position {
    x: i32,
    y: i32,
}

fn saved_position(app: &AppHandle) -> Option<Position> {
    let path = data_dir(app).ok()?.join(POSITION_FILE);
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// A saved spot is used only if its top-left corner is on a screen now: a
/// monitor that was unplugged must not leave the window out of reach.
fn on_a_screen(app: &AppHandle, p: Position) -> bool {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .any(|m| {
            let (o, s) = (m.position(), m.size());
            p.x >= o.x
                && p.y >= o.y
                && p.x < o.x + s.width as i32 - 40
                && p.y < o.y + s.height as i32 - 40
        })
}

/// Show the stack window, building it if it is closed. Main thread only.
pub fn open_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(
        app,
        WINDOW,
        WebviewUrl::App("index.html".into()),
    )
    .title("My stack")
    .inner_size(WIDTH, HEIGHT)
    .min_inner_size(240.0, 160.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(true)
    .visible(false)
    .build();
    let window = match built {
        Ok(w) => w,
        Err(e) => {
            log_line!("[DevGo] stack window: {e}");
            return;
        }
    };
    match saved_position(app).filter(|p| on_a_screen(app, *p)) {
        Some(p) => {
            let _ = window.set_position(tauri::PhysicalPosition::new(p.x, p.y));
        }
        None => {
            let _ = window.center();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
    log_line!("[DevGo] stack window opened");
}

/// For the main window's own "My stack" entry points.
#[tauri::command]
pub fn stack_open_window(app: AppHandle) {
    let h = app.clone();
    let _ = app.run_on_main_thread(move || open_window(&h));
}

/// The stack window's events. Closing destroys it (no hidden webview, no
/// polling left behind); moving it saves the spot.
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::Moved(pos) => {
            if window.is_minimized().unwrap_or(false) {
                return;
            }
            let Ok(dir) = data_dir(window.app_handle()) else {
                return;
            };
            let p = Position { x: pos.x, y: pos.y };
            if let Ok(json) = serde_json::to_string(&p) {
                let _ = std::fs::write(dir.join(POSITION_FILE), json);
            }
        }
        // logged so a close can be told apart afterwards: the window's own
        // ✕ logs "stack: close pressed" first; a close request with no such
        // line came from outside (Alt+F4, taskkill without /F, or .NET
        // CloseMainWindow, which picks this window when the main one is
        // hidden)
        tauri::WindowEvent::CloseRequested { .. } => {
            log_line!("[DevGo] stack window: close requested");
        }
        tauri::WindowEvent::Destroyed => {
            log_line!("[DevGo] stack window closed");
        }
        _ => {}
    }
}
