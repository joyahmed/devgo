# 62 — The WSL Light

**Branch:** `62.wsl-light` — `git checkout 62.wsl-light` gives you this chapter's finished app; `git diff 61.project-menu 62.wsl-light` is exactly what this chapter adds.

**Starting from:** chapter 61 — a project's menu is about the project.

**Goal:** the WSL chip tells the truth while DevGo is open. As shipped, the chip could not tell in real time whether WSL was on or off — it kept saying *stopped* until the app was quit and relaunched — and there was no light for a running WSL. Two asks — live state, and a light — and one rule that must not bend: DevGo never touches WSL on a timer.

> **Hold on to:**
> 1. **Watch the thing that is free to watch.** `wsl.exe` on a timer breaks the core rule twice (it is a WSLService call, and a wedged WSLService is exactly the failure the stop commands exist for — the poll that would show the hang hangs too). The VM's own process, `vmmemWSL`, is in the process table, and reading the table is a kernel snapshot: no `wsl.exe`, no WSLService, no distro. A watcher that reads it every two seconds and asks `wsl.exe` **once per transition** keeps the rule and says it precisely.
> 2. **One shape, three sources.** `WslState { up, distros }` is the event's payload, the command's answer and the hook's state. The chip cannot disagree with itself depending on how it learned; a fake event and a real read land in the same `setWsl`.
> 3. **The first look is a baseline, not an event.** The window asks at mount; a second `wsl.exe` from the watcher at startup would say the same thing. A watcher speaks on change only.
>
> Rust: raw `#[link] unsafe extern "system"` imports for four kernel32 functions, the `win_taskbar` precedent from chapter 29 — the `windows` crate is in the tree through tauri but is not ours, and four functions do not earn a dependency. `#[repr(C)]` reproduces `PROCESSENTRY32W`'s 568 bytes; a test pins the size, because a wrong `dwSize` makes `Process32FirstW` fail silently and the light never comes on.

**What was already true, and what is new.** The chip has ridden `workspaceStates` since chapter 12 (`useEffect(refreshDistros, [workspaceStates])`), so every scan and `F5` re-read it — *quit to see it* was never this build's bug; *a light that needs a click* was. That effect stays, now on the hook's `refreshWsl` (62.5). New here: `platform/wsl_watch.rs` — the process-table look, the thread, the name test — with `forget_running` made `pub(crate)` and `refresh_running` beside it (62.1–62.3); `WslState` on both sides, `get_wsl_state` in place of `get_running_distros`, and `useWsl` with mount + focus + event where `refreshDistros` was a plain function in `App.tsx` (62.3–62.5, no `useCallback`); and the light on the chip — the `Button variant='badge'` in the title bar since 42 (`WslControl.tsx`), wearing the rows' `size-[7px] rounded-full` dot (43), emerald lit / hollow, with *starting* between the VM and its name (62.5).

⚠️ **WSL rules for this run:** WSL was running before this run and was left alone; nothing here starts it and nothing runs `wsl --shutdown`. The two transitions the watcher exists for are therefore *not provable this run* — what is provable is every other piece: the reader agrees with `tasklist`, the watcher spawns no `wsl.exe` while idle, the event path paints all three looks, focus re-reads at the cost of one `wsl.exe`.

---

## 62.1 — The memo can be dropped and refreshed

`wsl.rs`. Chapter 27's `forget_running` was private (the stop commands are in the same file); the watcher needs it, and needs one more door — *ask now and make the answer the memo*, so the chip, the scan and the badge pass that follow an "up" read one `wsl.exe` instead of each spawning their own inside the TTL:

```rust
// a memo that still says running after a stop would send the next scan
// into \\wsl.localhost\, which boots the distro right back. the vm
// watcher clears it too, when the vm has just gone
pub(crate) fn forget_running() {
    *RUNNING_MEMO.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

// ask now and make the answer the memo: the watcher has just seen the vm
// appear, and the chip, the scan and the badge pass that follow read this
// one answer instead of each spawning wsl.exe inside the ttl
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn refresh_running() -> Vec<String> {
    let fresh = running_distros();
    *RUNNING_MEMO.lock().unwrap_or_else(|e| e.into_inner()) =
        Some((Instant::now(), fresh.clone()));
    fresh
}
```

The `cfg_attr`: only the Windows watcher asks; off Windows the stub in 62.2 is the whole story and `cargo check` there would otherwise warn. `cargo check` here warns *never used* until 62.2 calls it — the one warning the chapter carries between commits.

> `✅WSL: memo can be dropped and refreshed`

## 62.2 — `vmmemWSL` in the process table

`services/platform/wsl_watch.rs`, new; `pub mod wsl_watch;` in `platform/mod.rs` after `wsl`. First the model and the reader, no thread yet:

```rust
use serde::Serialize;

/// The chip's state: the watcher's event, `get_wsl_state`'s answer, and
/// the hook's state share it. `up` is the VM's process being in the
/// process table; `distros` is what `wsl -l -q --running` last said.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WslState {
    pub up: bool,
    pub distros: Vec<String>,
}

/// The state read fresh: the process table now, the memo'd list.
pub fn current() -> WslState {
    WslState {
        up: vm_is_up(),
        distros: super::wsl::running_distros_memo(),
    }
}
```

`vm_is_up` is `#[cfg(windows)]` with a `false` twin below it (the rule `platform/mod.rs` states: the `cfg` inside, the caller free of it). Inside: the `#[repr(C)] struct ProcessEntry32W` with its ten fields (`dw_size: u32` first, `th32_default_heap_id: usize` — the pad to 8 that makes 568 on x64 — `sz_exe_file: [u16; 260]` last), the four imports —

```rust
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32)
            -> *mut c_void;
        fn Process32FirstW(
            snapshot: *mut c_void,
            entry: *mut ProcessEntry32W,
        ) -> i32;
        fn Process32NextW(
            snapshot: *mut c_void,
            entry: *mut ProcessEntry32W,
        ) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
```

— `TH32CS_SNAPPROCESS = 0x2`, `INVALID_HANDLE_VALUE = -1isize as *mut c_void`, and the walk: snapshot (an invalid handle returns `false` — *down* is the one answer that never makes DevGo do anything with WSL), `dw_size` set to `size_of`, `Process32FirstW` then `Process32NextW` until `is_vm_name` hits or the table ends, `CloseHandle` either way.

The name test lives outside the snapshot so it tests without one:

```rust
// the name test on a nul-terminated utf-16 buffer, apart from the snapshot
// so it tests without one. case-insensitive: nothing says a future build
// keeps the capitals
fn is_vm_name(exe_file: &[u16]) -> bool {
    let len = exe_file
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(exe_file.len());
    String::from_utf16_lossy(&exe_file[..len]).eq_ignore_ascii_case("vmmemWSL")
}
```

⛔ `vmmemWSL`, not `Vmmem`. The older name belongs to every Hyper-V VM — Windows Sandbox, WSA, a lab VM — and lighting the WSL chip for those would be a lie. WSL has named its VM `vmmemWSL` since 0.67 (2022).

Tests, in the file: `the_vm_is_vmmemwsl_in_any_case` (three spellings), `plain_vmmem_is_not_wsl` (`Vmmem`, `vmmem`, `vmmemWSL.exe`, `wslservice.exe`, empty), `unterminated_buffer_is_read_whole` (260 `a`s, no NUL — still terminates, still false), `process_entry_is_568_bytes_on_x64` (`cfg(all(windows, target_pointer_width = "64"))`, the struct repeated with `_a…_j` because the real one is local to `vm_is_up` on purpose), and one `#[ignore]`d probe, `vm_probe_agrees_with_tasklist`: `tasklist` through 54's `.quiet()`, `vm_is_up()` must equal whether a line starts with `vmmemwsl`. Ignored because it depends on the machine; run by hand. Off Windows, `off_windows_the_vm_is_never_up`.

`cargo test wsl_watch` — 4 pass, 1 ignored; `cargo test -- --ignored vm_probe` — **passes on this machine with the VM up** (`vm_is_up() == true`, `tasklist` lists `vmmemWSL`).

> `✅WSL: vmmemwsl in the process table`

## 62.3 — The watcher thread

Same file, between the model and `vm_is_up`. Two constants and the thread:

```rust
// two seconds is under the time a distro takes to boot and register, so
// the light lands as the terminal's prompt does, and coarse enough that
// the snapshot is noise on the cpu graph
#[cfg(windows)]
const TICK: std::time::Duration = std::time::Duration::from_secs(2);

// the vm's process appears a beat before the distro is listed as running,
// so after an up the names are asked once a second until one arrives or
// this many asks are spent; the chip says starting until then
#[cfg(windows)]
const NAME_RETRIES: u32 = 5;
```

```rust
/// Start the watcher thread. One per process, from `setup()`.
#[cfg(windows)]
pub fn start(app: tauri::AppHandle) {
    use tauri::Emitter;
    std::thread::Builder::new()
        .name("wsl-watch".into())
        .spawn(move || {
            // the first look is the baseline, not an event: the window asks
            // get_wsl_state at mount, and a second wsl.exe from here would
            // say the same thing. transitions only
            let mut last = vm_is_up();
            loop {
                std::thread::sleep(TICK);
                let up = vm_is_up();
                if up == last {
                    continue;
                }
                // the memo is from before the transition either way
                super::wsl::forget_running();
                let distros = if up { names_after_boot() } else { Vec::new() };
                let _ = app.emit("devgo://wsl", WslState { up, distros });
                last = up;
            }
        })
        .expect("spawn wsl-watch thread");
}

/// No VM to watch; nothing to start.
#[cfg(not(windows))]
pub fn start(_app: tauri::AppHandle) {}

// the names, asked until the first one registers
#[cfg(windows)]
fn names_after_boot() -> Vec<String> {
    for attempt in 0..NAME_RETRIES {
        let names = super::wsl::refresh_running();
        if !names.is_empty() || attempt + 1 == NAME_RETRIES {
            return names;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    Vec::new()
}
```

Three decisions in the loop. The first look sets `last` and emits nothing. `wsl.exe` runs on a transition only — and on an *up* it is asked again once a second for up to five, because the VM's process appears a beat before its distro registers (*starting* on the chip: VM up, no name yet). The memo is cleared on every transition, for the reason the stop commands clear it: a "running" answer from a VM that has just gone would send the scanner into `\\wsl.localhost\` and boot it back. A *down* asks nothing — an empty list needs no `wsl.exe`.

> `✅WSL: watcher thread emits on a transition`

## 62.4 — The command and the start

`commands.rs`: `get_running_distros` becomes `get_wsl_state`, same `spawn_blocking` off the main thread (46), answering the new shape; `wsl_watch` joins the `platform::{…}` import:

```rust
/// Is the VM up, and which distros are running. One process-table look
/// and one management call that boots nothing. Asked at mount and on
/// focus; between those the watcher's `devgo://wsl` event carries the
/// same shape.
#[tauri::command]
pub async fn get_wsl_state() -> wsl_watch::WslState {
    // through the memo, so the chip and the scan share one wsl.exe at
    // mount instead of two, and off the main thread: a wsl.exe spawn is
    // half a second the first paint should not wait behind
    tauri::async_runtime::spawn_blocking(wsl_watch::current)
        .await
        .unwrap_or_else(|_| wsl_watch::WslState {
            up: false,
            distros: Vec::new(),
        })
}
```

`lib.rs`: `commands::get_wsl_state` in the handler list where `get_running_distros` was. A renamed registered command does not compile half-done (`__cmd__get_running_distros` missing), so the command and its registration are one commit — the one place the model → command → registration order folds.

> `✅COMMANDS: get wsl state`

`setup()`, after the tray is built and before `setup-end`:

```rust
            // the wsl light: a thread that watches the process table for
            // the vm and tells the window on every change. it never runs
            // wsl.exe on its own clock, so it is not the timer the core
            // rule forbids
            services::platform::wsl_watch::start(app.handle().clone());
```

No `cfg` at the call: `start` is the no-op off Windows. `cargo check` **0 warnings** now (`refresh_running`, `TICK`, `NAME_RETRIES`, `start`, `names_after_boot` all have their callers); `cargo test` **192**.

> `✅APP: start the wsl watcher`

## 62.5 — The hook, the light, the wiring

`types.d.ts`, beside the other Rust wire types:

```ts
/// The WSL chip's state: the watcher's event and `get_wsl_state` share it.
/// `up` is the VM's process being in the process table; `distros` is what
/// `wsl -l -q --running` last said. Up with an empty list is a VM that has
/// just started and not yet registered its distro.
interface WslState {
	up: boolean;
	distros: string[];
}
```

> `✅TYPES: wsl state`

`hooks/useWsl.ts`, new — `export const`, a plain `refreshWsl` (no `useCallback`: React 19 way), three sources in one effect:

```ts
const STOPPED: WslState = { up: false, distros: [] };

// the chip's state from three sources that share one shape: get_wsl_state
// at mount and on every window focus, the watcher's devgo://wsl on every
// change of the vm's process, and refresh() for the paths that changed the
// answer themselves (the stop commands, the passes)
export const useWsl = () => {
	const [wsl, setWsl] = useState<WslState>(STOPPED);

	const refreshWsl = () => {
		invoke<WslState>('get_wsl_state').then(setWsl).catch(() => {});
	};

	useEffect(() => {
		refreshWsl();
		const unlistenEvent = listen<WslState>('devgo://wsl', e =>
			setWsl(e.payload)
		);
		// a second distro starting while the vm is already up is no
		// transition for the watcher; the next focus asks for the names
		const unlistenFocus = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (focused) refreshWsl();
			}
		);
		return () => {
			unlistenEvent.then(f => f()).catch(() => {});
			unlistenFocus.then(f => f()).catch(() => {});
		};
	}, []);

	return { wsl, refreshWsl };
};
```

> `✅HOOKS: use wsl`

`WslControl.tsx` — `WslControlProps.distros: string[]` becomes `wsl: WslState` in `types.d.ts`; the component destructures `{ up, distros }` and derives the label and the title:

```tsx
	const { up, distros } = wsl;
	// the menu needs names to act on; a vm that is up with none listed yet
	// has nothing to stop by name (shut down all is still in the palette)
	const running = distros.length > 0;
	const label = running ? `${distros.length} running` : up ? 'starting' : 'stopped';
	const title = running
		? `WSL running: ${distros.join(', ')}`
		: up
			? 'The WSL VM is up; no distro has registered yet'
			: 'WSL is not running';
```

The light is the first child of the badge `Button` (which is `inline-flex items-center` from its base, so `className='gap-1.5'` on it spaces the dot from the text): the rows' 7 px circle, emerald with the 6 px glow while `up`, a hollow `border-text-muted` ring when not.

```tsx
			<Button
				variant='badge'
				className='gap-1.5'
				title={title}
				onClick={() => setOpen(v => !v)}
				disabled={!running}
			>
				<span
					className={`size-[7px] rounded-full shrink-0 ${
						up
							? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
							: 'border border-text-muted'
					}`}
					aria-hidden='true'
				/>
				WSL · {label}
			</Button>
```

The menu opens only with a listed distro (`disabled={!running}` as before); *Shut down all WSL* stays reachable from the palette. This commit does not type-check on its own — `App.tsx` still passes `distros` — the granular rule over a green intermediate, as 54 recorded.

> `✅UI: wsl light on the chip`

`App.tsx`: the `distros` state, `refreshDistros` and its comment go; the hook comes in, and the chapter-12 pass effect stays on the hook's function (a scan has just asked `wsl.exe`, so the memo is hot and the re-read is free):

```ts
	// the wsl chip: mount, focus and the backend's vm watcher live in the
	// hook; the passes the app already makes re-read it too, as since 12
	const { wsl, refreshWsl } = useWsl();
	useEffect(refreshWsl, [workspaceStates]);
```

The palette's *Shut down all WSL* reads `wsl.distros` and `.finally(refreshWsl)`; the `<WslControl {...{ wsl, onChanged: refreshWsl, … }} />`. `tsc -b` and `bun run build` clean.

> `✅UI: chip reads the wsl hook`

## 62.6 — Verify

`cargo test` **192** (188 + the four name/layout tests; the probe ignored), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. One dev launch (the installed DevGo stopped, the fourteen files under 61's backup). ⚠️ A `node` left from 61's dev build still held port 1420 — Vite refused to start and `bun tauri dev` exited 1 in silence behind `-WindowStyle Hidden`; `Get-NetTCPConnection -LocalPort 1420` finds it. Kill by PID, relaunch.

- **The chip, WSL running (not by us):** `WSL · 1 running`, title `WSL running: Ubuntu-26.04`, the dot **7 × 7**, `background-color` emerald-400 (`oklch(0.765 0.177 163.223)`), `box-shadow … rgb(52, 211, 153) 0px 0px 6px`. `invoke('get_wsl_state')` → `{ up: true, distros: ['Ubuntu-26.04'] }`.
- **No `wsl.exe` on the watcher's clock:** `Get-Process wsl` sampled every 100 ms for 30 s while the window sat idle — **256 samples, 0 sightings**. The watcher ticked fifteen times in that window and asked nothing.
- **The event path, all three looks:** the watcher's transitions cannot be provoked without starting or stopping WSL, so the frontend half was driven through the same channel the thread uses — `invoke('plugin:event|emit', { event: 'devgo://wsl', payload })` round-trips through the backend to every listener. `{ up: false, distros: [] }` → `WSL · stopped`, title *WSL is not running*, the dot `background rgba(0,0,0,0)`, `box-shadow none`, `border 1px rgb(143,157,186)`, the button disabled. `{ up: true, distros: [] }` → `WSL · starting`, *The WSL VM is up; no distro has registered yet*, the dot emerald with the glow, still disabled (no name to stop).
- **The focus source corrects it:** the window minimised over `plugin:window|minimize` (allowed by the capability; `unminimize` is not, so the restore is `ShowWindow(hwnd, SW_RESTORE)` + `SetForegroundWindow` on the one top-level window of the process that `IsIconic`), and the chip went from the fake *starting* back to **`WSL · 1 running`** with `document.hasFocus() === true`. First restore: seven distinct `wsl.exe` pids — that is `useProjects`' own focus pass (46; its 60 s cooldown had expired), not the chip's. Second minimise → 7 s idle → restore, inside the pass's cooldown with the 5 s memo cold: **exactly one `wsl.exe`** (pid 120484) — the chip's read, the cost the hook's comment promises.
- **Cost:** `devgo.exe` (dev build) at 246 s: working set 38 MB, private 9.1 MB, 32 threads — the same order as 54's 9.2 MB.
- **Not provable this run:** the down → up and up → down transitions themselves (the chip lighting within two seconds of `wsl -e true`, going hollow after `wsl --shutdown`). WSL is neither started nor shut down by this chapter. What stands in for them here: the reader agrees with `tasklist`, the thread's only other calls are the tested `forget_running`/`refresh_running`, and the payload it would send paints the chip as shown above.

The dev build stopped (its Vite too — port 1420 checked free), all fourteen files restored by hash at the end of the run, the installed DevGo relaunched through Explorer.

> `✅STAGE: 62 wsl-light`; ff-merge; push.

---

## What you built

```
src-tauri/src/services/platform/wsl.rs        forget_running pub(crate); refresh_running
src-tauri/src/services/platform/wsl_watch.rs  WslState, current, vm_is_up (toolhelp), is_vm_name, start, names_after_boot; 4 tests + the probe
src-tauri/src/services/platform/mod.rs        pub mod wsl_watch
src-tauri/src/commands.rs                     get_wsl_state (get_running_distros gone)
src-tauri/src/lib.rs                          the registration; wsl_watch::start in setup()
src/types.d.ts                                WslState; WslControlProps.wsl
src/hooks/useWsl.ts                           mount + focus + event, refreshWsl
src/components/WslControl.tsx                 the light, the three labels
src/App.tsx                                   useWsl; the pass effect on refreshWsl
```

- **A chip that is live** — mount, focus, every pass, and a watcher that sees the VM come and go within two seconds, with DevGo on another monitor.
- **A watcher that never touches WSL on its own clock** — it reads the process table; `wsl.exe` runs once per transition. The core rule stands, and now says so precisely.
- **A light** — the rows' dot, lit or hollow, with the count beside it.
