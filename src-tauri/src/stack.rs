//! "My stack" commands: the window's buttons, over `services::stack`.
//! Anything that can wait (Stop's grace period, Start all's gaps) runs on a
//! blocking thread, so the window never freezes on a click.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl,
    WebviewWindowBuilder,
};

use crate::services::runtime_log::log_line;
use crate::services::stack::{self, AppStatus, StackApp, StackFile};
use crate::services::stack_facts;

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

/// The poll: one process snapshot, one row per app. `detail` (the tab)
/// adds uptime and memory; the pill leaves it off.
#[tauri::command]
pub async fn stack_status(
    app: AppHandle,
    detail: Option<bool>,
) -> Result<Vec<AppStatus>, String> {
    let dir = data_dir(&app)?;
    let detail = detail.unwrap_or(false);
    blocking(move || {
        Ok(stack::status(
            &stack::load(&dir),
            &stack::snapshot(),
            detail,
        ))
    })
    .await
}

/// icons by expanded path: read once, an exe's icon does not change while
/// DevGo runs (a reinstall that changes it shows after a restart)
fn icon_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> =
        OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_icon(path: &str) -> Option<String> {
    let path = stack::expand(path);
    if let Some(hit) = icon_cache().lock().ok()?.get(&path) {
        return hit.clone();
    }
    let icon = stack_facts::icon(&path);
    if let Ok(mut c) = icon_cache().lock() {
        c.insert(path, icon.clone());
    }
    icon
}

/// The exe's icon as a PNG data URL; `None` = draw the letter tile.
#[tauri::command]
pub async fn stack_icon(path: String) -> Result<Option<String>, String> {
    blocking(move || Ok(cached_icon(&path))).await
}

#[derive(Debug, Serialize)]
pub struct Described {
    name: String,
    process: String,
    icon: Option<String>,
}

/// What an exe the user just picked is called, and its icon.
#[tauri::command]
pub async fn stack_describe(path: String) -> Result<Described, String> {
    blocking(move || {
        let expanded = stack::expand(&path);
        let (name, process) = stack_facts::describe_text(&expanded);
        Ok(Described {
            name,
            process,
            icon: cached_icon(&path),
        })
    })
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

/// Stops every running app but DevGo; returns their names.
#[tauri::command]
pub async fn stack_stop_all(app: AppHandle) -> Result<Vec<String>, String> {
    let file = stack::load(&data_dir(&app)?);
    blocking(move || {
        let (stopped, failed) = stack::stop_all(&file);
        log_line!(
            "[DevGo] stack: stop all - stopped {}, failed {}",
            stopped.len(),
            failed.len()
        );
        if !failed.is_empty() {
            return Err(failed.join("; "));
        }
        Ok(stopped)
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
/// the pill: the frontend measures its dots and asks for its width
const WIDTH: f64 = 160.0;
const HEIGHT: f64 = 40.0;

/// while a hover card is open ABOVE the pill, the window has moved up by
/// this many physical px; a Moved event then saves the pill's own spot
static HOVER_LIFT: AtomicI32 = AtomicI32::new(0);

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

#[cfg_attr(windows, allow(dead_code))]
fn saved_position(app: &AppHandle) -> Option<Position> {
    let p = saved_position_in(&data_dir(app).ok()?)?;
    Some(Position { x: p.0, y: p.1 })
}

/// The pill's saved top-left (physical px), from the data folder.
pub(crate) fn saved_position_in(dir: &std::path::Path) -> Option<(i32, i32)> {
    let path = dir.join(POSITION_FILE);
    let p: Position =
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    Some((p.x, p.y))
}

/// Keep the pill's top-left for the next open.
pub(crate) fn save_position(dir: &std::path::Path, x: i32, y: i32) {
    if let Ok(json) = serde_json::to_string(&Position { x, y }) {
        let _ = std::fs::write(dir.join(POSITION_FILE), json);
    }
}

/// A saved spot is used only if its top-left corner is on a screen now: a
/// monitor that was unplugged must not leave the window out of reach.
#[cfg_attr(windows, allow(dead_code))]
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

/// Show the stack pill, building it if it is closed. On Windows it is the
/// native pill (`stack_pill`, no webview: S9 measured the webview one at
/// +113 MB); elsewhere the webview pill.
pub fn open_window(app: &AppHandle) {
    #[cfg(windows)]
    crate::stack_pill::open(app);
    #[cfg(not(windows))]
    open_webview_window(app);
}

/// The webview pill. Main thread only.
#[cfg_attr(windows, allow(dead_code))]
fn open_webview_window(app: &AppHandle) {
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
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .build();
    let window = match built {
        Ok(w) => w,
        Err(e) => {
            log_line!("[DevGo] stack window: {e}");
            return;
        }
    };
    HOVER_LIFT.store(0, Ordering::SeqCst);
    match saved_position(app).filter(|p| on_a_screen(app, *p)) {
        Some(p) => {
            let _ = window.set_position(PhysicalPosition::new(p.x, p.y));
        }
        None => {
            let _ = window.center();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
    log_line!("[DevGo] stack window opened");
}

/// For the main window's own "My stack" entry points. `async` on purpose:
/// a sync command runs on the main thread, and building the window from
/// there (even via run_on_main_thread) left the IPC hung on Windows, the
/// new webview stuck at about:blank. The tray and `--stack` never hit it.
#[tauri::command]
pub async fn stack_open_window(app: AppHandle) {
    let h = app.clone();
    let _ = app.run_on_main_thread(move || open_window(&h));
}

/// The pill asks for the width its dots need (logical px).
#[tauri::command]
pub fn stack_pill_fit(window: tauri::WebviewWindow, width: f64) {
    if HOVER_LIFT.load(Ordering::SeqCst) != 0 {
        return;
    }
    let width = width.clamp(80.0, 480.0);
    let _ = window.set_size(LogicalSize::new(width, HEIGHT));
}

/// Grow the window by `extra` logical px for a hover card, below the pill,
/// or above it when below would leave the screen. Returns where the card
/// goes: "below" or "above". `open: false` puts the pill back.
#[tauri::command]
pub fn stack_pill_hover(
    window: tauri::WebviewWindow,
    open: bool,
    extra: f64,
) -> String {
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = window
        .inner_size()
        .map(|s| s.width as f64 / scale)
        .unwrap_or(WIDTH);
    let Ok(pos) = window.outer_position() else {
        return "below".into();
    };
    let lifted = HOVER_LIFT.load(Ordering::SeqCst);
    if !open {
        let _ = window.set_size(LogicalSize::new(width, HEIGHT));
        if lifted != 0 {
            let _ = window
                .set_position(PhysicalPosition::new(pos.x, pos.y + lifted));
            HOVER_LIFT.store(0, Ordering::SeqCst);
        }
        return "below".into();
    }
    if lifted != 0 {
        return "above".into();
    }
    let extra_px = (extra * scale).round() as i32;
    let full = ((HEIGHT * scale).round() as i32) + extra_px;
    let bottom = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.position().y + m.size().height as i32)
        .unwrap_or(i32::MAX);
    let _ = window.set_size(LogicalSize::new(width, HEIGHT + extra));
    if pos.y + full > bottom {
        HOVER_LIFT.store(extra_px, Ordering::SeqCst);
        let _ =
            window.set_position(PhysicalPosition::new(pos.x, pos.y - extra_px));
        return "above".into();
    }
    "below".into()
}

/// The pill's body: the main window, on the Stack tab.
#[tauri::command]
pub fn stack_show_tab(app: AppHandle) {
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        crate::summon::raise_main(&h);
        let _ = h.emit_to("main", "devgo://stack-tab", ());
    });
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
            // a card open above the pill lifts the window; the spot to keep
            // is the pill's own
            let p = Position {
                x: pos.x,
                y: pos.y + HOVER_LIFT.load(Ordering::SeqCst),
            };
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
