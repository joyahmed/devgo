//! The runtime log: one file, beside `instance.lock`, that a user on a
//! platform we cannot reach can attach to a bug report.
//!
//! Why this exists rather than `log` + `tauri-plugin-log`: nothing in this
//! crate needs levels, targets, filters or a global dispatcher. It needs
//! eight lines a year to survive being launched from the Dock, where stderr
//! goes nowhere. That is an OpenOptions and a timestamp, and the house
//! already hand-rolls things this size (`single_instance.rs` hand-rolls a
//! TCP handshake). No dependency is added for it.
//!
//! Three promises, in order of how badly breaking them would hurt:
//!
//! 1. **It cannot take the app down.** Every path here returns `()` or is
//!    `let _ =`. There is no `unwrap`, no `expect`, no index, no panic. An
//!    unwritable directory, a full disk, a file someone chmod'd to 0400, a
//!    path that is a directory: all of them end as an ignored `io::Error`
//!    and the line still reaches stderr.
//! 2. **It cannot block startup.** One `open`, one `write_all`, one `close`
//!    per line, on the calling thread. No lock, no channel, no background
//!    thread to join, no buffering that would need a flush at exit - a log
//!    that loses the last line before a crash is the one line you wanted.
//! 3. **It cannot grow without bound.** See `MAX_BYTES`.
//!
//! Concurrency: two DevGo instances racing is the normal case for a second
//! or so at every double launch, and both of them log. The file is opened
//! with `append`, which is `O_APPEND` / `FILE_APPEND_DATA`, so each
//! `write_all` of a whole line lands at the then-current end of file; the
//! two processes interleave *lines*, never bytes within a line. Nothing is
//! locked, because a lock is a thing that can be held by a process that
//! died.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// The file name, in the app data dir. Not `startup.log`: that one is the
/// opt-in stopwatch `commands::mark_startup` writes under a different root.
pub const FILE_NAME: &str = "devgo.log";

/// The rotated copy. One, not a numbered series.
pub const OLD_FILE_NAME: &str = "devgo.log.old";

/// 1 MiB, which is on the order of ten thousand lines - months of a log
/// that only writes when something refused.
///
/// Rotation is rename-to-`.old`, not truncate-and-restart. Truncating
/// throws away exactly the history that precedes the event being
/// diagnosed, and the crossing of the cap is not correlated with anything,
/// so it would land mid-incident as often as not. Keeping one `.old`
/// guarantees at least one full cap of history is always on disk, and
/// bounds the whole facility at 2 MiB - small enough that no user ever
/// deletes it to get space back, which is the failure mode an uncapped log
/// actually has.
pub const MAX_BYTES: u64 = 1024 * 1024;

/// Set once, in `lib.rs` setup, from the same `app_data_dir` that
/// `instance.lock` and every store are given. Not computed here: a second
/// opinion about where the app data dir is would be a second app data dir.
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Point the log at `app_data_dir` and return the file it will write.
///
/// Called once, before anything that logs. The directory is assumed to
/// exist (setup's `create_dir_all` ran); `append_to` copes if it does not.
pub fn init(app_data_dir: &Path) -> PathBuf {
    let path = app_data_dir.join(FILE_NAME);
    let _ = LOG_PATH.set(path.clone());
    LOG_PATH.get().cloned().unwrap_or(path)
}

/// Where the log is, or `None` before `init` - which is only the window
/// between process start and setup.
pub fn log_path() -> Option<PathBuf> {
    LOG_PATH.get().cloned()
}

/// One line, to stderr and to the file. Best effort on both halves.
///
/// stderr keeps the line verbatim, so a developer running from a terminal
/// sees exactly what `eprintln!` used to print; the file copy gets the
/// timestamp in front.
pub fn write(line: &str) {
    eprintln!("{line}");
    append(line);
}

/// The file half alone, for a line stderr has already had.
pub fn append(line: &str) {
    let Some(path) = log_path() else {
        return;
    };
    let _ = append_to(&path, &stamped(now_millis(), line));
}

/// Format and both destinations, in the shape `eprintln!` had.
macro_rules! log_line {
    ($($arg:tt)*) => {
        $crate::services::runtime_log::write(&format!($($arg)*))
    };
}
pub(crate) use log_line;

/// What a session opens with. Without the version and the os, a report of
/// "the window did not come up" costs a round trip before it says anything.
pub fn session_header(version: &str) {
    append(&format!(
        "[DevGo] --- start: v{version} {} {} pid {} ---",
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::process::id()
    ));
}

// ── the ui's half ───────────────────────────────────────────────────────

/// The tag that separates a line the webview wrote from a line this crate
/// wrote. `[DevGo]` is the backend's; `[DevGo/ui]` sorts beside it in any
/// listing, greps as `/ui]`, and tells a reader at a glance which side of
/// the IPC boundary a claim came from - which matters, because the two
/// sides disagree about things like "the drawer is open" and the log is
/// where that disagreement has to be visible.
pub const UI_PREFIX: &str = "[DevGo/ui]";

/// The longest line the frontend may send, in characters, not bytes: the
/// truncation has to land on a char boundary or the write panics, and
/// counting the thing we are slicing by is the way not to get that wrong.
///
/// 512 is about six times the longest line either side writes today and
/// still an order of magnitude under a line anyone would read, so it cuts
/// off a runaway `JSON.stringify` of a repo list without ever cutting off
/// a sentence someone wrote on purpose. A cut line ends in `…`, so a
/// reader is never left guessing whether the log or the code stopped
/// short.
pub const MAX_UI_CHARS: usize = 512;

/// How many lines the webview gets per process. The 1 MiB cap already
/// makes "fill the disk" impossible; this is about the other failure, a
/// render loop that logs every frame and pushes the backend's lines out
/// through rotation before anyone reads them. At the cap above, 2000
/// lines is at most a quarter of the live file, so what the backend said
/// about this session always survives whatever the frontend does.
///
/// Per process and not per second: a rate limiter needs a clock, a window
/// and a decision about what to do with the lines it drops, and none of
/// that is a few honest lines. A budget is one counter.
pub const MAX_UI_LINES: usize = 2_000;

/// Lines spent. Relaxed: the only question asked of it is "have we gone
/// past 2000", and no other memory is ordered against the answer.
static UI_LINES: AtomicUsize = AtomicUsize::new(0);

/// One line from the webview, tagged, flattened, bounded and spent from
/// the budget. Returns `()` on every path, like the rest of this module.
pub fn ui(raw: &str) {
    let spent = UI_LINES.fetch_add(1, Ordering::Relaxed);
    if spent > MAX_UI_LINES {
        return;
    }
    if spent == MAX_UI_LINES {
        append(&format!(
            "{UI_PREFIX} budget spent: {MAX_UI_LINES} lines this session, \
             the rest are dropped"
        ));
        return;
    }
    append(&ui_line(raw));
}

/// The tag, then the line, as one line.
pub fn ui_line(raw: &str) -> String {
    format!("{UI_PREFIX} {}", flattened(raw, MAX_UI_CHARS))
}

/// One line's worth of text that came from the webview, made safe to be a
/// line.
///
/// Every control character becomes a space. A newline in particular: the
/// file's unit is a line, a reader greps it by line, and a frontend that
/// could send `\n[DevGo] everything is fine` could forge a backend line.
/// Replacing rather than stripping keeps the length honest, so the `…`
/// means what it says. The cut counts characters, not bytes, because
/// slicing a multi-byte character in half panics.
fn flattened(raw: &str, max: usize) -> String {
    let kept: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(max)
        .collect();
    let cut = if raw.chars().count() > max { "…" } else { "" };
    format!("{kept}{cut}")
}

// ── the command boundary ────────────────────────────────────────────────

/// One line per Tauri command invocation, so that "did the UI actually
/// call this command?" has an answer on a machine we cannot attach a
/// debugger to.
///
/// ⭐ The point is the *negative* case. A tester on macOS - where CDP
/// cannot attach to a WKWebView - reported that she could not tell whether
/// the WSL panel invokes `wsl_config_report` in the no-WSL state, because
/// nothing logged any invocation at all: an empty log proved nothing,
/// since the probe had no positive control. With this line, the log names
/// every call, so a command that is *absent* from a window in which other
/// commands appear is absent because it did not run.
///
/// ⛔ The command name, and nothing else. Arguments here carry filesystem
/// paths, hostnames, ssh users and workspace names, and `devgo.log` is a
/// file a user pastes into an issue on a public repo. There is no argument
/// worth that.
pub const INVOKE_PREFIX: &str = "[DevGo] invoke";

/// Command names are `[a-z0-9_]` in this crate, but the name reaching the
/// invoke handler is whatever the webview typed - an unknown command gets
/// here before the dispatch table refuses it - so it is flattened like any
/// other frontend string. 128 is four times the longest real name.
pub const MAX_INVOKE_CHARS: usize = 128;

/// How many invocations a session logs. `pty_write` fires once per
/// keystroke in an attached terminal, so this is not a theoretical cap.
///
/// At roughly 55 bytes a line, 5000 lines is about 275 KiB - a quarter of
/// `MAX_BYTES`, the same share the UI budget is allowed, so what the
/// backend said about this session always survives. Past the cap the log
/// says so in a line of its own: an instrument that stops recording
/// silently would reintroduce exactly the bug this exists to fix, because
/// absence after that point would once again mean nothing.
pub const MAX_INVOKE_LINES: usize = 5_000;

/// Invocations logged. Relaxed, like `UI_LINES`: the only question is
/// "have we gone past the cap".
static INVOKE_LINES: AtomicUsize = AtomicUsize::new(0);

/// Record one invocation. File only, never stderr: one line per keystroke
/// would make `tauri dev`'s output unreadable, and on the platforms this
/// exists for (an app launched from the Dock) stderr goes nowhere anyway.
pub fn invoked(command: &str) {
    let spent = INVOKE_LINES.fetch_add(1, Ordering::Relaxed);
    if spent > MAX_INVOKE_LINES {
        return;
    }
    if spent == MAX_INVOKE_LINES {
        append(&format!(
            "{INVOKE_PREFIX} budget spent: {MAX_INVOKE_LINES} calls this \
             session, later calls are not logged"
        ));
        return;
    }
    append(&invoke_line(command));
}

/// The tag, then the command name, and nothing else.
pub fn invoke_line(command: &str) -> String {
    format!("{INVOKE_PREFIX} {}", flattened(command, MAX_INVOKE_CHARS))
}

// ── the file ────────────────────────────────────────────────────────────

/// Append one already-stamped line, rotating first if the file is at the
/// cap. Returns the io error rather than swallowing it so a test can see
/// the unwritable case; every caller discards it.
fn append_to(path: &Path, stamped: &str) -> std::io::Result<()> {
    rotate_if_full(path, MAX_BYTES);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    // one write_all of the whole line, newline included: that is what makes
    // two instances interleave lines rather than halves of lines
    file.write_all(stamped.as_bytes())
}

/// Move the log aside when it reaches `cap`, so the next write starts a
/// fresh one. Silent about every failure, and bounded even so.
fn rotate_if_full(path: &Path, cap: u64) {
    let Ok(meta) = fs::metadata(path) else {
        // no file yet, or a path we cannot stat - either way nothing to
        // rotate, and the open that follows decides whether we can write
        return;
    };
    if meta.len() < cap {
        return;
    }
    let old = path.with_file_name(OLD_FILE_NAME);
    // windows' rename refuses an existing destination, so clear it first;
    // both calls are allowed to fail
    let _ = fs::remove_file(&old);
    if fs::rename(path, &old).is_ok() {
        return;
    }
    // rename lost - the other instance rotated in the same breath, or the
    // directory is read-only. truncating in place is the fallback that
    // keeps the bound absolute; losing this window of history beats a file
    // that grows for ever because rename never succeeds
    let _ = fs::OpenOptions::new().write(true).truncate(true).open(path);
}

// ── the clock ───────────────────────────────────────────────────────────

/// Milliseconds since the unix epoch. A clock before 1970 (a machine with
/// a dead CMOS battery) reads as 0 rather than as an error nobody can act
/// on.
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `2026-09-26T01:28:33.412Z <line>\n`.
fn stamped(millis: u64, line: &str) -> String {
    format!("{} {}\n", timestamp(millis), line)
}

/// RFC 3339 in UTC, to the millisecond.
///
/// UTC and not local time: the reader of this file is whoever receives the
/// bug report, not the machine that wrote it, and there is no way to learn
/// the local offset without a dependency - which is the whole cost this
/// module is avoiding. The shape sorts lexicographically, which is what
/// makes `sort` and a plain diff useful on it.
fn timestamp(millis: u64) -> String {
    let secs = (millis / 1000) as i64;
    let ms = millis % 1000;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let (h, min, s) = (tod / 3600, (tod / 60) % 60, tod % 60);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{min:02}:{s:02}.{ms:03}Z")
}

/// Days since 1970-01-01 to a proleptic gregorian y/m/d (Howard Hinnant's
/// `civil_from_days`). Integer arithmetic only, no table, no leap-year
/// special cases to get wrong: the era is the 400-year cycle, in which the
/// number of days is a constant.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11], march-based
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("devgo-log-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn timestamp_is_utc_rfc3339_to_the_millisecond() {
        assert_eq!(timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(timestamp(1_700_000_000_412), "2023-11-14T22:13:20.412Z");
    }

    /// The century rule and the 400-year exception, the two the hand-rolled
    /// calendar could plausibly get wrong.
    #[test]
    fn timestamp_handles_leap_days() {
        // 2024 is a leap year: day 60 of it is february 29
        assert_eq!(timestamp(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
        // 2000 was a leap year (divisible by 400) though 1900 was not
        assert_eq!(timestamp(951_782_400_000), "2000-02-29T00:00:00.000Z");
        // and 2100 is not, so the day after 2100-02-28 is march
        assert_eq!(timestamp(4_107_542_400_000), "2100-03-01T00:00:00.000Z");
    }

    /// Timestamps sort in time order as plain strings - the only reason to
    /// choose this shape over a readable one with a month name.
    #[test]
    fn timestamps_sort_lexicographically() {
        let a = timestamp(1_700_000_000_000);
        let b = timestamp(1_700_000_000_999);
        let c = timestamp(1_800_000_000_000);
        assert!(a < b && b < c, "{a} {b} {c}");
    }

    #[test]
    fn a_line_is_the_stamp_then_the_line_then_a_newline() {
        assert_eq!(
            stamped(1_700_000_000_412, "[DevGo] could not raise the window"),
            "2023-11-14T22:13:20.412Z [DevGo] could not raise the window\n"
        );
    }

    #[test]
    fn appends_rather_than_replacing() {
        let path = scratch("append").join(FILE_NAME);
        append_to(&path, "first\n").unwrap();
        append_to(&path, "second\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first\nsecond\n");
    }

    /// At the cap the live file is moved to `.old` and a fresh one starts,
    /// so the history before the crossing survives instead of being thrown
    /// away.
    #[test]
    fn rotates_at_the_cap_and_keeps_the_old_copy() {
        let dir = scratch("rotate");
        let path = dir.join(FILE_NAME);
        let old = dir.join(OLD_FILE_NAME);

        fs::write(&path, "x".repeat(64)).unwrap();
        rotate_if_full(&path, 64);
        append_to(&path, "after\n").unwrap();

        assert_eq!(fs::read_to_string(&old).unwrap(), "x".repeat(64));
        assert_eq!(fs::read_to_string(&path).unwrap(), "after\n");
    }

    /// Below the cap nothing moves - a rotation per line would keep one
    /// line of history.
    #[test]
    fn does_not_rotate_below_the_cap() {
        let dir = scratch("under-cap");
        let path = dir.join(FILE_NAME);
        fs::write(&path, "x".repeat(63)).unwrap();
        rotate_if_full(&path, 64);
        assert!(!dir.join(OLD_FILE_NAME).exists());
        assert_eq!(fs::read_to_string(&path).unwrap().len(), 63);
    }

    /// Only one `.old` is kept: the second rotation overwrites the first,
    /// which is what bounds the facility at twice the cap.
    #[test]
    fn a_second_rotation_replaces_the_old_copy() {
        let dir = scratch("rotate-twice");
        let path = dir.join(FILE_NAME);

        fs::write(&path, "first".repeat(16)).unwrap();
        rotate_if_full(&path, 16);
        fs::write(&path, "second".repeat(16)).unwrap();
        rotate_if_full(&path, 16);

        assert_eq!(
            fs::read_to_string(dir.join(OLD_FILE_NAME)).unwrap(),
            "second".repeat(16)
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    /// The disk-is-hostile case: a log directory that does not exist. The
    /// write fails, nothing panics, and nothing is created.
    #[test]
    fn an_unwritable_path_is_survived_not_panicked_on() {
        let dir = scratch("unwritable");
        let path = dir.join("no-such-subdir").join(FILE_NAME);
        assert!(append_to(&path, "line\n").is_err());
        assert!(!path.exists());
    }

    /// A log path that is a directory: open-for-append refuses on every
    /// platform we ship, and that too is an error, not a panic.
    #[test]
    fn a_log_path_that_is_a_directory_is_an_error_not_a_panic() {
        let dir = scratch("is-a-dir");
        assert!(append_to(&dir, "line\n").is_err());
    }

    /// Rotation on paths it cannot stat or rename returns quietly and
    /// creates nothing, so a broken directory costs a log, not a launch.
    #[test]
    fn rotation_of_an_impossible_path_creates_nothing() {
        let dir = scratch("rotate-impossible");
        let missing = dir.join("no-such-subdir").join(FILE_NAME);
        rotate_if_full(&missing, 0);
        assert!(!dir.join(OLD_FILE_NAME).exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    }

    /// A ui line is tagged so a reader can tell it from a backend line
    /// without reading the sentence.
    #[test]
    fn a_ui_line_carries_the_ui_tag_and_not_the_backend_one() {
        let line = ui_line("drawer \"clone\" closed: escape");
        assert!(line.starts_with("[DevGo/ui] "), "{line}");
        assert!(!line.starts_with("[DevGo] "), "{line}");
        assert!(line.ends_with("drawer \"clone\" closed: escape"), "{line}");
    }

    /// The cap, exactly: 512 characters pass whole, 513 come back cut to
    /// 512 with the marker that says so.
    #[test]
    fn a_ui_line_is_cut_at_the_cap_and_says_it_was() {
        let at_cap = ui_line(&"a".repeat(MAX_UI_CHARS));
        assert_eq!(at_cap, format!("{UI_PREFIX} {}", "a".repeat(MAX_UI_CHARS)));

        let over = ui_line(&"a".repeat(MAX_UI_CHARS + 1));
        assert_eq!(over, format!("{UI_PREFIX} {}…", "a".repeat(MAX_UI_CHARS)));
    }

    /// Cutting counts characters, not bytes, so a line of multi-byte text
    /// is cut on a char boundary rather than panicking the slice - and a
    /// short line of long characters is not cut at all.
    #[test]
    fn a_ui_line_is_cut_by_characters_not_bytes() {
        let emoji = "🦀".repeat(MAX_UI_CHARS / 2);
        assert!(emoji.len() > MAX_UI_CHARS, "the bytes really do exceed it");
        let line = ui_line(&emoji);
        assert!(!line.ends_with('…'), "{line}");
        assert_eq!(
            line.chars().count(),
            UI_PREFIX.chars().count() + 1 + MAX_UI_CHARS / 2
        );
    }

    /// A newline from the frontend cannot start a second line, and in
    /// particular cannot forge one that reads as the backend's.
    #[test]
    fn a_ui_line_cannot_forge_a_second_line() {
        let line = ui_line("all fine\n[DevGo] nothing happened\r\tok\0");
        assert!(!line.contains('\n'), "{line}");
        assert!(!line.contains('\r'), "{line}");
        assert_eq!(line, "[DevGo/ui] all fine [DevGo] nothing happened  ok ");
    }

    /// An invoke line is the tag and the command name, nothing more - in
    /// particular no arguments, because the log is a file users paste into
    /// public issues.
    #[test]
    fn an_invoke_line_is_the_tag_and_the_command_name_alone() {
        assert_eq!(
            invoke_line("wsl_config_report"),
            "[DevGo] invoke wsl_config_report"
        );
    }

    /// The name is whatever the webview sent, so it cannot be allowed to
    /// carry a newline and forge a second line.
    #[test]
    fn an_invoke_line_cannot_forge_a_second_line() {
        let line = invoke_line("ok\n[DevGo] invoke something_else\r\0");
        assert!(!line.contains('\n'), "{line}");
        assert!(!line.contains('\r'), "{line}");
        assert_eq!(line, "[DevGo] invoke ok [DevGo] invoke something_else  ");
    }

    /// And it is cut at the cap, so a megabyte of "command name" costs one
    /// bounded line.
    #[test]
    fn an_invoke_line_is_cut_at_the_cap_and_says_it_was() {
        let at_cap = invoke_line(&"a".repeat(MAX_INVOKE_CHARS));
        assert_eq!(
            at_cap,
            format!("{INVOKE_PREFIX} {}", "a".repeat(MAX_INVOKE_CHARS))
        );
        let over = invoke_line(&"a".repeat(MAX_INVOKE_CHARS + 1));
        assert_eq!(
            over,
            format!("{INVOKE_PREFIX} {}…", "a".repeat(MAX_INVOKE_CHARS))
        );
    }

    /// `invoked` before `init` must be a no-op too: commands can be
    /// dispatched the moment the webview loads.
    #[test]
    fn invoked_before_init_is_a_no_op() {
        assert!(log_path().is_none());
        invoked("get_workspaces");
    }

    /// `append` before `init` - the window between process start and setup -
    /// has nowhere to write and must simply return.
    #[test]
    fn append_before_init_is_a_no_op() {
        // nothing in the test binary calls init, so the OnceLock is empty
        assert!(log_path().is_none());
        append("[DevGo] test line, ignore");
    }
}
