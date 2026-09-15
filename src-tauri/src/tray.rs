use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::{AppHandle, Manager, Wry};

use crate::commands::{launch_project_default, AppState};
use crate::models::Project;
use crate::services::{frecency, preferences, single_instance};

pub const TRAY_ID: &str = "main";
const MAX_RECENTS: usize = 7;
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
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
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
