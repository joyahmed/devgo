mod commands;
mod error;
mod models;
mod services;
mod summon;

use commands::AppState;
use services::platform::detection;
use services::single_instance;
use services::workspace::WorkspaceStore;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{
    MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent,
};
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app data dir");

            // One instance. A second launch hands "restore" to the first over
            // the port in instance.lock and exits before creating anything.
            let lock_file = app_data_dir.join("instance.lock");
            let (listener, lock_path) =
                match single_instance::try_acquire(lock_file) {
                    Ok((listener, path)) => (listener, path),
                    Err(_) => {
                        std::process::exit(0);
                    }
                };

            let app_handle = app.handle().clone();
            single_instance::start_restore_listener(listener, move || {
                let h = app_handle.clone();
                let h2 = h.clone();
                let _ = h.run_on_main_thread(move || {
                    if let Some(window) = h2.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            });

            let mut pref_store =
                services::PreferencesStore::new(app_data_dir.clone())
                    .expect("failed to initialize preferences store");

            // Startup must not shell out to wsl.exe. Detection runs only on the
            // first ever launch, or when the user explicitly refreshes.
            let runtime_info = match pref_store.get_cached_runtime() {
                Some(cached) => cached,
                None => {
                    let detected = detection::detect_runtime();
                    let _ = pref_store.set_cached_runtime(detected.clone());
                    detected
                }
            };

            let cache_store =
                services::ProjectCacheStore::new(app_data_dir.clone())
                    .expect("failed to initialize project cache store");

            let target_store = services::TargetStore::new(app_data_dir.clone())
                .expect("failed to initialize target store");

            let store = WorkspaceStore::new(app_data_dir)
                .expect("failed to initialize workspace store");

            app.manage(AppState {
                workspace_store: std::sync::Mutex::new(store),
                pref_store: std::sync::Mutex::new(pref_store),
                cache_store: std::sync::Mutex::new(cache_store),
                target_store: std::sync::Mutex::new(target_store),
                runtime_info: std::sync::Mutex::new(runtime_info),
                lock_path: lock_path.clone(),
                git_cache: std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                ),
                tech_cache: std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                ),
            });

            // A hotkey another app already owns must not stop DevGo from
            // starting — log it and carry on; the tray and window still work.
            let hotkey = app
                .state::<AppState>()
                .pref_store
                .lock()
                .map(|p| p.summon_hotkey())
                .unwrap_or_else(|_| {
                    services::preferences::DEFAULT_SUMMON_HOTKEY.to_string()
                });
            if let Err(e) = summon::register(&app.handle().clone(), &hotkey) {
                eprintln!("[DevGo] summon hotkey '{hotkey}' unavailable: {e}");
            }

            let show_item =
                MenuItemBuilder::with_id("show", "Show").build(app)?;
            let quit_item =
                MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &quit_item])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        single_instance::release_lock(&lock_path);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // ✕ hides. A launcher that takes two seconds to cold-start is a
            // launcher you stop using; Quit lives in the tray menu and Ctrl+Q.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::get_projects,
            commands::refresh_projects,
            commands::quit_app,
            commands::toggle_pin,
            commands::get_summon_hotkey,
            commands::get_git_info,
            commands::get_project_tech,
            commands::get_running_distros,
            commands::terminate_distro,
            commands::shutdown_wsl,
            commands::open_remote,
            commands::reveal_in_explorer,
            commands::get_wsl_path,
            commands::get_runtime_info,
            commands::open_editor,
            commands::open_terminal,
            commands::open_both,
            commands::get_targets,
            commands::add_target,
            commands::remove_target,
            commands::set_default_target,
            commands::get_default_targets,
            commands::get_last_project,
            commands::set_last_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
