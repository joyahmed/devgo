# 50 — The Apps on the Box (post-plan)

**Branch:** `50.server-apps` — `git checkout 50.server-apps` gives you this chapter's finished app; `git diff 49.server-tree 50.server-apps` is exactly what this chapter adds.

**Starting from:** chapter 49 — a server's folders, as deep as you drill. Folders only: `/var/www/shop` was a name, not an app.

**Goal:** the folders that are apps learn what they are — pm2 process, domain, ports, deployed commit — and the server and each app grow an *Actions* menu **the server itself declares**. Every action is a line typed into a tmux window on the server; DevGo never runs a script, never reads what came back, never holds `sudo`.

> **Hold on to:**
> 1. **The contract lives on the server.** `~/scripts/devgo-inventory.sh` (one JSON document) and `devgo-actions.json` beside it — two files the box's own scripts repo keeps. DevGo reads both on the same `ssh` as the folder listing — two marks in the stdout, three parts — and every field is `serde(default)`, every unknown `kind` dropped, so the box may move ahead of the app.
> 2. **The line never rides the terminal's command line.** `spawn_raw` hands `{command}` to `cmd`, which eats `&&`, `|`, `>`, `2>/dev/null`; `wt` splits on `;`. So an action is `tmux new-window` + `send-keys` as one argv element of a *direct* `ssh`, single-quoted for the remote shell, and the terminal attaches afterwards with the row's ordinary line and lands on that window.
> 3. **Hidden, not broken.** An action whose placeholder is `null` for a row is not in that row's menu; `fill` returns `None` the moment a word is missing, and a word the contract does not define is left as it is.
>
> Rust: `#[serde(rename_all = "lowercase")]` on an enum beside a `RawAction` with `kind: String` so the file parses even when the enum cannot; `deserialize_with` for a `null` that means zero; `HashMap::from([...])`. TypeScript: a mirror of `placeholders` for what the menu *shows*, the Rust one for what *runs*.

> The brief for the servers, in five words: *room for knowledge, door for execution.* DevGo is the one tool for these machines.

**In the row.** Rows stay inside the servers card: an app's domain, dot and ports go in the row's **file-system column** (the four-column table has a cell there that a folder never used), the child count keeps the count column. `/etc`'s curation is computed in the hook's `visible` (both the card and the keyboard walk read it); the *show all* row renders under the group or the opened folder.

---

## 50.1 — The contract

`services/server_apps.rs`: `Inventory { schema, generated, host: Host, apps: Vec<App> }` — `Host` (hostname, uptime, load, disk, pm2 totals, nginx sites), `App` (name, dir, kind, processes, site, git, env_files, database), every field defaulted; `ActionKind` (`run` · `pretype` · `url` · `local`) and `Action { id, label, kind, root, command }`; `parse_actions` through `RawAction` so an unknown kind is skipped, not fatal; `parse_inventory`; `placeholders(app)` — `{dir} {name} {pm2} {pm2_web} {pm2_api} {site} {domain} {web_port} {api_port} {db} {repo}`, the web process by a `web`/`frontend` suffix on its pm2 name or cwd, the api by `api`/`backend`, one process serving both; `fill(command, values)`; `combined_command(listing)` and `split(stdout)` around `__DEVGO_INVENTORY__` / `__DEVGO_ACTIONS__`; `append_unlisted` (an app under no root gets a row under its parent); `typed_command(session, window, line, press_enter)`; `check_local` (a `local` line with a shell character is refused by name). Eight tests on a trimmed live document. ⚠️ At this branch's tip that document names a real box's domains and apps, and the Help paragraph names the scripts repo it came from; chapter 69 generalises both to `shop.example.com` / `blog.example.com` on `box` and an unnamed repo. The text here uses those placeholders.

> `✅SERVERS: the inventory and actions contract`

## 50.2 — Still one ssh

`server_folders::list` returns a `Listed { folders, inventory, actions, inventory_error }`: the listing line wrapped in `combined_command`, the stdout `split`, each JSON part absent, parsed, or an error carried (the first that failed); `append_unlisted` after the parse. `run_remote(server, line)` — the same direct `ssh`, output unread. `ServerListing` gains the three fields (`serde(default)`; an older cache loads with them empty).

> `✅SERVERS: the listing carries the apps`

## 50.3 — The door

`list_server_folders` carries the parts into the cache (a failure keeps the previous ones the way it keeps the previous folders — `..previous`); `run_server_action(id, action_id, app_dir)`: the server's own action when `app_dir` is `None`, an app's filled from the inventory otherwise (`ActionRefused` when the box declares none, when the dir is not an app, or when a word is missing; `ActionNotFound` for an unknown id). `url` → the https-only browser door; `local` → `check_local`, then the terminal's run template on this PC; `run`/`pretype` → with tmux off the line comes back as `Copied`, else `typed_command` over `run_remote` (the window named by `session_slug(action.id)`, Enter only for `run`), then `attach_terminal` with the row's ordinary launch line. `ActionOutcome` is a tagged enum for the toast.

> `✅CMD: the actions the server declares` — `cargo test` **182**, `cargo check` 0 warnings.

## 50.4 — Types, data, hook

`types.d.ts`: `ServerApp`, `ServerInventory`, `ServerActionKind`, `ServerAction`, `ServerActions`, `ActionOutcome`; `ServerListing` gains `inventory`, `actions`, `inventory_error`; `VisibleFolder` gains `app` and `hidden`, `VisibleRoot` gains `hidden`; `ServersState` gains `showAllIn` / `toggleShowAll`. `serverApps.ts`: `appForFolder`, `placeholders` (the TS mirror), `canFill` (`[a-z0-9_]` — `{pm2}` has a digit), `appStatus`. `etcCuration.ts`: `ETC_CURATED` (nginx, ssh, systemd, postgresql, mysql, mariadb, redis, docker, cron.d, supervisor, letsencrypt, ufw, fail2ban, pm2, php, apache2, caddy), `isEtc`, `curate(parent, folders, showAll)`. `useServers`: `showAllIn` (a session choice, not remembered — the default stays clean); `visible` applies `curate` under a root and under an opened folder (a search lifts it), puts `app` on each row and `hidden` on a group or a folder, and matches an app's **domain** in the query.

> `✅TYPES: apps and actions` · `✅DATA: which app a row is, and etc curated` · `✅HOOK: the apps on the rows, etc curated`

## 50.5 — The card, the app, the help

`ServersLane`: `hostLine` under the server dot (`23/23 pm2 · 22 sites · load 0.1 · 153.4 GB free`), `appTitle` on an app row (the processes with restarts, the site, the deployed commit), `APP_DOT` (emerald every process online, amber one not, hollow none) beside the domain and the ports in the file-system column, the *No inventory on this box* and `inventory_error` lines, and `showAllRow` — *105 more system folders. Show all* / *Show developer folders only*. `App`: `runServerAction` with the toast per outcome (a `copied` one copies the line and opens the terminal plain), `actionHint` (*sudo · types · copies · ↗ · this PC*), `serverActionEntries` after *Add a root folder…*, `appActionEntries` after the editors (filtered by `canFill`), *List folders & apps*, the server-level actions in the palette as *Server: box › …* (the per-app ones stay in the menu). Help gains a paragraph.

> `✅UI: what an app row tells you` · `✅UI: the actions in the menus and the palette` · `✅UI: help says apps`

## 50.6 — Verify

`cargo test` **182**, `cargo check` 0 warnings, `tsc -b`, contrast and `bun run build` clean. Fifteen app-data files backed up by hash; a `servers-cache.json` written by a newer build **did not parse** against this stage's `ServerListing` and `parse_or_backup` moved it to `.bak` — both files restored by hash after. WSL running, left alone (see 48).

**FIX, found on the first real listing.** ↻ on box: the folders came, the dot said *Reached just now · 150 folders*, and the row said `devgo-inventory.sh: invalid type: null, expected u64 at line 1 column 15326`. The live inventory is schema 2 and lists **docker-run** processes: `"pm2": null, "docker": "blog", "restarts": null, "memory_mb": null`. A `u64` refuses `null`; `null_as_zero` (`Option<u64>` → `unwrap_or_default`) on `restarts` and `memory_mb`, and one more assertion in `the_live_document_parses_and_every_field_is_optional` with a docker process line (eight tests still). `✅FIX: a docker process has no restart count`. After the rebuild: **26 apps**, host `box · load 0.1 · 153.4 GB free`, `inventory_error: null`.

**The rows.** Under `/var/www`: `shop | shop.example.com | 3008/3009` with an emerald dot, its tooltip `shop-web online · 1 restarts / shop-api online · 1 restarts / site shop · https / main @ abc1234 deploy`; `wiki | wiki.example.com | 3018/3019`; `blog | blog.example.com | 3005/3004` with three `? online` processes (docker, no pm2 name — schema 2's `docker` key is a later chapter's). A bare deploy dir (`html`) shows nothing new.

**The menus.** Server: *Open terminal ⏎ · List folders & apps · Add a root folder… · Inventory (JSON) · List · Ports · Health · Off-site sizes · TLS certs & days left SUDO · nginx -t SUDO · Tail error log SUDO · Records (example.com) · Remove record… TYPES · This box's addresses · Restore… TYPES · Update scripts from git · Server docs · Copy ssh command …* — the fourteen the box declares. App (`shop`): after the editors, eighteen entries — *Shell in {dir} · Logs · {pm2_web} · … · Pull TYPES · … · Open https://{domain} ↗ · … · DB tunnel from this PC THIS PC*. ⚠️ The box's file is **schema 2**: labels carry placeholders (*Logs · {pm2_web}*) and two commands use `{eco}` / `{pm}` this stage does not know — they render as written, by the rule that a later schema's word must not hide today's actions; chapter 52 fills labels. Palette: `box ›` → the fourteen server actions as *Server: box › …*.

**The door.** *Status · {pm2_web}* on `shop` → within eight seconds an `ssh` and an `OpenConsole`, the terminal's line exactly `ssh -t box tmux new-session -A -s devgo`; on the box `tmux list-windows -t devgo` → `0:bash 1:status-web*` (the new window, **active**) and `capture-pane -t devgo:status-web` showed `pm2 describe shop-web`'s table (*Code metrics value … Heap Usage 95.37 %*). The `ssh` stopped, the window killed on the box, `0:bash` left as before. Refusals over `invoke`: `nope` → *No such action: nope*; `logs-web` on `blog` → *blog has nothing to fill Logs · {pm2_web} with* (its processes are docker, `pm2` null — and the menu had hidden it).

**`/etc`, curated.** The `/etc` group (116) shows `cron.d docker fail2ban letsencrypt mysql nginx postgresql redis ssh systemd ufw` (11) and *105 more system folders. Show all*; click → 116 and *Show developer folders only*; click → 11. **End** from the server row lands on `ufw` — the last row the eye can see. Typed `apparmor` in the card's box → `apparmor.d`, `apparmor` (the search lifts the curation).

`Ctrl+Q`, the two localStorage sets reset, all fifteen files restored and hash-matched, the installed DevGo restarted.

> `✅STAGE: 50 server-apps`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/server_apps.rs      Inventory / Actions; parse_*; placeholders; fill; combined_command / split; append_unlisted; typed_command; check_local (+ 8 tests)
  src/services/mod.rs              the module
  src/services/server_folders.rs   Listed; list() carries the parts; run_remote
  src/commands.rs, lib.rs          ActionOutcome; run_server_action; attach_terminal
  src/error.rs                     ActionRefused, ActionNotFound
src/
  types.d.ts                       ServerApp, ServerInventory, ServerAction(s), ActionOutcome; the curation fields
  serverApps.ts                    appForFolder, placeholders, canFill, appStatus
  etcCuration.ts                   ETC_CURATED, isEtc, curate
  hooks/useServers.ts              showAllIn; visible with app, hidden, curation, domain hits
  components/ServersLane.tsx       hostLine, appTitle, the app dot/domain/ports, the notes, showAllRow
  App.tsx                          runServerAction; actionHint; the entries; the palette
  components/HelpPanel.tsx         the paragraph
```

Knowledge from one script on the same ssh; doors the server declares, filled per row and hidden where they cannot be filled; a line that never meets `cmd`; and an `/etc` that feels intentional.

> **The thread running through this chapter.** The first real listing failed on a `null` the fixture never had, because the box had moved on to schema 2 between the day the fixture was trimmed and the day the code met it. A contract that lives on the server is a contract that changes under you; `serde(default)` and a dropped unknown kind were the design's answer, and `null_as_zero` is the same answer one field later.
