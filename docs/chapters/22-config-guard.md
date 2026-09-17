# 22 — The Failures That Said Nothing (post-plan)

**Branch:** `22.config-guard` — `git checkout 22.config-guard` gives you this chapter's finished app; `git diff 21.nested-discovery 22.config-guard` is exactly what this chapter adds.

**Starting from:** chapter 21 — DevGo scans as deep as you ask and every setting has a door. Its three config stores still read their files the way chapter 02 wrote the first one: `serde_json::from_str(&data).unwrap_or_default()`. Its tree still auto-collapses everything but the selected workspace, as chapter 08 decided. And pressing `Delete` with nothing selected opens Settings.

**Goal:** a config file that cannot be parsed goes to `.bak` instead of being overwritten; the tree opens the way you left it, and opens smoothly; workspace removal says what it could not do; and a workspace nested inside another is refused at the door.

> **Hold on to:**
> 1. **A default on parse failure is a data-loss path if anything saves afterwards.** Chapter 02's "start anyway" was right; the missing half was "keep the bytes you could not read". `parse_or_backup` is the missing half, and `let _` on its write is the rule one step further: the guard must not become a new way to refuse to boot.
> 2. **`Ok(())` with nothing done is a lie.** `remove` with a stale index reported a removal that never happened; it is an error with the numbers in it now.
> 3. **Refuse where the situation can still be described.** Two overlapping roots look like broken deletion everywhere except the moment the second one is added.
> 4. **A preference the user set is not derived state.** The collapse set is theirs, saved; search is a view layered on top; and `0fr → 1fr` animates the reveal with nothing measured.
>
> Rust: a generic `T: DeserializeOwned + Default` serving three stores; `Iterator::find` returning the offending entry. TypeScript: a `try`/`Array.isArray` load from `localStorage` (§22.1's rule at the browser end).

> Every item in this chapter is a failure that had no symptom. A corrupt `prefs.json` parsed as empty defaults, and the next save wrote those defaults over the original — pins, hotkey, scan depth, default editor, gone, with no error anywhere. `WorkspaceStore::remove` with a stale index returned `Ok(())` and removed nothing. Two overlapping workspace roots scanned the same folders, so removing either left every project on screen — and the report that came in was *"delete does not work; it takes me to settings"*, which was `Delete` falling through to `openSettings()` when it had nothing to remove. **A failure that says nothing is indistinguishable, from the chair, from a feature that does not exist.** Chapter 06 built one invariant against exactly this — an unavailable workspace must never overwrite what the cache already knows — and this chapter is that rule applied to the three files the app cannot afford to lose, then to a delete key.
>
> No lint gate joins the chapter: the tree has no eslint, and `.gitattributes` has pinned line endings to LF since chapter 02.

---

## 22.1 — `unwrap_or_default` was a data-loss path

Chapter 02 wrote the first store's load and explained it: a launcher that refuses to start because one JSON file got mangled is a bad launcher. True — and incomplete. Chapters 08 and 13 copied the line into `PreferencesStore` and `TargetStore`, and every chapter that added a field put `#[serde(default)]` on it and said why. The book knew the line was dangerous. It guarded the one way it knew a parse could fail — a missing field — and left the others: a truncated write, a stray comma from a hand edit, a file half-written when the machine lost power. Any of those parses as `Default`. The app starts. Then the first `save()` — a pin, a launch that records frecency, the runtime cache on first fetch — writes the default struct over the file that was merely unparseable, and the original is gone.

`src-tauri/src/services/config_io.rs` is the whole fix:

```rust
use std::path::Path;

use serde::de::DeserializeOwned;

// every store used to unwrap_or_default on parse, so a truncated or
// hand-edited file read as empty defaults and the next save wrote those
// over the original. same class of bug as the cache invariant: never
// overwrite what you could not read. a plain write, not a rename, so a
// second corruption still gets a backup; best effort, never a reason not
// to start
pub fn parse_or_backup<T: DeserializeOwned + Default>(
    path: &Path,
    data: &str,
) -> T {
    match serde_json::from_str(data) {
        Ok(value) => value,
        Err(_) => {
            let backup = format!("{}.bak", path.display());
            let _ = std::fs::write(&backup, data);
            T::default()
        }
    }
}
```

and `pub mod config_io;` in `services/mod.rs`. The behaviour the app sees is unchanged: a bad file still yields the default, and DevGo still starts. What changes is that the bad bytes are on disk under a name the next save will not touch. *A plain write* is the deliberate choice over `fs::rename`: a rename fails if a `.bak` already exists, and a guard that fails on the second corruption is a guard for one bad day. `let _ =` on the write is the same reasoning one step further — if even the backup cannot be written, the app must still start. `T: DeserializeOwned + Default` is what lets one function serve three stores with three shapes — `Preferences`, `Vec<LaunchTarget>`, `Vec<String>`.

> `✅CONFIG: parse_or_backup`

Two tests say the two halves:

```rust
    #[test]
    fn corrupt_file_is_backed_up_not_lost() {
        let dir = std::env::temp_dir().join("devgo-config-io-corrupt");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("prefs.json");

        let corrupt = "{ not valid json";
        let value: Vec<String> = parse_or_backup(&path, corrupt);

        assert!(value.is_empty(), "a corrupt file yields the default");
        let backup =
            std::fs::read_to_string(dir.join("prefs.json.bak")).unwrap();
        assert_eq!(backup, corrupt, "the original is in .bak, not lost");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A guard that writes a backup on every start is noise.
    #[test]
    fn valid_file_parses_without_a_backup() {
        let dir = std::env::temp_dir().join("devgo-config-io-valid");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("workspaces.json");

        let value: Vec<String> = parse_or_backup(&path, r#"["a","b"]"#);
        assert_eq!(value, vec!["a".to_string(), "b".to_string()]);
        assert!(!dir.join("workspaces.json.bak").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
```

> `✅TEST: config guard`

Each store's `new` changes by one line — `workspace.rs`, `preferences.rs`, `target_store.rs`:

```rust
            // a corrupt file goes to .bak, not under the next save
            super::config_io::parse_or_backup(&file_path, &data)
```

`project_cache.rs` keeps its `unwrap_or_default`: the cache is the one file that is *supposed* to be rebuilt from nothing, and chapter 19's Reset does exactly that on purpose. (The doc comment on `TargetStore` still says it mirrors `WorkspaceStore` with "`unwrap_or_default()` on parse" — a leftover on this branch; the code under it is the guard.)

> `✅CONFIG: three stores back up`

From here on, every `#[serde(default)]` in the book carries a second meaning. Before, a missing default cost the user their settings. Now it costs them a `.bak` they have to notice. Better than gone. Still a bug.

---

## 22.2 — Removal stops failing silently

*"Delete does not work; it takes me to settings."* The removal path was sound. What was broken was four places where it could refuse and said nothing.

**The overlap.** This is the one behind the report. `add()` refused only exact duplicates — chapter 02's normalised comparison — so a root nested inside another was accepted. Both then scanned the same folders, every project under the overlap was listed twice, and removing either root changed nothing visible. Two errors in `error.rs`:

```rust
    #[error("Workspace {0} no longer exists — the list has {1} entries. Refresh and try again")]
    WorkspaceIndexOutOfRange(usize, usize),

    #[error("{0} overlaps the workspace {1}. Nested workspaces scan the same folders twice, so remove one before adding the other")]
    WorkspaceOverlaps(String, String),
```

and in `workspace.rs`, `add` learns to refuse:

```rust
    /// An exact duplicate is a no-op. A nested one is refused: two roots
    /// where one contains the other scan the same folders, every project
    /// under the overlap shows twice and survives removing either root,
    /// and that looks exactly like delete being broken. Here is the only
    /// place it can still be described.
    pub fn add(&mut self, path: &str) -> Result<(), AppError> {
        let candidate = super::platform::paths::normalize(path);

        if self
            .workspaces
            .iter()
            .any(|w| super::platform::paths::normalize(w) == candidate)
        {
            return Ok(());
        }

        if let Some(existing) = self.workspaces.iter().find(|w| {
            let e = super::platform::paths::normalize(w);
            contains(&e, &candidate) || contains(&candidate, &e)
        }) {
            return Err(AppError::WorkspaceOverlaps(
                path.to_string(),
                existing.clone(),
            ));
        }

        self.workspaces.push(path.to_string());
        self.save()?;
        Ok(())
    }
```

with one helper at the bottom of the file whose single character is the point:

```rust
// the separator is the point: without it G:/dev would contain G:/devtools
fn contains(parent: &str, child: &str) -> bool {
    child.starts_with(&format!("{parent}/"))
}
```

Both directions are checked — a child of an existing root and a parent of one — through chapter 15's `paths::normalize`, which is also what makes `G:\dev`, `G:/dev` and `G:\dev\` one entry. It guards new additions only. An overlap that already exists in someone's `workspaces.json` is left for them to remove by hand, because silently deleting a workspace someone added is a worse failure than the one being fixed — §22.1's rule, again.

> `✅WORKSPACE: refuse an overlapping root`

**The store.** `remove` guarded `index < len` and, when the guard failed, returned `Ok(())` with nothing removed — a stale index from a list that changed under a dialog reported a removal that never happened:

```rust
    // Ok with nothing removed was a removal that never happened, reported
    // as done
    pub fn remove(&mut self, index: usize) -> Result<(), AppError> {
        if index >= self.workspaces.len() {
            return Err(AppError::WorkspaceIndexOutOfRange(
                index,
                self.workspaces.len(),
            ));
        }
        self.workspaces.remove(index);
        self.save()?;
        Ok(())
    }
```

> `✅WORKSPACE: a stale index is an error`

Five tests cover the store, the first tests `workspace.rs` has ever had: a stale index is an error and removes nothing; re-adding the same path in three spellings is one entry; a nested root is refused both ways round; `G:\devtools` beside `G:\dev` is not nested (without the separator in `contains`, this pair would be rejected); and a store survives a reload. They are on the branch — the shape is chapter 09's temp-dir stores.

> `✅TEST: workspace store`

**The drop.** Chapter 17's `add_workspace_folders` used `?` inside its loop, and `add` can now refuse. Dropping three folders where the second was nested would have added one and thrown the rest away:

```rust
    // add can refuse now; one refusal must not throw away the rest of the
    // drop. add what can be added, then say what could not
    let mut refused = Vec::new();
    for p in &paths {
        let is_wsl = p.replace('\\', "/").starts_with("//wsl");
        if is_wsl || std::path::Path::new(p).is_dir() {
            if let Err(e) = store.add(p) {
                refused.push(e.to_string());
            }
        }
    }
    if !refused.is_empty() {
        return Err(refused.join("; "));
    }
    Ok(store.list())
```

Chapter 19's import keeps its `let _ = ws.add(w)`, with its comment updated: an import must never abort halfway and leave a half-applied config, so there a refusal is a skip. Same function, two callers, two correct answers, because a drop is interactive and an import is not.

> `✅SCAN: a refused folder keeps the drop`

**The key.** Chapter 11's `Delete` bound "remove the selected project's workspace", and when it could not resolve one it opened Settings — reasonable as a fallback, unreadable as a response. In `App.tsx`:

```tsx
	// a settings window appearing for no stated reason reads as the key
	// being broken
	const handleRemoveShortcut = () => {
		if (!selected) {
			toast('Select a project first — Delete removes its workspace', 'info');
			return;
		}
		const idx = workspaces.indexOf(selected.workspace);
		if (idx < 0) {
			toast(
				`Can't find the workspace for ${selected.name} — open Settings to remove it`,
				'error'
			);
			return;
		}
		setRemoveIndex(idx);
	};
```

> `✅UI: delete says what it could not do`

---

## 22.3 — One `lastSegment`

Settings listed workspaces as raw `\\wsl.localhost\...` strings while the tree rendered name-over-path, because `lastSegment` was trapped inside `ProjectTree`. It moves to `src/paths.ts` — one concept, one implementation, importable:

```typescript
// the last path segment, either separator, trailing slashes ignored
export const lastSegment = (path: string) =>
	path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
```

`ProjectTree` imports it; `WorkspaceManager` imports it and renders each entry as the name over the path, the way the tree's headers do:

```tsx
							<span className='flex-1 min-w-0'>
								<span className='block text-text-primary truncate'>
									{lastSegment(ws)}
								</span>
								<span className='block text-text-muted truncate'>{ws}</span>
							</span>
```

> `✅UI: one lastSegment`

---

## 22.4 — The tree remembers how you left it

Chapter 08 made the tree collapse every workspace except the selected one whenever the selection changed, and the code doing it had since become derived state recomputed during render — the `derivedKey` block near the top of `ProjectTree`. Persisting manual toggles across sessions is a real behaviour change, and it goes the user's way: the collapse set is theirs, saved, and nothing re-collapses what they opened. Above `pill` in `ProjectTree.tsx`:

```tsx
// the collapse set is the user's, saved; search is a view on top of it
const COLLAPSED_KEY = 'devgo.collapsed';

const loadCollapsed = (): Set<string> => {
	try {
		const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
		return new Set(Array.isArray(raw) ? (raw as string[]) : []);
	} catch {
		return new Set();
	}
};
```

`localStorage`, not `prefs.json`, for the reason chapter 19 gave for the theme: a UI preference with no backend meaning does not need a round trip, and `useState(loadCollapsed)` reads it once, before the first paint. The `try`/`Array.isArray` pair is §22.1's rule at the browser end — a mangled value yields an empty set, never a crash, and there is nothing to back up because there is nothing to lose. Then, in the component:

```tsx
	const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
	const searching = query.trim().length > 0;
	const isCollapsed = (ws: string) => !searching && collapsed.has(ws);
```

Search still expands everything, and the way it does so is the design. The old version cleared the set on search and rebuilt it after; this one never writes to `collapsed` on the user's behalf. `isCollapsed` is a *view* — collapsed-and-not-searching — so clearing the query restores exactly what was saved, not a recomputed approximation of it. Every `collapsed.has(ws)` becomes `isCollapsed(ws)` — the `visible` walk, the `toggleWorkspace` combo, `isOpen` in the render — the one writer, `setCollapsedFor`, gains a `localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))`, and `toggle` becomes a one-liner over it: `setCollapsedFor(ws, !isCollapsed(ws))`. The `derivedKey` block is deleted whole: there is no derived state left to adjust.

> `✅UI: tree remembers how you left it`

---

## 22.5 — Height without measuring it

Smooth expand was left out of the plan as "fiddly (measuring content) for a launcher that values instant over smooth". The refusal was about the mechanism, and there is a mechanism that does not measure. The `{isOpen && …}` conditional around the rows becomes:

```tsx
							{/* 0fr to 1fr animates height with nothing measured; the rows stay
							    mounted and clipped, and `visible` already skips them for the
							    keyboard */}
							<div
								className='grid transition-[grid-template-rows] duration-150 ease-out'
								style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
							>
								<div className='overflow-hidden'>
									{wsProjects
										.filter(p => !pinnedPaths.has(p.full_path))
										.map(project => (
											<ProjectRow
												key={project.full_path}
												{...{ ...rowProps(project), stale: isStale }}
											/>
										))}
								</div>
							</div>
```

A grid row of `0fr` is zero pixels; `1fr` is the content's height; and unlike `height: auto`, `grid-template-rows` interpolates between them. So the rows stay mounted and CSS animates the container. Two consequences, both handled. The rows still exist while collapsed, so `overflow-hidden` on the inner div is what makes them invisible rather than merely short. And a mounted row is not a *navigable* row: `visible` — the flat list chapter 11's arrow keys walk — already skips the children of a collapsed workspace via `isCollapsed`, so the keyboard cannot land on a project that is clipped to zero height. The DOM and the navigation model disagree on what exists, on purpose, and the navigation model is the one the user can reach.

> `✅UI: smooth expand without measuring`

---

## 22.6 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **62** — chapter 21's 55 plus two for the guard and five for the store. Then, with `prefs.json` backed up:

**The guard.** Overwrite `%APPDATA%\app.zetta.devgo\prefs.json` with something that is not JSON — `{ "pinned": ["G:\\projects\\devgo"], not valid` — and `bun tauri dev`. The app starts on defaults; `prefs.json.bak` holds your bytes, exactly; `prefs.json` has been rewritten with the runtime cache from the first fetch. Before this chapter that rewrite was the last anyone saw of the original.

**Delete.** On that same launch nothing is selected (no last project to restore). Click off the search box and press `Delete`: a toast — *Select a project first — Delete removes its workspace* — and no Settings window.

**The overlap.** Drop `G:\projects\devgo` onto the window with `G:\projects` already a workspace (or call `add_workspace_folders` from devtools): *G:\projects\devgo overlaps the workspace G:\projects. Nested workspaces scan the same folders twice, so remove one before adding the other.* Drop `G:\`: the same, the other way round. Drop it together with a fresh scratch folder: the scratch folder is added and the refusal is still reported. `remove_workspace` with index 99: *Workspace 99 no longer exists — the list has 8 entries. Refresh and try again.*

**The tree.** Press `↓` then, with the search box unfocused, `←`: the selected row's workspace collapses and `localStorage.devgo.collapsed` reads `["G:\\projects"]`. Reload the page: it is still collapsed, ▶ where every other workspace is ▼. Type `dev`: every workspace is open, and the saved value has not changed. `Escape`: ▶ again. Watch the click on a header: the rows slide in over 150 ms rather than appearing. Settings → Workspaces: each entry is its name over its path.

Restore `prefs.json` and the rest, and delete the `.bak`, when done.

> `✅STAGE: 22 config-guard`; ff-merge; push.

---

## What you built

```
src-tauri/src/
├── services/
│   ├── config_io.rs           ← NEW: parse_or_backup + 2 tests
│   ├── mod.rs                 ← config_io
│   ├── workspace.rs           ← add refuses an overlap, remove errors on a stale index,
│   │                             contains; first 5 tests
│   ├── preferences.rs         ← parse_or_backup
│   └── target_store.rs        ← parse_or_backup
├── error.rs                   ← WorkspaceIndexOutOfRange, WorkspaceOverlaps
└── commands.rs                ← add_workspace_folders reports what it refused; import skips
src/
├── paths.ts                   ← NEW: lastSegment
├── App.tsx                    ← handleRemoveShortcut toasts instead of opening Settings
└── components/
    ├── ProjectTree.tsx        ← COLLAPSED_KEY, loadCollapsed, isCollapsed; derivedKey deleted;
    │                             0fr → 1fr reveal
    └── WorkspaceManager.tsx   ← name over path
```

> **The thread running through this chapter.** Three config stores that back a corrupt file up before starting fresh, a workspace store that refuses the overlap that made removal look broken and errors on the index that made it lie, a delete key that says why it did nothing, and a tree that opens the way you left it and opens smoothly. **A failure that says nothing is indistinguishable, from the chair, from a feature that does not exist** — and every fix here is the failure learning to speak.

**Next:** chapter 23 (`23-window.md`) — the plan is finished, the launcher is not.
