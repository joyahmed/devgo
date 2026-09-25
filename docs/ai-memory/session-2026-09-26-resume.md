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
