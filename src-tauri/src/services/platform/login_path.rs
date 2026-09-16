//! The PATH a Mac app does not get. Started from the Dock, Finder or
//! Spotlight an app inherits launchd's environment: PATH is
//! `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else. `code`, `zed`, `tmux`,
//! `brew` and every nvm CLI live in directories only `~/.zprofile` and
//! `~/.zshrc` add, so a launcher that spawns `code "{path}"` from that
//! environment says "not installed" on a machine that runs it ten times a
//! day. Solved once, here: ask the login shell what PATH it ends up with,
//! remember the answer for the life of the process, hand it to every
//! child. Not a hardcoded list: `~/.nvm/versions/node/v24.11.1/bin` is
//! not a guess anyone can make; the shell knows.

use std::process::Command;
use std::sync::OnceLock;

/// The user's login-shell PATH, resolved once per process. On Windows the
/// process PATH, which is already the user's; elsewhere what `$SHELL -ilc`
/// ends up with, or a fallback when the shell cannot be asked.
#[cfg_attr(windows, allow(dead_code))]
pub fn login_path() -> String {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(resolve).clone()
}

/// Give a child the login-shell PATH. A no-op on Windows.
#[cfg_attr(windows, allow(dead_code))]
pub fn with_login_path(cmd: &mut Command) -> &mut Command {
    #[cfg(not(windows))]
    {
        cmd.env("PATH", login_path());
    }
    cmd
}

#[cfg(windows)]
#[allow(dead_code)]
fn resolve() -> String {
    std::env::var("PATH").unwrap_or_default()
}

// -l so ~/.zprofile runs (brew shellenv lives there on a stock mac), -i so
// ~/.zshrc runs too (nvm, bun, cargo: the file people know). printf %s
// prints no trailing newline, so whatever an rc file printed on the way
// sits before the last newline and is cut off; only the last line is the
// PATH. bounded: an rc that waits on a prompt would otherwise hang the
// first launch forever. stdin closed so nothing can wait on it; on a
// timeout the child is left to finish on its own, once per process it is
// not worth a kill, and the fallback answers instead
#[cfg(not(windows))]
fn resolve() -> String {
    use std::process::Stdio;
    use std::sync::mpsc;
    use std::time::Duration;

    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string());

    let child = Command::new(&shell)
        .args(["-ilc", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(child) = child else {
        return fallback();
    };

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(out)) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let last = text.rsplit('\n').next().unwrap_or("").trim();
            // a path is a list of directories; a line without a / is the
            // rc file talking, not the shell answering
            if last.contains('/') {
                return last.to_string();
            }
            fallback()
        }
        _ => fallback(),
    }
}

// the PATH we have plus the two directories homebrew installs to (apple
// silicon, then intel): enough to find tmux and brew, which is the floor
#[cfg(not(windows))]
fn fallback() -> String {
    fallback_from(std::env::var_os("PATH"))
}

// pure, so the test hands it a PATH of its own instead of this shell's
#[cfg(not(windows))]
fn fallback_from(path: Option<std::ffi::OsString>) -> String {
    let mut entries: Vec<std::path::PathBuf> = path
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for extra in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let extra = std::path::PathBuf::from(extra);
        if !entries.contains(&extra) {
            entries.push(extra);
        }
    }
    std::env::join_paths(entries)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    // the floor: whatever the shell said, the system directory is in it,
    // and an answer without a shell is the rc file's noise
    #[test]
    fn the_login_path_is_a_real_path() {
        let path = login_path();
        assert!(!path.is_empty());
        let entries: Vec<_> = std::env::split_paths(&path).collect();
        assert!(
            entries
                .iter()
                .any(|e| e.join("sh").is_file() || e.join("cmd.exe").is_file()),
            "no shell on the resolved PATH: {path}"
        );
    }

    // memoised: the shell is asked once, and two calls agree byte for byte
    #[test]
    fn the_answer_is_stable_within_a_process() {
        assert_eq!(login_path(), login_path());
    }

    #[cfg(not(windows))]
    #[test]
    fn the_fallback_adds_homebrew_without_duplicating_it() {
        let path = fallback_from(Some("/usr/bin:/opt/homebrew/bin".into()));
        assert_eq!(path, "/usr/bin:/opt/homebrew/bin:/usr/local/bin");
        assert_eq!(fallback_from(None), "/opt/homebrew/bin:/usr/local/bin");
    }

    #[cfg(not(windows))]
    #[test]
    fn a_child_gets_the_login_path_in_its_environment() {
        let out = with_login_path(&mut Command::new("/bin/sh"))
            .args(["-c", "printf %s \"$PATH\""])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout), login_path());
    }
}
