# 71 — A Clone Says Where It Went

**Branch:** `71.screenshots` — `git checkout 71.screenshots` gives you this chapter's finished tree; `git diff 73b5298 71.screenshots` is exactly what this chapter adds. The branch tip is `3d3bc94`; the `✅STAGE: 71 screenshots` commit (`4bbeb0e`) sits on `main` only, after the fast-forward, and 72's *Also since 71* counts from it.

**Starting from:** chapter 70 — release (`73b5298`). Written from the public work itself.

**Goal:** two things, one branch. First, the clone from 34 learns to land somewhere other than a workspace and to say what happened: the picker's destination list ends in *Choose a folder…*, a folder outside every workspace can become one on the way, the lane heading reads *Cloning ‹repo› · 42 %* while a clone runs, and the toast at the end names the repo, names the folder and carries an *Open* button — or says why it failed. Second, the README gets its pictures: seventeen real captures under `docs/screenshots/{windows,mac}`, with a README that says what each one shows, so the marker 68 left in the root README can be replaced by frames (which happened on `main` right after, `ac5fe2f` — 72 lists it).

## Also since 70

Nothing: `main` did not move between `✅STAGE: 70 release` (`73b5298`) and this branch.

> **Hold on to:**
> 1. **A clone's progress is a stream of events, not a return value.** `clone_repo` answers as soon as its thread starts (`CloneStarted`); everything after arrives as `devgo://clone-progress` and `devgo://clone-done`. So anything that wants to *show* a clone — the row's line (34), now the heading's word and the closing toast — reads the hook's `jobs` map or its `onDone` callback, and nothing waits on a promise for minutes. A refusal before the thread exists is the one exception: it is the command's own error, and the hook turns it into the same `CloneDone` shape so the caller sees one ending.
> 2. **A picked folder outside every workspace becomes a workspace.** The scanner only lists what the workspaces hold; a clone into `D:\stuff\repo` would finish and appear nowhere. So the picker says so (*Add as workspace*, ticked by default) and App adds the workspace *before* it enqueues the clone, so the finished clone is scanned into a lane on the same refresh that marks the GitHub row `local`.
> 3. **Probe a path only after the liveness gate.** `folder_ok` is a `Path::is_dir()`; on a `\\wsl.localhost\…` path that stat boots the distro. It runs after `refuse_if_needed` has read the running list, and only for a destination that is not a listed workspace — the same order the scanner keeps.

---

## 71.1 — A folder outside the workspaces

`commands.rs`, `clone_repo`: the refusal *‹workspace› is not one of your workspaces* is gone. The store is asked once (`listed`), the plan is built and `refuse_if_needed` runs as before, and then, only when the destination is not a listed workspace, `clone::folder_ok(&workspace)?`. `clone.rs`:

```rust
/// A destination that is not one of the workspaces: the picker's own
/// folder chooser. Any folder that exists will do; a path that does not
/// is refused here, not by git halfway in.
pub fn folder_ok(into: &str) -> Result<(), AppError> {
    if std::path::Path::new(into).is_dir() {
        Ok(())
    } else {
        Err(AppError::CloneRefused(format!("{into} is not a folder")))
    }
}
```

One test, `a_chosen_folder_must_exist`: a temp directory passes, the same path after `remove_dir_all` fails with *not a folder*.

> `✅CLONE: a folder outside the workspaces` — **204** (203 + 1) is the count 72 starts from.

## 71.2 — Choose a folder…

`ClonePicker.tsx`. The destination `<select>` maps `into` — the workspaces, plus the chosen folder when it is not one of them — and ends in one more option, `PICK` (`'__pick__'`), labelled *Choose a folder…*. `pickInto(value)`: a workspace is `setWorkspace`; `PICK` opens the OS folder dialog (`openDialog({ directory: true, defaultPath: workspace || undefined })` — the dialog plugin's `open`, imported as `openDialog` the way 19 did; the same dialog App's `pickWorkspaceFolder` opens) and a picked path becomes `chosen` and the selection; a dialog error lands in the picker's own `error` line. `insideAny(path, workspaces)` says whether the path is one of the workspaces or under one (`normalizePath`, case-folded, a `/` boundary) — a folder under a workspace is scanned already. `outside` is *chosen, selected, and inside none*; only then a checkbox appears beside the select, *Add as workspace*, `addAsWorkspace` on by default, titled *The folder is in no workspace. Add it so the clone shows in a lane*.

`onStart(repos, into, add)` (`ClonePickerProps` in `types.d.ts`): `into` is a workspace or the chosen folder; `add` is `outside && addAsWorkspace`. App's `onStart` is now async: `if (add) await handleAddWorkspace(into)` — the workspace first, so the clone lands in a lane — then `clone.enqueue(repos, into)` and the *Cloning … into ‹folder›…* toast as before.

> `✅UI: clone into a chosen folder`

## 71.3 — The heading says what is cloning

`GithubLane.tsx`: the row's own *Receiving objects 42%* line (34.6) is scrolled away in a lane of hundreds. `jobsLine(jobs)` reads the hook's map: `null` while nothing is `running`, else `Cloning ‹name› · 42 %` (`…` while the percent is still `null`) with ` · N queued` when the queue has more. `LaneHeading` gets it as its first child, `text-11 text-accent truncate`, titled *A clone in progress; the queue after it*, before the login.

> `✅UI: cloning shows in the lane heading`

## 71.4 — A toast with an action

`Toast.tsx`: `toast(message, type = 'error', action?)`. `ToastAction { label, onClick }` and `Toast.action?` in `types.d.ts`; `ToastContextType.toast` gains the third argument. A toast with an action stays **8 s** instead of 4 — there is something to click — and renders as `flex items-center gap-3` with the message in a `span` and a ghost `Button` (`text-13 text-accent shrink-0`) whose click runs the action and dismisses the toast (`dismiss(id)`, now a function of its own).

> `✅UI: toast with an action`

## 71.5 — A clone that ends says so

`useClone(onDone: (done: CloneDone) => void)` — was `onCloned(dest)`, called on success only. Every ending reaches `onDone` now: the `devgo://clone-done` payload as it is, and the refusal path (`clone_repo` rejected before a thread existed) builds the same shape — `{ full_name, ok: false, dest: job.workspace, error }` — so App has one callback for both.

`App.tsx`: a failed clone toasts *Clone of ‹name› failed: ‹error›* (`error`); a finished one toasts *Cloned ‹name› into ‹folder›* (`success`) with the action **Open** → `reveal_in_explorer` on `done.dest` (25's `path: String` form). The folder is `lastSegment(parentOf(done.dest))` — `parentOf` joins `lastSegment` in `paths.ts` (either separator, trailing slashes ignored) — because `dest` is the clone itself and the person asked where it went. Then `refresh()` as before.

> `✅UI: a clone that ends says so`

## 71.6 — Cross-platform, said honestly

Root `README.md`'s second paragraph now opens *Cross-platform.* and adds, between the Mac and the lanes, that Linux builds from the same crate but has not been run yet, so treat it as untested. `AboutPanel.tsx`'s one sentence says the same — *A cross-platform project launcher: Windows and WSL, macOS, and a Linux build that has not been run yet* — in place of the per-platform `isMac ? 'the Mac' : 'Windows and WSL'` (40); the credit line after it is unchanged.

> `✅DOCS: cross-platform, linux not run yet`

## 71.7 — The screenshots

`docs/screenshots/README.md` and seventeen PNGs: real screen captures over the desktop wallpaper, every other window minimised, the window born see-through at the knob, Neon theme, server rows name-only (69's switch off).

- **Windows**, 2560×1392, maximised, knob 20 %: `01-four-lanes.png` (WSL · Windows · GitHub with groups and the ungrouped tail · Servers with one row expanded to its folders and app rows), `02-app-actions.png` (right-click on an app: the declared actions in sections), `03-nginx-form.png` (*New site…*, the line it will type), `04-palette.png` (the palette filtered to `server`), and `10`–`20` — one per Settings page, Workspaces through About.
- **Mac**, 1686×990, knob 18 %, `screencapture`: `01-three-lanes.png` (Mac · GitHub · Servers, one row expanded) and `01b-three-lanes-collapsed.png`.

The table in that README is the caption for each. `20-settings-about.png` was taken again after 71.6 changed the panel's sentence — the last commit on the branch, a binary-only diff.

> `✅DOCS: screenshots, windows and mac` · `✅DOCS: about frame on the new wording`

The frames show what the lanes showed: the server row's alias and an app's name are in the picture and in the captions. 69's hygiene grep ran over `src src-tauri/src README.md`; `docs/` was outside it, so the captions were never counted — anyone retaking the set should check them before saying *no host on screen*. The shooter that retakes a frame in one command (`scripts/shoot.ps1`, `scripts/cdp.mjs`) came later on `main` (`3626d7c`; 73 lists it): this set was taken by hand.

## 71.8 — Verify

What to check on the branch; the run's own numbers were not recorded.

- **Gates**: `cargo test` should read **204** (70's 203 + `a_chosen_folder_must_exist`), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean.
- **The refusal, by string**: `folder_ok("C:\\nope-71")` (or any path that is not there) → *… is not a folder*; the test covers it. `clone_repo` with a listed workspace never calls it — a workspace that stopped existing still fails inside git, as before.
- **The picker**: *Clone repos…* → the select's last option is *Choose a folder…*; picking it opens the OS dialog (a native dialog, the one 19's export and import open: CDP cannot see it). A folder under a workspace: no checkbox. A folder outside every workspace: the checkbox *Add as workspace* appears, ticked; *Clone* → Settings › Workspaces lists the folder before the clone's first progress event.
- **The heading**: while a clone runs, the GitHub heading reads `Cloning ‹name› · N %` (`…` before git's first percentage) and ` · N queued` with two or more ticked; gone when the queue is empty.
- **The toast**: on a finished clone, *Cloned ‹name› into ‹folder›* with **Open**, for 8 s; *Open* reveals the clone in Explorer (Finder on a Mac) and the toast goes. On a refused one (the destination already exists — 34's rule), *Clone of ‹name› failed: …* at once, and the next queued job starts.
- **The frames**: `docs/screenshots/README.md` names every file that exists under `windows/` and `mac/`, and no file is unnamed.

> `✅STAGE: 71 screenshots` — on `main` after the fast-forward (`4bbeb0e`), not on the branch; push `main` + branch.

## 71.9 — Deferred

- The screenshots README's captions name a server row; a retake with a fixture `servers.json` (`box`, `lanbox` — 69's words) would make the set as anonymous as the tests.
- A clone into a chosen folder with *Add as workspace* off finishes and appears in no lane; the toast's *Open* is the only door to it.
- The dialog's `defaultPath` is the current selection, so *Choose a folder…* opens inside the last workspace; a remembered last-chosen folder (like `devgo.cloneWorkspace`) is one `localStorage` line.

---

## What you built

```
src-tauri/src/services/clone.rs          folder_ok; 1 test
src-tauri/src/commands.rs                clone_repo: a listed workspace or an existing folder, probed after the liveness gate
src/types.d.ts                           ClonePickerProps.onStart(repos, into, add); ToastAction, Toast.action, ToastContextType.toast
src/components/ClonePicker.tsx           Choose a folder…, insideAny, Add as workspace
src/components/GithubLane.tsx            jobsLine in the heading
src/components/Toast.tsx                 toast(message, type, action); 8 s with a button
src/hooks/useClone.ts                    onDone(CloneDone) for every ending
src/paths.ts                             parentOf
src/App.tsx                              add the workspace first; the Cloned / failed toasts, Open
src/components/AboutPanel.tsx            cross-platform, linux not run yet
README.md                                the same sentence
docs/screenshots/README.md               what each frame shows; the sizes and the knob
docs/screenshots/windows/*.png           15 frames: the lanes, an app's actions, a form, the palette, every Settings page
docs/screenshots/mac/*.png               2 frames: three lanes, expanded and collapsed
```

- **A clone can land anywhere** — a workspace, or a folder you pick, which becomes a workspace so the clone has a lane to appear in.
- **The heading and the toast read the stream** — `jobs` for the word while it runs, `onDone` for the sentence when it ends, with a button to the folder.
- **Nothing boots a distro to look at a path** — the liveness gate first, the `is_dir` after, and only off the workspace list.
- **The README has pictures** — seventeen real frames, captioned; `ac5fe2f` on `main` puts three of them in the root README where the marker was.
