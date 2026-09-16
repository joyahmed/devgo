// ~/.ssh/config read into rows. read only, never written. wildcard hosts
// and Match blocks are rules, not machines, so they are skipped

use super::servers::Server;

pub fn parse(text: &str) -> Vec<Server> {
    let mut out: Vec<Server> = Vec::new();
    let mut current: Vec<Server> = Vec::new();
    let mut in_match = false;

    // a bare Host with no HostName is its own hostname
    let flush = |current: &mut Vec<Server>, out: &mut Vec<Server>| {
        for mut s in current.drain(..) {
            if s.host.is_empty() {
                s.host = s.alias.clone().unwrap_or_default();
            }
            out.push(s);
        }
    };

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = match line
            .split_once(|c: char| c == ' ' || c == '\t' || c == '=')
        {
            Some((k, v)) => (k.trim(), v.trim().trim_start_matches('=').trim()),
            None => (line, ""),
        };
        match key.to_ascii_lowercase().as_str() {
            "host" => {
                flush(&mut current, &mut out);
                in_match = false;
                for name in value.split_whitespace() {
                    if name.contains('*')
                        || name.contains('?')
                        || name.starts_with('!')
                    {
                        continue;
                    }
                    current.push(Server {
                        id: String::new(),
                        name: name.to_string(),
                        alias: Some(name.to_string()),
                        host: String::new(),
                        user: None,
                        port: None,
                        identity: None,
                        default_path: None,
                        tmux: true,
                        session: None,
                        tunnel: false,
                        source: "ssh-config".into(),
                        roots: Vec::new(),
                    });
                }
            }
            "match" => {
                flush(&mut current, &mut out);
                in_match = true;
            }
            _ if in_match || current.is_empty() => {}
            "hostname" => {
                current.iter_mut().for_each(|s| s.host = value.to_string())
            }
            "user" => current
                .iter_mut()
                .for_each(|s| s.user = Some(value.to_string())),
            "port" => {
                if let Ok(p) = value.parse::<u16>() {
                    current.iter_mut().for_each(|s| s.port = Some(p));
                }
            }
            "identityfile" => current
                .iter_mut()
                .for_each(|s| s.identity = Some(value.to_string())),
            "localforward" => current.iter_mut().for_each(|s| s.tunnel = true),
            _ => {}
        }
    }
    flush(&mut current, &mut out);
    out
}

// %USERPROFILE%\.ssh\config here, ~/.ssh/config elsewhere
pub fn default_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    Some(std::path::Path::new(&home).join(".ssh").join("config"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // shaped like a real file: a bare host, a real one, a tunnel alias to
    // the same box, a wildcard rule, and a Match block that must not leak
    const FIXTURE: &str = r#"
  Host zettaserver
    HostName zettaserver

Host zetta
    HostName 213.190.4.162
    User joy
    Port 9999
    IdentityFile ~/.ssh/id_ed25519_office
    IdentitiesOnly yes

# the tunnel
Host zetta-db
    HostName 213.190.4.162
    User joy
    Port 9999
    LocalForward 15432 localhost:5432

Host *
    ServerAliveInterval 60

Match host example.com
    User nobody

Host a b
    User both
"#;

    fn by_alias<'a>(s: &'a [Server], alias: &str) -> &'a Server {
        s.iter()
            .find(|x| x.alias.as_deref() == Some(alias))
            .unwrap()
    }

    #[test]
    fn parses_hosts_and_skips_rules() {
        let s = parse(FIXTURE);
        let names: Vec<_> =
            s.iter().map(|x| x.alias.clone().unwrap()).collect();
        assert_eq!(names, ["zettaserver", "zetta", "zetta-db", "a", "b"]);
        let zetta = by_alias(&s, "zetta");
        assert_eq!(zetta.host, "213.190.4.162");
        assert_eq!(zetta.user.as_deref(), Some("joy"));
        assert_eq!(zetta.port, Some(9999));
        assert_eq!(zetta.identity.as_deref(), Some("~/.ssh/id_ed25519_office"));
        assert!(!zetta.tunnel);
        assert!(
            by_alias(&s, "zetta-db").tunnel,
            "LocalForward marks a tunnel"
        );
        assert_eq!(by_alias(&s, "zettaserver").host, "zettaserver");
        assert!(
            s.iter().all(|x| x.user.as_deref() != Some("nobody")),
            "Match leaked"
        );
        assert_eq!(
            s.iter()
                .filter(|x| x.user.as_deref() == Some("both"))
                .count(),
            2
        );
    }

    #[test]
    fn equals_syntax_and_case_are_tolerated() {
        let s = parse("HOST box\n  hostname=10.0.0.5\n  PORT = 2222\n");
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].host, "10.0.0.5");
        assert_eq!(s[0].port, Some(2222));
    }

    #[test]
    fn empty_and_comments_only_yield_nothing() {
        assert!(parse("# nothing\n\n").is_empty());
    }
}
