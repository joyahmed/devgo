# 48 — The Folders on the Box (post-plan)

**Branch:** `48.server-folders` — `git checkout 48.server-folders` gives you this chapter's finished app; `git diff 47.servers 48.server-folders` is exactly what this chapter adds.

**Starting from:** chapter 47 — a server is a row and Enter is a terminal on it. The row knows nothing about what is *on* the machine.

**Goal:** expand a server and see its folders, grouped under `~`, `/var/www`, `/srv` — each one a terminal, VS Code or Zed away; and the row's dot says whether the box answered.

> **Hold on to:**
> 1. **The listing is the probe.** One `ssh -o BatchMode=yes -o ConnectTimeout=5 <alias> "echo ~; ls -d …"` on the click, off the main thread, never on launch, focus or the badge pass. Its success is the status dot; there is no second probe to schedule.
> 2. **Spawn `ssh` directly, and read the exit code the way `ssh` means it.** No `cmd`/`pwsh` between DevGo and `ssh`, so the `*` reaches the *remote* shell (the one that expands it). Only **255** is `ssh`'s own failure; `ls -d` exits 2 when one root is missing while it lists the rest fine — a first cut painted the VPS red for that.
> 3. **The command is the tab.** `wt`'s run template drops `cmd /k`: Windows Terminal runs the command in the default profile's own appearance, and the ssh lines carry no quotes and no shell operators so they survive whatever local shell a terminal target uses.
>
> Rust: `Option::is_none_or` on an exit code; `max_by_key` over the resolved roots for the longest prefix; a `HashMap<String, T>` store through `parse_or_backup`. TypeScript: one derived `visible` list in the hook that both the card and the tree read, so a filter can never disagree with the arrows.

> The asks: *see the servers, local and remote — and open their projects in Zed or VS Code straight from a right-click on a server folder* — and, watching the first cut, *only `/var/www`?* and *that is every file, ungrouped — group them under their folders.*

**Inside the card.** The servers are a card in the single table (chapter 47), so a server's folders are rows **inside that card**: a root heading in the same shape as a GitHub group heading (`▾ /var/www … 5`), the folders under it one step in, in the four columns every row shares (the root where the workspace goes, the name as the click target). **+ Add server ▾** goes on the search line beside *+ Add repo*, and the card's own search box sits in its heading. The card keeps its `0fr → 1fr` collapse: the list scrolls since 47's fix, so the card is not the scroller and the animation costs nothing.

---

## 48.1 — Roots on a row, and a line without quotes

`Server.roots: Vec<String>` (`serde(default)`; the parser seeds `Vec::new()`). And `ssh_command()` becomes `ssh -t <target> tmux new-session -A -s <session>` — no `"…"`, no `&&`/`||`, no `$SHELL` fallback: the line is typed into whatever local shell a terminal target uses (chapter 47's `\$` lesson, taken one step further — the test now asserts no quote of either kind). A box without tmux prints tmux's own error and the tab stays open; the row's switch is the plain shell.

> `✅SERVERS: roots on a row` · `✅SERVERS: the ssh line without quotes`

## 48.2 — One `ssh`, on the click

`services/server_folders.rs`: `DEFAULT_ROOTS = ["~", "~/projects", "/var/www", "/srv"]`; `listing_command(roots)` = `ls -d ~/*/ ~/projects/*/ … 2>/dev/null` (the redirect is for the *remote* shell); `parse_listing(text, roots, home)` attributes each line to the longest root that prefixes it with `~` resolved against the `echo ~` the box answered first; `effective_roots`; `session_slug` (`my.blog` → `my-blog`, tmux forbids `.` and `:`); `folder_terminal_command` = `ssh -t <target> tmux new-session -A -s <slug> -c <path>` (a session per folder), `vscode_remote_args` = `--remote ssh-remote+<alias|user@host> "<path>"`, `zed_remote_url` = `ssh://<alias>/path` or `ssh://user@host:port/path`; `list(server)` spawns `ssh` with `BatchMode=yes`, `ConnectTimeout=5`, `StrictHostKeyChecking=accept-new`, **255 or no code = unreachable** with stderr as the reason; `ListingCache` on `servers-cache.json` (`all`, `store`, `forget`). Six tests. ⚠️ The fixture at this branch's tip still names a real box (host, IP, user, an app under `/var/www`); chapter 69 generalises it to `box` / `203.0.113.7` / `/var/www/shop`, and the text here uses those.

> `✅SERVERS: folders on the box, one ssh and a cache` — **173**.

## 48.3 — The command is the tab

`WT_RUN_ARGS = "-d \"{path}\" {command}"` and `WT_RUN_ARGS_PRE` (the `cmd /k` form); the default and the `wt` candidate in `editors.rs` read the const; `TargetStore::adopt_run_template` rewrites only the exact old default, with a `targets.json.pre-pwsh-run` copy first (the psmux adoption's shape) — the customised-template test now proves **two migrations, two questions**: a hand-written session template is left alone while the untouched run template is adopted with its own backup.

> `✅TARGET: the command is the tab`

## 48.4 — The commands

`AppState.servers_cache`; `remove_server` forgets the cache entry; `get_server_listings` (the cache, no network); `list_server_folders(id)` — `async`, `spawn_blocking(list)`, then a `ServerListing { folders, listed_at, up, error }` stored and returned, a failure keeping the last good folders; `open_server_folder(id, path)` — the folder line through the terminal's run template; `open_server_folder_in(id, path, editor)` — `editor` is `vscode` or `zed`; the exe (`code`, `zed`) runs through `cmd /c` (`code` is `code.cmd`), refused with `TargetNotInstalled` when the exe is not on PATH and `TargetNotFound` for an unknown editor name.

> `✅CMD: folder listing and the three doors` — `cargo check` 0 warnings.

## 48.5 — Types, hook, form

`types.d.ts`: `roots` on `Server`; `RemoteFolder`, `ServerListing`, `VisibleServer`; `ServersState` gains `listings`, `listing`, `expanded`, `toggleExpanded`, `listFolders`, `query`/`setQuery`, `visible`; `NavRow` gains `folder`; `SearchLane` gains `'servers'`; `ProjectTreeHandle.openServerRow`; `FolderMenu`, `FolderRowProps`, the lane and row props. `useServers`: the cached listings read at mount, `listFolders` with a busy set, `expanded` remembered as `devgo.serversExpanded` (the first expand is the ask, then the cache paints and ↻ re-asks), and **`visible`** — the servers the query leaves, each with its folders when open; a folder hit keeps its server and a query opens every server with a hit. `ServerForm` gains *Folders to list, one root per line* as a textarea.

> `✅TYPES: folders on a server` · `✅HOOK: listings, expand and the ask` · `✅UI: roots in the form`

## 48.6 — The card, the tree, the app

`ServersLane`: the expander before the dot (`…` while busy), the **dot** — hollow never asked, emerald up (*Reached 2 min ago · 150 folders*), danger down with `ssh`'s stderr in the tooltip — a ↻ in the meta cell, the card's own `SearchBox` (`lane: 'servers'`) in the heading, and under an open server the reason, the empty note (*Nothing under ~, ~/projects … Edit the roots in Settings › Servers*), *Listing…*, or the folders grouped by root through `groupByRoot` (first-seen order = the roots' order). `ProjectTree`: `folderCursor` (`${id}:${path}`) beside the server cursor, rows built from `servers.visible` with each open server's folders under it, `LANE_KINDS` so the servers box walks servers and folders alone, `openServerRow()` for Enter on either. `App`: `openFolder`, `openFolderIn`, the folder menu — *Open terminal here ⏎ · Open in VS Code (Remote-SSH) · Open in Zed (remote) · Copy path · Copy scp path* (an editor entry is disabled unless that editor is a detected target) — *List folders* on the server menu, **+ Add server ▾** on the search line. And the scrollbar: the thumb was `--color-border`, the quiet hairline token, 1.2:1 against the card — there, invisible; `border-strong`, 8 px, accent on hover.

> `✅UI: folders under the server` · `✅UI: folders in the tree and the keys` · `✅UI: folder menu and add server on the line` · `✅UI: a scrollbar you can see`

## 48.7 — Verify

`cargo test` **173**, `cargo check` 0 warnings, `tsc -b`, contrast and `bun run build` clean. Fifteen app-data files backed up by hash. Headless over CDP on a real `servers.json` and a `servers-cache.json` written by a newer build (same shape — it parsed, no `.bak`).

⚠️ **WSL was already running when this chapter's dev build came up** (the chip read *WSL · 1 running*; `wsl -l --running` agreed) — not started by anything here (nothing in 48 spawns `wsl`), and by the standing rule it was **not shut down**. So the never-boot proof for this chapter is *not provable this run*; the launches below went to the VPS over `ssh`, which never touches the distro.

**First paint from the cache.** `▼ Servers · 2 machines · + Add`, the box *Search servers & folders…* in the heading (`data-lane-search="servers"`), **+ Add server ▾** on the search line; both dots emerald from the cache — *Reached 4 d ago · 19 folders* (lanbox), *Reached 2 d ago · 150 folders* (box) — with no `ssh` run.

**Expand box** → the cache painted at once: `▾ /etc 116`, then `~`, `/srv`, `/var/www` (the row's roots), 329 lines in the card, `devgo.serversExpanded = ["box"]`. **↻** → the expander read `…` and ↻ was disabled for the 4.2 s the `ssh` took, then *Reached just now · 150 folders*, `listed_at` three seconds before *now*, `~` holding `actions-runner · backups · bin · database_backup · projects · scripts`.

**A folder.** Click `scripts` → `~ | scripts` lit; ↑ → `database_backup`; ↓ back. Right-click: *Open terminal here Enter · Open in VS Code (Remote-SSH) · Open in Zed (remote) · Copy path · Copy scp path* (both editors enabled: both are detected targets). **Enter:** within six seconds an `ssh` (21680) and an `OpenConsole`, the line exactly `ssh -t box tmux new-session -A -s scripts -c /home/user/scripts`; on the box `tmux ls` → `scripts: 1 windows … (attached)` and `#{pane_current_path}` = `/home/user/scripts`. The `ssh` stopped, the tab with it. The editors were **not launched** (a real VS Code window on screen, a remote server install); their lines are pinned by the unit test, and `editor: 'nope'` over `invoke` answers *No such editor or terminal: nope*.

**FIX, found here.** Typed `backup` in the card's box → only box stayed, opened, with `~ · 2 → backups, database_backup`; but ↓↓↓ from the box lit **nothing**: the filter lived in the card and the tree walked the raw list, so the cursor landed on rows the filter had hidden. The filter moved into the hook as `visible`, the card renders it and the tree walks it; after HMR ↓ → box, ↓ → `backups`, ↓ → `database_backup`, ↓ stays. Escape clears the box and the 329 lines are back. `✅FIX: the box's arrows walk what the filter shows`.

**Unreachable.** *+ Add server ▾* on the line → *Add a server…* → `Nowhere`, host `10.255.255.1`, one root in the textarea → *3 machines*, a hollow dot *Not checked yet*. Expand → *Listing…* under it, then after the 5 s timeout the dot `bg-danger` (`rgb(251,113,133)`) titled *Unreachable just now — ssh: connect to host 10.255.255.1 port 22: Connection timed out* and the same sentence under the row in danger. (The root landed as `C:/Program Files/Git/opt`: the `/opt` typed into the CDP script was rewritten by Git Bash's path conversion on the way in — the app stored what it was given; a person typing `/opt` gets `/opt`.) `remove_server` over `invoke` → `get_server_listings` keys `box, lanbox` — the cache forgot it.

**Settings › Servers › Edit box** → the textarea reads the row's five roots (`~ · ~/projects · /var/www · /srv · /etc`). **Collapse** box → 24 lines; expand `lanbox` from the cache → `~ 11 · /srv 3 · /var/www 5` (Desktop … snap; public, share, backup; html, shop, blog, wiki, api). The scrollbar is visible on the right of the list.

`Ctrl+Q`, `devgo.serversExpanded` reset, all fifteen files restored and hash-matched, the installed DevGo restarted.

> `✅STAGE: 48 server-folders`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/servers.rs          roots; the quote-free ssh line
  src/services/server_folders.rs   DEFAULT_ROOTS; listing_command / parse_listing / effective_roots; session_slug; the three lines; list(); ListingCache (+ 6 tests)
  src/services/mod.rs              the module
  src/models/target.rs             WT_RUN_ARGS / WT_RUN_ARGS_PRE; the default
  src/services/editors.rs          the wt candidate reads the const
  src/services/target_store.rs     adopt_run_template (one test extended)
  src/commands.rs, lib.rs          servers_cache; get_server_listings, list_server_folders, open_server_folder, open_server_folder_in
src/
  types.d.ts                       roots; RemoteFolder, ServerListing, VisibleServer; NavRow 'folder'; SearchLane 'servers'; the props
  hooks/useServers.ts              listings, listFolders, expanded, query, visible
  components/ServersLane.tsx       expander, dot, ↻, the box, root headings, FolderRow
  components/ServerForm.tsx        the roots textarea
  components/ProjectTree.tsx       folderCursor; rows from visible; LANE_KINDS; openServerRow
  App.tsx                          openFolder / openFolderIn; the folder menu; List folders; + Add server
  index.css                        a scrollbar you can see
```

Expand a server and its folders are there, grouped the way the box keeps them; Enter puts you in a tmux session *in* that folder; the dot says whether the box answered, because the listing was the question. One `ssh`, on the click, cached until the next.

> **The thread running through this chapter.** The first cut kept the filter in the card and let the tree walk the raw rows, which happened to agree until the box's arrows were tried; the fix derives one `visible` list in the hook and hands it to both. The first time a filter and a cursor disagreed was the last: a list computed once cannot disagree with itself.
