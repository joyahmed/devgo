// the folders on a server, as rows under it. one ssh per server on an
// explicit ask (expand, refresh), never on launch, focus or the badge
// pass. the listing's success doubles as the reachability answer, so
// there is no separate probe. cached to servers-cache.json; the card
// paints the last listing until the next ask

use std::collections::HashMap;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::servers::Server;
use crate::error::AppError;

const CREATE_NO_WINDOW: u32 = 0x08000000;

// where a box keeps its life when the row says nothing
pub const DEFAULT_ROOTS: &[&str] = &["~", "~/projects", "/var/www", "/srv"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteFolder {
    pub name: String,
    pub path: String,
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServerListing {
    pub folders: Vec<RemoteFolder>,
    // unix seconds of the last ask; 0 = never
    pub listed_at: u64,
    // the last ask reached the box
    pub up: bool,
    // what ssh said when it did not
    #[serde(default)]
    pub error: Option<String>,
}

// one ls -d over every root's children. the 2>/dev/null is for the remote
// shell: a missing root must not fail the whole listing
pub fn listing_command(roots: &[String]) -> String {
    let globs: Vec<String> = roots
        .iter()
        .map(|r| format!("{}/*/", r.trim_end_matches('/')))
        .collect();
    format!("ls -d {} 2>/dev/null", globs.join(" "))
}

// ls -d prints one directory per line with a trailing slash. each is
// attributed to the longest root that prefixes it, ~ resolved against
// the home the box reported
pub fn parse_listing(
    text: &str,
    roots: &[String],
    home: Option<&str>,
) -> Vec<RemoteFolder> {
    let resolved: Vec<(String, String)> = roots
        .iter()
        .map(|r| {
            let full = match home {
                Some(h) if r.starts_with('~') => format!("{h}{}", &r[1..]),
                _ => r.clone(),
            };
            (r.clone(), full.trim_end_matches('/').to_string())
        })
        .collect();
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim().trim_end_matches('/');
        if line.is_empty() {
            continue;
        }
        let name = line.rsplit('/').next().unwrap_or(line).to_string();
        let root = resolved
            .iter()
            .filter(|(_, full)| line.starts_with(&format!("{full}/")))
            .max_by_key(|(_, full)| full.len())
            .map(|(r, _)| r.clone())
            .unwrap_or_default();
        out.push(RemoteFolder {
            name,
            path: line.to_string(),
            root,
        });
    }
    out
}

pub fn effective_roots(server: &Server) -> Vec<String> {
    let own: Vec<String> = server
        .roots
        .iter()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
        .collect();
    if own.is_empty() {
        DEFAULT_ROOTS.iter().map(|s| s.to_string()).collect()
    } else {
        own
    }
}

// /var/www/erp -> erp. tmux forbids . and : in a session name
pub fn session_slug(path: &str) -> String {
    let last = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    let s: String = last
        .chars()
        .map(|c| {
            if c == '.' || c == ':' || c.is_whitespace() {
                '-'
            } else {
                c
            }
        })
        .collect();
    if s.is_empty() {
        "devgo".into()
    } else {
        s
    }
}

// a terminal in a remote folder: the row's tmux rule, the session named
// after the folder so two folders on one box are two sessions. no quotes,
// for the same reason Server::ssh_command has none
pub fn folder_terminal_command(server: &Server, path: &str) -> String {
    let target = server.ssh_target().join(" ");
    if !server.tmux {
        // cd needs a shell; the plain form lands in the home directory
        return format!("ssh {target}");
    }
    format!(
        "ssh -t {target} tmux new-session -A -s {} -c {path}",
        session_slug(path)
    )
}

fn remote_host(server: &Server) -> String {
    match server.alias.as_deref().filter(|a| !a.is_empty()) {
        Some(alias) => alias.to_string(),
        None => match server.user.as_deref() {
            Some(u) => format!("{u}@{}", server.host),
            None => server.host.clone(),
        },
    }
}

// code --remote ssh-remote+<host> <path>. vs code reads ~/.ssh/config too,
// so the alias resolves; a non-22 port has to be in the config for it
pub fn vscode_remote_args(server: &Server, path: &str) -> String {
    format!("--remote ssh-remote+{} \"{path}\"", remote_host(server))
}

// zed ssh://[user@]host[:port]/path. zed uses the system ssh
pub fn zed_remote_url(server: &Server, path: &str) -> String {
    let p = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    match server.alias.as_deref().filter(|a| !a.is_empty()) {
        Some(alias) => format!("ssh://{alias}{p}"),
        None => {
            let user = server
                .user
                .as_deref()
                .map(|u| format!("{u}@"))
                .unwrap_or_default();
            let port = server
                .port
                .filter(|p| *p != 22)
                .map(|p| format!(":{p}"))
                .unwrap_or_default();
            format!("ssh://{user}{}{port}{p}", server.host)
        }
    }
}

// run the listing: the folders, or what ssh printed. ssh is spawned
// directly, not through a shell, so the * reaches the remote shell
// untouched, which is what expands it
pub fn list(server: &Server) -> Result<Vec<RemoteFolder>, String> {
    let roots = effective_roots(server);
    let mut cmd = Command::new("ssh");
    cmd.creation_flags(CREATE_NO_WINDOW).args([
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]);
    for a in server.ssh_target() {
        cmd.arg(a.trim_matches('"'));
    }
    // echo ~ first so a ~ root can be attributed
    cmd.arg(format!("echo ~; {}", listing_command(&roots)));
    let out = cmd.output().map_err(|e| format!("ssh: {e}"))?;
    // ssh exits 255 for its own failures; any other code is the remote
    // command's, and ls -d exits 2 when one root is missing on that box
    // while listing the rest fine
    if out.status.code().is_none_or(|c| c == 255) {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("ssh exited with {}", out.status)
        } else {
            err
        });
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut lines = text.lines();
    let home = lines.next().map(|l| l.trim().to_string());
    let rest: String = lines.collect::<Vec<_>>().join("\n");
    Ok(parse_listing(&rest, &roots, home.as_deref()))
}

// one listing per server id, on disk
pub struct ListingCache {
    entries: HashMap<String, ServerListing>,
    file_path: PathBuf,
}

impl ListingCache {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;
        let file_path = app_data_dir.join("servers-cache.json");
        let entries = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            super::config_io::parse_or_backup(&file_path, &data)
        } else {
            HashMap::new()
        };
        Ok(Self { entries, file_path })
    }

    pub fn all(&self) -> HashMap<String, ServerListing> {
        self.entries.clone()
    }

    pub fn store(
        &mut self,
        id: &str,
        listing: ServerListing,
    ) -> Result<(), AppError> {
        self.entries.insert(id.to_string(), listing);
        self.save()
    }

    pub fn forget(&mut self, id: &str) -> Result<(), AppError> {
        if self.entries.remove(id).is_some() {
            self.save()?;
        }
        Ok(())
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.entries)?;
        fs::write(&self.file_path, data)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zetta() -> Server {
        Server {
            id: "zetta".into(),
            name: "zetta".into(),
            alias: Some("zetta".into()),
            host: "213.190.4.162".into(),
            user: Some("joy".into()),
            port: Some(9999),
            identity: None,
            default_path: None,
            tmux: true,
            session: None,
            tunnel: false,
            source: "ssh-config".into(),
            roots: vec![],
        }
    }

    #[test]
    fn the_listing_command_globs_every_root_and_silences_missing_ones() {
        let cmd = listing_command(&["~/projects".into(), "/var/www/".into()]);
        assert_eq!(cmd, "ls -d ~/projects/*/ /var/www/*/ 2>/dev/null");
    }

    #[test]
    fn listing_lines_become_folders_attributed_to_their_root() {
        let roots = vec!["~/projects".to_string(), "/var/www".to_string()];
        let text =
            "/home/joy/projects/api/\n/var/www/erp/\n/var/www/zetta-hms/\n\n";
        let f = parse_listing(text, &roots, Some("/home/joy"));
        assert_eq!(f.len(), 3);
        assert_eq!(
            f[0],
            RemoteFolder {
                name: "api".into(),
                path: "/home/joy/projects/api".into(),
                root: "~/projects".into()
            }
        );
        assert_eq!(f[1].root, "/var/www");
        assert_eq!(f[2].name, "zetta-hms");
    }

    #[test]
    fn defaults_apply_only_when_the_row_says_nothing() {
        let mut s = zetta();
        assert_eq!(
            effective_roots(&s),
            ["~", "~/projects", "/var/www", "/srv"]
        );
        s.roots = vec!["/srv".into(), " ".into()];
        assert_eq!(effective_roots(&s), ["/srv"]);
    }

    #[test]
    fn a_folder_terminal_is_a_session_named_after_the_folder() {
        let line = folder_terminal_command(&zetta(), "/var/www/erp");
        assert_eq!(
            line,
            "ssh -t zetta tmux new-session -A -s erp -c /var/www/erp"
        );
        assert_eq!(session_slug("/var/www/zetta.hms"), "zetta-hms");
        let mut plain = zetta();
        plain.tmux = false;
        assert_eq!(
            folder_terminal_command(&plain, "/var/www/erp"),
            "ssh zetta"
        );
    }

    #[test]
    fn remote_editor_lines_use_the_alias_when_there_is_one() {
        assert_eq!(
            vscode_remote_args(&zetta(), "/var/www/erp"),
            "--remote ssh-remote+zetta \"/var/www/erp\""
        );
        assert_eq!(
            zed_remote_url(&zetta(), "/var/www/erp"),
            "ssh://zetta/var/www/erp"
        );
        let mut manual = zetta();
        manual.alias = None;
        assert_eq!(
            zed_remote_url(&manual, "/var/www/erp"),
            "ssh://joy@213.190.4.162:9999/var/www/erp"
        );
        assert_eq!(
            vscode_remote_args(&manual, "/x"),
            "--remote ssh-remote+joy@213.190.4.162 \"/x\""
        );
    }

    #[test]
    fn the_cache_round_trips() {
        let dir = std::env::temp_dir().join("devgo-servers-cache-test");
        let _ = fs::remove_dir_all(&dir);
        let mut c = ListingCache::new(dir.clone()).unwrap();
        c.store(
            "zetta",
            ServerListing {
                folders: vec![],
                listed_at: 5,
                up: true,
                error: None,
            },
        )
        .unwrap();
        let again = ListingCache::new(dir).unwrap();
        assert!(again.all()["zetta"].up);
    }
}
