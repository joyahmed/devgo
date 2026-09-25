use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Emitter, Manager, State};

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
#[cfg(windows)]
use crate::services::platform::Quiet;
use crate::services::platform::{wsl, wsl_watch, RuntimeInfo};
use crate::services::pty;
use crate::services::scanner::LOCAL_FS;
use crate::services::scanner::{ScanOutcome, UnavailableReason};
use crate::services::server_folders::{
    self, ListingCache, RemoteFolder, ServerListing,
};
use crate::services::server_setup;
use crate::services::servers::{Server, ServersStore};
use crate::services::ssh_config;
use crate::services::GithubStore;
use crate::services::PreferencesStore;
use crate::services::ProjectCacheStore;
use crate::services::TargetStore;
use crate::services::WorkspaceStore;

fn lock_err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Lock(e.to_string())
}

// the os underneath, in one place. every door this file opens to the
// desktop (the browser, the file manager, the user's home, the startup
// log) is a windows shape, a mac shape and a linux shape, decided here
// once per concern. not a cfg! at each call site: four stand-in servers
// read USERPROFILE, and a fifth would have been the one that forgot the mac

// the local side's name in a sentence: "install it on windows". spelled
// per os, not not(macos): that said "Windows" on a linux box
#[cfg(target_os = "macos")]
const LOCAL_OS: &str = "macOS";
#[cfg(target_os = "linux")]
const LOCAL_OS: &str = "Linux";
#[cfg(windows)]
const LOCAL_OS: &str = "Windows";

// the desktop's own door opener. `open` is a mac program; on linux the
// same job is xdg-open's, and `open` there is an alternatives symlink to
// it at best, missing at worst, and takes none of open's flags
#[cfg(target_os = "macos")]
const OPENER: &str = "open";
#[cfg(target_os = "linux")]
const OPENER: &str = "xdg-open";

// the user's home: where a terminal opens when the thing launched is a
// server rather than a folder
#[cfg(windows)]
fn home_dir() -> String {
    std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".into())
}
#[cfg(not(windows))]
fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

// a server launch opens a terminal at home: the project shape the
// launcher takes, with the local word so it lands where a scanned one does
fn home_stand_in(name: &str) -> Project {
    Project::new(name.to_string(), home_dir(), String::new(), LOCAL_FS.into())
}

// %LOCALAPPDATA%\DevGo on windows, ~/Library/Logs/DevGo on a mac (where
// console.app looks), $XDG_STATE_HOME/DevGo on linux; None when the
// environment does not say
#[cfg(windows)]
fn startup_log_dir() -> Option<std::path::PathBuf> {
    let local = std::env::var("LOCALAPPDATA").ok()?;
    Some(std::path::Path::new(&local).join("DevGo"))
}
#[cfg(target_os = "linux")]
fn startup_log_dir() -> Option<std::path::PathBuf> {
    // the spec's own rule: an empty value counts as unset
    if let Some(state) =
        std::env::var_os("XDG_STATE_HOME").filter(|s| !s.is_empty())
    {
        return Some(std::path::Path::new(&state).join("DevGo"));
    }
    let home = std::env::var("HOME").ok()?;
    Some(
        std::path::Path::new(&home)
            .join(".local")
            .join("state")
            .join("DevGo"),
    )
}
#[cfg(target_os = "macos")]
fn startup_log_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        std::path::Path::new(&home)
            .join("Library")
            .join("Logs")
            .join("DevGo"),
    )
}

/// Hand an https:// url to the default browser, and nothing else. On
/// Windows `start` is a cmd builtin, so it needs a shell; the empty "" is
/// the window title argument, which start would otherwise steal the URL
/// for. Elsewhere the opener is a program and takes the URL as it is.
fn open_in_browser(url: &str) -> Result<(), AppError> {
    if !url.starts_with("https://") {
        return Err(AppError::BadUrl(url.to_string()));
    }
    #[cfg(windows)]
    let spawned = std::process::Command::new("cmd")
        .quiet()
        .args(["/c", "start", "", url])
        .spawn();
    #[cfg(not(windows))]
    let spawned = std::process::Command::new(OPENER).arg(url).spawn();
    spawned.map_err(|e| AppError::LaunchFailed(format!("{url}: {e}")))?;
    Ok(())
}

/// The command line that shows a path in a file manager.
///
/// `select` asks for the item highlighted inside its parent, which is what
/// reveal means; a target with no reveal template has no verb for it - no
/// Linux file manager does, and Explorer's /select does not survive the UNC
/// path a WSL project has - so it opens the containing folder instead, the
/// closest honest thing. Pure, so each shape is pinned by a test rather
/// than by a spawn.
fn reveal_line(
    target: &LaunchTarget,
    path: &str,
    select: bool,
) -> Option<(String, String)> {
    if !select {
        return target.resolve(path, None);
    }
    target.resolve_reveal(path).or_else(|| {
        let parent = std::path::Path::new(path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string());
        target.resolve(&parent, None)
    })
}

/// Show a path in the file manager: the registered one, not a program name
/// baked in here. Not awaited: explorer.exe exits 1 even on success, so
/// only a failure to launch the file manager at all is an error.
fn reveal_path(
    state: &AppState,
    path: &str,
    select: bool,
    target_id: Option<String>,
) -> Result<(), AppError> {
    let target = resolve_target(state, TargetKind::FileManager, target_id)?;
    let (exe, args) = reveal_line(&target, path, select).ok_or_else(|| {
        AppError::ActionRefused(format!(
            "{} has no template for opening a folder",
            target.name
        ))
    })?;
    launcher::spawn_raw(&exe, &args)
}

/// Milliseconds since the process started: the startup budget's clock.
#[tauri::command]
pub fn startup_ms() -> u64 {
    crate::started().elapsed().as_millis() as u64
}

/// Append `<stage>,<ms>` to `startup.log` (`startup_log_dir`), only when
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
    Some(startup_log_dir()?.join("startup.log"))
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
    /// Traffic read from GitHub this session, by owner/name, with the
    /// time it was read. In memory only; nothing fills it but a click.
    pub github_traffic: Mutex<HashMap<String, github::Traffic>>,
    pub servers_store: Mutex<ServersStore>,
    pub servers_cache: Mutex<ListingCache>,
    /// The attach view's open panes: a pty each, in memory only
    pub ptys: Mutex<pty::Registry>,
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
///
/// `only` narrows the pass to one workspace: that one is read live and
/// stored, and the payload holds its projects alone for the frontend to
/// merge over the list it has.
fn collect_projects(
    state: &AppState,
    allow_boot: bool,
    only: Option<&str>,
) -> Result<ProjectsPayload, AppError> {
    let all = state.workspace_store.lock().map_err(lock_err)?.list();

    let mut cache = state.cache_store.lock().map_err(lock_err)?;
    // pruned against the whole store, never the narrowed list, or one
    // refresh would evict every other workspace's cache
    cache.retain(&all)?;

    let workspaces: Vec<String> = match only {
        Some(one) => {
            let found: Vec<String> =
                all.iter().filter(|w| w.as_str() == one).cloned().collect();
            if found.is_empty() {
                return Err(AppError::WorkspaceNotFound(one.to_string()));
            }
            found
        }
        None => all,
    };

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
        off_main(&app, |state| collect_projects(state, false, None)).await?;
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
        collect_projects(state, force, None)
    })
    .await?;
    crate::tray::refresh(&app);
    Ok(payload)
}

/// Refresh one workspace, the header's own refresh. An explicit ask that
/// names the workspace, so it may boot that one's distro and no other: the
/// pass reads nothing else. The payload carries its projects only.
#[tauri::command]
pub async fn refresh_workspace(
    workspace: String,
    app: tauri::AppHandle,
) -> Result<ProjectsPayload, AppError> {
    let payload = off_main(&app, move |state| {
        collect_projects(state, true, Some(&workspace))
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

/// Refuse a project whose folder is no longer there.
///
/// The list outlives the directory: move or delete a project and it stays
/// on screen until the next scan. Nothing downstream looks — a template
/// resolves {path} to a string and the shell hands it over — so the
/// emulator was given a working directory that does not exist, fell back
/// to the home directory, and opened there saying nothing. Wrong place,
/// silently, which is the pair the launcher refuses everywhere else.
///
/// Here rather than in `launch_target`: this is the boundary a project
/// arrives at from the list, and it is the list that is stale. The
/// launcher's other callers pass a stand-in for the home directory (a
/// server is not a folder), which is not a thing that goes missing.
///
/// A WSL project is not asked. The answer would cost a distro boot, and
/// DevGo boots one because you launched, never because it wondered.
fn require_project_dir(project: &Project) -> Result<(), AppError> {
    if crate::services::scanner::distro_of(&project.full_path).is_some()
        || std::path::Path::new(&project.full_path).is_dir()
    {
        return Ok(());
    }
    Err(AppError::ProjectMissing(
        project.name.clone(),
        project.full_path.clone(),
    ))
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
        .ok_or_else(|| AppError::TargetNotFound(kind.wire().to_string()))
}

#[tauri::command]
pub fn open_editor(
    project: Project,
    target_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    require_project_dir(&project)?;
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
    require_project_dir(&project)?;
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
    require_project_dir(project)?;
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
        .ok_or(AppError::TargetNotFound(id))?;

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
///
/// The key is `TargetKind::wire`, the name serde gives the kind, not the
/// variant's Debug spelling: those agreed only while every kind was one
/// word, and `file_manager` is where they part.
#[tauri::command]
pub fn get_default_targets(
    state: State<AppState>,
) -> Result<Vec<(String, String)>, AppError> {
    let prefs = state.pref_store.lock().map_err(lock_err)?;
    let store = state.target_store.lock().map_err(lock_err)?;
    Ok(TargetKind::ALL
        .into_iter()
        .filter_map(|k| {
            let id = prefs
                .default_target(k)
                .filter(|id| store.get(id).is_some())
                .or_else(|| store.first_of(k).map(|t| t.id))?;
            Some((k.wire().to_string(), id))
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
    require_project_dir(&project)?;
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
    require_project_dir(&project)?;
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
            ("WSL".to_string(), "Install it in the distro".to_string())
        } else {
            (LOCAL_OS.to_string(), format!("Install it on {LOCAL_OS}"))
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

// the attach view: a pty whose child is the multiplexer client for one
// session. the bytes it prints go down the channel the pane handed over;
// its end is an event, since by then the channel may be gone

#[derive(Serialize, Clone)]
pub struct AttachOpened {
    pub id: String,
    pub line: String,
    pub session: String,
    pub place: String,
}

#[derive(Serialize, Clone)]
pub struct PtyExit {
    pub id: String,
    pub code: u32,
}

#[tauri::command]
pub fn pty_open(
    target: pty::AttachTarget,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<AttachOpened, AppError> {
    let line = match target {
        pty::AttachTarget::Project { project } => {
            let running = running_for(std::slice::from_ref(&project));
            pty::project_line(&project, &running)?
        }
        pty::AttachTarget::Server { id } => {
            let server = state
                .servers_store
                .lock()
                .map_err(lock_err)?
                .get(&id)
                .ok_or_else(|| AppError::ServerNotFound(id.clone()))?;
            pty::server_line(&server)?
        }
    };
    let id = state.ptys.lock().map_err(lock_err)?.open(
        &line,
        cols,
        rows,
        move |bytes| {
            let _ = on_data.send(InvokeResponseBody::Raw(bytes));
        },
        move |id, code| {
            if let Some(s) = app.try_state::<AppState>() {
                if let Ok(mut ptys) = s.ptys.lock() {
                    ptys.forget(&id);
                }
            }
            let _ = app.emit("devgo://pty-exit", PtyExit { id, code });
        },
    )?;
    Ok(AttachOpened {
        id,
        line: line.display(),
        session: line.session,
        place: line.place,
    })
}

#[tauri::command]
pub fn pty_write(
    id: String,
    data: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    state
        .ptys
        .lock()
        .map_err(lock_err)?
        .write(&id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<AppState>,
) -> Result<(), AppError> {
    state.ptys.lock().map_err(lock_err)?.resize(&id, cols, rows)
}

// detach: the client ends, the session stays
#[tauri::command]
pub fn pty_close(id: String, state: State<AppState>) -> Result<(), AppError> {
    state.ptys.lock().map_err(lock_err)?.close(&id)
}

// servers: the rows, the edits, the import, and the one launch. nothing
// here touches the network; the terminal does, when it runs ssh

#[tauri::command]
pub fn get_servers(state: State<AppState>) -> Result<Vec<Server>, AppError> {
    Ok(state.servers_store.lock().map_err(lock_err)?.list())
}

#[tauri::command]
pub fn add_server(
    server: Server,
    state: State<AppState>,
) -> Result<Server, AppError> {
    state.servers_store.lock().map_err(lock_err)?.add(server)
}

#[tauri::command]
pub fn update_server(
    server: Server,
    state: State<AppState>,
) -> Result<(), AppError> {
    state.servers_store.lock().map_err(lock_err)?.update(server)
}

#[tauri::command]
pub fn remove_server(
    id: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    state.servers_store.lock().map_err(lock_err)?.remove(&id)?;
    state.servers_cache.lock().map_err(lock_err)?.forget(&id)
}

// read ~/.ssh/config and merge its hosts in by alias. an explicit ask
// from settings, the palette or the card, never on launch; the file is
// never written. returns (added, updated)
#[tauri::command]
pub fn import_ssh_config(
    state: State<AppState>,
) -> Result<(usize, usize), AppError> {
    let path = ssh_config::default_path().ok_or_else(|| {
        AppError::LaunchFailed(
            "no home directory to find ~/.ssh/config in".into(),
        )
    })?;
    let text = std::fs::read_to_string(&path).map_err(|e| {
        AppError::LaunchFailed(format!(
            "could not read {}: {e}",
            path.display()
        ))
    })?;
    let imported = ssh_config::parse(&text);
    state
        .servers_store
        .lock()
        .map_err(lock_err)?
        .upsert_from_config(imported)
}

// the card exists only when there is an ssh client to run
#[tauri::command]
pub fn has_ssh() -> bool {
    editors::is_on_path("ssh")
}

// a terminal on the server: the ssh line through a local host, the
// terminal picked by id or the default. via says which host: the
// terminal's run template (the dev-script path), a psmux session whose
// window runs the line, or the default distro's own ssh. the terminal's
// {path} is the home directory; a server is not a folder here. the line
// comes back so the row can show it; preview reads it and spawns nothing
#[tauri::command]
pub fn open_server(
    id: String,
    target_id: Option<String>,
    via: Option<launcher::ServerVia>,
    preview: Option<bool>,
    state: State<AppState>,
) -> Result<String, AppError> {
    let server = state
        .servers_store
        .lock()
        .map_err(lock_err)?
        .get(&id)
        .ok_or_else(|| AppError::ServerNotFound(id.clone()))?;
    let stand_in = home_stand_in(&server.name);
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let terminal = resolve_target(&state, TargetKind::Terminal, target_id)?;
    let via = via.unwrap_or(launcher::ServerVia::Terminal);
    // the liveness read only when the wsl host asks; through the memo,
    // and never a boot
    let running = match via {
        launcher::ServerVia::Wsl => wsl::running_distros_memo(),
        _ => Vec::new(),
    };
    let (exe, args) = launcher::server_line(
        &terminal,
        &stand_in,
        &info,
        &server.ssh_command(),
        via,
        &running,
    )?;
    if !preview.unwrap_or(false) {
        launcher::spawn_raw(&exe, &args)?;
    }
    Ok(format!("{exe} {args}"))
}

// what the menu copies: the ssh line and the scp prefix
#[tauri::command]
pub fn server_commands(
    id: String,
    state: State<AppState>,
) -> Result<(String, String), AppError> {
    let server = state
        .servers_store
        .lock()
        .map_err(lock_err)?
        .get(&id)
        .ok_or_else(|| AppError::ServerNotFound(id.clone()))?;
    Ok((
        format!("ssh {}", server.ssh_target().join(" ")),
        server.scp_prefix(),
    ))
}

// the cached listings, for the card's first paint. no network
#[tauri::command]
pub fn get_server_listings(
    state: State<AppState>,
) -> Result<HashMap<String, ServerListing>, AppError> {
    Ok(state.servers_cache.lock().map_err(lock_err)?.all())
}

// one server's folders: the explicit ask. one ssh off the main thread;
// success is also "up". the result is cached and returned; a failure
// keeps the last good folders, marks the box down and carries the reason
#[tauri::command]
pub async fn list_server_folders(
    id: String,
    app: tauri::AppHandle,
) -> Result<ServerListing, AppError> {
    let server = {
        let h = app.state::<AppState>();
        let s = h.servers_store.lock().map_err(lock_err)?.get(&id);
        s.ok_or_else(|| AppError::ServerNotFound(id.clone()))?
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        server_folders::list(&server)
    })
    .await
    .map_err(lock_err)?;
    let now = crate::services::preferences::now_secs();
    let state = app.state::<AppState>();
    let mut cache = state.servers_cache.lock().map_err(lock_err)?;
    // a re-list keeps the drill-downs made so far; a failure keeps the last
    // good folders, inventory and actions too, marks the box down and
    // carries the reason
    let previous = cache.all().remove(&id).unwrap_or_default();
    let listing = match result {
        Ok(listed) => ServerListing {
            folders: listed.folders,
            subdirs: previous.subdirs,
            listed_at: now,
            up: true,
            error: None,
            inventory: listed.inventory,
            actions: listed.actions,
            inventory_error: listed.inventory_error,
        },
        Err(err) => ServerListing {
            listed_at: now,
            up: false,
            error: Some(err),
            ..previous
        },
    };
    cache.store(&id, listing.clone())?;
    Ok(listing)
}

// what run_server_action did, so the toast can say it
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ActionOutcome {
    // typed into a tmux window and run; the terminal is attached to it
    Ran { window: String },
    // typed, not run; enter is the user's
    Typed { window: String },
    // no tmux on that row: the line is handed back for the clipboard
    Copied { line: String },
    Opened { url: String },
    // a local line, in a terminal on this pc
    Local { line: String },
}

// the terminal on the server, the row's ordinary launch line
fn attach_terminal(state: &AppState, server: &Server) -> Result<(), AppError> {
    let stand_in = home_stand_in(&server.name);
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let terminal = resolve_target(state, TargetKind::Terminal, None)?;
    launcher::launch_with_command(
        &terminal,
        &stand_in,
        &info,
        &server.ssh_command(),
    )
}

// one of the actions the server declares: the server's own when app_dir is
// None, an app's, filled from the inventory, otherwise. the line reaches
// the box as one argv element of a direct ssh, never through the terminal's
// run template; the terminal then attaches with the row's ordinary launch
// line and lands on the window just made. sudo asks there
#[tauri::command]
pub async fn run_server_action(
    id: String,
    action_id: String,
    app_dir: Option<String>,
    values: Option<HashMap<String, String>>,
    preview: Option<bool>,
    app: tauri::AppHandle,
) -> Result<ActionOutcome, AppError> {
    use crate::services::server_apps::{
        check_local, compose, fill, placeholders, typed_command, Action,
        ActionKind,
    };
    // a form composes its line from the drawer's values first, validated
    // as words, and then goes exactly the run way
    let composed = |a: &Action| -> Result<String, AppError> {
        if a.kind == ActionKind::Form {
            compose(
                a,
                values.as_ref().unwrap_or(&HashMap::new()),
                preview.unwrap_or(false),
            )
            .map_err(AppError::ActionRefused)
        } else {
            Ok(a.command.clone())
        }
    };
    let (server, action, line) = {
        let h = app.state::<AppState>();
        let server = h
            .servers_store
            .lock()
            .map_err(lock_err)?
            .get(&id)
            .ok_or_else(|| AppError::ServerNotFound(id.clone()))?;
        let listing = h
            .servers_cache
            .lock()
            .map_err(lock_err)?
            .all()
            .remove(&id)
            .unwrap_or_default();
        let actions = listing.actions.as_ref().ok_or_else(|| {
            AppError::ActionRefused(format!(
                "{} declares no actions. Refresh to list them",
                server.name
            ))
        })?;
        let (action, line) = match app_dir.as_deref() {
            None => {
                let a = actions
                    .server
                    .iter()
                    .find(|a| a.id == action_id)
                    .ok_or_else(|| {
                        AppError::ActionNotFound(action_id.clone())
                    })?;
                (a.clone(), composed(a)?)
            }
            Some(dir) => {
                let a =
                    actions.app.iter().find(|a| a.id == action_id).ok_or_else(
                        || AppError::ActionNotFound(action_id.clone()),
                    )?;
                let dir = dir.trim_end_matches('/');
                let entry = listing
                    .inventory
                    .as_ref()
                    .and_then(|i| {
                        i.apps
                            .iter()
                            .find(|x| x.dir.trim_end_matches('/') == dir)
                    })
                    .ok_or_else(|| {
                        AppError::ActionRefused(format!(
                            "{dir} is not an app in the inventory"
                        ))
                    })?;
                let line = fill(&composed(a)?, &placeholders(entry))
                    .ok_or_else(|| {
                        AppError::ActionRefused(format!(
                            "{} has nothing to fill {} with",
                            entry.name, a.label
                        ))
                    })?;
                (a.clone(), line)
            }
        };
        (server, action, line)
    };

    match action.kind {
        ActionKind::Url => {
            open_in_browser(&line)?;
            Ok(ActionOutcome::Opened { url: line })
        }
        ActionKind::Local => {
            check_local(&line).map_err(AppError::ActionRefused)?;
            let h = app.state::<AppState>();
            let stand_in = home_stand_in(&server.name);
            let info = h.runtime_info.lock().map_err(lock_err)?.clone();
            let terminal = resolve_target(&h, TargetKind::Terminal, None)?;
            launcher::launch_with_command(&terminal, &stand_in, &info, &line)?;
            Ok(ActionOutcome::Local { line })
        }
        ActionKind::Run | ActionKind::Pretype | ActionKind::Form => {
            let press_enter = action.kind != ActionKind::Pretype;
            if !server.tmux {
                // no window to type into: the frontend copies the line and
                // opens the terminal plain
                return Ok(ActionOutcome::Copied { line });
            }
            let session = server
                .session
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "devgo".into());
            let window = server_folders::session_slug(&action.id);
            let remote = typed_command(&session, &window, &line, press_enter);
            let sv = server.clone();
            tauri::async_runtime::spawn_blocking(move || {
                server_folders::run_remote(&sv, &remote)
            })
            .await
            .map_err(lock_err)?
            .map_err(AppError::LaunchFailed)?;
            attach_terminal(&app.state::<AppState>(), &server)?;
            let name = format!("{session}:{window}");
            Ok(if press_enter {
                ActionOutcome::Ran { window: name }
            } else {
                ActionOutcome::Typed { window: name }
            })
        }
    }
}

// the line a form would type, for the drawer to show as the user types:
// the truth on screen before the click. the same lookup and the same
// compose and fill as run_server_action; nothing is sent. an error is the
// validation message for the field it names
#[tauri::command]
pub fn compose_server_action(
    id: String,
    action_id: String,
    app_dir: Option<String>,
    values: HashMap<String, String>,
    preview: bool,
    state: State<AppState>,
) -> Result<String, String> {
    use crate::services::server_apps::{compose, fill, placeholders};
    let listing = state
        .servers_cache
        .lock()
        .map_err(|e| e.to_string())?
        .all()
        .remove(&id)
        .unwrap_or_default();
    let actions = listing.actions.as_ref().ok_or("No actions")?;
    let list = if app_dir.is_some() {
        &actions.app
    } else {
        &actions.server
    };
    let action = list
        .iter()
        .find(|a| a.id == action_id)
        .ok_or("No such action")?;
    let line = compose(action, &values, preview)?;
    let Some(dir) = app_dir.as_deref() else {
        return Ok(line);
    };
    let dir = dir.trim_end_matches('/');
    let entry = listing
        .inventory
        .as_ref()
        .and_then(|i| {
            i.apps.iter().find(|x| x.dir.trim_end_matches('/') == dir)
        })
        .ok_or("Not an app in the inventory")?;
    fill(&line, &placeholders(entry))
        .ok_or_else(|| "This app lacks something the line needs".to_string())
}

// set up this box, the look: one ssh reads what the box already holds
// under the directory, and the plan says which of the carried files are
// missing (installed on confirm), the same (nothing to do) or the user's
// own (kept). dir is ~/scripts unless a scratch directory is named
#[tauri::command]
pub async fn plan_server_setup(
    id: String,
    dir: Option<String>,
    app: tauri::AppHandle,
) -> Result<server_setup::SetupPlan, AppError> {
    let server = {
        let h = app.state::<AppState>();
        let s = h.servers_store.lock().map_err(lock_err)?.get(&id);
        s.ok_or_else(|| AppError::ServerNotFound(id.clone()))?
    };
    let dir = dir.unwrap_or_else(|| server_setup::DIR.to_string());
    server_setup::check_dir(&dir).map_err(AppError::SetupRefused)?;
    let probe = server_setup::probe_command(&dir);
    let out = tauri::async_runtime::spawn_blocking(move || {
        server_folders::read_remote(&server, &probe)
    })
    .await
    .map_err(lock_err)?
    .map_err(AppError::LaunchFailed)?;
    Ok(server_setup::plan(&dir, &server_setup::parse_probe(&out)))
}

// set up this box, the write: the named files, which the plan said were
// missing, on the stdin of one ssh that splits them into the directory
// and sets their modes. nothing else on the box is touched; the caller
// refreshes the row after, which is what shows the apps
#[tauri::command]
pub async fn apply_server_setup(
    id: String,
    dir: Option<String>,
    names: Vec<String>,
    app: tauri::AppHandle,
) -> Result<usize, AppError> {
    let server = {
        let h = app.state::<AppState>();
        let s = h.servers_store.lock().map_err(lock_err)?.get(&id);
        s.ok_or_else(|| AppError::ServerNotFound(id.clone()))?
    };
    let dir = dir.unwrap_or_else(|| server_setup::DIR.to_string());
    server_setup::check_dir(&dir).map_err(AppError::SetupRefused)?;
    let known: Vec<String> = server_setup::bundled()
        .iter()
        .filter(|b| names.contains(&b.name.to_string()))
        .map(|b| b.name.to_string())
        .collect();
    if known.is_empty() {
        return Err(AppError::SetupRefused(
            "Nothing to install: every file is already on the box".into(),
        ));
    }
    let line = server_setup::put_command(&dir, &known);
    let input = server_setup::put_input(&known);
    tauri::async_runtime::spawn_blocking(move || {
        server_folders::put_remote(&server, &line, &input)
    })
    .await
    .map_err(lock_err)?
    .map_err(AppError::LaunchFailed)?;
    Ok(known.len())
}

// the children of one folder: the drill-down, one ssh on the click, cached
// on the server's listing under the path
#[tauri::command]
pub async fn list_server_dir(
    id: String,
    path: String,
    app: tauri::AppHandle,
) -> Result<Vec<RemoteFolder>, AppError> {
    let server = {
        let h = app.state::<AppState>();
        let s = h.servers_store.lock().map_err(lock_err)?.get(&id);
        s.ok_or_else(|| AppError::ServerNotFound(id.clone()))?
    };
    let p = path.clone();
    let kids = tauri::async_runtime::spawn_blocking(move || {
        server_folders::list_dir(&server, &p)
    })
    .await
    .map_err(lock_err)?
    .map_err(AppError::LaunchFailed)?;
    let state = app.state::<AppState>();
    let mut cache = state.servers_cache.lock().map_err(lock_err)?;
    let mut listing = cache.all().remove(&id).unwrap_or_default();
    listing.subdirs.insert(path, kids.clone());
    cache.store(&id, listing)?;
    Ok(kids)
}

// a root on a server's row, from the menu or a folder promoted to one. an
// empty roots list means the defaults, so they are written out first
#[tauri::command]
pub fn add_server_root(
    id: String,
    root: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let mut store = state.servers_store.lock().map_err(lock_err)?;
    let mut server = store
        .get(&id)
        .ok_or_else(|| AppError::ServerNotFound(id.clone()))?;
    let root = root.trim().trim_end_matches('/').to_string();
    if root.is_empty() {
        return Err(AppError::RootRefused("A root is a path".into()));
    }
    if server.roots.is_empty() {
        server.roots = server_folders::DEFAULT_ROOTS
            .iter()
            .map(|r| r.to_string())
            .collect();
    }
    if !server.roots.contains(&root) {
        server.roots.push(root);
    }
    store.update(server)
}

// the pin's inverse, from the heading's menu. before it the only way
// back was the edit form's roots box
#[tauri::command]
pub fn remove_server_root(
    id: String,
    root: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let mut store = state.servers_store.lock().map_err(lock_err)?;
    let mut server = store
        .get(&id)
        .ok_or_else(|| AppError::ServerNotFound(id.clone()))?;
    server.roots = server_folders::without_root(&server, &root);
    store.update(server)
}

// a terminal in a remote folder: a tmux session named after the folder
#[tauri::command]
pub fn open_server_folder(
    id: String,
    path: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let server = state
        .servers_store
        .lock()
        .map_err(lock_err)?
        .get(&id)
        .ok_or_else(|| AppError::ServerNotFound(id.clone()))?;
    let stand_in = home_stand_in(&server.name);
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let terminal = resolve_target(&state, TargetKind::Terminal, None)?;
    let line = server_folders::folder_terminal_command(&server, &path);
    launcher::launch_with_command(&terminal, &stand_in, &info, &line)
}

// a remote folder in vs code (remote-ssh) or zed (ssh://). both use the
// system ssh, so the alias resolves
#[tauri::command]
pub fn open_server_folder_in(
    id: String,
    path: String,
    editor: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let server = state
        .servers_store
        .lock()
        .map_err(lock_err)?
        .get(&id)
        .ok_or_else(|| AppError::ServerNotFound(id.clone()))?;
    let (exe, args) = match editor.as_str() {
        "vscode" => {
            ("code", server_folders::vscode_remote_args(&server, &path))
        }
        "zed" => ("zed", server_folders::zed_remote_url(&server, &path)),
        other => return Err(AppError::TargetNotFound(other.to_string())),
    };
    // the launcher's own door: the platform shell, the template's quoting
    // kept, and a missing code comes back as TargetNotInstalled
    launcher::spawn_raw(exe, &args)
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
    /// The two kinds that arrived later, `serde(default)` for the same
    /// reason scan_config has it. A default nobody wrote down here travels
    /// in neither direction, silently, so every kind is listed and
    /// `defaults()` is what import reads - one place to add the next one.
    #[serde(default)]
    pub default_agent: Option<String>,
    #[serde(default)]
    pub default_file_manager: Option<String>,
    pub summon_hotkey: String,
    // a missing field is a hard parse error, so a file exported before a
    // field existed would not import at all; scan_config had that bug since
    // it landed
    #[serde(default)]
    pub scan_config: crate::services::preferences::ScanConfig,
    #[serde(default)]
    pub tmux_config: crate::services::preferences::TmuxConfig,
}

impl PortableConfig {
    /// Every default the file carries, paired with its kind.
    fn defaults(&self) -> [(TargetKind, Option<String>); 4] {
        [
            (TargetKind::Editor, self.default_editor.clone()),
            (TargetKind::Terminal, self.default_terminal.clone()),
            (TargetKind::Agent, self.default_agent.clone()),
            (TargetKind::FileManager, self.default_file_manager.clone()),
        ]
    }
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
            default_agent: prefs.default_target(TargetKind::Agent),
            default_file_manager: prefs.default_target(TargetKind::FileManager),
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
    let wanted = config.defaults();
    let defaults: Vec<(TargetKind, String)> = {
        let mut store = state.target_store.lock().map_err(lock_err)?;
        for t in config.targets {
            if store.get(&t.id).is_none() {
                let _ = store.add(t);
            }
        }
        // a default only for a target that exists here now
        wanted
            .into_iter()
            .filter_map(|(kind, id)| {
                Some((kind, id.filter(|id| store.get(id).is_some())?))
            })
            .collect()
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
        for (kind, id) in defaults {
            prefs
                .set_default_target(kind, &id)
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

/// Open the folder in a file manager, with it selected in its parent where
/// that is a thing the manager can do. The command keeps its name; the
/// frontend relabels the button, not the door. `target_id` picks one file
/// manager - the menu offers each registered one - and None takes the
/// default. Works for WSL projects too: the UNC path is what Explorer
/// wants. Boots the distro, but the user asked.
#[tauri::command]
pub fn reveal_in_explorer(
    path: String,
    target_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    reveal_path(&state, &path, true, target_id)
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

/// The 14-day traffic of one GitHub row, the numbers only its owner is
/// shown: three gh api calls on the click, never in a pass, and the
/// answer kept for the session. A second look inside the hour is served
/// from github_traffic; force, or an older answer, asks again.
#[tauri::command]
pub async fn get_repo_traffic(
    full_name: String,
    force: bool,
    state: State<'_, AppState>,
) -> Result<github::Traffic, AppError> {
    let now = crate::services::preferences::now_secs();
    if !force {
        if let Some(cached) = state
            .github_traffic
            .lock()
            .map_err(lock_err)?
            .get(&full_name)
        {
            if !github::traffic_is_stale(cached.fetched_at, now) {
                return Ok(cached.clone());
            }
        }
    }
    let key = full_name.clone();
    let traffic = tauri::async_runtime::spawn_blocking(move || {
        github::traffic(&key, now)
    })
    .await
    .map_err(|e| AppError::Lock(e.to_string()))??;
    state
        .github_traffic
        .lock()
        .map_err(lock_err)?
        .insert(full_name, traffic.clone());
    Ok(traffic)
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

/// Where the runtime log is, so the frontend can say the path and - on
/// this branch, which is about revealing files in a file manager - later
/// hand it to `reveal_path`. No UI here, only the answer.
///
/// `runtime_log::log_path()` is the truth; the fallback covers the case
/// where setup has not run `init`, which no running app can be in, and
/// keeps the command from having to return an error nobody can act on.
#[tauri::command]
pub fn get_log_path(state: State<AppState>) -> String {
    if let Some(path) = crate::services::runtime_log::log_path() {
        return path.to_string_lossy().into_owned();
    }
    std::path::Path::new(&get_app_data_dir(state))
        .join(crate::services::runtime_log::FILE_NAME)
        .to_string_lossy()
        .into_owned()
}

/// The same folder, in the file manager.
#[tauri::command]
pub fn reveal_app_data_dir(state: State<AppState>) -> Result<(), AppError> {
    // the folder itself, never selected in its parent: nobody asked to see
    // where roaming keeps its subdirectories
    let dir = get_app_data_dir(state.clone());
    reveal_path(&state, &dir, false, None)
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
    /// full_name to local project path, for every row cloned here. Over
    /// the projects listed right now, with the remote the last badge pass
    /// read; the frontend re-reads after every pass, either kind
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
        // the projects cache is what every pass just wrote, a deleted
        // folder gone from it; the git cache alone remembered that folder
        // until the next launch, and its row kept the mark
        let listed = state.cache_store.lock().map_err(lock_err)?.all_projects();
        let git = state.git_cache.lock().map_err(lock_err)?;
        github::local_matches(
            &cache.repos,
            github::current_remotes(&listed, &git),
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
pub async fn get_github_status() -> GhStatus {
    // two gh spawns, never on the main thread
    tauri::async_runtime::spawn_blocking(github::status)
        .await
        .unwrap_or_default()
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

#[tauri::command]
pub fn get_show_server_details(
    state: State<AppState>,
) -> Result<bool, AppError> {
    Ok(state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .show_server_details())
}

// settings and the row menu flip the same flag; the stored value comes
// back so both show what the file says
#[tauri::command]
pub fn set_show_server_details(
    on: bool,
    state: State<AppState>,
) -> Result<bool, AppError> {
    let mut prefs = state.pref_store.lock().map_err(lock_err)?;
    prefs.set_show_server_details(on).map_err(AppError::Lock)?;
    Ok(prefs.show_server_details())
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
    // a workspace, or a folder the picker chose. the folder is probed
    // after the liveness gate below, so a stopped distro is never booted
    let listed = state
        .workspace_store
        .lock()
        .map_err(lock_err)?
        .list()
        .contains(&workspace);
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
    if !listed {
        clone::folder_ok(&workspace)?;
    }

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

/// What the machine is: its own file system's name and whether wsl is
/// there at all. The cached probe, so it costs a lock and a clone; the
/// forced refresh is what re-reads it.
#[tauri::command]
pub fn get_runtime_info(
    state: State<AppState>,
) -> Result<RuntimeInfo, AppError> {
    Ok(state.runtime_info.lock().map_err(lock_err)?.clone())
}

/// Is the VM up, and which distros are running. One process-table look
/// and one management call that boots nothing. Asked at mount and on
/// focus; between those the watcher's `devgo://wsl` event carries the
/// same shape.
#[tauri::command]
pub async fn get_wsl_state() -> wsl_watch::WslState {
    // through the memo, so the chip and the scan share one wsl.exe at
    // mount instead of two, and off the main thread: a wsl.exe spawn is
    // half a second the first paint should not wait behind
    tauri::async_runtime::spawn_blocking(wsl_watch::current)
        .await
        .unwrap_or_else(|_| wsl_watch::WslState {
            up: false,
            distros: Vec::new(),
        })
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

// whether this window was born see-through (lib.rs setup). a knob moved
// above 0 on a window born opaque is stored but shows only at the next
// launch; the appearance panel says so instead of looking broken
#[tauri::command]
pub fn window_launched_transparent() -> bool {
    crate::launched_transparent()
}

// windows' own transparency effects switch. off, and the os draws no
// blur: the ground turns black instead of see-through, which reads as a
// devgo bug. Some(false) is the answer worth a note; None when the key
// cannot be read and the note stays quiet. read on the appearance page
// only, never at startup
#[tauri::command]
pub fn os_transparency_effects_enabled() -> Option<bool> {
    #[cfg(windows)]
    {
        let out = std::process::Command::new("reg")
            .quiet()
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                "/v",
                "EnableTransparency",
            ])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let line = text.lines().find(|l| l.contains("EnableTransparency"))?;
        let word = line.split_whitespace().last()?;
        Some(word != "0x0")
    }
    #[cfg(not(windows))]
    {
        None
    }
}

// the window is the preview when it was born see-through: every change
// is applied and persisted by this one call, which hands back the
// clamped value for the stepper
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

    /// A portable config carries one default per kind, and `defaults()` is
    /// the single list import walks: a kind missing from it travels in
    /// neither direction and nothing says so. The agent's default did
    /// exactly that until the file manager arrived beside it.
    #[test]
    fn a_portable_config_round_trips_every_default() {
        let config = PortableConfig {
            workspaces: vec![r"G:\01_tauri".to_string()],
            targets: crate::models::target::defaults(),
            default_editor: Some("cursor".into()),
            default_terminal: Some("wt".into()),
            default_agent: Some("claude".into()),
            default_file_manager: Some("trove".into()),
            summon_hotkey: "Alt+Space".into(),
            scan_config: Default::default(),
            tmux_config: Default::default(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let back: PortableConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back.defaults(),
            [
                (TargetKind::Editor, Some("cursor".to_string())),
                (TargetKind::Terminal, Some("wt".to_string())),
                (TargetKind::Agent, Some("claude".to_string())),
                (TargetKind::FileManager, Some("trove".to_string())),
            ]
        );
        let kinds: Vec<TargetKind> =
            back.defaults().into_iter().map(|(k, _)| k).collect();
        assert_eq!(kinds, TargetKind::ALL.to_vec(), "every kind travels");

        // and a file exported before the two later fields still imports,
        // which is why they carry serde(default)
        let old: PortableConfig = serde_json::from_str(
            r#"{"workspaces":[],"targets":[],"default_editor":"vscode",
                "default_terminal":null,"summon_hotkey":"Alt+Space"}"#,
        )
        .unwrap();
        assert_eq!(old.default_editor.as_deref(), Some("vscode"));
        assert_eq!(old.default_file_manager, None);
        assert_eq!(old.default_agent, None);
    }

    // the seeded file manager of this platform, which is what reveal goes
    // through now instead of a program name written into this file. None
    // only on a linux box with no manager on PATH at all, the same machine
    // that is seeded no terminal
    fn file_manager() -> Option<LaunchTarget> {
        crate::models::target::defaults()
            .into_iter()
            .find(|t| t.kind == TargetKind::FileManager)
    }

    // the reveal twin of the seeded-terminal regression in target_store:
    // reveal was cfg(not(windows)) until 2026-09-25, so a linux box ran
    // `open -R <path>`, and `open` on linux is xdg-open, which rejects -R
    // and left the reveal key doing nothing at all. it must never be a
    // switch xdg-open refuses, and the empty reveal template is how that
    // is said now: no linux manager can select an item, so the select
    // shape opens the containing folder
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_reveals_through_its_file_manager_and_never_with_r() {
        let Some(fm) = file_manager() else {
            return; // no manager on PATH: the box is seeded no row
        };
        assert_ne!(fm.executable, "open", "the mac door");
        assert!(fm.reveal_args_template.is_none(), "no select verb here");

        let (program, args) =
            reveal_line(&fm, "/home/user/work/app", true).unwrap();
        assert_eq!(program, fm.executable);
        assert_eq!(
            args, "\"/home/user/work\"",
            "the containing folder: linux cannot highlight an item"
        );
        let (_, args) = reveal_line(&fm, "/home/user/work/app", false).unwrap();
        assert_eq!(args, "\"/home/user/work/app\"");
    }

    // -R belongs to finder alone, and only to the select shape
    #[cfg(target_os = "macos")]
    #[test]
    fn a_mac_reveals_with_open_dash_r() {
        let fm = file_manager().expect("a mac is seeded finder");
        let (program, args) =
            reveal_line(&fm, "/Users/user/app", true).unwrap();
        assert_eq!(program, "open");
        assert_eq!(args, "-R \"/Users/user/app\"");
        let (_, args) = reveal_line(&fm, "/Users/user/app", false).unwrap();
        assert_eq!(args, "-a Finder \"/Users/user/app\"");
    }

    // explorer has no select switch a unc path survives, so both shapes
    // open the folder itself - and the path stays inside the quotes the
    // template puts round it, which the old bare Command::args did for it
    #[cfg(windows)]
    #[test]
    fn windows_reveals_the_folder_itself_either_way() {
        let fm = file_manager().expect("windows is seeded explorer");
        let unc = r"\\wsl.localhost\Ubuntu\home\user\my app";
        let (program, args) = reveal_line(&fm, unc, true).unwrap();
        assert_eq!(program, "explorer");
        assert_eq!(args, format!("\"{unc}\""));
        assert_eq!(
            reveal_line(&fm, unc, false).unwrap().1,
            format!("\"{unc}\"")
        );
    }

    // a manager with no reveal template - every linux one, and a hand-added
    // trove - opens the parent folder instead of being refused
    #[test]
    fn a_manager_with_no_reveal_template_opens_the_parent() {
        let fm = LaunchTarget {
            id: "trove".into(),
            name: "Trove".into(),
            kind: TargetKind::FileManager,
            executable: "trove".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        let (exe, args) = reveal_line(&fm, "/srv/work/app", true).unwrap();
        assert_eq!(exe, "trove");
        assert_eq!(args, "\"/srv/work\"");
    }

    // the word that lands in "Install it on {os}"; it read Windows on a
    // linux box while this was cfg(not(target_os = "macos"))
    #[test]
    fn the_local_os_is_this_machine_s_own_name() {
        #[cfg(target_os = "linux")]
        assert_eq!(LOCAL_OS, "Linux");
        #[cfg(target_os = "macos")]
        assert_eq!(LOCAL_OS, "macOS");
        #[cfg(windows)]
        assert_eq!(LOCAL_OS, "Windows");
    }

    // ~/Library/Logs is a mac folder; linux keeps its state under XDG
    #[cfg(target_os = "linux")]
    #[test]
    fn the_startup_log_dir_is_never_a_mac_library_folder() {
        if let Some(dir) = startup_log_dir() {
            let dir = dir.to_string_lossy().into_owned();
            assert!(!dir.contains("Library"), "{dir}");
            assert!(dir.ends_with("DevGo"), "{dir}");
        }
    }

    /// Move or delete a project and it stays on screen until the next
    /// scan. Shift+enter on that row opened a tmux session in the home
    /// directory and said nothing at all — the wrong place, silently.
    /// Found on linux with a real keypress.
    #[test]
    fn a_project_whose_folder_is_gone_is_refused_by_name_and_path() {
        let dir = temp("missing-project");
        let here = Project::new(
            "here".into(),
            dir.to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
            LOCAL_FS.into(),
        );
        assert!(require_project_dir(&here).is_ok());

        let gone_path = dir.join("deleted-yesterday");
        let gone = Project::new(
            "gone".into(),
            gone_path.to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
            LOCAL_FS.into(),
        );
        let err = require_project_dir(&gone).unwrap_err();
        let AppError::ProjectMissing(ref name, ref path) = err else {
            panic!("expected ProjectMissing, got {err:?}");
        };
        assert_eq!(name, "gone");
        assert_eq!(path, &gone_path.to_string_lossy().into_owned());
        // the toast has to name the folder, or "it was moved" is a riddle
        assert!(err.to_string().contains("deleted-yesterday"), "{err}");

        // a file where the folder was is not a project either
        std::fs::write(&gone_path, "").unwrap();
        assert!(matches!(
            require_project_dir(&gone),
            Err(AppError::ProjectMissing(..))
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A WSL project is never asked. Reading a path inside a stopped
    /// distro is what boots it, and DevGo boots one because you launched,
    /// never because it wondered — so the check has to skip these whether
    /// or not the distro exists at all.
    #[test]
    fn a_wsl_project_is_not_stat_ed_and_not_refused() {
        for path in [
            r"\\wsl.localhost\Ubuntu\home\user\work\api",
            r"\\wsl$\Debian\home\user\work\api",
        ] {
            let p = Project::new(
                "api".into(),
                path.into(),
                path.into(),
                "WSL".into(),
            );
            assert!(require_project_dir(&p).is_ok(), "{path}");
        }
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
