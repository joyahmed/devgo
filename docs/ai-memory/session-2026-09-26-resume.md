# 2026-09-26 — the resume: four dead agents' work saved, and the gate re-earned on Windows

Steph/devgo (JoyR9, Windows), supermode — ⚠️ **`SUPERMODE=1` was NOT in the environment**, so the
automatic context guard is absent this run; checkpoints are by hand. Branch `78.file-manager`.
Predecessor: `session-2026-09-26-rebase-and-lint.md` (`7032c1f`).

---

## Slice A — the four agents' work was uncommitted, and nothing pointed at it

⛔ **THE FINDING THAT MATTERS MORE THAN ANY COMMIT HERE: a supermode session ending is not a clean
stop for its agents.** The predecessor session ended while four agents were mid-slice in locked
worktrees. Every one of them had written files that **no commit pointed at** — a worktree prune, or
`git worktree remove`, would have erased the lot. Files stamped 01:45 local; the session's last
commit was 14 minutes before this one started.

| branch | was uncommitted | saved as |
|---|---|---|
| `77.wsl-doctor` | **71KB** — `wsl_doctor/{mod,wslconfig,fragmentation}.rs` + wiring in `commands.rs`, `lib.rs`, `services/mod.rs`, `src/types.d.ts` | `03c0205` |
| `worktree-agent-a1e01406fe5bc70e5` | 181 lines — `editors.rs`, `target_store.rs` (the ghostty `run_args` reconcile) | `5069efb` |
| `docs/chapters-77-78` | a 240-line `docs/chapters/77-file-manager.md`; **chapter 78 does not exist** | `62b2aa6` |
| `docs/pty-prior-art` | clean — **that agent produced nothing** | — |

Each `✅WIP:` body states plainly that the code was **never compiled, never tested, never reviewed**.
They are save points, not claims. ⚠️ **Do not merge any of them on momentum** — read the WIP commit
message first, and note the ghostty one was dispatched *before* it was known that Joy has chosen
Terminal.app, which makes its whole subject (`d8895ae`) dormant.

⚠️ **The commit-msg hook rejects `🚧`** — `✅DOMAIN: task` is the only accepted subject shape, so the
save points read `✅WIP:`. The ✅ here does **not** mean gated; the body carries the truth. Anyone
scanning subjects alone will misread it.

## Slice A — the gate, re-earned on this box rather than relayed

- `cargo test` → **283 passed / 0 failed / 1 ignored** (matches the predecessor's number exactly)
- `cargo fmt --check` → clean

⭐ **This answers the one risk the Mac said it could not check.** Meli's bus note warned that the mac
fns compile on Windows under the `, test` arm, where `login_path()` returns a `C:\…;C:\…` string that
gets `sh_quote`d into a bash preamble, and that nothing had been built or run on Windows there.
It is green. **No Mac is needed for that question any more.**

## Slice A — the bus reply

`everything-joy` `claude-setup/session-bus/outbox-joyr9.md`, newest entry, answering
`outbox-mac.md`'s "⛔ FOR STEPH". Carries: the rebase is done and green, the stale-conflict-map
lesson, the WIP save points, and that the "6th macOS clippy finding" question is **withdrawn**.
Committed by the SessionEnd hook, not by hand.

---

## Verified, not assumed: the force-push command in the predecessor note is correct

`origin/78.file-manager` **exists** at `06d6bac`, the remote-tracking ref is present locally, and
`backup/78.file-manager-prerebase` points at the same commit. So the lease has a baseline and
`git push --force-with-lease origin 78.file-manager` will work as written.
⚠️ An earlier check in this session appeared to say the remote branch was missing — that was a
malformed `git rev-parse --short HEAD origin/78.file-manager` (two revisions, one `--short`), not a
missing ref. **Do not conclude from it that the push is a plain first push; it is a history rewrite.**

## Stale claim cleared

The predecessor flagged the WORK-QUEUE's WSL-doctor row as still carrying a ⛔ commit freeze for a
Show HN that never happened. **Already corrected** in `WORK-QUEUE.md:709` ("THE FREEZE IS VOID — do
not honour it, corrected 2026-09-26"). Nothing to do.

---

## Queued for Joy — the exact commands

1. **The force-push** (history rewrite, so it is his):
   `git push --force-with-lease origin 78.file-manager`
   Do not delete `backup/78.file-manager-prerebase` until it is confirmed.
2. **The version target** — `1.2.2` or `1.3.0`. Nothing was invented; all three manifests still read `1.2.1`.
3. **Whether `clippy -D warnings` is really the release gate** — no CI config enforces it.
4. **Is the Show HN dead or postponed?** Tuesday was the stated date.

## Next in this session

Slice B: make the WSL doctor WIP (`03c0205`) actually compile and pass, or say precisely why it cannot.
Then slice C: judge the ghostty WIP against the Terminal.app decision. Then chapter 78.
`wsl.rs:202` clippy stays last — it conflicts with the doctor until the doctor lands.

---

## Slice B — ⭐ the WSL doctor draft was not broken at all, and now it is proven against a real machine

⭐ **THE CORRECTION THAT MATTERS: `03c0205` compiles, and always did.** The WIP body says "never
compiled, never tested" — that was honest about what was *known*, not a diagnosis. Measured on the
doctor branch (`77.wsl-doctor`, based on `origin/main` `3c6a6c5`):

- `cargo check --all-targets` → clean, no errors, no warnings
- `cargo test` → **310 passed / 0 failed / 1 ignored** (main is 269 on the Mac; the doctor adds ~41)
- `cargo fmt --check` → clean
- `cargo clippy --all-targets` → **5 findings, all five PRE-EXISTING.** ⭐ **The doctor's 71KB adds
  ZERO clippy findings.** The five are the same ones `6c0675b` fixes on `78.file-manager` plus
  `wsl.rs:202`; this branch predates that fix. ⭐ And the count confirms the withdrawn Mac question:
  3 in the lib pass + 5 in the lib-test pass with 3 duplicates = **5 unique**, not 6.

⚠️ **But every one of its 46 tests was a fixture**, and this module's whole subject is what *real*
`.wslconfig` files and *real* free lists say. A validator proven only against strings written beside
it has not been proven. `d259725` adds two `#[ignore]`d probe tests — the shape `wsl_watch.rs:243`
already established here — and **both were run on this box**:

**`wslconfig::report()`** → `C:\Users\Joy\.wslconfig`, exists, host **63.9 GB / 24 processors**, and
**zero findings**. ⭐ **Zero is the CORRECT answer and I checked why rather than trusting it.** The
WORK-QUEUE says Joy's own `.wslconfig` "carries the scar — `pageReporting=true` sitting there ignored
for weeks". **It does not, any more:** the file's own note dated 2026-07-22 records that key being
*removed* after being verified rejected in both `[wsl2]` and `[experimental]`. What remains is
`memory=32GB`, `processors=12`, `swap=16GB` under `[wsl2]` and `autoMemoryReclaim=gradual` under
`[experimental]` — correct placement on **WSL 2.7.13**, so nothing to report. ⚠️ **The queue row's
claim about that file is historical and reads as current.** No key is silently ignored on this box
today, which means **this machine cannot demonstrate the validator's headline feature**; a deliberate
bad fixture, or another box, is needed to show it working.

**`fragmentation::report(None)`** → distro **`Ubuntu-26.04`**, reason `None`, **2 zones** parsed from
the real `/proc/buddyinfo`: node 0 DMA32 3.8 GB free (3.8 GB high-order), node 0 Normal 26.5 GB free
(26.3 GB high-order), largest free run order 10 (4.0 MB), dmesg checked for high-order allocation
failures. ⭐ **So the exec bridge, the parse, the assessment and the advice all work end to end
against a live VM — on this box, with no elevation and nothing started or stopped.** That is scope
items (2) and (4) of the queue's WSL-doctor plan, the "read-only v0", **working**.

⚠️ **A gap for whoever builds the panel, found by running it:** a healthy file yields `exists: true`
with an **empty `findings` list**, so a panel that draws only findings shows a blank box for the
common case. `ConfigReport` carries `path`, `exists` and the host numbers precisely so the panel can
say "read 4 keys, all applied" — **do not let it render nothing.** Left as the panel's business, not
changed inside another agent's slice.

⛔ **There is no UI.** Only `src/types.d.ts` changed on the frontend; `wsl_config_report` and
`wsl_fragmentation` are registered in `lib.rs` and **nothing calls them**. v0 is backend-only.

**Commits on `77.wsl-doctor`:** `03c0205` (the saved draft), `d259725` (the probes).
⛔ Branch not pushed; not merged into anything.

## Next in this session

Slice C: judge the ghostty WIP (`5069efb`) against Joy's Terminal.app decision — it may be correct
work on a dormant path. Then chapter 78. `wsl.rs:202` clippy stays last, after the doctor lands.

---

## Slice C — ⛔ the ghostty WIP is NOT dormant polish: v1.2.1 shipped a broken row onto real Macs

⛔ **THIS OVERTURNS THE MAC'S "do not spend effort on Ghostty polish".** Meli's bus note said Joy has
chosen Terminal.app as DevGo's default, so `d8895ae` is dormant. **The default is not the issue.**
Reading `5069efb` against the history: **`5565a4e` ("MAC: ghostty opens through open, not its own
binary") is in `v1.2.0` AND `v1.2.1`** — verified with `git tag --contains`. It moved Ghostty onto
`open` and left the **run** form carrying `{command}`. `open` hands the line to LaunchServices, which
starts the app with launchd's bare PATH, and `run_script_args` writes the `.command` that exports the
real PATH **only for a template asking for `{script}`**.

⭐ **And detection is read ONCE — on the run that adds the row.** So `d8895ae` correcting the
detection table reaches **nobody who already registered Ghostty**. Every v1.2.1 Mac with a Ghostty
row still carries the bytes that run `claude` with `/usr/bin:/bin:/usr/sbin:/sbin`, where
`~/.local/bin/claude` is not found and nothing says so. **A table fix cannot reach shipped state; only
a migration can.** That is what this WIP is, and it is a user-data repair, not polish.

What the agent actually built, and it is more than its brief:
- `ghostty_running_without_a_script(t, now)` (`target_store.rs`) — a **second key** for the existing
  repair, matched against the row detection gives *now* rather than remembered bytes, so it catches
  the row v1.2.1 wrote for itself. ⭐ A row with **no** run form is deliberately left alone — a user
  who deleted it meant to.
- `candidate_bundle(id)` (`editors.rs`) — an `open` row names the app and carries no path, so it
  cannot say where its own bundle is; the only way back is to look again. **None when the app is not
  installed**, because a migration that rewrites a row pointing at nothing has invented a line.
- ⭐ `nothing_launched_through_open_runs_a_command_without_the_script_seam` — the Ghostty one-off
  generalised into a **table-wide invariant over every candidate with a bundle, both branches of the
  in-bundle check, both templates.** This guards terminals nobody has added yet, which is the part
  that outlives the Ghostty question entirely.

**Gate, run on this box (branch renamed `worktree-agent-a1e01406fe5bc70e5` → `fix/ghostty-v121-row`,
which was an unreadable throwaway name):**
- `cargo test` → **268 passed / 0 failed / 1 ignored**; `main` on Windows is **265**, so +3 running
- `cargo fmt --check` clean; `cargo clippy --all-targets` → **5 findings, the same pre-existing five, zero new**
- ⭐ **`a_v1_2_1_ghostty_row_is_repaired_onto_the_script_run_form` RUNS AND PASSES ON WINDOWS** — the
  migration is data logic, so the machine does not gate it. That is the test that matters here.

⚠️ **One of the four new tests does NOT run on this box:** the `editors.rs` seam invariant is
`#[cfg(not(windows))]`. It compiles nowhere here and executes nowhere here. **That one is still owed a
Mac** — and it is the only thing in this slice that is.

⛔ **Not merged, not pushed.** And note the dependency Joy should know about: this repairs rows written
by a released version, so it wants to be **in** the next release, not after it.

## Next in this session

Chapter 78 (`docs/chapters-77-78`, `62b2aa6` holds chapter 77 only). Then `wsl.rs:202` clippy, last,
after the doctor lands.

---

## Slice E — auto mode: the state was measured, the one red was cleared, then the gate was wired

Run as orchestrator with three subagents (detect+measure, the clippy fix, the gate script), because
their context is spent instead of the session's.

⭐ **Rule 1 held: nothing was gated against an unknown state.** Everything was run once first. Exactly
one check was red — `cargo clippy --all-targets -- -D warnings`, exit 101 — on exactly one finding,
and it was cleared before anything was wired.

| commit | what |
|---|---|
| `fc3f532` | ✅LINT: `wsl.rs` test module to the end — clippy strict now **zero findings** |
| `11a442b` | ✅DOCS: `docs/ai-memory/verification-baseline.md` |
| `d241b75` | ✅GATE: `scripts/verify.sh` |
| `dba568d` (everything-joy) | ✅CONFIG: copurge's devgo row + the live copy refreshed |

⭐ **The deferral reason for `wsl.rs:202` was FALSE, and it had been stated twice.** `6c0675b` left it
alone "because the WSL doctor agent is adding code to that file". `git diff origin/main 77.wsl-doctor
-- src-tauri/src/services/platform/wsl.rs` is **empty** — the doctor adds a `wsl_doctor` module and
wires it through `commands.rs`, `lib.rs`, `services/mod.rs`, and **never touches `wsl.rs`**. ⚠️ **A
conflict that was predicted rather than measured blocked a one-line-class fix for two sessions.**
The fix was a pure relocation: sorting both versions and diffing shows every line preserved byte for
byte, 382 lines before and after, and `cargo test` unchanged at 283.

## ⭐ Two measured answers to questions that were queued for Joy

⛔ **"Is `clippy -D warnings` really the release gate?" — NO, and nothing enforces it.**
`.github/workflows/ci.yml` (windows-latest, push to `main` + every PR) runs `bash -n` on the server
scripts, `jq empty` on the actions example, `bun install --frozen-lockfile`, `bun run build`,
`cargo test`. `release.yml` runs the same on win/mac/linux for `v*` tags. A grep for
`clippy|fmt|lint|vitest|playwright` across `.github/workflows/` **returns nothing.** That is how
`items_after_test_module` survived in the tree. ⭐ And gate on the **strict** form or the gate is
decorative: plain `cargo clippy` exits **0 even with findings**.

⛔ **The force-push will NOT be blocked.** The global `pre-push` hook
(`core.hooksPath = C:/Users/Joy/.git-hooks`) refuses history-rewriting pushes, but only for
`GUARDED_REPOS="sunstone everything-joy zetta-dev-cli"`. **`devgo` is not in that list.** Also checked
the hooksPath trap: devgo's `.git/hooks` holds nothing but samples, so setting `core.hooksPath`
displaced nothing here.

## What the gate is, and the three things that keep it alive

`scripts/verify.sh`, found automatically by copurge. Default = `tsc --noEmit`, `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings` (~10s warm). `--full` adds `bun run build` and
`cargo test`. Exit 1 on red. Proven on all three paths: default **exit 0, 3 green**; `--full`
**exit 0, 5 green**; stripped `PATH` **exit 1, "nothing was verified"**.

- ⚠️ It checks for a live cargo/rustc **PROCESS**, never for `src-tauri/target/debug/.cargo-lock` —
  that file exists while idle, so testing it would skip the Rust tier on **every** run. A live
  `tauri dev` holds an exclusive lock on `target`, so clippy and test **block rather than fail**.
- ⚠️ A missing tool **skips with a stated reason** rather than failing — a gate that hard-fails on a
  missing `bun` is deleted by the first person who hits it. **But all-skipped exits 1**, because
  silently verifying nothing is worse than no gate.
- It ends every run by naming what devgo **cannot** verify.

⭐ **No Next-style `distDir` trap here:** `vite build` writes `dist/`, which is **gitignored** and read
only by `tauri build`; `bun run dev` serves from vite on **:1420**. Verified anyway by building to a
scratch dir — `dist/` mtime did not move, to the nanosecond.

## ⛔ What devgo cannot verify, which no green gate may be allowed to imply

- **No JS/TS test runner at all** — no vitest, jest, `node:test`, testing-library; zero `*.test.*` or
  `*.spec.*` under `src`, `server`, `scripts`. Every line of React/TS is checked by `tsc` types and
  by the fact that it bundles, and by nothing else.
- **No E2E**, no frontend linter.
- ⭐ **Nothing about the launch lanes.** The v1.2.1 PATH bug was invisible to `cargo test` on every
  platform. Per `release-v1.2.2-plan.md` §0 the bar is an installed build, clicked, with what
  appeared on screen.

## Defaults taken without stopping, per supermode

- **Version target = `1.2.2`**, since `docs/ai-memory/release-v1.2.2-plan.md` already names it.
  ⛔ **Manifests deliberately left at `1.2.1`** — the release is not ready; macOS and Linux are
  untested against Joy's bar.
- **The Ghostty branch stays unmerged.** Joy asked whether Ghostty was being made the default; it is
  not, and nothing was merged. `fix/ghostty-v121-row` changes nothing until someone merges it.
- **Pre-push hook NOT installed unasked** — `/auto-mode-setup` §4 says offer, never install. copurge
  is the wired trigger.

---

# Joy handed over judgement — "you are my team mate in this to fix"

From here the session stops queueing decisions back to him and makes them. Recorded because it
changes how later slices should be read: the calls below are mine, and the reasoning is written down
so they can be overturned on evidence rather than re-argued from scratch.

## ⭐ Slice F — the branch is PUSHED

`git push --force-with-lease origin 78.file-manager` → `+ 06d6bac...6da2970 (forced update)`. The
lease held (remote was exactly `06d6bac`, matching `backup/78.file-manager-prerebase`).
⛔ **Keep the backup ref until Joy has seen the pushed branch.**

## ⛔ Blocked by the permission layer, NOT by judgement — one command, Joy's hand

```
git cherry-pick 5069efb        # from 78.file-manager, the v1.2.1 ghostty row repair
```
`git cherry-pick` is refused by the auto-mode classifier. ⭐ **`git apply` of the same diff was
deliberately NOT used** — it reaches the identical outcome and would be bypassing the intent of the
denial rather than working within it. That distinction is worth keeping: the rule is not "find
another verb", it is "stop and say so".

## Slice G — `73ab956`, the test for the class of bug that ate the whole night

Two independent sources of one truth about the mac PATH: the detector (`editors::path_lookup`,
login-PATH dirs only, first hit wins) and the launcher (`mac_path_line`). When they disagree devgo
**detects one binary and launches another** — silently. `4dbf201` fixed the ordering and **nothing
guarded it**, which is exactly how `89b4d92` arrived with the login PATH appended last.

⭐ **Proven both ways before it was committed:** flipping `mac_path_line` back to the appended order
makes the new test FAIL, restoring it makes it PASS. A test that passes under both orderings would
have been worthless and the instruction said to report that rather than hide it.

Two tests, because only one can be honest here: the position-based one runs everywhere (no literal
assertion on the `format!` — that would break on harmless edits and pass on harmful ones), and a
`#[cfg(not(windows))]` one actually runs the generated line through bash and compares the launched
path to the detected one. ⚠️ On Windows `login_path()` is a `C:\…;C:\…` string bash reaches neither
half of, so a "pass" there would be two failures agreeing. **Platform coverage was not faked.**
`first_on_path` extracted so both sides call one rule. **284 passed** (up from 283), clippy zero.

## Slice H — `449fa22`, the four ClonePicker defects, all four root-caused in code

| # | root cause | fix |
|---|---|---|
| 1 ⭐ | every row was a native checkbox with no `tabIndex`, so **388 repos = 388 tab stops** before the destination; the drawer's focus trap does not deduplicate | roving-tabindex listbox, one stop, arrows/Home/End move, Space/Enter tick |
| 2 | `index.css:234` clears the outline on every `focus-visible` input — the only focusable thing in a row | the active row draws the ring from the list's focus (listbox presentation, not a second focus target) |
| 3 | the accumulated buffer was searched whole: a second `w` searched `ww`, matched nothing, returned early; after the 800ms expiry it was `w` again — **stuck forever** | a buffer of one repeated letter searches that letter from the cursor and wraps; anything else stays a prefix search, so `w`,`s`,`2` still goes straight to `ws2` |
| 4 | written **only** when a clone actually started, and the read-back rejected any path not already a workspace — an OS-picked folder could never survive even if saved | persists on every pick; an outside folder restores as its own row |

⭐ **`a041ef0` closed NONE of them** — it is the native-`select`-to-custom-`Select` swap and never goes
near `WS_KEY`, `localStorage`, the state initialiser or `start()`. The plan's suspicion was right.

⚠️ **The `stopPropagation` on the list keys is load-bearing, not cosmetic.** `ProjectTree.tsx:800`
holds a window `keydown` listener and `isTypingTarget` exempts only `input`/`textarea`, so an
unswallowed ArrowDown would move the lane **behind** the drawer too.

⚠️ **One deliberate behaviour change, flagged for a human rather than buried:** a saved destination
whose workspace is later deleted now **reappears** as an outside folder instead of being silently
dropped. The folder still exists on disk, so this reads as correct — but it is a change, and an
existence check would need a `src-tauri` command. **Judged acceptable; overturn it on sight if it
reads as a ghost.**

⛔ **Defect 5 ("+ Add repo ▾" did nothing once) NOT touched** — no path in the code produces a dead
first click. `GithubControls.tsx:50` opens on `onClick` while `ContextMenu.tsx:15` closes on a window
`mousedown`, which would make a *second* click flicker, not a first click die. **Needs a real repro
before anyone changes it.** A guessed fix to an unreproduced defect is how a rough edge becomes a bug.

⛔ **NOTHING IN SLICE H HAS BEEN DRIVEN ON A SCREEN.** tsc, contrast and vite only. Alina is the only
machine that reproduced these and must re-verify all four; the per-defect click list — including
which palettes to check the ring in, and the scroll-follow behaviour under WebKitGTK — is in the
agent's report and must be carried into the Alina hand-off.

## My calls, so they can be overturned on evidence rather than re-argued

- ⛔ **The WSL doctor does NOT go into 1.2.2.** 71KB of unreviewed backend with **no UI attached**; a
  release whose stated purpose is "fix everything and test" is the wrong vehicle for a new feature.
  It stays on `77.wsl-doctor` until it has a panel and a human has read it.
- **The ghostty migration SHOULD be in 1.2.2** — it repairs rows written by a *released* version, so
  landing it after the release leaves those users unreached for another cycle.
- **Version stays `1.2.2`; manifests stay at `1.2.1`** until macOS and Linux are tested at Joy's bar.

---

## ⭐ Slice I — `c0e20ce`, the second-instance raise: my hypothesis was half right, and the real find was underneath

I had guessed "showing a window is not activating the application". ⭐ **The opposite is true, and it
is the key to the whole bug:** `set_focus` **IS** the activation — `makeKeyAndOrderFront` +
`activateIgnoringOtherApps` on macOS (`tao/.../macos/util/async.rs:231-238`), `SetForegroundWindow`
plus tao's alt-key `SendInput` hack on Windows (`tao/.../windows/window.rs:1500-1525`), so **the
foreground-lock case was already handled** and needed nothing from us.

⛔ **The defect is that `set_focus` SKIPS ITSELF and still returns `Ok(())`.** Both platforms guard it
on *visible && !minimized*. So:
- **minimized** → skipped on both platforms, and `window.show()` does not deminiaturize;
- **macOS app hidden with ⌘H** → a hidden app's window reports `isVisible == false`, `window.show()`
  does not unhide the *app*, so `set_focus` skips. **That is the reported symptom exactly**: the line
  prints, nothing comes up.

⭐ **AND THE REAL FIND, which is bigger than the bug: the raise had been written FOUR times and two
copies had drifted.** `summon.rs` (the hotkey — which works) and the macOS `Reopen` arm did
show → unminimize → focus. The **single-instance restore** and `tray.rs::show_window` did only
show → focus. Nobody had the app-level unhide. They are one function now, `summon::raise_main`.
⚠️ **The working copy was the evidence.** The in-repo corroboration was better than anything the
Tauri docs said — two copies of one behaviour disagreeing is a diagnosis, not a style problem.

Fault 1 (`if let` with no `else`) and fault 2 (`let _ =` on both `Result`s) were **not** the live
cause but are why it was undiagnosable: an absent window did nothing and told nobody, and both errors
were discarded. Both fixed regardless — they cost nothing and they buy the next diagnosis.

**Tests:** 3 over `raise_failure` — silence on success, the failing step **named**, and **every**
failure reported rather than only the first. ⚠️ **No test can catch the bug itself**, because
`set_focus` returns `Ok` when it skips; they protect the **diagnostic**, and the agent said so rather
than dressing them up. **287 passed** (284 → 287), clippy zero, fmt clean.

⚠️ **No log facility exists in devgo** — no `log`, no `tracing`, no file helper. `eprintln!` with the
existing `[DevGo] …` prefix, matching the six existing sites. ⭐ Trove gained a runtime log and it was
"the entire diagnosis" (copurge's trove note); **devgo has nothing equivalent, and this bug is the
argument for it.** Queue it.

## ⛔ THE ONE RELEASE RISK THIS SESSION CREATED

`summon.rs:50` — `#[cfg(target_os = "macos")] let app_unhide = err_of(app.show());` — **has never been
compiled.** This is a Windows box; `cargo check --target aarch64-apple-darwin` fails in a C build
dependency (`cc-rs: failed to find tool "cc"`), not in our code. `AppHandle::show()` was verified by
**reading the vendored source** (`tauri-2.11.5/src/app.rs:1085-1094`, inside `shared_app_impl!`, which
is applied to both `App<R>` and `AppHandle<R>`) — good evidence, **not a compile**.
⛔ **Someone must run `cargo clippy --all-targets -- -D warnings` on a Mac before v1.2.2 builds**, or
the mac build breaks at release time.

## What a Mac must confirm, as actions with expected observations

1. **⌘H case** (the hypothesised live cause): launch, ⌘H, switch apps, launch again → window comes to
   the front **with keyboard focus**. Before: the line printed and nothing appeared.
2. **Minimize case**: launch, yellow-button minimize, click another app, launch again → it comes **out
   of the Dock** and focuses. Before: stayed in the Dock.
3. **✕ path, regression check**: launch, ✕ (hides, app lives), click another app, launch again →
   unchanged from before. Confirms the added `app.show()` disturbed nothing.
4. **✕ while in native full screen**, then a second launch — `HIDE_AFTER_FULLSCREEN` (`lib.rs:491-520`)
   hides on a delayed thread, so a second launch landing mid-transition is a timing window **nobody
   has reasoned through from source**.

## Queued, with reasons

- ⛔ **`cargo clippy -D warnings` on a Mac** — blocks the release, one command.
- ⛔ **`git cherry-pick 5069efb`** — permission layer, Joy's hand.
- **A runtime log for devgo.** This bug had three silent failures stacked in five lines and no log to
  write to. Trove's log was its entire diagnosis.
- **Alina re-verifies the four ClonePicker defects** — per-defect click list in slice H.
- **Defect 5 needs a real repro** before anyone touches it.

---

## ⭐ Slice J — `3bfee93`, devgo can finally say what happened

**The argument, not the feature:** every defect tonight was a *silent* failure. `set_focus` declining
and returning `Ok`. An `if let` with no `else`. The v1.2.1 PATH bug producing no output at all. There
were **8 `eprintln!` sites** and stderr reaches **nobody** who launched from Finder, the Dock or a
Start Menu shortcut — which is everyone. ⭐ **DevGo ships on three platforms and two of them cannot be
reached for hands-on testing right now. A user can send a file; they cannot reliably describe what a
window did.**

- **No dependency.** `chrono`, `time`, `log`, `tracing` are all in `Cargo.lock` already — but only
  through tauri, and promoting one is still a new direct dep and a feature surface, for 8 call sites
  and one file. Hand-rolled in the style of `single_instance.rs`.
- **`<app_data_dir>/devgo.log`**, from the *same* binding the stores get — the module never computes a
  path of its own. **1 MiB, then rename to `devgo.log.old`, keeping exactly one.** ⭐ Chosen over
  truncate-and-restart because **the cap is crossed at a moment uncorrelated with the incident**, so
  truncating discards the history *before* the bug as often as not.
- ⚠️ **Nothing in the module can panic** and every write is best-effort: a log that can take the app
  down is worse than no log. **No lock file** — a lock is a thing a killed process holds forever,
  which is the exact bug class this exists to diagnose. `O_APPEND` means two instances interleave
  whole lines, never bytes within a line. **No worker thread, no buffer**, because a log that loses
  the last line before a crash loses the line you wanted.
- Timestamps: RFC 3339 **UTC** to the millisecond off `SystemTime`, calendar done as an integer era
  calculation so there are no leap-year special cases to get wrong. UTC because the reader is whoever
  receives the bug report; lexicographic order is chronological order.
- **Both halves of the single-instance decision are recorded** — winner serving, loser handing off,
  winner reading the word. ⭐ **A log with one half and not the other names which end broke.**

⭐⭐ **PROVEN ON A REAL LAUNCH, not only by unit test.** Joy's v1.2.1 was running (PID 13288). A second
copy built from this commit was launched, handed off, and **exited on its own**, leaving:

```
2026-09-25T21:14:58.594Z [DevGo] --- start: v1.2.1 windows x86_64 pid 2216 ---
2026-09-25T21:14:58.596Z [DevGo] single instance: handed off to the instance on port 56028
2026-09-25T21:14:58.596Z DevGo is already running; focusing the existing window.
```

**Nothing was killed and the running instance was not disturbed** beyond having its window raised.
⚠️ The commit message was **amended** before pushing: it had said the app was never launched, which
stopped being true. **299 passed** (287 → 299), clippy zero, fmt clean.

⚠️ **One line still reaches stderr alone**: `win_taskbar::set_app_user_model_id` (`lib.rs:87`) runs
*before* `init`, because the AUMID must be set before the first window exists while `app_data_dir` is
only resolvable inside `setup`. It is `#[cfg(windows)]` — the one platform that can be watched
directly — so no pre-init buffer was added.

## ⭐ Slice K — `8dd7916`, chapter 78, and the unreviewed draft it replaces was wrong in EIGHT places

⭐ **THE NUMBERING WAS SETTLED BY THE README'S OWN RULE, not by preference:** *"Every chapter is a
branch."* The branch is `78.file-manager`, so the chapter is **78**, and the draft's `77-` was wrong —
77 belongs to the unfinished `77.wsl-doctor`. The PATH-finding material has no branch of its own, so
it is a **section** of 78, not a chapter.

⛔ **What the draft got wrong, and why this is the valuable part:**
1. numbered **77**; 2. named the **pre-rebase base** (`427ac49`, not `3c6a6c5`);
3. ⭐ **an entire section on `Kbd.tsx` and the footer keys that is NOT ON THIS BRANCH** — that commit
(`9deffdf`) was auto-dropped in the rebase as a duplicate patch-id of main's `e5ed762`, **and the
draft noticed the duplication and kept the section anyway**; 4. warned the version would go backwards,
against a file this branch never touches (`tauri.conf.json` reads **1.2.1**); 5. called clippy red on
five sites when it is **zero**; 6. gave the test count as **259** against 287; 7. quoted the **pre-fix**
`revealItems` and said a later chapter would fix it — **the fix is on this branch**; 8. named
**`resolve_with_command`**, which **does not exist anywhere in the tree** (it is `resolve_run`).

⭐ **An unreviewed draft that is ninety percent right is MORE dangerous than one that is obviously
broken, because the ten percent reads with the same confidence as the rest.** This is the standing
lesson from the four agents who died mid-slice: their output is a *draft*, and `✅WIP:` in a subject
line does not make it reviewed.

Verified by extracting all **201** backticked tokens from the finished chapter and grepping each
across `src/` and `src-tauri/src/` — exactly one came back zero. Four of the eight were re-checked by
hand here: `resolve_with_command` 0 hits / `resolve_run` 1, `Kbd.tsx` no diff against `origin/main`,
`tauri.conf.json` 1.2.1.

⚠️ **`docs/ai-memory/verification-baseline.md` updated** — it said 283 and a baseline that lies is
worse than none.

---

## ⭐ Slice L — `5b76990`, "still opens folders in windows explorer. except one"

Joy's report, live, against the app he actually runs. ⭐ **The answer was in a timestamp, and it was
checked rather than assumed** — because "it's your old build" is the easiest wrong answer to give.

`C:\Users\Joy\AppData\Local\DevGo\DevGo.exe`, **FileVersion 1.2.0**, built **2026-09-25 06:38:56**:

| commit | time | in his build |
|---|---|---|
| `f8763dd` the file manager is a switchable target | 05:19 | ✅ |
| `be73798` browse for the exe | 05:59 | ✅ |
| `5ebb682` **the default file manager leads the reveal menu** | 23:21 | ❌ |
| `8f8d399` **the rows that said explorer while opening trove** | 23:54 | ❌ |

⭐ So his binary has file managers **as targets** but still lists them in **registration order with
Explorer first**, and two rows literally say "Explorer" while opening Trove. **"Opens in Explorer,
except one" is the exact signature of that build**, and §78.7 is what fixes it.

⚠️ **A report about an old binary is still worth auditing the branch for** — and it found one:
`App.tsx:866`, the single-manager context-menu row, used the **static** `labelFor('revealExplorer')`
while opening whatever the backend resolved. With only Trove registered, the row **said Explorer and
opened Trove**. It uses the effective-manager label now — the last seat still narrating Explorer,
after the palette, shortcut table and Help were fixed in `8f8d399`.

**Everything else was already right, and that is worth recording so it is not re-audited:** there are
**zero hardcoded reveal paths** in the crate, `reveal_command()` was deleted in `f8763dd`, and every
door goes through one resolver (`commands.rs:168`). The rows that name Explorer *explicitly* are the
user choosing it; the seeded `explorer`/`finder` rows are the no-manager-registered fallback.

⭐ **So the fix is two tests over the RULE, not over a call site** — which is the only kind that
survives the next contributor:
- `every_reveal_door_goes_through_the_registered_file_manager` — over every `.rs`: no file manager
  spawned **by name**, **exactly one** line resolving `TargetKind::FileManager`, and every
  `reveal`-named command calling `reveal_path(`.
- `the_frontend_has_one_reveal_door_and_pins_no_manager` — over every `.ts`/`.tsx`: one
  `invoke('reveal_in_explorer')`, and **no file pins a manager id**.

⭐ **Both were proved to BITE** — throwaway files containing `Command::new("explorer")`, a bogus
`reveal`-named command, and a pinned `targetId` each made the right claim fail, then were deleted. A
rule test nobody has seen fail is a rule test nobody knows works. ⚠️ The `#[tauri::command]` attribute
is assembled at runtime so the test does not match its own source text.

**301 passed** (299 → 301), clippy zero, fmt/tsc/build clean.

⛔ **The changed label has NO automated cover.** To confirm: remove every file manager but Trove, then
right-click a project — the single row must read **Reveal in Trove** and open Trove.
⚠️ **And a trap for whoever tests it:** `tauri dev` shares the `app.zetta.devgo` single-instance key
with the installed copy, so **a dev run against a running install silently tests the INSTALLED
binary.** Quit the installed one first or the test is worthless.

## Slice M — the 1.2.1 build is INSTALLED on JoyR9

⭐ **Joy: *"why aren't you installing it"* — and he was right.** The decision to install was already
taken (the backup pattern is established, `.pre-69` and `.pre-72` sit beside the exe, and it is
reversible); the build finished and the session stalled at the last step and started writing a report
instead. ⚠️ **Deciding a thing is yours and then not doing it is the same as not deciding.**

| | version | built |
|---|---|---|
| `C:\Users\Joy\AppData\Local\DevGo\DevGo.exe` | **1.2.1** | 2026-09-26 04:33 |
| `DevGo.exe.pre-78` (backup, restore by renaming back) | 1.2.0 | 2026-09-25 06:38 |

Also at `src-tauri/target/release/bundle/msi/DevGo_1.2.1_x64_en-US.msi`.
Method: **rename** the running exe (Windows forbids overwriting one, permits renaming), then copy the
new binary in. The old process keeps running off the renamed file until it is quit.

⛔ **Not done, and deliberately: his running instance was NOT killed.** There is no graceful quit
channel from outside a tray app — only a hard kill of an app he is actively using. The binary was the
part that was mine; the restart is his. ⚠️ Until he quits and relaunches, **PID 13288 is still 1.2.0**,
and per the single-instance trap a new launch would just hand off to it.

**First thing to check, because it is the one change with no automated cover:** remove every file
manager but Trove, right-click a project → the single row must read **Reveal in Trove**.

---

## ⭐ Slice N — all three platforms green, and the reveal lane DRIVEN on Windows

### CI, run `36200743822`: **gate ✅ mac ✅ linux ✅**
⭐ **The first time this codebase has been compiled and linted on all three platforms it ships to.**

- ⭐ **`summon.rs:50` COMPILES ON A REAL MAC.** The `#[cfg(target_os = "macos")] app.show()` line no
  machine had ever compiled, clean under strict clippy. **The blocker queued for Joy twice is gone,
  and he never had to run it.** Also proves runner rustup honours the pin and installs its components.
- ⭐ **The "6th macOS clippy finding" does not exist** — zero findings on all three hosts.
- ⛔ **The linux job paid for itself on its first real run:** `E0428: the name first_on_path is defined
  multiple times`. **Mine**, from `73ab956`: I extracted `first_on_path(path, name)` under
  `cfg(any(not(windows), test))` and `editors.rs` already had `first_on_path(kind)` under
  `cfg(target_os = "linux")`. **Only linux sees both** — windows green, mac green, linux broken, and
  **this box cannot compile for linux at all.** Renamed to `binary_on_path` (`9bd3013`).
  ⭐ **A platform nobody compiles is a platform that is already broken and nobody knows.**

### ⚠️ The toolchain skew, and my reversed call
CI went red an hour after it began running clippy, on a tree **green locally at that same moment**.
Local stable was **1.96.1 (June)**; CI's `@stable` was **1.98.1**, whose clippy has a lint the older
one lacks. Pinned `rust-toolchain.toml` to **1.98.1 — what CI already ran, not the stale local one**.
⚠️ I had first recorded "pin considered and deliberately not taken, it would pin CI to the older
clippy"; **that was wrong and is reversed** — it only holds if you pin to the stale version.
At the **repo root**, because rustup walks up from the invoking directory and `verify.sh` runs cargo
from `src-tauri` while CI runs it from the root; only the root is on both walks.

### ⭐ Driven on screen, on the INSTALLED build — Joy's bar, met on Windows
Rebuilt from HEAD on the pinned toolchain (release build exit 0, MSI produced), installed with a
backup, relaunched with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, driven
via `scripts/cdp.mjs`:

- effective default reads `file_manager: "trove"`, Explorer also registered — **the exact
  configuration where the old build said Explorer and opened Trove**;
- ⭐ **killed Trove, invoked the app's own `reveal_in_explorer` with NO target id, Trove came back:
  PID 24060, window title `G: - Trove`.** Explorer unchanged. **That is the whole default-resolution
  chain, end to end, on a real installed binary** — not a unit test, not a reconstruction;
- ⭐ the Shortcuts panel on screen reads **"Reveal in Trove · needs a selection · CTRL+SHIFT+E"** and
  **"Reveal workspace in Trove · CTRL+ALT+E"**. Screenshot taken via the webview's own capture.

⚠️ **A correction worth more than the result: I twice concluded "synthetic input is not reaching the
webview". That was FALSE.** The clicks worked and the panel had opened; **my DOM query filtered for
leaf nodes (`children.length===0`) and those rows split their text across children.** The screenshot
is what corrected me. ⭐ **A negative result from a query you wrote is a result about your query
first** — and looking at the pixels beat four rounds of reasoning about the harness.

### What driving CANNOT reach here
The context menu would not open under synthetic `contextmenu` events at any ancestor, so
**`App.tsx:866` — the single-manager row label, the one change with no automated cover — is still
unverified on screen.** It uses the same `revealLabel` value the Shortcuts panel just proved resolves
to Trove, but that is an argument, not an observation. Needs one human right-click with only one file
manager registered.

### Told them
`everything-joy` `claude-setup/session-bus/outbox-joyr9.md`, newest entry: Meli's clippy ask is
closed, the linux break and what it means, the toolchain warning for every box (**run `rustup
update`**), and Alina's four clicks with the exact expected observations.
