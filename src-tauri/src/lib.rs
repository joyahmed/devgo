mod commands;
mod error;
mod models;
mod services;

use commands::AppState;
use services::platform::detection;
use services::workspace::WorkspaceStore;
use tauri::Manager;

pub fn run() {
    let runtime_info = detection::detect_runtime();

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

            let cache_store =
                services::ProjectCacheStore::new(app_data_dir.clone())
                    .expect("failed to initialize project cache store");

            let store = WorkspaceStore::new(app_data_dir)
                .expect("failed to initialize workspace store");

            app.manage(AppState {
                workspace_store: std::sync::Mutex::new(store),
                cache_store: std::sync::Mutex::new(cache_store),
                runtime_info: std::sync::Mutex::new(runtime_info),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::get_projects,
            commands::refresh_projects,
            commands::quit_app,
            commands::get_runtime_info,
            commands::open_vscode,
            commands::open_terminal,
            commands::open_both,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
