// the fragmentation view.
//
// ⭐ the crash this exists for was not an OOM. the machine had memory free,
// the graph looked fine, and a process died with a SIGABRT and nothing in
// dmesg about the oom killer. the kernel had plenty of free PAGES and no
// free RUNS of pages: an allocation that needed sixteen contiguous ones
// failed while gigabytes sat free in single-page scraps. no tool surfaces
// that class, which is why it took a day to find.
//
// /proc/buddyinfo is the free list itself, one column per order — order n
// is how many free runs of 2^n pages the zone still has. reading it costs
// a file open inside a distro that is already running; we never start one
// to look, because a stopped distro is not a sick distro.

use super::{human, Finding, Severity};
use crate::services::platform::wsl;
use serde::Serialize;

// the wsl2 kernel is 4K pages on both x86_64 and aarch64. a buddyinfo
// column is a count of runs, so every byte figure downstream is
// count * 2^order * this
const PAGE_SIZE: u64 = 4096;

// where "high order" starts. order 4 is sixteen pages, 64 KB contiguous:
// the size the kernel's own slab growth, network buffers and vhd i/o paths
// ask for, and the first order whose exhaustion kills things rather than
// slowing them
const HIGH_ORDER: usize = 4;

// the DMA zones are a few megabytes by design and are always empty at high
// orders. a finding about them is noise; the zone a workload allocates from
// is Normal, and it is measured in gigabytes
const ZONE_FLOOR: u64 = 64 << 20;

// the kernel's MAX_ORDER is eleven-ish and no build is near this. the cap
// exists so an `order:` scraped out of a stray log line, or a buddyinfo row
// that is not one, cannot turn into a shift nobody meant
const MAX_SANE_ORDER: usize = 24;

// what the probe prints. every line is tagged at the front so the parser
// below is pure text and tests from a fixture, and so one round trip
// carries all three readings instead of three spawns of wsl.exe
//
// read-only throughout: two files out of /proc and the kernel's own ring
// buffer. nothing is written, nothing is started, no sudo
const PROBE: &str = "\
sed 's/^/buddy /' /proc/buddyinfo 2>/dev/null
sed 's/^/mem /' /proc/meminfo 2>/dev/null
dmesg 2>/dev/null | grep -iE 'order:[0-9]+' | tail -n 40 | sed 's/^/dmesg /'
";

/// One memory zone's free lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Zone {
    pub node: String,
    pub name: String,
    /// index n is how many free runs of 2^n pages this zone has left
    pub free_blocks: Vec<u64>,
    pub free_bytes: u64,
    /// the biggest contiguous run left, as an order; none when nothing is free
    pub largest_free_order: Option<usize>,
    /// of the free bytes, how many sit in runs of `HIGH_ORDER` or bigger
    pub high_order_bytes: u64,
}

/// The handful of `/proc/meminfo` rows worth having beside the free lists:
/// they are what tells "fragmented" from "genuinely out".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Meminfo {
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
    pub available_bytes: Option<u64>,
    pub cached_bytes: Option<u64>,
    pub swap_total_bytes: Option<u64>,
    pub swap_free_bytes: Option<u64>,
}

/// A high-order allocation failure the kernel ring still carries. This is
/// the failure itself, already logged — not a prediction of one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AllocFailure {
    pub order: u32,
    pub text: String,
}

/// Everything the probe read, before anything is concluded from it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Readings {
    pub zones: Vec<Zone>,
    pub meminfo: Meminfo,
    pub failures: Vec<AllocFailure>,
}

/// What the panel draws.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    /// the distro that was read — none when none was running
    pub distro: Option<String>,
    /// why there is nothing to show. a stopped VM is not an error
    pub reason: Option<String>,
    pub readings: Readings,
    pub findings: Vec<Finding>,
}

fn order_bytes(order: usize) -> u64 {
    PAGE_SIZE << order
}

fn zone(node: String, name: String, free_blocks: Vec<u64>) -> Zone {
    let free_bytes = free_blocks
        .iter()
        .enumerate()
        .map(|(order, count)| count * order_bytes(order))
        .sum();
    let high_order_bytes = free_blocks
        .iter()
        .enumerate()
        .skip(HIGH_ORDER)
        .map(|(order, count)| count * order_bytes(order))
        .sum();
    let largest_free_order = free_blocks.iter().rposition(|&count| count > 0);
    Zone {
        node,
        name,
        free_blocks,
        free_bytes,
        largest_free_order,
        high_order_bytes,
    }
}

/// One `/proc/buddyinfo` row.
///
/// Strict on purpose: the column count is the kernel's MAX_ORDER and
/// differs between builds, so it is never assumed — but a row with a
/// non-number in it is not a row we understood, and a half-read free list
/// would produce a confident wrong answer.
fn parse_buddy(line: &str) -> Option<Zone> {
    let (node_part, rest) = line.split_once(", zone")?;
    let node = node_part.trim().strip_prefix("Node")?.trim().to_string();
    let mut fields = rest.split_whitespace();
    let name = fields.next()?.to_string();
    let counts: Option<Vec<u64>> =
        fields.map(|field| field.parse().ok()).collect();
    let counts = counts?;
    let sane = !counts.is_empty() && counts.len() <= MAX_SANE_ORDER;
    sane.then(|| zone(node, name, counts))
}

/// One `/proc/meminfo` row, in bytes. The unit is `kB` in the file and
/// means KiB — the kernel has spelled it that way since forever.
fn parse_meminfo(line: &str) -> Option<(String, u64)> {
    let (key, rest) = line.split_once(':')?;
    let mut fields = rest.split_whitespace();
    let value: u64 = fields.next()?.parse().ok()?;
    let bytes = match fields.next() {
        Some(unit) if unit.eq_ignore_ascii_case("kb") => value * 1024,
        _ => value,
    };
    Some((key.trim().to_string(), bytes))
}

/// The order out of a `page allocation failure: order:4, mode:...` line.
fn parse_order(line: &str) -> Option<u32> {
    // ascii lowercasing keeps byte offsets, so the index is still the
    // original line's
    let at = line.to_ascii_lowercase().find("order:")? + "order:".len();
    let digits: String = line[at..]
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits
        .parse()
        .ok()
        .filter(|n| *n as usize <= MAX_SANE_ORDER)
}

/// The probe's tagged lines, read into shape. Pure: this is what the tests
/// drive with a fixture instead of a distro.
pub fn read_probe(lines: &[String]) -> Readings {
    let mut readings = Readings::default();
    for line in lines {
        let Some((tag, body)) = line.split_once(' ') else {
            continue;
        };
        match tag {
            "buddy" => readings.zones.extend(parse_buddy(body)),
            "mem" => {
                if let Some((key, bytes)) = parse_meminfo(body) {
                    let slot = match key.as_str() {
                        "MemTotal" => &mut readings.meminfo.total_bytes,
                        "MemFree" => &mut readings.meminfo.free_bytes,
                        "MemAvailable" => &mut readings.meminfo.available_bytes,
                        "Cached" => &mut readings.meminfo.cached_bytes,
                        "SwapTotal" => &mut readings.meminfo.swap_total_bytes,
                        "SwapFree" => &mut readings.meminfo.swap_free_bytes,
                        _ => continue,
                    };
                    *slot = Some(bytes);
                }
            }
            "dmesg" => {
                if let Some(order) = parse_order(body) {
                    readings.failures.push(AllocFailure {
                        order,
                        text: body.to_string(),
                    });
                }
            }
            _ => {}
        }
    }
    readings
}

// the zone a person cares about: the biggest one, by free bytes. a machine
// has a Normal zone of gigabytes and two DMA zones of megabytes, and the
// headline reading is the big one's
fn biggest(zones: &[Zone]) -> Option<&Zone> {
    zones.iter().max_by_key(|z| z.free_bytes)
}

fn largest_run(zone: &Zone) -> String {
    match zone.largest_free_order {
        Some(order) => {
            format!("order {order} ({})", human(order_bytes(order)))
        }
        None => "nothing".to_string(),
    }
}

/// What the readings mean. Pure, so every rule below is testable from a
/// fixture buddyinfo.
pub fn assess(readings: &Readings) -> Vec<Finding> {
    let mut findings = Vec::new();

    if readings.zones.is_empty() {
        findings.push(Finding::new(
            Severity::Warning,
            None,
            "/proc/buddyinfo".to_string(),
            "the free lists could not be read in this distro".to_string(),
            "the file is world-readable on every stock kernel; a distro without it is not one DevGo can judge".to_string(),
        ));
    }

    // the healthy headline below is only printed when no zone was flagged:
    // "not starved" underneath "this zone is starved" is two answers to
    // one question
    let mut zone_flagged = false;

    for zone in &readings.zones {
        if zone.free_bytes < ZONE_FLOOR {
            // megabytes by design; it is always empty up top and saying so
            // would bury the zone that matters
            continue;
        }
        if zone.high_order_bytes == 0 {
            zone_flagged = true;
            findings.push(Finding::new(
                Severity::Error,
                None,
                format!(
                    "node {} {}: {} free, largest run {}",
                    zone.node,
                    zone.name,
                    human(zone.free_bytes),
                    largest_run(zone)
                ),
                format!(
                    "{} of memory is free in this zone and none of it is in a run of {} or bigger. an allocation that needs a contiguous block fails here while the memory graph still looks healthy",
                    human(zone.free_bytes),
                    human(order_bytes(HIGH_ORDER))
                ),
                "this is the shape behind a SIGABRT with no OOM message. `wsl --shutdown` rebuilds the VM and its free lists — DevGo will not run it for you".to_string(),
            ));
        } else if zone.high_order_bytes.saturating_mul(20) < zone.free_bytes {
            zone_flagged = true;
            findings.push(Finding::new(
                Severity::Warning,
                None,
                format!(
                    "node {} {}: {} free, {} of it in runs of {} or bigger",
                    zone.node,
                    zone.name,
                    human(zone.free_bytes),
                    human(zone.high_order_bytes),
                    human(order_bytes(HIGH_ORDER))
                ),
                "under a twentieth of this zone's free memory is contiguous — the free lists are breaking up".to_string(),
                "it is not starved yet. a long-lived VM gets here; a restart resets it".to_string(),
            ));
        }
    }

    if readings.failures.is_empty() {
        findings.push(Finding::new(
            Severity::Info,
            None,
            "dmesg, high-order allocation failures".to_string(),
            "none in the kernel ring — or dmesg is restricted in this distro, which reads the same from outside".to_string(),
            "nothing to do".to_string(),
        ));
    } else {
        let highest =
            readings.failures.iter().map(|f| f.order).max().unwrap_or(0);
        findings.push(Finding::new(
            Severity::Error,
            None,
            readings
                .failures
                .last()
                .map(|f| f.text.clone())
                .unwrap_or_default(),
            format!(
                "the kernel log carries {} high-order allocation failure(s), the largest for order {highest} ({})",
                readings.failures.len(),
                human(order_bytes(highest as usize))
            ),
            "this is not a prediction — it already happened. whatever asked for that block did not get it".to_string(),
        ));
    }

    // the healthy reading, said out loud. a panel that shows nothing when
    // all is well cannot be told from a panel that failed to look
    let headline = (!zone_flagged)
        .then(|| biggest(&readings.zones))
        .flatten()
        .filter(|zone| zone.high_order_bytes > 0);
    if let Some(zone) = headline {
        findings.push(Finding::new(
            Severity::Info,
            None,
            format!(
                "node {} {}: largest free run {}",
                zone.node,
                zone.name,
                largest_run(zone)
            ),
            format!(
                "{} of this zone's {} free is in runs of {} or bigger",
                human(zone.high_order_bytes),
                human(zone.free_bytes),
                human(order_bytes(HIGH_ORDER))
            ),
            "high-order allocations are not starved".to_string(),
        ));
    }

    let swap = readings
        .meminfo
        .swap_total_bytes
        .zip(readings.meminfo.swap_free_bytes)
        .filter(|(total, free)| *total > 0 && free.saturating_mul(10) < *total);
    if let Some((total, free)) = swap {
        findings.push(Finding::new(
            Severity::Warning,
            None,
            format!("swap: {} free of {}", human(free), human(total)),
            "the VM's swap is nearly spent, so the next spike has nowhere to go but a kill".to_string(),
            "swap= under [wsl2] sets its size".to_string(),
        ));
    }

    findings
}

/// Read the free lists inside a running distro.
///
/// ⚠ never starts one. a stopped distro is not a sick distro, and booting
/// the VM to look at its memory would be the tool creating the condition
/// it reports on.
pub fn report(requested: Option<String>) -> Report {
    let stopped = |reason: &str| Report {
        distro: requested.clone(),
        reason: Some(reason.to_string()),
        readings: Readings::default(),
        findings: Vec::new(),
    };

    // the explicit path asks wsl.exe rather than the memo: a button press
    // is owed now, not five seconds ago. it is a management call, so it
    // starts nothing
    let running = wsl::running_distros();
    if running.is_empty() {
        return stopped(
            "No distro is running. DevGo will not start one just to look inside it — start a distro and check again.",
        );
    }
    let distro = match &requested {
        Some(name) => {
            if !wsl::is_running(name, &running) {
                return stopped(&format!(
                    "{name} is not running. DevGo will not start it to look — start it and check again."
                ));
            }
            name.clone()
        }
        // whichever is up, not the default: the default may be the one
        // that is stopped
        None => running[0].clone(),
    };

    let readings = read_probe(&wsl::probe_lines(&distro, PROBE));
    Report {
        distro: Some(distro),
        reason: None,
        findings: assess(&readings),
        readings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(text: &str) -> Vec<String> {
        text.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect()
    }

    // a healthy machine: runs free all the way up to order 10
    const HEALTHY: &str = "
        buddy Node 0, zone      DMA      1      1      1      0      2      1      1      0      1      1      3
        buddy Node 0, zone    DMA32   1043    743    422    297    186    109     52     31     18      9    412
        buddy Node 0, zone   Normal  48211  31004  19882   9471   5120   2610   1204    611    302    150   1833
        mem MemTotal:       16308844 kB
        mem MemFree:         9912344 kB
        mem MemAvailable:   12004112 kB
        mem Cached:          3211004 kB
        mem SwapTotal:       4194304 kB
        mem SwapFree:        4194304 kB
    ";

    // the 2026-07-06 shape: gigabytes free, nothing above order 3
    const FRAGMENTED: &str = "
        buddy Node 0, zone      DMA      0      0      0      1      0      0      0      0      0      0      0
        buddy Node 0, zone   Normal 921344 110233  21044   3001      0      0      0      0      0      0      0
        mem MemTotal:       16308844 kB
        mem MemFree:         5100220 kB
        mem MemAvailable:    5600100 kB
        mem SwapTotal:       4194304 kB
        mem SwapFree:        4194304 kB
        dmesg [82911.402044] node: page allocation failure: order:4, mode:0x40cc0(GFP_KERNEL|__GFP_COMP|__GFP_ZERO), nodemask=(null)
        dmesg [82911.402188] warn_alloc: 3 callbacks suppressed, order:5
    ";

    #[test]
    fn a_buddyinfo_row_reads_into_orders_and_bytes() {
        let z =
            parse_buddy("Node 0, zone   Normal      2      1      0      4")
                .expect("a stock row parses");
        assert_eq!(z.node, "0");
        assert_eq!(z.name, "Normal");
        assert_eq!(z.free_blocks, vec![2, 1, 0, 4]);
        // 2*4K + 1*8K + 0 + 4*32K = 8K + 8K + 128K
        assert_eq!(z.free_bytes, 144 * 1024);
        assert_eq!(z.largest_free_order, Some(3));
        // HIGH_ORDER is 4 and there is no order-4 column here
        assert_eq!(z.high_order_bytes, 0);
    }

    /// The column count is the kernel's MAX_ORDER and varies by build, so
    /// it is never assumed — a shorter row still reads.
    #[test]
    fn a_row_with_a_different_column_count_still_reads() {
        let short = parse_buddy("Node 0, zone DMA 1 2").expect("two columns");
        assert_eq!(short.free_blocks.len(), 2);
        let long =
            parse_buddy("Node 1, zone Normal 1 1 1 1 1 1 1 1 1 1 1 1 1 1")
                .expect("fourteen columns");
        assert_eq!(long.free_blocks.len(), 14);
        assert_eq!(long.node, "1");
    }

    /// Half a free list is worse than none: it would read as a starved
    /// zone. A row with anything unparseable in it is dropped whole.
    #[test]
    fn a_malformed_row_is_dropped_not_half_read() {
        assert_eq!(parse_buddy("Node 0, zone Normal 12 ? 4"), None);
        assert_eq!(parse_buddy("Node 0, zone Normal"), None);
        assert_eq!(parse_buddy("totally not buddyinfo"), None);
        assert_eq!(parse_buddy("Nde 0, zone Normal 1 2"), None);
    }

    #[test]
    fn meminfo_rows_read_kb_as_kib() {
        assert_eq!(
            parse_meminfo("MemTotal:       16308844 kB"),
            Some(("MemTotal".to_string(), 16308844 * 1024))
        );
        // Hugepagesize-style rows with no unit are counts, not bytes
        assert_eq!(
            parse_meminfo("HugePages_Total:       0"),
            Some(("HugePages_Total".to_string(), 0))
        );
        assert_eq!(parse_meminfo("not a row"), None);
    }

    #[test]
    fn an_allocation_failure_line_yields_its_order() {
        assert_eq!(
            parse_order("page allocation failure: order:4, mode:0x40cc0"),
            Some(4)
        );
        assert_eq!(parse_order("ORDER:10, something"), Some(10));
        assert_eq!(parse_order("order:, mode"), None);
        assert_eq!(parse_order("nothing here"), None);
    }

    #[test]
    fn the_probe_lines_read_into_all_three_shapes() {
        let r = read_probe(&lines(FRAGMENTED));
        assert_eq!(r.zones.len(), 2);
        assert_eq!(r.meminfo.total_bytes, Some(16308844 * 1024));
        assert_eq!(r.meminfo.cached_bytes, None);
        assert_eq!(r.failures.len(), 2);
        assert_eq!(r.failures[0].order, 4);
        assert_eq!(r.failures[1].order, 5);
    }

    /// Untagged noise on stdout must not become a reading.
    #[test]
    fn untagged_lines_are_ignored() {
        let r = read_probe(&lines(
            "
            bash: line 1: sed: command not found
            buddy Node 0, zone Normal 1 1 1 1 1
            ",
        ));
        assert_eq!(r.zones.len(), 1);
        assert!(r.failures.is_empty());
    }

    /// ⭐ The whole point. Gigabytes free, nothing above order 3, and the
    /// finding has to be an error that says the memory is there and
    /// unusable — not "low memory", which it is not.
    #[test]
    fn a_starved_zone_is_an_error_that_names_the_contiguity() {
        let findings = assess(&read_probe(&lines(FRAGMENTED)));
        let starved = findings
            .iter()
            .find(|f| f.problem.contains("contiguous block fails"))
            .expect("the starved zone is reported");
        assert_eq!(starved.severity, Severity::Error);
        assert!(starved.text.contains("Normal"));
        assert!(starved.text.contains("largest run order 3"));
        assert!(starved.fix.contains("SIGABRT"));
        // and nothing about the tiny DMA zone, which is empty up top by design
        assert!(
            !findings.iter().any(|f| f.text.contains("DMA")),
            "the DMA zone is megabytes and must not be reported"
        );
    }

    /// The failures already in the ring are their own finding: they are the
    /// crash, not a forecast of it.
    #[test]
    fn logged_allocation_failures_are_reported_with_the_highest_order() {
        let findings = assess(&read_probe(&lines(FRAGMENTED)));
        let logged = findings
            .iter()
            .find(|f| f.problem.contains("kernel log carries"))
            .expect("the ring's failures are reported");
        assert_eq!(logged.severity, Severity::Error);
        assert!(logged.problem.contains("2 high-order"));
        assert!(logged.problem.contains("order 5"));
    }

    /// A healthy machine gets a reading, not silence — an empty panel
    /// cannot be told from one that failed to look.
    #[test]
    fn a_healthy_machine_reports_the_largest_run_and_no_errors() {
        let findings = assess(&read_probe(&lines(HEALTHY)));
        assert!(
            !findings.iter().any(|f| f.severity == Severity::Error),
            "{findings:#?}"
        );
        let headline = findings
            .iter()
            .find(|f| f.fix.contains("not starved"))
            .expect("the healthy reading is stated");
        assert_eq!(headline.severity, Severity::Info);
        assert!(headline.text.contains("Normal"));
        assert!(headline.text.contains("order 10"));
    }

    /// No failures in the ring and a restricted dmesg look identical from
    /// outside the distro, and the finding has to admit that.
    #[test]
    fn a_silent_ring_says_it_may_be_restricted() {
        let findings = assess(&read_probe(&lines(HEALTHY)));
        let note = findings
            .iter()
            .find(|f| f.text.starts_with("dmesg"))
            .expect("the ring is accounted for");
        assert_eq!(note.severity, Severity::Info);
        assert!(note.problem.contains("restricted"));
    }

    /// Free lists but no high-order runs to speak of: breaking up, not
    /// broken. A warning, not an error.
    #[test]
    fn a_zone_thinning_at_the_top_is_a_warning_not_an_error() {
        // 200000 order-0 runs is ~780 MB; one order-4 run is 64 KB
        let findings = assess(&read_probe(&lines(
            "buddy Node 0, zone Normal 200000 0 0 0 1 0 0 0 0 0 0",
        )));
        let thin = findings
            .iter()
            .find(|f| f.problem.contains("breaking up"))
            .expect("the thinning zone is reported");
        assert_eq!(thin.severity, Severity::Warning);
        assert!(!findings.iter().any(|f| f.severity == Severity::Error));
    }

    /// A distro whose /proc/buddyinfo produced nothing is a warning about
    /// the read, never a clean bill of health.
    #[test]
    fn no_free_lists_at_all_is_a_warning_about_the_read() {
        let findings = assess(&Readings::default());
        assert!(findings
            .iter()
            .any(|f| f.text == "/proc/buddyinfo"
                && f.severity == Severity::Warning));
    }

    #[test]
    fn nearly_spent_swap_is_a_warning() {
        let findings = assess(&read_probe(&lines(
            "
            buddy Node 0, zone Normal 200000 100 100 100 100 100 100 100 100 100 100
            mem SwapTotal:       8388608 kB
            mem SwapFree:          40960 kB
            ",
        )));
        assert!(findings
            .iter()
            .any(|f| f.text.starts_with("swap:")
                && f.severity == Severity::Warning));
    }

    // the probe must never write, start anything, or need a password: a
    // read-only v0 is the promise, and this is the line that would break it
    #[test]
    fn the_probe_script_only_reads() {
        for forbidden in
            ["sudo", "sysctl -w", "wsl --shutdown", "systemctl", "rm "]
        {
            assert!(
                !PROBE.contains(forbidden),
                "the probe must not contain {forbidden}"
            );
        }
        // every redirect in it must be the 2>/dev/null that swallows a
        // missing file. any other > is a write, and a write is the one
        // thing a read-only v0 promised not to do
        assert_eq!(
            PROBE.matches('>').count(),
            PROBE.matches("2>/dev/null").count()
        );
        assert!(PROBE.contains("/proc/buddyinfo"));
        assert!(PROBE.contains("/proc/meminfo"));
    }

    // off windows there is no distro to read, and the report must say so
    // rather than produce an empty-but-healthy-looking one
    #[cfg(not(windows))]
    #[test]
    fn off_windows_the_report_is_a_stated_reason() {
        let r = report(None);
        assert!(r.reason.is_some());
        assert!(r.findings.is_empty());
        assert_eq!(r.readings, Readings::default());
    }

    // the probe against a real distro. ignored because it depends on
    // whether wsl happens to be up, and it shells to wsl.exe; run by hand
    // with cargo test -- --ignored --nocapture real_fragmentation
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn real_fragmentation_reads_on_this_machine() {
        let r = report(None);
        println!("distro = {:?} reason = {:?}", r.distro, r.reason);
        println!("zones = {}", r.readings.zones.len());
        for z in &r.readings.zones {
            println!(
                "  node {} {}: {} free, {} in high orders",
                z.node,
                z.name,
                crate::services::wsl_doctor::human(z.free_bytes),
                crate::services::wsl_doctor::human(z.high_order_bytes)
            );
        }
        for f in &r.findings {
            println!(
                "  {:?}: {} | {} | {}",
                f.severity, f.text, f.problem, f.fix
            );
        }
        // one or the other, never both empty and never both present: a
        // stopped VM must come back as a stated reason rather than silence,
        // which is the whole contract of this call
        assert_eq!(
            r.reason.is_some(),
            r.readings.zones.is_empty(),
            "a report with no zones must say why, and one with zones must not"
        );
    }
}
