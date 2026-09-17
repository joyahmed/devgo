# 58 — A Workspace's Door

**Branch:** `58.workspace-reveal` — `git checkout 58.workspace-reveal` gives you this chapter's finished app; `git diff 57.docker-null 58.workspace-reveal` is exactly what this chapter adds.

**Starting from:** chapter 57 — the servers card reading a container's name.

**Goal:** a *Reveal in Explorer* item on a workspace header can do nothing but toast for thirty chapters if it sends `{ path }` to a command whose signature says `project: Project`: Tauri refuses the call before the body runs, and the fix is a second command and the key the item never had. **This door already takes a path** — `reveal_in_explorer` has been `(path: String)` since chapter 12, and both rows send one — so that bug never existed here and a twin command is not needed. What is real is the key: `Ctrl+Alt+E`, one modifier over from the project's reveal, with the menu hint and the handler reading one table.

> **Hold on to:**
> 1. **`invalid args … missing required key` is a calling-side bug.** Tauri's generated glue deserialises a command's arguments *before* the body runs; the TypeScript side is `invoke(string, Record<string, unknown>)` and nothing checks it at build time. When a toast says that, fix the call or the signature, never the body.
> 2. **A command takes the shape its row has.** A `Project`-typed door needs a twin for a workspace; one that takes a `String` serves both, because a project's `full_path` and a workspace both are one. Do not build a fake `Project` around a path to fit a signature — every field would be a lie the body might one day read.
> 3. **A key that needs a selection says so when there is none** — chapter 31's rule for `Delete`, reused: the workspace is the *selected project's*, and the toast names the rule instead of doing nothing.
>
> TypeScript: the menu hint is `prettyKeys(shortcutFor(id))` — read from the same table the key handler matches against, so the menu can never advertise a key the keyboard does not honour (chapter 12's rule, applied to a workspace item for the first time).

**Shape of the chapter.** The three things a workspace door can need, against this tree:

| Need | This tree | Typed? |
|---|---|---|
| 58.1 `invoke('reveal_in_explorer', { path: ws })` against a `reveal_in_explorer(project: Project)` — refused by Tauri's glue, the item only toasts | `reveal_in_explorer(path: String)` (`commands.rs`), `revealInExplorer` sends `{ path: p.full_path }` and the workspace item `{ path: ws }` — both the shape the command wants. The item has worked since 25. | no — already true |
| 58.2 a `reveal_workspace(path: String)` beside the `Project` door, registered in `lib.rs`; a `revealWorkspace` callback the menu calls | one command serves both rows because it takes the bare path. What the key needs is a *named* function for the workspace (the menu had the `invoke` inline), so `revealWorkspace(ws)` is typed — a plain function, React 19 way, no `useCallback`. | **partly — the named function (58.1 below)** |
| 58.3 `revealWorkspace` `Ctrl+Alt+E`, group *Workspace*, `needsSelection`, `macLabel`; the menu hint; the handler with the *Select a project first* toast | none of it existed: the workspace item had no hint and the table had no id. 55 adds `macLabel`. | **yes (58.1 below)** |

---

## 58.1 — The key, one modifier over

`types.d.ts`, the `ShortcutId` union gains `'revealWorkspace'` between `'removeWorkspace'` and `'moveWorkspaceUp'` — the table's order is the Settings › Shortcuts order.

> `✅TYPES: reveal workspace shortcut id`

`shortcuts.ts`, after `removeWorkspace`:

```ts
// ctrl+shift+e reveals the project; its workspace is one modifier over
{
	id: 'revealWorkspace',
	keys: 'Ctrl+Alt+E',
	label: 'Reveal workspace in Explorer',
	group: 'Workspace',
	needsSelection: true
},
```

`group: 'Workspace'` puts it beside *Add*, *Remove* and *Move* in Settings; `needsSelection` is what prints *· needs a selection* there. No `macLabel`: 55 adds the field.

> `✅SHORTCUTS: ctrl+alt+e reveals the workspace`

`App.tsx`, three places. The function, beside `revealInExplorer`:

```ts
// a workspace is a bare path; the same door takes it
const revealWorkspace = (ws: string) => {
	invoke('reveal_in_explorer', { path: ws }).catch(e => toast(showError(e)));
};
```

The item in `buildWorkspaceMenu` — the same call it always made, now through the function and with the hint:

```ts
{
	label: 'Reveal in Explorer',
	hint: prettyKeys(shortcutFor('revealWorkspace')),
	onClick: () => revealWorkspace(ws)
},
```

And the handler, in the block of keys that work with nothing selected (it has to run before `if (!selected) return;` to be able to say why it did nothing):

```ts
// same rule as delete: the workspace is the selected project's, and
// the key says so when there is none
if (
	fire('revealWorkspace', () => {
		if (!selected) {
			toast('Select a project first — the key reveals its workspace', 'info');
			return;
		}
		revealWorkspace(selected.workspace);
	})
)
	return;
```

No test: the change is a table row and a handler, and the one thing that could be wrong — the key not matching — is proved by pressing it.

> `✅UI: reveal workspace key and menu hint`

## 58.2 — Verify

`cargo test` **187** (unchanged, no Rust in this chapter), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. The dev build from 57 was still up (React only here, so Vite HMR carried every edit into the running window); the same fourteen files under the same backup.

Over CDP: right-click on the `G:\01_tauri` header (`[data-ws-header]`) → the menu's three rows read `Refresh this workspace · F5`, **`Reveal in Explorer · Ctrl+Alt+E`**, `Remove 01_tauri · Del`. ⚠️ The key itself did not fire until the page was reloaded — `Delete` still worked, but `Ctrl+Alt+E` reached `window` with `defaultPrevented: false`: the `useEffect` that owns the handler has `[selected, workspaces]` as deps, and Fast Refresh re-rendered `App` without re-running it, so the live listener was the old closure with the old table. `location.reload()` over CDP, then: `keydown e ctrl alt` → `defaultPrevented: true`, and `Shell.Application.Windows()` lists a new File Explorer at `file:///G:/01_tauri` — the selected project's workspace. That window was closed by its own `HWND` (`.Quit()`); an Explorer window open before the run was left alone.

The no-selection path: `set_last_project` pointed at a path that does not exist, reload → no row highlighted → `Ctrl+Alt+E` → the toast *Select a project first — the key reveals its workspace*, and `Shell.Application.Windows()` unchanged (no Explorer opened). `prefs.json`, which that write touched, was restored by hash with the rest.

The dev build stopped, all fourteen files restored and hash-matched (0 mismatches of 14), the installed DevGo relaunched through Explorer.

> `✅STAGE: 58 workspace-reveal`; ff-merge; push.

---

## What you built

```
src/types.d.ts       'revealWorkspace' in ShortcutId
src/shortcuts.ts     Ctrl+Alt+E, group Workspace, needsSelection
src/App.tsx          revealWorkspace(ws); the menu hint; the key handler with the toast
```

- **`Ctrl+Alt+E`** — one modifier over from the project's reveal; the menu and the handler read one table.
- **One door, declared enough** — `reveal_in_explorer(path)` already took what both rows send; the twin command and the whole of 58.1 are recorded as already true.
- **A lesson about HMR and effects**: a handler registered in an effect whose deps did not change keeps the old closure across a hot update — reload before believing a key does nothing.
