//! git clone into a workspace: the one git operation DevGo performs.
//!
//! Everything else git-shaped in this app reads (chapters 10, 32); this
//! writes, and the rules around it are the three the GitHub group lives
//! under: only on an explicit ask (a Clone button), never on the UI thread
//! (a spawned thread streams progress as events), and a failure leaves the
//! disk exactly as it was. git clone removes a half-made directory when it
//! fails, and the refusals here never let it start on one that exists.
use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

use super::platform::paths::windows_to_wsl_path;
use super::platform::wsl;
use super::scanner::distro_of;
use crate::error::AppError;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Which transport git clone uses. Read from gh: the host-level setting
/// first (gh config get -h github.com git_protocol, which is what gh auth
/// login writes), then the global one, then https. The user chose once;
/// DevGo reads the choice. Host-level first is not pedantry: on this
/// machine the global says https and the host says ssh, and only the host
/// one has a key behind it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Ssh,
    Https,
}

impl Protocol {
    pub fn parse(text: &str) -> Option<Self> {
        match text.trim() {
            "ssh" => Some(Self::Ssh),
            "https" => Some(Self::Https),
            _ => None,
        }
    }

    pub fn detect() -> Self {
        let read = |args: &[&str]| {
            Command::new("gh")
                .creation_flags(CREATE_NO_WINDOW)
                .args(args)
                .output()
                .ok()
                .filter(|o| o.status.success())
                .and_then(|o| {
                    Protocol::parse(&String::from_utf8_lossy(&o.stdout))
                })
        };
        read(&["config", "get", "-h", "github.com", "git_protocol"])
            .or_else(|| read(&["config", "get", "git_protocol"]))
            .unwrap_or(Self::Https)
    }
}

/// The url git clone is handed, from owner/name and the protocol.
pub fn clone_url(full_name: &str, protocol: Protocol) -> String {
    match protocol {
        Protocol::Ssh => format!("git@github.com:{full_name}.git"),
        Protocol::Https => format!("https://github.com/{full_name}.git"),
    }
}

/// The folder a clone lands in: the repo's own name unless the caller gave
/// one. A slash or a .. is refused because a name is a name, not a path.
pub fn folder_name(
    repo_name: &str,
    wanted: Option<&str>,
) -> Result<String, AppError> {
    let name = wanted
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(repo_name);
    if name.contains(['/', '\\']) || name == ".." || name == "." {
        return Err(AppError::CloneRefused(format!(
            "{name} is not a folder name"
        )));
    }
    Ok(name.to_string())
}

/// Where the clone will run and what it will be told.
///
/// A WSL workspace clones inside the distro at the Linux path: a clone
/// through \\wsl.localhost goes over 9p (slow) and leaves CRLF behind. A
/// Windows workspace clones with the Windows git.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    /// the path DevGo will show and scan: <workspace>\<name> in the
    /// workspace's own form (UNC for WSL, drive for Windows)
    pub dest: String,
    /// Some(distro) when the clone runs inside WSL
    pub distro: Option<String>,
    /// the path handed to git: Linux inside a distro, Windows otherwise
    pub git_dest: String,
    pub url: String,
}

pub fn plan(
    workspace: &str,
    repo_full_name: &str,
    name: &str,
    protocol: Protocol,
) -> Plan {
    let ws = workspace.trim_end_matches(['\\', '/']);
    let dest = format!("{ws}\\{name}");
    let distro = distro_of(workspace);
    let git_dest = match &distro {
        Some(d) => windows_to_wsl_path(&dest, d),
        None => dest.clone(),
    };
    Plan {
        dest,
        distro,
        git_dest,
        url: clone_url(repo_full_name, protocol),
    }
}

/// Every reason not to start, checked before the thread exists, so the
/// caller gets the refusal as the command's own error and not a failed job.
pub fn refuse_if_needed(
    plan: &Plan,
    running: &[String],
) -> Result<(), AppError> {
    if let Some(d) = &plan.distro {
        // the liveness gate, as everywhere: a clone into a stopped distro
        // would boot it, and the user asked for a clone, not a boot
        if !wsl::is_running(d, running) {
            return Err(AppError::CloneRefused(format!(
                "{d} is not running. Start it (open any project in it) and clone again"
            )));
        }
    }
    if std::path::Path::new(&plan.dest).exists() {
        return Err(AppError::CloneRefused(format!(
            "{} already exists. Remove it or pick another name",
            plan.dest
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_parses_and_builds_the_url() {
        assert_eq!(Protocol::parse("ssh\n"), Some(Protocol::Ssh));
        assert_eq!(Protocol::parse("https"), Some(Protocol::Https));
        assert_eq!(Protocol::parse("gopher"), None);
        assert_eq!(
            clone_url("joyahmed/devgo", Protocol::Ssh),
            "git@github.com:joyahmed/devgo.git"
        );
        assert_eq!(
            clone_url("joyahmed/devgo", Protocol::Https),
            "https://github.com/joyahmed/devgo.git"
        );
    }

    #[test]
    fn a_windows_workspace_clones_with_windows_git() {
        let p = plan(r"G:\01_tauri\", "joyahmed/devgo", "devgo", Protocol::Ssh);
        assert_eq!(p.dest, r"G:\01_tauri\devgo");
        assert_eq!(p.distro, None);
        assert_eq!(p.git_dest, r"G:\01_tauri\devgo");
    }

    #[test]
    fn a_wsl_workspace_clones_inside_the_distro_at_the_linux_path() {
        let p = plan(
            r"\\wsl.localhost\Ubuntu-26.04\home\joy\projects\01_turbo",
            "joyahmed/zetta-hrm",
            "zetta-hrm",
            Protocol::Ssh,
        );
        assert_eq!(
            p.dest,
            r"\\wsl.localhost\Ubuntu-26.04\home\joy\projects\01_turbo\zetta-hrm"
        );
        assert_eq!(p.distro.as_deref(), Some("Ubuntu-26.04"));
        assert_eq!(p.git_dest, "/home/joy/projects/01_turbo/zetta-hrm");
    }

    #[test]
    fn a_stopped_distro_is_refused_not_booted() {
        let p = plan(
            r"\\wsl.localhost\Ubuntu-26.04\home\joy\p",
            "o/r",
            "r",
            Protocol::Https,
        );
        let err = refuse_if_needed(&p, &[]).unwrap_err().to_string();
        assert!(err.contains("not running"), "{err}");
        // running: the UNC path is then probed for existence, and a made-up
        // path does not exist, so the plan is accepted
        assert!(refuse_if_needed(&p, &["Ubuntu-26.04".into()]).is_ok());
    }

    #[test]
    fn an_existing_destination_is_refused() {
        let dir = std::env::temp_dir().join("devgo-clone-exists");
        std::fs::create_dir_all(&dir).unwrap();
        let ws = std::env::temp_dir().to_string_lossy().to_string();
        let p = plan(&ws, "o/r", "devgo-clone-exists", Protocol::Https);
        let err = refuse_if_needed(&p, &[]).unwrap_err().to_string();
        assert!(err.contains("already exists"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn folder_name_defaults_to_the_repo_and_refuses_paths() {
        assert_eq!(folder_name("devgo", None).unwrap(), "devgo");
        assert_eq!(folder_name("devgo", Some("  ")).unwrap(), "devgo");
        assert_eq!(folder_name("devgo", Some("my-devgo")).unwrap(), "my-devgo");
        assert!(folder_name("devgo", Some("a/b")).is_err());
        assert!(folder_name("devgo", Some("..")).is_err());
    }
}
