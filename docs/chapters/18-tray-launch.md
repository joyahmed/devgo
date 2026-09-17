# 18 — Tray Quick-Launch (Slice 9)

**Branch:** `18.tray-launch` — `git checkout 18.tray-launch` gives you this chapter's finished app; `git diff 17.onboarding 18.tray-launch` is exactly what this chapter adds.

**Starting from:** Slice 8 — DevGo onboards an empty first run and scans the way you tell it to. It is a good launcher window. But it is still a *window*: to launch a project you summon it, find the row, and hit Enter. The tray has two items, Show and Quit.

**Goal:** launch your recent projects straight from the tray — right-click, pick, done — without the window ever appearing.

> **Hold on to:**
> 1. **A tray is a projection of state you already have, not a new source of it.** The recents are chapter 06's cache ranked by chapter 09's frecency; building the menu reads one JSON file and boots nothing.
> 2. **When a second UI can trigger an action, the action moves into a function both call.** `open_both` becomes a one-line wrapper over `launch_project_default`, and the tray calls the same function — same target resolution, same `record_launch`.
> 3. **Tray mutation runs on the main thread.** `refresh` dispatches the rebuild with `run_on_main_thread`; callers on a command thread and callers already on main both call it the same way. The `AppHandle` a command needs for that is *injected* — the frontend does not change.
> 4. **The Core Rule has two faces.** The menu *renders* from the cache (never boot); a click *launches* through the launcher (boot fine). The rule was never "don't boot a distro"; it was "don't boot one the user didn't ask for".
>
> Rust: `f64::total_cmp` (a sort that cannot panic on `NaN`); a braced block that drops one lock guard before the next is taken; a match guard on a string prefix (`id if id.starts_with(…)`); `tauri::Result<Menu<Wry>>`.

> The plan's Slice 9 is titled "Sessions & Profiles" and pulls in three phases: session tracking, launch profiles, and tray quick-launch. This chapter ships **one** of them, and the choice is the lesson. Two of the three are a different product — 18.7 has the accounting. The one that is *launcher work* is the difference between "an app you alt-tab to" and "a launcher": the ability to act without the window. And it is nearly free, because two earlier chapters already built its hard parts.
>
> There is no frontend in this chapter. Not one line of TypeScript changes.

---

## 18.1 — The cache gets two readers

The tray wants to list your projects, and listing projects normally means *scanning* — which for a WSL workspace means reading `\\wsl.localhost\`, which boots the distro. A tray menu that boots a distro to draw itself would fire on every rebuild: exactly the cold-boot chapter 06 removed. So the tray does not scan. It reads the cache — the `projects-cache.json` the last real scan wrote, which is JSON on the local disk.

The cache store has never had to hand out *every* project at once, or find one by path. In `src-tauri/src/services/project_cache.rs`, after `get`:

```rust
    // every cached project, no scan
    pub fn all_projects(&self) -> Vec<Project> {
        self.entries
            .values()
            .flat_map(|w| w.projects.iter().cloned())
            .collect()
    }

    pub fn find(&self, full_path: &str) -> Option<Project> {
        self.entries
            .values()
            .flat_map(|w| w.projects.iter())
            .find(|p| p.full_path == full_path)
            .cloned()
    }
```

Both walk every workspace's entry; `all_projects` clones as it goes, `find` clones only the hit. The cache has been `HashMap<String, CachedWorkspace>` since chapter 06 and neither reader changes that — a flat `flat_map` over `.values()` is the whole cost, on a map that holds a few dozen entries.

> `✅CACHE: all_projects and find`

The file has had no tests until now; the two readers get one, at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> ProjectCacheStore {
        let dir = std::env::temp_dir().join(format!("devgo-cache-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        ProjectCacheStore::new(dir).unwrap()
    }

    fn project(name: &str, workspace: &str) -> Project {
        Project::new(
            name.to_string(),
            format!("{workspace}\\{name}"),
            workspace.to_string(),
            "Windows".to_string(),
        )
    }

    #[test]
    fn find_reads_across_workspaces() {
        let mut s = store("find");
        s.store(r"G:\a", vec![project("api", r"G:\a")]).unwrap();
        s.store(r"G:\b", vec![project("web", r"G:\b")]).unwrap();

        assert_eq!(s.all_projects().len(), 2);
        assert_eq!(s.find(r"G:\b\web").map(|p| p.name), Some("web".into()));
        assert!(s.find(r"G:\b\gone").is_none());
    }
}
```

Same shape as chapter 09's preferences tests: a temp dir per test, a real store, and the assertion on what a second workspace does to the first — `find` must read *across* workspaces, because the tray id it will be handed does not say which workspace a project lives in.

> `✅TEST: cache find`. `cargo check` still warns that both methods are never used; the tray is two commits away.

---

## 18.2 — One launch, two front doors

Clicking a tray entry launches the project, and it launches through the *same code* the window does. That is not a coincidence; it is a refactor done on purpose. Chapter 05's `open_both` (rewritten in 13) had the launch logic inline. In `src-tauri/src/commands.rs`, replace it:

```rust
// one launch path for the window, the palette and the tray
pub fn launch_project_default(
    state: &AppState,
    project: &Project,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let editor = resolve_target(state, TargetKind::Editor, None)?;
    let terminal = resolve_target(state, TargetKind::Terminal, None)?;
    launcher::launch_both(&editor, &terminal, project, &info)?;
    record_launch(state, project)
}

#[tauri::command]
pub fn open_both(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    launch_project_default(&state, &project)
}
```

The body is the old `open_both` with `&state` become `state` and `&project` become `project` — it takes `&AppState` now, not `State<AppState>`, because the tray has an `AppHandle` and no command context. `pub` because `tray.rs` will call it from outside the module.

This is chapter 16's "third front door" argument again, in Rust instead of the palette's TypeScript. The window's Enter, the palette's *Open both*, and now the tray all reach `launch_project_default` — so all three resolve editor and terminal through chapter 13's `resolve_target` fallback (your saved default, then the first of its kind), all three respect a target you deleted, and all three call `record_launch`. Launch from the tray and the project climbs the ranking exactly as if you had launched it from the window, because it is the same call. The alternative is two launch paths that agree until the day one of them is fixed.

> `✅LAUNCHER: launch_project_default`

---

## 18.3 — A menu from the cache

The tray gets its own module. Create `src-tauri/src/tray.rs`:

```rust
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::{AppHandle, Manager, Wry};

use crate::commands::AppState;
use crate::models::Project;
use crate::services::{frecency, preferences};

pub const TRAY_ID: &str = "main";
const MAX_RECENTS: usize = 7;
const LAUNCH_PREFIX: &str = "launch:";

// read from the cache, never a scan, so the menu boots nothing
fn top_frecent(state: &AppState, n: usize) -> Vec<Project> {
    let projects = match state.cache_store.lock() {
        Ok(cache) => cache.all_projects(),
        Err(_) => return Vec::new(),
    };
    let (stats, now) = match state.pref_store.lock() {
        Ok(prefs) => (prefs.project_stats(), preferences::now_secs()),
        Err(_) => return Vec::new(),
    };

    let mut scored: Vec<(f64, Project)> = projects
        .into_iter()
        .filter_map(|p| {
            stats
                .get(&p.full_path)
                .map(|s| (frecency::score(s, now), p))
        })
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.into_iter().take(n).map(|(_, p)| p).collect()
}
```

Every line of `top_frecent` is chosen to avoid touching a filesystem. `cache.all_projects()` is the whole trick: building the menu is a read of JSON already on disk, no matter how many WSL workspaces you have, no matter which distros are stopped.

The `filter_map` is the second decision. `project_stats` holds an entry only for projects that have actually been launched (chapter 09's `record_launch` inserts on first launch), so `stats.get(&p.full_path)` is `Some` only for those. A cached project you have never opened is dropped — the tray shows *recents*, and a project with no launch history is not recent, it is just present. On a fresh install nothing has been launched, the list is empty, and the tray is Show / Quit. That is correct: there is nothing to quick-launch yet.

`frecency::score` and the sort are chapter 09, unchanged — the same `(1 + ln(count)) × recency_weight(age)` that ranks the window's list ranks the tray's. `total_cmp` rather than `partial_cmp().unwrap()` because scores are `f64` and `total_cmp` cannot panic on a `NaN` that a malformed stat could in principle produce. A tray that sorts slightly oddly is fine; a tray that panics building its menu takes DevGo down.

Two locks, taken one after the other and each released before the next line — the `match` arms return the value out of the guard's scope. `last_project` needs the same discipline more visibly:

```rust
fn last_project(state: &AppState) -> Option<Project> {
    // drop the prefs lock before taking the cache lock
    let path = {
        let prefs = state.pref_store.lock().ok()?;
        prefs.get_last_project().map(|(p, _)| p.to_string())?
    };
    state.cache_store.lock().ok()?.find(&path)
}
```

The braced block ends the `prefs` guard before `cache_store.lock()` runs, so the two mutexes are never held at once. `collect_projects` holds the cache lock for the whole scan and takes the prefs lock afterwards, in that order; a tray rebuild that held prefs while waiting on the cache would be the opposite order, and two threads taking two locks in opposite orders is the textbook deadlock. The block is how a function that needs both never holds both. `get_last_project` is chapter 08's — it returns the path chapter 08 persisted on every selection — and `find` resolves that path back to a `Project` the launcher can take.

Then the builder:

```rust
pub(crate) fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<AppState>();

    let show = MenuItemBuilder::with_id("show", "Show DevGo").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let mut b = MenuBuilder::new(app).item(&show);

    if let Some(last) = last_project(&state) {
        let item = MenuItemBuilder::with_id(
            "openlast",
            format!("Open last · {}", last.name),
        )
        .build(app)?;
        b = b.separator().item(&item);
    }

    let recents = top_frecent(&state, MAX_RECENTS);
    if !recents.is_empty() {
        b = b.separator();
        for p in &recents {
            let id = format!("{LAUNCH_PREFIX}{}", p.full_path);
            b = b.item(
                &MenuItemBuilder::with_id(id, p.name.as_str()).build(app)?,
            );
        }
    }

    b.separator().item(&quit).build()
}
```

Show, the last project, the recents, Quit — with separators only *between groups that exist*. `Open last` gets one only if there is a last project; the recents get one only if the list is non-empty. A fresh install renders `Show DevGo ─── Quit`, not a menu of empty dividers — the same restraint chapter 14's badges showed by rendering nothing for a project with no tags.

The project entries encode their target *in the id* — `launch:\\wsl.localhost\Ubuntu\home\user\api` — because a `MenuItem` carries a string id and nothing else. `TRAY_ID` is `pub` because `lib.rs` names the tray with it, and that is the wiring. In `src-tauri/src/lib.rs`: `mod tray;` after `mod summon;`, delete `use tauri::menu::{MenuBuilder, MenuItemBuilder};` (the menu is built elsewhere now), and replace the two `MenuItemBuilder` lines and the `MenuBuilder` with:

```rust
            // recents come from the cache; rebuilt on every project fetch
            let menu = tray::build_menu(app.handle())?;

            let _tray = TrayIconBuilder::with_id(tray::TRAY_ID)
```

`with_id` instead of `new`: a dynamic menu needs a handle to the thing it updates, and `tray_by_id` is how the next section gets one. The old inline `on_menu_event` stays for one more commit — the app builds and the tray shows recents, but clicking one does nothing yet.

> `✅TRAY: menu from the cache` — the dead-code warning from 18.1 is gone.

---

## 18.4 — Rebuilt on the main thread

The menu is not built once. Its recents change every time you launch something, so it has to be rebuilt, and rebuilding a tray menu has one sharp constraint. Append to `tray.rs`:

```rust
// tray mutation must happen on the main thread
pub fn refresh(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            if let Ok(menu) = build_menu(&app) {
                let _ = tray.set_menu(Some(menu));
            }
        }
    });
}
```

`run_on_main_thread` is the whole reason this is safe. Tauri commands run on a worker thread off the async runtime, not the UI thread — and on Windows, mutating a tray icon's menu off the UI thread is undefined at best. So `refresh` does not build-and-set inline; it *dispatches* the build-and-set onto the main thread and returns. A caller on a command thread and a caller already on the main thread (a menu-event handler) call `refresh` the same way and neither has to know which thread it is on. The two `clone`s are the `move` closure needing its own `AppHandle` — handles are cheap `Arc` clones — and `let _ =` because a rebuild that fails to dispatch is a stale menu, not an error worth surfacing.

The rebuild is wired into the two commands that fetch projects, so the tray tracks the window. In `commands.rs`:

```rust
#[tauri::command]
pub fn get_projects(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<ProjectsPayload, AppError> {
    let payload = collect_projects(&state, false)?;
    crate::tray::refresh(&app);
    Ok(payload)
}
```

and `refresh_projects` the same way — `app: tauri::AppHandle` added between `force` and `state`, and its last line becomes the same three: `collect_projects` into `payload`, `refresh(&app)`, `Ok(payload)`.

`get_projects` runs on every window focus and summon (chapter 06's live-refresh) and `refresh_projects` on every F5 — so the tray is rebuilt exactly when the list and the frecency it reflects have just been recomputed, and always *after* `collect_projects` has done the scan's WSL work, off it. Adding `app: tauri::AppHandle` to a command signature costs the frontend nothing: Tauri **injects** the handle, it is not passed from JavaScript, so `invoke('get_projects')` is unchanged. The tray became dynamic without a line of TypeScript.

> `✅TRAY: refresh on the main thread`

---

## 18.5 — Launch from the tray

The last piece is the handler. Append to `tray.rs`:

```rust
fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// a click is an ask: booting a stopped distro here is fine
fn launch(app: &AppHandle, project: &Project) {
    let state = app.state::<AppState>();
    let _ = launch_project_default(&state, project);
    refresh(app);
}

pub fn handle_event(app: &AppHandle, id: &str) {
    match id {
        "show" => show_window(app),
        "quit" => {
            let state = app.state::<AppState>();
            single_instance::release_lock(&state.lock_path);
            app.exit(0);
        }
        "openlast" => {
            if let Some(project) = last_project(&app.state::<AppState>()) {
                launch(app, &project);
            }
        }
        id if id.starts_with(LAUNCH_PREFIX) => {
            let path = &id[LAUNCH_PREFIX.len()..];
            let project = app
                .state::<AppState>()
                .cache_store
                .lock()
                .ok()
                .and_then(|c| c.find(path));
            if let Some(project) = project {
                launch(app, &project);
            }
        }
        _ => {}
    }
}
```

and the two `use` lines grow: `use crate::commands::{launch_project_default, AppState};` and `use crate::services::{frecency, preferences, single_instance};`.

`launch` is `launch_project_default` plus the one thing specific to the tray — rebuilding itself afterward, so the rank reflects the launch you just made. Its comment is the Core Rule's *other* face, and it matters that this chapter states it as plainly as chapter 17 stated the prohibition. Everywhere else DevGo refuses to touch a stopped distro. Here it will happily boot one — because **the user clicked "launch this project"**. Booting the distro is the thing they asked for, not a side effect of the tray drawing itself. A scan-to-render boots one nobody asked for and is forbidden; a launch-on-click boots one the click requested and is the whole point. Same rule, opposite verdict, and the difference is intent — which is why `top_frecent` reads the cache and `launch` calls the launcher.

`handle_event` routes every id. `show` and `quit` are chapter 07's arms, moved out of `lib.rs` — `quit` reads `lock_path` from `AppState` now instead of the closure's captured copy. The dynamic entries are matched by the guard `id if id.starts_with(LAUNCH_PREFIX)`: slice the prefix off and look the path up in the cache with `find`. If the project has since vanished from the cache — its workspace removed — `find` returns `None` and the click is a no-op, not a launch of something gone. The same graceful miss the rest of DevGo does.

In `lib.rs`, replace the whole inline `on_menu_event` closure with:

```rust
                .on_menu_event(|app, event| {
                    tray::handle_event(app, event.id.as_ref())
                })
```

The closure no longer captures anything, so `lock_path` no longer needs cloning into `AppState` — `lock_path: lock_path.clone(),` becomes `lock_path,`. Chapter 07's "a closure that outlives the function `move`s what it uses" lesson is retired by the thing it was teaching towards: the value lives in managed state, and the handler reads it from there.

> `✅TRAY: launch from the tray`

---

## 18.6 — The bug the tray exposed

Run it (the Verify section has the steps) with a Windows workspace and a stopped distro, and the tray lists your Windows recents and none of the WSL ones — even the one you launch ten times a day. Look in `prefs.json`: their `project_stats` entries are *gone*.

They were erased by chapter 09's `retain_known`, and they have been erased on every fetch since chapter 09. The window never showed it, because the window ranks whatever it lists and a project with no stats simply sorts to the bottom of its workspace. The tray shows *only* projects with stats, so the erasure is finally visible.

The intent was always right — the comment in `collect_projects` says "pruning against the merged list would let a stopped distro erase the launch history of every project it holds" — but the implementation pruned against the *live paths alone*: keep a stat only if a project scanned live this pass has that path. A Windows workspace is live on every pass; the stopped distro's are served from cache; so every WSL stat failed the test and was dropped. The guard `if !live.is_empty()` only saved you when *nothing* was live.

A project is gone only when the workspace it lives under was read live and the project was not in it. That needs the live *roots* alongside the live paths. In `src-tauri/src/services/preferences.rs`, `retain_known` becomes:

```rust
    /// Drop stats and pins for projects gone from a workspace read live this
    /// pass. Anything under a workspace served from cache or unavailable is
    /// kept: a stopped distro must not erase its own history.
    pub fn retain_known(
        &mut self,
        live_paths: &[String],
        live_roots: &[String],
    ) -> Result<(), String> {
        // slash-normalise so a root prefix-matches its projects on both sides
        let norm =
            |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
        let roots: Vec<String> = live_roots.iter().map(|r| norm(r)).collect();
        let known: HashSet<String> =
            live_paths.iter().map(|p| norm(p)).collect();
        let keep = |path: &str| {
            let p = norm(path);
            known.contains(&p)
                || !roots
                    .iter()
                    .any(|r| p == *r || p.starts_with(&format!("{r}/")))
        };

        let before = (self.prefs.project_stats.len(), self.prefs.pinned.len());
        self.prefs.project_stats.retain(|path, _| keep(path));
        self.prefs.pinned.retain(|path| keep(path));
        if before != (self.prefs.project_stats.len(), self.prefs.pinned.len()) {
            self.save()?;
        }
        Ok(())
    }
```

with `use std::collections::{HashMap, HashSet};` at the top. `keep` is two questions: is this path one we saw live (keep), and if not, does it sit under a root we read live (then it is genuinely gone — prune; otherwise we cannot prove anything — keep). The slash-normalisation is so a `G:\ws` root prefix-matches a `G:\ws\proj` path and a `\\wsl.localhost\…` pin compares cleanly; case is left alone, because both sides come from the same scanner and lowercasing could collide two case-distinct WSL paths. Pins were being lost the same way — pin a project in an offline workspace and the next fetch silently unpinned it — and the same `keep` fixes both.

In `commands.rs`, the caller collects the roots next to the paths and the `is_empty` guard goes (empty roots prune nothing):

```rust
    // prune only under workspaces read live this pass; a stopped distro or a
    // detached drive keeps its history
    let live_roots: Vec<String> = states
        .iter()
        .filter(|s| matches!(s.status, WorkspaceStatus::Live))
        .map(|s| s.workspace.clone())
        .collect();
    let live: Vec<String> = states
        // … unchanged …
        .collect();
    prefs
        .retain_known(&live, &live_roots)
        .map_err(AppError::Lock)?;
```

Chapter 09's test gains the second argument (its paths move under a `G:\ws` root so there is a root to pass), and a new one pins the bug:

```rust
    #[test]
    fn retain_known_keeps_workspaces_not_read_live() {
        let mut s = store("retain-cached");
        let wsl = r"\\wsl.localhost\Ubuntu\home\joy\projects\api";
        s.record_launch(wsl).unwrap();
        s.toggle_pin(wsl).unwrap();
        s.record_launch(r"G:\ws\here").unwrap();

        // the distro is stopped: only G:\ws was read this pass
        s.retain_known(&[r"G:\ws\here".to_string()], &[r"G:\ws".to_string()])
            .unwrap();

        assert!(s.project_stats().contains_key(wsl), "history survives");
        assert_eq!(s.pinned(), vec![wsl.to_string()], "pin survives");
    }
```

> `✅FIX: stopped distro keeps its history`. `cargo test` reports **47**.
>
> Found here because the tray is the first reader that shows it: the erasure has run on every fetch since chapter 09, and the window never noticed. A fix found while verifying is its own commit, after the feature and before the stage.

---

## 18.7 — The session manager it didn't become *(skip on first pass)*

Slice 9 shipped tray quick-launch and left the rest of "Sessions & Profiles" — fourteen items of session tracking and launch profiles — unbuilt. That is not the slice running out of time; it is the slice knowing what DevGo is.

`launch_project_default` ends at `launcher::launch_both`, which ends at `.spawn()` — and `.spawn()` returns without waiting. DevGo hands a directory to Windows Terminal and **forgets it**. It holds no handle to the process, does not know when it exits, cannot read its cwd, has no idea what shell is running inside it. That is the fire-and-forget model chapter 05 chose, and it is why DevGo is a few thousand lines instead of a terminal emulator.

"Session tracking" is the negation of that model. Storing active sessions, tracking cwd and shell per session, reopening terminals on launch — every one needs DevGo to *keep* the handle it currently throws away, to manage PTYs, to know process lifecycles. That is a terminal multiplexer, and building one inside a launcher is scope creep with a section header. Its "reopen terminals automatically on launch" is worse than off-model: reopening a WSL terminal at startup boots the distro at startup, which is precisely the cold-boot chapter 06 spent a whole chapter removing — **a Core Rule violation with a nice name**.

"Profiles" — per-project launch config, env, startup commands — is not off-model, but it is a *separate* feature, and hanging it off this slice because both live under one plan heading would be organising work by section titles instead of by what ships together. It earns its own slice.

Even "save launch history" turns out to be already done. `project_stats` — count and last-opened per project — is what frecency reads and what this chapter's tray reads. A second, timestamped, per-action log is data nothing consumes, and chapter 14 already named that restraint: `pins_node_version` is a boolean, not a version, because the version is a read nothing uses.

So the slice's real output is one feature and one refusal — the correct ratio for a section title that promised a launcher, a multiplexer, and a config system wearing one name.

---

## 18.8 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun tauri dev
```

`cargo test` reports **47** — chapter 17's 45 plus `find_reads_across_workspaces` and `retain_known_keeps_workspaces_not_read_live`. Then the checks only a running app can answer. The tray menu is a native popup: the debug port cannot see it, so this section is driven by hand — real input: a right-click on the icon, `↓` to move, `⏎` to fire — with `wsl -l -q --running` empty before and after every step.

**The menu.** Right-click the DevGo icon (it sits in the hidden-icons flyout until you drag it out — it sets no tooltip, so it is the nameless one). *Show DevGo* — separator — *Open last · devgo* — separator — up to seven project names — separator — *Quit*. With the Ubuntu distro stopped: seven recents, three of them `\\wsl.localhost\` projects, and the distro is still stopped after the menu has been drawn as many times as you like. Before 18.6 this same menu listed the Windows projects only.

**Launch.** Pick a Windows-side recent (`devgo`, third). The editor and terminal open exactly as `Alt+⏎` in the window would open them — three Code processes, two OpenConsole, two pwsh here — and `prefs.json` shows its `launch_count` one higher. Close what opened. Right-click again: `devgo` has climbed to second, because `launch` called `refresh` and the rank now includes the launch you just made.

**Open last.** The item names whatever chapter 08 last persisted — the row you selected last. Pick it: a terminal opens on that project (and an editor, unless it already has that folder open, in which case `code` only focuses it); the count goes up again.

**Show.** Hide the window with ✕. Right-click → *Show DevGo*: it is back and focused. Same behaviour as chapter 07's, through the new handler.

**Quit.** Right-click → *Quit*: the process ends and `%APPDATA%\app.zetta.devgo\instance.lock` is gone — `release_lock` ran with the path it now reads from `AppState`.

**The fix.** With the distro still stopped, count the `project_stats` keys in `prefs.json` before the first fetch and after: the same number. Before 18.6 the WSL ones were missing after the first focus.

Nothing in `src/` changed, so `tsc -b` and `bun run build` are unaffected — run them anyway for the record; both are clean.

> `✅STAGE: 18 tray-launch`; ff-merge; push.

---

## What you built

```
src-tauri/src/
├── tray.rs                    ← NEW: TRAY_ID, top_frecent, last_project, build_menu,
│                                 refresh (main thread), launch, handle_event
├── commands.rs                ← launch_project_default (open_both wraps it);
│                                 get_projects / refresh_projects take AppHandle, refresh the tray;
│                                 live_roots into retain_known
├── lib.rs                     ← mod tray; with_id(TRAY_ID); one handler; lock_path moves, not clones
└── services/
    ├── project_cache.rs       ← all_projects, find, first tests
    └── preferences.rs         ← retain_known(live_paths, live_roots) + test
src/                           ← nothing
```

> **The thread running through Slice 9.** A tray that launches your recent projects without the window — right-click, pick, gone — and does it boot-free, because it reads the cache instead of scanning and ranks with the frecency that was already there. The slice is small because its hard parts were already built: a cache read, a sort you already wrote, and a launch function you already had, three chapters of infrastructure paying out at once. The real work left was deciding what *not* to build alongside it — and, this time, noticing the bug that only a second reader of the same state could expose. **The measure of this slice is that a launcher-grade feature cost almost nothing.**

---

→ Next: [19 — Polish, Themes & Portability](./19-themes-portability.md) (Slice 10), the last scheduled slice: the theme switcher those centralised `@theme` tokens were always for, and export/import that must carry the config and never the machine-local cache.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [17 — Onboarding & Scan Config](./17-onboarding.md)
