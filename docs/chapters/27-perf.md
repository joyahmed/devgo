# 27 — What Slow Actually Is (post-plan)

**Branch:** `27.perf` — `git checkout 27.perf` gives you this chapter's finished app; `git diff 26.tmux-windows 27.perf` is exactly what this chapter adds.

**Starting from:** chapter 26 — a WSL project's terminal opens a tmux session with the windows you named in Settings, reconciled on every launch, or a plain login shell if you switched the multiplexer off. DevGo has also been the author's daily launcher for a week, and a week of use produced two complaints no test suite was going to: *the app has become slow*, and *the icon doesn't always load in the taskbar*. This chapter takes the first; a later one takes the second. A third report arrived the same week and gets the last section: *Zed refuses to open a WSL project it opens fine by hand*.

**Goal:** find out what "slow" actually is before fixing anything — and, while a `wsl.exe` is being counted, let Zed cross into WSL the way its own CLI already can.

> **Hold on to:**
> 1. **Turn the feeling into a number first.** "Draining RAM" was a hypothesis; three commands showed 400 MB and 48 GB free. The fix for the wrong hypothesis would have been a regression with a good story.
> 2. **The trigger the user does not choose is the one to rate-limit.** Buttons and first loads are bounded by intent. Focus fires every time they come back from a launch — which is every time.
> 3. **A cache on a liveness check inherits the liveness rule.** Five seconds is fine; five seconds *after the user pressed Stop* boots the distro back, so the stop clears it — after the stop, and even on a timeout.
> 4. **A correct refusal can still be a stale catalogue.** "Cannot cross into WSL" was true of Zed when the table was written and false by the time someone clicked it.
>
> Rust: a `static Mutex<Option<…>>` memo (`Mutex::new` is `const`), a poisoned lock read through `unwrap_or_else(|e| e.into_inner())`, `Instant::saturating_duration_since`, and a decision kept as a pure function so its rule has tests with no clock in them. TypeScript: three `useRef`s that nothing renders from.

> The complaint arrives as a feeling, and the first job with a feeling is to turn it into a number. "Slow, something might be draining RAM" is a hypothesis with a measurement attached, and the measurement was wrong — `devgo.exe` at 31 MB, its WebView2 tree at ~370 MB, and 48 GB free on the box. There was no leak to chase. What there was, was a storm, and it was in the code the whole time: **the one refresh trigger the user never chooses fired the most expensive pass the app has, on every single launch.**

---

## 27.1 — Measure before you hunt

Three commands, before any code was read:

```powershell
Get-Process devgo, msedgewebview2 | Select ProcessName, Id, WorkingSet64, PrivateMemorySize64
(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
Get-Process | Sort WorkingSet64 -Descending | Select -First 15 ProcessName, WorkingSet64
```

DevGo's whole process tree was under 400 MB, the machine had three-quarters of its memory free, and the top of the list was the WSL VM, a browser and an antivirus. A RAM hunt would have found nothing because there was nothing.

So the question changes shape: not *what is growing* but *what is DevGo doing when it feels slow*. And the answer is in `useProjects.ts`, in a handler that has been there since chapter 06:

```ts
	useEffect(() => {
		const unlisten = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (!focused) return;
				retryStep.current = 0;
				refresh().catch(() => {});
			}
		);
```

*Summoning the window should show a current list.* True, and the sentence hides the cost. `refresh()` invokes `get_projects`, and `apply()` — the function every payload goes through — then always called `loadDetails()`, which invokes `get_git_info` **and** `get_project_tech` for the whole list.

## 27.2 — Count the spawns

Follow those three commands into Rust and count process launches, because on Windows a process launch is the expensive thing and `wsl.exe` is the most expensive of them:

| command | spawns |
|---|---|
| `get_projects` | `wsl.exe` once for the running list, then `wsl.exe` once per WSL workspace to run the find script (three here), plus `read_dir` walks over the `G:\` workspaces, a cache write, and a tray rebuild |
| `get_git_info` | `wsl.exe` again for the running list, `wsl.exe` once for the batched git script, and one `git.exe` per Windows project |
| `get_project_tech` | `wsl.exe` again for the running list, `wsl.exe` once for the batched marker listing |

Six workspaces and fifty projects: roughly nine `wsl.exe` and twenty `git.exe` per refresh. Now put it back in context. Every launch opens *another* window — an editor, a terminal — and takes focus with it. Switch back to DevGo and the focus handler fires. **Every launch paid the whole table on the return trip.** That is the feeling, and it was never memory.

## 27.3 — Ask `wsl.exe` once per pass, not three times

Start in Rust, because it is the smaller change. Three commands in a row each asked the same liveness question through the same function, and each launched `wsl.exe` to ask it. A memo with a short lifetime answers the second and third from the first. In `wsl.rs`, above `probe_lines`:

```rust
// one refresh is three commands back to back (scan, git, stack), each
// gated on the same liveness question; five seconds spans the three and
// nothing more. WSL's own idle shutdown waits a minute, and a stop DevGo
// issues clears the memo outright
const RUNNING_TTL: Duration = Duration::from_secs(5);

// process-wide rather than an AppState field: every service that gates on
// liveness can reach it, and the stop paths clear it from in here
static RUNNING_MEMO: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);

// the decision, kept pure so the ttl rule tests without a clock or a wsl.exe
fn memo_hit(
    entry: Option<&(Instant, Vec<String>)>,
    now: Instant,
    ttl: Duration,
) -> Option<&[String]> {
    let (taken, list) = entry?;
    // now can sit before taken; saturating keeps that a hit, not a panic
    (now.saturating_duration_since(*taken) < ttl).then_some(list.as_slice())
}

/// `running_distros` for the automatic paths: a repeat within the ttl reuses
/// the last answer. The explicit paths (detection, discovery, the WSL
/// control) keep asking wsl.exe, because after "stop this distro" the user
/// is owed the truth, not a five-second-old copy.
pub fn running_distros_memo() -> Vec<String> {
    let now = Instant::now();
    // a poisoned lock means a thread panicked mid-write; the list is still fine
    let mut memo = RUNNING_MEMO.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(list) = memo_hit(memo.as_ref(), now, RUNNING_TTL) {
        return list.to_vec();
    }
    let fresh = running_distros();
    *memo = Some((now, fresh.clone()));
    fresh
}

// a memo that still says running after a stop would send the next scan
// into \\wsl.localhost\, which boots the distro right back
fn forget_running() {
    *RUNNING_MEMO.lock().unwrap_or_else(|e| e.into_inner()) = None;
}
```

The decision is a pure function of an entry, a clock and a lifetime, so the TTL rule has four tests without a `wsl.exe` in any of them — miss when empty, hit inside, miss at and past the boundary (exclusive: "5 s" means at most five, not five-and-a-bit), and a `now` before `taken` counting as fresh rather than panicking on an underflow.

The thing that makes a cache dangerous here is chapter 04's rule: nothing on an automatic path may boot a stopped distro. A memo that still says *running* after the user pressed **Stop** in the WSL control would send the next scan into `\\wsl.localhost\`, which boots the distro right back. So the stop paths clear it, from inside `terminate` and `shutdown_all` rather than from the commands that call them:

```rust
pub fn terminate(distro: &str) -> Result<StopOutcome, String> {
    let stopped = run_with_timeout(&["--terminate", distro])?;
    // after the stop, not before, so a pass that overlapped it cannot
    // re-memoise "running"; even on a timeout, since the stop may still land
    forget_running();
    if !stopped {
        return Ok(StopOutcome::TimedOut);
    }
```

> `✅WSL: memoise the running list for one pass` — **100** tests.

In `commands.rs`, the two automatic callers — the running-list gate in `collect_projects` and `running_for` (chapter 14's helper that git and stack detection share) — go through the memo. `detect_targets`, `add_detected_target`, `discover` and `get_running_distros` keep calling `running_distros` directly: they are all things the user asked for.

> `✅CMD: automatic passes share one liveness answer`

## 27.4 — Zed crosses on its own

The third report, from a developer on DevGo: pick a WSL project, click Zed, and get `TargetCannotOpenWsl` — *Zed has no WSL configuration, so it cannot open the WSL project* and the project's Linux path — for a folder Zed opens fine by hand.

The refusal is the right behaviour for an editor that truly cannot cross into WSL; chapter 24 argued for it over silently opening the wrong directory. It was wrong here because the candidate table was written before Zed's Windows build shipped a CLI, and that CLI (`bin\zed.exe`) takes `--wsl [USER@]DISTRO PATH` and resolves the Linux path inside the distro itself. The table stores the WSL form as the template itself (chapter 24's one `Option`, not an enum), so there is no variant to add: Zed's row changes one field:

```rust
    // zed's windows cli takes the distro as a flag and resolves the linux
    // path itself; it was None until that cli shipped, and devgo refused
    // WSL projects zed opened fine by hand
    WinCandidate {
        id: "zed",
        name: "Zed",
        kind: TargetKind::Editor,
        exe: "zed",
        args: "\"{path}\"",
        wsl_args: Some("--wsl {distro} \"{linux_path}\""),
```

and `wsl_form_decides_whether_a_target_can_open_wsl` gains the assertion that pins the resolved arguments — `--wsl Ubuntu "…"` with the Linux path inside the quotes — so the shape cannot drift back. Chapter 24's lesson applies to the fix as much as it did to the feature: detection never overwrites a registered id, so an install that already holds a Zed target keeps the one it stored, with no WSL form. Those users set the WSL args on Zed in Settings by hand, or remove Zed and detect again.

> `✅TARGET: zed crosses with its own wsl flag`

## 27.5 — Rate-limit the trigger the user does not choose

The refresh button is a choice; the first load is a necessity; a retry is bounded. Focus is the one trigger the user never asks for, so it is the one that has to be rate-limited. In `useProjects.ts`:

```ts
// focus used to refresh unconditionally, and a refresh is nine wsl.exe and
// ~20 git.exe for six workspaces; every launch opens another window and
// hands focus back, so each launch paid all of it on the way back. A minute
// makes two summons cost one pass and still shows a distro started or a
// branch switched by the next visit
const FOCUS_REFRESH_COOLDOWN_MS = 60_000;
```

```ts
	// when the last pass landed and whether one is in flight: the focus
	// handler reads them, nothing renders from them
	const lastPassAt = useRef(0);
	const inFlight = useRef(false);
	// the paths the badge pass last covered; a payload with a path not in
	// here (a workspace that just attached) is the one case a non-explicit
	// refresh still pays for git
	const badgedPaths = useRef<Set<string>>(new Set());
```

Three refs, none of them state, because nothing renders from them. `apply` takes a second argument and stamps the pass:

```ts
	// badges used to run on every apply, which is how one focus gain turned
	// into three backend commands; get_git_info's own comment said "only on
	// an explicit refresh" for ten chapters
	const apply = (payload: ProjectsPayload, withBadges: boolean) => {
		setProjects(payload.projects);
		setWorkspaceStates(payload.workspaces);
		setRanks(new Map(payload.ranks.map(r => [r.full_path, r])));
		lastPassAt.current = Date.now();
		const unseen = payload.projects.some(
			p => !badgedPaths.current.has(p.full_path)
		);
		if (withBadges || unseen) {
			badgedPaths.current = new Set(payload.projects.map(p => p.full_path));
			loadDetails(payload.projects);
		}
		return payload;
	};
```

Badges run on the first load, on an explicit refresh, on a focus refresh that passed the cooldown — and on any pass that brings back a path never badged before, which is what a workspace that just attached after boot looks like. The retry loop from chapter 06 heals that workspace and its projects get badges; it does not re-badge the forty-eight that already had them. The comment on `get_git_info` had said *only on an explicit refresh* since chapter 10 while `apply()` called it on every pass — a comment that describes what the caller should do is a bug report until the caller does it.

`refresh` becomes a thin call over `runPass(force, withBadges)`, which marks `inFlight` around the invoke; the first load calls `runPass(false, true)` directly. And the focus handler:

```ts
	// Summoning the window should show a current list, but not at any price:
	// focus is the one trigger the user does not choose, so it is the one
	// that is rate-limited. Skipped while a pass is in flight (the window
	// takes focus as it first appears) and while the last one is younger
	// than the cooldown. The retry budget still resets on every focus.
	useEffect(() => {
		const unlisten = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (!focused) return;
				retryStep.current = 0;
				if (inFlight.current) return;
				if (Date.now() - lastPassAt.current < FOCUS_REFRESH_COOLDOWN_MS) return;
				runPass(false, true).catch(() => {});
			}
		);
```

`inFlight` covers the case the first load exposes: the window is shown right after mount and takes focus as it appears, and that focus used to start a second full pass on top of the first before it had painted. A minute is long enough that summoning the window twice in a row costs one pass, and short enough that a distro you started or a branch you switched still shows up on the next visit.

> `✅HOOK: focus refresh at most once a minute`

## 27.6 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **100** — chapter 26's 96 plus four for the memo. Then, with the four config files backed up:

**Focus.** `bun tauri dev`, wait ten seconds for the first pass and its badges to land, then note the time, minimize the window from its title bar and restore it from the taskbar. `Get-Process wsl, git | Where StartTime -gt $t0` four seconds later: **nothing** — before this chapter the restore alone spawned a `wsl.exe` and a `git.exe` per Windows project. `F5`: git processes appear, because an explicit refresh always re-reads badges.

**Zed.** Manage → Scan → Add on Zed (its stored form is chapter 24's, so remove it first if you already had it). Select a WSL project: the *Zed* button on the row is enabled and titled *Zed — Ctrl+⏎* rather than the refusal. Click it: Zed opens the project — *shop — .env* in the title bar — through `--wsl Ubuntu-26.04 "/home/user/…"`, and `targets.json` holds `"wsl_args_template": "--wsl {distro} \"{linux_path}\""`. Close Zed. Zed's CLI starts the distro itself; `wsl --shutdown` when done.

Restore the four files.

> `✅STAGE: 27 perf`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/platform/wsl.rs   RUNNING_TTL, RUNNING_MEMO, memo_hit, running_distros_memo, forget_running; 4 tests
  src/commands.rs                collect_projects and running_for go through the memo
  src/services/editors.rs        Zed's WSL form
src/
  hooks/useProjects.ts           FOCUS_REFRESH_COOLDOWN_MS; lastPassAt, inFlight, badgedPaths; apply(payload, withBadges); runPass
```

Switching back to DevGo after a launch costs nothing for a minute, one pass asks `wsl.exe` about running distros once instead of three times, and Zed opens a WSL project through the flag its own CLI already had.

> **The thread running through this chapter.** Every gate was green for ten chapters while the focus handler ran the most expensive pass in the app on every return from every launch. The number said it was not memory; the table said what it was. **The trigger the user does not choose is the one to rate-limit** — and the cache that made the backend cheaper had to learn chapter 04's rule before it could ship.
