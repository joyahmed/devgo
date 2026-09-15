use serde::Serialize;
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use tauri::State;

use crate::error::AppError;
use crate::models::Project;
use crate::services::frecency;
use crate::services::git;
use crate::services::launcher;
use crate::services::platform::{wsl, RuntimeInfo};
use crate::services::scanner::{ScanOutcome, UnavailableReason};
use crate::services::PreferencesStore;
use crate::services::ProjectCacheStore;
use crate::services::WorkspaceStore;

fn lock_err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Lock(e.to_string())
}

/// How a workspace's projects were obtained on this pass.
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceStatus {
    /// Freshly read from disk.
    Live,
    /// Served from cache because the source could not be read cheaply.
    Cached,
    /// Unreadable, and nothing cached to fall back on.
    Unavailable,
}

#[derive(Serialize)]
pub struct WorkspaceState {
    pub workspace: String,
    pub status: WorkspaceStatus,
    pub reason: Option<UnavailableReason>,
    pub scanned_at: Option<u64>,
    pub count: usize,
}

/// Ranking metadata, kept beside `Project` rather than on it so `Project` stays
/// the four fields the scanner produces.
#[derive(Serialize)]
pub struct ProjectRank {
    pub full_path: String,
    pub score: f64,
    pub launch_count: u32,
    pub last_opened: u64,
    pub hint: Option<&'static str>,
    pub pinned: bool,
}

#[derive(Serialize)]
pub struct ProjectsPayload {
    pub projects: Vec<Project>,
    pub workspaces: Vec<WorkspaceState>,
    pub ranks: Vec<ProjectRank>,
}

pub struct AppState {
    pub workspace_store: Mutex<WorkspaceStore>,
    pub pref_store: Mutex<PreferencesStore>,
    pub cache_store: Mutex<ProjectCacheStore>,
    pub runtime_info: Mutex<RuntimeInfo>,
    pub lock_path: std::path::PathBuf,
    /// Git state, in memory only. Deliberately not persisted: a branch name
    /// read yesterday is worse than no branch name, because it looks current.
    pub git_cache: Mutex<HashMap<String, git::GitInfo>>,
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

/// Collect projects across every configured workspace.
///
/// Two rules govern this:
///
/// 1. One unreadable workspace must never blank the list. Each is scanned
///    independently and falls back to its cached entry, so an unplugged drive
///    costs you that drive's projects and nothing else.
/// 2. Nothing here may start a WSL distro unless `allow_boot` is set, which only
///    an explicit user refresh does. Reading a \\wsl.localhost\ path cold-boots
///    the VM, so a stopped distro is served from cache instead.
fn collect_projects(
    state: &AppState,
    allow_boot: bool,
) -> Result<ProjectsPayload, AppError> {
    let workspaces = state.workspace_store.lock().map_err(lock_err)?.list();

    let mut cache = state.cache_store.lock().map_err(lock_err)?;
    cache.retain(&workspaces)?;

    // One wsl.exe call for the whole pass, not one per workspace. Skipped
    // entirely when no workspace is WSL-native.
    let running = if allow_boot
        || !workspaces
            .iter()
            .any(|w| crate::services::scanner::distro_of(w).is_some())
    {
        Vec::new()
    } else {
        wsl::running_distros()
    };

    let mut projects = Vec::new();
    let mut states = Vec::new();

    for ws in &workspaces {
        match crate::services::scan_workspace(ws, &running, allow_boot) {
            ScanOutcome::Scanned(found) => {
                cache.store(ws, found.clone())?;
                states.push(WorkspaceState {
                    workspace: ws.clone(),
                    status: WorkspaceStatus::Live,
                    reason: None,
                    scanned_at: cache.get(ws).map(|c| c.scanned_at),
                    count: found.len(),
                });
                projects.extend(found);
            }
            // Deliberately does not write to the cache — see ProjectCacheStore::store.
            ScanOutcome::Unavailable(reason) => match cache.get(ws) {
                Some(cached) => {
                    states.push(WorkspaceState {
                        workspace: ws.clone(),
                        status: WorkspaceStatus::Cached,
                        reason: Some(reason),
                        scanned_at: Some(cached.scanned_at),
                        count: cached.projects.len(),
                    });
                    projects.extend(cached.projects.clone());
                }
                None => states.push(WorkspaceState {
                    workspace: ws.clone(),
                    status: WorkspaceStatus::Unavailable,
                    reason: Some(reason),
                    scanned_at: None,
                    count: 0,
                }),
            },
        }
    }

    projects.sort_by_key(|p| p.name.to_lowercase());

    let mut prefs = state.pref_store.lock().map_err(lock_err)?;

    // Only prune history against workspaces we actually read this pass. Pruning
    // against the merged list would let a stopped distro or a detached drive
    // erase the launch history of every project it holds.
    let live: Vec<String> = states
        .iter()
        .filter(|s| matches!(s.status, WorkspaceStatus::Live))
        .flat_map(|s| {
            projects
                .iter()
                .filter(|p| p.workspace == s.workspace)
                .map(|p| p.full_path.clone())
        })
        .collect();
    if !live.is_empty() {
        prefs.retain_known(&live).map_err(AppError::Lock)?;
    }

    let stats = prefs.project_stats();
    let pinned = prefs.pinned();
    let now = crate::services::preferences::now_secs();

    let ranks = projects
        .iter()
        .map(|p| {
            let stat = stats.get(&p.full_path).cloned().unwrap_or_default();
            ProjectRank {
                score: frecency::score(&stat, now),
                hint: frecency::hint(&stat, now),
                launch_count: stat.launch_count,
                last_opened: stat.last_opened,
                pinned: pinned.iter().any(|p2| p2 == &p.full_path),
                full_path: p.full_path.clone(),
            }
        })
        .collect();

    Ok(ProjectsPayload {
        projects,
        workspaces: states,
        ranks,
    })
}

#[tauri::command]
pub fn get_projects(
    state: State<AppState>,
) -> Result<ProjectsPayload, AppError> {
    collect_projects(&state, false)
}

/// Explicit user refresh. `force` is the only path allowed to start a stopped
/// distro, and it also re-probes runtime info.
#[tauri::command]
pub fn refresh_projects(
    force: bool,
    state: State<AppState>,
) -> Result<ProjectsPayload, AppError> {
    if force {
        let fresh = crate::services::platform::detection::detect_runtime();
        *state.runtime_info.lock().map_err(lock_err)? = fresh.clone();
        state
            .pref_store
            .lock()
            .map_err(lock_err)?
            .set_cached_runtime(fresh)
            .map_err(AppError::Lock)?;
    }
    collect_projects(&state, force)
}

#[tauri::command]
pub fn get_runtime_info(
    state: State<AppState>,
) -> Result<RuntimeInfo, AppError> {
    Ok(state.runtime_info.lock().map_err(lock_err)?.clone())
}

/// Count a launch. Deliberately runs only after the launch itself succeeded, so
/// a project that fails to open does not climb the ranking.
fn record_launch(state: &AppState, project: &Project) -> Result<(), AppError> {
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .record_launch(&project.full_path)
        .map_err(AppError::Lock)
}

#[tauri::command]
pub fn open_vscode(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    launcher::launch_vscode(&project, &info)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn open_terminal(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    launcher::launch_terminal(&project, &info)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn open_both(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    launcher::launch_both(&project, &info)?;
    record_launch(&state, &project)
}

/// Read git state for the current project list.
///
/// Deliberately a separate command rather than part of `get_projects`: git
/// spawns processes, and the project list must render immediately from cache
/// without waiting on them. The frontend calls this after the list is on
/// screen, and again only on an explicit refresh.
#[tauri::command]
pub fn get_git_info(
    projects: Vec<Project>,
    state: State<AppState>,
) -> Result<Vec<git::GitInfo>, AppError> {
    // Same liveness gate the scanner uses. Git state is never worth booting a
    // virtual machine for.
    let running = if projects
        .iter()
        .any(|p| crate::services::scanner::distro_of(&p.full_path).is_some())
    {
        wsl::running_distros()
    } else {
        Vec::new()
    };

    let fresh = git::collect(&projects, &running);
    let mut cache = state.git_cache.lock().map_err(lock_err)?;
    for info in &fresh {
        cache.insert(info.full_path.clone(), info.clone());
    }
    Ok(fresh)
}

/// Open a project's remote in the browser.
#[tauri::command]
pub fn open_remote(
    full_path: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let url = state
        .git_cache
        .lock()
        .map_err(lock_err)?
        .get(&full_path)
        .and_then(|i| i.remote.clone())
        .ok_or_else(|| AppError::NoRemote(full_path))?;

    // `start` is a cmd builtin, so it needs a shell. The empty "" is the window
    // title argument, which start would otherwise steal the URL for.
    std::process::Command::new("cmd")
        .creation_flags(0x08000000)
        .args(["/c", "start", "", &url])
        .spawn()
        .map_err(|e| AppError::LaunchFailed(format!("{url}: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn toggle_pin(
    full_path: String,
    state: State<AppState>,
) -> Result<bool, AppError> {
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .toggle_pin(&full_path)
        .map_err(AppError::Lock)
}

/// Quit for real.
///
/// Closing the window only hides it — that is the point of a tray launcher — but
/// the tray menu must not be the only way out, or the process quietly outlives
/// every "close". This gives the window itself an exit, and releases the
/// instance lock so the next launch starts clean.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle, state: State<AppState>) {
    crate::services::single_instance::release_lock(&state.lock_path);
    app.exit(0);
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct LastProject {
    pub full_path: String,
    pub workspace: String,
}

#[tauri::command]
pub fn get_last_project(
    state: State<AppState>,
) -> Result<Option<LastProject>, String> {
    let prefs = state.pref_store.lock().map_err(|e| e.to_string())?;
    Ok(prefs.get_last_project().map(|(path, ws)| LastProject {
        full_path: path.to_string(),
        workspace: ws.to_string(),
    }))
}

#[tauri::command]
pub fn set_last_project(
    state: State<AppState>,
    project: LastProject,
) -> Result<(), String> {
    let mut prefs = state.pref_store.lock().map_err(|e| e.to_string())?;
    prefs.set_last_project(project.full_path, project.workspace)
}
