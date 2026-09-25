# DevGo next release — the plan, the machines, and the bar

Written 2026-09-26 by Steph/devgo (Windows). Joy's frame: **"if we make a new release, we'd fix
everything in it. and test and add tutorial. and all machines should test first as always."**

---

## 0. The bar for "tested" — Joy set this explicitly

⭐ **Installed build, app-driven, with evidence.** A machine has tested when it has:
1. installed a REAL artifact (`.dmg` / `.exe` / `.deb`) — not a dev build,
2. clicked the actual lane in the app,
3. reported what appeared ON SCREEN — a screenshot, or quoted UI text.

⛔ **What does NOT count, and why this bar exists.** On 2026-09-25 the macOS lanes were recorded as
passing. Joy: *"Meli didn't test it yesterday properly."* The entry says the script was *"RUN on the
Mac … **reconstructed faithfully** from `build_tmux_script` + `MAC_PREAMBLE`"*. **A reconstructed
script hand-run in an interactive Terminal inherits your shell's full PATH — which is the one
condition under which the actual bug cannot appear.** The same entry proved detection by checking
that bundle binaries exist and are executable: that proves devgo can FIND them, not that clicking
the button works. It tested the parts, reconstructed, and called it the whole.

So: **no hand-run scripts, no reconstructions, no "the binary is present", no dev builds.**
⚠️ And note `cargo test` passing on a Mac would NOT have caught the PATH bug either (§4 A8) — a green
suite is not evidence for these lanes.

---

## 1. Release streams, in the order they must happen

### Stream 1 — REBASE FIRST. Everything else is harder if this waits.
- `78.file-manager` has **13 commits `origin/main` lacks**; `origin/main` has **8 this branch lacks**
  (the v1.2.1 release chain **plus** Meli's `89b4d92` PATH fix). `main` is **NOT an ancestor**.
- `src-tauri/tauri.conf.json` on this branch says **`1.2.0`**; `origin/main` already says **`1.2.1`**.
  **Merging as-is ships a version that goes BACKWARDS from what is already published.**
- ⚠️ Local `main` ref was stale at `1112bc0` until this session's `git fetch`. Fetch before reasoning.
- **Decision owner: Joy** — rebase vs cherry-pick, then the version bump.

### Stream 2 — finish the macOS PATH fix. Meli's `89b4d92` is INCOMPLETE.
⭐ **Code-verified against `origin/main`, not inferred.** `89b4d92` fixed only the plain-terminal
`args` template. **Ghostty's `run_args` (`src-tauri/src/services/editors.rs:419`) is
`--working-directory="{path}" -e {command}` — it has NO `{script}` token**, so `run_script_args`
(`src-tauri/src/services/launcher.rs:786`) takes its early-return branch, never writes a `.command`
file, and **never runs `mac_preamble()`/`login_path()`**. It goes straight to
`open -na "Ghostty" --args …`, which LaunchServices spawns with launchd's bare PATH.
**So "Open with Claude" and "Run dev script" STILL FAIL on Ghostty after the fix.**
Same question must be asked of wezterm/kitty/alacritty `run_args`.

### Stream 3 — the four ClonePicker defects (found on Alina, native Ubuntu, against v1.2.1)
All from `WORK-QUEUE.md:86`, **none re-verified since `a041ef0` landed**:
1. ⭐ **With 388 repos, Tab never reaches `into`** — passes only with 1 repo shown. *The one that
   reads as a real regression rather than a rough edge; it is a keyboard trap at any realistic count.*
2. The repo row has **no visible focus ring**.
3. **First-letter jump does not cycle** — repeating "w" will not move ws → ws2.
4. **The picked destination is forgotten when the drawer is reopened.**
   (`a041ef0` "the clone destination is drawn by devgo, not by gtk" may be tangential — a render fix,
   not persistence. Check whether it also closed this.)
5. "+ Add repo ▾" clicked once did nothing visible — unconfirmed repro.
⚠️ **Alina is the only machine that reproduced these, so Alina must re-verify any fix.**

### Stream 4 — `77.wsl-doctor` (new branch, see §3)

### Stream 5 — the 5 clippy errors (all pre-existing, none in files touched this session)
| file:line | lint | effort |
|---|---|---|
| `commands.rs:717` | `unnecessary_lazy_evaluations` | trivial — `.ok_or_else(\|\| X)` → `.ok_or(X)` |
| `services/github.rs:902` | `assertions_on_constants` | trivial — `const { assert!(…) }` |
| `services/ssh_config.rs:27` | `manual_pattern_char_comparison` | trivial — closure → `[' ', '\t', '=']` |
| `services/platform/runtime.rs:4` | `empty_line_after_outer_attr` | trivial — delete a blank line |
| `services/platform/wsl.rs:202` | `items_after_test_module` | **bigger** — move a const, an enum and two fns above `mod tests`; mechanical, but a wide diff that will conflict with in-flight branches. **Do this one LAST, after the rebase.** |

⚠️ **UNRECONCILED, and it blocks a shared definition of "clippy clean":** macOS is recorded as **6**
errors in the same 5 files; Windows measures **5**. The 6th has never been named and is presumably
behind a `cfg(target_os = "macos")` path — **permanently invisible from Windows**.
**Meli must run `cargo clippy --all-targets -- -D warnings` and name it file:line.**

### Stream 6 — tutorial (§5)

---

## 2. What is already TRUE, so nobody re-derives it

- ✅ **v1.2.1 is PUBLISHED, not a draft.** `gh release view v1.2.1` → `isDraft:false`, published
  2026-09-25T01:24:04Z, all three assets (dmg/deb/exe) uploaded. **WORK-QUEUE says "draft" — stale,
  correct it.**
- ✅ `origin/main` CI green at `89b4d92` (run 36172114324, success, 4m20s).
- ✅ No open GitHub issues or PRs on `joyahmed/devgo`.
- ✅ Windows `cargo test` on `78.file-manager`: **264 passed / 0 failed / 1 ignored**.
- ⚠️ **`78.file-manager` has no CI run of its own.** Only main/tag runs are recorded.

---

## 3. `77.wsl-doctor` — the branch

**Plan source:** `WORK-QUEUE.md:688` (written 2026-09-24, two days old, current). It is a **queue row,
not a plan document** — there is no `docs/plans/` in devgo and zero hits for "doctor" anywhere in the
repo, code or git history.

**Branch slot:** chapters run to `76-repo-traffic`; `78.file-manager` is current; **`77` is unused.**
⚠️ Ordering oddity worth a decision: chapter 77 would land *after* 78 chronologically, which reads
oddly in a sequential build-along. `79.wsl-doctor` avoids that. **Joy's call; `77` chosen as the
documented free slot and trivially renamed.**
⚠️ **Branch from `origin/main`, NOT from `78.file-manager`** — so it carries v1.2.1 + the PATH fix and
does not depend on unpushed work.

### ⛔ Decided, do not re-litigate
It ships **inside `joyahmed/devgo`**, not a separate repo. Joy: *"only devgo and no joy-wsl or
win-linux type of thing."* Reasons on record: per-project CPU/RAM limits need a project model and only
devgo has one; a second Tauri app doubles the unsigned-installer friction that is already devgo's
worst problem. **Do not re-propose `better-wsl` / `joy-wsl`** — they also break
`project-names-are-global`. ⚠️ **devgo is React 19**, not Svelte (that is `explorer-tauri`'s stack;
the two were conflated once already).

### Scope — Joy chose the FULL MODULE, fixes included
Sizing from the plan: **8–12 sessions, +30–50% for chapter machinery.**

| # | Phase | Notes |
|---|---|---|
| 1 | `wsl.exe` exec bridge + version probe | ⭐ **Largely ALREADY BUILT.** `probe_lines(distro, script)` (`wsl.rs:181`) runs an arbitrary bash script in a distro and returns its lines — that IS the bridge. `decode()` (`wsl.rs:33`) already solves the UTF-16LE trap the plan warns about (`WSL_UTF8=1` + byte-sniffing fallback + `clean()` stripping NULs). |
| 2 | **`.wslconfig` validator** | ⭐ *"the sharpest feature and nothing on the market does it"*. `autoMemoryReclaim`/`sparseVhd` are `[experimental]` keys; a wrong section or invalid key is a **silent no-op**. Joy's own `.wslconfig` carries the scar — `pageReporting=true` ignored for weeks. **Validate the FILE, not the running VM.** |
| 3 | `/mnt/c` + Defender | The actual #1 cause of "WSL is slow", not RAM. Measured: **ext4 4.5 GB/s vs `/mnt/g` 231 MB/s — 19×**. |
| 4 | Fragmentation view | `/proc/buddyinfo`, `order:N` allocation failures, drop_caches storms. **Joy's 2026-07-06 crash was fragmentation, not OOM** — no tool surfaces that class. |
| 5 | cgroup scopes + idle teardown | `systemd-run --user --scope -p MemoryMax=4G -p CPUQuota=200%`. |

### ⛔ Hard constraint on ANY doctor check
Chapter 62's rule: **devgo never touches WSL on a timer.** A polling health check that shells to
`wsl.exe` breaks it twice — *a wedged WSLService is exactly the failure the stop commands exist for;
the poll that would show the hang hangs too.* **Periodic checks must read the process table or files,
never `wsl.exe`.**

### ⚠️ The traps — this is where "fixes included" gets expensive
- `.wslconfig` changes need `wsl --shutdown`, **which kills the session you are testing from**
  (~30–60 s floor per iteration; disconnects Remote-WSL).
- `CPUQuota` on a `--user` scope needs the **`cpu` controller delegated** — verified present on Joy's
  WSL box 2026-09-24, **not universal**.
- The process is **`vmmemWSL`**, not `vmmem`.
- `sparseVhd` alone shrinks nothing without `fstrim` and a stopped distro.
- `networkingMode=mirrored` changes Docker/VPN behaviour — **needs a revert path, not a one-click.**
- ⚠️ **A naive memory-ranked "bloat finder" would kill Joy's actual work**: `vmmemWSL` (7.6 GB) and
  two `rust-analyzer` (3.8 GB) are the top consumers and are all legitimate.

### Gate status
The row gated this on a Show HN thread and said *"⛔ No commits to `joyahmed/devgo` main before that
post"*. **Joy confirms the post NEVER HAPPENED.** ⭐ **That freeze is VOID** — and already overtaken:
`main` has since taken the v1.2.1 chain and `89b4d92`. Do not honour the ⛔ later; correct the row.

### Baseline — what devgo does for WSL today
Can answer *is WSL there, which distros, which are running, and stop them*: `list_distros()`
(`wsl.rs:80`), `default_distro()` (`:92`, parses the structural `*` not the localized string),
`running_distros()` (`:111`, a management call that starts nothing — reading `\\wsl.localhost\…`
cold-boots the VM), `running_distros_memo()` (`:143`, 5 s TTL), `terminate()` (`:354`) /
`shutdown_all()` (`:371`) returning stopped / `TimedOut` / `StillRunning` (`:311`) and re-querying the
machine before writing the toast. `wsl_watch.rs` watches `vmmemWSL` via raw `Process32FirstW`.
**Absence of WSL is a state, not an error** (chapter 04).
**The delta:** it reads NOTHING about `.wslconfig`, memory caps, `/mnt/c`, Defender, fragmentation or
cgroups, and has **no fix action other than terminate/shutdown**.

---

## 4. Per-machine test matrix — at the §0 bar

| Machine | Must verify | State |
|---|---|---|
| **Steph** (Windows) | file-manager/Trove lanes; run an INSTALLED build of the merged result; confirm `89b4d92` broke nothing on Windows | Trove lanes driven end-to-end on a **dev build** — ⚠️ does NOT meet the §0 bar, must be redone on an installed artifact |
| **Meli** (macOS) | ⭐ the largest gap. Terminal lane; agent lane (B4, **never run**); build+install a real `.dmg` (B1, **never done**); Settings badges say "Mac" not "windows only" (B5); `cargo test` on the Mac (A1, **never run**); **name the 6th clippy error file:line**; ClonePicker (source-verified only, never rendered or clicked) | **Unearned, not merely untested** — there are claims on record that read as passes and are not |
| **Ana** (WSL) | a live pass on the merged result; WSL lanes | ⬜ no devgo-specific WSL evidence since v1.2.1 |
| **Alina** (zettaserver, native Ubuntu 24.04.4) | **re-verify the four ClonePicker defects** — the only machine that reproduced them | Most-tested platform; ClonePicker driven live on WebKitGTK with real X11 keys |

---

## 5. Tutorial — it already exists; scope against reality

⭐ **A 76-chapter build-along tutorial already ships**: one branch per chapter (`01.scaffold` …
`76.repo-traffic`), prose at `docs/chapters/NN-name.md`, indexed at `docs/chapters/README.md`, linked
from `README.md:169-175`. `00-prerequisites.md` carries the tool checklist.
**So "add a tutorial" is almost certainly EXTEND, not create.**

⚠️ `17-onboarding.md` is **both** — a real first-run UI (`src/components/Onboarding.tsx`, wired into
`App.tsx`, `types.d.ts`, `ScanPicker.tsx`) *and* a chapter about building it. Neither is an end-user
quickstart.

**The gap:** no chapter covers anything past 76. The file-manager slices (`d7b3108`, `9ed0263`,
`6b05576`, `aa155e9`, plus `d862adc`, `9deffdf`) have **no chapter** — only a session note. If the
tutorial must cover the shipped release, chapters **77/78** are owed, plus one for the WSL doctor.

**Decision for Joy:** does "add tutorial" mean (a) close the chapter gap only, (b) a NEW short
end-user quickstart distinct from the build-along — the existing prerequisites doc is written for
someone building devgo from scratch in Rust, not someone who wants to install and use it — or (c)
something else.

---

## 6. Open decisions — Joy only

1. **Rebase vs cherry-pick** onto `origin/main`, then the version bump target (1.2.2? 1.3.0?).
2. **Branch number** for the doctor — `77` (the free slot) or `79` (chronological).
3. **Tutorial scope** — §5.
4. Whether the five clippy errors block the release or ship as known.
