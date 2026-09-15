use serde::Serialize;
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use tauri::State;

use crate::error::AppError;
use crate::models::target::{LaunchTarget, TargetKind};
use crate::models::Project;
use crate::services::detect::{self, ProjectTech};
use crate::services::frecency;
use crate::services::git;
use crate::services::launcher;
use crate::services::platform::{wsl, RuntimeInfo};
use crate::services::scanner::{ScanOutcome, UnavailableReason};
use crate::services::PreferencesStore;
use crate::services::ProjectCacheStore;
use crate::services::TargetStore;
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
    pub target_store: Mutex<TargetStore>,
    pub runtime_info: Mutex<RuntimeInfo>,
    pub lock_path: std::path::PathBuf,
    /// Git state, in memory only. Deliberately not persisted: a branch name
    /// read yesterday is worse than no branch name, because it looks current.
    pub git_cache: Mutex<HashMap<String, git::GitInfo>>,
    /// Stack detection, in memory only, for the same reason as git: `node` on
    /// a project whose package.json went last week looks current too.
    pub tech_cache: Mutex<HashMap<String, ProjectTech>>,
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

/// Pick the target to launch: the caller's explicit choice, else the saved
/// default, else the first of that kind. The last fallback matters — a default
/// pointing at a target the user has since deleted must not break launching.
fn resolve_target(
    state: &AppState,
    kind: TargetKind,
    explicit: Option<String>,
) -> Result<LaunchTarget, AppError> {
    let store = state.target_store.lock().map_err(lock_err)?;
    if let Some(id) = explicit {
        return store.get(&id).ok_or(AppError::TargetNotFound(id));
    }
    let saved = state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .default_target(kind);
    if let Some(target) = saved.and_then(|id| store.get(&id)) {
        return Ok(target);
    }
    store
        .first_of(kind)
        .ok_or_else(|| AppError::TargetNotFound(format!("{kind:?}")))
}

#[tauri::command]
pub fn open_editor(
    project: Project,
    target_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let target = resolve_target(&state, TargetKind::Editor, target_id)?;
    launcher::launch_target(&target, &project, &info)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn open_terminal(
    project: Project,
    target_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let target = resolve_target(&state, TargetKind::Terminal, target_id)?;
    launcher::launch_target(&target, &project, &info)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn open_both(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let editor = resolve_target(&state, TargetKind::Editor, None)?;
    let terminal = resolve_target(&state, TargetKind::Terminal, None)?;
    launcher::launch_both(&editor, &terminal, &project, &info)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn get_targets(
    state: State<AppState>,
) -> Result<Vec<LaunchTarget>, AppError> {
    Ok(state.target_store.lock().map_err(lock_err)?.list())
}

#[tauri::command]
pub fn add_target(
    target: LaunchTarget,
    state: State<AppState>,
) -> Result<LaunchTarget, AppError> {
    state.target_store.lock().map_err(lock_err)?.add(target)
}

#[tauri::command]
pub fn remove_target(
    id: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    state.target_store.lock().map_err(lock_err)?.remove(&id)
}

#[tauri::command]
pub fn set_default_target(
    kind: TargetKind,
    id: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    // Reject unknown ids here rather than storing a dangling default.
    if state
        .target_store
        .lock()
        .map_err(lock_err)?
        .get(&id)
        .is_none()
    {
        return Err(AppError::TargetNotFound(id));
    }
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .set_default_target(kind, &id)
        .map_err(AppError::Lock)
}

/// The id that would actually launch for each kind — the same fallback chain
/// as `resolve_target`, so the UI's "default" badge cannot disagree with the
/// button.
#[tauri::command]
pub fn get_default_targets(
    state: State<AppState>,
) -> Result<Vec<(String, String)>, AppError> {
    let prefs = state.pref_store.lock().map_err(lock_err)?;
    let store = state.target_store.lock().map_err(lock_err)?;
    Ok([TargetKind::Editor, TargetKind::Terminal]
        .into_iter()
        .filter_map(|k| {
            let id = prefs
                .default_target(k)
                .filter(|id| store.get(id).is_some())
                .or_else(|| store.first_of(k).map(|t| t.id))?;
            Some((format!("{k:?}").to_lowercase(), id))
        })
        .collect())
}

/// Read git state for the current project list.
///
/// Deliberately a separate command rather than part of `get_projects`: git
/// spawns processes, and the project list must render immediately from cache
/// without waiting on them. The frontend calls this after the list is on
/// screen, and again only on an explicit refresh.
/// The running-distro list, fetched only when some project actually needs it.
/// Same liveness gate the scanner uses: neither git state nor a stack badge is
/// ever worth booting a virtual machine for.
fn running_for(projects: &[Project]) -> Vec<String> {
    if projects
        .iter()
        .any(|p| crate::services::scanner::distro_of(&p.full_path).is_some())
    {
        wsl::running_distros()
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub fn get_git_info(
    projects: Vec<Project>,
    state: State<AppState>,
) -> Result<Vec<git::GitInfo>, AppError> {
    let running = running_for(&projects);
    let fresh = git::collect(&projects, &running);
    let mut cache = state.git_cache.lock().map_err(lock_err)?;
    for info in &fresh {
        cache.insert(info.full_path.clone(), info.clone());
    }
    Ok(fresh)
}

/// Classify projects by stack. Same contract as `get_git_info`: a separate
/// command, off the scan's hot path, and never worth booting a distro for.
#[tauri::command]
pub fn get_project_tech(
    projects: Vec<Project>,
    state: State<AppState>,
) -> Result<Vec<ProjectTech>, AppError> {
    let running = running_for(&projects);
    let fresh = detect::collect(&projects, &running);
    let mut cache = state.tech_cache.lock().map_err(lock_err)?;
    for t in &fresh {
        cache.insert(t.full_path.clone(), t.clone());
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

/// Which distros are up right now. Costs one management call and boots nothing,
/// so the UI can show live state without violating the no-timer rule.
#[tauri::command]
pub fn get_running_distros() -> Vec<String> {
    wsl::running_distros()
}

fn describe(outcome: wsl::StopOutcome, what: &str) -> Result<String, AppError> {
    match outcome {
        wsl::StopOutcome::Stopped => Ok(format!("{what} stopped")),
        wsl::StopOutcome::StillRunning => Err(AppError::WslStopFailed(format!(
            "{what} is still running — something may be holding it open"
        ))),
        wsl::StopOutcome::TimedOut => Err(AppError::WslStopFailed(format!(
            "timed out waiting for {what} to stop — WSLService may be unresponsive"
        ))),
    }
}

/// Stop one distro. Blocking, but Tauri runs commands off the UI thread, so a
/// wedged WSLService stalls this call rather than the window.
#[tauri::command]
pub fn terminate_distro(distro: String) -> Result<String, AppError> {
    let outcome = wsl::terminate(&distro).map_err(AppError::WslStopFailed)?;
    describe(outcome, &distro)
}

#[tauri::command]
pub fn shutdown_wsl() -> Result<String, AppError> {
    let outcome = wsl::shutdown_all().map_err(AppError::WslStopFailed)?;
    describe(outcome, "WSL")
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

/// The summon accelerator as the user will read it. Chapter 09 registers it
/// from `setup`; nothing in the frontend needed the value until the Shortcuts
/// panel wanted to show it. Changing it is still a prefs.json edit.
#[tauri::command]
pub fn get_summon_hotkey(state: State<AppState>) -> Result<String, AppError> {
    Ok(state.pref_store.lock().map_err(lock_err)?.summon_hotkey())
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
