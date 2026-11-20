//! "My stack": the user's own apps, started, stopped and watched from one
//! small window. Pure parts here (the list on disk, `%VAR%` expansion, name
//! matching, the process snapshot); the window and the commands live in
//! `crate::stack`.
//!
//! The list is `stack.json` in DevGo's data folder. A startup script outside
//! DevGo reads the same file, so the shape is plain on purpose: name,
//! process, path, args, delay. `delay` is "seconds after sign-in" and only
//! that script uses it; the window starts things 2 s apart.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::config_io::parse_or_backup;
use super::platform::Quiet;

pub const FILE: &str = "stack.json";
/// how long Stop waits for an app to close itself before killing it
pub const GRACE: Duration = Duration::from_secs(5);
/// the gap between two apps in "Start all"
pub const START_GAP: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StackApp {
    pub name: String,
    /// the exe name without `.exe`, compared without case
    pub process: String,
    /// may hold `%VAR%`, expanded when it is used
    pub path: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// seconds after sign-in; read by the startup script only
    #[serde(default)]
    pub delay: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StackFile {
    #[serde(default)]
    pub apps: Vec<StackApp>,
}

/// One row as the window shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub name: String,
    pub running: bool,
    /// DevGo's own row: it cannot stop or start itself
    pub is_self: bool,
    /// the expanded path does not exist, so Start cannot work
    pub missing: bool,
    /// seconds since its oldest process started; only when asked for detail
    pub uptime_secs: Option<u64>,
    /// working set of its processes and their children; only with detail
    pub mem_bytes: Option<u64>,
}

/// One process in a snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proc {
    pub pid: u32,
    pub parent: u32,
    /// normalized: lower case, no `.exe`
    pub name: String,
}

pub fn file_in(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

/// A missing file is an empty stack; a broken one is kept as `.bak`.
pub fn load(dir: &Path) -> StackFile {
    let path = file_in(dir);
    match std::fs::read_to_string(&path) {
        Ok(data) => parse_or_backup(&path, &data),
        Err(_) => StackFile::default(),
    }
}

pub fn save(dir: &Path, file: &StackFile) -> Result<(), String> {
    validate(file)?;
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(file_in(dir), json + "\n").map_err(|e| e.to_string())
}

pub fn validate(file: &StackFile) -> Result<(), String> {
    for (i, app) in file.apps.iter().enumerate() {
        let row = i + 1;
        if app.name.trim().is_empty() {
            return Err(format!("row {row} has no name"));
        }
        if app.path.trim().is_empty() {
            return Err(format!("{} has no path", app.name));
        }
        if normalize(&app.process).is_empty() {
            return Err(format!("{} has no process name", app.name));
        }
    }
    Ok(())
}

/// `%NAME%` replaced by the variable; an unknown one is left as written, so
/// the "missing" mark shows the path the user typed.
pub fn expand(raw: &str) -> String {
    expand_with(raw, |k| std::env::var(k).ok())
}

fn expand_with(raw: &str, var: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let key = &after[..end];
                match var(key) {
                    Some(v) => out.push_str(&v),
                    None => {
                        out.push('%');
                        out.push_str(key);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// `DevGo.exe`, `devgo`, `/usr/bin/devgo` all become `devgo`.
pub fn normalize(name: &str) -> String {
    let base = name.trim().rsplit(['/', '\\']).next().unwrap_or("");
    let lower = base.to_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

/// The process name of DevGo itself, normalized.
pub fn own_name() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .map(|n| normalize(&n))
        .unwrap_or_default()
}

/// Every running process. One snapshot call on Windows, so a poll spawns
/// nothing.
pub fn snapshot() -> Vec<Proc> {
    imp::snapshot()
}

pub fn pids_of(snap: &[Proc], process: &str) -> Vec<u32> {
    let want = normalize(process);
    snap.iter()
        .filter(|p| p.name == want)
        .map(|p| p.pid)
        .collect()
}

/// One row per app. `detail` adds uptime and memory, which open each
/// running process; the pill does not show them, so it does not ask.
pub fn status(file: &StackFile, snap: &[Proc], detail: bool) -> Vec<AppStatus> {
    let me = own_name();
    file.apps
        .iter()
        .map(|a| {
            let pids = pids_of(snap, &a.process);
            let (uptime_secs, mem_bytes) = if detail {
                super::stack_facts::usage(snap, &pids)
            } else {
                (None, None)
            };
            AppStatus {
                name: a.name.clone(),
                running: !pids.is_empty(),
                is_self: !me.is_empty() && normalize(&a.process) == me,
                missing: !Path::new(&expand(&a.path)).exists(),
                uptime_secs,
                mem_bytes,
            }
        })
        .collect()
}

/// Start one app unless it already runs. `Ok(false)` = it was running.
pub fn start(app: &StackApp) -> Result<bool, String> {
    if !pids_of(&snapshot(), &app.process).is_empty() {
        return Ok(false);
    }
    let path = PathBuf::from(expand(&app.path));
    if !path.exists() {
        return Err(format!("{}: {} does not exist", app.name, path.display()));
    }
    let mut cmd = Command::new(&path);
    cmd.args(app.args.iter().map(|a| expand(a))).quiet();
    if let Some(dir) = path.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn()
        .map(|_| true)
        .map_err(|e| format!("{}: {e}", app.name))
}

/// Ask every process of the app to close, wait up to [`GRACE`], then kill
/// what is left. Refuses DevGo's own row: stopping it from its own window
/// would close the window mid-click. `Ok(true)` = the kill step was needed.
pub fn stop(app: &StackApp) -> Result<bool, String> {
    if normalize(&app.process) == own_name() {
        return Err(format!(
            "{} is DevGo itself; quit it from the tray",
            app.name
        ));
    }
    let pids = pids_of(&snapshot(), &app.process);
    for pid in &pids {
        imp::ask_to_close(*pid);
    }
    let until = Instant::now() + GRACE;
    while Instant::now() < until {
        if pids_of(&snapshot(), &app.process).is_empty() {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    let left = pids_of(&snapshot(), &app.process);
    for pid in &left {
        imp::kill(*pid);
    }
    Ok(!left.is_empty())
}

/// Start the stopped apps in list order, [`START_GAP`] apart. Returns the
/// names it started; a failure is reported and the rest still start.
pub fn start_all(file: &StackFile) -> (Vec<String>, Vec<String>) {
    let mut started = Vec::new();
    let mut failed = Vec::new();
    for app in &file.apps {
        match start(app) {
            Ok(true) => {
                started.push(app.name.clone());
                std::thread::sleep(START_GAP);
            }
            Ok(false) => {}
            Err(e) => failed.push(e),
        }
    }
    (started, failed)
}

/// Stop every running app except DevGo, all at once (each has its own
/// grace period, so three apps take 5 s, not 15). Returns the names that
/// were stopped and the errors.
pub fn stop_all(file: &StackFile) -> (Vec<String>, Vec<String>) {
    let me = own_name();
    let snap = snapshot();
    let targets: Vec<&StackApp> = file
        .apps
        .iter()
        .rev()
        .filter(|a| normalize(&a.process) != me)
        .filter(|a| !pids_of(&snap, &a.process).is_empty())
        .collect();
    let results: Vec<(String, Result<bool, String>)> =
        std::thread::scope(|s| {
            let handles: Vec<_> = targets
                .iter()
                .map(|a| s.spawn(move || (a.name.clone(), stop(a))))
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
    let mut stopped = Vec::new();
    let mut failed = Vec::new();
    for (name, r) in results {
        match r {
            Ok(_) => stopped.push(name),
            Err(e) => failed.push(e),
        }
    }
    (stopped, failed)
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::process::Command;

    use super::{normalize, Proc};
    use crate::services::platform::Quiet;

    #[repr(C)]
    struct ProcessEntry32W {
        size: u32,
        usage: u32,
        pid: u32,
        default_heap_id: usize,
        module_id: u32,
        threads: u32,
        parent_pid: u32,
        pri_class_base: i32,
        flags: u32,
        exe_file: [u16; 260],
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> *mut c_void;
        fn Process32FirstW(
            snap: *mut c_void,
            entry: *mut ProcessEntry32W,
        ) -> i32;
        fn Process32NextW(
            snap: *mut c_void,
            entry: *mut ProcessEntry32W,
        ) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    const TH32CS_SNAPPROCESS: u32 = 0x2;

    pub fn snapshot() -> Vec<Proc> {
        let mut out = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap.is_null() || snap as isize == -1 {
                return out;
            }
            let mut e: ProcessEntry32W = std::mem::zeroed();
            e.size = std::mem::size_of::<ProcessEntry32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut e);
            while ok != 0 {
                let len =
                    e.exe_file.iter().position(|&c| c == 0).unwrap_or(260);
                let name = String::from_utf16_lossy(&e.exe_file[..len]);
                out.push(Proc {
                    pid: e.pid,
                    parent: e.parent_pid,
                    name: normalize(&name),
                });
                ok = Process32NextW(snap, &mut e);
            }
            CloseHandle(snap);
        }
        out
    }

    /// taskkill without /F posts WM_CLOSE to the process's windows
    pub fn ask_to_close(pid: u32) {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string()])
            .quiet()
            .output();
    }

    pub fn kill(pid: u32) {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .quiet()
            .output();
    }
}

#[cfg(not(windows))]
mod imp {
    use std::process::Command;

    use super::{normalize, Proc};
    use crate::services::platform::Quiet;

    pub fn snapshot() -> Vec<Proc> {
        let Ok(out) = Command::new("ps")
            .args(["-axo", "pid=,ppid=,comm="])
            .quiet()
            .output()
        else {
            return Vec::new();
        };
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|l| {
                let (pid, rest) = l.trim().split_once(' ')?;
                let (parent, name) = rest.trim_start().split_once(' ')?;
                Some(Proc {
                    pid: pid.parse().ok()?,
                    parent: parent.parse().ok()?,
                    name: normalize(name.trim_start()),
                })
            })
            .collect()
    }

    pub fn ask_to_close(pid: u32) {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .quiet()
            .output();
    }

    pub fn kill(pid: u32) {
        let _ = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .quiet()
            .output();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, process: &str, path: &str) -> StackApp {
        StackApp {
            name: name.into(),
            process: process.into(),
            path: path.into(),
            args: vec![],
            delay: 0,
        }
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir()
            .join(format!("devgo-stack-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn percent_variables_expand_and_unknown_ones_stay_as_typed() {
        let var = |k: &str| {
            (k == "LOCALAPPDATA")
                .then(|| r"C:\Users\a\AppData\Local".to_string())
        };
        assert_eq!(
            expand_with(r"%LOCALAPPDATA%\DevGo\DevGo.exe", var),
            r"C:\Users\a\AppData\Local\DevGo\DevGo.exe"
        );
        assert_eq!(expand_with(r"%NOPE%\x", var), r"%NOPE%\x");
        assert_eq!(expand_with("100% sure", var), "100% sure");
        assert_eq!(expand_with("%%", var), "%%");
        assert_eq!(expand_with("plain", var), "plain");
    }

    #[test]
    fn process_names_match_without_case_path_or_exe() {
        assert_eq!(normalize("DevGo.exe"), "devgo");
        assert_eq!(normalize(r"C:\x\Desk-Monitor.EXE"), "desk-monitor");
        assert_eq!(normalize("/usr/bin/devgo"), "devgo");
        let p = |pid, name: &str| Proc {
            pid,
            parent: 0,
            name: name.into(),
        };
        let snap = vec![p(1, "voice-app"), p(2, "devgo"), p(3, "voice-app")];
        assert_eq!(pids_of(&snap, "Voice-App.exe"), vec![1, 3]);
        assert!(pids_of(&snap, "desk-monitor").is_empty());
    }

    #[test]
    fn the_startup_scripts_file_shape_parses() {
        let json = r#"{ "apps": [
            { "name": "voice-app", "process": "voice-app",
              "path": "%LOCALAPPDATA%\\Programs\\voice-app\\voice-app.exe", "delay": 10 } ] }"#;
        let f: StackFile = serde_json::from_str(json).unwrap();
        assert_eq!(f.apps.len(), 1);
        assert_eq!(f.apps[0].delay, 10);
        assert!(f.apps[0].args.is_empty());
    }

    #[test]
    fn a_missing_file_is_an_empty_stack_and_a_save_round_trips() {
        let dir = tmp("rt");
        assert_eq!(load(&dir), StackFile::default());
        let f = StackFile {
            apps: vec![app("a", "a", "/x/a")],
        };
        save(&dir, &f).unwrap();
        assert_eq!(load(&dir), f);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_broken_file_is_kept_as_bak() {
        let dir = tmp("bak");
        std::fs::write(file_in(&dir), "{ nope").unwrap();
        assert_eq!(load(&dir), StackFile::default());
        assert!(dir.join("stack.json.bak").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_row_without_name_path_or_process_is_refused() {
        for (a, want) in [
            (app(" ", "a", "/a"), "row 1 has no name"),
            (app("a", "a", ""), "a has no path"),
            (app("a", ".exe", "/a"), "a has no process name"),
        ] {
            let e = validate(&StackFile { apps: vec![a] }).unwrap_err();
            assert_eq!(e, want);
        }
    }

    #[test]
    fn the_snapshot_sees_this_test_process() {
        let me = own_name();
        assert!(!me.is_empty());
        let snap = snapshot();
        assert!(
            pids_of(&snap, &me).contains(&std::process::id()),
            "{me} not in a snapshot of {} processes",
            snap.len()
        );
    }

    #[test]
    fn status_marks_a_missing_path_and_devgo_itself() {
        let me = own_name();
        let f = StackFile {
            apps: vec![
                app("me", &me, "/definitely/not/here"),
                app("x", "no-such-proc-xyz", "/nope"),
            ],
        };
        let s = status(&f, &snapshot(), false);
        assert!(s[0].running && s[0].is_self && s[0].missing);
        assert!(!s[1].running && !s[1].is_self);
        assert_eq!((s[0].uptime_secs, s[0].mem_bytes), (None, None));
        #[cfg(windows)]
        {
            let s = status(&f, &snapshot(), true);
            assert!(s[0].uptime_secs.is_some() && s[0].mem_bytes.is_some());
            assert_eq!((s[1].uptime_secs, s[1].mem_bytes), (None, None));
        }
    }

    #[test]
    fn stop_all_never_touches_devgo_itself() {
        let f = StackFile {
            apps: vec![
                app("me", &own_name(), "/x"),
                app("x", "no-such-proc-xyz", "/x"),
            ],
        };
        let (stopped, failed) = stop_all(&f);
        assert!(
            stopped.is_empty() && failed.is_empty(),
            "{stopped:?} {failed:?}"
        );
    }

    #[test]
    fn stop_refuses_devgo_itself() {
        let e = stop(&app("DevGo", &own_name(), "/x")).unwrap_err();
        assert!(e.contains("DevGo itself"), "{e}");
    }

    #[test]
    fn start_refuses_a_path_that_does_not_exist() {
        let e = start(&app("ghost", "no-such-proc-xyz", "/no/such/ghost"))
            .unwrap_err();
        assert!(e.contains("does not exist"), "{e}");
    }
}
