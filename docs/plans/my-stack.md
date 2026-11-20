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
reproduced on the second open, cause not found.

Baseline, installed 1.2.9 with no stack window: 7 processes, 424.1 MB working set, 0.08
CPU-seconds over 30 s.
