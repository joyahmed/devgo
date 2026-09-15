use std::sync::Mutex;
use tauri::State;

use crate::error::AppError;
use crate::models::Project;
use crate::services::launcher;
use crate::services::platform::RuntimeInfo;
use crate::services::WorkspaceStore;

pub struct AppState {
    pub workspace_store: Mutex<WorkspaceStore>,
    pub runtime_info: RuntimeInfo,
}

#[tauri::command]
pub fn get_runtime_info(state: State<AppState>) -> RuntimeInfo {
    state.runtime_info.clone()
}

#[tauri::command]
pub fn get_workspaces(state: State<AppState>) -> Result<Vec<String>, String> {
    let store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    Ok(store.list())
}

#[tauri::command]
pub fn add_workspace(
    path: String,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    store.add(&path).map_err(|e| e.to_string())?;
    Ok(store.list())
}

#[tauri::command]
pub fn remove_workspace(
    index: usize,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    store.remove(index).map_err(|e| e.to_string())?;
    Ok(store.list())
}

#[tauri::command]
pub fn get_projects(state: State<AppState>) -> Result<Vec<Project>, AppError> {
    let store = state
        .workspace_store
        .lock()
        .map_err(|e| AppError::Lock(e.to_string()))?;
    let mut projects = Vec::new();
    for ws in store.list() {
        let mut found = crate::services::scan_workspace(&ws)?;
        projects.append(&mut found);
    }
    projects.sort_by_key(|p| p.name.to_lowercase());
    Ok(projects)
}

#[tauri::command]
pub fn open_vscode(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    launcher::launch_vscode(&project, &state.runtime_info)
}

#[tauri::command]
pub fn open_terminal(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    launcher::launch_terminal(&project, &state.runtime_info)
}

#[tauri::command]
pub fn open_both(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    launcher::launch_both(&project, &state.runtime_info)
}
