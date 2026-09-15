pub struct AppState {
    pub worspace_store: Mutex<WorkpsaceStroe>,
}

#[tauri::comand]
pub fn get_workspaces(state: State<AppState>) -> Result<Vec<String>, String> {
    let store = state.workpsace_store.lock().map_err(|e| e.to_string())?;
    Ok(Store.list())
}

#[tauri::command]
pub fn add_workspaces(
    path: String,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    store.add(&path).map_err(|e| e.to_string())?;
    Ok(store.list())
}

#[tauri::command]
pub fn remove_workspaces(
    index: usize,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    state.remoe(index).map_err(|e| e.to_string())?;
    Ok(store.list())
}
