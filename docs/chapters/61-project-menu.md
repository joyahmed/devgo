# 61 — A Project's Menu Is About the Project

**Branch:** `61.project-menu` — `git checkout 61.project-menu` gives you this chapter's finished app; `git diff 60.partial-listing 61.project-menu` is exactly what this chapter adds.

**Starting from:** chapter 60 — the cache only ever holds a complete scan.

**Goal:** take one entry off the project row's right-click menu. Chapter 31 put *Remove workspace ‹name›* at its bottom, reasoning that the project row is where the eye lands, so from a project there should be a way out of its workspace. Three surfaces later that reasoning is wrong, and the entry reads as a mistake: a menu opened on `shop` that ends by offering to remove `02_next`.

> **Hold on to:**
> 1. **A row's menu is about the row.** A project's menu opens, reveals, copies and pins the project. The workspace's menu removes the workspace. A key can cross the line because a key has no row — `Delete` names the workspace it means in its confirm — but a menu opened *on* something cannot.
> 2. **A removal path has doors, not copies.** `setRemoveIndex` → the top sheet from chapter 38 is the one path; the header's menu and `Delete` are its two doors. Taking the third door off changes nothing behind it.

**One file, no Rust.** `App.tsx` alone: `buildMenu` has the entry as its last item after *Pin to top*, with 31's `danger: true` on it.

---

## 61.1 — Why it was there, and why it is not

When chapter 31 shipped, the workspace header's menu had *Remove* (since 25) but the header was a thin line above the rows — easy to miss, easy to mis-hit. Putting the same entry on every project row made removal reachable from anywhere in the group. It also made every project's menu end with an action that is not about the project.

Since then the header became a card heading with its own hue (43) and *Refresh · Reveal · Remove* on its menu (58 added the reveal key), and `Delete` removes the selected project's workspace with a confirm (31). The header is no longer hard to reach. What remains is the smell.

`App.tsx`, `buildMenu`: the `'separator'` after the pin entry and the whole *Remove workspace* item go. What is left is the pin entry as the last item and a two-line comment where the item was, so the next reader does not put it back:

```ts
			{
				label: pinned ? 'Unpin' : 'Pin to top',
				hint: hint('togglePin'),
				onClick: () => handleTogglePin(p)
			}
			// no workspace action here: the header's menu and delete
			// remove a workspace. a project's menu is about the project
		];
```

`lastSegment`, `workspaces`, `setRemoveIndex` and `toast` are all still read elsewhere in the file (`tsc -b` with `noUnusedLocals` would say otherwise), so nothing else moves. The removal path is unchanged.

> `✅UI: project menu ends on the project`

## 61.2 — Verify

`cargo test` **188** (no Rust in this chapter), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. One dev launch, the installed DevGo stopped first, the fourteen app-data files backed up by hash.

Over CDP, the row for `devgo` under `G:\01_tauri` right-clicked: the menu reads **fourteen** entries — *Open in editor · Ctrl+⏎*, *Open terminal · Shift+⏎*, *Open both · Alt+⏎*, *Open in Claude Code · Ctrl+Alt+⏎*, *Open in Claude Code (Ubuntu-26.04)* (disabled, a Windows project), a separator, *Reveal in Explorer · Ctrl+Shift+E*, *Copy Windows path · Ctrl+Shift+C*, *Copy WSL path · Ctrl+Shift+W*, *Open remote*, a separator, *Run dev script…*, a separator, and **last, *Pin to top · Ctrl+S*** — no *Remove workspace 01_tauri*, no dangling separator under the pin.

The header's menu (`[data-ws-header]` for `01_tauri`) still reads *Refresh this workspace · F5*, *Reveal in Explorer · Ctrl+Alt+E*, a separator, **`Remove 01_tauri · Del`**. The row selected and `Delete` pressed: the sheet *Remove workspace — Are you sure you want to remove this workspace folder? Your files will not be deleted.* with *Cancel* / *Remove*; Escape closes it (`[role=dialog]` gone). Two doors, both open.

The dev build stayed up for chapter 62's frontend half; the files were restored by hash at the end of that run.

> `✅STAGE: 61 project-menu`; ff-merge; push.

---

## What you built

```
src/App.tsx          buildMenu: the pin entry is the last; the workspace item and its separator gone
```

- **A project menu that ends on the project** — pin is the last entry.
- **A rule for every future menu** — the menu is about the row it opened on; cross-cutting actions belong to keys and to the row that owns them.
