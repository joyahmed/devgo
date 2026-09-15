use std::os::windows::process::CommandExt;
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Every `wsl.exe` invocation goes through here.
///
/// `WSL_UTF8=1` makes wsl.exe emit UTF-8. Without it the default is UTF-16LE,
/// and decoding that as UTF-8 turns "Ubuntu-26.04" into
/// "U\0b\0u\0n\0t\0u\0-\02\06\0.\00\04\0" — see `decode`.

fn wsl_command() -> Command {
    let mut cmd = Command::new("wsl");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.env("WSL_UTF8", "1");
    cmd
}

/// `WSL_UTF8` only landed in WSL 0.64; older builds ignore it and still emit
/// UTF-16LE. Sniff the buffer instead of trusting the env var: interior NUL
/// bytes never occur in this command's UTF-8 output, but appear in every other
/// byte of ASCII-range UTF-16LE.

fn decode(bytes: &[u8]) -> String {
    if bytes.contains(&0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

/// Trim whitespace *and* stray NULs. `str::trim` leaves NUL in place — NUL is
/// not whitespace — which is how a bogus "\0" entry used to survive the
/// is-empty filter and register as a second, phantom distro.
fn clean(line: &str) -> &str {
    line.trim_matches(|c: char| c.is_whitespace() || c == '\0')
}

fn run(args: &[&str]) -> Option<String> {
    let output = wsl_command().args(args).output().ok()?;
    if output.status.success() {
        Some(decode(&output.stdout))
    } else {
        None
    }
}

fn parse_list(text: &str) -> Vec<String> {
    text.lines()
        .map(clean)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

pub fn list_distros() -> Vec<String> {
    run(&["-l", "-q"])
        .as_deref()
        .map(parse_list)
        .unwrap_or_default()
}

/// The `*` marker in `wsl -l -v` is structural, so this works on any Windows
/// display language. Parsing `wsl --status` for the literal
/// "Default Distribution:" is localized and never matches on a non-English
/// install.

pub fn default_distro() -> Option<String> {
    if let Some(text) = run(&["-l", "-v"]) {
        for line in text.lines() {
            if let Some(rest) = clean(line).strip_prefix('*') {
                if let Some(name) = rest.split_whitespace().next() {
                    return Some(name.to_string());
                }
            }
        }
    }
    list_distros().into_iter().next()
}

/// Distros that are already running.
///
/// This is a management call: it does **not** start anything. That is what makes
/// it safe as a gate — reading a `\\wsl.localhost\...` path cold-boots the whole
/// VM, so we check liveness this way first and skip the path entirely when the
/// distro is stopped.
pub fn running_distros() -> Vec<String> {
    run(&["-l", "-q", "--running"])
        .as_deref()
        .map(parse_list)
        .unwrap_or_default()
}

pub fn is_running(distro: &str, running: &[String]) -> bool {
    running.iter().any(|d| d.eq_ignore_ascii_case(distro))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact bytes `wsl -l -q` produced on a machine that ignored WSL_UTF8.
    #[test]
    fn decodes_utf16le_output() {
        let bytes: &[u8] = &[
            0x55, 0x00, 0x62, 0x00, 0x75, 0x00, 0x6E, 0x00, 0x74, 0x00, 0x75,
            0x00, 0x2D, 0x00, 0x32, 0x00, 0x36, 0x00, 0x2E, 0x00, 0x30, 0x00,
            0x34, 0x00, 0x0D, 0x00, 0x0A, 0x00,
        ];
        assert_eq!(decode(bytes), "Ubuntu-26.04\r\n");
        assert_eq!(parse_list(&decode(bytes)), vec!["Ubuntu-26.04"]);
    }

    #[test]
    fn decodes_utf8_output() {
        assert_eq!(
            parse_list(&decode(b"Ubuntu-26.04\r\n")),
            vec!["Ubuntu-26.04"]
        );
    }

    /// Regression: a trailing "\0" line used to survive `.trim()` + is-empty and
    /// register as a second distro.
    #[test]
    fn drops_nul_only_lines() {
        assert_eq!(parse_list("Ubuntu-26.04\r\n\0\n"), vec!["Ubuntu-26.04"]);
    }

    #[test]
    fn finds_default_marker_without_locale_text() {
        let listing = "  NAME            STATE           VERSION\n\
                       * Ubuntu-26.04    Stopped         2\n\
                         Debian          Stopped         2\n";
        let default = listing
            .lines()
            .filter_map(|l| clean(l).strip_prefix('*'))
            .filter_map(|rest| rest.split_whitespace().next())
            .next();
        assert_eq!(default, Some("Ubuntu-26.04"));
    }
}

/// How long to wait for a stop command before giving up on it.
///
/// This is the one place a timeout is load-bearing rather than defensive. The
/// whole feature exists for a wedged VM, and a wedged VM is exactly when
/// WSLService stops answering — this machine's System log carries five
/// 30-second WSLService transaction timeouts. Without a bound, the command that
/// fixes the hang would itself hang, taking DevGo with it.
const STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

pub enum StopOutcome {
    /// The command returned and the distro is genuinely no longer running.
    Stopped,
    /// The command returned, but the distro is still listed as running.
    StillRunning,
    /// We gave up waiting.
    TimedOut,
}

fn run_with_timeout(args: &[&str]) -> Result<bool, String> {
    let mut child = wsl_command()
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("could not run wsl: {e}"))?;

    let deadline = std::time::Instant::now() + STOP_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(true),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    // Leave the process alone rather than killing it — wsl.exe is
                    // a thin client, and the work is happening in WSLService.
                    return Ok(false);
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(format!("waiting on wsl: {e}")),
        }
    }
}

/// Stop a single distro, leaving any others (and the VM) alone.
pub fn terminate(distro: &str) -> Result<StopOutcome, String> {
    if !run_with_timeout(&["--terminate", distro])? {
        return Ok(StopOutcome::TimedOut);
    }
    // Never trust the exit code alone — report what is actually true.
    if is_running(distro, &running_distros()) {
        Ok(StopOutcome::StillRunning)
    } else {
        Ok(StopOutcome::Stopped)
    }
}

/// Stop every distro and the VM itself. The escalation, not the default.
pub fn shutdown_all() -> Result<StopOutcome, String> {
    if !run_with_timeout(&["--shutdown"])? {
        return Ok(StopOutcome::TimedOut);
    }
    if running_distros().is_empty() {
        Ok(StopOutcome::Stopped)
    } else {
        Ok(StopOutcome::StillRunning)
    }
}
