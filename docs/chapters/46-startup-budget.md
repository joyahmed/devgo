# 46 — The Honest Number (post-plan)

**Branch:** `46.startup-budget` — `git checkout 46.startup-budget` gives you this chapter's finished app; `git diff 45.agent-targets 46.startup-budget` is exactly what this chapter adds.

**Starting from:** chapter 45 — agents launch. Nobody had ever measured how long DevGo takes to appear. The first paint waited for a live scan of every workspace, and the scan ran on the main thread.

**Goal:** measure first, then make the window appear with the last known list before anything scans — and only then write a number down.

> **Hold on to:**
> 1. **Measure, then promise.** A `static OnceLock<Instant>` set first thing in `run()` is the clock; opt-in marks (`DEVGO_STARTUP_LOG=1`) are the ruler. The plan's suspects were wrong; the marks were right.
> 2. **Tauri runs sync commands on the main thread, one after another.** A `read_dir` over a `\\wsl.localhost` workspace in a sync command holds up every command queued behind it — including the one that gates `show()`. `async fn` + `spawn_blocking` is the whole fix, and one `off_main(app, |state| …)` helper carries it.
> 3. **A stale lock is a timeout.** `TcpStream::connect` to a port nobody listens on sits in the stack's retry; `connect_timeout(200 ms)` bounds it, and a live instance answers on loopback in far less.
>
> Rust: `OnceLock::get_or_init`; a generic `async fn` with `F: FnOnce(&AppState) -> Result<T, AppError> + Send + 'static` and `T: Send + 'static`; `tauri::async_runtime::spawn_blocking(...).await` returns a `JoinError` on a panic — which is why this chapter keeps the unwind (see 46.5). PowerShell: `Stopwatch` + a title poll, never a fixed sleep.

> The plan had already said the uncomfortable part: *"the cached list must render before any scan" — not what happens.* This chapter is the measuring, and the three things the measuring found that the plan had not.

**The ruler.** There is no general stage gate to grow here; `scripts/boot-time.ps1` is a script that does one thing — start the exe, poll for the window, read the marks, five runs, a budget. The scaffold has had a `[profile.release]` since chapter 01, so 46.5 is a change of two lines, and the honest size number goes the opposite direction from what a size-leaning profile suggests (below). `useGithub` already reads the cache once at mount — chapter 36's `useEffect(reload, [git])`, the mount being the first run — so the only change there is the 250 ms defer of `gh`.

---

## 46.1 — A clock, and marks that are off by default

`lib.rs`: `static STARTED: OnceLock<Instant>`, `started()` = `get_or_init(Instant::now)`, called first thing in `run()`. `commands.rs`: `startup_ms()` (elapsed, as `u64`) and `mark_startup(stage)`, which appends `stage,ms` to `%LOCALAPPDATA%\DevGo\startup.log` — **only** when `DEVGO_STARTUP_LOG=1`, which the script sets and a user never does (`startup_log_path()` returns `None` otherwise). No writes at startup is a feature; measuring is opt-in. Marks through `setup()`: `setup-start`, `prefs+runtime`, `stores`, `window+hotkey`, `setup-end`; both commands registered.

> `✅STARTUP: a clock and opt in marks`

## 46.2 — Cache first

`rank_projects(projects, prefs)` lifted out of `collect_projects` so both payloads rank alike. `cached_payload(workspaces, cache, prefs)`: every workspace's last scan from `ProjectCacheStore`, marked `Cached` with `reason: None`, sorted by name like the live pass, ranked — no `read_dir`, no `wsl.exe`, no `git`. A workspace with no cache entry yet (first run) simply has no rows. `get_cached_projects` locks the three stores and calls it. **One test** with a temp cache and a temp prefs store: two cached projects come back sorted, the never-scanned workspace contributes no state, the pinned one's rank says so.

> `✅CMD: one rank for both passes` · `✅CMD: the list from the cache alone` — `cargo test` **158**.

## 46.3 — Nothing heavy on the main thread

`off_main(app, f)`: `app.clone()`, `spawn_blocking(move || f(&h.state::<AppState>()))`, `.await`, the `JoinError` through `lock_err`. `get_projects`, `refresh_projects` (`force` moved into the closure), `get_git_info` and `get_project_tech` become `async fn` taking an `AppHandle` instead of `State` and run inside it; `get_live_sessions` (no state in the public since chapter 44), `get_running_distros` and `get_github_status` go through `spawn_blocking` directly — the distro read **through the memo** now, so the chip and the scan share one `wsl.exe` at mount instead of two. *One helper, seven commands.*

> `✅CMD: the scan and the passes off the main thread` · `✅CMD: distros and gh status off the main thread`

## 46.4 — A bound on the stale lock

`single_instance.rs`: `SocketAddr::from(([127, 0, 0, 1], port))` and `TcpStream::connect_timeout(&addr, 200 ms)` where a plain `connect` was. When the last DevGo was killed rather than quit — a crash, a reboot, the measuring script — `instance.lock` names a port nobody listens on, and the plain connect sat in the stack's retry on every start after one.

> `✅RUST: a 200 ms bound on a stale lock`

## 46.5 — The release profile

The scaffold's `[profile.release]` said `opt-level = 3` and `panic = "abort"`. This chapter says `opt-level = "s"` — a launcher's exe is read from disk on every cold start and nothing in it is hot enough for 3 to matter — and **drops `panic = "abort"`**: with the passes now inside `spawn_blocking`, a panic in one comes back as a `JoinError` → `AppError` → a toast, *only if the unwind exists*; under `abort` it is a dead process. The cost is real and measured below: the exe **grows**, from 7.08 MB to 9.37 MB, because unwind tables and landing pads are what make that toast possible. (A crate with no `[profile.release]` at all shrinks on the same change, 13.4 → 9.8 MB — that number measures the missing profile, not this one.)

> `✅CONFIG: size leaning release profile`

## 46.6 — The frontend

`useProjects`: `paint(payload)` split out of `apply` (the three setters, nothing else — the cached paint is not a pass: no `lastPassAt`, no badges; the live pass brings those). The mount effect asks `get_cached_projects` first, paints it, drops the spinner, and marks `first-list` in a `requestAnimationFrame`; then `runPass(false, true)` as before. An empty cache keeps the spinner — the honest state on a first run. The retry effect gains `inFlight.current ||` on its early return: every cached state reads as retryable (`status !== 'live'`, no reason), and the pass already in flight brings its own.

`useGithub`: `get_github_status` (`gh --version` + `gh config get`, two spawns) behind a 250 ms `setTimeout`, cleared on unmount — the status decides the header's sentence, not the list. `main.tsx`: `mark_startup('js-start')` before `createRoot`.

> `✅HOOK: cache first paint` · `✅HOOK: github status after the first paint` · `✅UI: js start mark`

## 46.7 — The measuring script

`scripts/boot-time.ps1 [-Exe] [-Runs 5] [-BudgetMs 0] [-Stale]`: refuses to run while a DevGo is up; sets `DEVGO_STARTUP_LOG=1`; per run deletes the log, `Start-Process`, polls `MainWindowTitle` every 100 ms (a hidden window has none, so a title is proof the whole path ran: `setup()`, the webview, the frontend's `show()`), waits up to 1.5 s for the `first-list` line, `Stop-Process -Force`. Without `-Stale` it deletes `instance.lock` after each kill — which is exactly what a clean quit leaves; with it, the lock stays, and the series **starts with a kill that is not counted** (a stale lock cannot be faked). Prints each run, then `min–max` and the budget verdict. ⛔ A budget is only meaningful on release; a debug build measures the compiler.

> `✅SCRIPTS: boot time script` — the `-Stale` half lands as its own commit, after the two fixes the measuring found (46.9).

## 46.8 — What the measuring found

The release exe of chapter 45 (`bun run build`, then `cargo build --release --features tauri/custom-protocol` — the feature is what makes `is_dev()` false, without it the window loads `localhost:1420`), real data (7 workspaces: 3 on `G:`, 4 in a stopped distro), warm cache, five runs each, this machine:

| start | 45: window visible | 46: window visible | 46: first list (process clock) |
|---|---|---|---|
| after a clean quit | **5 109–6 345 ms** | **566–833 ms** | 561–642 ms |
| after a kill (stale lock) | 5 465–7 863 ms | 793–957 ms | 763–822 ms |
| empty app data (two runs; the first also detects the runtime) | — | 782–1 067 ms | — (no cache to paint) |

The marks (`startup.log`, process clock), a clean start: `setup-start 373 · lock 376 · prefs+runtime 377 · stores 379 · window+hotkey 382 · setup-end 388 · js-start 520 · first-list 583`; after a kill: `setup-start 408 · lock 611 · …`. Read them: **~400 ms before `setup()` runs at all** (the exe, the runtime, `generate_context!` — the biggest span, and not this chapter's), `setup()` itself 15 ms, 130 ms for the webview to reach `js-start`, 63 ms from there to the cached list. The `lock` mark was added when an earlier log showed 210 ms between `setup-start` and `prefs+runtime`: with it in, the span is **3 ms after a clean quit and 203 ms after a kill** — exactly the bound from 46.4, nothing else. The 2.3 MB larger exe made no measurable difference: it is in the page cache on every start but the first.

The honest budget for this machine, release, is **1 000 ms** (`-BudgetMs 1000`); the numbers live in this chapter, beside the script that produced them.

## 46.9 — Verify

`cargo test` **158**, `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. The installed DevGo stopped, the eight files backed up by hash (six + `servers.json`/`servers-cache.json`, which chapter 47 will read). Headless; the distro stayed stopped.

**The table above** is the script's output for `devgo45.exe` and `devgo46.exe` copied out of `target/release`; the last run's `startup.log` is quoted above.

**Cache first, watched.** The release 46 exe started with `--remote-debugging-port=9223` in `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`; a `MutationObserver` planted with `Page.addScriptToEvaluateOnNewDocument`, then `Page.reload`: **0 ms** empty · **21 ms** spinner · **43 ms** 53 rows on 7 workspaces, every header wearing a pill · **172 ms** the live pass lands — the three `G:` workspaces lose their pill, the four WSL ones read `cached · WSL stopped`. (**FIX found here**: the seven pills at 43 ms said `cached · unavailable` — `StatusPill` printed *unavailable* for a missing reason; a cached state with no reason now says `cached · scanning`. → `✅FIX: a cached workspace with no reason is scanning`.) `Ctrl+Q` over CDP: process gone, **no `instance.lock`** — the clean-quit case the script reproduces by deleting it.

**The budget.** The `lock` mark from 46.8 went in after the pill fix → `✅STARTUP: a mark after the lock`; the uncounted first kill of a stale series last → `✅SCRIPTS: a stale series starts from a kill`. The final build through `boot-time.ps1 -BudgetMs 1000`, both series: passed — the table's 46 columns are its output.

**Empty app data**: the folder moved aside for two runs, put back after; the window appeared with no `first-list` mark, as it should; the runs left `prefs.json`, `targets.json`, `workspaces.json` in the fresh folder, deleted with it.

Restore the eight files (`projects-cache.json` was rewritten by every scan; restored), the installed DevGo restarted.

> `✅STAGE: 46 startup-budget`; ff-merge; push.

---

## What you built

```
src-tauri/
  Cargo.toml                          opt-level "s"; no panic = "abort"
  src/lib.rs                          STARTED / started(); six marks through setup()
  src/commands.rs                     startup_ms, mark_startup, startup_log_path; rank_projects; cached_payload + get_cached_projects (+ test); off_main; seven commands async
  src/services/single_instance.rs     connect_timeout(200 ms)
src/
  hooks/useProjects.ts                paint; cache first; first-list mark; retry waits for the pass in flight
  hooks/useGithub.ts                  gh status 250 ms after mount
  components/ProjectTree.tsx          FIX: cached · scanning
  main.tsx                            js-start mark
scripts/
  boot-time.ps1                       the ruler
```

A launcher that is up in under a second with your list already on it — measured, on this machine, with the date and the script that produced the number. What the plan guessed (the scan) was half the story; what it did not guess (sync commands queue on the main thread, a killed instance leaves a two-second lock) was the other half.

> **The thread running through this chapter.** One script, one job. It polls a title instead of sleeping, because *the moment the title appears is the measurement* — a fixed sleep can only say "alive", never "when".
