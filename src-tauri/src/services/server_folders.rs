// the folders on a server, as rows under it. one ssh per server on an
// explicit ask (expand, refresh), never on launch, focus or the badge
// pass. the listing's success doubles as the reachability answer, so
// there is no separate probe. cached to servers-cache.json; the card
// paints the last listing until the next ask

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::platform::Quiet;
use super::servers::Server;
use crate::error::AppError;

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
    // children of folders drilled into, by absolute path; one ls each, on
    // the click, cached like the roots
    #[serde(default)]
    pub subdirs: HashMap<String, Vec<RemoteFolder>>,
    // unix seconds of the last ask; 0 = never
    pub listed_at: u64,
    // the last ask reached the box
    pub up: bool,
    // what ssh said when it did not
    #[serde(default)]
    pub error: Option<String>,
    // the apps on the box, from ~/scripts/devgo-inventory.sh on the same
    // ssh as the listing; None when the box has no such script
    #[serde(default)]
    pub inventory: Option<super::server_apps::Inventory>,
    // the actions the server declares, from devgo-actions.json beside it
    #[serde(default)]
    pub actions: Option<super::server_apps::Actions>,
    // the script or the file was there but did not parse; shown on the row
    #[serde(default)]
    pub inventory_error: Option<String>,
}

// one run of the listing ssh, in its parts
#[derive(Debug, Default)]
pub struct Listed {
    pub folders: Vec<RemoteFolder>,
    pub inventory: Option<super::server_apps::Inventory>,
    pub actions: Option<super::server_apps::Actions>,
    pub inventory_error: Option<String>,
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

// the pin's inverse. an empty list means the defaults, so they are
// written out first and the one taken away; otherwise the removal would
// be a no-op on an empty list and the group would stay
pub fn without_root(server: &Server, root: &str) -> Vec<String> {
    let root = root.trim().trim_end_matches('/');
    effective_roots(server)
        .into_iter()
        .filter(|r| r != root)
        .collect()
}

// /var/www/shop -> shop. tmux forbids . and : in a session name
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

// the ssh every ask runs, up to the remote command. ssh is spawned
// directly, not through a shell, so a * reaches the remote shell
// untouched, which is what expands it
fn ssh_command(server: &Server, remote: &str) -> Command {
    let mut cmd = Command::new("ssh");
    cmd.quiet().args([
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
    cmd.arg(remote);
    cmd
}

// one ssh with a remote command: stdout, or what ssh printed
fn ssh(server: &Server, remote: &str) -> Result<String, String> {
    let out = ssh_command(server, remote)
        .output()
        .map_err(|e| format!("ssh: {e}"))?;
    finish(out)
}

// the same, with bytes on the remote command's stdin: how files reach a
// box without scp. the child's stdin is written and closed before the
// wait, so a remote that reads to the end sees it
fn ssh_with_input(
    server: &Server,
    remote: &str,
    input: &[u8],
) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = ssh_command(server, remote)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ssh: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input).map_err(|e| format!("ssh: {e}"))?;
    }
    let out = child.wait_with_output().map_err(|e| format!("ssh: {e}"))?;
    finish(out)
}

fn finish(out: std::process::Output) -> Result<String, String> {
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
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// the roots' children, and on the same ssh the inventory and the actions.
// echo ~ first so a ~ root can be attributed
pub fn list(server: &Server) -> Result<Listed, String> {
    use super::server_apps::{append_unlisted, combined_command, split};
    let roots = effective_roots(server);
    let listing = format!("echo ~; {}", listing_command(&roots));
    let text = ssh(server, &combined_command(&listing))?;
    let parts = split(&text);
    let mut lines = parts.listing.lines();
    let home = lines.next().map(|l| l.trim().to_string());
    let rest: String = lines.collect::<Vec<_>>().join("\n");
    let mut folders = parse_listing(&rest, &roots, home.as_deref());
    // the two json parts: absent, parsed, or an error carried, the first
    // that failed
    let mut inventory_error = None;
    let inventory = parts.inventory.and_then(|r| match r {
        Ok(i) => Some(i),
        Err(e) => {
            inventory_error = Some(e);
            None
        }
    });
    let actions = parts.actions.and_then(|r| match r {
        Ok(a) => Some(a),
        Err(e) => {
            inventory_error.get_or_insert(e);
            None
        }
    });
    if let Some(i) = &inventory {
        append_unlisted(&mut folders, i);
    }
    Ok(Listed {
        folders,
        inventory,
        actions,
        inventory_error,
    })
}

// one remote line whose output nobody reads: the send-keys door
pub fn run_remote(server: &Server, line: &str) -> Result<(), String> {
    ssh(server, line).map(|_| ())
}

// one remote line whose output is the answer: the setup probe
pub fn read_remote(server: &Server, line: &str) -> Result<String, String> {
    ssh(server, line)
}

// one remote line fed on stdin: the setup's write
pub fn put_remote(
    server: &Server,
    line: &str,
    input: &[u8],
) -> Result<(), String> {
    ssh_with_input(server, line, input).map(|_| ())
}

// the children of one folder: the drill-down. same ssh, same rules; the
// path is single-quoted for the remote shell (nothing local sees this
// line), so a space in a folder name survives
pub fn dir_command(path: &str) -> String {
    let p = path.trim_end_matches('/').replace('\'', "'\\''");
    format!("ls -d '{p}'/*/ 2>/dev/null")
}

pub fn list_dir(
    server: &Server,
    path: &str,
) -> Result<Vec<RemoteFolder>, String> {
    let out = ssh(server, &dir_command(path))?;
    Ok(parse_listing(&out, &[path.to_string()], None))
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

    fn boxy() -> Server {
        Server {
            id: "box".into(),
            name: "box".into(),
            alias: Some("box".into()),
            host: "203.0.113.7".into(),
            user: Some("user".into()),
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
            "/home/user/projects/api/\n/var/www/shop/\n/var/www/blog/\n\n";
        let f = parse_listing(text, &roots, Some("/home/user"));
        assert_eq!(f.len(), 3);
        assert_eq!(
            f[0],
            RemoteFolder {
                name: "api".into(),
                path: "/home/user/projects/api".into(),
                root: "~/projects".into()
            }
        );
        assert_eq!(f[1].root, "/var/www");
        assert_eq!(f[2].name, "blog");
    }

    #[test]
    fn a_drill_down_quotes_the_path_for_the_remote_shell() {
        assert_eq!(
            dir_command("/etc/nginx/"),
            "ls -d '/etc/nginx'/*/ 2>/dev/null"
        );
        assert_eq!(
            dir_command("/srv/it's here"),
            "ls -d '/srv/it'\\''s here'/*/ 2>/dev/null"
        );
        let kids = parse_listing(
            "/etc/nginx/sites-available/\n/etc/nginx/conf.d/\n",
            &["/etc/nginx".into()],
            None,
        );
        let names: Vec<_> = kids.iter().map(|k| k.name.as_str()).collect();
        assert_eq!(names, ["sites-available", "conf.d"]);
        assert!(kids.iter().all(|k| k.root == "/etc/nginx"));
    }

    #[test]
    fn defaults_apply_only_when_the_row_says_nothing() {
        let mut s = boxy();
        assert_eq!(
            effective_roots(&s),
            ["~", "~/projects", "/var/www", "/srv"]
        );
        s.roots = vec!["/srv".into(), " ".into()];
        assert_eq!(effective_roots(&s), ["/srv"]);
    }

    // a never-edited server unpins one of the defaults: the other three
    // are written out, so the list does not read as "the defaults" again
    #[test]
    fn unpinning_a_default_keeps_the_other_defaults() {
        let s = boxy();
        assert_eq!(without_root(&s, "~/projects"), ["~", "/var/www", "/srv"]);
    }

    #[test]
    fn unpinning_trims_the_way_pinning_did() {
        let mut s = boxy();
        s.roots = vec!["/etc/nginx".into(), "/opt".into()];
        assert_eq!(without_root(&s, " /etc/nginx/ "), ["/opt"]);
        // unpinning the last one leaves an empty list: the defaults again
        s.roots = vec!["/opt".into()];
        assert!(without_root(&s, "/opt").is_empty());
    }

    #[test]
    fn a_folder_terminal_is_a_session_named_after_the_folder() {
        let line = folder_terminal_command(&boxy(), "/var/www/shop");
        assert_eq!(
            line,
            "ssh -t box tmux new-session -A -s shop -c /var/www/shop"
        );
        assert_eq!(session_slug("/var/www/my.blog"), "my-blog");
        let mut plain = boxy();
        plain.tmux = false;
        assert_eq!(folder_terminal_command(&plain, "/var/www/shop"), "ssh box");
    }

    #[test]
    fn remote_editor_lines_use_the_alias_when_there_is_one() {
        assert_eq!(
            vscode_remote_args(&boxy(), "/var/www/shop"),
            "--remote ssh-remote+box \"/var/www/shop\""
        );
        assert_eq!(
            zed_remote_url(&boxy(), "/var/www/shop"),
            "ssh://box/var/www/shop"
        );
        let mut manual = boxy();
        manual.alias = None;
        assert_eq!(
            zed_remote_url(&manual, "/var/www/shop"),
            "ssh://user@203.0.113.7:9999/var/www/shop"
        );
        assert_eq!(
            vscode_remote_args(&manual, "/x"),
            "--remote ssh-remote+user@203.0.113.7 \"/x\""
        );
    }

    #[test]
    fn the_cache_round_trips() {
        let dir = std::env::temp_dir().join("devgo-servers-cache-test");
        let _ = fs::remove_dir_all(&dir);
        let mut c = ListingCache::new(dir.clone()).unwrap();
        c.store(
            "box",
            ServerListing {
                listed_at: 5,
                up: true,
                ..Default::default()
            },
        )
        .unwrap();
        let again = ListingCache::new(dir).unwrap();
        assert!(again.all()["box"].up);
    }
}
