# 49 — Look Inside (post-plan)

**Branch:** `49.server-tree` — `git checkout 49.server-tree` gives you this chapter's finished app; `git diff 48.server-folders 49.server-tree` is exactly what this chapter adds.

**Starting from:** chapter 48 — a server's folders under their roots, one ssh away. One level only, and the roots were whatever the row said.

**Goal:** drill into any folder, as deep as you like, one ssh per level; add a root from a row or by name; fold a root group shut.

> **Hold on to:**
> 1. **One ssh per level, cached under the path.** `subdirs: HashMap<String, Vec<RemoteFolder>>` on the listing; a re-list of the roots keeps the drill-downs made so far. The path is single-quoted for the *remote* shell — nothing local reads this line — so a space in a folder name survives.
> 2. **Groups in the roots' order, not `ls`'s.** `ls -d` sorts every matched path together, so `/etc/*` came out above `/home/user/*` the moment `/etc` was a root; the user's list is the order that reads.
> 3. **A derived list carries structure, not just rows.** `visible` grew from "the folders" to "the root groups, each with its rows in render order and their depth" — the card renders it, the tree walks it, and a folded group or a closed folder is absent from both for the same reason.
>
> Rust: `'\\''` — the POSIX way to put a single quote inside a single-quoted word; `..Default::default()` in a test's struct literal so a new field does not touch it. TypeScript: a recursive `walk(folder, depth): VisibleFolder[]` with `flatMap`, `Map` grouping sorted by a rank function.

> The asks, watching 48: *nginx is not loading — and can we click into a folder that has folders inside? what about `/etc`, and what is inside it?* → *we should be able to minimize a folder.*

**Already true here.** The confirm sheet's `title` and `confirmLabel` — so a server removal never asks to *Stop WSL* — have been on `confirmAction` since chapter 44, and chapter 47 passes *Remove server / Remove*. Nothing to type for that; the Verify section says so and moves on. Folders stay rows inside the servers card (48): a nested folder is one more `paddingLeft` step in the name cell, the root column empty below depth 0; a root heading folds like a GitHub group heading. `+ Add server ▾` on the search line and the card's box stay where 48 put them.

---

## 49.1 — One ssh per level

`server_folders.rs`: the `ssh` run lifted into one `fn ssh(server, remote) -> Result<String, String>` (BatchMode, ConnectTimeout, the 255 rule) that `list` and the new `list_dir` share; `dir_command(path)` = `ls -d '<path>'/*/ 2>/dev/null` with `'` → `'\''`; `list_dir(server, path)` parses the answer with the path as its one root. `ServerListing.subdirs` (`serde(default)`). One test: the quoting (a path with `'` and a space), the children attributed to their parent.

> `✅SERVERS: look inside, one ssh per level`

## 49.2 — The commands

`list_server_folders` keeps `previous.subdirs` on a re-list (and on a failure, beside the last good folders); `list_server_dir(id, path)` — `spawn_blocking(list_dir)`, the children stored under the path, returned; `add_server_root(id, root)` — trims, refuses an empty root (`AppError::RootRefused`, phrased for the box), writes the defaults out first when the row had none so the new root joins them rather than replacing them, appends once. Registered.

> `✅CMD: drill down and add a root` — `cargo test` **174**, `cargo check` 0 warnings.

## 49.3 — Types and the hook

`ServerListing.subdirs`; `ServersState` gains `openDirs`, `loadingDirs`, `toggleDir`, `listDir`, `foldedRoots`, `toggleRoot`; `VisibleServer` becomes `{ server, open, groups: VisibleRoot[] }` with `VisibleRoot { root, folded, count, rows }` and `VisibleFolder { folder, depth, open, busy, inside? }`; `FolderRowProps` takes a `row` and `onToggle`. `useServers`: `listDir` (busy key, the children merged into the listing's `subdirs`), `toggleDir` (the first open is the ask), `foldedRoots` remembered as `devgo.serversFoldedRoots` (`loadSet` shared with the expanded set), and `visible` rebuilt — hits grouped by root, **sorted by the row's roots** (`rank`), each group folded or walked: `walk(f, 0)` yields the folder then, while it is open, its children at `depth + 1`.

> `✅TYPES: subdirs, open dirs, folded roots` · `✅HOOK: look inside and fold a root`

## 49.4 — The card, the tree, the app

`FolderRow`: the expander before the name (`…` busy, `▼` open, `▶`), `paddingLeft: depth * 16` on the name cell, the root only at depth 0, *no folders inside* beside an open folder with none, the child count in the count column. Root headings: `▼`/`▶` in accent/muted, click → `toggleRoot`, the count stays through a fold. `ProjectTree` walks `groups.flatMap(rows)` — a folded group or a closed folder is not in the walk. `App`: *Look inside* and *Make this a root* on the folder menu, *Add a root folder…* on the server menu → a right `Drawer` with the `NameDialog` (*Add a root on box*, initial `/etc`, *Add root*); `addRoot` = `add_server_root` → reload → re-list.

> `✅UI: nested folders and root headings that fold` · `✅UI: look inside, make a root, add a root`

## 49.5 — Verify

`cargo test` **174**, `cargo check` 0 warnings, `tsc -b`, contrast and `bun run build` clean. Fifteen app-data files backed up by hash; headless over CDP on real data. WSL was still running (see 48) and left alone.

**Order.** Expand box → the headings `▼ ~ 6 · ▼ /var/www 27 · ▼ /srv 1 · ▼ /etc 116` — the row's roots' order (48 had `/etc` first, `ls`'s order). **Fold** `/etc` → 131 lines from 479, `devgo.serversFoldedRoots = ["box:/etc"]`; the heading read `▶ /etc 0` — **FIX**: the count came from the rows, which a fold empties; `VisibleRoot.count` now, `▶ /etc 116` after HMR. `✅FIX: a folded root keeps its count`.

**Look inside.** `▶` on `nginx` (title *Look inside (one ssh)*) → 4.2 s later `/etc ▼ nginx 6` and six children at 16 px: `conf.d · modules-available · modules-enabled · sites-available · sites-enabled · snippets`. `▶` on `sites-available` → *no folders inside* (files only, as the plain user; DevGo never elevates). **The walk:** `sites-available` selected, ↑ → `modules-enabled`, four more ↑ → `networkd-dispatcher` (the `/etc` entry before `nginx`): the nested rows sit in the sequence where the eye reads them.

**Add a root.** Server menu *Open terminal · List folders · Add a root folder… · Copy ssh command · Copy scp prefix · Edit… · Remove*; *Add a root folder…* → drawer *Add a root on box*, the box focused with `/etc` selected; typed `/opt` (with the path conversion 48 tripped on switched off), Enter → the drawer closed, a fresh listing, `▼ /opt 1` after `/etc`, `servers.json` carries `/opt`. **Make this a root** on `/etc/nginx` (folder menu *Open terminal here ⏎ · Look inside · Make this a root · Open in VS Code (Remote-SSH) · Open in Zed (remote) · Copy path · Copy scp path*) → `▼ /etc/nginx 6` as the last group **and** the drilled `nginx` under `/etc` still open with its six — the re-list kept the drill-downs.

**The sheet** — nothing to verify: *Remove server / Remove* since 47 (44's `confirmAction.title`/`confirmLabel`).

`Ctrl+Q`, the two localStorage sets reset, all fifteen files restored and hash-matched, the installed DevGo restarted.

> `✅STAGE: 49 server-tree`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/server_folders.rs   fn ssh; dir_command; list_dir; ServerListing.subdirs (+ 1 test)
  src/commands.rs, lib.rs          list_server_folders keeps subdirs; list_server_dir; add_server_root
  src/error.rs                     RootRefused
src/
  types.d.ts                       subdirs; VisibleRoot / VisibleFolder; the drill and fold state on ServersState
  hooks/useServers.ts              listDir, toggleDir, foldedRoots, toggleRoot; visible with groups in the roots' order
  components/ServersLane.tsx       FolderRow with an expander and a depth; root headings that fold
  components/ProjectTree.tsx       the walk over the groups' rows
  App.tsx                          Look inside; Make this a root; Add a root folder… (NameDialog in a Drawer)
```

Depth without a file browser: one ssh per click, folders only, cached; each level keeps the three doors. The roots are yours — typed, or promoted from where you drilled — and a group you do not need folds out of the way.

> **The thread running through this chapter.** Four pieces of state in the card and a second copy of the recursion in the tree would agree right up to the day they did not; growing the one derived list — the hook's `visible` — from rows to groups-with-depth lets both readers follow for free. The fold's count bug was the one place the two views still disagreed, and it was fixed by putting one more number on the shared list.
