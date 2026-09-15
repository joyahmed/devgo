use serde::Serialize;
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use tauri::State;

use crate::error::AppError;
use crate::models::target::{LaunchTarget, TargetKind};
use crate::models::Project;
use crate::services::detect::{self, ProjectTech};
use crate::services::editors::{self, DetectedTarget};
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
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<ProjectsPayload, AppError> {
    let payload = collect_projects(&state, false)?;
    crate::tray::refresh(&app);
    Ok(payload)
}

/// Explicit user refresh. `force` is the only path allowed to start a stopped
/// distro, and it also re-probes runtime info.
#[tauri::command]
pub fn refresh_projects(
    force: bool,
    app: tauri::AppHandle,
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
    let payload = collect_projects(&state, force)?;
    crate::tray::refresh(&app);
    Ok(payload)
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
