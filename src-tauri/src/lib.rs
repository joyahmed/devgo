mod commands;
mod error;
mod models;
mod services;
mod summon;
mod tray;

use commands::AppState;
use services::platform::detection;
use services::preferences::{MonitorRect, WindowState};
use services::single_instance;
use services::workspace::WorkspaceStore;
use tauri::tray::{
    MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent,
};
use tauri::Manager;

// only the restored rect is stored: maximized, the window is the screen,
// and saving that hands the restore button a screen-sized window
fn remember_geometry(window: &tauri::Window) {
    // a hidden window's geometry is nobody's choice: startup fires resize
    // and move before show(), and close hides rather than exits
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    // a minimized window is still visible, and reports (-32000, -32000) at
    // 144x19: a placeholder, not a position. saving it stranded the next
    // launch off every monitor
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let Some(state) = window.app_handle().try_state::<AppState>() else {
        return;
    };
    let Ok(mut prefs) = state.pref_store.lock() else {
        return;
    };

    let next = if window.is_maximized().unwrap_or(false) {
        WindowState {
            maximized: true,
            ..prefs.window_state().unwrap_or_default()
        }
    } else {
        let (Ok(size), Ok(pos)) =
            (window.inner_size(), window.outer_position())
        else {
            return;
        };
        let candidate = WindowState {
            maximized: false,
            width: size.width,
            height: size.height,
            x: pos.x,
            y: pos.y,
        };
        // maximizing is not atomic: a Resized arrives while is_maximized()
        // still says false, and the screen-filling rect would become the
        // restore rect
        let monitors = window
            .available_monitors()
            .map(|m| monitor_rects(&m))
            .unwrap_or_default();
        if candidate.covers_a_monitor(&monitors) {
            return;
        }
        candidate
    };
    let _ = prefs.set_window_state(next);
}

fn monitor_rects(monitors: &[tauri::Monitor]) -> Vec<MonitorRect> {
    monitors
        .iter()
        .map(|m| {
            let (p, s) = (m.position(), m.size());
            (p.x, p.y, s.width, s.height)
        })
        .collect()
}

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
                lock_path,
                git_cache: std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                ),
                tech_cache: std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                ),
            });

            // geometry goes on before the webview calls show(), so the first
            // paint is already the right shape
            if let Some(window) = app.get_webview_window("main") {
                let saved = app
                    .state::<AppState>()
                    .pref_store
                    .lock()
                    .ok()
                    .and_then(|p| p.window_state());
                // a rect that cannot be shown (a config written before the
                // minimize guard, or a monitor since unplugged) would strand
                // the window; maximized is recoverable
                let monitors = window
                    .available_monitors()
                    .map(|m| monitor_rects(&m))
                    .unwrap_or_default();
                match saved {
                    // set_size is ignored on a maximized window
                    Some(s) if !s.maximized && s.is_restorable(&monitors) => {
                        let _ = window.unmaximize();
                        let _ = window.set_size(tauri::PhysicalSize::new(
                            s.width, s.height,
                        ));
                        let _ = window.set_position(
                            tauri::PhysicalPosition::new(s.x, s.y),
                        );
                    }
                    // `maximized: true` in the config does not survive
                    // `visible: false`; this line is what actually does it
                    _ => {
                        let _ = window.maximize();
                    }
                }
            }

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

            // recents come from the cache; rebuilt on every project fetch
            let menu = tray::build_menu(app.handle())?;

            let _tray = TrayIconBuilder::with_id(tray::TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    tray::handle_event(app, event.id.as_ref())
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
        .on_window_event(|window, event| match event {
            // ✕ hides. A launcher that takes two seconds to cold-start is a
            // launcher you stop using; Quit lives in the tray menu and Ctrl+Q.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                remember_geometry(window);
            }
            _ => {}
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
            commands::set_summon_hotkey,
            commands::get_git_info,
            commands::get_project_tech,
            commands::get_project_scripts,
            commands::run_script,
            commands::get_running_distros,
            commands::terminate_distro,
            commands::shutdown_wsl,
            commands::open_remote,
            commands::reveal_in_explorer,
            commands::get_wsl_path,
            commands::discover_roots,
            commands::add_workspace_folders,
            commands::get_scan_config,
            commands::set_scan_config,
            commands::get_tmux_config,
            commands::set_tmux_config,
            commands::export_config_to_file,
            commands::import_config_from_file,
            commands::reset_cache,
            commands::get_runtime_info,
            commands::open_editor,
            commands::open_terminal,
            commands::open_both,
            commands::detect_targets,
            commands::add_detected_target,
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
