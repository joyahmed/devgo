use serde::Serialize;
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use tauri::{Manager, State};

use crate::error::AppError;
use crate::models::target::{LaunchTarget, TargetKind};
use crate::models::Project;
use crate::services::clone;
use crate::services::detect::{self, ProjectTech};
use crate::services::editors::{self, DetectedTarget};
use crate::services::frecency;
use crate::services::git;
use crate::services::github::{self, GhStatus, GithubCache};
use crate::services::groups::{self, GithubGroup};
use crate::services::launcher;
use crate::services::platform::{wsl, RuntimeInfo};
use crate::services::scanner::{ScanOutcome, UnavailableReason};
use crate::services::GithubStore;
use crate::services::PreferencesStore;
use crate::services::ProjectCacheStore;
use crate::services::TargetStore;
use crate::services::WorkspaceStore;

fn lock_err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Lock(e.to_string())
}

/// Milliseconds since the process started: the startup budget's clock.
#[tauri::command]
pub fn startup_ms() -> u64 {
    crate::started().elapsed().as_millis() as u64
}

/// Append `<stage>,<ms>` to `%LOCALAPPDATA%\DevGo\startup.log`, only when
/// `DEVGO_STARTUP_LOG=1`: the measuring script sets it, a user never does.
/// No writes at startup is a feature; this one is opt in.
#[tauri::command]
pub fn mark_startup(stage: String) -> u64 {
    let ms = startup_ms();
    if let Some(path) = startup_log_path() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            use std::io::Write;
            let _ = writeln!(f, "{stage},{ms}");
        }
    }
    ms
}

fn startup_log_path() -> Option<std::path::PathBuf> {
    if std::env::var("DEVGO_STARTUP_LOG").as_deref() != Ok("1") {
        return None;
    }
    let local = std::env::var("LOCALAPPDATA").ok()?;
    Some(
        std::path::Path::new(&local)
            .join("DevGo")
            .join("startup.log"),
    )
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
    pub github_store: Mutex<GithubStore>,
    /// One GitHub refresh at a time. A second refresh_github_repos while
    /// one is in flight returns at once; the running one serves both.
    pub github_refreshing: std::sync::atomic::AtomicBool,
    /// Branch lists fetched from GitHub this session, by owner/name. In
    /// memory only, like git_cache, and for the same reason.
    pub github_branches: Mutex<HashMap<String, Vec<String>>>,
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

// the whole list, so the store can refuse an order built from a stale view
#[tauri::command]
pub fn reorder_workspaces(
    order: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    store.reorder(order).map_err(|e| e.to_string())?;
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
        // memoised: the git and stack passes that follow reuse the answer
        wsl::running_distros_memo()
    };

    let mut projects = Vec::new();
    let mut states = Vec::new();

    // read once per pass, keeps the lock out of the scan loop
    let (ignore, depth) = {
        let cfg = state.pref_store.lock().map_err(lock_err)?.scan_config();
        (cfg.ignore, cfg.depth)
    };

    for ws in &workspaces {
        match crate::services::scan_workspace(
            ws, &running, allow_boot, &ignore, depth,
        ) {
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

    // prune only under workspaces read live this pass; a stopped distro or a
    // detached drive keeps its history
    let live_roots: Vec<String> = states
        .iter()
        .filter(|s| matches!(s.status, WorkspaceStatus::Live))
        .map(|s| s.workspace.clone())
        .collect();
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
    prefs
        .retain_known(&live, &live_roots)
        .map_err(AppError::Lock)?;

    let ranks = rank_projects(&projects, &prefs);

    Ok(ProjectsPayload {
        projects,
        workspaces: states,
        ranks,
    })
}

// the frecency rank of every project, from the launch history and the
// pins: shared by the live pass and the cache first payload
fn rank_projects(
    projects: &[Project],
    prefs: &PreferencesStore,
) -> Vec<ProjectRank> {
    let stats = prefs.project_stats();
    let pinned = prefs.pinned();
    let now = crate::services::preferences::now_secs();

    projects
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
        .collect()
}

/// The list from the cache alone: no read_dir, no wsl.exe, no git. Every
/// workspace is marked Cached; a workspace with no entry yet (first run)
/// simply has no rows here.
fn cached_payload(
    workspaces: &[String],
    cache: &ProjectCacheStore,
    prefs: &PreferencesStore,
) -> ProjectsPayload {
    let mut projects = Vec::new();
    let mut states = Vec::new();
    for ws in workspaces {
        if let Some(cached) = cache.get(ws) {
            states.push(WorkspaceState {
                workspace: ws.clone(),
                status: WorkspaceStatus::Cached,
                reason: None,
                scanned_at: Some(cached.scanned_at),
                count: cached.projects.len(),
            });
            projects.extend(cached.projects.iter().cloned());
        }
    }
    projects.sort_by_key(|p| p.name.to_lowercase());
    let ranks = rank_projects(&projects, prefs);
    ProjectsPayload {
        projects,
        workspaces: states,
        ranks,
    }
}

/// The first thing the frontend asks for, so the window is up with the
/// last known list before get_projects scans behind it.
#[tauri::command]
pub fn get_cached_projects(
    state: State<AppState>,
) -> Result<ProjectsPayload, AppError> {
    let workspaces = state.workspace_store.lock().map_err(lock_err)?.list();
    let cache = state.cache_store.lock().map_err(lock_err)?;
    let prefs = state.pref_store.lock().map_err(lock_err)?;
    Ok(cached_payload(&workspaces, &cache, &prefs))
}

// a blocking pass off the main thread. the scan, the git pass and the
// stack pass were sync commands, and tauri runs those on the main thread
// one after another: get_window_transparency, which gates show(), and the
// cache first read sat behind a read_dir over every wsl.localhost
// workspace. async + spawn_blocking is the whole fix
async fn off_main<T, F>(app: &tauri::AppHandle, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> Result<T, AppError> + Send + 'static,
{
    let h = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = h.state::<AppState>();
        f(&state)
    })
    .await
    .map_err(lock_err)?
}

#[tauri::command]
pub async fn get_projects(
    app: tauri::AppHandle,
) -> Result<ProjectsPayload, AppError> {
    let payload =
        off_main(&app, |state| collect_projects(state, false)).await?;
    crate::tray::refresh(&app);
    Ok(payload)
}

/// Explicit user refresh. `force` is the only path allowed to start a stopped
/// distro, and it also re-probes runtime info.
#[tauri::command]
pub async fn refresh_projects(
    force: bool,
    app: tauri::AppHandle,
) -> Result<ProjectsPayload, AppError> {
    let payload = off_main(&app, move |state| {
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
        collect_projects(state, force)
    })
    .await?;
    crate::tray::refresh(&app);
    Ok(payload)
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
    // the guard dies on this line: resolve_target locks pref_store itself
    let tmux = state.pref_store.lock().map_err(lock_err)?.tmux_config();
    let target = resolve_target(&state, TargetKind::Editor, target_id)?;
    launcher::launch_target(&target, &project, &info, &tmux)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn open_terminal(
    project: Project,
    target_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    // read at launch, not cached: the next launch reconciles a changed list
    let tmux = state.pref_store.lock().map_err(lock_err)?.tmux_config();
    let target = resolve_target(&state, TargetKind::Terminal, target_id)?;
    launcher::launch_target(&target, &project, &info, &tmux)?;
    record_launch(&state, &project)
}

// one launch path for the window, the palette and the tray
pub fn launch_project_default(
    state: &AppState,
    project: &Project,
    editor_id: Option<String>,
    terminal_id: Option<String>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let tmux = state.pref_store.lock().map_err(lock_err)?.tmux_config();
    let editor = resolve_target(state, TargetKind::Editor, editor_id)?;
    let terminal = resolve_target(state, TargetKind::Terminal, terminal_id)?;
    launcher::launch_both(&editor, &terminal, project, &info, &tmux)?;
    record_launch(state, project)
}

/// Unlike open_editor and open_terminal this took no ids at all, so "open
/// both, but in Cursor" was a signature change. None keeps the old behaviour.
#[tauri::command]
pub fn open_both(
    project: Project,
    editor_id: Option<String>,
    terminal_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    launch_project_default(&state, &project, editor_id, terminal_id)
}

/// Editors and terminals installed but not yet registered. This is the
/// command that makes detection mean anything on a machine that has run
/// DevGo before: `defaults()` is written only when targets.json does not
/// exist, so candidates added there would ship as a no-op. It proposes; it
/// never writes.
#[tauri::command]
pub fn detect_targets(
    state: State<AppState>,
) -> Result<Vec<DetectedTarget>, AppError> {
    // only distros already running are asked; detection never boots a vm
    let running = wsl::running_distros();
    let existing: Vec<String> = state
        .target_store
        .lock()
        .map_err(lock_err)?
        .list()
        .into_iter()
        .map(|t| t.id)
        .collect();

    Ok(editors::detect(&running)
        .into_iter()
        .filter(|d| !existing.contains(&d.target.id))
        .collect())
}

/// Register one detected target by id. Not by posting the target back: the
/// TS LaunchTarget has no run templates, so a detected terminal would come
/// back with them stripped and fail its first run_script. Re-deriving costs
/// one where.exe spawn and cannot lose a field.
#[tauri::command]
pub fn add_detected_target(
    id: String,
    state: State<AppState>,
) -> Result<LaunchTarget, AppError> {
    let running = wsl::running_distros();
    let found = editors::detect(&running)
        .into_iter()
        .find(|d| d.target.id == id)
        .ok_or_else(|| AppError::TargetNotFound(id))?;

    state
        .target_store
        .lock()
        .map_err(lock_err)?
        .add(found.target)
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
    Ok(
        [TargetKind::Editor, TargetKind::Terminal, TargetKind::Agent]
            .into_iter()
            .filter_map(|k| {
                let id = prefs
                    .default_target(k)
                    .filter(|id| store.get(id).is_some())
                    .or_else(|| store.first_of(k).map(|t| t.id))?;
                Some((format!("{k:?}").to_lowercase(), id))
            })
            .collect(),
    )
}

/// Read git state for the current project list.
///
/// Deliberately a separate command rather than part of `get_projects`: git
/// spawns processes, and the project list must render immediately from cache
/// without waiting on them. The frontend calls this after the list is on
/// screen, and again only on an explicit refresh.
/// The running-distro list, fetched only when some project actually needs it.
// one project, one read, at the moment of the click
#[tauri::command]
pub fn get_project_scripts(
    project: Project,
    state: State<AppState>,
) -> Result<Vec<crate::services::scripts::DevScript>, AppError> {
    let (tags, pm) = {
        let cache = state.tech_cache.lock().map_err(lock_err)?;
        match cache.get(&project.full_path) {
            Some(t) => (
                t.tags.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                t.package_manager.map(|s| s.to_string()),
            ),
            None => (Vec::new(), None),
        }
    };
    let running = running_for(std::slice::from_ref(&project));
    Ok(crate::services::scripts::for_project(
        &project,
        &tags,
        pm.as_deref(),
        &running,
    ))
}

#[tauri::command]
pub fn run_script(
    project: Project,
    command: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let terminal = resolve_target(&state, TargetKind::Terminal, None)?;
    crate::services::scripts::run(&project, &command, &terminal, &info)?;
    record_launch(&state, &project)
}

// a coding agent in the default terminal, in the project directory. the
// agent is a command; the terminal's run template, the dev-script path,
// launches it, so it lands in a real terminal with its own clipboard,
// scrollback and focus. it must exist on the project's side
#[tauri::command]
pub fn open_agent(
    project: Project,
    target_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    let agent = resolve_target(&state, TargetKind::Agent, target_id)?;
    let on_wsl =
        crate::services::scanner::distro_of(&project.full_path).is_some();
    let command = if on_wsl {
        agent.wsl_executable.clone()
    } else {
        Some(agent.executable.clone())
    }
    .filter(|c| !c.is_empty())
    .ok_or_else(|| {
        let (side, fix) = if on_wsl {
            ("WSL", "Install it in the distro")
        } else {
            ("Windows", "Install it on Windows")
        };
        AppError::LaunchFailed(format!(
            "{} is not installed on the {side} side. {fix} and scan again in Settings",
            agent.name
        ))
    })?;
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let terminal = resolve_target(&state, TargetKind::Terminal, None)?;
    crate::services::scripts::run(&project, &command, &terminal, &info)?;
    record_launch(&state, &project)
}

/// Same liveness gate the scanner uses: neither git state nor a stack badge is
/// ever worth booting a virtual machine for.
fn running_for(projects: &[Project]) -> Vec<String> {
    if projects
        .iter()
        .any(|p| crate::services::scanner::distro_of(&p.full_path).is_some())
    {
        // through the memo: a refresh is three commands gated on the same
        // question, and a stop through DevGo clears it
        wsl::running_distros_memo()
    } else {
        Vec::new()
    }
}

// which of these projects have a live tmux / psmux session: the live
// chip. the same liveness gate as the git pass
#[tauri::command]
pub async fn get_live_sessions(projects: Vec<Project>) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let running = running_for(&projects);
        crate::services::sessions::collect(&projects, &running)
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn kill_session(project: Project) -> Result<(), AppError> {
    let running = running_for(std::slice::from_ref(&project));
    crate::services::sessions::kill(&project, &running)
}

#[tauri::command]
pub async fn get_git_info(
    projects: Vec<Project>,
    app: tauri::AppHandle,
) -> Result<Vec<git::GitInfo>, AppError> {
    off_main(&app, move |state| {
        let running = running_for(&projects);
        let fresh = git::collect(&projects, &running);
        let mut cache = state.git_cache.lock().map_err(lock_err)?;
        for info in &fresh {
            cache.insert(info.full_path.clone(), info.clone());
        }
        Ok(fresh)
    })
    .await
}

/// Classify projects by stack. Same contract as `get_git_info`: a separate
/// command, off the scan's hot path, and never worth booting a distro for.
#[tauri::command]
pub async fn get_project_tech(
    projects: Vec<Project>,
    app: tauri::AppHandle,
) -> Result<Vec<ProjectTech>, AppError> {
    off_main(&app, move |state| {
        let running = running_for(&projects);
        let fresh = detect::collect(&projects, &running);
        let mut cache = state.tech_cache.lock().map_err(lock_err)?;
        for t in &fresh {
            cache.insert(t.full_path.clone(), t.clone());
        }
        Ok(fresh)
    })
    .await
}

/// Suggest roots for an empty first run. Never boots a distro; fired from the
/// onboarding Scan button, never on launch.
#[tauri::command]
pub fn discover_roots() -> Vec<crate::services::discover::DiscoveredRoot> {
    crate::services::discover::discover()
}

/// The drag-and-drop path. A local file is skipped; a wsl path is added
/// without an is_dir probe, because the probe would boot a stopped distro.
#[tauri::command]
pub fn add_workspace_folders(
    paths: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    // add can refuse now; one refusal must not throw away the rest of the
    // drop. add what can be added, then say what could not
    let mut refused = Vec::new();
    for p in &paths {
        let is_wsl = p.replace('\\', "/").starts_with("//wsl");
        if is_wsl || std::path::Path::new(p).is_dir() {
            if let Err(e) = store.add(p) {
                refused.push(e.to_string());
            }
        }
    }
    if !refused.is_empty() {
        return Err(refused.join("; "));
    }
    Ok(store.list())
}

#[tauri::command]
pub fn get_scan_config(
    state: State<AppState>,
) -> Result<crate::services::preferences::ScanConfig, AppError> {
    Ok(state.pref_store.lock().map_err(lock_err)?.scan_config())
}

#[tauri::command]
pub fn get_tmux_config(
    state: State<AppState>,
) -> Result<crate::services::preferences::TmuxConfig, AppError> {
    Ok(state.pref_store.lock().map_err(lock_err)?.tmux_config())
}

/// Takes effect on the next launch: the script is built per launch, so
/// there is nothing to signal and no rescan to trigger.
#[tauri::command]
pub fn set_tmux_config(
    config: crate::services::preferences::TmuxConfig,
    state: State<AppState>,
) -> Result<(), AppError> {
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .set_tmux_config(config)
        .map_err(AppError::Lock)
}

#[tauri::command]
pub fn set_scan_config(
    config: crate::services::preferences::ScanConfig,
    state: State<AppState>,
) -> Result<(), AppError> {
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .set_scan_config(config)
        .map_err(AppError::Lock)
}

// how you work, never this machine: no cache, no history, no pins, no runtime
#[derive(Serialize, serde::Deserialize)]
pub struct PortableConfig {
    pub workspaces: Vec<String>,
    pub targets: Vec<LaunchTarget>,
    pub default_editor: Option<String>,
    pub default_terminal: Option<String>,
    pub summon_hotkey: String,
    // a missing field is a hard parse error, so a file exported before a
    // field existed would not import at all; scan_config had that bug since
    // it landed
    #[serde(default)]
    pub scan_config: crate::services::preferences::ScanConfig,
    #[serde(default)]
    pub tmux_config: crate::services::preferences::TmuxConfig,
}

// the backend writes the file; the frontend only picks where
#[tauri::command]
pub fn export_config_to_file(
    path: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let workspaces = state.workspace_store.lock().map_err(lock_err)?.list();
    let targets = state.target_store.lock().map_err(lock_err)?.list();
    let config = {
        let prefs = state.pref_store.lock().map_err(lock_err)?;
        PortableConfig {
            workspaces,
            targets,
            default_editor: prefs.default_target(TargetKind::Editor),
            default_terminal: prefs.default_target(TargetKind::Terminal),
            summon_hotkey: prefs.summon_hotkey(),
            scan_config: prefs.scan_config(),
            tmux_config: prefs.tmux_config(),
        }
    };
    std::fs::write(&path, serde_json::to_string_pretty(&config)?)?;
    Ok(())
}

// additive: what is already here stays; returns the workspaces for a rescan
#[tauri::command]
pub fn import_config_from_file(
    path: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Vec<String>, AppError> {
    let config: PortableConfig =
        serde_json::from_str(&std::fs::read_to_string(&path)?)?;

    {
        let mut ws = state.workspace_store.lock().map_err(lock_err)?;
        for w in &config.workspaces {
            // a duplicate or an overlap is a skip here, not a failure: an
            // import must never stop halfway
            let _ = ws.add(w);
        }
    }
    let (editor, terminal) = {
        let mut store = state.target_store.lock().map_err(lock_err)?;
        for t in config.targets {
            if store.get(&t.id).is_none() {
                let _ = store.add(t);
            }
        }
        // a default only for a target that exists here now
        (
            config.default_editor.filter(|id| store.get(id).is_some()),
            config.default_terminal.filter(|id| store.get(id).is_some()),
        )
    };
    {
        let mut prefs = state.pref_store.lock().map_err(lock_err)?;
        prefs
            .set_scan_config(config.scan_config)
            .map_err(AppError::Lock)?;
        // applied wholesale like scan_config: an older file resets the layout
        // to the default three, and import means "look like that machine"
        prefs
            .set_tmux_config(config.tmux_config)
            .map_err(AppError::Lock)?;
        if let Some(id) = editor {
            prefs
                .set_default_target(TargetKind::Editor, &id)
                .map_err(AppError::Lock)?;
        }
        if let Some(id) = terminal {
            prefs
                .set_default_target(TargetKind::Terminal, &id)
                .map_err(AppError::Lock)?;
        }
    }

    // best effort: the key may be taken on this machine, and that must not
    // fail the import. persisted only if it binds
    let previous = state.pref_store.lock().map_err(lock_err)?.summon_hotkey();
    if config.summon_hotkey != previous
        && crate::summon::rebind(&app, &previous, &config.summon_hotkey).is_ok()
    {
        let _ = state
            .pref_store
            .lock()
            .map_err(lock_err)?
            .set_summon_hotkey(Some(config.summon_hotkey));
    }

    Ok(state.workspace_store.lock().map_err(lock_err)?.list())
}

#[tauri::command]
pub fn reset_cache(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), AppError> {
    state.cache_store.lock().map_err(lock_err)?.clear()?;
    crate::tray::refresh(&app);
    Ok(())
}

/// Open the folder in Explorer. Works for WSL projects too: the UNC path is
/// what Explorer wants. Boots the distro, but the user asked for that.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), AppError> {
    // explorer.exe exits 1 even on success, so don't wait on it
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError::LaunchFailed(format!("explorer: {e}")))?;
    Ok(())
}

/// The path as WSL sees it. The Windows path is just full_path, which the
/// frontend already has.
#[tauri::command]
pub fn get_wsl_path(
    project: Project,
    state: State<AppState>,
) -> Result<String, AppError> {
    // a windows path ignores the distro, so the fallback is never read there
    let distro = match crate::services::scanner::distro_of(&project.full_path) {
        Some(d) => d,
        None => state
            .runtime_info
            .lock()
            .map_err(lock_err)?
            .default_distro
            .clone()
            .unwrap_or_default(),
    };
    Ok(crate::services::platform::paths::windows_to_wsl_path(
        &project.full_path,
        &distro,
    ))
}

/// The remote branches of one project, read when asked and remembered.
/// Not part of get_git_info: the badge pass is one git.exe per windows
/// project already, and chapter 27 exists because that pass was too
/// expensive to run on every focus. A branch list is a click away, never a
/// pass away. Stored on the project's GitInfo so the second open is free;
/// the next badge pass replaces the entry and clears it.
#[tauri::command]
pub fn get_remote_branches(
    project: Project,
    state: State<AppState>,
) -> Result<Vec<String>, AppError> {
    if let Some(cached) = state
        .git_cache
        .lock()
        .map_err(lock_err)?
        .get(&project.full_path)
        .and_then(|i| i.remote_branches.clone())
    {
        return Ok(cached);
    }
    let running = running_for(std::slice::from_ref(&project));
    let branches = git::remote_branches(&project, &running);
    let mut cache = state.git_cache.lock().map_err(lock_err)?;
    let entry = cache.entry(project.full_path.clone()).or_insert_with(|| {
        git::GitInfo {
            full_path: project.full_path.clone(),
            ..Default::default()
        }
    });
    entry.remote_branches = Some(branches.clone());
    Ok(branches)
}

/// The branches of a GitHub row that is not on disk: gh api, one network
/// call, on the click and never in a pass. async + spawn_blocking keeps
/// it off the main thread; the second open of the same repo is served
/// from github_branches without asking again.
#[tauri::command]
pub async fn get_github_branches(
    full_name: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    if let Some(cached) = state
        .github_branches
        .lock()
        .map_err(lock_err)?
        .get(&full_name)
    {
        return Ok(cached.clone());
    }
    let key = full_name.clone();
    let branches =
        tauri::async_runtime::spawn_blocking(move || github::branches(&key))
            .await
            .map_err(|e| AppError::Lock(e.to_string()))??;
    state
        .github_branches
        .lock()
        .map_err(lock_err)?
        .insert(full_name, branches.clone());
    Ok(branches)
}

/// Refresh from GitHub on a clone's own popover: the live list from the
/// API replaces the one refs/remotes remembered, on the same GitInfo
/// slot get_remote_branches fills, so the next open is the fresh list
/// until the badge pass replaces the entry. The remote is read from the
/// cache, which the badge pass filled; only a github.com remote parses.
#[tauri::command]
pub async fn refresh_remote_branches_github(
    project: Project,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let remote = state
        .git_cache
        .lock()
        .map_err(lock_err)?
        .get(&project.full_path)
        .and_then(|i| i.remote.clone())
        .ok_or_else(|| {
            AppError::GhUnavailable(
                "This project has no remote on record".into(),
            )
        })?;
    let full_name = github::parse_spec(&remote).ok_or_else(|| {
        AppError::GhUnavailable(format!("{remote} is not a GitHub repository"))
    })?;
    let key = full_name.clone();
    let branches =
        tauri::async_runtime::spawn_blocking(move || github::branches(&key))
            .await
            .map_err(|e| AppError::Lock(e.to_string()))??;
    state
        .github_branches
        .lock()
        .map_err(lock_err)?
        .insert(full_name, branches.clone());
    let mut cache = state.git_cache.lock().map_err(lock_err)?;
    if let Some(entry) = cache.get_mut(&project.full_path) {
        entry.remote_branches = Some(branches.clone());
    }
    Ok(branches)
}

/// An https:// link from Help or About: the same door open_remote uses.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), AppError> {
    open_in_browser(&url)
}

/// Where the JSON files live, for Help's "where your config lives" line.
/// The lock file sits in the app-data dir, so its parent is the answer.
#[tauri::command]
pub fn get_app_data_dir(state: State<AppState>) -> String {
    state
        .lock_path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The same folder, in Explorer.
#[tauri::command]
pub fn reveal_app_data_dir(state: State<AppState>) -> Result<(), AppError> {
    let dir = get_app_data_dir(state);
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| AppError::LaunchFailed(format!("explorer: {e}")))?;
    Ok(())
}

/// Open a repo in the browser: the repo root, or one branch of it.
///
/// Two doors, one command. A project (full_path) resolves its root from
/// the cached remote; a GitHub row (url) brings its own, straight from
/// gh. Either way the url is built here with branch_url, so the frontend
/// never assembles a url out of strings the user can see, and only
/// https:// ever reaches start.
#[tauri::command]
pub fn open_remote(
    full_path: Option<String>,
    url: Option<String>,
    branch: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    let root = match (full_path, url) {
        (Some(path), _) => state
            .git_cache
            .lock()
            .map_err(lock_err)?
            .get(&path)
            .and_then(|i| i.remote.clone())
            .ok_or(AppError::NoRemote(path))?,
        (None, Some(url)) => url,
        (None, None) => return Err(AppError::NoRemote("nothing".into())),
    };
    let url = match branch.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
        Some(b) => git::branch_url(&root, b),
        None => root,
    };
    open_in_browser(&url)
}

/// Hand an https:// url to the default browser, and nothing else.
///
/// `start` is a cmd builtin, so it needs a shell. The empty "" is the window
/// title argument, which start would otherwise steal the URL for.
fn open_in_browser(url: &str) -> Result<(), AppError> {
    if !url.starts_with("https://") {
        return Err(AppError::BadUrl(url.to_string()));
    }
    std::process::Command::new("cmd")
        .creation_flags(0x08000000)
        .args(["/c", "start", "", url])
        .spawn()
        .map_err(|e| AppError::LaunchFailed(format!("{url}: {e}")))?;
    Ok(())
}

// ── GitHub ──────────────────────────────────────────────────────────────

/// What the lane and the Settings panel read. stale is decided here so
/// the frontend never knows the six-hour rule; refreshing is whether a
/// fetch is in flight right now, so a button can say so.
#[derive(Serialize)]
pub struct GithubPayload {
    pub cache: GithubCache,
    pub stale: bool,
    pub refreshing: bool,
    /// the user's org choice; None means every org the last refresh found
    pub orgs: Option<Vec<String>>,
    /// full_name to local project path, for every row cloned here. As
    /// current as the last badge pass; the frontend re-reads after each
    pub local: HashMap<String, String>,
    /// the opt-in for live gh search as you type. Off by default
    pub live_search: bool,
}

/// The cache, immediately. No network here, ever: this is what renders
/// on mount and it must cost what reading a file costs.
#[tauri::command]
pub fn get_github_repos(
    state: State<AppState>,
) -> Result<GithubPayload, AppError> {
    let cache = state.github_store.lock().map_err(lock_err)?.get();
    let (orgs, live_search) = {
        let prefs = state.pref_store.lock().map_err(lock_err)?;
        (prefs.github_orgs(), prefs.github_live_search())
    };
    let local = {
        let git = state.git_cache.lock().map_err(lock_err)?;
        github::local_matches(
            &cache.repos,
            git.values().filter_map(|i| {
                i.remote.as_deref().map(|r| (i.full_path.as_str(), r))
            }),
        )
    };
    Ok(GithubPayload {
        local,
        live_search,
        stale: github::is_stale(
            cache.fetched_at,
            crate::services::preferences::now_secs(),
        ),
        refreshing: state
            .github_refreshing
            .load(std::sync::atomic::Ordering::Relaxed),
        cache,
        orgs,
    })
}

/// Installed / logged in as / neither, without touching the network.
#[tauri::command]
pub fn get_github_status() -> GhStatus {
    github::status()
}

/// Fetch the repo list on a spawned thread and return before it finishes.
///
/// Twenty seconds must never sit under a click. The thread runs gh,
/// writes the cache and emits devgo://github-updated with { ok, error };
/// the frontend re-reads get_github_repos on ok and shows error
/// otherwise. A failed fetch writes nothing, so the cache is what it was.
///
/// The only function in DevGo that starts a network request. Its callers
/// are the refresh button, the palette, and the lane's first open in a
/// session on a stale cache. Not launch, not focus, not the badge pass.
#[tauri::command]
pub fn refresh_github_repos(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), AppError> {
    use std::sync::atomic::Ordering;
    if state
        .github_refreshing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(());
    }
    let chosen = state.pref_store.lock().map_err(lock_err)?.github_orgs();

    std::thread::spawn(move || {
        let result = (|| -> Result<(), AppError> {
            // every org the user belongs to, always: the panel's
            // checkboxes come from this list. the chosen subset is listed
            let all_orgs = github::list_orgs()?;
            let listed: Vec<String> = match &chosen {
                Some(c) => {
                    all_orgs.iter().filter(|o| c.contains(o)).cloned().collect()
                }
                None => all_orgs.clone(),
            };
            let (login, repos) = github::list_repos(&listed)?;
            let st = app.state::<AppState>();
            let mut store = st.github_store.lock().map_err(lock_err)?;
            store.store(GithubCache {
                fetched_at: crate::services::preferences::now_secs(),
                login: Some(login),
                orgs: all_orgs,
                repos,
            })
        })();
        let st = app.state::<AppState>();
        st.github_refreshing.store(false, Ordering::Release);
        let payload = match &result {
            Ok(()) => serde_json::json!({ "ok": true, "error": null }),
            Err(e) => {
                serde_json::json!({ "ok": false, "error": e.to_string() })
            }
        };
        let _ = tauri::Emitter::emit(&app, "devgo://github-updated", payload);
    });
    Ok(())
}

/// Save the org choice. Takes effect on the next refresh; nothing here
/// fetches.
#[tauri::command]
pub fn set_github_orgs(
    orgs: Option<Vec<String>>,
    state: State<AppState>,
) -> Result<(), AppError> {
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .set_github_orgs(orgs)
        .map_err(AppError::Lock)
}

#[tauri::command]
pub fn set_github_live_search(
    on: bool,
    state: State<AppState>,
) -> Result<(), AppError> {
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .set_github_live_search(on)
        .map_err(AppError::Lock)
}

/// What one live search answers: the hits, and the generation the
/// frontend stamped on the request so it can drop an answer to a query
/// it has since moved past.
#[derive(Serialize)]
pub struct SearchAnswer {
    pub generation: u64,
    pub repos: Vec<github::Repo>,
}

/// Search all of GitHub for query. Off the main thread, like
/// add_github_repo; the debounce, the length floor and the switch are
/// the frontend's. This command only answers what it is asked.
#[tauri::command]
pub async fn search_github(
    query: String,
    generation: u64,
) -> Result<SearchAnswer, AppError> {
    let repos =
        tauri::async_runtime::spawn_blocking(move || github::search(&query))
            .await
            .map_err(|e| AppError::Lock(e.to_string()))??;
    Ok(SearchAnswer { generation, repos })
}

/// Add one repository to the group by name: any owner, no clone.
///
/// gh repo view is one network call, about 0.6 s. An async command runs
/// off the main thread, and spawn_blocking keeps the call off the async
/// runtime's workers too; the store is locked only after gh has answered.
#[tauri::command]
pub async fn add_github_repo(
    spec: String,
    state: State<'_, AppState>,
) -> Result<github::Repo, AppError> {
    let full_name = github::parse_spec(&spec).ok_or_else(|| {
        AppError::GhUnavailable(format!(
            "{spec:?} is not owner/name or a GitHub url"
        ))
    })?;
    let repo = tauri::async_runtime::spawn_blocking(move || {
        github::view_repo(&full_name)
    })
    .await
    .map_err(|e| AppError::Lock(e.to_string()))??;
    state
        .github_store
        .lock()
        .map_err(lock_err)?
        .add(repo.clone())?;
    Ok(repo)
}

/// One edit to the GitHub groups. An enum rather than five commands: the
/// frontend has one door, the store has one write, and every variant is a
/// pure function in services::groups with its own test.
#[derive(serde::Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum GroupEdit {
    Assign { group: String, repo: String },
    Unassign { group: String, repo: String },
    Rename { from: String, to: String },
    Delete { name: String },
    Reorder { order: Vec<String> },
}

#[tauri::command]
pub fn get_github_groups(
    state: State<AppState>,
) -> Result<Vec<GithubGroup>, AppError> {
    Ok(state.pref_store.lock().map_err(lock_err)?.github_groups())
}

/// Apply one edit and return the whole list, so the frontend never has to
/// predict what the store did.
#[tauri::command]
pub fn edit_github_groups(
    edit: GroupEdit,
    state: State<AppState>,
) -> Result<Vec<GithubGroup>, AppError> {
    let mut prefs = state.pref_store.lock().map_err(lock_err)?;
    let current = prefs.github_groups();
    let next = match edit {
        GroupEdit::Assign { group, repo } => {
            groups::assign(current, &group, &repo)?
        }
        GroupEdit::Unassign { group, repo } => {
            groups::unassign(current, &group, &repo)
        }
        GroupEdit::Rename { from, to } => groups::rename(current, &from, &to)?,
        GroupEdit::Delete { name } => groups::delete(current, &name),
        GroupEdit::Reorder { order } => groups::reorder(current, &order)?,
    };
    prefs
        .set_github_groups(next.clone())
        .map_err(AppError::Lock)?;
    Ok(next)
}

/// What clone_repo answers before the clone has started.
#[derive(Serialize)]
pub struct CloneStarted {
    pub full_name: String,
    /// the path the project will have, in the workspace's own form
    pub dest: String,
    pub protocol: clone::Protocol,
}

/// Clone a GitHub row into a workspace, on a spawned thread.
///
/// Returns as soon as the refusals have been checked and the thread
/// started. Progress arrives as devgo://clone-progress { full_name,
/// phase, percent } and the end as devgo://clone-done { full_name, ok,
/// dest, error }. The frontend runs a picker's clones one after another
/// off those events: parallel clones are a way to get rate-limited and a
/// way to fill a disk.
#[tauri::command]
pub fn clone_repo(
    full_name: String,
    workspace: String,
    name: Option<String>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<CloneStarted, AppError> {
    // not because a stranger could call it: because a stale picker could,
    // after a workspace was removed underneath it
    if !state
        .workspace_store
        .lock()
        .map_err(lock_err)?
        .list()
        .contains(&workspace)
    {
        return Err(AppError::CloneRefused(format!(
            "{workspace} is not one of your workspaces"
        )));
    }
    let repo_name = full_name
        .rsplit('/')
        .next()
        .unwrap_or(&full_name)
        .to_string();
    let folder = clone::folder_name(&repo_name, name.as_deref())?;
    let protocol = clone::Protocol::detect();
    let plan = clone::plan(&workspace, &full_name, &folder, protocol);
    // the liveness list only matters for a WSL workspace; a Windows one
    // skips the wsl.exe spawn entirely, same as the scanner
    let running = if plan.distro.is_some() {
        wsl::running_distros_memo()
    } else {
        Vec::new()
    };
    clone::refuse_if_needed(&plan, &running)?;

    let started = CloneStarted {
        full_name: full_name.clone(),
        dest: plan.dest.clone(),
        protocol,
    };
    std::thread::spawn(move || {
        let result = clone::run(&plan, |line| {
            let (phase, percent) = clone::parse_progress(line);
            let _ = tauri::Emitter::emit(
                &app,
                "devgo://clone-progress",
                serde_json::json!({
                    "full_name": full_name,
                    "phase": phase,
                    "percent": percent
                }),
            );
        });
        let error = result.as_ref().err().map(|e| e.to_string());
        let _ = tauri::Emitter::emit(
            &app,
            "devgo://clone-done",
            serde_json::json!({
                "full_name": full_name,
                "ok": result.is_ok(),
                "dest": plan.dest,
                "error": error
            }),
        );
    });
    Ok(started)
}

/// The two clone urls for a row, built in Rust from owner/name.
#[tauri::command]
pub fn github_clone_urls(full_name: String) -> (String, String) {
    github::clone_urls(&full_name)
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
// the new chord is registered before the old one is dropped, so a taken
// key leaves the working binding in place
#[tauri::command]
pub fn set_summon_hotkey(
    accelerator: Option<String>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<String, AppError> {
    let previous = state.pref_store.lock().map_err(lock_err)?.summon_hotkey();
    let next = accelerator.clone().unwrap_or_else(|| {
        crate::services::preferences::DEFAULT_SUMMON_HOTKEY.to_string()
    });

    crate::summon::rebind(&app, &previous, &next)
        .map_err(|e| AppError::HotkeyFailed(next.clone(), e))?;

    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .set_summon_hotkey(accelerator)
        .map_err(AppError::Lock)?;
    Ok(next)
}

#[tauri::command]
pub fn get_summon_hotkey(state: State<AppState>) -> Result<String, AppError> {
    Ok(state.pref_store.lock().map_err(lock_err)?.summon_hotkey())
}

#[tauri::command]
pub fn get_window_transparency(state: State<AppState>) -> Result<u8, AppError> {
    Ok(state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .window_transparency())
}

// the window is the preview: every change is applied and persisted by
// this one call, which hands back the clamped value for the slider
#[tauri::command]
pub fn set_window_transparency(
    percent: u8,
    window: tauri::WebviewWindow,
    state: State<AppState>,
) -> Result<u8, AppError> {
    let stored = {
        let mut prefs = state.pref_store.lock().map_err(lock_err)?;
        prefs
            .set_window_transparency(percent)
            .map_err(AppError::Lock)?;
        prefs.window_transparency()
    };
    crate::apply_transparency(&window, stored);
    Ok(stored)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("devgo-cmd-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn project(name: &str, workspace: &str) -> Project {
        Project::new(
            name.to_string(),
            format!("{workspace}\\{name}"),
            workspace.to_string(),
            "Windows".to_string(),
        )
    }

    #[test]
    fn cached_payload_reads_the_cache_and_ranks_it() {
        let dir = temp("cached-payload");
        let mut cache = ProjectCacheStore::new(dir.clone()).unwrap();
        let mut prefs = PreferencesStore::new(dir).unwrap();
        cache
            .store(
                r"G:\a",
                vec![project("web", r"G:\a"), project("api", r"G:\a")],
            )
            .unwrap();
        prefs.toggle_pin(r"G:\a\web").unwrap();

        let ws = vec![r"G:\a".to_string(), r"G:\never-scanned".to_string()];
        let payload = cached_payload(&ws, &cache, &prefs);

        let names: Vec<&str> =
            payload.projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["api", "web"]);
        assert_eq!(payload.workspaces.len(), 1);
        assert!(matches!(
            payload.workspaces[0].status,
            WorkspaceStatus::Cached
        ));
        assert!(payload.workspaces[0].reason.is_none());
        assert_eq!(payload.workspaces[0].count, 2);
        assert_eq!(payload.ranks.len(), 2);
        assert!(payload
            .ranks
            .iter()
            .any(|r| r.full_path == r"G:\a\web" && r.pinned));
    }
}
