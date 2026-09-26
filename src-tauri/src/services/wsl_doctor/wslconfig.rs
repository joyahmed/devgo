// the .wslconfig validator.
//
// the whole reason this exists: wsl's parser has no error channel. a
// misspelled key, a key under the wrong heading, a value it cannot read —
// every one of them is a silent no-op. the file still parses, wsl still
// starts, and the setting simply never applies. joy's own file carried
// `pageReporting=true` for weeks doing nothing at all.
//
// so this validates the FILE, not the running vm. the question is not
// "how much memory is the vm using", it is "what was wsl told, and is any
// of it being thrown away". nothing here spawns wsl.exe or reads the vm.

use super::{human, Finding, Severity};
use serde::Serialize;

/// The three headings `.wslconfig` actually reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Section {
    Wsl2,
    Experimental,
    General,
}

impl Section {
    fn label(self) -> &'static str {
        match self {
            Section::Wsl2 => "[wsl2]",
            Section::Experimental => "[experimental]",
            Section::General => "[general]",
        }
    }

    fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "wsl2" => Some(Section::Wsl2),
            "experimental" => Some(Section::Experimental),
            "general" => Some(Section::General),
            _ => None,
        }
    }
}

/// What a value is allowed to look like. `Path` and `Text` are shapeless on
/// purpose: a kernel command line or a windows path can be anything, and a
/// rule that guessed would cost more in false alarms than it caught.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shape {
    Bool,
    Number,
    Size,
    Path,
    Text,
    /// `networkingMode` — an unknown value here reads as `nat`
    NetworkingMode,
    /// `autoMemoryReclaim` — an unknown value here reads as `dropCache`
    MemoryReclaim,
}

struct Key {
    name: &'static str,
    section: Section,
    shape: Shape,
}

impl Key {
    // a const fn purely so the table below stays one line per key: the
    // struct-literal form is five
    const fn new(name: &'static str, section: Section, shape: Shape) -> Self {
        Self {
            name,
            section,
            shape,
        }
    }
}

// wsl's documented settings, straight off the "Advanced settings
// configuration in WSL" tables — the three .wslconfig sections, not
// wsl.conf's. nothing here is guessed: a key this table does not carry is
// reported as unknown, never as invalid, because a newer wsl may well
// have added it since
const KEYS: &[Key] = &[
    // [wsl2] — the vm itself
    Key::new("kernel", Section::Wsl2, Shape::Path),
    Key::new("kernelModules", Section::Wsl2, Shape::Path),
    Key::new("memory", Section::Wsl2, Shape::Size),
    Key::new("processors", Section::Wsl2, Shape::Number),
    Key::new("localhostForwarding", Section::Wsl2, Shape::Bool),
    Key::new("kernelCommandLine", Section::Wsl2, Shape::Text),
    Key::new("safeMode", Section::Wsl2, Shape::Bool),
    Key::new("swap", Section::Wsl2, Shape::Size),
    Key::new("swapFile", Section::Wsl2, Shape::Path),
    Key::new("guiApplications", Section::Wsl2, Shape::Bool),
    Key::new("debugConsole", Section::Wsl2, Shape::Bool),
    Key::new("maxCrashDumpCount", Section::Wsl2, Shape::Number),
    Key::new("nestedVirtualization", Section::Wsl2, Shape::Bool),
    Key::new("vmIdleTimeout", Section::Wsl2, Shape::Number),
    Key::new("dnsProxy", Section::Wsl2, Shape::Bool),
    Key::new("networkingMode", Section::Wsl2, Shape::NetworkingMode),
    Key::new("firewall", Section::Wsl2, Shape::Bool),
    Key::new("dnsTunneling", Section::Wsl2, Shape::Bool),
    Key::new("autoProxy", Section::Wsl2, Shape::Bool),
    Key::new("defaultVhdSize", Section::Wsl2, Shape::Size),
    Key::new("kernelDebugPort", Section::Wsl2, Shape::Number),
    Key::new("gpuSupport", Section::Wsl2, Shape::Bool),
    Key::new("systemDistro", Section::Wsl2, Shape::Path),
    Key::new("telemetry", Section::Wsl2, Shape::Bool),
    Key::new("debugConsoleLogFile", Section::Wsl2, Shape::Path),
    Key::new("kernelBootTimeout", Section::Wsl2, Shape::Number),
    Key::new("distributionStartTimeout", Section::Wsl2, Shape::Number),
    Key::new("mountDeviceTimeout", Section::Wsl2, Shape::Number),
    Key::new("crashDumpFolder", Section::Wsl2, Shape::Path),
    Key::new("loadDefaultKernelModules", Section::Wsl2, Shape::Bool),
    Key::new("loadKernelModules", Section::Wsl2, Shape::Text),
    Key::new("isolateDistroCgroup", Section::Wsl2, Shape::Bool),
    // [general] — the distros, not the vm
    Key::new("instanceIdleTimeout", Section::General, Shape::Number),
    Key::new("distributionInstallPath", Section::General, Shape::Path),
    // [experimental] — the two that matter most to a machine eating ram
    // live here, and putting either under [wsl2] is the scar this whole
    // file was written for
    Key::new(
        "autoMemoryReclaim",
        Section::Experimental,
        Shape::MemoryReclaim,
    ),
    Key::new("sparseVhd", Section::Experimental, Shape::Bool),
    Key::new("bestEffortDnsParsing", Section::Experimental, Shape::Bool),
    Key::new("dnsTunnelingIpAddress", Section::Experimental, Shape::Text),
    Key::new(
        "initialAutoProxyTimeout",
        Section::Experimental,
        Shape::Number,
    ),
    Key::new("ignoredPorts", Section::Experimental, Shape::Text),
    Key::new("hostAddressLoopback", Section::Experimental, Shape::Bool),
];

// keys wsl documented once and has since dropped. not "unknown": they were
// real, and a file still carrying one was written against an older wsl and
// has been ignored ever since without a word
const RETIRED: &[(&str, &str)] = &[(
    "pageReporting",
    "an [experimental] key in older WSL releases, gone from WSL's current settings",
)];

// the other file's sections. a .wslconfig with [user] or [boot] in it is
// the classic mix-up: those belong to /etc/wsl.conf, which lives inside
// the distro and configures that one distro
const WSL_CONF_SECTIONS: &[&str] =
    &["automount", "network", "interop", "user", "boot"];

const NETWORKING_MODES: &[&str] = &[
    "none",
    "nat",
    "bridged",
    "mirrored",
    "consomme",
    "virtioproxy",
];
const RECLAIM_MODES: &[&str] = &["disabled", "gradual", "dropcache"];

fn lookup(key: &str) -> Option<&'static Key> {
    // case-insensitive because wsl's own parser is: the docs' example file
    // writes `swapfile=` and `localhostforwarding=` in lower case and both
    // work. so a wrong capital is not a finding, and must not be reported
    // as one
    KEYS.iter().find(|k| k.name.eq_ignore_ascii_case(key))
}

/// What the machine actually has. Separate from the file so the arithmetic
/// rules — a `memory=` left over from a smaller box — test with fixture
/// numbers instead of whatever host the suite runs on.
#[derive(Debug, Clone, Copy, Default)]
pub struct Host {
    pub memory_bytes: Option<u64>,
    pub processors: Option<u32>,
}

/// The report the panel draws.
#[derive(Debug, Clone, Serialize)]
pub struct ConfigReport {
    /// where we looked — named even when nothing is there, because "no
    /// file" is a fact about a path. empty when there was no path to name
    pub path: String,
    pub exists: bool,
    /// why the file was never opened. the same shape `fragmentation::Report`
    /// uses, and for the same reason: "nobody asked this box" must never
    /// render as "this box is fine". none means the path WAS looked at, and
    /// then `exists` is a fact rather than a guess
    pub reason: Option<String>,
    pub host_memory_bytes: Option<u64>,
    pub host_processors: Option<u32>,
    pub findings: Vec<Finding>,
}

// ---------------------------------------------------------------- parsing

#[derive(Debug, PartialEq, Eq)]
struct Pair {
    line: u32,
    /// none means the pair sits above every heading, which wsl ignores
    section: Option<String>,
    key: String,
    value: String,
    raw: String,
}

#[derive(Debug, PartialEq, Eq)]
enum Item {
    Heading {
        line: u32,
        name: String,
        raw: String,
    },
    Pair(Pair),
    /// neither a comment, a heading, nor key=value
    Junk {
        line: u32,
        raw: String,
    },
}

/// `.wslconfig` as items, in file order, with line numbers kept.
///
/// Whole-line comments only (`#` and `;`). An inline `#` is left in the
/// value on purpose: a kernel command line can contain one, and eating it
/// would quietly change what we report the setting as.
fn parse(text: &str) -> Vec<Item> {
    let mut items = Vec::new();
    let mut section: Option<String> = None;
    for (index, raw_line) in text.lines().enumerate() {
        let line = index as u32 + 1;
        let raw = raw_line.trim().to_string();
        if raw.is_empty() || raw.starts_with('#') || raw.starts_with(';') {
            continue;
        }
        if let Some(inner) =
            raw.strip_prefix('[').and_then(|r| r.strip_suffix(']'))
        {
            let name = inner.trim().to_string();
            section = Some(name.clone());
            items.push(Item::Heading { line, name, raw });
            continue;
        }
        match raw.split_once('=') {
            Some((key, value)) => items.push(Item::Pair(Pair {
                line,
                section: section.clone(),
                key: key.trim().to_string(),
                value: value.trim().to_string(),
                raw,
            })),
            None => items.push(Item::Junk { line, raw }),
        }
    }
    items
}

// ------------------------------------------------------------- suggesting

/// Levenshtein, for "did you mean". Kept small: the longest key is 24
/// characters and there are forty of them, so the whole table costs less
/// than a page fault.
fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut row = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            row[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(row[j] + 1);
        }
        std::mem::swap(&mut prev, &mut row);
    }
    prev[b.len()]
}

/// The nearest real key, when one is near enough to name. Two edits at
/// most, and never more than a third of the word, so `memory` does not
/// get offered as the fix for `swap`.
fn nearest(key: &str) -> Option<&'static Key> {
    let lower = key.to_ascii_lowercase();
    let budget = (lower.chars().count() / 3).clamp(1, 2);
    KEYS.iter()
        .map(|k| (distance(&lower, &k.name.to_ascii_lowercase()), k))
        .filter(|(d, _)| *d <= budget)
        .min_by_key(|(d, _)| *d)
        .map(|(_, k)| k)
}

// ------------------------------------------------------------ value shapes

const UNITS: &[(&str, u64)] = &[
    ("tb", 1 << 40),
    ("gb", 1 << 30),
    ("mb", 1 << 20),
    ("kb", 1 << 10),
    ("b", 1),
];

/// A `size` value in bytes, or the reason it is not one.
///
/// The unit is omissible and means bytes — that is wsl's rule, and it is
/// why `memory=24` is not a typo for 24 GB but a request for 24 bytes.
fn parse_size(value: &str) -> Result<u64, String> {
    let v = value.trim();
    let digits: String = v.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return Err("expects a number of bytes, optionally with a unit".into());
    }
    let number: u64 = digits
        .parse()
        .map_err(|_| "the number is too large to be a size".to_string())?;
    let unit = v[digits.len()..].trim();
    if unit.is_empty() {
        return Ok(number);
    }
    match UNITS.iter().find(|(u, _)| u.eq_ignore_ascii_case(unit)) {
        Some((_, factor)) => number
            .checked_mul(*factor)
            .ok_or_else(|| "the number is too large to be a size".to_string()),
        // the one that bites: `24G` is not `24GB`. wsl's units all end in B
        None => Err(format!(
            "`{unit}` is not one of WSL's size units (B, KB, MB, GB, TB)"
        )),
    }
}

fn is_bool(value: &str) -> bool {
    value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false")
}

fn is_number(value: &str) -> bool {
    let body = value.strip_prefix('-').unwrap_or(value);
    !body.is_empty() && body.chars().all(|c| c.is_ascii_digit())
}

/// The shape check for one pair. `None` means the value is fine.
fn shape_finding(pair: &Pair, key: &Key) -> Option<Finding> {
    let bad = |problem: String, fix: String| {
        Some(Finding::new(
            Severity::Error,
            Some(pair.line),
            pair.raw.clone(),
            problem,
            fix,
        ))
    };

    if pair.value.is_empty() {
        return Some(Finding::new(
            Severity::Warning,
            Some(pair.line),
            pair.raw.clone(),
            format!(
                "`{}` is set to nothing, which WSL reads as unset",
                key.name
            ),
            "give it a value, or delete the line so the default is obvious"
                .to_string(),
        ));
    }

    match key.shape {
        Shape::Bool if !is_bool(&pair.value) => bad(
            format!(
                "`{}` is a boolean; `{}` is not one, so WSL falls back to the default",
                key.name, pair.value
            ),
            format!("{}=true or {}=false", key.name, key.name),
        ),
        Shape::Number if !is_number(&pair.value) => bad(
            format!(
                "`{}` is a whole number; `{}` is not one",
                key.name, pair.value
            ),
            format!("{}=<digits>", key.name),
        ),
        Shape::Size => match parse_size(&pair.value) {
            Ok(_) => None,
            Err(why) => bad(
                format!("`{}` {why}", key.name),
                format!("e.g. {}=8GB, or a bare number for bytes", key.name),
            ),
        },
        Shape::NetworkingMode => {
            let v = pair.value.to_ascii_lowercase();
            if v == "bridged" {
                Some(Finding::new(
                    Severity::Warning,
                    Some(pair.line),
                    pair.raw.clone(),
                    "bridged networking has been deprecated since WSL 2.4.5"
                        .to_string(),
                    "mirrored is the supported replacement".to_string(),
                ))
            } else if NETWORKING_MODES.contains(&v.as_str()) {
                None
            } else {
                // documented silent fallback: an unknown value is NAT, so
                // the file reads as if the line were not there
                bad(
                    format!(
                        "`{}` is not a networking mode, and WSL treats an unknown one as NAT — so this line reads as networkingMode=nat",
                        pair.value
                    ),
                    "one of: none, nat, mirrored, consomme".to_string(),
                )
            }
        }
        Shape::MemoryReclaim => {
            let v = pair.value.to_ascii_lowercase();
            if RECLAIM_MODES.contains(&v.as_str()) {
                None
            } else {
                bad(
                    format!(
                        "`{}` is not a reclaim mode, and WSL treats an unknown one as dropCache — so this line reads as autoMemoryReclaim=dropCache",
                        pair.value
                    ),
                    "one of: disabled, gradual, dropCache".to_string(),
                )
            }
        }
        _ => None,
    }
}

// -------------------------------------------------------------- arithmetic

// a memory= this far under wsl's own 50% default is worth a line; closer
// than this and the user plainly meant it
const STALE_MEMORY_FLOOR: u64 = 2 << 30;

/// The class of bug a key table cannot catch: a value that was right on
/// the machine it was written for. `memory=24GB` moved from a 32 GB box to
/// a 64 GB one is still valid, still applied, and now caps WSL below the
/// default it would have picked on its own.
fn arithmetic(pair: &Pair, key: &Key, host: Host) -> Option<Finding> {
    match key.name {
        "memory" => {
            let asked = parse_size(&pair.value).ok()?;
            let total = host.memory_bytes?;
            if asked > total {
                return Some(Finding::new(
                    Severity::Error,
                    Some(pair.line),
                    pair.raw.clone(),
                    format!(
                        "memory={} is more than this machine has ({})",
                        human(asked),
                        human(total)
                    ),
                    format!(
                        "at most {} — or delete the line for WSL's 50% default, {}",
                        human(total),
                        human(total / 2)
                    ),
                ));
            }
            let default = total / 2;
            (asked < default && default - asked >= STALE_MEMORY_FLOOR).then(
                || {
                    let percent = asked as f64 / total as f64 * 100.0;
                    Finding::new(
                        Severity::Warning,
                        Some(pair.line),
                        pair.raw.clone(),
                        format!(
                            "memory={} caps the VM at {percent:.0}% of this machine's {} — under WSL's own default of 50% ({})",
                            human(asked),
                            human(total),
                            human(default)
                        ),
                        format!(
                            "a memory= carried over from a smaller machine stays valid and stays applied. raise it, or delete the line to take the {} default",
                            human(default)
                        ),
                    )
                },
            )
        }
        "processors" => {
            let asked: u32 = pair.value.parse().ok()?;
            let total = host.processors?;
            (asked > total).then(|| {
                Finding::new(
                    Severity::Warning,
                    Some(pair.line),
                    pair.raw.clone(),
                    format!(
                        "processors={asked} but this machine has {total} logical processors"
                    ),
                    format!("at most {total} — WSL cannot hand out cores that are not there"),
                )
            })
        }
        "swap" => {
            let asked = parse_size(&pair.value).ok()?;
            (asked == 0).then(|| {
                Finding::new(
                    Severity::Info,
                    Some(pair.line),
                    pair.raw.clone(),
                    "swap=0 turns the VM's swap file off".to_string(),
                    "deliberate on an SSD-conscious machine, but with no swap a spike that would have paged out is a kill instead".to_string(),
                )
            })
        }
        _ => None,
    }
}

// ------------------------------------------------------------- validation

/// Every finding in a `.wslconfig`'s text, sorted by line.
///
/// Pure: text in, findings out. That is what lets the whole rule set be
/// tested from fixture strings on a machine with no WSL on it.
pub fn validate(text: &str, host: Host) -> Vec<Finding> {
    let items = parse(text);
    let mut findings = Vec::new();
    // headings wsl will not read: every key under one is dead, and saying
    // so once beats saying it per key
    let mut dead: Vec<String> = Vec::new();
    let mut seen: Vec<(String, String)> = Vec::new();

    for item in &items {
        match item {
            Item::Junk { line, raw } => findings.push(Finding::new(
                Severity::Error,
                Some(*line),
                raw.clone(),
                "WSL's parser cannot read this as a setting".to_string(),
                "a setting is key=value; a comment starts with # or ;"
                    .to_string(),
            )),
            Item::Heading { line, name, raw } => match Section::from_name(name)
            {
                Some(_) => {}
                None => {
                    dead.push(name.to_ascii_lowercase());
                    let (problem, fix) = if WSL_CONF_SECTIONS
                        .iter()
                        .any(|s| s.eq_ignore_ascii_case(name))
                    {
                        (
                            format!("[{name}] is a wsl.conf section, not a .wslconfig one — .wslconfig reads only [wsl2], [experimental] and [general]"),
                            "move this block to /etc/wsl.conf inside the distro; it configures that one distro, not the VM".to_string(),
                        )
                    } else {
                        (
                            format!("[{name}] is not a section WSL reads, so every key under it is ignored — no warning, no error"),
                            "the sections are [wsl2], [experimental] and [general]".to_string(),
                        )
                    };
                    findings.push(Finding::new(
                        Severity::Error,
                        Some(*line),
                        raw.clone(),
                        problem,
                        fix,
                    ));
                }
            },
            Item::Pair(pair) => {
                findings.extend(pair_findings(pair, &dead, &mut seen, host));
            }
        }
    }

    findings.sort_by_key(|f| f.line.unwrap_or(u32::MAX));
    findings
}

// one pair's findings. split out because the heading loop above was
// already two levels deep and this is the half worth reading
fn pair_findings(
    pair: &Pair,
    dead: &[String],
    seen: &mut Vec<(String, String)>,
    host: Host,
) -> Vec<Finding> {
    let Some(section_name) = pair.section.as_deref() else {
        return vec![Finding::new(
            Severity::Error,
            Some(pair.line),
            pair.raw.clone(),
            "this setting sits above every heading, and WSL only reads keys inside a section".to_string(),
            "put it under [wsl2]".to_string(),
        )];
    };
    let lower_section = section_name.to_ascii_lowercase();
    // the heading already said this whole block is dead; a second finding
    // per key would bury the one that matters
    if dead.contains(&lower_section) {
        return Vec::new();
    }

    let mut out = Vec::new();
    let fingerprint = (lower_section.clone(), pair.key.to_ascii_lowercase());
    if seen.contains(&fingerprint) {
        out.push(Finding::new(
            Severity::Warning,
            Some(pair.line),
            pair.raw.clone(),
            format!(
                "`{}` is set twice in [{section_name}]; the last one wins and the earlier is dead",
                pair.key
            ),
            "delete whichever one you did not mean".to_string(),
        ));
    } else {
        seen.push(fingerprint);
    }

    match lookup(&pair.key) {
        Some(key) => {
            let here = Section::from_name(section_name);
            // ⭐ the sharp one. the key is real, the value is fine, and wsl
            // throws it away because it is under the wrong heading
            if here != Some(key.section) {
                out.push(Finding::new(
                    Severity::Error,
                    Some(pair.line),
                    pair.raw.clone(),
                    format!(
                        "`{}` is a {} key. Under [{section_name}] WSL ignores it silently — the setting never applies and nothing says so",
                        key.name,
                        key.section.label()
                    ),
                    format!("move `{}` under {}", pair.raw, key.section.label()),
                ));
                return out;
            }
            out.extend(shape_finding(pair, key));
            out.extend(arithmetic(pair, key, host));
        }
        None => out.push(unknown_key(pair)),
    }
    out
}

// a key no table of ours carries. never "invalid": wsl adds settings, and
// declaring a real one bogus is the worse mistake of the two
fn unknown_key(pair: &Pair) -> Finding {
    if let Some((_, note)) = RETIRED
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(&pair.key))
    {
        return Finding::new(
            Severity::Warning,
            Some(pair.line),
            pair.raw.clone(),
            format!("`{}` was {note}, so WSL ignores it", pair.key),
            "delete the line — it has not been doing anything".to_string(),
        );
    }
    match nearest(&pair.key) {
        Some(key) => Finding::new(
            Severity::Error,
            Some(pair.line),
            pair.raw.clone(),
            format!(
                "no WSL setting is called `{}`, and WSL ignores keys it does not know",
                pair.key
            ),
            format!(
                "did you mean `{}`? It goes under {}",
                key.name,
                key.section.label()
            ),
        ),
        None => Finding::new(
            Severity::Warning,
            Some(pair.line),
            pair.raw.clone(),
            format!(
                "`{}` is not one of the settings DevGo knows, and WSL ignores a key it does not recognise",
                pair.key
            ),
            "check the spelling — or it belongs to a newer WSL than this list"
                .to_string(),
        ),
    }
}

// ---------------------------------------------------------------- the file

/// `%USERPROFILE%\.wslconfig`. The HOME fallback is so a non-Windows build
/// still has a path to name; nothing will be at it.
pub fn default_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    Some(std::path::Path::new(&home).join(".wslconfig"))
}

/// Total physical memory, from the kernel's own accounting.
///
/// A process-free read, like the `vmmemWSL` look in wsl_watch: no wsl.exe,
/// no wmic, nothing to spawn and nothing to hang.
#[cfg(windows)]
pub fn host_memory_bytes() -> Option<u64> {
    // MEMORYSTATUSEX as kernel32 lays it out: 64 bytes on x64
    #[repr(C)]
    struct MemoryStatusEx {
        dw_length: u32,
        dw_memory_load: u32,
        ull_total_phys: u64,
        ull_avail_phys: u64,
        ull_total_page_file: u64,
        ull_avail_page_file: u64,
        ull_total_virtual: u64,
        ull_avail_virtual: u64,
        ull_avail_extended_virtual: u64,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatusEx) -> i32;
    }

    let mut status = MemoryStatusEx {
        dw_length: std::mem::size_of::<MemoryStatusEx>() as u32,
        dw_memory_load: 0,
        ull_total_phys: 0,
        ull_avail_phys: 0,
        ull_total_page_file: 0,
        ull_avail_page_file: 0,
        ull_total_virtual: 0,
        ull_avail_virtual: 0,
        ull_avail_extended_virtual: 0,
    };
    // a failed call is no answer, not a zero: the arithmetic rules skip
    // themselves on None, and a zero would call every memory= too large
    (unsafe { GlobalMemoryStatusEx(&mut status) } != 0)
        .then_some(status.ull_total_phys)
}

// no windows, no .wslconfig to be stale against
#[cfg(not(windows))]
pub fn host_memory_bytes() -> Option<u64> {
    None
}

/// The machine's facts, as cheaply as they come. `available_parallelism`
/// is the same number WSL defaults `processors` to.
pub fn host() -> Host {
    Host {
        memory_bytes: host_memory_bytes(),
        processors: std::thread::available_parallelism()
            .ok()
            .map(|n| n.get() as u32),
    }
}

/// Read `.wslconfig` and say what WSL is throwing away.
pub fn report() -> ConfigReport {
    report_from(host(), cfg!(windows), default_path(), |p| {
        std::fs::read_to_string(p)
    })
}

/// The three states, decided from a path and one read attempt.
///
/// ⭐ THREE, never two. "the file is not there" and "I could not look" are
/// different sentences about the machine, and collapsing them is how a
/// panel ends up asserting a healthy default configuration for a file it
/// never opened.
///
/// 1. read, nothing at the path → `exists` false, one Info finding: WSL is
///    on its defaults, and that is the truth on a Windows box.
/// 2. read, file there → `exists` true and the findings.
/// 3. never read → `reason`, and not one word about the configuration.
///
/// Split out from `report` so all three are testable on any host — the one
/// that matters most is the one a Windows dev machine never reaches.
fn report_from(
    host: Host,
    windows: bool,
    path: Option<std::path::PathBuf>,
    read: impl FnOnce(&std::path::Path) -> std::io::Result<String>,
) -> ConfigReport {
    let unread = |path: String, reason: String| ConfigReport {
        path,
        exists: false,
        reason: Some(reason),
        host_memory_bytes: host.memory_bytes,
        host_processors: host.processors,
        findings: Vec::new(),
    };

    // `.wslconfig` is a file on a Windows profile. off Windows — a linux
    // build, or this same binary running INSIDE wsl, where USERPROFILE is
    // gone and HOME is /home/<you> — default_path() names a path on the
    // wrong filesystem entirely, and the real C:\Users\<you>\.wslconfig
    // sits there unread. detection.rs sets wsl_available from
    // WSL_DISTRO_NAME, so the panel DOES render in that case
    if !windows {
        return unread(
            String::new(),
            "DevGo is not running on Windows, so it cannot reach \
             %USERPROFILE%\\.wslconfig — the real file lives on the Windows \
             side. Nothing here has been read, and nothing here says your \
             configuration is fine."
                .to_string(),
        );
    }

    let Some(path) = path else {
        return unread(
            String::new(),
            "Neither USERPROFILE nor HOME is set, so there is no path to \
             look at. DevGo has not read a .wslconfig, and nothing here says \
             your configuration is fine."
                .to_string(),
        );
    };
    let shown = path.display().to_string();
    match read(&path) {
        Ok(text) => ConfigReport {
            path: shown,
            exists: true,
            reason: None,
            host_memory_bytes: host.memory_bytes,
            host_processors: host.processors,
            findings: validate(&text, host),
        },
        // no file is the healthy case, and worth saying out loud: a user
        // hunting a memory cap that is not there should be told there is
        // no file to hold one
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => ConfigReport {
            path: shown,
            exists: false,
            reason: None,
            host_memory_bytes: host.memory_bytes,
            host_processors: host.processors,
            findings: vec![Finding::new(
                Severity::Info,
                None,
                "no .wslconfig".to_string(),
                "there is no file here, so WSL is running on its defaults"
                    .to_string(),
                match host.memory_bytes {
                    Some(total) => format!(
                        "half this machine's memory ({}) and every logical processor",
                        human(total / 2)
                    ),
                    None => "half the machine's memory and every logical processor"
                        .to_string(),
                },
            )],
        },
        // ⛔ NOT "absent". a permission error, a path that is a directory,
        // a profile on a disconnected drive — the file may hold every
        // setting in the book, and this panel has seen none of them
        Err(e) => unread(
            shown.clone(),
            format!(
                "DevGo could not read {shown}: {e}. The file has not been \
                 looked at, so nothing here says your configuration is fine."
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host64() -> Host {
        Host {
            memory_bytes: Some(64 << 30),
            processors: Some(12),
        }
    }

    fn only(text: &str) -> Vec<Finding> {
        validate(text, host64())
    }

    fn problems(text: &str) -> Vec<String> {
        only(text).into_iter().map(|f| f.problem).collect()
    }

    /// A file with nothing wrong in it must produce nothing. The rule set
    /// is worth having only if it stays quiet on a good file.
    #[test]
    fn a_correct_file_has_no_findings() {
        let text = "\
# the vm
[wsl2]
memory=48GB
processors=12
swap=8GB
localhostForwarding=true
networkingMode=mirrored
nestedVirtualization=false

[experimental]
autoMemoryReclaim=gradual
sparseVhd=true
hostAddressLoopback=true

[general]
instanceIdleTimeout=-1
";
        assert_eq!(only(text), Vec::new());
    }

    /// wsl's parser is case-insensitive and the docs' own example file is
    /// lower case. a wrong capital must not be reported as anything.
    #[test]
    fn lower_case_keys_are_not_findings() {
        assert_eq!(
            only("[wsl2]\nswapfile=C:\\temp\\swap.vhdx\nlocalhostforwarding=true\n"),
            Vec::new()
        );
    }

    /// ⭐ The scar. Right key, wrong heading: valid file, valid value, and
    /// wsl throws it away without a word.
    #[test]
    fn a_right_key_in_the_wrong_section_is_an_error() {
        let found = only("[wsl2]\nautoMemoryReclaim=gradual\nsparseVhd=true\n");
        assert_eq!(found.len(), 2);
        for f in &found {
            assert_eq!(f.severity, Severity::Error);
            assert!(
                f.problem.contains("[experimental]"),
                "must name the section that owns it: {}",
                f.problem
            );
            assert!(f.problem.contains("ignores it silently"));
        }
        assert_eq!(found[0].line, Some(2));
        assert!(found[0].fix.contains("move `autoMemoryReclaim=gradual`"));
    }

    /// And the other direction: a [wsl2] key parked under [experimental].
    #[test]
    fn a_wsl2_key_under_experimental_is_an_error_too() {
        let found = only("[experimental]\nmemory=8GB\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Error);
        assert!(found[0].fix.contains("[wsl2]"));
    }

    #[test]
    fn a_typo_is_named_and_the_real_key_offered() {
        let found = only("[wsl2]\nprocesors=8\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Error);
        assert!(found[0].problem.contains("no WSL setting is called"));
        assert!(found[0].fix.contains("processors"), "{}", found[0].fix);
    }

    /// A key nothing is close to is unknown, not invalid — wsl adds
    /// settings, and calling a real one bogus is the worse mistake.
    #[test]
    fn an_unrecognised_key_is_a_warning_not_an_error() {
        let found = only("[wsl2]\nsomeFutureSetting=true\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Warning);
        assert!(found[0].fix.contains("newer WSL"));
    }

    /// joy's own line. real once, dropped since, ignored ever after.
    #[test]
    fn a_retired_key_says_it_was_real_and_is_not_now() {
        let found = only("[experimental]\npageReporting=true\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Warning);
        assert!(found[0].problem.contains("older WSL releases"));
    }

    #[test]
    fn bad_value_shapes_are_caught_per_type() {
        // booleans
        let found = only("[wsl2]\nguiApplications=yes\n");
        assert_eq!(found.len(), 1);
        assert!(found[0].problem.contains("boolean"));
        // numbers
        assert_eq!(
            problems("[wsl2]\nprocessors=eight\n"),
            vec!["`processors` is a whole number; `eight` is not one"]
        );
        // the unit that bites: 24G is not 24GB
        let found = only("[wsl2]\nmemory=24G\n");
        assert_eq!(found.len(), 1);
        assert!(
            found[0].problem.contains("not one of WSL's size units"),
            "{}",
            found[0].problem
        );
        assert!(found[0].fix.contains("8GB"));
    }

    /// Both enums fall back silently, and the finding has to say to what —
    /// that is the difference between "wrong" and "reads as something else".
    #[test]
    fn unknown_enum_values_report_what_wsl_falls_back_to() {
        let found = only("[wsl2]\nnetworkingMode=miroredd\n");
        assert_eq!(found.len(), 1);
        assert!(found[0].problem.contains("networkingMode=nat"));

        let found = only("[experimental]\nautoMemoryReclaim=grdual\n");
        assert_eq!(found.len(), 1);
        assert!(found[0].problem.contains("autoMemoryReclaim=dropCache"));
    }

    #[test]
    fn bridged_networking_is_flagged_as_deprecated() {
        let found = only("[wsl2]\nnetworkingMode=bridged\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Warning);
        assert!(found[0].fix.contains("mirrored"));
    }

    /// A whole block under a heading wsl does not read. One finding, on
    /// the heading — not one per dead key.
    #[test]
    fn an_unknown_section_is_flagged_once_and_its_keys_are_not() {
        let found = only("[wsl3]\nmemory=8GB\nprocessors=4\nswap=0\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].line, Some(1));
        assert!(found[0].problem.contains("not a section WSL reads"));
    }

    /// The other file's sections in this one. Says which file they belong to.
    #[test]
    fn a_wsl_conf_section_says_it_is_the_other_file() {
        let found = only("[boot]\nsystemd=true\n");
        assert_eq!(found.len(), 1);
        assert!(found[0].problem.contains("wsl.conf section"));
        assert!(found[0].fix.contains("/etc/wsl.conf"));
    }

    #[test]
    fn a_setting_above_every_heading_is_flagged() {
        let found = only("memory=8GB\n[wsl2]\nprocessors=4\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].line, Some(1));
        assert!(found[0].problem.contains("above every heading"));
    }

    #[test]
    fn a_line_that_is_not_a_setting_is_flagged() {
        let found = only("[wsl2]\nmemory 8GB\n");
        assert_eq!(found.len(), 1);
        assert!(found[0].problem.contains("cannot read this as a setting"));
    }

    /// Comments and blanks are not settings and must never be findings.
    #[test]
    fn comments_and_blank_lines_are_skipped() {
        assert_eq!(
            only("# a note\n\n; another\n[wsl2]\nswap=8GB\n"),
            Vec::new()
        );
    }

    #[test]
    fn the_same_key_twice_says_the_earlier_one_is_dead() {
        let found = only("[wsl2]\nmemory=48GB\nmemory=32GB\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].line, Some(3));
        assert!(found[0].problem.contains("set twice"));
    }

    #[test]
    fn an_empty_value_is_a_warning() {
        let found = only("[wsl2]\nmemory=\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Warning);
        assert!(found[0].problem.contains("set to nothing"));
    }

    /// ⭐ The arithmetic class: joy's `memory=24GB` on the 64 GB machine it
    /// moved to. Valid key, valid section, valid value, still wrong.
    #[test]
    fn a_memory_cap_below_wsls_own_default_is_flagged() {
        let found = only("[wsl2]\nmemory=24GB\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Warning);
        // the three numbers that make the case: what is asked, what the
        // machine has, what wsl would have picked on its own
        // spelled in binary units, the same way the panel spells its own
        // numbers — two unit systems in one card is the bug this pins
        for expected in ["24.0 GiB", "64.0 GiB", "32.0 GiB"] {
            assert!(
                found[0].problem.contains(expected),
                "{expected} missing from: {}",
                found[0].problem
            );
        }
        assert!(found[0].fix.contains("smaller machine"));
    }

    #[test]
    fn a_memory_cap_at_or_above_the_default_is_left_alone() {
        assert_eq!(only("[wsl2]\nmemory=32GB\n"), Vec::new());
        assert_eq!(only("[wsl2]\nmemory=48GB\n"), Vec::new());
        // just under half, but not by enough to be worth a line
        assert_eq!(only("[wsl2]\nmemory=31GB\n"), Vec::new());
    }

    #[test]
    fn a_memory_cap_above_the_host_is_an_error() {
        let found = only("[wsl2]\nmemory=128GB\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Error);
        assert!(found[0].problem.contains("more than this machine has"));
    }

    /// With no host reading the arithmetic rules must stay silent rather
    /// than guess — a zero host would call every memory= too large.
    #[test]
    fn without_host_facts_the_arithmetic_rules_say_nothing() {
        assert_eq!(validate("[wsl2]\nmemory=24GB\n", Host::default()), vec![]);
        assert_eq!(
            validate("[wsl2]\nprocessors=64\n", Host::default()),
            vec![]
        );
    }

    #[test]
    fn more_processors_than_the_machine_has_is_flagged() {
        let found = only("[wsl2]\nprocessors=32\n");
        assert_eq!(found.len(), 1);
        assert!(found[0].problem.contains("12 logical processors"));
    }

    #[test]
    fn swap_off_is_worth_an_info_line() {
        let found = only("[wsl2]\nswap=0\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Info);
    }

    /// An empty file is not a finding: there is nothing being ignored.
    #[test]
    fn an_empty_file_is_silent() {
        assert_eq!(only(""), Vec::new());
        assert_eq!(only("\n\n# just a note\n"), Vec::new());
    }

    #[test]
    fn findings_come_back_in_file_order() {
        let lines: Vec<Option<u32>> = only(
            "[wsl2]\nsparseVhd=true\nprocesors=8\nmemory=24GB\nguiApplications=yes\n",
        )
        .iter()
        .map(|f| f.line)
        .collect();
        assert_eq!(lines, vec![Some(2), Some(3), Some(4), Some(5)]);
    }

    #[test]
    fn sizes_parse_with_and_without_a_unit() {
        assert_eq!(parse_size("1024"), Ok(1024));
        assert_eq!(parse_size("8GB"), Ok(8 << 30));
        assert_eq!(parse_size("512 MB"), Ok(512 << 20));
        assert_eq!(parse_size("2tb"), Ok(2 << 40));
        assert!(parse_size("8G").is_err());
        assert!(parse_size("lots").is_err());
        assert!(parse_size("").is_err());
        // a number no size can hold must be an error, never a wrap
        assert!(parse_size("99999999999999999999GB").is_err());
    }

    /// The suggester must not offer a key that is merely short. `swap` and
    /// `memory` are both real; neither is the fix for the other.
    #[test]
    fn nearest_only_offers_a_genuinely_near_key() {
        assert_eq!(nearest("procesors").map(|k| k.name), Some("processors"));
        assert_eq!(nearest("memroy").map(|k| k.name), Some("memory"));
        assert_eq!(nearest("swapfile").map(|k| k.name), Some("swapFile"));
        assert_eq!(nearest("totallyMadeUpKeyName").map(|k| k.name), None);
    }

    /// Every key in the table must be reachable by its own name and land
    /// in its own section — a typo in the table would be a validator that
    /// reports a real key as unknown.
    #[test]
    fn every_documented_key_validates_in_its_own_section() {
        for key in KEYS {
            let value = match key.shape {
                Shape::Bool => "true",
                Shape::Number => "1",
                Shape::Size => "1GB",
                Shape::NetworkingMode => "mirrored",
                Shape::MemoryReclaim => "gradual",
                Shape::Path | Shape::Text => "x",
            };
            let text =
                format!("{}\n{}={value}\n", key.section.label(), key.name);
            assert_eq!(
                validate(&text, Host::default()),
                Vec::new(),
                "{} under {} should be clean",
                key.name,
                key.section.label()
            );
        }
    }

    // a key listed twice, or listed under two sections, would make the
    // wrong-section rule fire on a correct file
    #[test]
    fn the_key_table_has_no_duplicates() {
        let mut names: Vec<String> =
            KEYS.iter().map(|k| k.name.to_ascii_lowercase()).collect();
        names.sort();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count);
    }

    // the probe against this machine's own .wslconfig. ignored because the
    // answer depends on whose box it runs on; run by hand with
    // ------------------------------------------- the three states

    fn at(name: &str) -> Option<std::path::PathBuf> {
        Some(std::path::PathBuf::from(name))
    }

    fn io(kind: std::io::ErrorKind, msg: &str) -> std::io::Error {
        std::io::Error::new(kind, msg)
    }

    /// State 1. A Windows box with no file: WSL really is on its defaults,
    /// and saying so is the correct answer, not a guess.
    #[test]
    fn a_missing_file_on_windows_is_read_and_reported_as_defaults() {
        let r = report_from(
            host64(),
            true,
            at("C:\\Users\\joy\\.wslconfig"),
            |_| Err(io(std::io::ErrorKind::NotFound, "nope")),
        );
        assert_eq!(r.reason, None, "the path WAS looked at");
        assert!(!r.exists);
        assert_eq!(r.findings.len(), 1);
        assert!(r.findings[0].problem.contains("running on its defaults"));
    }

    /// State 2.
    #[test]
    fn a_readable_file_is_validated() {
        let r = report_from(
            host64(),
            true,
            at("C:\\Users\\joy\\.wslconfig"),
            |_| Ok("[wsl2]\nmemory=48GB\n".to_string()),
        );
        assert_eq!(r.reason, None);
        assert!(r.exists);
    }

    /// ⭐ State 3, the whole point. A read that FAILED for any reason but
    /// "there is nothing there" is not evidence of a healthy default — the
    /// file may hold every setting in the book.
    #[test]
    fn a_read_error_is_a_reason_and_never_a_health_claim() {
        let r = report_from(
            host64(),
            true,
            at("C:\\Users\\joy\\.wslconfig"),
            |_| {
                Err(io(
                    std::io::ErrorKind::PermissionDenied,
                    "access is denied",
                ))
            },
        );
        let reason = r.reason.expect("a failed read must state why");
        assert!(reason.contains("could not read"));
        assert!(!r.exists);
        assert!(
            r.findings.is_empty(),
            "no findings about a file nobody opened"
        );
        assert!(
            !reason.contains("on its defaults"),
            "state 3 must make no claim about the configuration"
        );
    }

    /// ⭐ Inside WSL. detection.rs sets `wsl_available` from
    /// WSL_DISTRO_NAME, so the panel renders; default_path() resolves HOME
    /// to /home/<you>/.wslconfig, which is not the file. Reporting "absent
    /// — WSL is on its defaults" there is a false statement about the
    /// machine, because C:\Users\<you>\.wslconfig is sitting unread.
    #[test]
    fn off_windows_nothing_is_read_and_nothing_is_claimed() {
        let r =
            report_from(host64(), false, at("/home/joy/.wslconfig"), |_| {
                panic!("must not even try to read off Windows")
            });
        let reason = r.reason.expect("off Windows must state why");
        assert!(reason.contains("not running on Windows"));
        assert!(r.path.is_empty(), "a linux path is not the file we mean");
        assert!(!r.exists);
        assert!(r.findings.is_empty());
        assert!(!reason.contains("on its defaults"));
    }

    /// No USERPROFILE and no HOME: there is no path, so there is no fact.
    #[test]
    fn no_path_at_all_is_a_reason_not_an_absent_file() {
        let r = report_from(host64(), true, None, |_| {
            panic!("there is nothing to read")
        });
        let reason = r.reason.expect("a missing path must state why");
        assert!(reason.contains("no path to look at"));
        assert!(r.findings.is_empty());
    }

    /// The host readings survive every state — they come from the kernel,
    /// not from the file, and are true whether or not it was read.
    #[test]
    fn the_host_readings_are_carried_in_all_three_states() {
        for r in [
            report_from(host64(), false, None, |_| unreachable!()),
            report_from(host64(), true, at("x"), |_| {
                Err(io(std::io::ErrorKind::NotFound, "nope"))
            }),
            report_from(host64(), true, at("x"), |_| Ok(String::new())),
        ] {
            assert_eq!(r.host_memory_bytes, Some(64 << 30));
            assert_eq!(r.host_processors, Some(12));
        }
    }

    /// The panel reads snake_case ambient globals — no `rename_all` lives
    /// in this module, and `reason` must arrive spelled that way.
    #[test]
    fn reason_serialises_as_reason() {
        let r = report_from(host64(), false, None, |_| unreachable!());
        let json = serde_json::to_value(&r).unwrap();
        assert!(json["reason"].is_string());
        assert!(json["host_memory_bytes"].is_u64());
        let ok = report_from(host64(), true, at("x"), |_| Ok(String::new()));
        assert!(serde_json::to_value(&ok).unwrap()["reason"].is_null());
    }

    // cargo test -- --ignored --nocapture real_wslconfig
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn real_wslconfig_reads_on_this_machine() {
        let r = report();
        println!("path = {} (exists {})", r.path, r.exists);
        println!(
            "host = {} memory, {:?} processors",
            r.host_memory_bytes.map(human).unwrap_or("?".into()),
            r.host_processors
        );
        for f in &r.findings {
            println!(
                "  {:?} line {:?}: {} | {} | {}",
                f.severity, f.line, f.text, f.problem, f.fix
            );
        }
        // a path is named even when nothing is at it — "no file" is a fact
        // about a path, so an empty one means USERPROFILE and HOME are both
        // unset, which is a broken environment and not a healthy machine
        assert!(!r.path.is_empty(), "no path to name");
        // the memory read is process-free, so on Windows it cannot fail for
        // an environmental reason. a None here is the kernel call failing
        assert!(
            r.host_memory_bytes.is_some(),
            "GlobalMemoryStatusEx gave nothing"
        );
    }
}
