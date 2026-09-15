mod commands;
mod error;
mod models;
mod services;

use commands::AppState;
use services::workspace::WorkspaceStore;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app data dir");

            let store = WorkspaceStore::new(app_data_dir)
                .expect("failed to initialize workspace store");

            app.manage(AppState {
                workspace_store: std::sync::Mutex::new(store),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::get_projects
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
