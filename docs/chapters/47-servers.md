# 47 — Your Machines, One Enter Away (post-plan)

**Branch:** `47.servers` — `git checkout 47.servers` gives you this chapter's finished app; `git diff 46.startup-budget 47.servers` is exactly what this chapter adds.

**Starting from:** chapter 46 — DevGo is up in half a second. It knows folders on two filesystems and repositories on GitHub. It does not know the machines you SSH into every day.

**Goal:** a **Servers** card under the GitHub one — every `Host` in `~/.ssh/config` and any machine you type in — where Enter opens a terminal on the box, in a tmux session that survives, exactly the promise a WSL project already gets.

> **Hold on to:**
> 1. **The alias is the truth.** A row that came from `~/.ssh/config` launches as `ssh <alias>` and nothing else; the config carries the key, `IdentitiesOnly`, every option. A rebuilt `-p 9999 user@host` offered the wrong key on this machine. DevGo reads the config and never rewrites what it says.
> 2. **No secrets, ever.** A row is an alias, or a host with a key *path*. There is no password field and there will not be one; `ssh` uses your own keys. The launch is the dev-script path — the terminal's run template with `ssh …` as the command — so nothing new spawns anything.
> 3. **The remote shell reads the line, not yours.** From Windows Terminal to `ssh.exe` nothing interprets a dollar, so `$SHELL` in the fallback must reach the box bare — a `\$` arrives as a literal and `exec '$SHELL'` fails. Test what the box receives (`ssh host 'echo \$SHELL'`), not what you meant.
>
> Rust: `Option<&str>` through one `present()` helper instead of four `as_deref().filter(...)` chains; a `let … else` in `update`; `serde(default = "fn")` for a `bool` whose default is `true`. TypeScript: a form as a `FIELDS` table mapped once, one `set(key)(value)` for every input; `Omit<Server, 'id'> & { id?: string }` as the draft type.

> The plan was checked against a real machine first, and the machine set the one rule that shapes everything here: `ssh box` works and `ssh -p 9999 user@203.0.113.7` does not. Two machines to start with — a VPS and a box on the LAN.

**One more card.** The list is one table with cards (chapter 43), so the servers are **one more card** after GitHub, in the four columns every row shares: where it reaches (`user@host`) in the workspace column, the name where the location goes (the click target, as on every other row), **`SSH`** as its file system in emerald, and the meta cell with `:port` (not 22), *tunnel*, *tmux*. No fourth lane, no fifth grid column, no empty cell over the card on the search line. `ServersPanel` and `ServerForm` use the `target` and `primary` variants of the one `Button`, the form's fields are a table, and there is no `useCallback` (React Compiler).

---

## 47.1 — A row is an alias

`services/servers.rs`: `Server { id, name, alias: Option<String>, host, user, port: Option<u16>, identity /* a PATH */, default_path, tmux: bool (default true), session, tunnel, source }`, every optional field `serde(default)`. `ssh_target()` — the alias alone when there is one; else `-p` when the port is not 22, `-i "<key>"`, `user@host`. `ssh_command()` — `ssh <target>` with tmux off; with it on, `ssh -t <target> "command -v tmux >/dev/null 2>&1 && tmux new-session -A -s <session> || exec $SHELL -l"` (`-A` attaches or creates, `-t` gives it a tty, a box without tmux gets a login shell instead of an error; the session is `devgo` unless the row says otherwise). `scp_prefix()` — `alias:` or `user@host:`. `slug(name)` — lowercase, `-` for anything else, `server` when nothing is left. Five tests: the alias-only line, a manual server's `-p -i user@host`, tmux off, the scp prefix, the slug.

> `✅SERVERS: server row and its ssh line`

## 47.2 — The store

`ServersStore` on `servers.json` through `parse_or_backup` — the `GithubStore` shape: `list`, `get`, `add` (a slug id, `-2`, `-3` on a clash), `update`, `remove`, and `upsert_from_config`, which merges an import in **by alias** and keeps what you set by hand — `name`, `default_path`, `tmux`, `session` — while taking the config's host, user, port, key and tunnel. One test: the round trip, the clash suffix, a hand-set path surviving a re-import that changed the port, the file re-read.

> `✅SERVERS: servers store` — `cargo test` **164**.

## 47.3 — `~/.ssh/config`, read and never written

`services/ssh_config.rs::parse`: `Host` blocks (one or many names a line), `HostName`, `User`, `Port`, `IdentityFile`, and `LocalForward` → `tunnel`; `=` and any case tolerated; a bare `Host` with no `HostName` is its own hostname. Wildcards (`*`, `?`, `!`) and `Match` blocks are rules, not machines, and are skipped — a `Match` block's `User` must not leak into the host above it. `default_path()` = `%USERPROFILE%\.ssh\config` here, `~/.ssh/config` elsewhere. Three tests against a fixture shaped like a real file (a bare host, the VPS, a tunnel alias to the same box, `Host *`, a `Match`, `Host a b`). ⚠️ At this branch's tip the two fixtures (`servers.rs`, `ssh_config.rs`) and the form's placeholders still name a real box — host, IP, user, key; chapter 69 generalises the host and IP to `box` / `203.0.113.7`, and a later commit on `main` (`✅FIX: fixtures and placeholders name nobody`) generalises the rest — the ssh-config fixture's user and key name and the form's placeholders. The text here uses the generalised names, so `git diff` shows names the chapter does not.

> `✅SERVERS: ssh config parser` — **167**.

## 47.4 — The commands

`AppState.servers_store`; `get_servers` · `add_server` · `update_server` · `remove_server`; `import_ssh_config` — reads the file, parses, upserts, answers `(added, updated)`; an explicit ask from Settings, the palette or the card, never on launch; `has_ssh` = `editors::is_on_path("ssh")` — the card exists only when there is a client; `open_server(id, target_id)` — the row through the **default terminal's run template** with `ssh_command()` as the command (`launch_with_command`), a stand-in Windows project at the home directory (a server is not a folder); `server_commands(id)` — the `ssh …` line and the scp prefix, for the menu to copy. Registered, the store built beside the GitHub one in `setup()`.

> `✅CMD: server commands and the store` — `cargo check` 0 warnings.

## 47.5 — Types, hook, card

`types.d.ts`: `Server`, `ServerDraft`, `ServersState`, the four component props, `ServerMenu`; `NavRow` gains `{ kind: 'server'; server }`; `ProjectTreeProps` gains `servers` + three doors; `SettingsProps` gains `servers`, `onAddServer`, `onEditServer`, `onImportSsh`. `hooks/useServers.ts`: the list, `hasSsh`, `isOpen` (remembered as `devgo.serversOpen`), `add` / `update` / `remove` / `importSshConfig`, each reloading after — no `useCallback`. `components/ServersLane.tsx`: `ServerRow` in `col` with the name as the click target and a `metaWords` table; the card with `border-t-emerald-400/50 border-l-emerald-400/50`, a header that collapses like a workspace's (`0fr` → `1fr`), *none yet* / *N machines*, a ghost **+ Add** in the count column that opens a menu at its rect.

> `✅TYPES: server row, state and props` · `✅HOOK: servers` · `✅UI: servers card`

## 47.6 — The tree and the keys

`ProjectTree`: `serverCursor` beside `repoCursor`, both cleared when the selection changes; the rows sequence ends with the servers when the card is open, so ↑ from the first server lands on the last GitHub row and End lands on the last server; `selectServer` clears the repo cursor and vice versa; `openServer()` on the handle; Enter with a server under the cursor opens a terminal on it, and the workspace keys are off. `cursorLit` counts a server cursor, so the selected project dims while a server is lit — the strong blue is always the row Enter acts on. The card renders after GitHub, in the empty-projects view too, and *No projects found* only when neither card exists.

> `✅UI: servers in the tree and the keys`

## 47.7 — The form, the panel, the app

`ServerForm.tsx`: a `FIELDS` table (name · alias · host · user · port (digits only) · key path · default path) mapped into the grid, the tmux pair on `target` Buttons, the session box disabled with tmux off, *Add server* / *Save* on `primary`; valid = a name and an alias or a host; the draft carries `id` only when editing. `Settings › Servers` (`ServersPanel`): the rows with a *config* badge for imported ones and *tunnel*, the ssh line under the name, **tmux** as an inline `target` toggle (`aria-current` when on), *Edit*, *Remove*, then *Add server…* / *Import from ~/.ssh/config* (disabled without a client, with a sentence naming the Windows optional feature). `App`: `useServers()`; `openServer` (the `open_server` invoke), `importSsh` (the toast says *Imported N new, M updated* or *Nothing new*), `copyServerLine`, `saveServer`; the row menu — *Open terminal ⏎ · Copy ssh command · Copy scp prefix · Edit… · Remove* (a confirm sheet titled *Remove server*: *Your ssh config and keys are untouched*); the **+** menu — *Add a server…* / *Import from ~/.ssh/config*; the add/edit form in a right `Drawer` (640 px); palette: *Settings: Servers*, *Server: open ‹name›* per row, *Servers: import…*, *Servers: add…*. Help gains a *Servers* section before *Keyboard*.

> `✅UI: server form` · `✅UI: servers panel in settings` · `✅UI: servers in app, menu and palette` · `✅UI: help says servers` — `tsc -b` and `bun run build` clean.

## 47.8 — Verify

`cargo test` **167**, `cargo check` 0 warnings, `tsc -b`, contrast and `bun run build` clean. All fifteen app-data files backed up by hash. Headless over CDP on a real `servers.json` with two imported rows; the distro stayed stopped throughout.

**Three FIXes, found before and during the run.**

1. **`\$SHELL` reached the box as a literal.** Checked first from PowerShell: `ssh box 'echo A=\$SHELL; echo B=$SHELL'` printed `A=$SHELL` and `B=/bin/bash`. Nothing between Windows Terminal and `ssh.exe` reads a dollar, so the `\$` escape — right inside a `bash -lc "…"`, which a server never goes through — would have made the no-tmux fallback `exec '$SHELL'` and fail. The line now carries `$SHELL` bare and the test asserts no backslash in it. `✅FIX: the fallback shell reaches the box unescaped`.
2. **The cards were shrinking instead of the list scrolling** — since chapter 43, on any list taller than the window. Read live: the scroller's `scrollHeight == clientHeight` (1165) while `01_tauri` was 186 px of its 614 and the GitHub card 362 of 1198, every card `flex-shrink: 1`, rows clipped under the card's edge. `shrink-0` on `card` in `rowStyles.ts`; after HMR `0/3513/1165`, zero clipped cards, the list scrolls. `✅FIX: cards keep their height, the list scrolls`.
3. **A missing server said *No such editor or terminal*** (the first cut reused `TargetNotFound`). `AppError::ServerNotFound` — *No such server: nope* over `invoke`. `✅FIX: a missing server says server`.

**The card.** `▼ Servers · 2 machines · + Add`, then `lanbox | lanbox | SSH | tmux` and `user@203.0.113.7 | box | SSH | :9999 tmux`; the card's top/left edges `oklab(0.765 −0.169 0.051 / 0.5)` 2 px, `SSH` in `oklch(0.845 0.143 165)`, radius 12. Click on the name lights the row (`bg-bg-selected`); ↑ → `lanbox`, ↑ → `blog` (the last GitHub row), End → `box`. Right-click: *Open terminal ENTER · Copy ssh command · Copy scp prefix · Edit… · Remove*. **+ Add** → *Add a server… / Import from ~/.ssh/config*, the header's arrow still `▼` (the click did not toggle it).

**Add.** *Add a server* drawer, focus in *Name*; nine labels; *Session* current, *Add server* disabled until a name and a host. Typed `Local box` / `203.0.113.8` / `user` / port `2a2b` → `22`; *Plain shell* → the session box disabled; *Add server* → toast *Added Local box*, the drawer closed, `3 machines`, the row `user@203.0.113.8 | Local box | SSH` with no port and no tmux word. `server_commands` over `invoke`: `["ssh user@203.0.113.8", "user@203.0.113.8:"]`, `["ssh box", "box:"]`, `["ssh lanbox", "lanbox:"]`.

**Edit.** *Edit…* → *Edit Local box* with every value back; renamed *Local*, *Session*, session `work`, *Save* → toast *Saved Local*, the row's tmux word titled *tmux session work on the server*; `servers.json`: `"name": "Local", "tmux": true, "session": "work"`, the id still `local-box`.

**Settings › Servers.** *Machines*, the sentence, three rows (`lanbox · config · ssh lanbox`, `box · config · ssh box`, `Local · ssh user@203.0.113.8`), each *tmux · Edit · Remove*; the tmux toggle on *Local* went `aria-current="true"` → `null` on a click. **Import** → toast *Imported 2 new, 2 updated from ~/.ssh/config*: `box-db` (**tunnel** — its `LocalForward`) and `lan` added, `lanbox` and `box` updated (the file has four `Host` lines, the first indented). `~/.ssh/config` untouched (same size, same mtime).

**Palette.** `server` → *Server: open lanbox — ssh lanbox*, *Server: open box — ssh box*, *Server: open Local — ssh user@203.0.113.8*, *Servers: add a server…*, *Settings: Servers*; `settings: servers` + Enter opened the panel.

**Remove.** `lan` → *Remove* (danger, `rgb(251,113,133)`) → the sheet *Remove server · Remove lan from the list? Your ssh config and keys are untouched.* with focus on *Cancel*; *Remove* → `4 machines`, the row gone, the file has four ids.

**The launch.** `box` selected, Enter: within six seconds an `ssh` (24392) and an `OpenConsole` started, the command line exactly `ssh -t box "command -v tmux >/dev/null 2>&1 && tmux new-session -A -s devgo || exec $SHELL -l"`; on the box `tmux ls` showed `devgo: 1 windows … (attached)`. The `ssh` process stopped (the tab with it); `wsl -l --running` → *There are no running distributions*.

**Collapse.** The header → `▶`, the rows' box 0 px, End lands on `blog`, `devgo.serversOpen` = `0`; the header again → `1`. Help: *GitHub · Servers · Keyboard* in that order.

Not verified: the card hidden without an `ssh` client (this machine has one; the gate is `has_ssh` → `servers?.hasSsh` in the tree and `disabled` on the panel's doors). `Ctrl+Q`, all fifteen files restored and hash-matched, the installed DevGo restarted.

> `✅STAGE: 47 servers`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/servers.rs        Server; ssh_target / ssh_command / scp_prefix; slug; ServersStore (+ 6 tests)
  src/services/ssh_config.rs     parse; default_path (+ 3 tests)
  src/services/mod.rs            the two modules
  src/error.rs                   ServerNotFound
  src/commands.rs, lib.rs        servers_store; eight commands, registered
src/
  types.d.ts                     Server, ServerDraft, ServersState, the props, ServerMenu; NavRow 'server'
  hooks/useServers.ts            the list, hasSsh, isOpen, the edits, the import
  components/ServersLane.tsx     the card and its rows
  components/ServerForm.tsx      add / edit, fields as a table
  components/ProjectTree.tsx     serverCursor, the walk, Enter, the card after GitHub
  components/Settings.tsx        ServersPanel; the servers entry
  components/HelpPanel.tsx       the Servers section
  components/rowStyles.ts        FIX: shrink-0 on card
  App.tsx                        useServers; the menus, the drawer, the palette entries, the props through
```

Every machine in your ssh config is a row; Enter puts you in a tmux session on it that outlives the terminal, the window, the day. The alias is the truth, the config is never written, and the only thing DevGo ever stores about a box is how to name it.

> **The thread running through this chapter.** A fourth lane would have meant a fifth grid column; a card grows nothing — the four columns already had a place for a host, a name, a file system and a meta cell. And the one line that matters, the `ssh …` the terminal runs, was tested against what the box receives rather than what the string looks like: that is where the chapter's first bug was.
