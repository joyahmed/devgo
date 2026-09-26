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
⚠️ **The rebase WILL conflict, and not because of `89b4d92`.** Measured by a real trial merge in a
disposable worktree, not predicted from line numbers:
- `launcher.rs` merges **cleanly** against this branch's commits.
- `editors.rs` (~350-line block, `:1914-2270`) and `target_store.rs` (~40-line block, `:416-458`)
  **conflict hard** — caused by two OTHER commits already on `origin/main` since the merge-base
  (`427ac49`): **`5565a4e` "MAC: ghostty opens through `open`, not its own binary"** and
  **`0cec548` "FIX: a missing folder, and two errors that named the wrong cause"**, which added
  `bundled_ghostty`/`ghostty_bundle` at the same insertion points where this branch added
  `is_a_program_there` and the Start Menu shortcut tests.
- ⭐ So **"safe to rebase onto `89b4d92`" and "safe to rebase onto current `origin/main`" are
  different questions.** The first is yes; the second needs this conflict resolved as its own step.
⚠️ **`5565a4e` may already change the Ghostty picture in Stream 2 — re-check Stream 2 against it
before acting on it.** Stream 2 was traced against `origin/main:editors.rs:419`, but that trace and
this commit have not been reconciled.

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

### Stream 2b — ⭐ THE ESCALATION: `89b4d92`'s PATH ORDER disagrees with the detector

Found by reviewing `89b4d92` on Windows (compiled and run in a disposable worktree; trial merge run
for real rather than predicted). **This outranks the Ghostty gap.**

`mac_preamble()` (`launcher.rs:437-448`) composes:
```
export PATH="$PATH:/usr/local/bin:{login_path}"     # login_path appended LAST
```
But the DETECTOR, `path_lookup` (`editors.rs:1281-1295`), searches **`login_path()`'s directories
ONLY, first-hit-wins** — its own comment says *"not `env::var("PATH")`: a dock-launched app has the
bare four directories and every editor cli lives elsewhere."*

⛔ **So for any binary name present in BOTH — a Homebrew `node`/`git`/`python3` in `/usr/local/bin`
shadowing an nvm/pyenv version reachable only via the login PATH — devgo DETECTS one binary and
LAUNCHES a different one.** Silent, and very hard to diagnose from a bug report. Two sources of one
truth must not disagree.

⚠️ **Corroboration, and a mistake worth recording:** this session had an abandoned WIP doing the
opposite — `export PATH={login_path}:$PATH` (login_path PREPENDED, bare PATH as fallback) —
written specifically to keep launcher and detector in agreement. It is in
`git stash` as *"my half-done mac preamble fix, superseded by Meli 89b4d92"*. **It was stashed on the
assumption that an upstream fix supersedes a local one, WITHOUT comparing the two orderings.**
"Already fixed upstream" is not "fixed correctly".

**Fix:** prepend `login_path()` rather than append. **Test that would catch it** (none exists):
inject/stub `login_path()` to return a dir containing binary `X`, put a DIFFERENT `X` in a fake
`/usr/local/bin` ahead of it, and assert `path_lookup` and the generated script's `PATH=` line
resolve to the SAME file.
**Inverse:** if appended-last is actually fine (no realistic machine has such a shadow), the cost of
prepending anyway is zero — nothing regresses. The asymmetry favours prepending.

Also in `89b4d92`: `build_mac_run_script` (`:493-511`) now runs the command via
`"${SHELL:-bash}" -ic {quoted}` — an interactive shell, which sources rc files and is a second,
independent PATH repair. Worth knowing when reasoning about why a symptom may or may not persist.

⚠️ **`89b4d92`'s gate `#[cfg(any(not(windows), test))]` covers NATIVE LINUX, not just macOS.** Its
behaviour change applies to real Linux installs too — so **Alina must re-test the terminal/agent
lanes**, not only Meli.

⛔ **The tests it touched are TAUTOLOGICAL.** All five are `mac.starts_with(&mac_preamble())` —
comparing the generated script against calling the same function again. They can never fail whatever
`login_path()` returns, so they pin neither ordering, quoting, nor the empty-skip branch. **The gap
the original bug came through is still open.**

### ✅ Stream 2b — DONE, `5c1c764` (2026-09-26)

`89b4d92` cherry-picked onto this branch (clean, `-n`) and its PATH order corrected:
`export PATH={login}:"$PATH:/usr/local/bin"` — **login path LEADS**, old fallbacks trail. Empty login
path emits exactly the pre-`89b4d92` line, no stray separator. Brew's `shellenv` KEPT — not for PATH
(the login path already carries `/opt/homebrew/bin`) but because `HOMEBREW_PREFIX`, `CELLAR`,
`REPOSITORY`, `MANPATH`, `INFOPATH` are not a PATH and nothing else sets them.

Composition extracted to a pure `mac_path_line(login: &str) -> String` (`launcher.rs:484-493`) so it
is testable with no shell spawn. Three new tests pin: login path leads; empty leaves no stray
separator; a path with a space and an apostrophe stays one word. The four tautological
`starts_with(&mac_preamble())` assertions now call `assert_mac_preamble()` (`launcher.rs:861-883`),
which checks SHAPE independent of what `login_path()` returns.
⭐ **Mutation-proved:** flipping the composition back to append-last **fails 5 tests**, three of which
could not fail before. Reverted, file byte-identical.

Gate: fmt ok · **267 passed / 0 failed / 1 ignored** (264 + 3) · clippy unchanged at the same 5 ·
`bun run build` exit 0.

⚠️ **CONSEQUENCE FOR THE REBASE — read before rebasing.** This branch now holds a MODIFIED copy of
`89b4d92`, which also exists on `origin/main`. `launcher.rs` **will now conflict** where the earlier
trial merge found it clean. **Resolution: take OURS** — ours is theirs plus the ordering fix. Do not
take main's side, or the detector/launcher disagreement comes straight back.

### Stream 4 — `77.wsl-doctor` (new branch, see §3)

### Stream 5 — the 5 clippy errors (all pre-existing, none in files touched this session)
| file:line | lint | effort |
|---|---|---|
| `commands.rs:717` | `unnecessary_lazy_evaluations` | trivial — `.ok_or_else(\|\| X)` → `.ok_or(X)` |
| `services/github.rs:902` | `assertions_on_constants` | trivial — `const { assert!(…) }` |
| `services/ssh_config.rs:27` | `manual_pattern_char_comparison` | trivial — closure → `[' ', '\t', '=']` |
| `services/platform/runtime.rs:4` | `empty_line_after_outer_attr` | trivial — delete a blank line |
| `services/platform/wsl.rs:202` | `items_after_test_module` | **bigger** — move a const, an enum and two fns above `mod tests`; mechanical, but a wide diff that will conflict with in-flight branches. **Do this one LAST, after the rebase.** |

⚠️ **CORRECTION — clippy prints `warning:`, not `error:`.** These become errors only because the
command passes `-D warnings`; **no CI config in the repo enforces that**. "5 pre-existing errors" is
informally accurate ("clippy is not clean") but is not literally what `cargo clippy` outputs. Decide
whether the release gate actually requires `-D warnings`, or this argument repeats every session.

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

## 3b. ⛔ BLOCKED — UNREACHABLE, not pending. Needs Joy.

⭐ **There is NO push channel from Windows to Meli or Alina.** Verified, not assumed — and I asserted
the opposite earlier and was wrong: `ListAgents` here shows only the two Windows sessions, and a peer
tried addressing Ana by name → *"No agent named 'ana' is reachable."* **Filesystem access is not a
push channel.** A peer can `wsl.exe` into Ana's box and `ssh` into Alina's — that reads files and runs
commands; it cannot make a running session act, and it cannot click a desktop.

- **Meli (macOS) — NO CHANNEL AT ALL.** Her Mac has Screen Sharing (5900), Remote Management (3283)
  and File Sharing (445) open, but **Remote Login (ssh/22) is OFF** — a sweep of 22, 2222, 9999,
  22022, 2022 was refused on every port. So the 6th clippy finding stays **permanently invisible**
  until Joy flips Remote Login or Meli answers directly.
- **Alina (Ubuntu) — shell reachable, desktop NOT.** Q4 (the four ClonePicker defects) and Q5 (the
  Linux terminal/agent lanes) both require the installed app **driven on screen**: Tab focus order
  with 388 repos, a visible focus ring, first-letter cycling, a drawer reopened. ⭐ **A peer correctly
  REFUSED to ssh in and run something adjacent** — that would produce exactly the class of evidence
  §0 forbids, and it would *look* like an answer. **NOT TESTED is the correct answer.**

⭐ **Two things unblock this and neither belongs to a session:**
1. **Remote Login enabled on the Mac.**
2. **A human at Alina's desktop.**

## 3c. ⚠️ `89b4d92` CHANGES NATIVE LINUX, AND NOBODY HAS TESTED IT

Promoted out of the macOS section deliberately — filing it under "mac" is how it would ship silently.

**`89b4d92` reads as a macOS fix. Its gate is `#[cfg(any(not(windows), test))]` — which covers NATIVE
LINUX.** So its behaviour change reaches real Linux installs: the PATH composition, and running the
command through `"${SHELL:-bash}" -ic` instead of directly.
⚠️ **And `5c1c764` on this branch has since CHANGED that code again** (login path now leads).
So Alina must test `origin/main` now **and** re-test after the rebase. Neither has happened.

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

---

## Stream 6 — UX items raised 2026-09-26, both are "an HN visitor hits this" risks

### 6a. ⭐ The on-load message is too easy to miss (Joy, at the keyboard, 2026-09-26)
Joy: *"the message on load is very unlikely not gonna be seen caz it is a thin line on bottom left.
it can be a bit bigger and appear on a more visible area."*

**Fix:** make it larger and move it somewhere the eye actually lands. ⚠️ **Not the toast** — `Toast.tsx:37`
is `fixed bottom-4 right-4`, bottom **right**, so the thing Joy is describing is something else on the
bottom **left**, most likely in the footer (`StatusBar.tsx:204`, `text-13`, `min-h-12`).
⛔ **Identify the exact element before restyling anything** — a grep for a load-time notice found
nothing, so this needs the app watched through a cold start, or one word from Joy. Restyling the wrong
element is worse than leaving it.

### 6b. ⚠️ The clone drawer closed by itself once, unreproduced
Seen while driving the ClonePicker tests on the installed 1.2.1 build: the drawer was confirmed open,
then ~90s later — with **no input events in between** — it was gone and focus had moved to a
background button. **Not reproduced** in three attempts (3 min idle with it open; a repeated Tab
cycle; a re-run of the Tab-to-list sequence). `Drawer.tsx` closes only on Escape, backdrop click, or
the ✕ button — there is no blur or visibility handler, so there is no explanation in the code.
⛔ **Not called a defect.** Recorded because **if a user hits it they lose their tick set** (ticks
reset to 0 on close; the destination survives), and on a launch day that becomes a comment thread.
