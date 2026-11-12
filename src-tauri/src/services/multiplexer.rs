//! Open an agent session as a tab inside one running multiplexer, instead of
//! a new terminal window per project.
//!
//! The setting is separate from the terminal: `none` is the old behaviour
//! (a window per launch), `zorkyn` asks a running zorkyn for a tab. tmux is
//! in the enum so the setting has room for it; it is not built, and choosing
//! it launches the normal way with a notice.
//!
//! Everything here that decides something is a pure function over strings,
//! so the argument building and the reading of zorkyn's answer are tested on
//! every platform. Only `run_capture` and `open_agent` touch processes.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::platform::Quiet;
use super::runtime_log::log_line;

/// Which multiplexer an agent launch goes through. Stored lowercase in
/// prefs.json; absent means `None`, so every older prefs.json keeps the
/// window-per-launch behaviour.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum Multiplexer {
    #[default]
    None,
    Zorkyn,
    /// Reserved: not built. A launch with it set goes the normal way.
    Tmux,
}

/// What zorkyn prints on stderr when the tab exists but no client shows the
/// session. Matched as a substring: the prefix (`zorkyn open: `) and the
/// suggested command after it are not part of the contract.
pub const NO_WINDOW_HINT: &str = "no window shows this session";

/// A WSL script exits with this when zorkyn is not on the distro's PATH.
/// 127 is what bash itself uses for "command not found".
const NOT_INSTALLED: i32 = 127;

/// zorkyn can start its server on the first `open`; that is well under a
/// second here, but a cold distro can take several. Past this the launch is
/// treated as failed and falls back, rather than freezing the app.
const OPEN_TIMEOUT: Duration = Duration::from_secs(20);

/// The one line `zorkyn open` prints on stdout: `tab=N pane=P created|focused`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opened {
    pub tab: u32,
    pub pane: u64,
    pub created: bool,
}

/// Read zorkyn's answer. The first line that starts with `tab=` counts, so
/// a login shell's banner in front of it (WSL) does not hide it.
pub fn parse_opened(stdout: &str) -> Option<Opened> {
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("tab="))?;
    let mut parts = line.split_whitespace();
    let tab = parts.next()?.strip_prefix("tab=")?.parse().ok()?;
    let pane = parts.next()?.strip_prefix("pane=")?.parse().ok()?;
    let created = match parts.next()? {
        "created" => true,
        "focused" => false,
        _ => return None,
    };
    Some(Opened { tab, pane, created })
}

/// A program and its arguments, as data, so a test can read the line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub exe: String,
    pub args: Vec<String>,
}

/// Windows project: zorkyn.exe asks the running session for a tab, and
/// opens ONE Windows Terminal window on it if nothing shows the session.
/// The agent is one argument after `--`: zorkyn runs it through the default
/// shell as typed text, so a profile wrapper (claude's --name) still applies.
pub fn windows_open(zorkyn: &str, dir: &str, agent: &str) -> Invocation {
    Invocation {
        exe: zorkyn.to_string(),
        args: ["open", "--cwd", dir, "--attach-window", "--", agent]
            .map(String::from)
            .to_vec(),
    }
}

/// Mac / Linux host: the same request, without `--attach-window` (zorkyn
/// spawns no window off Windows). If nothing shows the session, DevGo opens
/// the default terminal on `zorkyn`.
pub fn unix_open(zorkyn: &str, dir: &str, agent: &str) -> Invocation {
    Invocation {
        exe: zorkyn.to_string(),
        args: ["open", "--cwd", dir, "--", agent]
            .map(String::from)
            .to_vec(),
    }
}

/// POSIX single quotes: everything literal, a quote itself closed, escaped
/// and reopened.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The script a login bash runs inside the distro: 127 when zorkyn is not
/// there (the caller falls back), else zorkyn's own answer and exit code.
pub fn wsl_script(linux_dir: &str, agent: &str) -> String {
    format!(
        "command -v zorkyn >/dev/null 2>&1 || exit {NOT_INSTALLED}\n\
         exec zorkyn open --cwd {} -- {}",
        sh_quote(linux_dir),
        sh_quote(agent)
    )
}

/// WSL project: the request runs inside the distro. `-e bash -lc`, not
/// `-- ...`: after `--` wsl.exe hands the rest to the default shell as one
/// line, which would parse the script a second time; `-e` runs bash with
/// these exact arguments. `-l` so a zorkyn in ~/.local/bin is on PATH.
pub fn wsl_open(distro: &str, linux_dir: &str, agent: &str) -> Invocation {
    Invocation {
        exe: "wsl.exe".into(),
        args: vec![
            "-d".into(),
            distro.into(),
            "--cd".into(),
            linux_dir.into(),
            "-e".into(),
            "bash".into(),
            "-lc".into(),
            wsl_script(linux_dir, agent),
        ],
    }
}

/// WSL project with no zorkyn client attached: one new Windows Terminal
/// window running zorkyn in the distro, which attaches to the session the
/// tab was just made in. Through a login bash for the same PATH reason.
pub fn wsl_attach_window(distro: &str) -> Invocation {
    Invocation {
        exe: "wt".into(),
        args: [
            "-w",
            "new",
            "wsl.exe",
            "-d",
            distro,
            "-e",
            "bash",
            "-lc",
            "exec zorkyn",
        ]
        .map(String::from)
        .to_vec(),
    }
}

/// Where zorkyn is on Windows: the PATH first, then `%USERPROFILE%\bin`,
/// where its installer puts it. Nothing user-specific is hard-coded: the
/// home comes from the caller.
pub fn find_windows(path_var: &str, home: Option<&Path>) -> Option<PathBuf> {
    find_in(path_var, home, "zorkyn.exe", &["bin"])
}

/// Mac / Linux: the login PATH, then the two home folders an install
/// script usually picks. Called only off Windows; the tests run it everywhere.
#[cfg_attr(windows, allow(dead_code))]
pub fn find_unix(path_var: &str, home: Option<&Path>) -> Option<PathBuf> {
    find_in(path_var, home, "zorkyn", &[".local/bin", "bin"])
}

fn find_in(
    path_var: &str,
    home: Option<&Path>,
    name: &str,
    home_dirs: &[&str],
) -> Option<PathBuf> {
    std::env::split_paths(path_var)
        .filter(|d| !d.as_os_str().is_empty())
        .map(|d| d.join(name))
        .chain(
            home.into_iter().flat_map(|h| {
                home_dirs.iter().map(move |d| h.join(d).join(name))
            }),
        )
        .find(|p| p.is_file())
}

/// What one `zorkyn open` came back as.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The tab exists. `needs_window`: nothing shows the session.
    Opened { opened: Opened, needs_window: bool },
    /// zorkyn is not installed where the project lives.
    NotInstalled,
    /// It ran and did not make a tab; the reason is for the notice.
    Failed(String),
}

/// Read an exit code and the two streams. Exit 0 with no `tab=` line is a
/// failure too: a launch DevGo cannot confirm is not reported as done.
pub fn interpret(code: Option<i32>, stdout: &str, stderr: &str) -> Outcome {
    let first_err = stderr
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|l| l.trim_start_matches("zorkyn open: ").to_string());
    match code {
        Some(0) => match parse_opened(stdout) {
            Some(opened) => Outcome::Opened {
                opened,
                needs_window: stderr.contains(NO_WINDOW_HINT),
            },
            None => Outcome::Failed("zorkyn gave no tab line".to_string()),
        },
        Some(NOT_INSTALLED) => Outcome::NotInstalled,
        // 2 is a flag zorkyn does not know: a build from before `open`
        Some(2) => Outcome::Failed(
            "this zorkyn has no `open` command; update it".to_string(),
        ),
        Some(n) => Outcome::Failed(
            first_err.unwrap_or_else(|| format!("zorkyn exited with {n}")),
        ),
        None => Outcome::Failed("zorkyn was stopped".to_string()),
    }
}

/// The notice for a launch that went the normal way instead.
pub fn fallback_notice(reason: &str) -> String {
    format!(
        "Zorkyn tab not opened: {reason}. Opened a terminal window instead."
    )
}

pub const NOT_FOUND: &str = "zorkyn not found";
pub const NOT_IN_WSL: &str = "zorkyn is not installed in this distro";
pub const TMUX_NOT_BUILT: &str = "tmux tabs are not built yet";

/// Run, wait at most `timeout`, and hand back the exit code and both
/// streams. Readers drain the pipes on their own threads, so a chatty child
/// cannot fill one and stall.
pub fn run_capture(
    inv: &Invocation,
    env: &[(String, String)],
    timeout: Duration,
) -> Result<(Option<i32>, String, String), String> {
    let mut cmd = Command::new(&inv.exe);
    cmd.args(&inv.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd.quiet();
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("cannot start {}: {e}", inv.exe))?;
    let drain = |r: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut r) = r {
                let mut buf = Vec::new();
                let _ = r.read_to_end(&mut buf);
                s = String::from_utf8_lossy(&buf).into_owned();
            }
            s
        })
    };
    let out = drain(child.stdout.take().map(|r| Box::new(r) as _));
    let err = drain(child.stderr.take().map(|r| Box::new(r) as _));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{} did not answer in {}s",
                    inv.exe,
                    timeout.as_secs()
                ));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    Ok((status.code(), stdout, stderr))
}

/// Where the project lives, as far as a tab is concerned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Host<'a> {
    Windows { dir: &'a str },
    Wsl { distro: &'a str, linux_dir: &'a str },
    Unix { dir: &'a str },
}

/// What the caller does next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Next {
    /// The tab is open. `attach_unix`: open the default terminal on this
    /// zorkyn, because nothing shows the session.
    Done { attach_unix: Option<String> },
    /// Launch the normal way, and show this notice.
    Fallback(String),
}

/// The zorkyn request for one agent launch, the attach window when one is
/// needed, and the decision to fall back. `find` and `run` are passed in so
/// a test can drive every branch without a zorkyn.
pub fn open_agent(
    host: &Host,
    agent: &str,
    find: impl Fn() -> Option<PathBuf>,
    run: impl Fn(&Invocation) -> Result<(Option<i32>, String, String), String>,
) -> Next {
    let (inv, zorkyn) = match host {
        Host::Windows { dir } | Host::Unix { dir } => {
            let Some(z) = find() else {
                return Next::Fallback(fallback_notice(NOT_FOUND));
            };
            let z = z.to_string_lossy().into_owned();
            let inv = if matches!(host, Host::Windows { .. }) {
                windows_open(&z, dir, agent)
            } else {
                unix_open(&z, dir, agent)
            };
            (inv, Some(z))
        }
        Host::Wsl { distro, linux_dir } => {
            (wsl_open(distro, linux_dir, agent), None)
        }
    };
    let outcome = match run(&inv) {
        Ok((code, out, err)) => interpret(code, &out, &err),
        Err(e) => Outcome::Failed(e),
    };
    log_line!("multiplexer: zorkyn open -> {outcome:?}");
    match outcome {
        Outcome::NotInstalled => Next::Fallback(fallback_notice(NOT_IN_WSL)),
        Outcome::Failed(why) => Next::Fallback(fallback_notice(&why)),
        Outcome::Opened { needs_window, .. } => match host {
            // --attach-window already opened one when it was needed
            Host::Windows { .. } => Next::Done { attach_unix: None },
            Host::Wsl { distro, .. } => {
                if needs_window {
                    // the tab is there either way; a window that will not
                    // open is logged, not turned into a second launch
                    let w = wsl_attach_window(distro);
                    let spawned = Command::new(&w.exe)
                        .args(&w.args)
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .quiet()
                        .spawn();
                    if let Err(e) = spawned {
                        log_line!("multiplexer: attach window: {e}");
                    }
                }
                Next::Done { attach_unix: None }
            }
            Host::Unix { .. } => Next::Done {
                attach_unix: needs_window.then(|| zorkyn.unwrap_or_default()),
            },
        },
    }
}

/// The real `run` for `open_agent`.
pub fn run_default(
    inv: &Invocation,
) -> Result<(Option<i32>, String, String), String> {
    run_capture(inv, &[], OPEN_TIMEOUT)
}

/// The real `find` for the host DevGo runs on.
pub fn find_here() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
        find_windows(&super::platform::win_path::fresh_path(), home.as_deref())
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        find_unix(&super::platform::login_path(), home.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_created_and_focused() {
        assert_eq!(
            parse_opened("tab=3 pane=17 created\n"),
            Some(Opened {
                tab: 3,
                pane: 17,
                created: true
            })
        );
        assert_eq!(
            parse_opened("tab=0 pane=2 focused\r\n"),
            Some(Opened {
                tab: 0,
                pane: 2,
                created: false
            })
        );
    }

    #[test]
    fn a_banner_before_the_tab_line_is_skipped() {
        assert_eq!(
            parse_opened("welcome to ubuntu\n\ntab=1 pane=4 created\n"),
            Some(Opened {
                tab: 1,
                pane: 4,
                created: true
            })
        );
    }

    #[test]
    fn a_line_that_is_not_the_contract_is_none() {
        for s in [
            "",
            "tab=x pane=1 created",
            "tab=1 pane=1 opened",
            "tab=1 created",
            "pane=1 tab=1 created",
        ] {
            assert_eq!(parse_opened(s), None, "{s:?}");
        }
    }

    #[test]
    fn windows_line_attaches_a_window_and_passes_the_agent_whole() {
        let i =
            windows_open(r"C:\tools\zorkyn.exe", r"D:\code\my app", "claude");
        assert_eq!(i.exe, r"C:\tools\zorkyn.exe");
        assert_eq!(
            i.args,
            v(&[
                "open",
                "--cwd",
                r"D:\code\my app",
                "--attach-window",
                "--",
                "claude"
            ])
        );
    }

    #[test]
    fn unix_line_has_no_attach_window() {
        let i = unix_open("/usr/local/bin/zorkyn", "/home/u/p", "codex");
        assert_eq!(i.args, v(&["open", "--cwd", "/home/u/p", "--", "codex"]));
    }

    #[test]
    fn wsl_line_runs_a_login_bash_with_exact_arguments() {
        let i = wsl_open("Ubuntu", "/home/u/it's here", "claude");
        assert_eq!(i.exe, "wsl.exe");
        assert_eq!(
            i.args[..7],
            v(&[
                "-d",
                "Ubuntu",
                "--cd",
                "/home/u/it's here",
                "-e",
                "bash",
                "-lc"
            ])
        );
        assert_eq!(
            i.args[7],
            "command -v zorkyn >/dev/null 2>&1 || exit 127\n\
             exec zorkyn open --cwd '/home/u/it'\\''s here' -- 'claude'"
        );
    }

    #[test]
    fn wsl_attach_window_is_one_new_wt_window() {
        assert_eq!(
            wsl_attach_window("Ubuntu").args,
            v(&[
                "-w",
                "new",
                "wsl.exe",
                "-d",
                "Ubuntu",
                "-e",
                "bash",
                "-lc",
                "exec zorkyn"
            ])
        );
    }

    #[test]
    fn interprets_every_exit() {
        let ok = interpret(Some(0), "tab=2 pane=5 created\n", "");
        assert_eq!(
            ok,
            Outcome::Opened {
                opened: Opened {
                    tab: 2,
                    pane: 5,
                    created: true
                },
                needs_window: false
            }
        );
        let lonely = interpret(
            Some(0),
            "tab=2 pane=5 focused\n",
            "zorkyn open: no window shows this session - run `zorkyn` to see it\n",
        );
        assert!(matches!(
            lonely,
            Outcome::Opened {
                needs_window: true,
                ..
            }
        ));
        assert_eq!(interpret(Some(127), "", ""), Outcome::NotInstalled);
        assert!(
            matches!(interpret(Some(2), "", "usage"), Outcome::Failed(s) if s.contains("update"))
        );
        assert_eq!(
            interpret(
                Some(1),
                "",
                "zorkyn open: cannot reach the server: boom\n"
            ),
            Outcome::Failed("cannot reach the server: boom".into())
        );
        assert_eq!(
            interpret(Some(1), "", ""),
            Outcome::Failed("zorkyn exited with 1".into())
        );
        assert!(matches!(interpret(Some(0), "", ""), Outcome::Failed(_)));
        assert!(matches!(interpret(None, "", ""), Outcome::Failed(_)));
    }

    #[test]
    fn finds_on_path_then_in_home_bin() {
        let root = std::env::temp_dir()
            .join(format!("devgo-mux-find-{}", std::process::id()));
        let on_path = root.join("p");
        let home = root.join("h");
        std::fs::create_dir_all(&on_path).unwrap();
        std::fs::create_dir_all(home.join("bin")).unwrap();
        std::fs::create_dir_all(home.join(".local/bin")).unwrap();
        let path_var = std::env::join_paths([&on_path]).unwrap();
        let path_var = path_var.to_string_lossy();

        assert_eq!(find_windows(&path_var, Some(&home)), None);
        std::fs::write(home.join("bin/zorkyn.exe"), b"").unwrap();
        assert_eq!(
            find_windows(&path_var, Some(&home)),
            Some(home.join("bin").join("zorkyn.exe"))
        );
        std::fs::write(on_path.join("zorkyn.exe"), b"").unwrap();
        assert_eq!(
            find_windows(&path_var, Some(&home)),
            Some(on_path.join("zorkyn.exe"))
        );

        assert_eq!(find_unix(&path_var, Some(&home)), None);
        std::fs::write(home.join(".local/bin/zorkyn"), b"").unwrap();
        assert_eq!(
            find_unix(&path_var, Some(&home)),
            Some(home.join(".local/bin").join("zorkyn"))
        );
        assert_eq!(find_unix("", None), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn not_found_falls_back_without_running_anything() {
        let ran = RefCell::new(0);
        let next = open_agent(
            &Host::Windows { dir: r"C:\p" },
            "claude",
            || None,
            |_| {
                *ran.borrow_mut() += 1;
                Ok((Some(0), String::new(), String::new()))
            },
        );
        assert_eq!(next, Next::Fallback(fallback_notice(NOT_FOUND)));
        assert_eq!(*ran.borrow(), 0);
        let unix = open_agent(
            &Host::Unix { dir: "/p" },
            "claude",
            || None,
            |_| unreachable!(),
        );
        assert_eq!(unix, Next::Fallback(fallback_notice(NOT_FOUND)));
    }

    #[test]
    fn windows_opens_through_the_found_zorkyn() {
        let seen = RefCell::new(None);
        let next = open_agent(
            &Host::Windows { dir: r"C:\p" },
            "claude",
            || Some(PathBuf::from(r"C:\z\zorkyn.exe")),
            |i| {
                *seen.borrow_mut() = Some(i.clone());
                Ok((Some(0), "tab=1 pane=1 created\n".into(), String::new()))
            },
        );
        assert_eq!(next, Next::Done { attach_unix: None });
        assert_eq!(
            seen.into_inner().unwrap(),
            windows_open(r"C:\z\zorkyn.exe", r"C:\p", "claude")
        );
    }

    #[test]
    fn a_failed_open_falls_back_with_the_reason() {
        let next = open_agent(
            &Host::Windows { dir: r"C:\p" },
            "claude",
            || Some(PathBuf::from("z")),
            |_| {
                Ok((
                    Some(1),
                    String::new(),
                    "zorkyn open: C:\\p: not found\n".into(),
                ))
            },
        );
        assert_eq!(next, Next::Fallback(fallback_notice(r"C:\p: not found")));
        let timed_out = open_agent(
            &Host::Unix { dir: "/p" },
            "claude",
            || Some(PathBuf::from("z")),
            |_| Err("z did not answer in 20s".into()),
        );
        assert!(
            matches!(timed_out, Next::Fallback(s) if s.contains("did not answer"))
        );
    }

    #[test]
    fn wsl_without_zorkyn_falls_back() {
        let next = open_agent(
            &Host::Wsl {
                distro: "Ubuntu",
                linux_dir: "/home/u/p",
            },
            "claude",
            || unreachable!("WSL looks inside the distro, not on Windows"),
            |i| {
                assert_eq!(i.exe, "wsl.exe");
                Ok((Some(127), String::new(), String::new()))
            },
        );
        assert_eq!(next, Next::Fallback(fallback_notice(NOT_IN_WSL)));
    }

    #[test]
    fn unix_with_no_client_asks_for_a_terminal_on_zorkyn() {
        let lonely = |_: &Invocation| {
            Ok((
                Some(0),
                "tab=1 pane=1 created\n".to_string(),
                format!(
                    "zorkyn open: {NO_WINDOW_HINT} - run `zorkyn` to see it\n"
                ),
            ))
        };
        let next = open_agent(
            &Host::Unix { dir: "/p" },
            "claude",
            || Some(PathBuf::from("/opt/zorkyn")),
            lonely,
        );
        assert_eq!(
            next,
            Next::Done {
                attach_unix: Some("/opt/zorkyn".into())
            }
        );
        let shown = open_agent(
            &Host::Unix { dir: "/p" },
            "claude",
            || Some(PathBuf::from("/opt/zorkyn")),
            |_| Ok((Some(0), "tab=1 pane=1 focused\n".into(), String::new())),
        );
        assert_eq!(shown, Next::Done { attach_unix: None });
    }

    /// Hands-on against a real zorkyn, on a PRIVATE socket and app-data
    /// folder, so no running session is touched. No window: the request is
    /// the Windows one without --attach-window (`unix_open`). Run with
    /// `cargo test --lib zorkyn_hands_on -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs zorkyn installed; starts and stops a private server"]
    fn zorkyn_hands_on_created_then_focused() {
        let Some(z) = find_here() else {
            panic!("zorkyn not found");
        };
        let z = z.to_string_lossy().into_owned();
        let pid = std::process::id();
        let scratch = std::env::temp_dir().join(format!("devgo-zorkyn-{pid}"));
        let project = scratch.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let sock = if cfg!(windows) {
            format!(r"\\.\pipe\zorkyn-devgo-{pid}")
        } else {
            scratch.join("sock").to_string_lossy().into_owned()
        };
        let mut env = vec![("ZORKYN_SOCKET".to_string(), sock.clone())];
        for k in [
            "APPDATA",
            "LOCALAPPDATA",
            "XDG_STATE_HOME",
            "XDG_CONFIG_HOME",
        ] {
            let d = scratch.join(k);
            std::fs::create_dir_all(&d).unwrap();
            env.push((k.to_string(), d.to_string_lossy().into_owned()));
        }
        let dir = project.to_string_lossy().into_owned();
        let outs = RefCell::new(Vec::new());
        let run = |i: &Invocation| {
            let r = run_capture(i, &env, OPEN_TIMEOUT);
            outs.borrow_mut().push(r.clone());
            r
        };
        let first = open_agent(
            &Host::Unix { dir: &dir },
            "whoami",
            || Some(z.clone().into()),
            run,
        );
        let second = open_agent(
            &Host::Unix { dir: &dir },
            "whoami",
            || Some(z.clone().into()),
            run,
        );
        let kill = run_capture(
            &Invocation {
                exe: z.clone(),
                args: vec!["kill-server".into()],
            },
            &env,
            OPEN_TIMEOUT,
        );
        for o in outs.borrow().iter() {
            println!("open -> {o:?}");
        }
        println!("socket {sock}; kill-server -> {kill:?}");
        let _ = std::fs::remove_dir_all(&scratch);
        let o = outs.into_inner();
        let line = |n: usize| o[n].as_ref().unwrap().1.clone();
        assert!(line(0).trim_end().ends_with(" created"), "{}", line(0));
        assert!(line(1).trim_end().ends_with(" focused"), "{}", line(1));
        assert!(matches!(first, Next::Done { .. }), "{first:?}");
        assert!(matches!(second, Next::Done { .. }), "{second:?}");
        assert_eq!(kill.unwrap().0, Some(0));
    }

    /// Hands-on: the real WSL request against a running distro. Set
    /// DEVGO_HANDS_ON_DISTRO; prints what zorkyn (or its absence) answered.
    /// Opens nothing: a missing zorkyn is a fallback the caller launches.
    #[test]
    #[ignore = "needs a running WSL distro named in DEVGO_HANDS_ON_DISTRO"]
    fn zorkyn_hands_on_wsl_probe() {
        let distro = std::env::var("DEVGO_HANDS_ON_DISTRO").unwrap();
        let host = Host::Wsl {
            distro: &distro,
            linux_dir: "/tmp",
        };
        let raw = run_default(&wsl_open(&distro, "/tmp", "true"));
        println!("wsl -> {raw:?}");
        if let Ok((Some(127), ..)) = raw {
            let next = open_agent(&host, "true", || None, run_default);
            println!("next -> {next:?}");
            assert_eq!(next, Next::Fallback(fallback_notice(NOT_IN_WSL)));
        }
    }

    #[test]
    fn the_setting_reads_and_writes_lowercase_and_defaults_to_none() {
        assert_eq!(
            serde_json::to_string(&Multiplexer::Zorkyn).unwrap(),
            "\"zorkyn\""
        );
        assert_eq!(
            serde_json::from_str::<Multiplexer>("\"none\"").unwrap(),
            Multiplexer::None
        );
        assert_eq!(Multiplexer::default(), Multiplexer::None);
    }
}
