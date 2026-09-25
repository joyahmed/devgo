use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::commands::{launch_project_default, AppState};
use crate::models::Project;
use crate::services::{frecency, preferences, single_instance};

pub const TRAY_ID: &str = "main";
const MAX_RECENTS: usize = 7;

// what a left click on the icon does. on windows a tray icon is a button:
// left click brings the window up, right click is the menu. on a mac the
// same icon is a menu-bar item, and one that does nothing on a left click
// reads as broken: every item up there drops its menu on any click, so
// devgo's does too (show devgo is its first line)
#[cfg(target_os = "macos")]
pub(crate) const MENU_ON_LEFT_CLICK: bool = true;
#[cfg(not(target_os = "macos"))]
pub(crate) const MENU_ON_LEFT_CLICK: bool = false;
const LAUNCH_PREFIX: &str = "launch:";

// read from the cache, never a scan, so the menu boots nothing
fn top_frecent(state: &AppState, n: usize) -> Vec<Project> {
    let projects = match state.cache_store.lock() {
        Ok(cache) => cache.all_projects(),
        Err(_) => return Vec::new(),
    };
    let (stats, now) = match state.pref_store.lock() {
        Ok(prefs) => (prefs.project_stats(), preferences::now_secs()),
        Err(_) => return Vec::new(),
    };

    let mut scored: Vec<(f64, Project)> = projects
        .into_iter()
        .filter_map(|p| {
            stats
                .get(&p.full_path)
                .map(|s| (frecency::score(s, now), p))
        })
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.into_iter().take(n).map(|(_, p)| p).collect()
}

fn last_project(state: &AppState) -> Option<Project> {
    // drop the prefs lock before taking the cache lock
    let path = {
        let prefs = state.pref_store.lock().ok()?;
        prefs.get_last_project().map(|(p, _)| p.to_string())?
    };
    state.cache_store.lock().ok()?.find(&path)
}

pub(crate) fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<AppState>();

    let show = MenuItemBuilder::with_id("show", "Show DevGo").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let mut b = MenuBuilder::new(app).item(&show);

    if let Some(last) = last_project(&state) {
        let item = MenuItemBuilder::with_id(
            "openlast",
            format!("Open last · {}", last.name),
        )
        .build(app)?;
        b = b.separator().item(&item);
    }

    let recents = top_frecent(&state, MAX_RECENTS);
    if !recents.is_empty() {
        b = b.separator();
        for p in &recents {
            let id = format!("{LAUNCH_PREFIX}{}", p.full_path);
            b = b.item(
                &MenuItemBuilder::with_id(id, p.name.as_str()).build(app)?,
            );
        }
    }

    b.separator().item(&quit).build()
}

// tray mutation must happen on the main thread
pub fn refresh(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            if let Ok(menu) = build_menu(&app) {
                let _ = tray.set_menu(Some(menu));
            }
        }
    });
}

fn show_window(app: &AppHandle) {
    // one raise for the whole app: the tray copy had drifted the same way
    // the single-instance one had, and a minimized window never came back
    crate::summon::raise_main(app);
}

// a click on the icon itself, as opposed to a menu line. left-up shows
// the window, unless the platform gives that click to the menu: tray-icon
// still emits Click on a mac when it pops the menu, and showing the
// window underneath as well would be two things for one click
pub(crate) fn handle_icon_event(tray: &TrayIcon, event: TrayIconEvent) {
    if MENU_ON_LEFT_CLICK {
        return;
    }
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        show_window(tray.app_handle());
    }
}

// a click is an ask: booting a stopped distro here is fine
fn launch(app: &AppHandle, project: &Project) {
    let state = app.state::<AppState>();
    // no ids: a tray launch has no UI to pick with, so the saved defaults
    let _ = launch_project_default(&state, project, None, None);
    refresh(app);
}

pub fn handle_event(app: &AppHandle, id: &str) {
    match id {
        "show" => show_window(app),
        "quit" => {
            let state = app.state::<AppState>();
            single_instance::release_lock(&state.lock_path);
            app.exit(0);
        }
        "openlast" => {
            if let Some(project) = last_project(&app.state::<AppState>()) {
                launch(app, &project);
            }
        }
        id if id.starts_with(LAUNCH_PREFIX) => {
            let path = &id[LAUNCH_PREFIX.len()..];
            let project = app
                .state::<AppState>()
                .cache_store
                .lock()
                .ok()
                .and_then(|c| c.find(path));
            if let Some(project) = project {
                launch(app, &project);
            }
        }
        _ => {}
    }
}
