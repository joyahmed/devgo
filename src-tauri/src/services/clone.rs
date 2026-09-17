//! git clone into a workspace: the one git operation DevGo performs.
//!
//! Everything else git-shaped in this app reads (chapters 10, 32); this
//! writes, and the rules around it are the three the GitHub group lives
//! under: only on an explicit ask (a Clone button), never on the UI thread
//! (a spawned thread streams progress as events), and a failure leaves the
//! disk exactly as it was. git clone removes a half-made directory when it
//! fails, and the refusals here never let it start on one that exists.
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use serde::Serialize;

use super::platform::paths::windows_to_wsl_path;
use super::platform::wsl;
use super::platform::Quiet;
use super::scanner::distro_of;
use crate::error::AppError;

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
                .quiet()
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

// the platform's own separator, so the path devgo shows is the one
// explorer or finder would. a unc wsl workspace keeps the backslash on
// windows because that is where unc paths exist
const SEP: char = std::path::MAIN_SEPARATOR;

pub fn plan(
    workspace: &str,
    repo_full_name: &str,
    name: &str,
    protocol: Protocol,
) -> Plan {
    let ws = workspace.trim_end_matches(['\\', '/']);
    let dest = format!("{ws}{SEP}{name}");
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

/// A destination that is not one of the workspaces: the picker's own
/// folder chooser. Any folder that exists will do; a path that does not
/// is refused here, not by git halfway in.
pub fn folder_ok(into: &str) -> Result<(), AppError> {
    if std::path::Path::new(into).is_dir() {
        Ok(())
    } else {
        Err(AppError::CloneRefused(format!("{into} is not a folder")))
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

/// One line of git clone --progress stderr, reduced to what a row can
/// show: `Receiving objects:  42% (1234/2938), 1.20 MiB | 2.40 MiB/s`
/// becomes (Receiving objects, 42). A line with no percentage (`Cloning
/// into '…'…`) comes back with None.
pub fn parse_progress(line: &str) -> (String, Option<u8>) {
    let line = line.trim();
    let Some((phase, rest)) = line.split_once(':') else {
        return (line.to_string(), None);
    };
    let pct = rest
        .split('%')
        .next()
        .and_then(|s| s.trim().parse::<u8>().ok())
        .filter(|p| *p <= 100);
    (phase.trim().to_string(), pct)
}

/// Run the clone, calling on_line for every progress line git prints.
/// Blocking; the command wraps it in a thread. --progress makes git print
/// its percentages even without a terminal.
pub fn run(plan: &Plan, mut on_line: impl FnMut(&str)) -> Result<(), AppError> {
    let mut cmd = match &plan.distro {
        Some(d) => {
            let mut c = Command::new("wsl");
            c.env("WSL_UTF8", "1");
            c.args([
                "-d",
                d,
                "-e",
                "git",
                "clone",
                "--progress",
                &plan.url,
                &plan.git_dest,
            ]);
            c
        }
        None => {
            let mut c = Command::new("git");
            // https needs a credential, and DevGo's is gh's. the app is
            // logged in through gh for the whole github lane, but git on this
            // machine may have no helper for github.com — macos ships
            // osxkeychain with no token in it, and `gh auth setup-git` is the
            // step people skip — so a headless clone (no terminal to prompt)
            // dies with "could not read Username for https://github.com". hand
            // git gh's own credential helper for the clone, the same way the
            // launcher hands a child the login PATH (55): gh is on that PATH,
            // so `!gh auth git-credential` resolves. ssh carries its own key
            // and needs none. windows has its own working story (git credential
            // manager ships with git for windows), so it is left alone — the
            // mirror of 55's `not(windows)` PATH seam.
            #[cfg(not(windows))]
            if plan.url.starts_with("https://") {
                c.args([
                    "-c",
                    "credential.https://github.com.helper=!gh auth git-credential",
                ]);
            }
            c.args(["clone", "--progress", &plan.url, &plan.git_dest]);
            c
        }
    };
    let mut child = cmd
        .quiet()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::LaunchFailed(format!("git clone: {e}")))?;

    // git rewrites progress lines in place with \r, so a "line" ends at
    // either terminator
    let mut last_error = String::new();
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            let n = read_until_either(&mut reader, &mut buf)?;
            if n == 0 {
                break;
            }
            let line = String::from_utf8_lossy(&buf).trim().to_string();
            if line.is_empty() {
                continue;
            }
            if line.starts_with("fatal:") || line.starts_with("error:") {
                last_error = line.clone();
            }
            on_line(&line);
        }
    }
    let status = child.wait()?;
    if status.success() {
        Ok(())
    } else if last_error.is_empty() {
        Err(AppError::LaunchFailed(format!(
            "git clone exited with {status}"
        )))
    } else {
        Err(AppError::LaunchFailed(last_error))
    }
}

// read_until for two delimiters: BufRead::read_until takes one byte
fn read_until_either<R: BufRead>(
    r: &mut R,
    buf: &mut Vec<u8>,
) -> std::io::Result<usize> {
    let mut total = 0;
    loop {
        let available = r.fill_buf()?;
        if available.is_empty() {
            return Ok(total);
        }
        let stop = available.iter().position(|b| *b == b'\r' || *b == b'\n');
        match stop {
            Some(i) => {
                buf.extend_from_slice(&available[..i]);
                r.consume(i + 1);
                return Ok(total + i + 1);
            }
            None => {
                let len = available.len();
                buf.extend_from_slice(available);
                r.consume(len);
                total += len;
            }
        }
    }
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

    // a drive and a \\wsl.localhost unc exist only on windows, and the join
    // is the platform's separator, so these two run only there
    #[cfg(windows)]
    #[test]
    fn a_windows_workspace_clones_with_windows_git() {
        let p = plan(r"G:\01_tauri\", "joyahmed/devgo", "devgo", Protocol::Ssh);
        assert_eq!(p.dest, r"G:\01_tauri\devgo");
        assert_eq!(p.distro, None);
        assert_eq!(p.git_dest, r"G:\01_tauri\devgo");
    }

    #[cfg(not(windows))]
    #[test]
    fn a_local_workspace_clones_with_the_local_git() {
        let p = plan(
            "/Users/user/Projects/",
            "joyahmed/devgo",
            "devgo",
            Protocol::Ssh,
        );
        assert_eq!(p.dest, "/Users/user/Projects/devgo");
        assert_eq!(p.distro, None);
        assert_eq!(p.git_dest, "/Users/user/Projects/devgo");
    }

    #[cfg(windows)]
    #[test]
    fn a_wsl_workspace_clones_inside_the_distro_at_the_linux_path() {
        let p = plan(
            r"\\wsl.localhost\Ubuntu-26.04\home\user\projects\01_turbo",
            "user/notes",
            "notes",
            Protocol::Ssh,
        );
        assert_eq!(
            p.dest,
            r"\\wsl.localhost\Ubuntu-26.04\home\user\projects\01_turbo\notes"
        );
        assert_eq!(p.distro.as_deref(), Some("Ubuntu-26.04"));
        assert_eq!(p.git_dest, "/home/user/projects/01_turbo/notes");
    }

    #[test]
    fn a_stopped_distro_is_refused_not_booted() {
        let p = plan(
            r"\\wsl.localhost\Ubuntu-26.04\home\user\p",
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
    fn a_chosen_folder_must_exist() {
        let dir = std::env::temp_dir().join("devgo-clone-into");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(folder_ok(&dir.to_string_lossy()).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
        let err = folder_ok(&dir.to_string_lossy()).unwrap_err().to_string();
        assert!(err.contains("not a folder"), "{err}");
    }

    #[test]
    fn progress_lines_reduce_to_phase_and_percent() {
        assert_eq!(
            parse_progress(
                "Receiving objects:  42% (1234/2938), 1.20 MiB | 2.40 MiB/s"
            ),
            ("Receiving objects".into(), Some(42))
        );
        assert_eq!(
            parse_progress("Resolving deltas: 100% (10/10), done."),
            ("Resolving deltas".into(), Some(100))
        );
        assert_eq!(
            parse_progress("Cloning into 'devgo'..."),
            ("Cloning into 'devgo'...".into(), None)
        );
        assert_eq!(
            parse_progress("remote: Enumerating objects: 55, done."),
            ("remote".into(), None)
        );
    }

    #[test]
    fn read_until_either_splits_on_cr_and_lf() {
        let data = b"a\rbb\nccc";
        let mut r = BufReader::new(&data[..]);
        let mut buf = Vec::new();
        let mut lines = Vec::new();
        loop {
            buf.clear();
            if read_until_either(&mut r, &mut buf).unwrap() == 0 {
                break;
            }
            lines.push(String::from_utf8(buf.clone()).unwrap());
        }
        assert_eq!(lines, vec!["a", "bb", "ccc"]);
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
