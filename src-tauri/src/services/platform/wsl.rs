// off windows there is no wsl.exe and nothing here may go looking for
// one: the three functions that spawn it (run, probe_lines,
// run_with_timeout) each have a not(windows) twin that answers nothing
// without touching a process. every public function sits above one of
// the three, so the seam is at the bottom and the callers are not cfg'd
#[cfg(windows)]
use super::Quiet;
#[cfg(windows)]
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Every `wsl.exe` invocation goes through here.
///
/// `WSL_UTF8=1` makes wsl.exe emit UTF-8. Without it the default is UTF-16LE,
/// and decoding that as UTF-8 turns "Ubuntu-26.04" into
/// "U\0b\0u\0n\0t\0u\0-\02\06\0.\00\04\0" — see `decode`.
#[cfg(windows)]
fn wsl_command() -> Command {
    let mut cmd = Command::new("wsl");
    cmd.quiet();
    cmd.env("WSL_UTF8", "1");
    cmd
}

/// `WSL_UTF8` only landed in WSL 0.64; older builds ignore it and still emit
/// UTF-16LE. Sniff the buffer instead of trusting the env var: interior NUL
/// bytes never occur in this command's UTF-8 output, but appear in every other
/// byte of ASCII-range UTF-16LE.
// off windows only the tests reach it; the bytes it decodes are tested
// on every platform
#[cfg_attr(not(windows), allow(dead_code))]
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

#[cfg(windows)]
fn run(args: &[&str]) -> Option<String> {
    let output = wsl_command().args(args).output().ok()?;
    if output.status.success() {
        Some(decode(&output.stdout))
    } else {
        None
    }
}

// no wsl.exe to ask: the answer a failed spawn gives on windows
#[cfg(not(windows))]
fn run(_args: &[&str]) -> Option<String> {
    None
}

fn parse_list(text: &str) -> Vec<String> {
    text.lines()
        .map(clean)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

// a mac's detect_runtime is a constant and never asks, so these two have
// no caller there; they stay so the stubs beneath them are exercised by
// the same tests on every platform
#[cfg_attr(target_os = "macos", allow(dead_code))]
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
#[cfg_attr(target_os = "macos", allow(dead_code))]
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

// one refresh is three commands back to back (scan, git, stack), each
// gated on the same liveness question; five seconds spans the three and
// nothing more. WSL's own idle shutdown waits a minute, and a stop DevGo
// issues clears the memo outright
const RUNNING_TTL: Duration = Duration::from_secs(5);

// process-wide rather than an AppState field: every service that gates on
// liveness can reach it, and the stop paths clear it from in here
static RUNNING_MEMO: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);

// the decision, kept pure so the ttl rule tests without a clock or a wsl.exe
fn memo_hit(
    entry: Option<&(Instant, Vec<String>)>,
    now: Instant,
    ttl: Duration,
) -> Option<&[String]> {
    let (taken, list) = entry?;
    // now can sit before taken; saturating keeps that a hit, not a panic
    (now.saturating_duration_since(*taken) < ttl).then_some(list.as_slice())
}

/// `running_distros` for the automatic paths: a repeat within the ttl reuses
/// the last answer. The explicit paths (detection, discovery, the WSL
/// control) keep asking wsl.exe, because after "stop this distro" the user
/// is owed the truth, not a five-second-old copy.
pub fn running_distros_memo() -> Vec<String> {
    let now = Instant::now();
    // a poisoned lock means a thread panicked mid-write; the list is still fine
    let mut memo = RUNNING_MEMO.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(list) = memo_hit(memo.as_ref(), now, RUNNING_TTL) {
        return list.to_vec();
    }
    let fresh = running_distros();
    *memo = Some((now, fresh.clone()));
    fresh
}

// a memo that still says running after a stop would send the next scan
// into \\wsl.localhost\, which boots the distro right back. the vm
// watcher clears it too, when the vm has just gone
pub(crate) fn forget_running() {
    *RUNNING_MEMO.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

// ask now and make the answer the memo: the watcher has just seen the vm
// appear, and the chip, the scan and the badge pass that follow read this
// one answer instead of each spawning wsl.exe inside the ttl
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn refresh_running() -> Vec<String> {
    let fresh = running_distros();
    *RUNNING_MEMO.lock().unwrap_or_else(|e| e.into_inner()) =
        Some((Instant::now(), fresh.clone()));
    fresh
}

/// Run a "print what exists" script in a distro and return its lines.
///
/// The exit status is ignored on purpose. These scripts are all
/// `for x in ...; do test && echo; done`, and a shell loop exits with the
/// status of its last iteration: a missing last candidate makes the whole
/// probe "fail" after printing perfectly good output. A spawn failure is an
/// empty vec too, which is the honest answer for optional discovery.
#[cfg(windows)]
pub fn probe_lines(distro: &str, script: &str) -> Vec<String> {
    let Ok(out) = wsl_command()
        .args(["-d", distro, "-e", "bash", "-lc", script])
        .output()
    else {
        return Vec::new();
    };
    parse_list(&decode(&out.stdout))
}

// no distro can exist here, so no script runs: nothing matched
#[cfg(not(windows))]
pub fn probe_lines(_distro: &str, _script: &str) -> Vec<String> {
    Vec::new()
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

    fn entry(taken: Instant) -> (Instant, Vec<String>) {
        (taken, vec!["Ubuntu-26.04".to_string()])
    }

    #[test]
    fn running_memo_misses_when_empty() {
        assert_eq!(memo_hit(None, Instant::now(), RUNNING_TTL), None);
    }

    #[test]
    fn running_memo_hits_inside_ttl() {
        let now = Instant::now();
        let e = entry(now);
        let ttl = Duration::from_secs(5);
        assert_eq!(
            memo_hit(Some(&e), now + Duration::from_secs(4), ttl),
            Some(&["Ubuntu-26.04".to_string()][..])
        );
    }

    /// Exclusive at the boundary: "5 s" means at most five, not five-and-a-bit.
    #[test]
    fn running_memo_misses_at_and_past_ttl() {
        let now = Instant::now();
        let e = entry(now);
        let ttl = Duration::from_secs(5);
        assert_eq!(memo_hit(Some(&e), now + ttl, ttl), None);
        assert_eq!(
            memo_hit(Some(&e), now + Duration::from_secs(60), ttl),
            None
        );
    }

    /// Clock skew between threads must read as fresh, not panic.
    #[test]
    fn running_memo_tolerates_now_before_taken() {
        let now = Instant::now();
        let e = entry(now + Duration::from_secs(1));
        assert!(memo_hit(Some(&e), now, Duration::from_secs(5)).is_some());
    }

    // every public entry point answers nothing from the stubs: no
    // distros, no lines, and a stop is an error, not a fake success
    #[cfg(not(windows))]
    #[test]
    fn off_windows_every_answer_is_nothing() {
        assert!(list_distros().is_empty());
        assert_eq!(default_distro(), None);
        assert!(running_distros().is_empty());
        assert!(running_distros_memo().is_empty());
        assert!(probe_lines("Ubuntu-26.04", "echo hi").is_empty());
        assert!(terminate("Ubuntu-26.04").is_err());
        assert!(shutdown_all().is_err());
    }
}

/// How long to wait for a stop command before giving up on it.
///
/// This is the one place a timeout is load-bearing rather than defensive. The
/// whole feature exists for a wedged VM, and a wedged VM is exactly when
/// WSLService stops answering — this machine's System log carries five
/// 30-second WSLService transaction timeouts. Without a bound, the command that
/// fixes the hang would itself hang, taking DevGo with it.
#[cfg(windows)]
const STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

pub enum StopOutcome {
    /// The command returned and the distro is genuinely no longer running.
    Stopped,
    /// The command returned, but the distro is still listed as running.
    StillRunning,
    /// We gave up waiting.
    TimedOut,
}

// off windows a stop is an error, not a silent stopped: a stop request
// that reaches here on a mac is a bug in whoever showed the control
#[cfg(not(windows))]
fn run_with_timeout(_args: &[&str]) -> Result<bool, String> {
    Err("WSL does not exist on this platform".to_string())
}

#[cfg(windows)]
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
    let stopped = run_with_timeout(&["--terminate", distro])?;
    // after the stop, not before, so a pass that overlapped it cannot
    // re-memoise "running"; even on a timeout, since the stop may still land
    forget_running();
    if !stopped {
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
    let stopped = run_with_timeout(&["--shutdown"])?;
    forget_running();
    if !stopped {
        return Ok(StopOutcome::TimedOut);
    }
    if running_distros().is_empty() {
        Ok(StopOutcome::Stopped)
    } else {
        Ok(StopOutcome::StillRunning)
    }
}
