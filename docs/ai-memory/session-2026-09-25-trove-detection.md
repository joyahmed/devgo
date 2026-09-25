# 2026-09-25 — devgo recognises Trove (supermode run)

Branch `78.file-manager`. Started clean at `9deffdf`.

## Landed

- **`d7b3108` ✅TARGETS: devgo finds trove through its start menu shortcut**
  - `src-tauri/src/services/editors.rs` +335, `src/components/TargetManager.tsx` +4/-2.
- **`2872225` ✅DOCS: the session note for the trove detection slice** — this file.
- **`9ed0263` ✅TARGETS: the start menu walk cannot wander off**
  - `src-tauri/src/services/editors.rs` +90/-17. Closes both hardenings the reviewer
    raised against `d7b3108`:
  - `SHORTCUT_MAX_DEPTH = 8` (editors.rs:1184-1192); the walk stack is now
    `Vec<(PathBuf, usize)>` (1200-1231) so depth rides with each entry rather than a
    shared counter (a stack walk visits siblings between levels). Without it, a junction
    pointing back at its own parent was an endless descent *inside `detect()`* — a hang
    of target detection. A real installer's shortcut sits one or two folders down.
  - PowerShell list building extracted to a pure `shortcut_script()` (1233-1257) so it is
    testable without a spawn; `resolve_shortcuts` now one line calling it.
  - Tests: `the_start_menu_walk_stops_at_a_fixed_depth` (derives the chain length from the
    constant; `Near.lnk` inside the cap found, `Far.lnk` one past not) and
    `a_shortcut_path_with_shell_characters_is_quoted_whole`
    (`C:\Joy's Apps\$env Tools\Trove.lnk` — pins the exact `@('…','…')` list, quote
    balance, only the real quote doubled, empty slice → `@()`).
  - Gate re-run by the orchestrator: fmt pass, `cargo test` **264 passed / 0 failed /
    1 ignored** (262 → +2), `bun run build` exit 0, clippy unchanged at the same 5
    pre-existing sites.
  - A total-entry cap was considered and **rejected** — a second counter threaded through
    the loop for no gain over the depth bound.

⚠️ **rust-analyzer reported a phantom `cannot find function shortcut_script` during this
slice.** It was stale indexing: `cargo check --all-targets` after a `touch` exits 0 with
zero errors, and `cargo test` compiles and runs 264. Trust cargo over the editor
diagnostics in this crate.

## The bug, and why it was invisible

devgo's target detection was **PATH-only**: `locate()` (editors.rs:914-949) checks a map
built by `path_lookup()` — one batched `where.exe` — then falls through to a macOS
bundle-name rule (`Candidate.app`, `None` on every Windows row) and returns `None`.
No registry read, no Program Files scan, no Start Menu walk. `src-tauri/Cargo.toml` has
no winreg/windows/winapi crate at all.

An installer puts nothing on PATH, so **no table row could ever have found Trove**. The
comment above the `explorer` row said precisely that and treated it as the end of the
matter. `explorer` was the only Windows `TargetKind::FileManager` row.

Why it felt like it should already work: every one of the ~15 "trove" hits in the repo
was a comment, a UI placeholder (`TargetManager.tsx:81,88`) or a test fixture. Commits
`99201e5` and `d862adc` used Trove as the worked example all the way through while
building the *manual* Browse path. Nothing in production code knew the name.

## The fix

`Candidate` gains `win_lnk: Option<&'static str>` (`None` on every existing row in both
tables, so nothing else changes behaviour). After a PATH miss on Windows, resolve
`<name>.lnk` from `%APPDATA%\...\Start Menu\Programs` and `%ProgramData%\...\Start Menu\Programs`
(recursive, case-insensitive) and use its TargetPath as the executable, tagged
`source: "shortcut"`. New `trove` row after `explorer`, reveal args `/select,"{path}"`
(pinned by the existing test at `models/target.rs:515-541`).

Chosen over the two alternatives **because they do not work here**:

- well-known install paths (`%LOCALAPPDATA%\Programs\Trove`, `%ProgramFiles%\Trove`) —
  Trove is at `E:\Softwares\Trove`, a hand-chosen directory no table would guess;
- registry `App Paths` / Uninstall `InstallLocation` — **nothing to read**, no installer
  has ever run on this machine (see measurements below). Also: `where.exe` does NOT
  consult `App Paths`; it is honoured by ShellExecute and the Run dialog only.

Cost when unused: `shortcut_lookup` returns early if no candidate both missed PATH and
declares `win_lnk`; `resolve_shortcuts` returns early on an empty list. PowerShell is
spawned only when a `.lnk` was actually found, then once for all of them.

## Machine measurements (2026-09-25, recorded because they are not re-derivable)

- Exactly ONE `trove.exe` across C:, D:, E: — `E:\Softwares\Trove\trove.exe`,
  **6,318,592 bytes, 2026-09-25 08:51:35**, alone in its folder, no `uninstall.exe`.
  Byte-size/mtime identical to `G:\01_tauri\trove\src-tauri\target\release\trove.exe`,
  i.e. a hand copy of the release build.
- `D:\Apps\` exists and is **empty**. `D:\Apps\Trove\` does not exist.
- **No installer has ever run**: no Uninstall key under HKCU, HKLM or WOW6432Node; no
  `HKCU\SOFTWARE\Classes\Applications\trove.exe`; no `Directory\shell` verb; no
  `RegisteredApplications`; `App Paths\trove.exe` absent in both hives. Only passive
  traces (MuiCache, UserAssist, TileProperties).
- The one machine-readable record of the location:
  `C:\Users\Joy\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Trove.lnk`,
  748 bytes, 2026-09-24 04:28:08 → TargetPath `E:\Softwares\Trove\trove.exe`.
- Trove: productName `Trove`, identifier `com.joyahmed.trove`, version `0.1.0`.

## Gate (run by the orchestrator, not taken from the implementing agent)

| gate | result |
|---|---|
| `cargo fmt --check` | pass |
| `cargo clippy --all-targets -- -D warnings` | **5 errors, ALL pre-existing** |
| `cargo test` | pass — 262 passed, 0 failed, 1 ignored (263 run; was 259) |
| `bun run build` | pass, exit 0 |

⚠️ **The clippy failure is baseline, not this slice.** Verified by stashing the change
and re-running on clean `9deffdf`: byte-identical five sites, none in `editors.rs` —
`commands.rs:717`, `services/github.rs:902`, `services/platform/wsl.rs:202`,
`services/ssh_config.rs:27`, `services/platform/runtime.rs:4`. Clippy 1.96 lints landing
on older code. **`cargo clippy` is RED on this branch before and after; do not read a red
clippy as this slice's doing, and do not let it block a commit until those 5 are fixed.**

## Acceptance, verified independently

A second agent (which did not write the code) wrote its own test and ran it live:

```
REAL_MACHINE shortcut_lookup = {"trove": "E:\\Softwares\\Trove\\trove.exe"}
REAL_MACHINE detect() trove entry = Some(DetectedTarget { id: "trove", name: "Trove",
  kind: FileManager, executable: "E:\\Softwares\\Trove\\trove.exe",
  reveal_args_template: Some("/select,\"{path}\""), source: "shortcut", ... })
```

Temp test removed afterwards; file confirmed byte-identical, diffstat matched.

## Third slice: the labels that still named Explorer while opening Trove

**`aa155e9` ✅TARGETS: the last two rows that said explorer while opening trove** —
`src/App.tsx`, `src/components/Settings.tsx`, `src/types.d.ts` (+24/-5).

`6b05576` taught the menu rows and the project palette entry to name the default manager,
but **missed three sites that all reveal with NO target id** — so the backend resolves the
default and the label narrated the wrong app:

1. `App.tsx:1518-1523` — the **workspace palette row** read
   `Reveal workspace <segment> in Explorer` and opened Trove.
2. **`Settings.tsx` `ShortcutTable`** listed BOTH reveal keys as "…in Explorer". That is
   the one screen a user opens to find out what a key does, so it was the worst of them.

Fix: a bare `revealTargetName = defaultFileManager?.name ?? 'Explorer'` beside the existing
`revealLabel` (`App.tsx:836-839`) for rows that build a sentence around the name rather
than carrying the whole label; and a `fileManagerName?: string` prop on `ShortcutTableProps`
(`types.d.ts:873-875`) with a `shortcutLabel()` helper in `Settings.tsx` that substitutes
only for `revealExplorer` / `revealWorkspace`, fed from the `defaultManagerName` Settings
already derives. `shortcuts.ts:120` and `:192` stay untouched as the shared static
fallbacks — the substitution happens at the call sites, matching what `6b05576` did.

Unset default, or one naming a deleted target → all three say "Explorer" again, which is
then true.

Gate: contrast ok, tsc clean, 93 modules, `cargo test` 264/0/1, clippy unchanged.

⚠️ **Process note, recorded because it cost a broken typecheck.** A background agent was
spawned for this slice and then the orchestrator began editing the same file directly — two
writers in `src/App.tsx` produced a duplicate parallel derivation (`revealWorkspaceIn`
alongside `revealTargetName`) and `TS6133: declared but never read`. The agent was stopped;
it removed its own duplicate on exit. **Do not run an agent and the orchestrator on the same
file at the same time.**

## Second report: "reveal in file explorer opens explorer even though trove is default"

**`6b05576` ✅TARGETS: the default file manager leads the reveal menu** —
`src/App.tsx`, `src/components/HelpPanel.tsx`, `src/components/Settings.tsx`,
`src/types.d.ts` (+45/-6).

**It was NOT a broken default, and two plausible theories were both wrong:**

- ❌ *"He is on a stale installed build."* The installed
  `%LOCALAPPDATA%\DevGo\DevGo.exe` is FileVersion **1.2.0, built 25/09 06:38**, which is
  AFTER `99201e5` (05:19) and `d862adc` (05:59). A byte-scan of the exe finds
  `default_file_manager`, `set_default_target`, `get_default_targets`,
  `reveal_args_template`. It HAS file-manager switching. (`strings` is not installed on
  this box — a `strings` run returning zeros is a false negative; use a PowerShell byte
  scan.)
- ❌ *"`default_file_manager` is written but never read."* It is written at
  `services/preferences.rs:430` (`set_default_target` ← `useTargets.ts:55-58`) and read at
  `services/preferences.rs:410` (`default_target`), consumed by `commands.rs:617`
  (`resolve_target`), `commands.rs:793` (`get_default_targets`) and `commands.rs:1756`.

**The setting lives in `prefs.json`, NOT `targets.json`** — `targets.json` holds rows only.
Confirmed on disk: `"default_file_manager": "trove"`.

**Actual cause — a discoverability defect in `revealItems` (`App.tsx:827-841` before the
fix).** With ONE file manager it emits a single row passing no `target_id`, so the backend
resolves the default. With TWO OR MORE it emits one explicit row per manager iterating
`targets.fileManagers` in `targets.json` order, each hard-passing `t.id`. Explorer was
registered first, so "Reveal in File Explorer" occupied the exact seat and label the
default-honouring row used to have. Joy clicked it from muscle memory; it did what it says.

Every other reveal entry point already honoured the default — Ctrl+Shift+E
(`App.tsx:1932` → `:822` → `:817`), all three palette entries (`:1592-1596`, `:1498-1506`),
the clone toast (`:567`), reveal-app-data (`commands.rs:2042-2047`), and the single-manager
row. There is no tray reveal.

**Fix:** prepend the default manager and filter it out of the rest (stable partition, no
sort). Unknown/absent default → `find` returns `undefined`, the filter predicate becomes
`t.id !== undefined` (true for all), the prepend spreads nothing, so the list is exactly
what it was. The Ctrl+Shift+E hint keys on identity (`t.id === defaults.file_manager`), not
position, and was left alone — it still marks only the default, and now position and hint
agree instead of contradicting. Also: the palette said "Reveal in Explorer" while opening
Trove — both it and `HelpPanel` now name the default. `shortcuts.ts:120` left untouched as
the shared fallback.

Gate: contrast ok, tsc clean, 93 modules, `cargo test` 264/0/1 held, clippy unchanged.
No frontend test runner exists in this repo (`package.json` has only dev/build/
check:contrast/preview/tauri; no vitest or jest) — do not look for one.

⚠️ **RELEASE HAZARD, for the person.** This branch was cut at `427ac49` (04:10 today).
**`main` has since moved 8 commits ahead and carries tag `v1.2.1`, which is NOT an ancestor
of `78.file-manager`.** `src-tauri/tauri.conf.json` here still says `"version": "1.2.0"`.
Merging as-is ships a 1.2.0 newer than the released 1.2.1 — the version goes backwards.
**Rebase onto main and bump the version before any release.**

## End-to-end test in the real app, 2026-09-25 (at `01cd00c`)

Not just unit tests — the app was built from this branch and driven by hand.

⚠️ **Single-instance WOULD have swallowed the dev launch.** It is NOT
`tauri-plugin-single-instance`; it is a hand-rolled service
(`src-tauri/src/services/single_instance.rs`) keyed on a lock file at
`app_data_dir/instance.lock`, and `app_data_dir` derives from the identifier
`app.zetta.devgo` in `tauri.conf.json` — **which the dev build shares**. A second launch
connects to the port in the lock file, sends `"restore"`, and calls
`std::process::exit(0)` (`src-tauri/src/lib.rs:268-275`). **So a `bun tauri dev` while the
installed DevGo.exe is running silently focuses the OLD binary and exits — you would be
testing the released build and not know it.** The installed DevGo.exe (PID 13260) was
killed first, then relaunched afterwards (PID 21004). Anyone testing this branch must do
the same.

Launch: `bun tauri dev` (README.md:145), `Finished dev profile in 6.49s`, no errors.

**Detected.** Settings → Launch targets → "Detected on this machine" → Scan:
```
Trove                                    [file_manager]   Add
E:\Softwares\Trove\trove.exe
```
Provenance renders as the resolved path, which is `source: "shortcut"` doing its job —
`trove` is not on PATH; the only route is
`C:\Users\Joy\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Trove.lnk`.

**Added.** Moved into File managers as `Trove` / `E:\Softwares\Trove\trove.exe "{path}"`.
`%APPDATA%\app.zetta.devgo\targets.json` now carries the row, verified on disk:
`"id": "trove"`, `"executable": "E:\\Softwares\\Trove\\trove.exe"`,
`"reveal_args_template": "/select,\"{path}\""`.

**Reveal works — the one thing no test had proved.** With two file managers registered the
project menu switched from one generic row to per-manager rows (`src/App.tsx:826-841`):
```
Reveal in File Explorer    CTRL+SHIFT+E
Reveal in Trove
```
"Reveal in Trove" launched trove.exe (window `01_tauri - Trove`), opened `G: > 01_tauri`,
status bar **"18 items · 1 item selected"** with `devgo` highlighted. So `/select,"{path}"`
genuinely selects the item rather than merely opening the folder.

Screenshots in the session scratchpad: `20-detected.png`, `23-after-add.png`, `26-menu.png`,
`29-trove-select.png`.

⚠️ **Note for whoever runs the INSTALLED release next**: `targets.json` now contains a
`file_manager` row, but the installed build predates the file-manager work on this branch.
It did relaunch and run normally (PID 21004) with that row present, so it tolerates it —
but it has not been exercised beyond starting up.

## Contract agreed with the Trove session (trove-58), 2026-09-25

1. **`Trove.lnk` at the TOP LEVEL of Programs, unnested, targeting `$INSTDIR`, is now a
   published interface.** It is how devgo finds Trove. Trove's side verifies this from the
   generated `.nsi` and tells devgo first if it ever changes. Rename/nest/drop it and
   detection goes blind.
2. Trove will write `App Paths\trove.exe` (default = full exe path, `Path` = install dir)
   as its own separate slice. **Not a live contract until devgo's reader lands** — see
   queue below.
3. Protocol handler (`trove://`), named pipe, well-known config file: dropped by agreement
   as more coupling than the problem needs.
4. Passed to them: `tauri-plugin-single-instance` keys on `com.joyahmed.trove`, not the
   path, so an old copy at a previous location still swallows launches of a new build
   after their install-directory picker lands. They are handling or warning.

## Next / queued

- **`App Paths` reader in devgo** — a second, sturdier signal alongside the shortcut.
  Needs a registry dependency (`winreg`) in `src-tauri/Cargo.toml`, which the crate has
  never had. Tell trove-58 when it lands; they are waiting on that word.
- ~~Two cheap hardenings deferred~~ — **DONE in `9ed0263`** (depth cap + quoting test).
- **`resolve_shortcuts` line-pairing** is correct by reading (the `foreach` emits exactly
  one `Write-Output` per input on both the success and catch branches, so the `zip` cannot
  shift) but was not proved with an adversarial multi-line TargetPath. Low risk, still
  open — the only way to prove it is a `.lnk` whose TargetPath contains a newline, which
  needs a real `IWshShell`-written shortcut, so the existing tests stop short of it.
- **Shortcut name matching is exact on the stem `Trove`** (case-insensitive). A future
  `Trove 1.0.lnk` or `Trove (Beta).lnk` would NOT match and detection would silently stop
  working. **RESOLVED for now — see the verification below: the name is stable and
  version-free by measurement, not intention.** Still the sharpest edge of the design if
  it ever changes.
- **Nothing reads the shortcut's WorkingDirectory, icon or arguments** — only TargetPath,
  then an `is_file()` gate. A shortcut pointing at a stub/launcher would register the stub.
  Verified below that Trove's installer targets the real binary, not a stub.

## Trove's installer verified against our contract (trove-58, Trove commit `244629f`)

Checked against the **generated `installer.nsi`**, not intentions, before they committed:

1. **`Trove.lnk` is stable and version-free.** `installer.nsi:901`
   `CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"` with `:35 !define PRODUCTNAME "Trove"`.
   `VERSION "0.1.0"` / `VERSIONWITHBUILD "0.1.0.0"` are separate defines, never
   interpolated into the shortcut name. **No widening of our match needed.**
2. **Unnested, depth 0.** `:65 !define STARTMENUFOLDER ""`, so the nesting branch at `:898`
   is not taken and the bare `$SMPROGRAMS\Trove.lnk` at `:901` is. Our depth cap of 8 is
   far clear.
3. **`installMode: "currentUser"`** → `utils.nsh:4 SetShellVarContext current` →
   `$SMPROGRAMS` is `%APPDATA%\Microsoft\Windows\Start Menu\Programs`, our primary path.
4. **Target is `$INSTDIR\trove.exe`**, the real binary (`File` at `:638` after
   `SetOutPath $INSTDIR` at `:629`). No launcher, no stub — our `is_file()` gate passes and
   TargetPath follows the user's chosen install directory.

**Root cause on their side, which explains ours:** there was never an installer at all.
`bundle.active` was `false` with `targets: []` and the only build script was
`tauri build --no-bundle`. That is exactly why this machine had a hand copy and no
Uninstall key. Turning the bundler on was the whole fix — `MUI_PAGE_DIRECTORY` is
unconditional in Tauri's stock NSIS template, gated only by `SkipIfPassive`. No forked
template, no hook.

⚠️ **The standing objection to guard: `installMode: "both"`.** trove-58 pinned
`currentUser` explicitly (though it is already the schema default) *because it is now
load-bearing for devgo*. `perMachine` would merely move the shortcut to `%ProgramData%`,
which we also walk, so we would still resolve. But **`both`** adds
`MULTIUSER_PAGE_INSTALLMODE` and makes the shell context a runtime choice — which Start
Menu tree receives `Trove.lnk` would stop being knowable from config at all. **If anyone
ever proposes `both` for Trove, that is the objection, and it is devgo's to raise.**

**State of the world right now:** `Trove_0.1.0_x64-setup.exe` (2,058,467 bytes, 2m48s,
exit 0) is **built but NOT run**. Until Joy runs it, devgo keeps resolving to the hand copy
at `E:\Softwares\Trove\trove.exe` — which works identically. Nothing breaks either way.

## For the person

- **Stale memory, needs correcting in the personal repo**:
  `claude-setup/memory/explorer-tauri/session-2026-09-21.md` claims
  `D:\Apps\Trove\trove.exe` and "Trove IS the default file manager since 2026-09-22,
  registered via a shell verb". **Both are false** — `D:\Apps` is empty and there is no
  shell verb anywhere in the registry. This note sent this session down the wrong path
  for its first ten minutes. Not edited here: memory edits belong in the personal repo.
- **`agent-watch --report` (BARE, no session id) reports another session's agents** when
  several are live on the box. Seen here: it printed `G--01-tauri-trove` while this session
  was `G--01-tauri-devgo`.
  ⚠️ **Correction to an earlier version of this note.** I first wrote that the 60% warnings
  therefore would not fire for this session's agents. **That was wrong and too broad** —
  corrected after Wissie read the source on the WSL side. `agent-watch.mjs:205` writes
  `~/.claude/ctx/${sid}.agents.json` with `sid` from `input.session_id` (`:60`), and both
  painters read back by that same id (`statusline-command.sh:180`,
  `statusline-command.js:124`). There is no cross-session path, so **the status line's agent
  count IS this session's own and the warnings DO fire.**
  The actual defect is narrower: with no sid and no transcript_path, `subagentsDir()` takes
  its documented fallback — "most recently written subagents dir on the box"
  (`agent-watch.mjs:70-97`) — and scans every project slug for the highest mtime. Right on a
  one-session box; with three sessions live it returns whoever wrote last, and says nothing
  in its output to indicate it is answering about someone else. **`--report <session-id>`
  works correctly today** — use that form.
  Reading `~/.claude/projects/<slug>/<session>/subagents/` directly was a workaround for the
  overbroad reading and is not needed.

Agents this slice: **5** (3 diagnosis, 1 implementation, 1 independent verify).
