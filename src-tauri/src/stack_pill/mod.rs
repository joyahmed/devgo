//! The "My stack" pill drawn by DevGo itself on Windows: no webview (the
//! webview pill cost +113 MB and +0.61 CPU-s a minute, S9). `layout` is the
//! geometry and the click rules, `paint` draws, `window` is the Win32 window.
//! macOS and Linux keep the webview pill (`stack::open_window`).
//!
//! The palette is the one piece every platform has: the main window hands
//! the active theme's colours over on every change.

use std::collections::HashMap;

use tauri::{AppHandle, Manager};

pub mod palette;

#[cfg(windows)]
mod layout;
#[cfg(windows)]
mod paint;
#[cfg(windows)]
mod window;

#[cfg(windows)]
pub use window::open;

/// The main window's theme, as `themes.ts` keys to hex. Kept for the next
/// run; an open pill repaints if it changed.
#[tauri::command]
pub fn stack_pill_palette(
    app: AppHandle,
    colors: HashMap<String, String>,
) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&dir);
    let changed = palette::set(&dir, &colors);
    #[cfg(windows)]
    if changed && window::is_open() {
        window::repaint();
    }
    #[cfg(not(windows))]
    let _ = changed;
    Ok(())
}
