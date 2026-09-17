# 75 — The Attach View

**Branch:** `75.attach-view` — `git checkout 75.attach-view` gives you this chapter's finished tree; `git diff 373a410 75.attach-view` is exactly what this chapter adds.

**Starting from:** `main` after 74 (`373a410`). Written from the public work itself.

**Goal:** The ask, 2026-09-17: *"in some future time we'd add integrated attachable reattachable terminal?"* The launcher already names a multiplexer session after every project and every server, and a terminal launch reattaches. This chapter opens that session **inside DevGo**: a pane under the lanes with a real terminal emulator in it, whose child is the multiplexer *client* — `psmux attach` for a Windows project, `tmux attach` inside the distro for a WSL one, `ssh -t … tmux new-session -A` for a server. *Detach* ends the client and the session keeps running where it was. The README's line *"It is not an editor, a terminal or a git client"* stays true, and the new paragraph says why: the pane has no shell of its own and cannot open one. It is an attach view.

## Also since 74

Nothing: `main` did not move between `373a410` and this branch.

> **Hold on to:**
> 1. **A pty is a file you read and write.** `portable-pty` opens a pair: the *slave* end is the child's terminal (it thinks it is talking to a real one, so it draws colours, a status line, a cursor), the *master* end is ours. A thread reads the master and every chunk is what the child printed; a write to it is what the child receives as typed keys; `resize` tells it the new grid. On Windows this is ConPTY, on a Mac a `/dev/ptmx` pair, and the crate hides the difference behind `MasterPty` / `Child`.
> 2. **The client / session split is why close = detach.** A tmux or psmux session lives in a *server* process; what the pane spawns is an `attach` *client*. Killing the client (`ChildKiller::kill`) is the same as closing the terminal window it would have run in: the server notices the client is gone and the session goes on, windows and all. There is no path from the pane to a kill-session, and the exit event that follows is the pane's way of saying *detached*.
> 3. **A stream over a Tauri channel.** A command argument typed `Channel<InvokeResponseBody>` is a callback the frontend handed over; `send(InvokeResponseBody::Raw(bytes))` delivers the bytes as an `ArrayBuffer` in order (small chunks by `eval`, big ones through a fetch, an index keeps them in sequence). It is the current way to stream from a Rust thread into the webview, cheaper than an event carrying base64. The exit goes as an event instead, since by then the channel's owner may be gone.

---

## 75.1 — portable-pty in the tree

`Cargo.toml`: `portable-pty = "0.9.0"`. `cargo tree -p portable-pty` says what it leans on: `anyhow`, `bitflags 1`, `downcast-rs`, `filedescriptor`, `lazy_static`, `libc`, `log`, `nix 0.28` (unix), `serial2`, `shared_library`, `shell-words`, `winapi`, `winreg`; the lock gains ten packages (the crate itself, `cfg_aliases`, `downcast-rs`, `filedescriptor`, `lazy_static`, `nix`, `serial2`, `shared_library`, `shell-words`, `winreg` — `anyhow`, `libc`, `log` and `winapi` were already in the tree).

> `✅RUST: portable-pty in the tree`

## 75.2 — Attach lines and a pty registry

`src-tauri/src/services/pty.rs`. `AttachTarget` (`#[serde(tag = "kind")]`: `project { project }` or `server { id }`), `AttachLine { exe, args, session, place }` with `display()` for the header's tooltip.

The lines, pure: `project_line(project, running)` — a WSL path is `wsl -d <distro> -e tmux attach -t =<session>` and a stopped distro is `WslNotRunning`, never a boot; a local path is `<LOCAL_MUX> attach -t =<session>` (`sessions.rs` lends its `LOCAL_MUX`, `psmux.exe` on Windows, `tmux` elsewhere), the session from `launcher::tmux_session_name` so the pane and the launch agree by construction. `server_line(server)` — `ssh -t <target words> tmux new-session -A -s <session or devgo>`, the same attach-or-create line the terminal runs, the key path bare (a spawn, not a line typed into a shell); a row whose tmux flag is off is `AttachRefused` (a new `AppError` variant): there is no session to attach to.

The registry: `Registry { next, panes }`, one `Pane { master, writer, killer }` per open pty; the child itself is owned by the thread that waits on it. `open(line, cols, rows, on_data, on_exit)` opens the pty at the pane's size, spawns the line with `TERM=xterm-256color`, drops the slave, and starts two threads: `<id>-read` (8 KB reads, each chunk to `on_data`, EOF or an error ends it) and `<id>-wait` (`child.wait()`, then `on_exit(id, code)`). `write` (`write_all` + `flush`), `resize`, `close` (remove the pane, `kill` the client — a child that already ended is a detach that already happened), `forget` (the exit path's half of close: nothing to kill).

`commands.rs`: `AppState.ptys: Mutex<pty::Registry>`; `pty_open(target, cols, rows, on_data: Channel<InvokeResponseBody>, app, state) -> AttachOpened { id, line, session, place }` — the target resolved to its line (the servers store, or `running_for` the project), then `open` with two closures: the data one sends `Raw(bytes)` down the channel, the exit one forgets the pane and emits `devgo://pty-exit` with `{ id, code }`; `pty_write(id, data)`, `pty_resize(id, cols, rows)`, `pty_close(id)`. All four registered in `lib.rs`; the field initialised beside the stores.

> `✅RUST: attach lines and a pty registry`

## 75.3 — The tests

Seven: a local project attaches through the platform's multiplexer (`LOCAL_MUX attach -t =<name>`, the session round-trips the launcher's name, `display()` joins); a WSL project attaches inside its running distro (`wsl -d Ubuntu -e tmux attach -t =app-…`, the distro matched case-insensitively); a stopped distro is refused, not booted; a server attaches or creates its session with the key bare (`-t -p 2222 -i C:\…\id_ed25519 user@203.0.113.7 tmux new-session -A -s devgo`, a named row ends in its name); a server with tmux off has nothing to attach; an unknown pane is refused everywhere (write, resize, close; forget is silent); **a real pty and a program that does not exist**: the spawn fails with `LaunchFailed`, no thread starts, the registry holds nothing — on Windows this opens a ConPTY, on a Mac a ptmx pair, and both are on the CI runners.

> `✅TEST: the attach lines and an empty registry`

## 75.4 — xterm in the tree

`bun add --exact @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0`. Pinned exact (the other runtime dependencies float on a caret): a terminal emulator's minor releases change how bytes render, and the pane should not move under a `bun install`.

> `✅REACT: xterm in the tree`

## 75.5 — The hook and its pane

`types.d.ts`: `AttachTarget`, `AttachOpened`, `PtyExit`, `AttachStatus` (`opening · attached · ended`), `AttachPane` (`seq` bumps on every open so the mount effect runs once per pane; `id / session / place / line` from Rust; `status`, `code`), `AttachState { pane, host, open, detach }`, `AttachPaneProps`; `'attach'` joins `ShortcutId`. `shortcuts.ts`: the row `attach · Ctrl+Shift+A · Attach session here / detach` (group *Project*), and `PANE_KEYS` = the palette and the attach key — `paneOwns(e)` says whether a keydown inside `[data-attach]` is the shell's.

`hooks/useAttach.ts`. `open(target, title)` sets the pane at `opening`; `detach()` sets it to null. One effect on `pane?.seq` owns the pty's whole life. It loads xterm lazily (`import('@xterm/xterm')` and the fit addon — **xterm rides its own chunk**, 331 KB, so a launcher that never attaches never loads it; the main chunk went 396 → 402 KB), builds the `Terminal` with the palette's tokens read off `:root` (`--color-text-primary` ink, `--color-accent` cursor, `--solid-bg-selected` selection, `--font-mono`, a transparent background so the pane's own `bg-panel` — which follows the knob — shows through), fits it to the host, focuses it, and tells xterm to leave `PANE_KEYS` alone (`attachCustomKeyEventHandler`) so they bubble to the app. Then, **the listener first, then the spawn**: `listen('devgo://pty-exit')` and only in its `.then` `invoke('pty_open', { target, cols, rows, onData: channel })` — a client that dies at once must not end before anyone is listening; an exit that still lands before the id is known is stashed by id and replayed. `channel.onmessage` writes the bytes into xterm; `term.onData` is `pty_write`; `term.onResize` is `pty_resize`, driven by a `ResizeObserver` that refits on every size change of the host. The cleanup stops the listener, disconnects the observer, disposes the subscriptions, **closes the pty if it still has an id**, and disposes the terminal — so replacing the pane and dropping it are the same detach.

`components/AttachPane.tsx` (imports `@xterm/xterm/css/xterm.css`): a `section[data-attach]` at **40 % of the window height** under the lanes — fixed for v1, said so in Deferred — with a header: the title, `session · place` (the line as its tooltip), the rows' 7 px light (lit accent while attached, hollow after), the status word, and a ghost `Button` *Detach* (or *Close* once ended) carrying the key. The body is the hook's `host`.

> `✅REACT: the attach hook and its pane`

## 75.6 — The doors

`App.tsx`: `const attach = useAttach(e => toast(showError(e)))`, `attachProject(p)` / `attachServer(s)`. A project row's menu, under the live chip, gains *Attach here · Ctrl+Shift+A* before *Kill session*. A server row's menu gains *Attach here* after its local hosts, greyed *tmux on the box is off* when it is. The palette gains `Attach: ‹project›` per live session, `Attach: ‹server›` per server (disabled when its tmux is off) and `Attach: detach from ‹name›` while a pane is open. The key: with a pane open it detaches; else the server under the cursor; else the selection when it has a session; else a toast. The handler's first line is `if (paneOwns(e)) return;` — `Ctrl+L`, `Ctrl+K`, `Ctrl+R`, Escape typed into the pane are the shell's. `<AttachPane {...{ attach }} />` sits between the lanes and the footer. `StatusBar.tsx`: a server row's Terminal group ends in *Attach here* (blocked with the reason when tmux is off), routed to `onServerAttach`.

> `✅REACT: attach from the row, the footer and the palette`

The palette rows and the key follow `tmuxOn` like the chip does: with the multiplexer off in Settings there is no chip, so no door.

> `✅REACT: attach doors follow the tmux switch`

## 75.7 — Verify

On the dev build over CDP (the installed DevGo closed first, 16 app-data files backed up by hash; `tmux_config.enabled` set on for the test — it was off — and `prefs.json` restored after):

- **Local, from the row.** `psmux.exe new-session -d -s devgo-90323b10 -n t` (the `devgo` project's session name), reload → the `live` chip on `devgo`; its menu reads `… Attach here · Ctrl+Shift+A · Kill session · …` under the agent entries. Click → the pane: header `devgo · devgo-90323b10 · psmux on Windows · attached · Detach · Ctrl+Shift+A`, tooltip **`psmux.exe attach -t =devgo-90323b10`**, 557 px tall (40 % of 1392), **30 rows**, the shell's banner in it, focus on xterm's textarea. `echo hi75` typed through CDP's `Input.insertText` + Enter → `> echo hi75 / hi75 /` and psmux's own status line. **Resize:** `unmaximize` (the saved 900×720 rect) → **14 rows**, the status line 113 columns; `maximize` (2560×1392) → **30 rows, 326 columns** — psmux redrew to the size `pty_resize` sent. **Detach** (the header button) → the pane is gone, `psmux list-sessions` still lists `devgo-90323b10`, `list-clients` empty, the `psmux.exe attach` process ended and the `server` process (the session) still there. **Never kills.**
- **The palette and the exit event.** *Commands* → `attach` → `Attach: devgo · Its session, in a pane under the lanes · Ctrl+Shift+A | Attach: box … | Attach: lanbox …`; the first row → attached again; `psmux kill-session -t =devgo-90323b10` from outside → the header reads `… detached · Close`, the terminal's last line **`[detached · exit 0]`**. A second `Attach: devgo` on the now-missing session → **`psmux: can't find session: devgo-90323b10` / `[detached · exit 1]`**, header `detached · exit 1` (the stashed-exit path: the client died before `pty_open` had answered). *Close* → no pane. `psmux kill-server` → 0 psmux processes.
- **A server, from the footer.** `ssh box 'tmux new -d -s devgo-75'`; the `box` row's `session` set to `devgo-75` through `update_server` (`servers.json` restored by hash after). Select the row → footer `Terminal · Windows Terminal · Shift+⏎ · psmux · WSL · Attach here · tmux on the box · on`; *Attach here* (title *box's tmux session in a pane under the lanes — Ctrl+Shift+A*) → header `box · devgo-75 · tmux on box · attached`, tooltip **`ssh -t box tmux new-session -A -s devgo-75`**, `user@…:~$` and tmux's status line. `echo hi75-box` typed → `hi75-box`; **on the box** `tmux list-clients -t devgo-75` → `/dev/pts/3: devgo-75 [326x30 xterm-256color] (attached,focused,UTF-8)` — the pane's grid and TERM reached it — and `capture-pane` had `hi75-box`. **`Ctrl+Shift+A` dispatched on xterm's textarea** → `defaultPrevented`, the pane gone; on the box `tmux ls` still `devgo-75`, **0 clients**. Later, with the pane open again, **`Ctrl+Shift+P` from inside the pane** opened the palette; `Attach: detach from box · Ends the client here; the session keeps running` → no pane, 0 clients. Then `tmux kill-session -t devgo-75` there; `tmux ls` → the box's own sessions (`main · work`) untouched. No `ssh.exe` left on this PC.
- **WSL — provable this run** (the VM was already up; nothing booted): `wsl -d Ubuntu -e tmux new -d -s app-<hash>` (the session name for `\\wsl.localhost\Ubuntu\home\<you>\projects\app`, FNV-1a by hand), F5 → the `live` chip on `app`; the row selected, **`Ctrl+Shift+A` on the window** → header `app · app-<hash> · tmux in Ubuntu · attached`, tooltip **`wsl -d Ubuntu -e tmux attach -t =app-<hash>`**, the distro's banner in it. **`Ctrl+K` dispatched on xterm's textarea → focus stayed on the textarea** (the search box did not take it: `paneOwns`). `echo hi75-wsl` → in the distro `capture-pane` has `hi75-wsl`, `list-clients` → `/dev/pts/4 … [326x30 xterm-256color]`. *Detach* → `tmux ls` still lists it, 0 clients; `tmux kill-session -t =app-<hash>` → *no server running*.
- **The refusals.** `box` with tmux off (`update_server` behind the hook's back, so the UI still said on): the key → toast **`tmux on the box is off for box. The attach view attaches a tmux session there; turn it on first`** (Rust's `server_line`). The chip flipped through the footer → the footer's *Attach here* `disabled`, title *tmux on the box is off*; the row menu's `Attach here · tmux on the box is off` disabled. Flipped back; `box tmux=true`.
- **Not provable this run:** the stopped-distro refusal (`WslNotRunning`; the VM was up and is never touched) — the unit test; the Mac line (`tmux attach`) — the unit test on this platform's `LOCAL_MUX`; the palette after a *real* theme change (the pane reads the tokens when it opens; a pane open across a theme switch keeps its colours until reopened, see Deferred).
- **After:** the dev build stopped (1420 and 9223 free), 16 app-data files restored by hash (`instance.lock`, `prefs.json`, `projects-cache.json`, `servers.json` had moved; **0 mismatches** after), the installed DevGo relaunched via `explorer.exe` (pid 27440, 12:02). No psmux, no ssh, no devgo of ours left; WSL neither started nor stopped.
- **Gates:** `cargo fmt --check` clean, `cargo check` 0 warnings, `cargo test` **225** (218 + 7), `tsc -b` clean, `bun run build` clean (`contrast ok: 6 palettes x 8 rules, 5 lane hues`; chunks `index` 402 KB, `xterm` 331 KB, `addon-fit` 1.2 KB, `Settings` 51 KB). Hygiene grep (69's, plus the banner's words) over `src src-tauri/src README.md` → 0. CI run `35188390270` on `adc0d6e`: **success**.

**Fix made during the verify — `9536ae0 ✅FIX: the detached line outlives the client's last bytes`.** The first `[detached]` line vanished: the exit event (an `eval`) had overtaken the client's last chunk (big enough to ride a fetch), and a multiplexer's last word is to leave the alternate screen — the line had been written into the screen that was then discarded. `ended()` now sets the status at once and writes the line a beat later (150 ms), prefixed with `\x1b[?1049l` so it lands on the normal screen whatever arrived in between. Read back: `[detached · exit 0]` and `[detached · exit 1]` above.

> `✅DOCS: the attach view, the readme` — the README's new *📎 Attach* section between Servers and Settings (what the pane is, what it is not, the keys the shell keeps) and the `Ctrl+Shift+A` row in the keyboard table. `✅STAGE: 75 attach-view`; fetch (nothing new), ff-merge; push `main` + branch.

## 75.8 — Deferred

- **The pane is 40 % of the window, fixed.** A drag handle (or a remembered height in `prefs.json`) is the obvious next step; the layout is one class on the section.
- **Theme and knob changes while a pane is open** are not replayed into xterm: it reads the tokens when it opens. `term.options.theme = theme()` on the theme event would do it.
- **One pane.** A second attach replaces the first (which detaches). Tabs in the pane would be the same registry with more than one id.
- **A server row with tmux off** cannot attach; a plain login shell in the pane would make DevGo a terminal, which it is not. The refusal says to turn tmux on.
- **`Ctrl+Shift+A` needs a row or the cursor**; a bare press toasts. A *Sessions* palette group listing every live session across lanes would be a better single door.
- The Mac and Linux paths (`tmux attach`, a ptmx pair) are covered by the unit tests and CI, not by a hand on the box.

---

## What you built

```
src-tauri/Cargo.toml                    portable-pty 0.9.0
src-tauri/src/services/pty.rs           AttachTarget, AttachLine, project_line / server_line; Registry: open (two threads), write, resize, close, forget; 7 tests
src-tauri/src/services/sessions.rs      LOCAL_MUX lent to pty.rs
src-tauri/src/services/mod.rs           pub mod pty
src-tauri/src/error.rs                  AttachRefused
src-tauri/src/commands.rs               ptys in AppState; pty_open (a Channel of raw bytes, the exit event), pty_write, pty_resize, pty_close
src-tauri/src/lib.rs                    the field, the four commands
package.json                            @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0
src/hooks/useAttach.ts                  one pane, one effect that owns the pty; xterm lazy; the listener before the spawn
src/components/AttachPane.tsx           the 40 % pane: title · session · place · the light · Detach / Close
src/shortcuts.ts                        attach = Ctrl+Shift+A; PANE_KEYS, paneOwns
src/App.tsx, src/components/StatusBar.tsx  the row menus, the footer's Attach here, the palette, the key, the pane under the lanes
src/types.d.ts                          the attach types
README.md                               📎 Attach, the key row
```

- **The session opens in DevGo** — a project's psmux or tmux, a server's tmux over ssh, in a pane under the lanes.
- **Detach never kills** — the client ends, the session stays; proved on psmux, on the box and in the distro.
- **Still not a terminal** — no shell of its own; the pane attaches or it refuses.
- **The bytes stream over a channel**, the exit is an event, and the keys typed into the pane are the shell's.
