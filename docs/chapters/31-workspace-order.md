# 31 — The List in Your Order (post-plan)

**Branch:** `31.workspace-order` — `git checkout 31.workspace-order` gives you this chapter's finished app; `git diff 30.scan-pick 31.workspace-order` is exactly what this chapter adds.

**Starting from:** chapter 30 — workspaces can be scanned for and added in bulk. They appear in the tree in an order nobody chose, and nothing can change it.

**Goal:** the tree renders the store's order; a workspace header drags up and down, or moves with `Alt+↑` / `Alt+↓`; the order is saved; and *Remove workspace* is on the project row's menu too.

> **Hold on to:**
> 1. **Read the code before building the ask.** "Drag to reorder" was a request to fix an order that had never existed: the tree grouped projects by workspace in *first-seen* order of a name-sorted list. The first fix is one sort.
> 2. **Send the whole order, not a move.** A permutation can be checked; "move index 3 to 1" cannot. A client working from a stale list fails loudly instead of losing a workspace.
> 3. **The API that does not work is a fact about the host, not the code.** HTML5 drag-and-drop is dead inside a Tauri window that owns OS drag-drop on Windows. Pointer events are the drag.
> 4. **A drag ends in a click.** Eat exactly one.
>
> Rust: sorting two `Vec<String>` copies to compare as multisets; `unwrap_or_else` on a `find` that cannot miss but must not panic. TypeScript: `useRef` for gesture state that nothing renders from; `setPointerCapture`; `document.elementFromPoint(...).closest('[data-…]')`; a `Set`-free splice on a copied array; the existing `combos` table gaining two entries.

> The tree is one table, so there is no lane rule: a header can go anywhere in the list. And the tree has no header cursor — `Alt+↑/↓` act on the *selected project's* workspace, which is what `Delete` already acts on.

---

## 31.1 — The order you see was never decided

`workspaces.json` is a list, and `WorkspaceStore` keeps its order. `App` holds that list (`useWorkspaces`). `ProjectTree` never saw it — it received `projects`, sorted by name or frecency in `collect_projects`, and built its groups by walking that:

```tsx
	const grouped = new Map<string, Project[]>();
	for (const p of projects) {
		…
		grouped.set(p.workspace, existing);
	}
```

A `Map` iterates in insertion order, so a workspace's rank was the rank of its first project in the sorted list. Say the store lists `01_turbo, 02_next, Dev, 03_mobile, 01_tauri, 03_ai, 04_dev`; the tree showed `01_tauri, 01_turbo, 02_next, 03_mobile, 03_ai, 04_dev, Dev`. Add a project called `aardvark` to the last workspace and it jumps to the top. Nothing in the UI, nothing in the store, could have told you why.

The fix is a prop and a sort. `workspaceOrder?: string[]` on `ProjectTreeProps` — the store's list — comes down from `App` as `workspaces`, and the tree sorts `grouped`'s entries by their index in it:

```tsx
	// the store's order, not grouped's: grouped is keyed in first-seen order
	// of the name-sorted project list, so a workspace's place depended on
	// what its first project happened to be called. one the store does not
	// list (a search result from a workspace mid-removal) keeps its place
	// at the end rather than vanishing
	const rank = new Map((workspaceOrder ?? []).map((w, i) => [w, i]));
	const at = (ws: string) => rank.get(ws) ?? Number.MAX_SAFE_INTEGER;
	const entries = [...grouped].sort(([a], [b]) => at(a) - at(b));
```

`entries` replaces `grouped` in the keyboard's `visible` walk and replaces the `workspaces = [...grouped.entries()]` the render used, so the arrow keys walk the same sequence the eye does. That lands first, so drag has a stable list to act on — but it is Rust first, because the store has to accept an order before anything can send one.

## 31.2 — The store takes an order, not a move

`WorkspaceStore::reorder` takes the **whole list**:

```rust
    pub fn reorder(&mut self, order: Vec<String>) -> Result<(), AppError> {
        let norm = |p: &str| super::platform::paths::normalize(p);
        let mut have: Vec<String> =
            self.workspaces.iter().map(|w| norm(w)).collect();
        let mut want: Vec<String> = order.iter().map(|w| norm(w)).collect();
        have.sort();
        want.sort();
        if have != want {
            return Err(AppError::WorkspaceOrderMismatch(
                order.len(),
                self.workspaces.len(),
            ));
        }
        // the stored spelling stays; only the positions change
        let reordered = order
            .iter()
            .map(|o| {
                let key = norm(o);
                self.workspaces
                    .iter()
                    .find(|w| norm(w) == key)
                    .cloned()
                    .unwrap_or_else(|| o.clone())
            })
            .collect();
        self.workspaces = reordered;
        self.save()
    }
```

Not "move index 3 to 1". A client that sends the full order is a client that saw the full list, and the server can check that claim: an order that is not a permutation of what is stored comes from a stale view, and obeying it would silently drop the workspace the client never saw. Same rule chapter 22 gave `remove` — a request that cannot be honoured exactly is an error, not a best effort. `WorkspaceOrderMismatch(usize, usize)` in `error.rs` says *does not match the stored list (N sent, M stored). Refresh and try again*. The paths are compared through the same `normalize` that `add` uses, so `G:/play/` and `G:\play` are one workspace, and the stored spelling is what gets kept.

Two tests: a missing entry, an extra one, and a stranger with the right count are all refused and change nothing; a permutation with mixed slashes applies, keeps the stored spelling, and survives a reload.

> `✅WORKSPACE: reorder takes the whole list` — **120** tests. (Two dead-code warnings for one commit: the variant and the method wait for their command.)

`reorder_workspaces(order)` is the command, returning the list the way `add_workspace` and `remove_workspace` do; registered in `lib.rs` after them.

> `✅CMD: reorder_workspaces`

Then the sort from §31.1, with `workspaceOrder: workspaces` on the `ProjectTree` in `App`.

> `✅UI: the tree renders the store order`

`useWorkspaces` gains `reorder(order)` beside `add` and `remove`, setting its state from what the store returns, so what renders is what was saved.

> `✅HOOK: reorder in useWorkspaces`

## 31.3 — Drag: the API that does not work here

The obvious tool is the HTML5 drag-and-drop API — `draggable`, `onDragStart`, `onDragOver`, `onDrop`. A first draft with it compiles. Under real mouse input it does nothing: no drag image, no `dragover`, no drop. Not a bug in the handlers — the browser never starts the drag.

The reason is one line in chapter 17. Tauri owns OS drag-drop on the window (`dragDropEnabled`, the default) so that a folder dropped on DevGo becomes a workspace through `onDragDropEvent`. On Windows, that interception swallows every HTML5 `dragstart` inside the webview. Turning `dragDropEnabled` off fixes reordering and breaks folder drop. So the tree goes straight to what works: the reorder is not a drag in the API sense; it is a **pointer gesture**. Press on a header, move past a four-pixel threshold, and the header dims and pointer capture keeps the moves coming after the pointer leaves it:

```tsx
	const headerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d) return;
		if (!d.active) {
			if (Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD) return;
			d.active = true;
			setDragging(d.ws);
			// keeps the moves coming after the pointer leaves the header
			e.currentTarget.setPointerCapture(e.pointerId);
		}
		const t = dropTargetAt(e.clientX, e.clientY);
		const next = t && t.ws !== d.ws ? t : null;
		setDrop(prev =>
			prev?.ws === next?.ws && prev?.after === next?.after ? prev : next
		);
	};
```

`dropTargetAt` asks `document.elementFromPoint` for the `[data-ws-header]` under the pointer and decides `after` from which half of that row the pointer is in, which is what makes a one-pixel insertion line honest. Release (`endDrag` with `commit`) asks once more and calls `moveWorkspace`, which rebuilds the full order with the carried workspace spliced beside the target and hands it to `onReorder`:

```tsx
	// move ws to sit before or after target and hand back the whole order:
	// the store can check a permutation, it cannot check a move
	const moveWorkspace = (ws: string, target: string, after: boolean) => {
		if (!onReorder || ws === target) return;
		const without = (workspaceOrder ?? []).filter(w => w !== ws);
		const i = without.indexOf(target);
		if (i < 0) return;
		without.splice(after ? i + 1 : i, 0, ws);
		onReorder(without);
	};
```

The gesture state — which header is carried, where it would land — lives in two `useState`s because the header dims and the line renders; the press position and the threshold flag live in a `useRef`, because nothing renders from them and a state write per pointer move is a re-render per pointer move. The header gains `relative`, `data-ws-header={ws}`, the four pointer handlers, `opacity-40` while carried, and the insertion line as its first child: `absolute left-4 right-4 h-0.5 bg-accent`, `top-0` or `bottom-0`. The header is the handle, open or collapsed.

And **a completed drag ends with a pointerup on the header**, which the browser follows with a click, and a click toggles the workspace. One ref, `swallowClick`, eats exactly that click.

In `App`, `onReorder` calls the hook and, if the store refuses, toasts the message and refreshes the workspace list — refreshing being exactly what the message told the user to do.

> `✅UI: drag a workspace header up or down`

## 31.4 — The keyboard twin

`Alt+↑` and `Alt+↓` move the selected project's workspace one place. They are declared in `shortcuts.ts` like every binding since chapter 11 — `moveWorkspaceUp`, `moveWorkspaceDown`, group *Workspace*, `needsSelection` — with the two ids added to `ShortcutId` in `types.d.ts`, so the Shortcuts panel documents them without being told. In the tree's key handler they are two more rows of the `combos` table, which already runs before the bare-key map and before the typing guard — so Alt is never read as "navigate", and the combo works from the search box like every other modifier combo:

```tsx
			['moveWorkspaceUp', () => ws && nudge(ws, -1)],
			['moveWorkspaceDown', () => ws && nudge(ws, 1)]
```

```tsx
	// the keyboard twin of dragging the header: the selected project's
	// workspace moves one place in the rendered order
	const nudge = (ws: string, dir: 1 | -1) => {
		const i = entries.findIndex(([w]) => w === ws);
		const target = entries[i + dir];
		if (i >= 0 && target) moveWorkspace(ws, target[0], dir === 1);
	};
```

Same `moveWorkspace`, same full-order write. `workspaceOrder` and `onReorder` join the effect's dependency list.

> `✅UI: alt+arrow moves the workspace`

## 31.5 — Remove, from the row you are looking at

The workspace header's right-click menu has had `Remove <name>` since chapter 25. The project row's menu did not have it, and the project row is the one the eye lands on — so from a project there was no way out. One entry, at the bottom after a separator, `danger` like the header's:

```tsx
			{
				label: `Remove workspace ${lastSegment(p.workspace)}`,
				danger: true,
				onClick: () => {
					const idx = workspaces.indexOf(p.workspace);
					if (idx >= 0) setRemoveIndex(idx);
					else toast(`${lastSegment(p.workspace)} is no longer in the list`, 'error');
				}
			}
```

The same `indexOf` lookup as the header entry, for the reason recorded beside it in chapter 25, and the same confirm dialog, so two menus reach one removal path.

> `✅UI: remove workspace from the project row`

## 31.6 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **120** — chapter 30's 118 plus two for the store. Then, with the config files backed up:

**The order.** `bun tauri dev`: the headers read `[...document.querySelectorAll('[data-ws-header]')].map(e => e.dataset.wsHeader)` in exactly `workspaces.json`'s order. Ask `get_projects` for its payload and walk it for first-seen workspaces: that is the order the old tree showed, and it is not the same list.

**Drag.** Over CDP, real mouse events (`Input.dispatchMouseEvent` — pressed, moved in a dozen steps with `buttons: 1`, released): press on `01_tauri`'s header, move to the top quarter of `Dev`'s, release. Mid-drag, one header carries `opacity-40` and the target carries the `bg-accent` line at `top-0`. After: the tree reads `01_turbo 02_next 01_tauri Dev …`, `workspaces.json` says the same, the moved header is still `▼` — the click after the drop was swallowed — and no header is dimmed. The same gesture downward, into the bottom of `02_next`: `bottom-0`, then `01_turbo 02_next 01_tauri`.

One limit found on the way: a drop target below the fold of the scrolling list is not reachable by the gesture alone — there is no autoscroll while a header is carried (the wheel still works mid-drag, and the pointer events at a point outside the viewport simply never arrive). `Alt+↓` covers that case; noted, not built.

**Keys.** Click a project inside `01_tauri`, `Alt+↓`: `… Dev 01_tauri …` and the file agrees. `Alt+↑`: back.

**The row.** Right-click that project: the menu ends with *Remove workspace 01_tauri*; it opens *Remove Workspace* with *Cancel* / *Remove*; `Escape`, nothing removed.

Restore the files — including `workspaces.json`, which now holds the order you dragged.

> `✅STAGE: 31 workspace-order`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/workspace.rs     reorder(order): permutation check, stored spelling kept; 2 tests
  src/error.rs                  WorkspaceOrderMismatch
  src/commands.rs, lib.rs       reorder_workspaces
src/
  components/ProjectTree.tsx    entries in store order; pointer-gesture drag; nudge; swallowClick
  hooks/useWorkspaces.ts        reorder
  shortcuts.ts, types.d.ts      moveWorkspaceUp / moveWorkspaceDown; workspaceOrder, onReorder
  App.tsx                       onReorder with toast + refresh on refusal; Remove workspace on the row
```

The tree renders workspaces in the store's order; a header drags up or down or moves with `Alt+↑/↓`; the full order is checked and saved by the store; and a project row's menu can remove its workspace.

> **The thread running through this chapter.** The ask was a drag. Reading the code first found that the order it would rearrange had never been decided — so the first commit is a sort, the store learns to check a permutation before anything sends one, and the drag itself is a pointer gesture because the host owns the API everyone reaches for. **Read the code before building the ask.**
