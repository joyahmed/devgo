//! Which projects have a live multiplexer session right now. The
//! launcher names every tmux (WSL) and psmux (Windows) session after the
//! project, and a second launch already reattaches; this reads that fact
//! so the row can say it. One `tmux ls` per running distro that owns a
//! project (a stopped one is never started to ask), one `psmux
//! list-sessions` when any project is on Windows, never more often than
//! the badge pass.

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

/// The projects, by full_path, that have a live session.
pub fn collect(projects: &[Project], running: &[String]) -> Vec<String> {
    let names = session_names(projects);
    if names.is_empty() {
        return Vec::new();
    }

    let mut distros: HashSet<String> = HashSet::new();
    let mut any_windows = false;
    for p in projects {
        match distro_of(&p.full_path) {
            Some(d) if wsl::is_running(&d, running) => {
                distros.insert(d);
            }
            Some(_) => {}
            None => any_windows = true,
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
    if any_windows {
        for session in psmux_sessions() {
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

// one name per line, nothing and exit 0 with no server (psmux 3.3.8). a
// missing psmux is an empty list, never an error
fn psmux_sessions() -> Vec<String> {
    let Ok(out) = Command::new("psmux.exe")
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
            Command::new("psmux.exe")
                .quiet()
                .args(["kill-session", "-t", &target])
                .output()
                .map_err(|e| AppError::LaunchFailed(format!("psmux: {e}")))?;
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
            "Windows"
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
    // collect returns before it would spawn wsl.exe for it. the windows
    // branch answers with whatever psmux on this box says, which for a
    // path nothing launched is nothing
    #[test]
    fn a_stopped_distro_contributes_nothing_and_is_never_probed() {
        let projects = vec![
            project("app", "//wsl.localhost/Ubuntu/home/joy/app"),
            project("tool", "G:/dev/tool"),
        ];
        let live = collect(&projects, &[]);
        assert!(!live.iter().any(|p| p.starts_with("//wsl")), "{live:?}");
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
