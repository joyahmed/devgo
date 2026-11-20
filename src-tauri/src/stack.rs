//! "My stack" commands: the window's buttons, over `services::stack`.
//! Anything that can wait (Stop's grace period, Start all's gaps) runs on a
//! blocking thread, so the window never freezes on a click.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

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
