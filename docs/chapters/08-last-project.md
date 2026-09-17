# 08 — Remembering Between Launches (Phase 6)

**Branch:** `08.last-project` — `git checkout 08.last-project` gives you this chapter's finished app; `git diff 07.single-instance 08.last-project` is exactly what this chapter adds.

**Starting from:** chapter 07 — a resident launcher: hidden until painted, in the tray, one instance. Every launch still opens with nothing selected and every tree fully expanded, and every launch still spawns `wsl.exe` twice to ask a question whose answer changed roughly never.

**Goal:** a preferences file, and the two things that go in it first — the project you had selected, restored on the next launch with its workspace open and the others folded; and the WSL runtime answer, so that startup reads it off disk and shells out to nothing.

> **Hold on to:**
> 1. **The third store is the same shape as the first two** — load, hold, save-on-mutation. `#[derive(Default)]` + `unwrap_or_default()` is how a missing or corrupt file becomes "empty preferences" instead of "refuse to launch".
> 2. **`Option<(&str, &str)>` — returning borrowed views of owned fields.** `get_last_project` hands out borrowed views into the struct; the caller copies what it needs. No allocation for a read.
> 3. **A wrapper that keeps the old name** — `setSelected: selectAndSave` in the hook's return means every existing caller persists selection without changing a line.
> 4. **"Adjust state while rendering"** — derived state recomputed during render, one paint instead of two. The pattern React's docs recommend over a `useEffect` that calls a setter.

> Two things should survive a restart: the project you were working on, and the answer to "is WSL installed and what's the default distro". They exist for the same reason chapter 06's cache does — **a tray launcher is started constantly, and the work it repeats on every launch is the work you notice.** Chapter 06 stopped DevGo booting a VM to draw a list; this chapter stops it running two processes to draw a badge, and lands you on the project you left.

---

## 8.1 — PreferencesStore

They live in one JSON file next to `workspaces.json` and `projects-cache.json`: `prefs.json`, for small, user-ish settings. Create `src-tauri/src/services/preferences.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::platform::RuntimeInfo;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Preferences {
    pub last_project_path: Option<String>,
    pub last_workspace: Option<String>,
    /// Startup reads this instead of shelling out to wsl.exe. Detection calls
    /// `wsl -l -q` and `wsl -l -v`, which hit WSLService — the service whose
    /// timeouts this work exists to stop provoking.
    pub cached_runtime: Option<RuntimeInfo>,
}

pub struct PreferencesStore {
    prefs: Preferences,
    file_path: PathBuf,
}

impl PreferencesStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        let file_path = app_data_dir.join("prefs.json");
        let prefs = if file_path.exists() {
            let data = fs::read_to_string(&file_path)
                .map_err(|e| format!("Failed to read prefs: {e}"))?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Preferences::default()
        };
        Ok(Self { prefs, file_path })
    }

    pub fn get_last_project(&self) -> Option<(&str, &str)> {
        match (&self.prefs.last_project_path, &self.prefs.last_workspace) {
            (Some(path), Some(ws)) => Some((path.as_str(), ws.as_str())),
            _ => None,
        }
    }

    pub fn set_last_project(
        &mut self,
        path: String,
        workspace: String,
    ) -> Result<(), String> {
        self.prefs.last_project_path = Some(path);
        self.prefs.last_workspace = Some(workspace);
        self.save()
    }

    pub fn get_cached_runtime(&self) -> Option<RuntimeInfo> {
        self.prefs.cached_runtime.clone()
    }

    pub fn set_cached_runtime(
        &mut self,
        info: RuntimeInfo,
    ) -> Result<(), String> {
        self.prefs.cached_runtime = Some(info);
        self.save()
    }

    fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&self.prefs)
            .map_err(|e| format!("Failed to serialize prefs: {e}"))?;
        fs::write(&self.file_path, json)
            .map_err(|e| format!("Failed to write prefs: {e}"))?;
        Ok(())
    }
}
```

Register in `src-tauri/src/services/mod.rs` — the file in full:

```rust
pub mod launcher;
pub mod platform;
pub mod preferences;
pub mod project_cache;
pub mod scanner;
pub mod single_instance;
pub mod workspace;

pub use preferences::PreferencesStore;
pub use project_cache::ProjectCacheStore;
pub use scanner::scan_workspace;
pub use workspace::WorkspaceStore;
```

> **Why a separate `prefs.json`, not part of `workspaces.json`?** Separation of concerns. Workspaces are user-managed data; preferences are automatic app state. Mixing them would couple the two schemas. And we key the project by `full_path` (its unique identity) plus `workspace`, so we can gracefully skip it if the project no longer exists on relaunch.

### Same shape as the other two stores, with one difference

Load at startup, hold in memory, write on mutation — the third time you have seen this. `#[derive(Default)]` on `Preferences` plus `unwrap_or_default()` means a missing or unreadable file is an empty set of preferences, never a refusal to launch. The difference is the error type: `Result<_, String>`, not `AppError`, because nothing about preferences is worth a variant — a failed write is a message, not a category. Every later chapter that adds a setting adds a field to `Preferences` and a getter/setter pair here, and chapter 22 hardens `new` against a corrupt file.

One consequence of `save` writing the whole struct: a `prefs.json` written by a *newer* DevGo, with fields this version does not know, comes back out with only the fields it does. serde ignores unknown fields on the way in and cannot invent them on the way out. That is fine for a reader building forward; it is why chapter 22 exists for anyone running two versions side by side.

### `cached_runtime` — the promise from chapter 04 *(skip on first pass)*

Chapter 04 detected `RuntimeInfo` once per launch and stored it in `AppState`; chapter 06 put it behind a `Mutex` so Refresh could replace it. "Once per launch" sounded frugal at the time. For a tray app it isn't: every launch still pays two `wsl.exe` round trips, and every one of those goes through WSLService, which is precisely the component that hangs for tens of seconds when it is unhappy. Detection is also the *least* volatile thing DevGo knows — you install a distro roughly never.

So we persist it. Startup reads `cached_runtime` off disk; detection runs on first-ever launch and on an explicit Refresh, and nowhere else. `RuntimeInfo` already derives `Serialize + Deserialize` (chapter 04), so it drops into `Preferences` with no extra work.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: PreferencesStore (last project + cached runtime)"
> git push
> ```

---

## 8.2 — Commands + state

`AppState` reaches its final shape for this part of the book — three stores, the cached runtime, and the lock path. In `src-tauri/src/commands.rs`, one import next to `ProjectCacheStore`'s:

```rust
use crate::services::PreferencesStore;
```

```rust
pub struct AppState {
    pub workspace_store: Mutex<WorkspaceStore>,
    pub pref_store: Mutex<PreferencesStore>,
    pub cache_store: Mutex<ProjectCacheStore>,
    pub runtime_info: Mutex<RuntimeInfo>,
    pub lock_path: std::path::PathBuf,
}
```

The last-project commands, at the bottom of the file:

```rust
#[derive(serde::Serialize, serde::Deserialize)]
pub struct LastProject {
    pub full_path: String,
    pub workspace: String,
}

#[tauri::command]
pub fn get_last_project(
    state: State<AppState>,
) -> Result<Option<LastProject>, String> {
    let prefs = state.pref_store.lock().map_err(|e| e.to_string())?;
    Ok(prefs.get_last_project().map(|(path, ws)| LastProject {
        full_path: path.to_string(),
        workspace: ws.to_string(),
    }))
}

#[tauri::command]
pub fn set_last_project(
    state: State<AppState>,
    project: LastProject,
) -> Result<(), String> {
    let mut prefs = state.pref_store.lock().map_err(|e| e.to_string())?;
    prefs.set_last_project(project.full_path, project.workspace)
}
```

`LastProject` is two strings, not a `Project`: the frontend sends only what the store keeps, and `get_last_project` returns `Option` — `null` on the wire — for a first launch.

### Refresh writes the fresh answer back

Chapter 06's `refresh_projects` re-probed WSL and replaced the value in `AppState`. Now it also writes it to disk, so the next twenty launches read it from there — replace the `if force` block:

```rust
    if force {
        let fresh = crate::services::platform::detection::detect_runtime();
        *state.runtime_info.lock().map_err(lock_err)? = fresh.clone();
        state
            .pref_store
            .lock()
            .map_err(lock_err)?
            .set_cached_runtime(fresh)
            .map_err(AppError::Lock)?;
    }
```

`fresh.clone()` goes into state and `fresh` itself into the store — one detection, two homes. This is the only place in the app that calls `detect_runtime` after first launch. The two locks are taken one after the other, never nested; each guard is dropped at the end of its own statement.

### Wire into `lib.rs`

Three things change in `setup`: the preferences store is built first (it is the source of the cached runtime), detection only runs when that cache is empty, and the new store goes into `AppState`. Chapter 04's `let runtime_info = detection::detect_runtime();` at the top of `run()` is deleted — the value is now computed inside `setup`, where `pref_store` exists. Insert this before the cache store:

```rust
            let mut pref_store =
                services::PreferencesStore::new(app_data_dir.clone())
                    .expect("failed to initialize preferences store");

            // Startup must not shell out to wsl.exe. Detection runs only on the
            // first ever launch, or when the user explicitly refreshes.
            let runtime_info = match pref_store.get_cached_runtime() {
                Some(cached) => cached,
                None => {
                    let detected = detection::detect_runtime();
                    let _ = pref_store.set_cached_runtime(detected.clone());
                    detected
                }
            };
```

and the store into state:

```rust
            app.manage(AppState {
                workspace_store: std::sync::Mutex::new(store),
                pref_store: std::sync::Mutex::new(pref_store),
                cache_store: std::sync::Mutex::new(cache_store),
                runtime_info: std::sync::Mutex::new(runtime_info),
                lock_path: lock_path.clone(),
            });
```

`pref_store` is `mut` because the miss branch writes the cache back. Note the `let _ =` on `set_cached_runtime`: if we can't write `prefs.json` we still have a perfectly good `RuntimeInfo` in hand, and refusing to launch over a failed cache write would be absurd.

Finally, two more lines in the `invoke_handler` — the app's whole surface area:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::get_projects,
            commands::refresh_projects,
            commands::quit_app,
            commands::get_runtime_info,
            commands::open_vscode,
            commands::open_terminal,
            commands::open_both,
            commands::get_last_project,
            commands::set_last_project,
        ])
```

Twelve commands.

> **Commit checkpoints** — two related but separable pieces of work, and the split is by file, not by the order the text presented them: the first commit is `lib.rs` alone (the store built in `setup`, the cached-runtime read, the two new handler entries), the second is `commands.rs` alone (`AppState`'s new field, `LastProject`, the two commands, the write-back in `refresh_projects`). Stage each file on its own:
>
> ```powershell
> git add src-tauri/src/lib.rs && git commit -m "✅RUST: read runtime detection from prefs, re-probe only on refresh" && git push
> git add -A && git commit -m "✅RUST: get/set_last_project; refresh writes the fresh runtime back to prefs" && git push
> ```

---

## 8.3 — Frontend: restore on load, save on select

The wire type first — `src/types.d.ts`, under `ProjectsPayload`:

```ts
interface LastProject {
	full_path: string;
	workspace: string;
}
```

Then `src/hooks/useProjects.ts`. The mount effect — `refresh()` since chapter 03 — becomes a first-launch restore, and a wrapper around `setSelected` persists every selection:

```ts
	// First-launch restore: scan, then re-select the project saved last time if
	// it still exists. Runs exactly once — re-running it after a rescan would
	// steal the selection the user just made.
	useEffect(() => {
		refresh()
			.then(payload =>
				invoke<LastProject | null>('get_last_project')
					.then(last => {
						if (!last) return;
						const match = payload.projects.find(
							p => p.full_path === last.full_path
						);
						if (match) setSelected(match);
					})
					.catch(() => {})
			)
			.catch(() => {});
	}, []);

	// Every selection is persisted, so the next launch can land on it.
	const selectAndSave = (proj: Project | null) => {
		setSelected(proj);
		if (proj) {
			invoke('set_last_project', {
				project: { full_path: proj.full_path, workspace: proj.workspace }
			}).catch(() => {});
		}
	};
```

and in the return, one line changes:

```ts
		setSelected: selectAndSave,
```

We return `setSelected: selectAndSave`, so every caller that selects a project also persists it — no component code changes. `App`'s `handleSelect` and `handleLaunch` were written against the name `setSelected`, and they still are. On mount we scan, then look up the saved project by `full_path` and select it if it still exists — this is why chapter 03's `refresh` returned what it fetched, and why chapter 06's `apply` kept doing so.

The mount effect has empty deps on purpose, and the comment says why. This one is a *first-launch* restore: it must run exactly once. Re-running it would re-select the saved project after every rescan, quietly stealing the selection the user just made.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅REACT: persist + restore last selected project"
> git push
> ```

---

## 8.4 — Auto-collapse workspaces

With last-project restore working, one more nicety: when a project is selected (and you're not searching), collapse every workspace *except* the one containing it — so relaunching lands you on your project with a tidy tree instead of everything expanded. And while a search is active, expand everything, so matches aren't hidden inside a collapsed group.

The tree needs to know about the query for that. Chapter 03 left `query` off `ProjectTreeProps` because nothing in the tree read it; this is the first reader, so it goes on now — `src/types.d.ts`:

```ts
interface ProjectTreeProps {
	projects: Project[];
	selected: Project | null;
	onSelect: (p: Project) => void;
	onDoubleClick: (p: Project) => void;
	onLaunch: (p: Project) => void;
	query: string;
	loading?: boolean;
	workspaceStates?: WorkspaceState[];
	ref?: React.Ref<ProjectTreeHandle>;
}
```

`App` passes `query` in the tree's spread, next to `onLaunch`. Then, in `src/components/ProjectTree.tsx`, destructure `query` with the other props and add after `useImperativeHandle`:

```tsx
	// Searching expands everything; otherwise only the selected workspace stays
	// open. Both were effects that called setCollapsed synchronously, which
	// cascades an extra render on every keystroke. This is React's documented
	// "adjust state while rendering" pattern instead: recompute the moment the
	// inputs actually change, and leave manual toggles alone in between.
	const derivedKey = `${query.trim() ? 'search' : 'browse'}|${
		selected?.workspace ?? ''
	}|${[...grouped.keys()].join('')}`;
	const [lastKey, setLastKey] = useState(derivedKey);
	if (derivedKey !== lastKey) {
		setLastKey(derivedKey);
		setCollapsed(() => {
			if (query.trim()) return new Set<string>();
			const next = new Set<string>();
			for (const [ws] of grouped) {
				if (ws !== selected?.workspace) next.add(ws);
			}
			return next;
		});
	}
```

### Adjusting state while rendering

The obvious shape is two `useEffect`s — one watching `query`, one watching `selected` — each calling `setCollapsed`. It works, and it costs a render: the component paints with the old collapse set, the effect fires, state changes, it paints again. On every keystroke in the search box.

The pattern above is the one React's own docs recommend for state that is *derived from* props and other state. `derivedKey` is a string that changes exactly when the answer would change — search mode, the selected project's workspace, the set of workspaces. When it differs from the one we last saw, we update both pieces of state *during* render; React discards the in-progress render and immediately re-runs the component with the new state, before anything is painted. One paint, not two. (The React Compiler understands this pattern; it is not memoization, it is state.)

And it leaves manual toggles alone in between: click a header to fold it and nothing recomputes until the query or the selection actually moves. The two effects would have re-imposed their answer on the next unrelated render.

```
Search active   → expand all (matches can live anywhere)
No search       → collapse all except selected's workspace
Neither changed → whatever you clicked stays
```

This is why `Project` carries the `workspace` field — the tree needs it to know which group to keep open. Select a project in workspace A → only A expands; select one in B → B expands, A collapses. Launch DevGo tomorrow, and the tree opens on yesterday's project with everything else folded.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅UI: auto-collapse workspaces except selected, expand all while searching"
> git push
> ```

---

## 8.5 — Verify

```powershell
bun tauri dev
```

- ✅ Last selected project is restored on relaunch, its workspace auto-expanded, the others folded; type in the search box and every workspace opens; clear it and the tree folds back to the selected one
- ✅ `prefs.json` holds `cached_runtime`; delete that key, launch, and it is back — that launch was the one that ran `wsl.exe`
- ✅ `wsl --shutdown`, then launch DevGo → the WSL workspace shows `cached · WSL stopped`, and `wsl -l -v` still says **Stopped**. DevGo did not boot it — and did not run `wsl.exe` at all, because the runtime came from `prefs.json`. Hit **Refresh** and it does both.
- ✅ Everything from chapters 05–07 still holds: launch, tray, single instance, Ctrl+Q

> **Commit checkpoint** — the first part of the book is finished. Stage commit, then merge the chapter into `main`:
>
> ```powershell
> git add -A
> git commit -m "✅STAGE: 08 last-project"
> git push
> git checkout main
> git merge 08.last-project
> git push
> ```

---

## What you built

```
src/
├── types.d.ts               ← every wire type and every component's props
├── App.tsx                  ← ToastProvider → AppInner, showError, keyboard + modal wiring, show on mount
├── hooks/
│   ├── useWorkspaces.ts      ← workspace CRUD (string[])
│   ├── useProjects.ts        ← scan + search + select + restore + bounded retry
│   ├── useRuntime.ts         ← the badge's data
│   └── useLaunchActions.ts   ← the action row's verbs
└── components/
    ├── Button.tsx             ├── ProjectTree.tsx    (grouped, collapsible, keyboard, auto-collapse)
    ├── TitleBar.tsx           ├── ActionButtons.tsx
    ├── TitleBarButton.tsx     ├── WorkspaceManager.tsx (folder picker)
    ├── RuntimeIndicator.tsx   ├── Toast.tsx
    └── SearchBox.tsx          └── ConfirmDialog.tsx
src-tauri/src/
├── lib.rs                   ← builder, tray, single-instance, state, 12 commands
├── commands.rs  error.rs
├── models/project.rs
└── services/
    ├── workspace.rs  scanner.rs  launcher.rs  preferences.rs
    ├── project_cache.rs  single_instance.rs
    └── platform/ runtime.rs  wsl.rs  paths.rs  detection.rs
```

> **The thread running through chapters 06–08.** The cache, the liveness gate, the bounded retry, the runtime cache — four pieces of work that are one idea seen from four sides: *a launcher must be cheap to launch, and honest when it can't be complete.* Every decision followed from refusing to let DevGo do expensive things on its own initiative, and from refusing to let a temporary absence look like a permanent one. Chapter 06 wrote the rule; chapter 07 made DevGo resident, which is what makes the rule matter; this chapter is the last of the startup cost paid down.

> **A note on keyboard shortcuts.** Right now the keyboard surface is deliberately small — arrows + Enter in the list, F5 and Ctrl+Q, and the `SearchBox`. A global summon hotkey, a full command palette and single-key project actions are the subject of the launcher's Phase 2, which begins next.

---

→ Next: [09 — Launcher-Grade Access](./09-summon-rank.md) — Part 2 begins: a global summon hotkey, frecency ranking, and pinning.

→ Appendix: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)
