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
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

/// The taskbar button's identity and icon, which tauri leaves half done.
/// The nsis installer stamps the shortcuts with the bundle identifier as
/// their AppUserModelID, but nothing sets it on the process, so a pinned
/// DevGo and a running DevGo are two buttons. And tao sets ICON_SMALL only,
/// from the first entry of icon.ico decoded to RGBA; ICON_BIG is never set,
/// and explorer asks a freshly shown window for it with a timeout that a UI
/// thread bringing up webview2 is exactly the one to miss. Raw imports
/// rather than the windows crate: it is in the tree through tauri, not a
/// dependency of ours, and five functions do not earn one.
#[cfg(windows)]
mod win_taskbar {
    use std::ffi::c_void;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SendMessageW(
            hwnd: *mut c_void,
            msg: u32,
            wparam: usize,
            lparam: isize,
        ) -> isize;
        fn LoadImageW(
            hinst: *mut c_void,
            name: *const u16,
            kind: u32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> *mut c_void;
        fn GetSystemMetrics(index: i32) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetModuleHandleW(name: *const u16) -> *mut c_void;
    }
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }

    const WM_SETICON: u32 = 0x0080;
    const ICON_SMALL: usize = 0;
    const ICON_BIG: usize = 1;
    const IMAGE_ICON: u32 = 1;
    const LR_SHARED: u32 = 0x8000;
    const SM_CXICON: i32 = 11;
    const SM_CYICON: i32 = 12;
    const SM_CXSMICON: i32 = 49;
    const SM_CYSMICON: i32 = 50;
    // the id tauri-build gives the exe's icon group
    const IDI_APPLICATION: usize = 32512;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Before the first window exists: the taskbar reads the id at window
    /// creation, so this is the first thing run() does.
    pub fn set_app_user_model_id(id: &str) {
        let id = wide(id);
        // a failure costs grouping, not the app; nothing to do at runtime
        let hr =
            unsafe { SetCurrentProcessExplicitAppUserModelID(id.as_ptr()) };
        if hr < 0 {
            eprintln!("[DevGo] SetCurrentProcessExplicitAppUserModelID failed: 0x{hr:08x}");
        }
    }

    // from the exe's own resource group, not rebuilt from RGBA: windows
    // picks the entry for the dpi, and LR_SHARED leaves the handle
    // system-owned, so nothing to destroy and nothing dangling if tauri
    // ever replaces ICON_SMALL behind us
    fn load_icon(cx: i32, cy: i32) -> *mut c_void {
        unsafe {
            LoadImageW(
                GetModuleHandleW(std::ptr::null()),
                IDI_APPLICATION as *const u16,
                IMAGE_ICON,
                cx,
                cy,
                LR_SHARED,
            )
        }
    }

    /// Both window icons from the exe's resources. Idempotent and cheap,
    /// which is the point: a WM_SETICON is the only thing that makes a
    /// taskbar button that already gave up on us look again.
    pub fn apply_window_icon(window: &tauri::Window) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let hwnd = hwnd.0;
        let (big, small) = unsafe {
            (
                load_icon(
                    GetSystemMetrics(SM_CXICON),
                    GetSystemMetrics(SM_CYICON),
                ),
                load_icon(
                    GetSystemMetrics(SM_CXSMICON),
                    GetSystemMetrics(SM_CYSMICON),
                ),
            )
        };
        // no resource group means a build that skipped tauri-build's
        // resource step; tao's small icon is still there, leave it
        if big.is_null() || small.is_null() {
            eprintln!("[DevGo] exe carries no icon resource; taskbar icon left to tao");
            return;
        }
        unsafe {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG, big as isize);
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, small as isize);
        }
    }
}

#[cfg(not(windows))]
mod win_taskbar {
    pub fn set_app_user_model_id(_id: &str) {}
    pub fn apply_window_icon(_window: &tauri::Window) {}
}

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

// the os half of the transparency knob: no dwm effect, ever. the window
// is created transparent, so what is behind it shows through the ground's
// own alpha (the frontend's half of the same number), sharp and tinted
// by the theme, not by windows. acrylic did two things nobody wanted:
// it blurred what was behind into a haze and laid its own gray tint over
// the theme, and it went black when windows' transparency effects switch
// was off. kept as a function so an install that had the backdrop set
// gets it cleared, and so the knob has one place to live
pub fn apply_transparency(window: &tauri::WebviewWindow, percent: u8) {
    let _ = services::preferences::clamp_transparency(percent);
    if let Err(e) = window.set_effects(None) {
        eprintln!("transparency: {e}");
    }
}

// when the process started, set first thing in run and read by the
// startup marks; OnceLock so it is set exactly once
static STARTED: std::sync::OnceLock<std::time::Instant> =
    std::sync::OnceLock::new();

pub fn started() -> std::time::Instant {
    *STARTED.get_or_init(std::time::Instant::now)
}

// whether the main window was created see-through. decided once in
// setup from the stored knob: transparent is a creation flag, so this
// is what the settings panel asks to know if a move of the knob shows
// now or at the next launch
static LAUNCHED_TRANSPARENT: std::sync::OnceLock<bool> =
    std::sync::OnceLock::new();

// set by a close request that arrived while the window was in native full
// screen (macos); consumed by the Resized that ends the exit transition
#[cfg(target_os = "macos")]
static HIDE_AFTER_FULLSCREEN: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn launched_transparent() -> bool {
    LAUNCHED_TRANSPARENT.get().copied().unwrap_or(false)
}

pub fn run() {
    started();
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();

    // before the builder: the main window is created inside run
    win_taskbar::set_app_user_model_id(&context.config().identifier);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            commands::mark_startup("setup-start".into());
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

            commands::mark_startup("lock".into());
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

            commands::mark_startup("prefs+runtime".into());
            let cache_store =
                services::ProjectCacheStore::new(app_data_dir.clone())
                    .expect("failed to initialize project cache store");

            let target_store = services::TargetStore::new(app_data_dir.clone())
                .expect("failed to initialize target store");

            let github_store = services::GithubStore::new(app_data_dir.clone())
                .expect("failed to initialize github store");

            let servers_store =
                services::servers::ServersStore::new(app_data_dir.clone())
                    .expect("failed to initialize servers store");
            let servers_cache = services::server_folders::ListingCache::new(
                app_data_dir.clone(),
            )
            .expect("failed to initialize servers cache");

            commands::mark_startup("stores".into());
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
                github_store: std::sync::Mutex::new(github_store),
                github_refreshing: std::sync::atomic::AtomicBool::new(false),
                github_branches: std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                ),
                servers_store: std::sync::Mutex::new(servers_store),
                servers_cache: std::sync::Mutex::new(servers_cache),
                ptys: std::sync::Mutex::new(Default::default()),
            });

            // the window is built here, not by the config: transparent is
            // decided at creation and it is not free. a window born
            // see-through holds one screen-sized alpha surface (about 13 mb
            // on 2560x1440) that an opaque one never asks for, so only a
            // window that will show through is created so. the knob still
            // previews live on a window born see-through; born opaque it
            // lands at the next launch, and the panel says which
            let pct = app
                .state::<AppState>()
                .pref_store
                .lock()
                .map(|p| p.window_transparency())
                .unwrap_or(0);
            let see_through = pct > 0;
            let _ = LAUNCHED_TRANSPARENT.set(see_through);
            // on a mac this is the merged config: tauri lays
            // tauri.macos.conf.json over tauri.conf.json, and that is where
            // the window has decorations with titleBarStyle Overlay and
            // hiddenTitle: native traffic lights, no title text, the
            // frontend's bar beside them. the overlay is rfc 7396, an array
            // replaces, so the mac file carries the whole window entry and
            // a key changed on the main window here has to change there too
            let main_cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .expect("tauri.conf.json declares the main window");
            let builder = tauri::WebviewWindowBuilder::from_config(
                app.handle(),
                &main_cfg,
            )?;
            // one call, both platforms: a window born see-through is
            // created transparent so what is behind it shows through the
            // ground's own alpha. on macos this needs the macos-private-api
            // feature (Cargo.toml) and app.macOSPrivateApi (tauri.conf.json),
            // both now set; webview2 needs neither. the config keeps
            // transparent:false so an opaque launch never asks for the alpha
            // surface, and this flips it on only when the knob says so
            let builder = builder.transparent(see_through);
            builder.build()?;

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

                // icons before the first show, for the same reason as
                // geometry: the button is created the moment the window is
                // visible, and what it finds then is what it paints
                let plain: tauri::Window = window.as_ref().window();
                win_taskbar::apply_window_icon(&plain);

                // and the effect: an acrylic window that appears opaque
                // and then blurs is a flash, like the geometry snap
                apply_transparency(&window, pct);
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

            commands::mark_startup("window+hotkey".into());
            // what a left click does is the platform's call (tray.rs): the
            // window on windows, the menu on a mac. the icon is the coloured
            // app icon on both, not a template image macos would flatten
            let _tray = TrayIconBuilder::with_id(tray::TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(tray::MENU_ON_LEFT_CLICK)
                .on_menu_event(|app, event| {
                    tray::handle_event(app, event.id.as_ref())
                })
                .on_tray_icon_event(tray::handle_icon_event)
                .build(app)?;
            // the wsl light: a thread that watches the process table for
            // the vm and tells the window on every change. it never runs
            // wsl.exe on its own clock, so it is not the timer the core
            // rule forbids
            services::platform::wsl_watch::start(app.handle().clone());
            commands::mark_startup("setup-end".into());

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // ✕ hides. A launcher that takes two seconds to cold-start is a
            // launcher you stop using; Quit lives in the tray menu and Ctrl+Q.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                // on macos a window in native full screen must leave it
                // before it hides: hidden in place, its full-screen space
                // stays on screen with nothing in it and the whole display
                // goes black until the app is shown again. the exit is an
                // animated transition, so the hide happens on the Resized
                // that ends it, not here; a thread polling is_fullscreen
                // mid-transition never saw it end
                #[cfg(target_os = "macos")]
                if window.is_fullscreen().unwrap_or(false) {
                    HIDE_AFTER_FULLSCREEN
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = window.set_fullscreen(false);
                    return;
                }
                let _ = window.hide();
            }
            tauri::WindowEvent::Resized(_) => {
                // the first Resized after set_fullscreen(false) already
                // reports is_fullscreen false, but the exit animation is
                // still running, and hiding right here stranded a blank
                // white window on the desktop. so: note it, and hide on
                // the main thread once the transition has had time to end
                #[cfg(target_os = "macos")]
                if HIDE_AFTER_FULLSCREEN
                    .swap(false, std::sync::atomic::Ordering::SeqCst)
                {
                    let handle = window.app_handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(
                            900,
                        ));
                        let h = handle.clone();
                        let _ = handle.run_on_main_thread(move || {
                            if let Some(w) = h.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        });
                    });
                    return;
                }
                remember_geometry(window);
            }
            tauri::WindowEvent::Moved(_) => {
                remember_geometry(window);
            }
            // every path that shows the window ends in an activation: the
            // frontend's show(), the tray, the summon hotkey, the
            // single-instance restore. one hook sees all four, and the
            // resend is what un-blanks a button explorer painted generic
            tauri::WindowEvent::Focused(true) => {
                win_taskbar::apply_window_icon(window);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::reorder_workspaces,
            commands::get_projects,
            commands::refresh_projects,
            commands::refresh_workspace,
            commands::get_cached_projects,
            commands::startup_ms,
            commands::mark_startup,
            commands::quit_app,
            commands::toggle_pin,
            commands::get_summon_hotkey,
            commands::get_window_transparency,
            commands::window_launched_transparent,
            commands::os_transparency_effects_enabled,
            commands::set_window_transparency,
            commands::set_summon_hotkey,
            commands::get_git_info,
            commands::get_project_tech,
            commands::get_project_scripts,
            commands::run_script,
            commands::get_wsl_state,
            commands::get_runtime_info,
            commands::terminate_distro,
            commands::shutdown_wsl,
            commands::open_remote,
            commands::open_url,
            commands::get_app_data_dir,
            commands::reveal_app_data_dir,
            commands::get_remote_branches,
            commands::get_live_sessions,
            commands::get_servers,
            commands::add_server,
            commands::update_server,
            commands::remove_server,
            commands::import_ssh_config,
            commands::has_ssh,
            commands::open_server,
            commands::server_commands,
            commands::get_server_listings,
            commands::list_server_folders,
            commands::open_server_folder,
            commands::open_server_folder_in,
            commands::run_server_action,
            commands::compose_server_action,
            commands::plan_server_setup,
            commands::apply_server_setup,
            commands::list_server_dir,
            commands::add_server_root,
            commands::remove_server_root,
            commands::open_agent,
            commands::kill_session,
            commands::pty_open,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::get_github_branches,
            commands::refresh_remote_branches_github,
            commands::get_github_repos,
            commands::get_github_status,
            commands::refresh_github_repos,
            commands::set_github_orgs,
            commands::github_clone_urls,
            commands::clone_repo,
            commands::add_github_repo,
            commands::get_github_groups,
            commands::edit_github_groups,
            commands::set_github_live_search,
            commands::get_show_server_details,
            commands::set_show_server_details,
            commands::search_github,
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
        .build(context)
        .expect("error while building tauri application")
        .run(on_run_event);
}

// the app-level events, the ones not about a window. three ways out and
// they all end in Exit: the tray's quit and the window's quit_app call
// app.exit(0); on a mac cmd+q is the app menu's quit (tauri installs the
// default menu there without a line of ours), a native terminate that tao
// reports as Exit straight away, never through tray.rs. so the lock is
// released here, the one point every path reaches; a lock left behind
// costs the next launch a stale-lock probe. nothing handles ExitRequested,
// so nothing can swallow it: close already hides, and cmd+q must mean quit.
// reopen is the dock icon clicked while the app runs: with close-hides
// there is no window to click, so this is how a mac user gets devgo back
fn on_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        tauri::RunEvent::Exit => {
            if let Some(state) = app.try_state::<AppState>() {
                single_instance::release_lock(&state.lock_path);
            }
        }
        _ => {}
    }
}
