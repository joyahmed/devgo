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
    fn folder_name_defaults_to_the_repo_and_refuses_paths() {
        assert_eq!(folder_name("devgo", None).unwrap(), "devgo");
        assert_eq!(folder_name("devgo", Some("  ")).unwrap(), "devgo");
        assert_eq!(folder_name("devgo", Some("my-devgo")).unwrap(), "my-devgo");
        assert!(folder_name("devgo", Some("a/b")).is_err());
        assert!(folder_name("devgo", Some("..")).is_err());
    }
}
