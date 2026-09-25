# 2026-09-25 — devgo recognises Trove (supermode run)

Branch `78.file-manager`. Started clean at `9deffdf`.

## Landed

- **`d7b3108` ✅TARGETS: devgo finds trove through its start menu shortcut**
  - `src-tauri/src/services/editors.rs` +335, `src/components/TargetManager.tsx` +4/-2.

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
- **Two cheap hardenings deferred from this slice** (reviewer-raised, both theoretical,
  neither observed): `find_shortcut` has no cycle detection, so a directory junction loop
  under the Start Menu would hang the walk — add a depth cap; and add a unit test for a
  shortcut path containing a quote, a space or a dollar sign to pin the PowerShell quoting.
- **`resolve_shortcuts` line-pairing** is correct by reading (the `foreach` emits exactly
  one `Write-Output` per input on both the success and catch branches, so the `zip` cannot
  shift) but was not proved with an adversarial multi-line TargetPath. Low risk, noted.

## For the person

- **Stale memory, needs correcting in the personal repo**:
  `claude-setup/memory/explorer-tauri/session-2026-09-21.md` claims
  `D:\Apps\Trove\trove.exe` and "Trove IS the default file manager since 2026-09-22,
  registered via a shell verb". **Both are false** — `D:\Apps` is empty and there is no
  shell verb anywhere in the registry. This note sent this session down the wrong path
  for its first ten minutes. Not edited here: memory edits belong in the personal repo.
- **`agent-watch --report` resolved to the wrong project** (`G--01-tauri-trove` instead of
  `G--01-tauri-devgo`) while the Trove session was live, so its 60% warnings would not
  have fired for this session's agents. Same session-directory resolution bug already
  recorded in WORK-QUEUE.md. Worked around by reading the subagents dir directly.

Agents this slice: **5** (3 diagnosis, 1 implementation, 1 independent verify).
