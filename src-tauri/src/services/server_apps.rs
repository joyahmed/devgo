// the apps on a server, and the actions the server declares for them.
// the knowledge is one json document, ~/scripts/devgo-inventory.sh on the
// box: every /var/www/<app> with its pm2 processes, ports, nginx site,
// git remote, database name. the doors are devgo-actions.json beside it:
// a label and a shell line per action, with {placeholders} filled here.
// devgo never runs a script itself, never parses an action's output,
// never holds sudo. and an action line never goes on the terminal's
// command line: cmd eats && | > and wt splits on ; so it reaches the box
// as one argv element of a direct ssh, typed into a tmux window

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::server_folders::RemoteFolder;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Inventory {
    #[serde(default)]
    pub schema: u32,
    #[serde(default)]
    pub generated: Option<String>,
    #[serde(default)]
    pub host: Host,
    #[serde(default)]
    pub apps: Vec<App>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Host {
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub load: Vec<f64>,
    #[serde(default)]
    pub disk: Option<Disk>,
    #[serde(default)]
    pub pm2_total: u32,
    #[serde(default)]
    pub pm2_online: u32,
    #[serde(default)]
    pub nginx_sites: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Disk {
    #[serde(default)]
    pub total_gb: f64,
    #[serde(default)]
    pub free_gb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct App {
    pub name: String,
    pub dir: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub processes: Vec<Process>,
    #[serde(default)]
    pub site: Option<Site>,
    #[serde(default)]
    pub git: Option<Git>,
    #[serde(default)]
    pub env_files: Vec<String>,
    #[serde(default)]
    pub database: Option<Db>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Process {
    #[serde(default)]
    pub pm2: Option<String>,
    #[serde(default)]
    pub pid: Option<u64>,
    #[serde(default)]
    pub status: Option<String>,
    // a docker-run process reports null here; null is nothing to count
    #[serde(default, deserialize_with = "null_as_zero")]
    pub restarts: u64,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub ports: Vec<u16>,
    #[serde(default, deserialize_with = "null_as_zero")]
    pub memory_mb: u64,
}

fn null_as_zero<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<u64, D::Error> {
    Ok(Option::<u64>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Site {
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub domains: Vec<String>,
    #[serde(default)]
    pub ssl: bool,
    #[serde(default)]
    pub web_port: Option<u16>,
    #[serde(default)]
    pub api_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Git {
    #[serde(default)]
    pub remote: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub head: Option<String>,
    #[serde(default)]
    pub committed: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Db {
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub name: Option<String>,
}

// what an action does with its line. run types it and presses enter,
// pretype leaves it on the prompt, url opens the browser, local runs the
// line on this pc. a kind this build does not know is dropped on read,
// so a newer contract never breaks an older devgo
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ActionKind {
    Run,
    Pretype,
    Url,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Action {
    pub id: String,
    pub label: String,
    pub kind: ActionKind,
    // the line begins with sudo and the window will ask; a hint, not a gate
    #[serde(default)]
    pub root: bool,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Actions {
    #[serde(default)]
    pub schema: u32,
    #[serde(default)]
    pub scripts_dir: Option<String>,
    #[serde(default)]
    pub server: Vec<Action>,
    #[serde(default)]
    pub app: Vec<Action>,
}

// an entry as the file has it, kind still a string, so an unknown one can
// be skipped rather than failing the whole file
#[derive(Deserialize)]
struct RawAction {
    id: String,
    label: String,
    kind: String,
    #[serde(default)]
    root: bool,
    command: String,
}

#[derive(Deserialize)]
struct RawActions {
    #[serde(default)]
    schema: u32,
    #[serde(default)]
    scripts_dir: Option<String>,
    #[serde(default)]
    server: Vec<RawAction>,
    #[serde(default)]
    app: Vec<RawAction>,
}

pub fn parse_actions(text: &str) -> Result<Actions, String> {
    let raw: RawActions = serde_json::from_str(text)
        .map_err(|e| format!("devgo-actions.json: {e}"))?;
    let keep = |list: Vec<RawAction>| -> Vec<Action> {
        list.into_iter()
            .filter_map(|a| {
                let kind = match a.kind.as_str() {
                    "run" => ActionKind::Run,
                    "pretype" => ActionKind::Pretype,
                    "url" => ActionKind::Url,
                    "local" => ActionKind::Local,
                    _ => return None,
                };
                Some(Action {
                    id: a.id,
                    label: a.label,
                    kind,
                    root: a.root,
                    command: a.command,
                })
            })
            .collect()
    };
    Ok(Actions {
        schema: raw.schema,
        scripts_dir: raw.scripts_dir,
        server: keep(raw.server),
        app: keep(raw.app),
    })
}

pub fn parse_inventory(text: &str) -> Result<Inventory, String> {
    serde_json::from_str(text).map_err(|e| format!("devgo-inventory.sh: {e}"))
}

// the words an app can fill in. None is "this app has no such thing", and
// an action using it is hidden on that row, not shown broken. the process
// whose pm2 name or cwd ends in web/frontend is the web, api/backend the
// api; one process is both {pm2} and {pm2_web}
pub fn placeholders(app: &App) -> HashMap<&'static str, Option<String>> {
    let names: Vec<String> =
        app.processes.iter().filter_map(|p| p.pm2.clone()).collect();
    let find = |suffixes: &[&str]| -> Option<String> {
        app.processes
            .iter()
            .find(|p| {
                let n = p.pm2.as_deref().unwrap_or("");
                let c = p.cwd.as_deref().unwrap_or("").trim_end_matches('/');
                suffixes.iter().any(|s| n.ends_with(s) || c.ends_with(s))
            })
            .and_then(|p| p.pm2.clone())
    };
    let web = find(&["web", "frontend"]).or_else(|| names.first().cloned());
    let api = find(&["api", "backend"]).or_else(|| names.get(1).cloned());
    let site = app.site.as_ref();
    let port = |p: Option<u16>| p.map(|p| p.to_string());
    HashMap::from([
        ("dir", Some(app.dir.clone())),
        ("name", Some(app.name.clone())),
        ("pm2", web.clone()),
        ("pm2_web", web),
        ("pm2_api", api),
        (
            "site",
            site.map(|s| s.file.clone()).filter(|f| !f.is_empty()),
        ),
        ("domain", site.and_then(|s| s.domains.first().cloned())),
        ("web_port", port(site.and_then(|s| s.web_port))),
        ("api_port", port(site.and_then(|s| s.api_port))),
        ("db", app.database.as_ref().and_then(|d| d.name.clone())),
        ("repo", app.git.as_ref().and_then(|g| g.repo.clone())),
    ])
}

// substitute the {word}s. None when the line needs one this row lacks; a
// word the contract does not define is left as it is, so a later schema's
// placeholder does not hide today's actions
pub fn fill(
    command: &str,
    values: &HashMap<&'static str, Option<String>>,
) -> Option<String> {
    let mut out = String::with_capacity(command.len());
    let mut rest = command;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) => {
                let key = &after[..end];
                match values.get(key) {
                    Some(Some(v)) => out.push_str(v),
                    Some(None) => return None,
                    None => {
                        out.push('{');
                        out.push_str(key);
                        out.push('}');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    Some(out)
}

pub const INVENTORY_MARK: &str = "__DEVGO_INVENTORY__";
pub const ACTIONS_MARK: &str = "__DEVGO_ACTIONS__";

// the remote line: the listing, then the inventory, then the actions file
// (the installed copy first, the checkout as the fallback). one ssh, one
// round trip; a box without the scripts prints nothing after the marks.
// the ; and 2>/dev/null are for the remote shell
pub fn combined_command(listing: &str) -> String {
    format!(
        "{listing}; echo {INVENTORY_MARK}; ~/scripts/devgo-inventory.sh \
         2>/dev/null; echo {ACTIONS_MARK}; cat ~/scripts/devgo-actions.json \
         2>/dev/null || cat /var/www/server/scripts/devgo-actions.json \
         2>/dev/null"
    )
}

// what one run said, in three parts. an empty part is None (no script on
// that box); a part that is there but not json is an error the row shows
#[derive(Debug, Default, PartialEq)]
pub struct Parts {
    pub listing: String,
    pub inventory: Option<Result<Inventory, String>>,
    pub actions: Option<Result<Actions, String>>,
}

pub fn split(stdout: &str) -> Parts {
    let (listing, tail) = match stdout.find(INVENTORY_MARK) {
        Some(i) => (&stdout[..i], &stdout[i + INVENTORY_MARK.len()..]),
        None => (stdout, ""),
    };
    let (inv, act) = match tail.find(ACTIONS_MARK) {
        Some(i) => (&tail[..i], &tail[i + ACTIONS_MARK.len()..]),
        None => (tail, ""),
    };
    let part = |s: &str| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    };
    Parts {
        listing: listing.to_string(),
        inventory: part(inv).map(|t| parse_inventory(&t)),
        actions: part(act).map(|t| parse_actions(&t)),
    }
}

// an app whose directory no listed root covers still gets a row: under
// its parent directory, so /opt/thing shows beside /var/www/*
pub fn append_unlisted(folders: &mut Vec<RemoteFolder>, inventory: &Inventory) {
    for app in &inventory.apps {
        let dir = app.dir.trim_end_matches('/');
        if dir.is_empty() || folders.iter().any(|f| f.path == dir) {
            continue;
        }
        let parent = match dir.rsplit_once('/') {
            Some(("", _)) | None => "/",
            Some((p, _)) => p,
        };
        folders.push(RemoteFolder {
            name: app.name.clone(),
            path: dir.to_string(),
            root: parent.to_string(),
        });
    }
}

// the tmux line that puts an action in front of the user, as one argv
// element for a direct ssh: a session if there is none, a fresh window
// named after the action, the line typed into it, and Enter only for a
// run. new-window without a command, so the shell stays after the output
// and after a ctrl-c on a tail. single-quoted for the remote shell
pub fn typed_command(
    session: &str,
    window: &str,
    line: &str,
    press_enter: bool,
) -> String {
    let quoted = format!("'{}'", line.replace('\'', "'\\''"));
    let enter = if press_enter { " Enter" } else { "" };
    format!(
        "tmux new-session -d -s {session} 2>/dev/null; \
         tmux new-window -t {session} -n {window}; \
         tmux send-keys -t {session}:{window} {quoted}{enter}"
    )
}

// a local line runs on this pc through the terminal's run template, which
// cmd parses first, so only a plain line is allowed there. the error names
// the character so the contract's author knows what to change
pub fn check_local(line: &str) -> Result<(), String> {
    const FORBIDDEN: &[char] =
        &['&', '|', '<', '>', '^', '(', ')', ';', '%', '"'];
    match line.chars().find(|c| FORBIDDEN.contains(c)) {
        Some(c) => Err(format!(
            "A local action cannot contain `{c}`: it would be parsed on this PC, not run"
        )),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // two apps from a live document, trimmed: erp is a turborepo with a
    // web and an api process; zetta-hms has a site and no process at all
    const INVENTORY: &str = r#"{
      "schema": 1, "generated": "2026-09-12T20:00:00+0600",
      "host": {"hostname": "zettaserver", "uptime": 543457, "load": [0.0, 0.1, 0.0],
               "disk": {"total_gb": 206.9, "free_gb": 156.6}, "pm2_total": 16, "pm2_online": 16, "nginx_sites": 12},
      "apps": [
        {"name": "erp", "dir": "/var/www/erp", "kind": "mono",
         "processes": [
           {"pm2": "erp-frontend", "pid": 1, "status": "online", "restarts": 3, "uptime": 10, "cwd": "/var/www/erp/apps/web", "node": "v20.19.6", "ports": [3008], "memory_mb": 120},
           {"pm2": "erp-api", "pid": 2, "status": "online", "restarts": 0, "uptime": 10, "cwd": "/var/www/erp/apps/api", "node": "v20.19.6", "ports": [3009], "memory_mb": 90}],
         "site": {"file": "erp", "domains": ["hrm.zettabyteincorp.com"], "ssl": true, "upstreams": [], "aliases": [], "web_port": 3008, "api_port": 3009},
         "git": {"remote": "git@github.com:joyahmed/erp.git", "repo": "joyahmed/erp", "branch": "main", "head": "abc1234", "committed": "2026-09-01", "subject": "deploy"},
         "env_files": [".env", "apps/api/.env"], "database": {"engine": "postgres", "host": "127.0.0.1", "port": 5432, "name": "erp"}},
        {"name": "zetta-hms", "dir": "/var/www/zetta-hms", "kind": "mono", "processes": [],
         "site": {"file": "zetta-hms", "domains": ["hms.zettademos.com"], "ssl": true, "upstreams": [], "aliases": [], "web_port": 3005, "api_port": 3004},
         "git": null, "env_files": [], "database": null},
        {"name": "thing", "dir": "/opt/thing", "kind": "node", "processes": [], "site": null, "git": null, "env_files": [], "database": null}
      ],
      "orphan_processes": [{"pm2": "gh-runner-zettabyte"}], "orphan_sites": []
    }"#;

    const ACTIONS: &str = r#"{
      "schema": 1, "scripts_dir": "/home/joy/scripts",
      "server": [
        {"id": "nginx-test", "label": "nginx -t", "kind": "run", "root": true, "command": "sudo nginx -t"},
        {"id": "new-site", "label": "New nginx site…", "kind": "pretype", "root": true, "command": "sudo ~/scripts/new-site.sh <app> <domain> <port> --dry-run"},
        {"id": "future", "label": "From a newer schema", "kind": "form", "root": false, "command": "x"}
      ],
      "app": [
        {"id": "logs", "label": "Logs", "kind": "run", "root": false, "command": "pm2 logs {pm2} --lines 100"},
        {"id": "nginx-conf", "label": "nginx config", "kind": "run", "root": false, "command": "less /etc/nginx/sites-available/{site}"},
        {"id": "nginx-access", "label": "Tail access log", "kind": "run", "root": true, "command": "sudo tail -f /var/log/nginx/access.log | grep --line-buffered {domain}"},
        {"id": "open-site", "label": "Open in browser", "kind": "url", "root": false, "command": "https://{domain}"},
        {"id": "db-tunnel", "label": "DB tunnel", "kind": "local", "root": false, "command": "ssh -N zetta-db"}
      ]
    }"#;

    fn inv() -> Inventory {
        parse_inventory(INVENTORY).unwrap()
    }

    #[test]
    fn the_live_document_parses_and_every_field_is_optional() {
        let i = inv();
        assert_eq!(i.host.pm2_online, 16);
        assert_eq!(i.apps.len(), 3);
        assert_eq!(i.apps[0].site.as_ref().unwrap().api_port, Some(3009));
        assert!(i.apps[1].git.is_none());
        // the two required app fields alone still load
        let bare =
            parse_inventory(r#"{"apps":[{"name":"x","dir":"/var/www/x"}]}"#)
                .unwrap();
        assert_eq!(bare.apps[0].kind, "");
        // a docker process reports null where a pm2 one has a number
        let docker = parse_inventory(
            r#"{"apps":[{"name":"x","dir":"/x","processes":[{"docker":"x-web","pid":null,"status":"online","restarts":null,"uptime":null,"memory_mb":null,"ports":[3005]}]}]}"#,
        )
        .unwrap();
        assert_eq!(docker.apps[0].processes[0].restarts, 0);
        assert_eq!(docker.apps[0].processes[0].ports, [3005]);
        assert!(parse_inventory("not json").is_err());
    }

    #[test]
    fn an_unknown_action_kind_is_dropped_not_fatal() {
        let a = parse_actions(ACTIONS).unwrap();
        assert_eq!(a.server.len(), 2, "the form kind belongs to a later stage");
        assert_eq!(a.server[1].kind, ActionKind::Pretype);
        assert!(a.server[0].root);
        assert_eq!(a.app.len(), 5);
    }

    #[test]
    fn placeholders_name_the_web_and_api_processes() {
        let i = inv();
        let erp = placeholders(&i.apps[0]);
        assert_eq!(erp["pm2"].as_deref(), Some("erp-frontend"));
        assert_eq!(erp["pm2_web"].as_deref(), Some("erp-frontend"));
        assert_eq!(erp["pm2_api"].as_deref(), Some("erp-api"));
        assert_eq!(erp["domain"].as_deref(), Some("hrm.zettabyteincorp.com"));
        assert_eq!(erp["api_port"].as_deref(), Some("3009"));
        assert_eq!(erp["db"].as_deref(), Some("erp"));
        assert_eq!(erp["repo"].as_deref(), Some("joyahmed/erp"));
    }

    #[test]
    fn an_action_needing_what_the_row_lacks_is_hidden_not_broken() {
        let i = inv();
        let hms = placeholders(&i.apps[1]);
        assert_eq!(fill("pm2 logs {pm2} --lines 100", &hms), None);
        assert_eq!(
            fill("less /etc/nginx/sites-available/{site}", &hms).as_deref(),
            Some("less /etc/nginx/sites-available/zetta-hms")
        );
        let erp = placeholders(&i.apps[0]);
        assert_eq!(
            fill(
                "sudo tail -f /var/log/nginx/access.log | grep --line-buffered {domain}",
                &erp
            )
            .as_deref(),
            Some("sudo tail -f /var/log/nginx/access.log | grep --line-buffered hrm.zettabyteincorp.com"),
            "the pipe rides through untouched"
        );
        assert_eq!(
            fill("echo {later_schema} {name}", &erp).as_deref(),
            Some("echo {later_schema} erp")
        );
        assert_eq!(fill("no braces", &erp).as_deref(), Some("no braces"));
        assert_eq!(fill("open {", &erp).as_deref(), Some("open {"));
    }

    #[test]
    fn the_one_ssh_carries_three_parts_and_split_finds_them() {
        let cmd = combined_command("echo ~; ls -d ~/*/ 2>/dev/null");
        assert!(
            cmd.starts_with(
                "echo ~; ls -d ~/*/ 2>/dev/null; echo __DEVGO_INVENTORY__; ~/scripts/devgo-inventory.sh 2>/dev/null; echo __DEVGO_ACTIONS__; cat ~/scripts/devgo-actions.json"
            ),
            "{cmd}"
        );
        assert!(
            cmd.contains("|| cat /var/www/server/scripts/devgo-actions.json")
        );
        let stdout = format!(
            "/home/joy\n/var/www/erp/\n{INVENTORY_MARK}\n{INVENTORY}\n{ACTIONS_MARK}\n{ACTIONS}\n"
        );
        let p = split(&stdout);
        assert_eq!(p.listing, "/home/joy\n/var/www/erp/\n");
        assert_eq!(p.inventory.unwrap().unwrap().apps.len(), 3);
        assert_eq!(p.actions.unwrap().unwrap().app.len(), 5);
        // a box without the scripts: the marks, nothing after them
        let bare =
            split(&format!("/home/joy\n{INVENTORY_MARK}\n{ACTIONS_MARK}\n"));
        assert_eq!(bare.listing, "/home/joy\n");
        assert!(bare.inventory.is_none() && bare.actions.is_none());
        // no marks at all
        assert_eq!(split("/home/joy\n").listing, "/home/joy\n");
        // garbage where json should be is an error carried, not a panic
        let bad = split(&format!("{INVENTORY_MARK}\nnope\n{ACTIONS_MARK}\n"));
        assert!(bad.inventory.unwrap().is_err());
    }

    #[test]
    fn an_app_outside_every_root_still_gets_a_row() {
        let mut folders = vec![RemoteFolder {
            name: "erp".into(),
            path: "/var/www/erp".into(),
            root: "/var/www".into(),
        }];
        append_unlisted(&mut folders, &inv());
        let paths: Vec<&str> =
            folders.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["/var/www/erp", "/var/www/zetta-hms", "/opt/thing"]);
        assert_eq!(folders[2].root, "/opt");
        assert_eq!(folders[1].root, "/var/www");
        append_unlisted(&mut folders, &inv());
        assert_eq!(folders.len(), 3, "a second pass duplicates nothing");
    }

    #[test]
    fn the_typed_line_presses_enter_only_for_a_run() {
        let run = typed_command(
            "devgo",
            "logs",
            "pm2 logs erp-frontend --lines 100",
            true,
        );
        assert_eq!(
            run,
            "tmux new-session -d -s devgo 2>/dev/null; tmux new-window -t devgo -n logs; tmux send-keys -t devgo:logs 'pm2 logs erp-frontend --lines 100' Enter"
        );
        let typed =
            typed_command("devgo", "restart", "pm2 restart erp-api", false);
        assert!(
            typed.ends_with("send-keys -t devgo:restart 'pm2 restart erp-api'")
        );
        let quote = typed_command("devgo", "x", "echo it's", true);
        assert!(quote.contains("'echo it'\\''s' Enter"), "{quote}");
    }

    #[test]
    fn a_local_line_with_a_shell_character_is_refused_by_name() {
        assert!(check_local("ssh -N zetta-db").is_ok());
        let err = check_local("ssh -N zetta-db && echo done").unwrap_err();
        assert!(err.contains("`&`"), "{err}");
        assert!(check_local("a | b").is_err());
    }
}
