# My stack - a small always-on-top window that starts, stops and watches your own apps

The requirement: the user's own apps (a voice app, a monitor, DevGo itself...) start one after
another after sign-in, and a small floating window - openable from a taskbar pin - shows them and
starts or stops them. No new app: DevGo is already the launcher.

## What it is

- A second DevGo window, label `stack`: small (300 x 320), no frame, always on top, draggable,
  remembers where it was put. Not in the taskbar itself; a pinned shortcut opens it.
- Opened three ways: tray menu "My stack", `DevGo.exe --stack` (a pinned shortcut; when DevGo
  already runs the second launch hands `stack` over the single-instance socket and exits), and
  the command palette is NOT in v1.
- One row per app: name, running/stopped dot, Start / Stop / Restart. "Start all" starts the
  stopped ones in list order, 2 s apart. DevGo's own row cannot be stopped from inside itself.
- Stop = ask the app to close (`taskkill /PID`, i.e. WM_CLOSE to its windows), wait up to 5 s,
  then `taskkill /F /T`. Tray apps usually hide on WM_CLOSE, so expect the kill step for them.
- Idle cost: the window is DESTROYED on close (not hidden), so its webview and its polling are
  gone. Polling runs only while the window is open and the document is visible: every 2 s, one
  process snapshot (Toolhelp on Windows, `ps` elsewhere), no spawn per poll on Windows.

## The one list both readers use

`stack.json` in DevGo's data folder (`%APPDATA%\app.zetta.devgo\stack.json` on Windows).
DevGo is public, so the list lives in DevGo's own folder, not a personal path; the startup
script outside DevGo reads that same file.

```json
{ "apps": [ { "name": "voice", "process": "voice-app",
              "path": "%LOCALAPPDATA%\\Programs\\voice-app\\voice-app.exe",
              "args": [], "delay": 10 } ] }
```

- `process`: the exe name without `.exe`, compared case-insensitively.
- `path`: `%VAR%` is expanded by both readers.
- `delay`: seconds after sign-in, used ONLY by the startup script (the window's "Start all"
  uses a fixed 2 s gap - waiting 30 s after a click is not what a click means).
- A missing file = an empty list; a file that does not parse is kept as `stack.json.bak`
  (`config_io::parse_or_backup`, as every other DevGo store does).

## Slices (each one ends with its gate; numbers go in the commit)

- [x] **S1 - the list and the processes (Rust).** `services/stack.rs`: load/save, `%VAR%`
      expansion, process snapshot, start / stop (graceful then kill) / restart / start all.
      Commands `stack_list`, `stack_status`, `stack_start`, `stack_stop`, `stack_restart`,
      `stack_start_all`, `stack_save`. Unit tests for parse, expansion, name matching, save.
      Gate: `sh scripts/verify.sh --full` green (fmt, clippy -D warnings, cargo test, vitest, build).
- [x] **S2 - the window.** `--stack` flag in `launch_args` (+ `Handoff::Stack`, bytes `stack`;
      an older DevGo ignores them as a stray connection), tray item "My stack", window
      create/focus/destroy in `stack.rs` (300x340, frameless, always on top), window events split by label (the main
      window's hide-on-close and geometry memory must not touch the stack window), its own
      saved position (`stack-window.json`), capability for label `stack`.
      Gate: verify --full; cargo tests for the flag and the handoff round trip.
      Done: verify --full 6/6 green; cargo test 569 passed, 2 ignored.
- [x] **S3 - the screen (React).** `main.tsx` renders `StackPanel` when the window label is
      `stack`; `useStack` hook holds the list, the 2 s poll (paused when hidden) and the
      actions; `StackPanel` holds the markup, rows mapped from data. Add / remove / move
      up-down with a small inline form. Vitest for the hook's poll pause and the rows.
      Gate: verify --full.
      Done: verify --full 6/6 green; vitest 997 passed in 42 files (useStack 5/5).
- [x] **S4 - the startup script reads the list.** The machine's sign-in script (outside this
      repo, run by a scheduled task) reads `stack.json` (logs "no stack.json" and exits when it
      is missing); the three apps it listed inline move into `stack.json`. Gate: `Start-ScheduledTask` on that task with everything running logs
      "already running" x3 and starts nothing; process count per app unchanged.
      Done: 2 of 3 were running -> 2 "already running" lines, the third (not running) started
      once; process counts before 1/0/1, after 1/1/1; task result 0.
- [x] **S5 - measured on the real build.** Release build, run with the installed DevGo
      closed: RAM (working set, all DevGo + WebView2 children) and CPU over 60 s with the
      stack window open vs closed. Screenshots of the stack window at real size in two
      palettes (`scripts/cdp.mjs` with `DEVGO_CDP_MATCH=stack`). Gate: numbers in this file.

## v2 - a Stack tab and a pill

Review of the 300x340 window: rows showed bare process names, and the screen was too plain.
Decided: managing moves into a **Stack tab in the main window** (no extra webview); the
floating window becomes a **pill** for glancing. The 300x340 panel (`StackPanel`,
`StackRow`, `StackAddForm`, `useStackAddForm`) is removed.

- **The tab.** A `Projects | Stack` switch in the title bar. One row per app: its real
  icon (from the exe; a letter tile when there is none), its display name (`name` in
  `stack.json`), a state word (running / stopped / not installed), uptime and memory when
  running, and its place on the sign-in timeline ("starts at 10 s") on a rail down the
  left: the rail IS the start order. Start / Stop / Restart; up / down; Edit opens the row
  in place (delay, path); Remove. "Add app" picks an `.exe`; the name comes from the
  exe's FileDescription (then ProductName, then the file name), the icon with it.
  "Start all in order" and "Stop all except DevGo". Empty and not-installed states say
  what to do. The project keyboard shortcuts do not fire while the tab is open.
- **The pill.** Label `stack`, the same window code (position memory, `--stack`, the
  tray item, the single-instance handoff). A rounded bar, transparent corners: a grip
  mark, one dot per app (emerald running, red not installed, hollow stopped), a ✕.
  Click a dot = start or stop it (DevGo's own dot does neither; a not-installed dot opens
  the tab). Hover a dot = a card with the icon, name, state, uptime (the window grows to
  hold it, down, or up when the pill sits at the bottom of a screen). Click the body =
  the main window on the Stack tab. Drag = move. ✕ destroys the window.
- **Cost.** One poll, 5 s, while the tab is open or the pill is visible; the pill polls
  without uptime and memory (no per-process open), the tab with them. Icons are read
  once per path and cached in Rust.

- [x] **S6 - the facts in Rust.** `stack_status { detail }` adds `uptimeSecs`,
      `memBytes` (sum over the app's processes; `OpenProcess` limited, `GetProcessTimes`,
      `K32GetProcessMemoryInfo`) only when `detail`. `stack_icon(path)`: `ExtractIconExW`
      -> `GetIconInfo` + `GetDIBits` -> PNG (`png` crate, already in the lock) -> data URL,
      cached. `stack_describe(path)` -> `{ name, process, icon }` from version info.
      `stack_stop_all` (every running app but DevGo, last first). `stack_pill_fit`,
      `stack_pill_hover`, `stack_show_tab` (shows main, emits `stack-tab`).
      Gate: verify --full 6/6; unit tests for the name pick, the FILETIME uptime, the
      BGRA->PNG round trip and the alpha fix; Windows tests that notepad's description
      and icon come back.
      Done: verify --full 6/6 green; cargo test --lib stack: 23 passed (9 new).
- [ ] **S7 - the tab.** `useStack({ active, detail })`, `useStackEditor` (edit/add in
      place), `StackTab` + `stack-parts/` (row, rail, add panel, empty state), the title-bar
      switch, the `stack-tab` event, shortcuts paused on the tab. Vitest: poll only when
      active, add from a described exe, edit/save. Gate: verify --full 6/6.
- [ ] **S8 - the pill.** `StackPill` + `useStackPill`; the window becomes the pill size;
      old panel files deleted. Vitest: dot click start/stop, self dot inert, body click
      opens the tab. Gate: verify --full 6/6.
- [ ] **S9 - measured and looked at.** Release build, installed DevGo stopped
      (`Stop-Process`) and restarted after. Pill open vs closed, 60 s: target <= +60 MB
      working set, <= +0.2 CPU-s/min. Screenshots of the tab and the pill, neon + one more
      palette, real sizes, in the gitignored `docs/walk/`; design-critic loop, verdicts here.

## Not in v1 (say so, do not half-build)

- DevGo itself starting the stack at sign-in (the scheduled task does that today).
- A separate taskbar identity for the stack window (its own AppUserModelID, so a pinned
  "My stack" button groups only that window). v1: a pinned `.lnk` to `DevGo.exe --stack`.
- Per-app health beyond "process exists" (window up, port answering).
- macOS/Linux polish: it compiles and works there with `ps`/`kill`, but is only walked on Windows.

## Results

Measured 2026-11-20, release `DevGo.exe` (10.8 MB), installed DevGo closed, 60 s each, all
DevGo + msedgewebview2 children:

| state | procs | working set | private | CPU-s over 60 s |
|---|---|---|---|---|
| stack window closed | 7 | 419.0 MB | 203.7 MB | 0.63 |
| stack window open | 8 | 523.3 MB | 284.8 MB | 3.13 |

The stack window costs about +104 MB working set, +81 MB private, +1 process. CPU is the
number to watch: 3.13 s per 60 s is roughly 5% of one core while open (closed 0.63 s; the
installed 1.2.9 baseline was 0.08 s over 30 s). The open run began about 10 s after the window
opened, so some of that may be startup; not re-measured later.

`DevGo.exe --stack` launched while DevGo was running: printed "DevGo is already running;
focusing the existing window", the running instance opened the "My stack" window (still one
DevGo process id). Single-instance `--stack` path works.

Screenshots at real size (333 x 377 CSS px), neon and dracula: no clipping, no overflow
(scrollWidth = clientWidth, scrollHeight = clientHeight), text readable, Stop/Restart/Start
buttons aligned. Kept in the gitignored `docs/walk/s5-stack/`.
One oddity: a first stack window vanished by itself within about a minute of opening; not
reproduced on the second open, cause not found. (Found later: see "The vanish" below.)

### Follow-up: the vanish and the CPU number (same day)

**The vanish was the measuring script, not DevGo.** The S5 close script called .NET
`Process.CloseMainWindow()` on every DevGo process. .NET picks the first visible unowned
top-level window as a process's "main window", and with the stack window open that is
"My stack", even with the main window visible (measured: `MainWindowTitle` = `My stack`).
So the WM_CLOSE went to the stack window and destroyed it, and DevGo kept running
("graceful close does not quit it"). Reproduced on the old build: one `CloseMainWindow()`
removed the stack window, DevGo stayed up. Rule for measuring: `Stop-Process`, never
`CloseMainWindow` or `taskkill` without `/F`.

The other closes seen during the watches were a person at the desktop: with the new log
lines (below) they read `stack: close pressed (click)` (a real mouse click on the window's
own close button, no CDP port open), once followed 8 s later by the main window being
minimized by hand. No DevGo code path closes or hides the stack window: the event routing
in `lib.rs` sends label `stack` only to `stack::on_window_event`, which handles Moved and
Destroyed, and nothing in the frontend hides or closes windows on blur.

So a close is attributable from now on: the stack window logs `stack window: close
requested`, and its close button logs `[DevGo/ui] stack: close pressed (click|key)` first.
A close request without that ui line came from outside (Alt+F4, taskkill, CloseMainWindow).

Watches, 200 s each, window state sampled every 2 s:

| build | main window | result |
|---|---|---|
| old | hidden | closed at 187 s, unattributed (old build had no close log); `stack.json` was rewritten from outside 24 s before |
| old | visible | stayed 200 s |
| new | hidden | closed at 20 s: `close pressed`, a person |
| new | visible | closed at 155 s: `close pressed (click)`, then main minimized by hand |
| new | hidden | closed at 36 s: `close pressed (click)`, a person |

**CPU.** The 3.13 above was measured starting 10 s after the window opened. Measured again,
60 s each, all DevGo + WebView2 processes:

| build | main window | stack closed | stack open | open minus closed |
|---|---|---|---|---|
| old (2 s poll) | hidden | 0.30 | 0.63 (from +60 s) | +0.33 |
| old (2 s poll) | visible | 0.30 | 0.42 (from +30 s) | +0.12 |
| new (5 s poll, no re-render when nothing changed) | visible | 0.23 | 0.27 (from +8 s), 0.27 (from +68 s) | +0.04 |

The poll is now every 5 s and a poll whose answer did not change does not touch React state
(no re-render, no repaint). The Rust side was already one ToolHelp snapshot per poll.
Target (open <= closed + 1.0 CPU-s per 60 s) is met by both builds in steady state; the
new one also meets it from the first minute.

Baseline, installed 1.2.9 with no stack window: 7 processes, 424.1 MB working set, 0.08
CPU-seconds over 30 s.
