# 63 — Every Menu, Read Once

**Branch:** `63.menu-audit` — `git checkout 63.menu-audit` gives you this chapter's finished app; `git diff 62.wsl-light 63.menu-audit` is exactly what this chapter adds.

**Starting from:** chapter 62 — the WSL light.

**Goal:** read every menu DevGo has — project row, workspace header, GitHub repo, GitHub group heading, the *Add to group* submenu, server, server folder, dev-script submenu, tray, palette, footer, key table — against three questions: what is here twice, what is missing that a sibling has, and what is here but lies or cannot be reached. Then fix what the reading found — all of it.

> **Hold on to:**
> 1. **Two rows that look alike offer alike.** The workspace header and the GitHub group heading are the same card heading in different hues; a user who learns *Move up* on one expects it on the other.
> 2. **A disabled entry says why.** *Clone into…* (*add a workspace first*) and the footer's tooltip already did; a grey line with no reason reads as broken, not as a refusal.
> 3. **A label is a promise the code has to keep.** *Refresh this workspace* called the global `F5`; rather than rename it, the chapter builds it — `collect_projects(…, only)` reads one workspace and the frontend merges the slice. And a key matched by hand in a handler is a key nobody can see or rebind: `Ctrl+R` becomes a table row.
>
> Rust: the narrowed pass keeps `cache.retain(&all)` above the narrowing — pruning against the one-workspace list would evict every other workspace's cache on the first refresh. The pass may boot (`allow_boot = true`): the ask names the workspace, which is the core rule's definition of explicit, and since the pass reads nothing else it boots nothing else.

**What the reading found**, surface by surface, and where each is fixed:

| # | Finding | Fixed in |
|---|---|---|
| 1 | a `live` row offers *Reattach terminal* but no kill; the only kill is `session.kill` in the palette, with its own inline confirm | 63.5 — `killSession(p)` shared by the row and the palette |
| 2 | the workspace header has no *Move up / down*; the GitHub group heading has had them since 35 (`buildGroupHeaderMenu`; `buildWorkspaceMenu` has three entries) | 63.4 — in the store's flat order: one table, no lanes yet |
| 3 | the palette lacks add / refresh / reveal / move / remove workspace and *Run dev script…*; `settings.workspaces` is the only workspace door | 63.6 |
| 4 | the GitHub group heading cannot add repos to *this* group | 63.5 — `initialGroup` on the picker |
| 5 | *Pin as a top-level group* has no inverse but the Edit… form's roots box; the root heading in `ServersLane` has `onClick` (fold) and no `onContextMenu` | 63.3, 63.5 — a pure `without_root` with two tests |
| 6 | *Refresh this workspace* calls the global `F5` (`onClick: handleRefresh` with the `F5` hint) | 63.1, 63.2, 63.4 |
| 7 | a greyed *Open in Claude Code* says nothing about why | 63.5 — Windows only, no `isMac` branch (55's) |
| — | `Ctrl+R` matched by hand since 11 (`(e.ctrlKey \|\| e.metaKey) && e.key === 'r'` with a comment explaining the alias), absent from the table | 63.6 |
| — | `Ctrl+Shift+D` / `Ctrl+Shift+G` never existed: *Run dev script…* and *Open remote* are menu items with no hint | 63.6 |

A missing workspace is refused with a variant of its own, `WorkspaceNotFound(String)` (*‹path› is no longer in the list*) — not a borrowed `TargetNotFound`, whose text would start *No such editor or terminal*. `remove_server_root` uses 47's `ServerNotFound`.

---

## 63.1 — Collect one workspace only

`error.rs`, after `WorkspaceOrderMismatch`:

```rust
    // a refresh asked for one workspace the store no longer lists
    #[error("{0} is no longer in the list")]
    WorkspaceNotFound(String),
```

`commands.rs`, `collect_projects` gains a third parameter. The store's whole list is `all`; the cache is pruned against it *before* the narrowing; then `workspaces` is either the one asked for or all of them:

```rust
fn collect_projects(
    state: &AppState,
    allow_boot: bool,
    only: Option<&str>,
) -> Result<ProjectsPayload, AppError> {
    let all = state.workspace_store.lock().map_err(lock_err)?.list();

    let mut cache = state.cache_store.lock().map_err(lock_err)?;
    // pruned against the whole store, never the narrowed list, or one
    // refresh would evict every other workspace's cache
    cache.retain(&all)?;

    let workspaces: Vec<String> = match only {
        Some(one) => {
            let found: Vec<String> =
                all.iter().filter(|w| w.as_str() == one).cloned().collect();
            if found.is_empty() {
                return Err(AppError::WorkspaceNotFound(one.to_string()));
            }
            found
        }
        None => all,
    };
```

Everything below the match reads `workspaces` as before. `get_projects` and `refresh_projects` pass `None`.

> `✅SCANNER: collect one workspace only`

## 63.2 — The command

```rust
/// Refresh one workspace, the header's own refresh. An explicit ask that
/// names the workspace, so it may boot that one's distro and no other: the
/// pass reads nothing else. The payload carries its projects only.
#[tauri::command]
pub async fn refresh_workspace(
    workspace: String,
    app: tauri::AppHandle,
) -> Result<ProjectsPayload, AppError> {
    let payload = off_main(&app, move |state| {
        collect_projects(state, true, Some(&workspace))
    })
    .await?;
    crate::tray::refresh(&app);
    Ok(payload)
}
```

`off_main` as 46 made every pass; the tray's recents rebuilt after, like the other two.

> `✅COMMANDS: refresh one workspace`

## 63.3 — Unpin a root

`server_folders.rs`, beside `effective_roots`. The store's rule since 48: an empty `roots` list means *the defaults*. So unpinning one of the defaults from a never-edited server has to write the other three out — `retain` on an empty list would be a no-op and the group would stay:

```rust
// the pin's inverse. an empty list means the defaults, so they are
// written out first and the one taken away; otherwise the removal would
// be a no-op on an empty list and the group would stay
pub fn without_root(server: &Server, root: &str) -> Vec<String> {
    let root = root.trim().trim_end_matches('/');
    effective_roots(server)
        .into_iter()
        .filter(|r| r != root)
        .collect()
}
```

Two tests in the file's `tests` — the logic is a pure function, not inline in the command, so it can have them: `unpinning_a_default_keeps_the_other_defaults` (the server fixture with `roots: vec![]`, `without_root(&s, "~/projects")` → `["~", "/var/www", "/srv"]`) and `unpinning_trims_the_way_pinning_did` (`" /etc/nginx/ "` removes `/etc/nginx`; unpinning the last own root leaves an empty list — the defaults again, by the store's own rule).

> `✅SERVERS: unpin a root`

`commands.rs`, after `add_server_root`:

```rust
// the pin's inverse, from the heading's menu. before it the only way
// back was the edit form's roots box
#[tauri::command]
pub fn remove_server_root(
    id: String,
    root: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let mut store = state.servers_store.lock().map_err(lock_err)?;
    let mut server = store
        .get(&id)
        .ok_or_else(|| AppError::ServerNotFound(id.clone()))?;
    server.roots = server_folders::without_root(&server, &root);
    store.update(server)
}
```

> `✅COMMANDS: remove server root`

`lib.rs`: `commands::refresh_workspace` after `refresh_projects`, `commands::remove_server_root` after `add_server_root`. `cargo check` 0 warnings, `cargo test` **194**.

> `✅APP: register the two commands`

## 63.4 — Types, the table, the hook

`types.d.ts`: `ShortcutId` gains `'refreshAlt'` after `'refresh'` and `'runScript'`, `'openRemote'` after `'togglePin'`; a `RootMenu { server, root, x, y }` beside `FolderMenu`; `ClonePickerProps.initialGroup?: string`; `onRootContextMenu(server, root, x, y)` on `ServersLaneProps` (required, as its sibling `onFolderContextMenu` is) and optional on `ProjectTreeProps`. The required prop makes this commit not type-check until 63.5's lane commit — the granular rule over a green intermediate.

> `✅TYPES: three shortcut ids and the root menu`

`shortcuts.ts`, three rows:

```ts
	{ id: 'refresh', keys: 'F5', label: 'Refresh projects', group: 'Global' },
	// the browser's habit. matched by hand in the key handler since 11, so
	// settings never listed it: a key not in the table is a key nobody sees
	{
		id: 'refreshAlt',
		keys: 'Ctrl+R',
		label: 'Refresh projects (browser habit)',
		group: 'Global'
	},
```

and after `togglePin`, group *Project*, `needsSelection`: `runScript` `Ctrl+Shift+D` *Run dev script…*, `openRemote` `Ctrl+Shift+G` *Open remote in browser* — one modifier over from `Ctrl+G`, the GitHub search. The comment above them: *menu-only since 15 and 32 for no reason anyone recorded*.

> `✅SHORTCUTS: ctrl+r, run script, open remote`

`hooks/useProjects.ts`. `loadDetails` gains `merge = false`. The badge maps used to be *replaced* on every pass; a one-workspace pass asks for that workspace's badges only, and replacing would strip every other row's branch and stack:

```ts
	const loadDetails = (list: Project[], merge = false) => {
		if (list.length === 0) return;
		const asked = new Set(list.map(p => p.full_path));
		const kept = <V,>(prev: Map<string, V>) =>
			merge
				? new Map([...prev].filter(([k]) => !asked.has(k)))
				: new Map<string, V>();
```

each `setGit` / `setTech` becomes `prev => new Map([...kept(prev), ...infos.map(i => [i.full_path, i] as const)])`, and `setSessions` keeps the unasked paths the same way. Then, after `refresh`, the one-workspace pass — a plain `async` function (no `useCallback`):

```ts
	const refreshWorkspace = async (ws: string) => {
		const payload = await invoke<ProjectsPayload>('refresh_workspace', {
			workspace: ws
		});
		const state = payload.workspaces.find(s => s.workspace === ws);
		setProjects(prev => [
			...prev.filter(p => p.workspace !== ws),
			...payload.projects
		]);
		setWorkspaceStates(prev =>
			state
				? prev.some(s => s.workspace === ws)
					? prev.map(s => (s.workspace === ws ? state : s))
					: [...prev, state]
				: prev
		);
		const gone = new Set(
			projects.filter(p => p.workspace === ws).map(p => p.full_path)
		);
		setRanks(prev => {
			const next = new Map([...prev].filter(([k]) => !gone.has(k)));
			for (const r of payload.ranks) next.set(r.full_path, r);
			return next;
		});
		for (const p of payload.projects) badgedPaths.current.add(p.full_path);
		loadDetails(payload.projects, true);
		return payload;
	};
```

Not in flight and no spinner: the list stays on screen and the header's count and pill are what change. Exported beside `refresh`.

> `✅HOOKS: refresh one workspace and merge badges`

## 63.5 — The components

`ClonePicker.tsx`: `initialGroup` destructured, `useState(initialGroup ?? groups[0]?.name ?? '')`.

> `✅UI: group picker opens on a group`

`ServersLane.tsx`: `onRootContextMenu` destructured; the root heading `div` (the one with `onClick={() => toggleRoot(s.id, root)}`) gains

```tsx
							onContextMenu={e => {
								e.preventDefault();
								e.stopPropagation();
								onRootContextMenu(s, root, e.clientX, e.clientY);
							}}
```

`ProjectTree.tsx`: the prop through to the lane, `onRootContextMenu: (s, root, x, y) => onRootContextMenu?.(s, root, x, y)` beside the folder one.

> `✅UI: root heading right-click`

`App.tsx`, the workspace header. `refreshWorkspace` joins the `useProjects` destructure; two helpers after `handleRefresh` — `handleRefreshWorkspace(ws)` (the toast: *‹ws›: N projects* on `live`, *‹ws› is unavailable, showing the cached list* otherwise) and `moveWorkspaceBeside(ws, target, after)`, which builds the store's flat order the way the tree's drag does and sends it through `reorderWorkspaces` (a refusal toasts and re-reads, as the tree's `onReorder` does). `buildWorkspaceMenu` becomes eight entries:

```ts
	const buildWorkspaceMenu = (ws: string): MenuEntry[] => {
		const i = workspaces.indexOf(ws);
		const wsl = ws.replace(/\\/g, '/').startsWith('//wsl');
		return [
			{
				label: 'Refresh this workspace',
				hint: wsl ? 'boots its distro if stopped' : undefined,
				onClick: () => handleRefreshWorkspace(ws)
			},
			{
				label: 'Refresh projects',
				hint: prettyKeys(shortcutFor('refresh')),
				onClick: handleRefresh
			},
			{ label: 'Reveal in Explorer', … },
			'separator',
			{
				label: 'Move up',
				hint: prettyKeys(shortcutFor('moveWorkspaceUp')),
				disabled: i <= 0,
				onClick: () => moveWorkspaceBeside(ws, workspaces[i - 1], false)
			},
			{
				label: 'Move down',
				hint: prettyKeys(shortcutFor('moveWorkspaceDown')),
				disabled: i < 0 || i >= workspaces.length - 1,
				onClick: () => moveWorkspaceBeside(ws, workspaces[i + 1], true)
			},
			'separator',
			{ label: `Remove ${lastSegment(ws)}`, … }
		];
	};
```

*Refresh projects · F5* stays as the everything-pass, now under its honest name. The move steps through the store's order — the one table renders workspaces in that order (31), so no lane test.

> `✅UI: workspace menu refreshes one and moves`

The project row. `killSession(p)` — the palette's inline confirm lifted into one function before `handleOpenRemote`, so the row and the palette say the same words (*Kill session / Kill / Kill the session for ‹name›? Every window in it closes.*). In `buildMenu`: `const live = sessions.has(p.full_path) && tmuxOn;` drives the *Reattach* label and, after the agent entries, `...(live ? [{ label: 'Kill session', danger: true, onClick: () => killSession(p) }] : [])`. The agent entries say why they are grey:

```ts
			...targets.agents.map(t => {
				const missing =
					p.file_system === 'WSL' ? !t.wsl_executable : !t.executable;
				return {
					label: `Open in ${t.name}`,
					hint: missing
						? p.file_system === 'WSL'
							? 'no WSL form'
							: 'not found on Windows'
						: t.id === targets.defaults.agent
							? hint('openAgent')
							: undefined,
					disabled: missing,
					onClick: () => openAgent(p, t.id).catch(e => toast(showError(e)))
				};
			}),
```

*Run dev script…* gets `hint: hint('runScript')`, *Open remote* `hint: hint('openRemote')`; the palette's `session.kill` becomes `run: () => p && killSession(p)`.

> `✅UI: project menu kills and says why`

The GitHub group heading. `groupPicker` goes from `boolean` to `{ group?: string } | null`; the heading's menu opens with *Add repos to ‹name›…* → `setGroupPicker({ group: name })` and a separator; the palette and the card's *Group repos…* pass `{}`; the drawer is `open: groupPicker !== null` and the picker gets `initialGroup: groupPicker.group`.

> `✅UI: group heading adds repos to itself`

The server root heading. `removeRoot(s, root)` beside `addRoot` (the same reload + re-list), `unpinEntry(s, root, label)` shared by two menus (the hint *its folders stay on the server*), `rootMenu` state + `buildRootMenu(s, root)` — *Unpin ‹root› from top level*, *List another folder at top level…* (52's `setRootPrompt`), separator, *Copy path*; the folder row's *Pin as a top-level group* becomes a conditional: `s.roots.includes(f.path) ? unpinEntry(s, f.path, 'Unpin from top level') : { … pin … }`. The `ContextMenu` for `rootMenu` after the folder one; `onRootContextMenu: (s, root, x, y) => setRootMenu({ server: s, root, x, y })` on the tree.

> `✅UI: root heading menu unpins`

## 63.6 — The palette and the keys

`buildCommands`, after `sort`: seven entries — *Add workspace… · Ctrl+N* (`pickWorkspaceFolder`), *Refresh workspace ‹ws›* (`handleRefreshWorkspace`), *Reveal workspace ‹ws› in Explorer · Ctrl+Alt+E*, the two moves mapped from `[-1, 1] as const` (one object, the direction decides the id, title, hint and neighbour), *Remove workspace ‹ws› · Del* (`handleRemoveShortcut` — the same function the key runs, with its two toasts), *Run dev script… · Ctrl+Shift+D* (`openScripts(p, 240, 200)`: the palette has closed and there is no click to anchor to, so the script menu takes the row menu's fallback spot). The `openRemote` entry gains `hint: hint('openRemote')`. Every one `disabled: !p` with *Select a project first* as its subtitle, the palette's rule since 16.

> `✅UI: palette lists the workspace actions`

The key handler. The hand-matched block goes:

```ts
			// the browser's refresh key, a table row like every other: matched
			// by hand here since 11, so settings › shortcuts never listed it
			if (fire('refreshAlt', handleRefresh)) return;
```

and in the needs-a-selection block, after `copyWslPath`:

```ts
			if (fire('runScript', () => openScripts(selected, 240, 200))) return;
			if (
				fire('openRemote', () => {
					if (git.get(selected.full_path)?.remote) handleOpenRemote(selected);
					else toast(`${selected.name} has no remote to open`, 'info');
				})
			)
				return;
```

`git` joins the effect's deps. `tsc -b` and `bun run build` clean.

> `✅UI: ctrl+r in the table, two new keys`

## 63.7 — Verify

`cargo test` **194** (192 + the two `without_root` tests; the 62 probe ignored), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. One dev launch, the fourteen files under 61's backup, WSL running (not by us) and left alone.

- **The workspace header** (`G:\01_tauri`): *Refresh this workspace*, *Refresh projects · F5*, *Reveal in Explorer · Ctrl+Alt+E*, —, *Move up · Alt+↑*, *Move down · Alt+↓*, —, *Remove 01_tauri · Del*. The `02_next` header (WSL) reads the same with **`Refresh this workspace · boots its distro if stopped`**.
- **The per-workspace refresh, for real:** `invoke('refresh_workspace', { workspace: 'G:\\01_tauri' })` → `workspaces: [{ workspace: 'G:\\01_tauri', status: 'live', count: 17, scanned_at: … }]`, `projects: 17`, `ranks: 17` — one state, one slice. From the menu: toast **`01_tauri: 17 projects`**; before and after, **53 rows, 45 with a branch, 01_turbo 6 · 02_next 13 · Dev 6 · 03_mobile 2 · 01_tauri 17 · 03_ai 5 · 04_dev 4** — no other row went bare, no header changed. A missing workspace: `refresh_workspace('G:\\nope')` → **`G:\nope is no longer in the list`**. The WSL headers' refresh not clicked: the distro is up, so *boots its distro* is not provable this run either way.
- **Move up / down:** on `01_turbo` (first) *Move up* is disabled; *Move down* → `get_workspaces` reads `02_next, 01_turbo, Dev, …` and the headers re-order with it; *Move up* on it → `01_turbo, 02_next, …`; `workspaces.json` hash-equal to the backup after.
- **Kill session on a live row:** a hand-made `psmux.exe new-session -d -s app-16b05c66` (44's name, recomputed: FNV-1a over the lowercased, slash-flipped path); `F5`; the row shows `live`. ⚠️ With tmux off in the prefs (`tmux_config.enabled: false`) the menu read *Open terminal* and no kill — `live` is `sessions.has(…) && tmuxOn` (44's rule: off, a launch is a plain shell). `set_tmux_config({ enabled: true })` + Settings open/close (the re-read), then the menu: *Open in editor*, **`Reattach terminal · Shift+⏎`**, *Open both*, *Open in Claude Code · Ctrl+Alt+⏎*, **`Open in Claude Code (Ubuntu-26.04) · not found on Windows`** (disabled), **`Kill session`** in the danger colour `rgb(251, 113, 133)`, —, …, **`Open remote · Ctrl+Shift+G`**, —, **`Run dev script… · Ctrl+Shift+D`**, —, *Pin to top · Ctrl+S*. *Kill session* → the sheet *Kill session — Kill the session for app? Every window in it closes.* with *Cancel / Kill*; *Kill* → toast **`Session for app killed`**, the chip gone from the row, `psmux.exe list-sessions` empty; the `__warm__` server stopped by hand (`psmux.exe kill-server`, 0 `psmux` processes after). `prefs.json` restored by hash.
- **The group heading** (`FREQUENT`): **`Add repos to FREQUENT…`**, —, *Rename…*, *Move up* (disabled), *Move down*, —, *Delete group FREQUENT*. Clicked: the *Group repos* drawer with 382 repos and the name box (`list="devgo-group-names"`) already reading **`FREQUENT`**. Escape.
- **The root heading** (`/etc` on `box`, 116 folders): **`Unpin /etc from top level · its folders stay on the server`**, *List another folder at top level…*, —, *Copy path*. *Unpin* → toast *`/etc is no longer a top-level group on box`*, `get_servers` reads `box: ["~","~/projects","/var/www","/srv"]`, the re-listing (one ssh) paints six headings where there were seven. The never-edited case over the command: `remove_server_root('lanbox', '~/projects')` on `roots: []` → **`["~","/var/www","/srv"]`** — the defaults written out minus one, as the test says. `/etc` put back with `add_server_root`; a missing server → *No such server: nope*. `servers.json` and `servers-cache.json` restored by hash.
- **The palette** (`app` selected, 58 entries): *Add workspace… · Ctrl+N*, *Refresh workspace 01_tauri — This one only, boots its distro if stopped*, *Reveal workspace 01_tauri in Explorer — G:\01_tauri · Ctrl+Alt+E*, *Move workspace 01_tauri up · Alt+↑*, *… down · Alt+↓*, *Remove workspace 01_tauri — Asks first; the folder is untouched · Del*, *Run dev script… — app, reads its package.json · Ctrl+Shift+D*, *Open remote in browser — app · Ctrl+Shift+G*.
- **The keys**, after `location.reload()` (58's trap) and a capture-phase recorder that reads `defaultPrevented` in a `setTimeout(0)` — ⚠️ a bubble-phase recorder added *after* the app's handler reads `false` once `selected` changes, because the effect re-registers its listener behind yours: `Ctrl+R` → `prevented=true` and a full pass (86 `git` + 10 `wsl` processes sampled over 6 s); `devgo` selected, `Ctrl+Shift+D` → `prevented=true` and the script menu at **(240, 200)** with `build · bun run build`, `check:contrast`, `dev`, `preview`, `tauri`; `blog` (no remote) selected, `Ctrl+Shift+G` → `prevented=true` and the toast **`blog has no remote to open`**. Not pressed with a remote (a browser tab); the URL path is 32's test. Settings › Shortcuts lists **`Refresh projects (browser habit) Ctrl+R`**, *Run dev script… · needs a selection Ctrl+Shift+D*, *Open remote in browser · needs a selection Ctrl+Shift+G*.
- *Run dev script…* and *Open remote* never launched — a `wt` tab cannot be closed without touching the terminal this run uses; a URL opens a tab a script cannot close.

The dev build stopped (port 1420 checked free), all fourteen files restored — `sha256sum -c`: **14 OK, 0 mismatches** — the installed DevGo relaunched through `explorer.exe` (`Win32_Process` parent: `explorer`).

> `✅STAGE: 63 menu-audit`; ff-merge; push.

---

## What you built

```
src-tauri/src/error.rs                    WorkspaceNotFound
src-tauri/src/commands.rs                 collect_projects(…, only); refresh_workspace; remove_server_root
src-tauri/src/services/server_folders.rs  without_root + 2 tests
src-tauri/src/lib.rs                      the two registrations
src/types.d.ts                            refreshAlt / runScript / openRemote; RootMenu; initialGroup; onRootContextMenu
src/shortcuts.ts                          Ctrl+R, Ctrl+Shift+D, Ctrl+Shift+G
src/hooks/useProjects.ts                  loadDetails(list, merge); refreshWorkspace
src/components/ClonePicker.tsx            initialGroup
src/components/ServersLane.tsx            the root heading's right-click
src/components/ProjectTree.tsx            the prop through
src/App.tsx                               killSession; the four menus; the palette's seven; the key handler
```

- **A per-workspace refresh** that reads one workspace, boots only its distro, and leaves the others as they were.
- **Menus that match their siblings** — the two card headings offer alike; a `live` row can end its session; a top-level group can be unpinned where it was pinned.
- **A palette that keeps its promise** — the workspace actions and the dev-script runner are in it.
- **Grey lines with reasons, and a key table with no hidden rows.**
