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
    // from the lockfile: pnpm | bun | yarn | npm, the install and build lines
    #[serde(default)]
    pub pm: Option<String>,
    // pm2's own file when the app has one: the restart that restarts
    // everything the app declares
    #[serde(default)]
    pub ecosystem: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Process {
    #[serde(default)]
    pub pm2: Option<String>,
    // the container name when the process is a docker container; then
    // pm2 is null
    #[serde(default)]
    pub docker: Option<String>,
    #[serde(default)]
    pub pid: Option<u64>,
    #[serde(default)]
    pub status: Option<String>,
    // a container has no pm2 restart count and no monit memory, so the
    // script writes null. option, not a default: null means not known,
    // not zero
    #[serde(default)]
    pub restarts: Option<u64>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub ports: Vec<u16>,
    #[serde(default)]
    pub memory_mb: Option<u64>,
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
    // a drawer of fields composes the line, then it goes the run way
    Form,
}

// one field of a form action. a bool emits arg when on and arg_off when
// off; a typed value emits arg when it differs from default; when hides
// the field, and its requirement, until that other field says so;
// prefill is a placeholder filled from the app row
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Field {
    pub name: String,
    #[serde(default)]
    pub label: Option<String>,
    // text | number | choice | bool
    #[serde(rename = "type", default = "default_field_type")]
    pub kind: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub prefill: Option<String>,
    #[serde(default)]
    pub when: Option<String>,
    #[serde(default)]
    pub arg: Option<String>,
    #[serde(default)]
    pub arg_off: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
}

fn default_field_type() -> String {
    "text".into()
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
    // the heading the menu draws over it, groups in the order they first
    // appear; none means no heading
    #[serde(default)]
    pub group: Option<String>,
    // form only: the fields, what preview appends, the word on the button
    #[serde(default)]
    pub fields: Vec<Field>,
    #[serde(default)]
    pub preview: Option<String>,
    #[serde(default)]
    pub submit: Option<String>,
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
    #[serde(default)]
    group: Option<String>,
    #[serde(default)]
    fields: Vec<Field>,
    #[serde(default)]
    preview: Option<String>,
    #[serde(default)]
    submit: Option<String>,
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
                    "form" => ActionKind::Form,
                    _ => return None,
                };
                Some(Action {
                    id: a.id,
                    label: a.label,
                    kind,
                    root: a.root,
                    command: a.command,
                    group: a.group,
                    fields: a.fields,
                    preview: a.preview,
                    submit: a.submit,
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
        ("pm", app.pm.clone().filter(|p| !p.is_empty())),
        ("eco", app.ecosystem.clone().filter(|e| !e.is_empty())),
        // what the form's shape buttons call this app: the inventory says
        // mono | next | node | other; the buttons say next nest node turbo
        (
            "site_type",
            Some(
                match app.kind.as_str() {
                    "mono" => "turbo",
                    "node" => "node",
                    _ => "next",
                }
                .to_string(),
            ),
        ),
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

// a form value is a word. devgo never quotes for the remote shell (the
// line is shown as typed and typed as shown), so a space, a quote or a
// shell character is refused here, naming the field
pub fn is_word(v: &str) -> bool {
    !v.is_empty()
        && v.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._@/:+=-".contains(c))
}

fn when_holds(when: &str, values: &HashMap<String, String>) -> bool {
    match when.split_once('=') {
        Some((k, v)) => values.get(k.trim()).is_some_and(|x| x == v.trim()),
        None => values.get(when.trim()).is_some_and(|x| x == "true"),
    }
}

// compose a form action's line from the user's values: every field
// validated by type, {field} substituted, {flags} built by the rule, the
// preview word appended when asked. what comes back may still carry
// inventory {placeholders} for fill
pub fn compose(
    action: &Action,
    values: &HashMap<String, String>,
    preview: bool,
) -> Result<String, String> {
    // the user's value, else the default, else empty
    let mut effective: HashMap<String, String> = HashMap::new();
    for f in &action.fields {
        let v = values
            .get(&f.name)
            .cloned()
            .or_else(|| f.default.clone())
            .unwrap_or_default();
        effective.insert(f.name.clone(), v.trim().to_string());
    }
    let mut flags: Vec<String> = Vec::new();
    for f in &action.fields {
        let label = f.label.clone().unwrap_or_else(|| f.name.clone());
        if f.when
            .as_deref()
            .is_some_and(|w| !when_holds(w, &effective))
        {
            continue;
        }
        let v = effective.get(&f.name).cloned().unwrap_or_default();
        let default = f.default.clone().unwrap_or_default();
        match f.kind.as_str() {
            // a bool says its word whenever it is on or off, default or not:
            // a regen form that opens with overwrite on must still send
            // --force. only a typed value is compared to its default
            "bool" => {
                let a = if v == "true" { &f.arg } else { &f.arg_off };
                if let Some(a) = a {
                    flags.push(a.replace("{value}", &v));
                }
            }
            kind => {
                if v.is_empty() {
                    if f.required {
                        return Err(format!("{label} is required"));
                    }
                    continue;
                }
                if !is_word(&v) {
                    return Err(format!(
                        "{label}: letters, digits and . _ @ / : + = - only, no spaces or quotes"
                    ));
                }
                if kind == "number" && v.parse::<u16>().is_err() {
                    return Err(format!(
                        "{label} must be a port number (1-65535)"
                    ));
                }
                if kind == "choice" && !f.options.contains(&v) {
                    return Err(format!(
                        "{label} must be one of {}",
                        f.options.join(" / ")
                    ));
                }
                if let Some(a) = f.arg.as_ref().filter(|_| v != default) {
                    flags.push(a.replace("{value}", &v));
                }
            }
        }
    }
    let mut line = action.command.clone();
    for (k, v) in &effective {
        line = line.replace(&format!("{{{k}}}"), v);
    }
    line = line.replace("{flags}", &flags.join(" "));
    if let Some(p) = action.preview.as_ref().filter(|_| preview) {
        line.push(' ');
        line.push_str(p);
    }
    // an empty {flags} leaves a double space behind
    Ok(line.split_whitespace().collect::<Vec<_>>().join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    // two apps from a live document, trimmed: shop is a turborepo with a
    // web and an api process; blog has a site and no process at all
    const INVENTORY: &str = r#"{
      "schema": 1, "generated": "2026-09-12T20:00:00+0600",
      "host": {"hostname": "box", "uptime": 543457, "load": [0.0, 0.1, 0.0],
               "disk": {"total_gb": 206.9, "free_gb": 156.6}, "pm2_total": 16, "pm2_online": 16, "nginx_sites": 12},
      "apps": [
        {"name": "shop", "dir": "/var/www/shop", "kind": "mono",
         "processes": [
           {"pm2": "shop-web", "pid": 1, "status": "online", "restarts": 3, "uptime": 10, "cwd": "/var/www/shop/apps/web", "node": "v20.19.6", "ports": [3008], "memory_mb": 120},
           {"pm2": "shop-api", "pid": 2, "status": "online", "restarts": 0, "uptime": 10, "cwd": "/var/www/shop/apps/api", "node": "v20.19.6", "ports": [3009], "memory_mb": 90}],
         "site": {"file": "shop", "domains": ["shop.example.com"], "ssl": true, "upstreams": [], "aliases": [], "web_port": 3008, "api_port": 3009},
         "git": {"remote": "git@github.com:user/shop.git", "repo": "user/shop", "branch": "main", "head": "abc1234", "committed": "2026-09-01", "subject": "deploy"},
         "env_files": [".env", "apps/api/.env"], "database": {"engine": "postgres", "host": "127.0.0.1", "port": 5432, "name": "shop"},
         "pm": "pnpm", "ecosystem": "ecosystem.config.js"},
        {"name": "blog", "dir": "/var/www/blog", "kind": "mono", "processes": [],
         "site": {"file": "blog", "domains": ["blog.example.com"], "ssl": true, "upstreams": [], "aliases": [], "web_port": 3005, "api_port": 3004},
         "git": null, "env_files": [], "database": null},
        {"name": "thing", "dir": "/opt/thing", "kind": "node", "processes": [], "site": null, "git": null, "env_files": [], "database": null}
      ],
      "orphan_processes": [{"pm2": "gh-runner"}], "orphan_sites": []
    }"#;

    const ACTIONS: &str = r#"{
      "schema": 1, "scripts_dir": "/home/user/scripts",
      "server": [
        {"id": "nginx-test", "label": "nginx -t", "kind": "run", "root": true, "command": "sudo nginx -t"},
        {"id": "new-site", "label": "New nginx site…", "kind": "pretype", "root": true, "command": "sudo ~/scripts/new-site.sh <app> <domain> <port> --dry-run"},
        {"id": "future", "label": "From a newer schema", "kind": "wizard", "root": false, "command": "x"}
      ],
      "app": [
        {"id": "logs", "label": "Logs", "kind": "run", "root": false, "command": "pm2 logs {pm2} --lines 100"},
        {"id": "nginx-conf", "label": "nginx config", "kind": "run", "root": false, "command": "less /etc/nginx/sites-available/{site}"},
        {"id": "nginx-access", "label": "Tail access log", "kind": "run", "root": true, "command": "sudo tail -f /var/log/nginx/access.log | grep --line-buffered {domain}"},
        {"id": "open-site", "label": "Open in browser", "kind": "url", "root": false, "command": "https://{domain}"},
        {"id": "db-tunnel", "label": "DB tunnel", "kind": "local", "root": false, "command": "ssh -N box-db"}
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
        assert!(parse_inventory("not json").is_err());
    }

    // the exact process the script emits for a docker container on the
    // box: pm2, pid, restarts, uptime, node and memory_mb all null
    #[test]
    fn a_docker_container_with_null_counters_parses() {
        let text = r#"{"apps":[{"name":"blog","dir":"/var/www/blog","processes":[{"pm2": null, "docker": "blog", "pid": null, "status": "online", "restarts": null, "uptime": null, "cwd": "/var/www/blog", "node": null, "ports": [3005], "memory_mb": null}]}]}"#;
        let inv = parse_inventory(text).unwrap();
        let p = &inv.apps[0].processes[0];
        assert_eq!(p.docker.as_deref(), Some("blog"));
        assert_eq!(p.pm2, None);
        assert_eq!(p.restarts, None);
        assert_eq!(p.memory_mb, None);
        assert_eq!(p.ports, vec![3005]);
    }

    #[test]
    fn an_unknown_action_kind_is_dropped_not_fatal() {
        let a = parse_actions(ACTIONS).unwrap();
        assert_eq!(
            a.server.len(),
            2,
            "a kind this build does not know is dropped"
        );
        assert_eq!(a.server[1].kind, ActionKind::Pretype);
        assert!(a.server[0].root);
        assert_eq!(a.app.len(), 5);
    }

    #[test]
    fn placeholders_name_the_web_and_api_processes() {
        let i = inv();
        let shop = placeholders(&i.apps[0]);
        assert_eq!(shop["pm2"].as_deref(), Some("shop-web"));
        assert_eq!(shop["pm2_web"].as_deref(), Some("shop-web"));
        assert_eq!(shop["pm2_api"].as_deref(), Some("shop-api"));
        assert_eq!(shop["domain"].as_deref(), Some("shop.example.com"));
        assert_eq!(shop["api_port"].as_deref(), Some("3009"));
        assert_eq!(shop["db"].as_deref(), Some("shop"));
        assert_eq!(shop["repo"].as_deref(), Some("user/shop"));
        assert_eq!(shop["pm"].as_deref(), Some("pnpm"));
        assert_eq!(shop["eco"].as_deref(), Some("ecosystem.config.js"));
        let blog = placeholders(&i.apps[1]);
        assert_eq!(blog["eco"], None, "no ecosystem file, no restart entry");
    }

    #[test]
    fn an_action_needing_what_the_row_lacks_is_hidden_not_broken() {
        let i = inv();
        let blog = placeholders(&i.apps[1]);
        assert_eq!(fill("pm2 logs {pm2} --lines 100", &blog), None);
        assert_eq!(
            fill("less /etc/nginx/sites-available/{site}", &blog).as_deref(),
            Some("less /etc/nginx/sites-available/blog")
        );
        let shop = placeholders(&i.apps[0]);
        assert_eq!(
            fill(
                "sudo tail -f /var/log/nginx/access.log | grep --line-buffered {domain}",
                &shop
            )
            .as_deref(),
            Some("sudo tail -f /var/log/nginx/access.log | grep --line-buffered shop.example.com"),
            "the pipe rides through untouched"
        );
        assert_eq!(
            fill("echo {later_schema} {name}", &shop).as_deref(),
            Some("echo {later_schema} shop")
        );
        assert_eq!(fill("no braces", &shop).as_deref(), Some("no braces"));
        assert_eq!(fill("open {", &shop).as_deref(), Some("open {"));
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
            "/home/user\n/var/www/shop/\n{INVENTORY_MARK}\n{INVENTORY}\n{ACTIONS_MARK}\n{ACTIONS}\n"
        );
        let p = split(&stdout);
        assert_eq!(p.listing, "/home/user\n/var/www/shop/\n");
        assert_eq!(p.inventory.unwrap().unwrap().apps.len(), 3);
        assert_eq!(p.actions.unwrap().unwrap().app.len(), 5);
        // a box without the scripts: the marks, nothing after them
        let bare =
            split(&format!("/home/user\n{INVENTORY_MARK}\n{ACTIONS_MARK}\n"));
        assert_eq!(bare.listing, "/home/user\n");
        assert!(bare.inventory.is_none() && bare.actions.is_none());
        // no marks at all
        assert_eq!(split("/home/user\n").listing, "/home/user\n");
        // garbage where json should be is an error carried, not a panic
        let bad = split(&format!("{INVENTORY_MARK}\nnope\n{ACTIONS_MARK}\n"));
        assert!(bad.inventory.unwrap().is_err());
    }

    #[test]
    fn an_app_outside_every_root_still_gets_a_row() {
        let mut folders = vec![RemoteFolder {
            name: "shop".into(),
            path: "/var/www/shop".into(),
            root: "/var/www".into(),
        }];
        append_unlisted(&mut folders, &inv());
        let paths: Vec<&str> =
            folders.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["/var/www/shop", "/var/www/blog", "/opt/thing"]);
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
            "pm2 logs shop-web --lines 100",
            true,
        );
        assert_eq!(
            run,
            "tmux new-session -d -s devgo 2>/dev/null; tmux new-window -t devgo -n logs; tmux send-keys -t devgo:logs 'pm2 logs shop-web --lines 100' Enter"
        );
        let typed =
            typed_command("devgo", "restart", "pm2 restart shop-api", false);
        assert!(typed
            .ends_with("send-keys -t devgo:restart 'pm2 restart shop-api'"));
        let quote = typed_command("devgo", "x", "echo it's", true);
        assert!(quote.contains("'echo it'\\''s' Enter"), "{quote}");
    }

    #[test]
    fn a_local_line_with_a_shell_character_is_refused_by_name() {
        assert!(check_local("ssh -N box-db").is_ok());
        let err = check_local("ssh -N box-db && echo done").unwrap_err();
        assert!(err.contains("`&`"), "{err}");
        assert!(check_local("a | b").is_err());
    }

    fn new_site() -> Action {
        let text = r#"{ "schema": 2, "server": [{ "id": "new-site", "label": "New nginx site…", "kind": "form", "root": true,
          "command": "sudo ~/scripts/new-site.sh {app} {domain} {port} {flags}", "preview": "--dry-run", "submit": "Create",
          "fields": [
            {"name": "app", "label": "App name", "required": true},
            {"name": "domain", "label": "Domain", "required": true},
            {"name": "port", "label": "Port", "type": "number", "required": true},
            {"name": "type", "label": "Shape", "type": "choice", "options": ["next", "nest", "node", "turbo"], "default": "next", "arg": "--type {value}"},
            {"name": "api_port", "label": "API port", "type": "number", "when": "type=turbo", "required": true, "arg": "--api-port {value}"},
            {"name": "www", "label": "Add www.", "type": "bool", "default": "true", "arg_off": "--no-www"},
            {"name": "ssl", "label": "HTTPS", "type": "bool", "default": "true", "arg_off": "--no-ssl"},
            {"name": "force", "label": "Overwrite", "type": "bool", "default": "false", "arg": "--force"}
          ] }] }"#;
        parse_actions(text).unwrap().server.remove(0)
    }

    fn vals(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn a_form_composes_by_the_differs_from_default_rule() {
        let a = new_site();
        assert_eq!(a.kind, ActionKind::Form);
        assert_eq!(a.fields.len(), 8);
        let plain = vals(&[
            ("app", "wiki"),
            ("domain", "wiki.example.com"),
            ("port", "3025"),
        ]);
        assert_eq!(
            compose(&a, &plain, false).unwrap(),
            "sudo ~/scripts/new-site.sh wiki wiki.example.com 3025",
            "next is the default, so no --type; www and ssl on carry no arg"
        );
        // a bool that defaults on still says its word
        let mut regen = a.clone();
        for f in &mut regen.fields {
            if f.name == "force" {
                f.default = Some("true".into());
            }
        }
        let line = compose(&regen, &plain, false).unwrap();
        assert!(line.ends_with("3025 --force"), "{line}");
        let turbo = vals(&[
            ("app", "portal"),
            ("domain", "portal.x.com"),
            ("port", "3027"),
            ("type", "turbo"),
            ("api_port", "3028"),
            ("www", "false"),
        ]);
        assert_eq!(
            compose(&a, &turbo, true).unwrap(),
            "sudo ~/scripts/new-site.sh portal portal.x.com 3027 --type turbo --api-port 3028 --no-www --dry-run"
        );
        let nest = vals(&[
            ("app", "b"),
            ("domain", "b.io"),
            ("port", "3026"),
            ("type", "nest"),
            ("force", "true"),
        ]);
        assert_eq!(
            compose(&a, &nest, false).unwrap(),
            "sudo ~/scripts/new-site.sh b b.io 3026 --type nest --force"
        );
    }

    #[test]
    fn a_form_refuses_what_is_not_a_word_and_names_the_field() {
        let a = new_site();
        let err = compose(
            &a,
            &vals(&[
                ("app", "shop; rm -rf /"),
                ("domain", "d.io"),
                ("port", "1"),
            ]),
            false,
        )
        .unwrap_err();
        assert!(err.starts_with("App name:"), "{err}");
        let err = compose(
            &a,
            &vals(&[("app", "shop"), ("domain", "d.io"), ("port", "80000")]),
            false,
        )
        .unwrap_err();
        assert!(err.contains("Port"), "{err}");
        let err = compose(
            &a,
            &vals(&[
                ("app", "shop"),
                ("domain", "d.io"),
                ("port", "3000"),
                ("type", "turbo"),
            ]),
            false,
        )
        .unwrap_err();
        assert_eq!(
            err, "API port is required",
            "the when-field is required once type=turbo"
        );
        let ok = compose(
            &a,
            &vals(&[
                ("app", "shop"),
                ("domain", "d.io"),
                ("port", "3000"),
                ("api_port", "9"),
            ]),
            false,
        )
        .unwrap();
        assert!(
            !ok.contains("--api-port"),
            "hidden by when, so ignored: {ok}"
        );
        let err =
            compose(&a, &vals(&[("domain", "d.io"), ("port", "3000")]), false)
                .unwrap_err();
        assert!(err.contains("App name is required"));
        let err = compose(
            &a,
            &vals(&[
                ("app", "a"),
                ("domain", "d.io"),
                ("port", "3000"),
                ("type", "php"),
            ]),
            false,
        )
        .unwrap_err();
        assert!(err.contains("one of next / nest / node / turbo"));
    }

    #[test]
    fn site_type_speaks_new_site_sh() {
        let i = inv();
        assert_eq!(
            placeholders(&i.apps[0])["site_type"].as_deref(),
            Some("turbo")
        );
        assert_eq!(
            placeholders(&i.apps[2])["site_type"].as_deref(),
            Some("node")
        );
        // a regen form: fields prefilled by the caller, {dir} left for fill
        let a = Action {
            command: "sudo ~/scripts/new-site.sh {app} {domain} {port} --path {dir} {flags}".into(),
            ..new_site()
        };
        let v = vals(&[
            ("app", "shop"),
            ("domain", "shop.example.com"),
            ("port", "3008"),
            ("type", "turbo"),
            ("api_port", "3009"),
            ("force", "true"),
        ]);
        let line = compose(&a, &v, true).unwrap();
        assert_eq!(line, "sudo ~/scripts/new-site.sh shop shop.example.com 3008 --path {dir} --type turbo --api-port 3009 --force --dry-run");
        assert_eq!(
            fill(&line, &placeholders(&i.apps[0])).unwrap(),
            "sudo ~/scripts/new-site.sh shop shop.example.com 3008 --path /var/www/shop --type turbo --api-port 3009 --force --dry-run"
        );
    }
}
