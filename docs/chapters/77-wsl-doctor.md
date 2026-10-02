# 77 — What WSL Was Told

**Branch:** `77.wsl-doctor` — `git diff 3c6a6c5 77.wsl-doctor` is the backend this chapter starts from: the `wsl_doctor` module, its two commands and their types, 2,113 lines in 7 files. **It is not the finished chapter.** The branch never got a UI; it was merged as it stood (`b7e98f9 ✅MERGE: the wsl doctor's 2,113 lines join the branch that has a UI`) into the line that became `78.file-manager`, and the panel and every fix after `d259725` were made there. So the finished tree for this chapter is `main` from `v1.2.3` on, the first release that carries the panel — not the branch tip.

**Starting from:** `3c6a6c5`, the same commit 78 starts from. For everything that landed between 76 and here, read 78's *Also since 76*; it is the same list.

**Goal:** WSL reads `%USERPROFILE%\.wslconfig` and has no error channel. A misspelled key, a real key under the wrong heading, a value it cannot parse — every one of them is a silent no-op: the file still parses, WSL still starts, and the setting simply never applies. And the crash that sent this work looking was not an out-of-memory at all: a process died with a SIGABRT, nothing in `dmesg` from the OOM killer, while the memory graph looked fine. The kernel had plenty of free *pages* and no free *runs* of pages. This chapter is a doctor for both, as a Settings panel — and a doctor that only reads. It writes no file, starts no distro, runs no `wsl --shutdown`, and never runs on a clock.

> **Hold on to:**
> 1. **Validate the file, not the VM.** The question is not *how much memory is the VM using*, it is *what was WSL told, and how much of it is WSL throwing away*. A key under the wrong heading leaves no trace in the VM's behaviour — that is exactly why it goes unnoticed for weeks — so the only place to catch it is the text.
> 2. **A stopped distro is not a sick distro.** Looking inside the VM costs a file open in a distro that is already running. Starting one to look would be the tool creating the condition it reports on, so the probe refuses and says why.
> 3. **"I could not look" is not "it is fine".** Both reports carry a `reason: Option<String>`, and a reason is the whole answer — never a reason *above* a grid of dashes, because a column of dashes reads as a reading. `reason: None` is the only thing that licenses a claim about what was found. The rule outlived this panel: `services/scripts.rs`'s `ScriptList::reason` cites it by name.
> 4. **A rule written down once.** WSL2's default `memory` was written in four places, and all four were wrong together, by 4x. It is one function now.

---

## 77.1 — The validator

`src-tauri/src/services/wsl_doctor/wslconfig.rs`. The module's first comment says why it exists, and names the scar: a real `.wslconfig` carried `pageReporting=true` for weeks, doing nothing at all.

`KEYS` is the table, one `Key::new(name, section, shape)` per line — a `const fn` purely so a key stays one line instead of five. 41 entries, taken from WSL's *Advanced settings configuration* tables for the three sections `.wslconfig` actually reads: `[wsl2]` (the VM), `[general]` (the distros) and `[experimental]`. Two of the keys that matter most on a machine eating RAM, `autoMemoryReclaim` and `sparseVhd`, live under `[experimental]`, and putting either under `[wsl2]` is the mistake this file was written for. Beside it:

- `RETIRED` — `pageReporting`, a key WSL documented once and dropped. Not *unknown*: it was real, and a file still carrying it was written against an older WSL.
- `WSL_CONF_SECTIONS` — `automount`, `network`, `interop`, `user`, `boot`. A `.wslconfig` with `[boot]` in it is the classic mix-up with `/etc/wsl.conf`, the other file, which lives inside the distro.
- `NETWORKING_MODES` and `RECLAIM_MODES`, for the two keys whose bad value has a *documented* silent fallback: an unknown `networkingMode` is NAT, an unknown `autoMemoryReclaim` is `dropCache`. The finding says what the line actually reads as.

`parse(text)` turns the file into `Item`s in file order with 1-based line numbers: `Heading`, `Pair`, or `Junk` (neither comment, heading nor `key=value`). Whole-line comments only, `#` and `;` — an inline `#` stays in the value, because a kernel command line can contain one and eating it would change what the setting is reported as.

`validate(text, host)` is pure, text in and findings out, which is what lets the whole rule set run from fixture strings on a box with no WSL. Its rules, each a `Finding { severity, line, text, problem, fix }`:

- a heading WSL does not read is one **Error**, and every key under it is then silent — one finding beats one per key. A `wsl.conf` heading gets the *move this to /etc/wsl.conf* fix instead.
- a key above every heading is an **Error**: WSL only reads keys inside a section.
- **the sharp one**: a real key, a fine value, the wrong heading. **Error**, naming the section that owns it, and the fix is the literal line to move:

```rust
format!(
    "`{}` is a {} key. Under [{section_name}] WSL ignores it silently — the setting never applies and nothing says so",
    key.name,
    key.section.label()
),
```

- a key no table carries goes through `unknown_key`. A retired key is a **Warning**. A key within `nearest()`'s budget — Levenshtein, at most two edits and never more than a third of the word, so `memory` is not offered as the fix for `swap` — is an **Error** with *did you mean*. Anything else is a **Warning**, never *invalid*: WSL adds settings, and declaring a real one bogus is the worse mistake of the two.
- the same key twice in a section is a **Warning** — the last one wins and the earlier is dead.
- `shape_finding` checks the value: an empty value is a **Warning**; a bad bool, number or size an **Error**; `bridged` a **Warning** (deprecated since WSL 2.4.5, `mirrored` replaces it). `parse_size` follows WSL's rule that the unit is optional and means bytes — `memory=24` is a request for 24 bytes — and refuses `24G`, because WSL's units all end in `B`.

Keys match case-insensitively, because WSL's own parser does: the documentation's example file writes `swapfile=` and `localhostforwarding=`, and both work. A wrong capital is not a finding. Findings come back sorted by line.

## 77.2 — The arithmetic a key table cannot do

A value can be valid, applied, and wrong — because it was right on the machine it was written for. `arithmetic(pair, key, host)` checks three keys against `Host { memory_bytes, processors }`, which is separate from the file so the tests can hand it fixture numbers:

- `memory=` more than the host has is an **Error**.
- `memory=` at least `STALE_MEMORY_FLOOR` (2 GiB) under WSL's own default is a **Warning**: *a memory= carried over from a smaller machine stays valid and stays applied*.
- `processors=` above the host's logical processors is a **Warning**; `swap=0` is **Info** — deliberate on some machines, but with no swap a spike that would have paged out is a kill instead.

Host memory comes from `GlobalMemoryStatusEx` over a hand-declared `MEMORYSTATUSEX` — a process-free read, nothing to spawn and nothing to hang. A failed call is `None`, never zero, because a zero would call every `memory=` too large; the arithmetic rules skip themselves on `None`. Processors come from `std::thread::available_parallelism`, the same number WSL defaults `processors` to.

The default itself was wrong when it arrived. The draft assumed half the host. Microsoft documents *50% of total memory on Windows, or 8GB, whichever is less*, so a 64 GiB box gets 8 GiB, not 32 — the panel was over-reporting the default by 4x, warning that `memory=24GB` sat *below* a default it actually tripled, and promising a user with no file *half this machine's memory*. `e5f3542 ✅FIX: the doctor stops over-reporting WSL2 default memory by 4x` puts the rule in one place:

```rust
fn wsl_default_memory(host_total: u64) -> u64 {
    (host_total / 2).min(WSL_DEFAULT_MEMORY_CAP)
}
```

The doc comment above it says what it rests on — the documentation, not a measurement, because the default cannot be observed on a box whose file sets `memory=`, and DevGo will not start a distro to find out — and why it is not build-conditional: builds before 20175 took 80%, every supported build is past that, and `Host` carries no build number. The consequence is written on `arithmetic` rather than left to be rediscovered: on any host of 16 GiB or more, only a `memory=` of 6 GiB or less now fires the warning.

## 77.3 — The fragmentation probe

`src-tauri/src/services/wsl_doctor/fragmentation.rs`. `/proc/buddyinfo` is the kernel's free list itself: one row per memory zone, one column per order, and column *n* is how many free runs of 2^n pages the zone has left. The whole probe is three read-only lines, each tagged at the front so the parser is pure text and one round trip carries all three readings:

```rust
const PROBE: &str = "\
sed 's/^/buddy /' /proc/buddyinfo 2>/dev/null
sed 's/^/mem /' /proc/meminfo 2>/dev/null
dmesg 2>/dev/null | grep -iE 'order:[0-9]+' | tail -n 40 | sed 's/^/dmesg /'
";
```

It goes over through `wsl::probe_lines(distro, PROBE)`, the same `bash -lic` bridge that agent detection in `editors.rs` and the tmux session list in `sessions.rs` already use. `read_probe(lines)` sorts the tags into `Readings { zones, meminfo, failures }`:

- `parse_buddy` is strict. The column count is the kernel's `MAX_ORDER` and differs between builds, so it is never assumed — but a row with a non-number in it is dropped whole, because a half-read free list produces a confident wrong answer. `MAX_SANE_ORDER` (24) stops a stray row from becoming a shift nobody meant.
- `parse_meminfo` reads `kB` as KiB, which is what the kernel has always meant by it.
- `parse_order` pulls the order out of a `page allocation failure: order:4` line.

Each `Zone` carries its `free_bytes`, its `largest_free_order`, and `high_order_bytes` — the free bytes sitting in runs of `HIGH_ORDER` (4: sixteen pages, 64 KiB) or bigger, the first order whose exhaustion kills things rather than slowing them. `assess(readings)` turns that into findings:

- a zone with free memory and **no** high-order runs is an **Error**: *this is the shape behind a SIGABRT with no OOM message*. The fix says `wsl --shutdown` rebuilds the VM and its free lists, and says *DevGo will not run it for you*.
- under a twentieth of a zone's free memory contiguous is a **Warning** — not starved yet, breaking up.
- zones under `ZONE_FLOOR` (64 MiB) are skipped: the DMA zones are a few megabytes by design and always empty up top, and saying so would bury the zone that matters.
- an `order:` line in the kernel ring is an **Error** — *not a prediction, it already happened*. None is an **Info** that admits the ambiguity: *or dmesg is restricted in this distro, which reads the same from outside*.
- swap under a tenth free is a **Warning**.
- and when no zone was flagged, the healthy reading is said out loud as an **Info** headline — largest free run, and how much of the biggest zone is contiguous. *A panel that shows nothing when all is well cannot be told from a panel that failed to look.*

`report(requested)` is where the second rule lives. It asks `wsl::running_distros()` — `wsl -l -q --running`, a management call that starts nothing, and deliberately not the five-second memo, because a button press is owed an answer now. Nothing running, or the named distro stopped, comes back as a `Report` with a `reason` and no readings. With no name it reads whichever distro is up, `running[0]`, not the default — the default may be the one that is stopped.

`the_probe_script_only_reads` holds the read-only promise: no `sudo`, `sysctl -w`, `wsl --shutdown`, `systemctl` or `rm `, and every `>` in the script must be a `2>/dev/null`.

## 77.4 — Two commands, and a panel

`src-tauri/src/commands.rs`, on the branch. `wsl_config_report()` and `wsl_fragmentation(distro: Option<String>)`, registered in `lib.rs`. Neither mutates anything and neither returns an error: a Mac gets a valid report saying there is nothing here, a stopped distro gets a reason. The difference between them is the whole design — the first reads one text file and spawns nothing; the second shells into a distro and stalls for as long as a wedged WSLService takes to answer. Tauri runs both off the UI thread, so a stall blocks the call, not the window.

`src/components/WslDoctor.tsx` is the face, added after the merge (`214d3ec`), as the *WSL doctor* entry in Settings. It follows from the split:

- it gates on `get_runtime_info`'s `wsl_available` rather than waiting for an error that will never arrive. No WSL is a heading, *No WSL on this machine*, and a sentence saying there is nothing to read and nothing is wrong.
- *The `.wslconfig` file* is read the moment the panel opens: Path, File, Host memory, Host processors, then *What the file says*.
- *Memory fragmentation* runs on **Run the probe** and never on mount or a clock: Memory, Free lists — one chip per order, `4:0` meaning no free run of sixteen pages is left — any allocation failures already in the ring, then *What the readings say*.
- an empty findings list renders *Nothing to report.* under its group heading. It is a result: the doctor saying it looked.

Severity is carried by the word first, the glyph second and only then by colour — `✕ Error`, `▲ Warning`, `● Info` — because the point of the list is the one error among nine findings that are not, and rose against white collapses in greyscale. `Backups.tsx` later took the same rule and cites the doctor for it.

## 77.5 — Making it look like it belongs

The panel's first version was driven in the running app over CDP and corrected in `757e01c`, `3cf9190` and `eff3c5a`. The judgements worth keeping:

- **Run the probe is a secondary button.** Every primary button in the app commits something; this one writes nothing, and the panel's own header says so.
- **One unit system, one spelling.** `wsl_doctor::human` divided by 1024 and printed `GB`, while the panel's `bytes()` printed `GiB` off the same bytes — so one card read `25.6 GiB free` above `25.3 GB of this zone's 25.6 GB free`. Units are spelled binary now, and with one decimal above `B` at every size: `human` used to drop the decimal past 99.9 (`128 GiB`) where `bytes()` kept it (`128.0 GiB`), invisible on a 64 GiB host. Three tests in `mod.rs` pin it, including that no unit escapes as `KB`/`MB`/`GB`.
- **Warning is weight, not hue.** It wore `border-border-strong`, a blue thirty degrees off the accent — the colour that means *click this* on the chip that means *look at this*. There is no amber token in any palette, so warning became the only *filled* chip (`bg-bg-raised`), a step the contrast gate already guarantees.
- **Findings are outlined, zones are filled**, and every findings group has a heading, so a sentence *about* the readings no longer looks like another reading.

## 77.6 — The file it never opened

`7bea1ec ✅WSL: the doctor stops calling a file it never opened healthy`. `ConfigReport` had two states where it needed three: a missing file and a file it could not look at both came back `exists: false`, and the panel drew both as *absent — WSL is on its defaults*.

That bites inside WSL, which is not theoretical. `detection.rs` sets `wsl_available` from `WSL_DISTRO_NAME`, so the panel renders there; `default_path()` falls back from `USERPROFILE` to `HOME` and names `/home/<you>/.wslconfig`; and the panel reported a healthy default configuration while the real file sat unread on the other filesystem. `report_from(host, windows, path, read)` is split out of `report()` so all three states test on any host:

1. read, nothing at the path → `exists: false` and one **Info**: WSL is on its defaults — the lesser of half this machine and 8 GiB, and every logical processor. True on Windows, because there it was looked at.
2. read, file there → `exists: true` and the findings.
3. never read → `reason`, and not one word about the configuration. Exactly three causes: not on Windows, no path at all, or a read that failed for anything other than `NotFound` — permissions, a directory, a disconnected profile drive.

The panel renders a reason *instead of* the grid, the same way the probe's reason already was.

## 77.7 — Read a real machine

Every test the draft carried was a string typed beside the code it tests, and the module's whole subject is what real files and real free lists say. Two commits closed that.

`d259725` (on the branch) added probes that call `wslconfig::report()` and `fragmentation::report(None)` on the box running the tests, printing what they read. They assert the contract, not a number, because the numbers belong to whichever box runs them: a report with no zones must carry a reason and one with zones must not.

`d8e1075 ✅TEST: the WSL doctor finally reads a real machine, and 4096 is confirmed` made them real gates and added a captured machine:

- `fixtures/real_probe_ubuntu_2604.txt` is the exact `PROBE` output from an Ubuntu-26.04 distro that was **already running** — none was started — with a provenance header naming the kernel, the capture time and the commit it was taken at. `uname -a` was deliberately not captured: it embeds the hostname, which would carry a name into a public repo.
- `fixtures/real_pagesize_ubuntu_2604.txt` is `getconf PAGESIZE` from the same distro, and `the_real_machines_page_size_matches_the_hardcoded_constant` compares it to `PAGE_SIZE`. Every byte figure scales off that constant; a 16K-page kernel would have made every number 4x low with the suite green.
- the `real_capture` tests assert properties, not a transcript: every `buddy` row became a zone, the `kB` row converts to KiB (read back out of the fixture text, not retyped), every zone's totals reconcile against its own columns, and the capture assesses to a healthy headline with no Error.
- `memory_status_ex_is_64_bytes_on_x64` pins the FFI struct's size, as `wsl_watch.rs` already did for its own.
- the doctor's two live-machine tests, `real_wslconfig_reads_on_this_machine` and `real_fragmentation_reads_on_this_machine`, moved from `#[ignore]` to an environment gate, and so did `wsl_watch.rs`'s `vm_probe_agrees_with_tasklist` beside them. Without `DEVGO_WSL_HARDWARE` they return early and say so; `DEVGO_WSL_HARDWARE=1 cargo test real_fragmentation` runs one for real. An `#[ignore]` nobody passes `--ignored` to is indistinguishable from no test.

`src/components/WslDoctor.test.tsx` holds the panel's 10 cases: the probe is not called on mount and `.wslconfig` is; the button calls `wsl_fragmentation` with `{ distro: null }`; no WSL reads nothing; a reason renders instead of readings, for both reports; the absent-file sentence survives when the path really was looked at; each severity names itself; the line number sits beside its quote; an empty list says *Nothing to report.* Its first case was intermittent (`a1d3545`): it waited for the button, but the `.wslconfig` read is a passive effect of the same commit and could land a tick later. It waits for *What the file says* now, which renders only once the report has arrived.

## 77.8 — Verify

**Re-run for this chapter**, on `main` at `6d2b16d` on Windows: `cargo test --lib wsl_doctor` — **65 passed / 0 failed / 0 ignored**. The tree holds 66 `#[test]`s in the module; the 66th, `off_windows_the_report_is_a_stated_reason`, is `#[cfg(not(windows))]`. Without `DEVGO_WSL_HARDWARE` the two live tests pass by returning early.

**Recorded in the commits, not re-run for this chapter:** `d8e1075` — `cargo fmt` clean, clippy zero, `cargo test` 422 passed / 0 failed / 0 ignored; with `DEVGO_WSL_HARDWARE=1` all three live tests passed on a 63.9 GiB, 24-processor host, 25.7 of 26.1 GiB free in high-order runs. `e5f3542` — reverting `wsl_default_memory` to `host_total / 2` turns exactly three tests red, the three written for it. `a1d3545` — the flaky case failed 36 times in 9,600 stress mounts before the fix and 0 after.

**What this machine could not show:** its own `.wslconfig` had already lost the `pageReporting` line by the time the probes ran (`174389e`), so the validator's headline finding has only ever fired against fixtures. The live fragmentation read has only ever seen a healthy VM; the Error path is fixture-only too.

**Visual:** the panel was driven and screenshotted in two palettes for `757e01c` and `eff3c5a`. The default-memory fix and the real-capture work changed findings text without a fresh look at the panel — both commits queue that as *WSL-DOCTOR-PANEL-1*.

## 77.9 — Deferred

- **The panel always reads the first running distro.** `wsl_fragmentation` takes a name; the panel passes `null`. On a box with two distros up there is no way to choose.
- **Nothing repairs anything.** Every finding ends in a sentence the user acts on. A doctor that rewrites a VM's config it has only half understood is worse than one that explains it — the stated v0 rule, not an oversight.
- **The key table is a snapshot of WSL's documentation.** A key added after it reads as an unknown **Warning**, never an Error — the safe direction, but still a line to update.
- **The default-memory rule is documented, not measured**, and not build-conditional.
- **`PAGE_SIZE` is checked against one capture**, from one x86_64 distro. aarch64 is asserted in a comment, not by a test.
- **An empty dmesg section is ambiguous** — a clean ring and a restricted one read the same from outside, and the Info finding says so rather than guessing.
- **Whether `wsl_available` should be true inside WSL** is left alone. `7bea1ec` made the panel honest there; deciding if it should render at all is its own slice.

---

## What you built

```
src-tauri/src/services/wsl_doctor/mod.rs            Severity, Finding; human(), binary units with one decimal; 3 tests
src-tauri/src/services/wsl_doctor/wslconfig.rs      KEYS (41), RETIRED, WSL_CONF_SECTIONS; parse, validate, pair_findings, unknown_key, nearest; parse_size; wsl_default_memory and arithmetic; GlobalMemoryStatusEx; report_from's three states; 41 tests
src-tauri/src/services/wsl_doctor/fragmentation.rs  PROBE; read_probe and the three parsers; assess; report, which never starts a distro; 22 tests, 5 against a real capture
src-tauri/src/services/wsl_doctor/fixtures/         real_probe_ubuntu_2604.txt, real_pagesize_ubuntu_2604.txt
src-tauri/src/commands.rs                           wsl_config_report, wsl_fragmentation
src/components/WslDoctor.tsx                        the Settings panel: read on open, probe on press, reason instead of readings
src/components/WslDoctor.test.tsx                   10 cases
src/components/Settings.tsx                         the WSL doctor entry
src/types.d.ts                                      the report, reading and finding types
```

- **WSL's silent no-ops get a voice** — a wrong heading, a typo, a retired key, a value WSL will fall back from, each named on its line with the fix.
- **A config right for another machine is caught** — against WSL's real default, written once.
- **Fragmented is told apart from out of memory** — from the free lists themselves, in a distro that was already running.
- **Nothing is claimed about what was not read** — a stopped distro, a file on the other filesystem and a failed read are all reasons, never health.
- **The parsers have met a real machine** — and the page size every number rests on is a test, not an assumption.
