use std::sync::Mutex;
use tauri::State;

use crate::services::WorkspaceStore;

pub struct AppState {
    pub workspace_store: Mutex<WorkspaceStore>,
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
