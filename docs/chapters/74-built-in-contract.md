# 74 — Set Up This Box

**Branch:** `74.built-in-contract` — `git checkout 74.built-in-contract` gives you this chapter's finished tree; `git diff 14c686d 74.built-in-contract` is exactly what this chapter adds.

**Starting from:** `main` after 73 (`14c686d`). Written from the public work itself.

**Goal:** 73 shipped the server side of the contract as three files and a paragraph that said *`scp` them, `chmod +x`, press ↻*. The README's own Next section promised the app would carry them. This chapter keeps that promise: the three files ride inside the binary, a server row's menu gets *Set up this box…*, one ssh reads what `~/scripts` already holds, a sheet says per file what will happen, and one more ssh writes the missing ones and sets their modes. The rule that keeps your box yours: **a file that is on the box and differs is never overwritten** — a box's own inventory or a hand-edited actions file wins over the shipped one, and the sheet says *yours, kept as it is*.

## Also since 73

- `14c686d ✅DOCS: screenshot, the server actions` — a new frame, `docs/screenshots/windows/05-server-actions.png` (right-click on a server row: the local hosts, the folder asks, then the box's own declared actions in sections, the copy lines, *Edit…*), and its caption line in `docs/screenshots/README.md`. `02-app-actions.png` is untouched.

> **Hold on to:**
> 1. **`include_str!` puts a file in the binary at compile time.** The path is relative to the source file (`../../../server/devgo-inventory.sh` from `src-tauri/src/services/`), the result is a `&'static str`, and a change to the file rebuilds the crate. It costs nothing at runtime and needs no bundle resource, no path lookup, no install step — the app *is* the copy. One `lf()` over it, because a checkout that rewrote the script to CRLF must not ship a script bash cannot run.
> 2. **A `Command` can be fed on stdin.** `.stdin(Stdio::piped()).spawn()`, `write_all` into `child.stdin.take()`, drop it (the close is the EOF), then `wait_with_output()`. That is how bytes reach a box through the ssh the app already has, without `scp`, temp files or a second protocol: `ssh <box> 'mkdir -p ~/scripts && cd ~/scripts && awk … && chmod …'` with the files on its stdin, framed by mark lines the remote `awk` splits on (`/^__DEVGO_PUT__ /{f=$2; next} {print > f}` — awk opens a new output at every mark and prints every other line into the one that is open).
> 3. **Look before you write, and never write over what differs.** The probe (`if [ -e ~/scripts/$f ]; then echo "__DEVGO_HAVE__ $f"; cat …; fi` per file) brings back what is there; the plan compares bytes (line endings and trailing whitespace forgiven) and marks each file *missing* · *same* · *differs*; only *missing* is written. The sheet shows the plan before the click. The same seam takes a scratch directory, which is how the write is proved on a real box without touching `~/scripts`.

---

## 74.1 — The server files ride in the binary

`src-tauri/src/services/server_setup.rs`. `Bundled { name, body, executable, private }` and `bundled()` — the three files through `include_str!` and `lf()`: `devgo-inventory.sh` (+x), `site-new.sh` (+x), `devgo-actions.json` from `devgo-actions.example.json` (600: whoever can edit it decides what a click runs). `DIR = "~/scripts"`. `check_dir` — a directory the remote shell can take unquoted (`~`, `/`, `.`, `_`, `-`, alphanumerics; refuses a space, a quote, `$`, `;`).

The probe: `probe_command(dir)` is one `for f in …; do if [ -e dir/$f ]; then echo "__DEVGO_HAVE__ $f"; cat dir/$f 2>/dev/null; fi; done` — a file that is not there prints nothing, so absence is the answer; `-e`, not `-f`, so a directory in the way counts as present. `parse_probe` reads it back into name → contents.

The plan: `FileStatus::{Missing, Same, Differs}` (serde lowercase), `SetupFile { name, status, bytes, install }`, `SetupPlan { dir, files }`; `plan(dir, existing)` compares through `same()` (`lf` + `trim_end` both sides) and sets `install` only on *missing*.

The write: `put_input(names)` frames each chosen file under `__DEVGO_PUT__ <name>`; `put_command(dir, names)` is `mkdir -p dir && cd dir && awk '…' && chmod +x <scripts chosen> && chmod 600 <json if chosen>` — only the files being written get a `chmod`, so a kept file's mode is not changed under the user.

Nine tests: the three files are there, LF only, the scripts start with the shebang; the dir check; the probe line; the probe parse (absence is absence); the plan on a box with a CRLF copy of the shipped inventory (*same*), no `site-new.sh` (*missing*) and its own actions (*differs*); a fresh box installs all three; the put line with and without the json; the put input reads back through `parse_probe` byte for byte; no bundled line looks like a mark.

> `✅RUST: the server files ride in the binary`

## 74.2 — One ssh can carry bytes on stdin

`server_folders.rs`: the argument list every ask shares becomes `ssh_command(server, remote) -> Command` (`BatchMode=yes`, `ConnectTimeout=5`, `StrictHostKeyChecking=accept-new`, the target, the remote line); `ssh()` is `output()` + `finish()`, and `ssh_with_input()` is the piped-stdin twin from *Hold on to* 2, through the same `finish()` (255 is ssh's own failure, anything else is the remote command's). Two doors for the setup: `read_remote` (the probe's output is the answer) and `put_remote` (the write, nobody reads the output).

> `✅RUST: one ssh can carry bytes on stdin`

## 74.3 — Plan and apply

`commands.rs`: `plan_server_setup(id, dir?)` — the row's server, `check_dir` (`SetupRefused`, a new `AppError` variant), the probe on a blocking thread, `plan()`; `apply_server_setup(id, dir?, names)` — the names filtered against `bundled()` (an unknown name is ignored, an empty result is *Nothing to install: every file is already on the box*), `put_command` + `put_input` through `put_remote`, the count back. `dir` is `None` from the app (`~/scripts`); a scratch directory is the verify seam. Both registered in `lib.rs`.

> `✅RUST: plan and apply a box's setup`

## 74.4 — The sheet and its hook

`types.d.ts`: `SetupFileStatus`, `SetupFile`, `SetupPlan`, `SetupRequest { server, plan | null }`, `ServerSetupState { request, busy, open, confirm, close }`, `SetupSheetProps`. `hooks/useServerSetup.ts` (`refresh`, `onDone`, `onError`): `open(server)` sets the request with no plan and asks `plan_server_setup`; `confirm()` sends the *install* names to `apply_server_setup`, clears the sheet, toasts through `onDone`, then `refresh(server.id)` — the ↻ that lists the apps; `close()` only while not busy. `components/SetupSheet.tsx`: a top `Drawer` at z 50 titled *Set up ‹name›*, one sentence, *Looking at the box…* until the plan, then one `li` per file (name, KB, the status word — `will be installed` in accent, `already there` muted, `yours, kept as it is` secondary), and `Cancel` · `Install N file(s)` (primary; *Nothing to install* disabled when N is 0; *Installing…* while busy).

> `✅REACT: the setup sheet and its hook`

## 74.5 — From the row

`App.tsx`: `const setup = useServerSetup(servers.listFolders, toast, toast)`; the row menu gains *Set up this box…* (hint *the inventory and actions, into ~/scripts*) after *List another folder at top level…* and before the declared actions; the palette gains `Server: set up ‹name›` per server; `<SetupSheet {...{ setup }} />` beside the confirm dialogs; `onServerSetup: setup.open` into `ProjectTree` → `ServersLane`'s `onSetup`. `ServersLane.tsx`: the *No inventory on this box* note under an up server gains a ghost *Set up this box…* button.

> `✅REACT: set up this box from the row`

## 74.6 — The readme

Root `README.md` › Servers: the paragraph naming the three files now says the app carries them — right-click, *Set up this box…*, one ssh, a differing file is yours and left alone — with `scp` as the by-hand way; the 🗺️ Next section drops the bullet. `server/README.md` › Install: the menu way first (what each status word means, what the write does, the kept rule and *delete it there first if you want the shipped one*), then the two `scp` lines.

> `✅DOCS: set up this box, the readme`

## 74.7 — Verify

On the dev build over CDP (the installed DevGo closed first, 16 app-data files backed up by hash), against a real box, alias `box`:

- **The three refusals**, by `__TAURI_INTERNALS__.invoke`: id `nope` → *No such server: nope*; `dir: '~/my scripts'` → *not a plain directory path: ~/my scripts*; `names: []` → *Nothing to install: every file is already on the box*.
- **The plan on `~/scripts`, read-only, 1.3 s**: `devgo-inventory.sh` **differs** (15 671 bytes shipped; the box's is its own), `site-new.sh` **missing** (the box has an older site script under another name), `devgo-actions.json` **differs** — `install` true on `site-new.sh` only.
- **The write, into a scratch directory**: `apply_server_setup` with `dir: '/tmp/devgo-setup-74'` and all three names → **3** in 0.95 s; `plan_server_setup` on that dir → every file **same**, `install` false. On the box: `-rwxrwxr-x` on the two scripts (the box's umask is 002; `+x` is what was asked), `-rw-------` on the json; `bash -n` on both scripts clean; `jq empty` on the json clean; **sha256 of all three equal to the repo's** (`0ebb2c77…`, `dc3ef429…`, `2f2920ce…`); `bash devgo-inventory.sh` from there printed the document (23/23 pm2, 22 sites); `site-new.sh demo74 demo74.example.com 3074 --dry-run` ended in *dry run: nothing was written, enabled or reloaded*. Then `rm -rf /tmp/devgo-setup-74`: *No such file or directory*. `~/scripts` untouched: no `site-new.sh` there before or after.
- **The row menu**: right-click `box` → `… List folders & apps · List another folder at top level… · Set up this box… (the inventory and actions, into ~/scripts) · Inventory (JSON) …` — the entry between the folder line and the declared actions.
- **The sheet**: click → title *Set up box*, *Looking at the box…*, then the three lines `devgo-inventory.sh 15 KB yours, kept as it is · site-new.sh 6 KB will be installed · devgo-actions.json 7 KB yours, kept as it is`, buttons *Cancel* · **Install 1 file**. **Cancel** — the install onto the real `~/scripts` is the owner's click, not a verify step; the sheet closed, nothing written.
- **The palette**: *Commands* → `set up` → `Server: set up box` and `Server: set up lanbox`, subtitle *The inventory script and the actions file, into ~/scripts; yours are kept*; Escape.
- **The lane note's button — not provable live**: it renders under a server that is *up* with no inventory, and the rows at hand are `box` (up, has one) and `lanbox` (down: *Connection timed out*). The markup is read in `ServersLane.tsx`; no server was added to the real `servers.json`.
- **After**: the dev build stopped (1420 and 9223 free), app-data restored by hash (only `instance.lock` and `projects-cache.json` had moved; 0 mismatches after), the installed DevGo relaunched via `explorer.exe`. WSL was already running and was not touched.
- **Gates**: `cargo fmt --check` clean, `cargo check` 0 warnings, `cargo test` **218** (209 + 9), `tsc -b` clean, `bun run build` clean (`contrast ok: 6 palettes x 8 rules, 5 lane hues`). CI run `35185613172` on `373a410`: success.
- **Hygiene**: the grep from 73 over the changed files → 0.

> `✅STAGE: 74 built-in-contract`; fetch (nothing new), ff-merge; push `main` + branch.

## 74.8 — Deferred

- **A shipped file newer than the box's cannot be installed over it** without deleting the old one there by hand: *differs* is *differs*. A version line inside each file (`# devgo-inventory.sh v2`) would let the plan say *older, will be updated* for a file that is ours and behind, and still keep one that is not ours.
- The lane note's *Set up this box…* button was not exercised on a live row (no up server without an inventory in the rows at hand).
- The *Install* click on a real `~/scripts` — the owner's, when they want `site-new.sh` there.
- 73.7's other items still stand: the `pm2 pid` presence check, `sysctl` twins for a box without `/proc`, TLS elsewhere than certbot.

---

## What you built

```
src-tauri/src/services/server_setup.rs   the three files via include_str!, the probe, the plan, the put line and its stdin frame; 9 tests
src-tauri/src/services/server_folders.rs ssh_command shared; ssh_with_input; read_remote, put_remote
src-tauri/src/services/mod.rs            pub mod server_setup
src-tauri/src/commands.rs                plan_server_setup(id, dir?), apply_server_setup(id, dir?, names)
src-tauri/src/error.rs                   SetupRefused
src-tauri/src/lib.rs                     the two commands registered
src/types.d.ts                           SetupFileStatus, SetupFile, SetupPlan, SetupRequest, ServerSetupState, SetupSheetProps; onServerSetup / onSetup
src/hooks/useServerSetup.ts              open → probe → plan; confirm → write → toast → ↻
src/components/SetupSheet.tsx            the plan as a sheet: one line per file, Cancel · Install N files
src/App.tsx                              the row menu entry, the palette entry, the sheet
src/components/ProjectTree.tsx           threads onServerSetup to the lane
src/components/ServersLane.tsx           the no-inventory note offers the install; onSetup
README.md, server/README.md              the menu way, the kept rule, scp as the by-hand way
```

- **The app carries the contract** — a box that has nothing gets everything from one menu entry.
- **Two ssh, no scp** — the probe and the write, bytes on stdin, awk at the other end.
- **Yours is yours** — a file that differs is never overwritten, and the sheet says so before the click.
- **Proved on a real box without touching it** — the same seam takes a scratch directory.
