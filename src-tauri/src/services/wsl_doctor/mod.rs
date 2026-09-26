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
///
/// ⭐ the units are SPELLED binary too. the arithmetic here was always
/// /1024, but it used to print `GB`, and the panel's own formatter prints
/// `GiB` off the same bytes — so one card read `25.6 GiB free` on one line
/// and `25.3 GB of this zone's 25.6 GB free` on the next, ten pixels
/// apart, and the reader has to work out that the two numbers are the same
/// number. a buddyinfo order is 2^n pages: decimal spelling was never
/// right here, it was only invisible.
///
/// ⛔ THE RULE IS ONE DECIMAL ABOVE `B`, WITH NO CEILING. This used to drop
/// the decimal past 99.9 — `128 GiB` — while `bytes()` in WslDoctor.tsx
/// kept it unconditionally — `128.0 GiB`. The two agree exactly below 100,
/// which is why a 63.9 GiB host never showed it; a 128 GiB box or a
/// ≥100 MiB zone reading puts both spellings of one number in one card,
/// the same defect the binary-units fix was about. Same reasoning as
/// `64.0 KiB` keeping its `.0`: the trailing zero is not noise, it is the
/// promise that every reading in this panel is written the same way.
pub(crate) fn human(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        // whole bytes are whole: "512.0 B" counts nothing that exists
        format!("{} {}", value.round() as u64, UNITS[unit])
    } else {
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
        assert_eq!(human(1024), "1.0 KiB");
        assert_eq!(human(64 * 1024), "64.0 KiB");
        assert_eq!(human(24 * 1024 * 1024 * 1024), "24.0 GiB");
    }

    /// ⭐ The panel's own `bytes()` (WslDoctor.tsx) keeps one decimal at
    /// every unit above `B`, unconditionally. This side used to drop it
    /// past 99.9, so a finding said `128 GiB` ten pixels under a grid that
    /// said `128.0 GiB` — one number, two spellings. Invisible on a
    /// 63.9 GiB host, which is why it shipped. The pin is here so it
    /// cannot come back the next time someone decides four significant
    /// figures look untidy.
    #[test]
    fn the_decimal_survives_past_99_9_because_the_panel_keeps_it_too() {
        assert_eq!(human(100 * 1024 * 1024), "100.0 MiB");
        assert_eq!(human(128 * 1024 * 1024 * 1024), "128.0 GiB");
        assert_eq!(human(1023 * 1024 * 1024 * 1024), "1023.0 GiB");
        // and `B` is still the one unit with no decimal: a byte is whole
        assert_eq!(human(512), "512 B");
    }

    /// ⭐ The panel prints its own numbers with a binary formatter, so a
    /// finding that spelled the SAME bytes in decimal units put two unit
    /// systems in one card. The step is 1024 and the spelling must say so
    /// — a `GB` escaping from here is the defect coming back.
    #[test]
    fn the_units_are_spelled_binary_because_the_step_is_1024() {
        // the step, not just the label: 1024 KiB is exactly 1 MiB
        assert_eq!(human(1024 * 1024), "1.0 MiB");
        assert_eq!(human(1000), "1000 B");
        for bytes in [1, 1 << 10, 1 << 20, 1 << 30, 1 << 40, u64::MAX] {
            let s = human(bytes);
            assert!(
                s.ends_with(" B") || s.ends_with("iB"),
                "{s} is not a binary unit"
            );
        }
    }
}
