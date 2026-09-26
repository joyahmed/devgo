// the diagnose half of the wsl doctor. it reads and reports; it changes
// nothing. no elevation, no `wsl --shutdown`, no write to .wslconfig —
// every finding ends in a sentence the user acts on themselves, because a
// tool that repairs a vm it has only half understood is worse than one
// that explains it
//
// and nothing in here runs on a clock. both reports are asked for: a
// button, or the panel opening. a timer that shelled to wsl.exe would
// hang on exactly the wedged WSLService it exists to find, which is how
// the poll that reveals the hang becomes part of it

pub mod fragmentation;
pub mod wslconfig;

use serde::Serialize;

/// How much a finding matters.
///
/// Three levels because the panel only ever needs three: WSL is not doing
/// what the file says, WSL is doing it but not the way this machine wants,
/// and here is a reading worth having.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// One thing the doctor found, in the shape the panel draws: what was
/// read, what is wrong with it, what it should be instead. The three
/// fields are separate rather than one prose blob so the row can put the
/// quote in monospace and the advice in prose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Finding {
    pub severity: Severity,
    /// the 1-based line of `.wslconfig` this is about; none for the
    /// findings that are about the file, the machine or a memory zone
    pub line: Option<u32>,
    /// what was read — the line as written, or the reading that prompted it
    pub text: String,
    pub problem: String,
    pub fix: String,
}

impl Finding {
    fn new(
        severity: Severity,
        line: Option<u32>,
        text: impl Into<String>,
        problem: impl Into<String>,
        fix: impl Into<String>,
    ) -> Self {
        Self {
            severity,
            line,
            text: text.into(),
            problem: problem.into(),
            fix: fix.into(),
        }
    }
}

/// Bytes as a person reads them. Binary units, because every number this
/// crosses paths with — `memory=24GB` in .wslconfig, MemTotal in
/// /proc/meminfo, a buddyinfo block — is a power of two underneath.
pub(crate) fn human(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 || value >= 100.0 {
        format!("{} {}", value.round() as u64, UNITS[unit])
    } else {
        // one decimal up to 99.9: "1.5 GB" is a number, "2 GB" of 1.5 is a lie
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_sizes_round_the_way_a_person_reads_them() {
        assert_eq!(human(0), "0 B");
        assert_eq!(human(512), "512 B");
        assert_eq!(human(1024), "1.0 KB");
        assert_eq!(human(64 * 1024), "64.0 KB");
        assert_eq!(human(24 * 1024 * 1024 * 1024), "24.0 GB");
        // past 99.9 the decimal stops earning its place
        assert_eq!(human(128 * 1024 * 1024 * 1024), "128 GB");
    }
}
