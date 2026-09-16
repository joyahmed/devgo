// the machines you ssh into. a row is an alias into ~/.ssh/config, or a
// host typed by hand with a key path; there is no password field. the
// launch runs ssh with whatever the user's own setup does

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Server {
    pub id: String,
    pub name: String,
    // a Host name from ~/.ssh/config. set, the launch is ssh <alias> and
    // nothing else: the alias carries the key and IdentitiesOnly, and a
    // rebuilt -p -i user@host offered the wrong key on this machine
    #[serde(default)]
    pub alias: Option<String>,
    pub host: String,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    // a key path, never key material
    #[serde(default)]
    pub identity: Option<String>,
    #[serde(default)]
    pub default_path: Option<String>,
    // attach to or create a tmux session on the box, the same promise a
    // wsl project gets
    #[serde(default = "default_true")]
    pub tmux: bool,
    #[serde(default)]
    pub session: Option<String>,
    // the config forwards a port through this host
    #[serde(default)]
    pub tunnel: bool,
    // "ssh-config" or "manual"
    #[serde(default = "default_source")]
    pub source: String,
    // where its folders are listed from; empty means the defaults
    #[serde(default)]
    pub roots: Vec<String>,
}

fn default_true() -> bool {
    true
}

fn default_source() -> String {
    "manual".into()
}

fn present(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|v| !v.is_empty())
}

impl Server {
    // the way to reach this box, without the remote command
    pub fn ssh_target(&self) -> Vec<String> {
        if let Some(alias) = present(&self.alias) {
            return vec![alias.to_string()];
        }
        let mut args = Vec::new();
        if let Some(p) = self.port.filter(|p| *p != 22) {
            args.push("-p".into());
            args.push(p.to_string());
        }
        if let Some(k) = present(&self.identity) {
            args.push("-i".into());
            args.push(format!("\"{k}\""));
        }
        match present(&self.user) {
            Some(u) => args.push(format!("{u}@{}", self.host)),
            None => args.push(self.host.clone()),
        }
        args
    }

    // the whole line the terminal runs. with tmux, attach or create the
    // named session, and a login shell when the box has no tmux. $SHELL is
    // the remote one: nothing between wt and ssh reads a dollar, and a
    // backslash reached the box as a literal
    pub fn ssh_command(&self) -> String {
        let target = self.ssh_target().join(" ");
        if !self.tmux {
            return format!("ssh {target}");
        }
        let session = present(&self.session).unwrap_or("devgo");
        format!(
            "ssh -t {target} \"command -v tmux >/dev/null 2>&1 && \
             tmux new-session -A -s {session} || exec $SHELL -l\""
        )
    }

    // what goes in front of a path for scp
    pub fn scp_prefix(&self) -> String {
        if let Some(alias) = present(&self.alias) {
            return format!("{alias}:");
        }
        match present(&self.user) {
            Some(u) => format!("{u}@{}:", self.host),
            None => format!("{}:", self.host),
        }
    }
}

// an id from the name: lowercase, - for anything else
pub fn slug(name: &str) -> String {
    let base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed = base.trim_matches('-');
    if trimmed.is_empty() {
        "server".into()
    } else {
        trimmed.into()
    }
}

pub struct ServersStore {
    servers: Vec<Server>,
    file_path: PathBuf,
}

impl ServersStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;
        let file_path = app_data_dir.join("servers.json");
        let servers = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            super::config_io::parse_or_backup(&file_path, &data)
        } else {
            Vec::new()
        };
        Ok(Self { servers, file_path })
    }

    pub fn list(&self) -> Vec<Server> {
        self.servers.clone()
    }

    pub fn get(&self, id: &str) -> Option<Server> {
        self.servers.iter().find(|s| s.id == id).cloned()
    }

    // a fresh id from the name; -2, -3 on a clash
    pub fn add(&mut self, mut server: Server) -> Result<Server, AppError> {
        let base = slug(&server.name);
        let mut id = base.clone();
        let mut n = 2;
        while self.servers.iter().any(|s| s.id == id) {
            id = format!("{base}-{n}");
            n += 1;
        }
        server.id = id;
        self.servers.push(server.clone());
        self.save()?;
        Ok(server)
    }

    pub fn update(&mut self, server: Server) -> Result<(), AppError> {
        let Some(slot) = self.servers.iter_mut().find(|s| s.id == server.id)
        else {
            return Err(AppError::ServerNotFound(server.id));
        };
        *slot = server;
        self.save()
    }

    pub fn remove(&mut self, id: &str) -> Result<(), AppError> {
        let before = self.servers.len();
        self.servers.retain(|s| s.id != id);
        if self.servers.len() == before {
            return Err(AppError::ServerNotFound(id.to_string()));
        }
        self.save()
    }

    // merge an import in by alias: a new alias is added, a known one keeps
    // what was set by hand (name, default_path, tmux, session) and takes
    // the config's host, user, port and key. returns (added, updated)
    pub fn upsert_from_config(
        &mut self,
        imported: Vec<Server>,
    ) -> Result<(usize, usize), AppError> {
        let mut added = 0;
        let mut updated = 0;
        for inc in imported {
            let known = self
                .servers
                .iter_mut()
                .find(|s| s.alias.is_some() && s.alias == inc.alias);
            if let Some(existing) = known {
                existing.host = inc.host;
                existing.user = inc.user;
                existing.port = inc.port;
                existing.identity = inc.identity;
                existing.tunnel = inc.tunnel;
                existing.source = "ssh-config".into();
                updated += 1;
            } else {
                self.add(inc)?;
                added += 1;
            }
        }
        if updated > 0 {
            self.save()?;
        }
        Ok((added, updated))
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.servers)?;
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
            identity: Some("~/.ssh/id".into()),
            default_path: None,
            tmux: true,
            session: None,
            tunnel: false,
            source: "ssh-config".into(),
            roots: vec![],
        }
    }

    #[test]
    fn an_alias_is_launched_as_the_alias_and_nothing_else() {
        assert_eq!(zetta().ssh_target(), ["zetta"]);
        let line = zetta().ssh_command();
        assert!(line.starts_with("ssh -t zetta \""), "{line}");
        assert!(line.contains("tmux new-session -A -s devgo"), "{line}");
        assert!(line.contains("|| exec $SHELL -l"), "{line}");
        assert!(!line.contains("\\"), "a backslash reaches the box: {line}");
    }

    #[test]
    fn a_manual_server_spells_out_user_port_and_key() {
        let mut s = zetta();
        s.alias = None;
        s.session = Some("work".into());
        assert_eq!(
            s.ssh_target(),
            ["-p", "9999", "-i", "\"~/.ssh/id\"", "joy@213.190.4.162"]
        );
        assert!(s.ssh_command().contains("-s work"));
        s.port = Some(22);
        s.identity = None;
        s.user = None;
        assert_eq!(s.ssh_target(), ["213.190.4.162"]);
    }

    #[test]
    fn tmux_off_is_a_plain_ssh() {
        let mut s = zetta();
        s.tmux = false;
        assert_eq!(s.ssh_command(), "ssh zetta");
    }

    #[test]
    fn scp_prefix_follows_the_same_rule() {
        assert_eq!(zetta().scp_prefix(), "zetta:");
        let mut s = zetta();
        s.alias = None;
        assert_eq!(s.scp_prefix(), "joy@213.190.4.162:");
    }

    #[test]
    fn slug_is_safe_and_never_empty() {
        assert_eq!(slug("Zetta (VPS)"), "zetta--vps");
        assert_eq!(slug("***"), "server");
    }

    #[test]
    fn the_store_round_trips_and_upserts_by_alias() {
        let dir = std::env::temp_dir().join("devgo-servers-test");
        let _ = fs::remove_dir_all(&dir);
        let mut store = ServersStore::new(dir.clone()).unwrap();
        let added = store.add(zetta()).unwrap();
        assert_eq!(added.id, "zetta");
        let again = store.add(zetta()).unwrap();
        assert_eq!(again.id, "zetta-2", "a clash gets a suffix");
        store.remove("zetta-2").unwrap();

        // a path set by hand survives a re-import
        let mut mine = store.get("zetta").unwrap();
        mine.default_path = Some("/home/joy/projects".into());
        store.update(mine).unwrap();
        let mut fresh = zetta();
        fresh.port = Some(2222);
        let (a, u) = store.upsert_from_config(vec![fresh]).unwrap();
        assert_eq!((a, u), (0, 1));
        let after = store.get("zetta").unwrap();
        assert_eq!(after.port, Some(2222));
        assert_eq!(after.default_path.as_deref(), Some("/home/joy/projects"));

        let reopened = ServersStore::new(dir).unwrap();
        assert_eq!(reopened.list().len(), 1);
    }
}
