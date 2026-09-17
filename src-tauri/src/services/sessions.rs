//! Which projects have a live multiplexer session right now. The
//! launcher names every tmux (WSL, Mac) and psmux (Windows) session after
//! the project, and a second launch already reattaches; this reads that
//! fact so the row can say it. One `tmux ls` per running distro that owns
//! a project (a stopped one is never started to ask), one `list-sessions`
//! against the local multiplexer when any project is local, never more
//! often than the badge pass.

use std::collections::HashSet;
use std::process::Command;

use crate::error::AppError;
use crate::models::Project;
use crate::services::launcher::session_names;
use crate::services::platform::wsl;
use crate::services::platform::Quiet;
use crate::services::scanner::distro_of;

// with no server tmux ls writes an error to stderr and exits 1, and
// probe_lines ignores the exit status but not stderr
const TMUX_LIST: &str = "tmux ls -F '#S' 2>/dev/null";

// the multiplexer that owns the local filesystem's sessions: psmux on
// windows, native tmux on a mac. both answer the same -F '#S' and
// -t =name forms, so the list and kill code below is shared
#[cfg(windows)]
pub(crate) const LOCAL_MUX: &str = "psmux.exe";
#[cfg(not(windows))]
pub(crate) const LOCAL_MUX: &str = "tmux";

/// The projects, by full_path, that have a live session.
pub fn collect(projects: &[Project], running: &[String]) -> Vec<String> {
    let names = session_names(projects);
    if names.is_empty() {
        return Vec::new();
    }

    let mut distros: HashSet<String> = HashSet::new();
    let mut any_local = false;
    for p in projects {
        match distro_of(&p.full_path) {
            Some(d) if wsl::is_running(&d, running) => {
                distros.insert(d);
            }
            Some(_) => {}
            None => any_local = true,
        }
    }

    let mut live: Vec<String> = Vec::new();
    for distro in distros {
        for session in wsl::probe_lines(&distro, TMUX_LIST) {
            if let Some(path) = names.get(&session) {
                if distro_of(path).as_deref() == Some(distro.as_str()) {
                    live.push(path.clone());
                }
            }
        }
    }
    if any_local {
        for session in local_sessions() {
            if let Some(path) = names.get(&session) {
                if distro_of(path).is_none() {
                    live.push(path.clone());
                }
            }
        }
    }
    live.sort();
    live.dedup();
    live
}

// one name per line. psmux prints nothing and exits 0 with no server
// (psmux 3.3.8); tmux says "no server running" on stderr and exits 1, and
// output() keeps stderr apart, so both read as an empty list. a missing
// multiplexer is an empty list too, never an error
fn local_sessions() -> Vec<String> {
    let Ok(out) = Command::new(LOCAL_MUX)
        .quiet()
        .args(["list-sessions", "-F", "#S"])
        .output()
    else {
        return Vec::new();
    };
    parse_session_lines(&String::from_utf8_lossy(&out.stdout))
}

pub fn parse_session_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Kill the project's session. Refuses a stopped distro rather than
/// booting it: a session in a stopped distro is already gone.
pub fn kill(project: &Project, running: &[String]) -> Result<(), AppError> {
    let name = session_names(std::slice::from_ref(project))
        .into_keys()
        .next()
        .ok_or_else(|| {
            AppError::LaunchFailed("no session name for this project".into())
        })?;
    // = is an exact target, the rule from chapter 26
    let target = format!("={name}");
    match distro_of(&project.full_path) {
        Some(distro) => {
            if !wsl::is_running(&distro, running) {
                return Err(AppError::LaunchFailed(format!(
                    "{distro} is not running, there is no session to kill"
                )));
            }
            let script = format!("tmux kill-session -t '{target}' 2>/dev/null");
            wsl::probe_lines(&distro, &script);
            Ok(())
        }
        None => {
            Command::new(LOCAL_MUX)
                .quiet()
                .args(["kill-session", "-t", &target])
                .output()
                .map_err(|e| {
                    AppError::LaunchFailed(format!("{LOCAL_MUX}: {e}"))
                })?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, full_path: &str) -> Project {
        let fs = if full_path.starts_with("//wsl") {
            "WSL"
        } else {
            crate::services::scanner::LOCAL_FS
        };
        Project::new(name.into(), full_path.into(), String::new(), fs.into())
    }

    #[test]
    fn the_list_script_silences_the_no_server_error() {
        assert!(TMUX_LIST.starts_with("tmux ls -F '#S'"));
        assert!(TMUX_LIST.ends_with("2>/dev/null"), "{TMUX_LIST}");
    }

    #[test]
    fn session_lines_are_trimmed_and_blank_free() {
        assert_eq!(
            parse_session_lines("app-1a2b3c4d\r\n\n  other-00000000  \n"),
            ["app-1a2b3c4d", "other-00000000"]
        );
        assert!(parse_session_lines("").is_empty());
    }

    // no distro is running, so the wsl project cannot have a session, and
    // collect returns before it would spawn wsl.exe for it. the local
    // branch answers with whatever the multiplexer on this box says, which
    // for a path nothing launched is nothing
    #[test]
    fn a_stopped_distro_contributes_nothing_and_is_never_probed() {
        let projects = vec![
            project("app", "//wsl.localhost/Ubuntu/home/user/app"),
            project("tool", "G:/dev/tool"),
        ];
        let live = collect(&projects, &[]);
        assert!(!live.iter().any(|p| p.starts_with("//wsl")), "{live:?}");
    }

    // the local multiplexer is the platform's own
    #[test]
    fn the_local_multiplexer_matches_the_platform() {
        assert_eq!(LOCAL_MUX, if cfg!(windows) { "psmux.exe" } else { "tmux" });
    }

    #[test]
    fn session_names_round_trip_the_launcher_name() {
        let p = project("my app", "G:/dev/my app");
        let names = session_names(std::slice::from_ref(&p));
        assert_eq!(names.len(), 1);
        let (name, path) = names.into_iter().next().unwrap();
        assert!(name.starts_with("my-app-"), "{name}");
        assert_eq!(path, p.full_path);
    }
}
