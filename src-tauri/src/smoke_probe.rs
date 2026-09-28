//! `DevGo --smoke-probe <verb> ...`: the hidden, windowless mode
//! `scripts/smoke.mjs` asks questions through, so the smoke test reads the
//! app's own answers instead of a JavaScript copy of them that could drift.
//!
//! Handled in `main` before anything of tauri starts: no window, no tray, no
//! single-instance handshake, no log line. It prints one JSON object on
//! stdout and exits. It never writes the user's app data: the target store
//! is loaded from a copy, so its startup migrations run on the copy and
//! what they would have changed is the answer, not a side effect.
//!
//!   --smoke-probe version
//!   --smoke-probe runtime --data-dir <dir>
//!   --smoke-probe stale --data-dir <dir>
//!   --smoke-probe run   --data-dir <dir> --project <path>

use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::models::target::TargetKind;
use crate::models::Project;
use crate::services::platform::detection;
use crate::services::{
    detect, launcher, scanner, scripts, target_store::TargetStore,
    PreferencesStore,
};

/// `Some(exit code)` when argv asked for the probe, `None` otherwise - the
/// normal launch path never pays more than one argv scan.
pub fn from_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("--smoke-probe") {
        return None;
    }
    let (code, out) = match answer(&args[1..]) {
        Ok(v) => (0, v),
        Err(e) => (2, json!({ "error": e })),
    };
    let mut stdout = std::io::stdout();
    let _ = writeln!(stdout, "{out}");
    let _ = stdout.flush();
    Some(code)
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn answer(args: &[String]) -> Result<Value, String> {
    let verb = args.first().map(String::as_str).unwrap_or("");
    let data_dir = || {
        flag(args, "--data-dir")
            .map(PathBuf::from)
            .ok_or_else(|| "--data-dir <dir> is required".to_string())
    };
    match verb {
        "version" => Ok(json!({
            "version": env!("CARGO_PKG_VERSION"),
            "sha": env!("DEVGO_GIT_SHA"),
        })),
        // the runtime the app launches with: prefs' cached copy, detected
        // only when there is none, and never saved from here
        "runtime" => {
            let prefs = PreferencesStore::new(data_dir()?)?;
            let info = prefs
                .get_cached_runtime()
                .unwrap_or_else(detection::detect_runtime);
            serde_json::to_value(info).map_err(|e| e.to_string())
        }
        "stale" => {
            let (_store, pending) = store_copy(&data_dir()?)?;
            Ok(json!({ "pending": pending }))
        }
        "run" => {
            let project = flag(args, "--project")
                .ok_or("--project <path> is required")?;
            run(&data_dir()?, &project)
        }
        other => Err(format!(
            "unknown probe verb {other:?} (version, runtime, stale, run)"
        )),
    }
}

/// The target store as the app would hold it after its startup migrations,
/// loaded from a copy of targets.json so the real file is never written.
/// The second value names each migration that fired on the copy - by the
/// backup suffix it wrote - which is every migration the real file is
/// still waiting for.
fn store_copy(data_dir: &Path) -> Result<(TargetStore, Vec<String>), String> {
    let real = data_dir.join("targets.json");
    if !real.exists() {
        return Err(format!("{} does not exist", real.display()));
    }
    let tmp = std::env::temp_dir()
        .join(format!("devgo-smoke-probe-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let result = (|| {
        std::fs::copy(&real, tmp.join("targets.json"))
            .map_err(|e| e.to_string())?;
        let store = TargetStore::new(tmp.clone()).map_err(|e| e.to_string())?;
        let mut pending: Vec<String> = std::fs::read_dir(&tmp)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter_map(|n| n.strip_prefix("targets.json.").map(String::from))
            .collect();
        pending.sort();
        Ok((store, pending))
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

/// What the dev menu would run for this project, through the same pieces
/// `get_project_scripts` and `run_script` use: stack detection for the
/// package manager, `scripts::for_project` for the menu entries, the
/// default terminal the way `resolve_target` picks it, and the launcher's
/// own line builder. Nothing is spawned but the listing and package.json
/// read the menu itself does.
fn run(data_dir: &Path, full_path: &str) -> Result<Value, String> {
    let (store, _) = store_copy(data_dir)?;
    let prefs = PreferencesStore::new(data_dir.to_path_buf())?;
    let info = prefs
        .get_cached_runtime()
        .unwrap_or_else(detection::detect_runtime);
    let terminal = prefs
        .default_target(TargetKind::Terminal)
        .and_then(|id| store.get(&id))
        .or_else(|| store.first_of(TargetKind::Terminal))
        .ok_or("no terminal target is registered")?;

    let distro = scanner::distro_of(full_path);
    let path = Path::new(full_path);
    let project = Project::new(
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "smoke".into()),
        full_path.to_string(),
        path.parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        distro
            .clone()
            .unwrap_or_else(|| scanner::LOCAL_FS.to_string()),
    );
    let running = match &distro {
        Some(_) => crate::services::platform::wsl::running_distros(),
        None => Vec::new(),
    };
    let tech = detect::collect(std::slice::from_ref(&project), &running);
    let found = tech.iter().find(|t| t.full_path == project.full_path);
    let tags: Vec<String> = found
        .map(|t| t.tags.iter().map(|s| s.to_string()).collect())
        .unwrap_or_default();
    let pm = found.and_then(|t| t.package_manager);
    let list = scripts::for_project(&project, &tags, pm, &running);

    let line = |command: &str| -> Value {
        match launcher::run_line_parts(&terminal, &project, &info, command) {
            Ok((exe, args, script)) => json!({
                "command": command, "exe": exe, "args": args, "script": script,
            }),
            Err(e) => json!({ "command": command, "error": e.to_string() }),
        }
    };
    let entries: Vec<Value> = list
        .install
        .iter()
        .chain(list.scripts.iter())
        .map(|s| {
            let mut v = line(&s.command);
            v["name"] = json!(s.name);
            v
        })
        .collect();

    Ok(json!({
        "terminal": terminal.id,
        "distro": distro,
        "default_distro": info.default_distro,
        "package_manager": pm,
        "reason": list.reason,
        "entries": entries,
    }))
}
