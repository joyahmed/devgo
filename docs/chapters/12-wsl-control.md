# 12 — WSL Control (Slice 3)

**Branch:** `12.wsl-control` — `git checkout 12.wsl-control` gives you this chapter's finished app; `git diff 11.keyboard 12.wsl-control` is exactly what this chapter adds.

**Starting from:** chapter 11 — every keybinding declared once and read by three consumers, and a Settings shell with a panel registry. When WSL wedges, the fix is still a terminal trip.

**Goal:** the reason this slice moved up the queue — a way to stop a wedged WSL distro without opening a terminal.

> **Hold on to:**
> 1. **Ask what state the machine is in when your error-handling code runs.** If it is the state that broke the thing you are calling, the timeout is part of the feature, not padding around it.
> 2. **`spawn` + `try_wait` in a loop, not `output()`.** A deadline is only expressible if the wait can be interrupted — and on the deadline, giving up on *waiting* is not the same as cancelling the *work*.
> 3. **Re-query, then report.** A zero exit code means the request was accepted. "Stopped" is a claim about the machine, so the machine is asked before the toast is written.
> 4. **Three outcomes, three variants.** `TimedOut` (we do not know) and `StillRunning` (we know, and no) call for different next moves; an `Err` that merged them would throw away the bit the user needs.

> This is the other half of Slice 3, and the feature that moved it up the queue. It is `wsl --shutdown`. It looks like a two-line feature and it is the one place in DevGo where a timeout is *load-bearing rather than defensive* — because the thing this feature exists to fix is also the thing that makes the fix hang.

---

## 12.1 — The timeout that is load-bearing

When WSL wedges — VS Code Remote hangs, a `\\wsl.localhost` path stops responding, a distro will not start — the fix is a terminal trip: `wsl --terminate <distro>`, and if that does not clear it, `wsl --shutdown`. DevGo already knows which distros are running (chapter 06's `running_distros`, the liveness gate chapter 10 reused). It can collapse that loop to two clicks.

In `src-tauri/src/services/platform/wsl.rs`, at the bottom of the file, after the tests:

```rust
/// How long to wait for a stop command before giving up on it.
///
/// This is the one place a timeout is load-bearing rather than defensive. The
/// whole feature exists for a wedged VM, and a wedged VM is exactly when
/// WSLService stops answering — this machine's System log carries five
/// 30-second WSLService transaction timeouts. Without a bound, the command that
/// fixes the hang would itself hang, taking DevGo with it.
const STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

pub enum StopOutcome {
    /// The command returned and the distro is genuinely no longer running.
    Stopped,
    /// The command returned, but the distro is still listed as running.
    StillRunning,
    /// We gave up waiting.
    TimedOut,
}
```

### The timeout is load-bearing, not defensive

Most timeouts in most codebases are insurance: the call almost always returns, and the bound is there for the tail. You could delete it and never notice.

This one is not that. Follow the causal chain. This feature exists **because WSL wedged.** A wedged WSL is, specifically, WSLService — the Windows service that brokers every WSL operation — failing to complete transactions. That is not a guess: the System log on the machine this shipped from carries **five 30-second WSLService transaction timeouts.**

`wsl --terminate` and `wsl --shutdown` are requests *to WSLService.* So the exact condition under which a user reaches for this button is the exact condition under which the button's implementation may never return.

Without `STOP_TIMEOUT`, the failure mode is: WSL wedges → you click Stop → the Tauri command blocks forever → the button reads "Stopping…" until you kill the app. **The feature that fixes the hang becomes a second hang, triggered only in the situation it was written for.** It would pass every test, work every time you tried it on a healthy machine, and fail on exactly the day it mattered.

Twenty seconds is chosen against the observed 30-second WSLService transaction timeout: long enough that a slow-but-working stop completes (the live measurements in §12.4 were 318 ms and 1.5 s), short enough to give up *before* the service's own timeout, so DevGo reports something while the underlying transaction is still pending rather than waiting on it.

### Waiting without killing

```rust
fn run_with_timeout(args: &[&str]) -> Result<bool, String> {
    let mut child = wsl_command()
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("could not run wsl: {e}"))?;

    let deadline = std::time::Instant::now() + STOP_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(true),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    // Leave the process alone rather than killing it — wsl.exe is
                    // a thin client, and the work is happening in WSLService.
                    return Ok(false);
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(format!("waiting on wsl: {e}")),
        }
    }
}
```

`spawn` + `try_wait` in a poll loop, rather than `output()`, because `output()` blocks until the child exits and there is no way to interrupt it. `try_wait` asks "has it finished?" without waiting, which is what makes a deadline expressible at all. 100 ms is comfortably below human perception and costs two hundred syscalls across a full twenty-second wait.

`Stdio::null()` on both streams matters more than it looks. `output()` captures stdout and stderr into pipes, and a child that fills a pipe nobody is draining blocks on the write — which would turn "the command is slow" into "the command deadlocks", inside the function whose entire job is to not do that. Nothing here wants the output anyway: `terminate` learns whether it worked by re-querying, not by reading text.

**The comment on the timeout branch is the load-bearing one.** The instinct on a timeout is `child.kill()`. Here it would be wrong, and actively harmful. `wsl.exe` is not doing the work. It is a thin client that hands a request to WSLService and waits for the reply. Killing it does not cancel the shutdown — it abandons a request that is still in flight, in a service that is already unhealthy. So on timeout, DevGo returns `Ok(false)` — "I stopped waiting" — and lets the process finish on its own. **Killing a process only cancels work when the work is in that process.** For a client of a service, the timeout bounds your patience, not the operation.

### Verify, don't trust the exit code

```rust
/// Stop a single distro, leaving any others (and the VM) alone.
pub fn terminate(distro: &str) -> Result<StopOutcome, String> {
    if !run_with_timeout(&["--terminate", distro])? {
        return Ok(StopOutcome::TimedOut);
    }
    // Never trust the exit code alone — report what is actually true.
    if is_running(distro, &running_distros()) {
        Ok(StopOutcome::StillRunning)
    } else {
        Ok(StopOutcome::Stopped)
    }
}

/// Stop every distro and the VM itself. The escalation, not the default.
pub fn shutdown_all() -> Result<StopOutcome, String> {
    if !run_with_timeout(&["--shutdown"])? {
        return Ok(StopOutcome::TimedOut);
    }
    if running_distros().is_empty() {
        Ok(StopOutcome::Stopped)
    } else {
        Ok(StopOutcome::StillRunning)
    }
}
```

Both functions do the same three steps: run it with a bound, then **re-query the world**, then report what is true.

A zero exit code from `wsl --terminate` means the request was accepted. It does not mean the distro stopped. On a wedged VM those come apart routinely — the command returns promptly and cheerfully, and `wsl -l -q --running` still lists the distro. If DevGo reported success on the exit code, the user would see "Ubuntu-26.04 stopped", go back to VS Code, find it still hanging, and conclude that DevGo lied. Which it would have.

The re-query is nearly free: `running_distros()` is the same management call chapter 06 built, it boots nothing, and it is the *only* way to answer the question the user actually asked, which was never "did the command run?" but "is it stopped?"

**`StopOutcome` has three variants because there are three outcomes, and the two failures are different problems.** `TimedOut` means *we do not know* — the next move is to wait, refresh, then escalate. `StillRunning` means *we do know, and the answer is no* — something is holding it open, and the next move is `--shutdown`. Collapsing them into one `Err` would throw away exactly the bit that decides what to do next. This is the same instinct chapter 06 applied to workspace status: `Unavailable` and `Cached` are both "not live", and merging them would have cost the UI the ability to say which.

Compare the two success checks. `terminate` asks `is_running(distro, …)` because other distros staying up is *correct*. `shutdown_all` asks `running_distros().is_empty()` because after `--shutdown` anything still running is a failure. The predicate follows from what each command promised, not from a shared helper.

---

## 12.2 — Three commands and one error variant

In `src-tauri/src/commands.rs`, above `toggle_pin`:

```rust
/// Which distros are up right now. Costs one management call and boots nothing,
/// so the UI can show live state without violating the no-timer rule.
#[tauri::command]
pub fn get_running_distros() -> Vec<String> {
    wsl::running_distros()
}

fn describe(outcome: wsl::StopOutcome, what: &str) -> Result<String, AppError> {
    match outcome {
        wsl::StopOutcome::Stopped => Ok(format!("{what} stopped")),
        wsl::StopOutcome::StillRunning => Err(AppError::WslStopFailed(format!(
            "{what} is still running — something may be holding it open"
        ))),
        wsl::StopOutcome::TimedOut => Err(AppError::WslStopFailed(format!(
            "timed out waiting for {what} to stop — WSLService may be unresponsive"
        ))),
    }
}

/// Stop one distro. Blocking, but Tauri runs commands off the UI thread, so a
/// wedged WSLService stalls this call rather than the window.
#[tauri::command]
pub fn terminate_distro(distro: String) -> Result<String, AppError> {
    let outcome = wsl::terminate(&distro).map_err(AppError::WslStopFailed)?;
    describe(outcome, &distro)
}

#[tauri::command]
pub fn shutdown_wsl() -> Result<String, AppError> {
    let outcome = wsl::shutdown_all().map_err(AppError::WslStopFailed)?;
    describe(outcome, "WSL")
}
```

(`cargo fmt` at `max_width = 80` will wrap `describe` — let it.)

`describe` is where the three-variant enum becomes a two-variant `Result`, and it is the right place for that conversion: the *service* keeps the distinction structural so it cannot be lost, and the *command layer* maps each variant to the sentence that names the user's next move. `StillRunning` says something is holding it open; `TimedOut` names WSLService. Neither says "failed".

Both stop commands are synchronous `fn`, not `async fn`, and the doc comment says why that is acceptable: Tauri dispatches non-async commands on a worker thread pool, so a blocking call stalls that command, not the WebView. The window stays responsive, the popover keeps its "Stopping…" state, and §12.1's twenty-second bound puts a ceiling on how long that lasts.

The error variant, in `src-tauri/src/error.rs`, after `NoRemote`:

```rust
    /// Carries an already-phrased message: the distinction between "timed out"
    /// and "returned but still running" is the useful part, and only the caller
    /// knows which it was.
    #[error("{0}")]
    WslStopFailed(String),
```

Every other variant in `AppError` supplies its own wording and takes data — `NoRemote(path)`, `LaunchFailed(detail)`. This one is `#[error("{0}")]`, a pass-through. That looks lazy and is deliberate: three genuinely different situations funnel into it (spawn failure, timeout, survived-the-command), the difference between them is the only thing the user can act on, and `describe` is the only code that knows which one happened.

Register all three in `lib.rs`, after `commands::get_git_info`:

```rust
            commands::get_running_distros,
            commands::terminate_distro,
            commands::shutdown_wsl,
```

Same rule as ever: a command missing from that list compiles fine and fails at runtime.

> **Commit checkpoint**
>
> ```powershell
> git add -A && git commit -m "✅WSL: terminate one distro or shut down all — bounded wait, no kill, outcome re-queried before it is reported"
> ```

---

## 12.3 — The popover, and the order of escalation

Props first, in `types.d.ts`. `ConfirmDialog` has said "Remove" on its red button since chapter 02, because that was the only question it had ever been asked. It is about to be asked a second one:

```ts
interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	/// What the confirming button says — the verb, so the dialog cannot say
	/// "Remove" over a question about stopping something.
	confirmLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

interface WslControlProps {
	distros: string[];
	/// Called after every stop attempt, success or not — the caller re-reads.
	onChanged: () => void;
	onConfirm: (message: string, action: () => void) => void;
	onResult: (message: string, kind: ToastType) => void;
}
```

In `ConfirmDialog.tsx`, destructure `confirmLabel = 'Confirm'` and use it in the actions row: `{ label: confirmLabel, variant: 'danger', onClick: onConfirm }`. The workspace dialog in `App` passes `confirmLabel: 'Remove'`, so nothing it says changes.

One more `Button` variant — the title bar needs a status pill you can click, in the shape of chapter 04's `RuntimeIndicator`. `ButtonVariant` gains `'badge'`, and in `Button.tsx`:

```tsx
	// A title-bar status pill you can click. Disabled means "nothing to act on",
	// and the muted colour says so; the base opacity dims it further.
	badge:
		'px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-bg-panel border border-border text-accent hover:not-disabled:border-accent disabled:text-text-muted'
```

The affordance disappears with the capability — the same rule chapter 10 applied to an unclickable branch name. A disabled pill is grey, dim, and opens nothing, because there is nothing to open: a menu of actions that would all be no-ops.

Now `src/components/WslControl.tsx`:

```tsx
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import Button from './Button';

const STOP_ONE = (d: string) =>
	`Stop ${d}? Anything running inside it — dev servers, tmux sessions, VS Code Remote — will be terminated. Other distros are left alone.`;
const STOP_ALL =
	'Shut down all of WSL? This stops every distro and the virtual machine itself — including Docker Desktop if it uses the WSL2 backend. Use this when stopping a single distro did not clear the problem.';

/// Live WSL state, and the two ways to stop it.
///
/// Stopping one distro comes first; shutting everything down sits below a
/// separator as the escalation. That ordering is not just tidiness — it is the
/// real troubleshooting order, because `--terminate` leaves the VM up and will
/// not always clear a wedged VM, which is when `--shutdown` earns its keep.
const WslControl = ({
	distros,
	onChanged,
	onConfirm,
	onResult
}: WslControlProps) => {
	const [open, setOpen] = useState(false);
	// Which row is working, or null. One value answers both "is anything in
	// flight?" and "which button says Stopping…", so two can never be at once.
	const [busy, setBusy] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		window.addEventListener('mousedown', away);
		window.addEventListener('keydown', esc);
		return () => {
			window.removeEventListener('mousedown', away);
			window.removeEventListener('keydown', esc);
		};
	}, [open]);

	const run = (label: string, command: string, args: Record<string, unknown>) => {
		setBusy(label);
		invoke<string>(command, args)
			.then(msg => onResult(msg, 'success'))
			.catch(e => onResult(typeof e === 'string' ? e : String(e), 'error'))
			.finally(() => {
				// Whatever happened, the displayed state is now questionable —
				// especially on failure — so it is re-read, not assumed.
				setBusy(null);
				setOpen(false);
				onChanged();
			});
	};

	const running = distros.length > 0;
```

The `.finally` is the important half of `run`. Whatever happened — resolved, rejected, timed out into an `Err` — it clears `busy`, closes the popover, and calls `onChanged()` to re-query the distro list. Especially on failure: a `StillRunning` error is precisely the case where the displayed state is now questionable. Doing the refresh in `.then` would refresh only when it worked.

The two confirmation sentences are module constants, above the component, because they are the part of this file most worth reading on their own (below).

The trigger and the menu:

```tsx
	return (
		<div className='relative' ref={ref}>
			<Button
				variant='badge'
				title={
					running
						? `WSL running: ${distros.join(', ')}`
						: 'No WSL distro is running'
				}
				onClick={() => setOpen(v => !v)}
				disabled={!running}
			>
				WSL · {running ? `${distros.length} running` : 'stopped'}
			</Button>

			{open && (
				<div className='absolute right-0 mt-1 z-50 min-w-56 bg-bg-secondary border border-border rounded-lg shadow-2xl py-1 text-sm'>
					{distros.map(d => (
						<div
							key={d}
							className='flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-bg-hover/50'
						>
							<span className='font-mono text-xs truncate text-text-secondary'>
								{d}
							</span>
							<Button
								variant='ghost'
								className='text-xs px-2'
								disabled={busy !== null}
								onClick={() =>
									onConfirm(STOP_ONE(d), () =>
										run(d, 'terminate_distro', { distro: d })
									)
								}
							>
								{busy === d ? 'Stopping…' : 'Stop'}
							</Button>
						</div>
					))}

					<div className='my-1 border-b border-border' />

					<Button
						variant='ghost'
						className='w-full justify-start text-xs px-3 hover:bg-danger/10'
						disabled={busy !== null}
						onClick={() =>
							onConfirm(STOP_ALL, () => run('all', 'shutdown_wsl', {}))
						}
					>
						<span className='text-danger'>
							{busy === 'all' ? 'Shutting down…' : 'Shut down all WSL'}
						</span>
					</Button>
				</div>
			)}
		</div>
	);
};

export default WslControl;
```

The red label is a `<span>` *inside* the ghost button rather than `text-danger` on the button. Chapter 11 met the reason: `ghost` sets `text-text-muted`, Tailwind emits that class after `text-danger`, and a `className` cannot reorder the stylesheet. A child element has its own colour and no fight. (The hover background *can* be overridden, because `hover:bg-danger/10` and `hover:bg-bg-hover` happen to sort the right way — but that is luck, and a span is not.)

### The order is the argument

Per-distro `Stop` rows come first. A separator. `Shut down all WSL` below it, in red.

That layout is the **actual troubleshooting order**, and both halves have a reason:

**Why `--terminate` first.** `wsl --shutdown` stops every distro *and* the virtual machine. On a machine with four distros, using it to fix one means taking down the three you are not having trouble with — plus Docker Desktop, if it runs on the WSL2 backend, plus every container in it. `--terminate` is the scalpel that costs you only the distro you named.

**Why `--shutdown` still has to be there.** `--terminate` stops the distro but leaves the VM up, and a wedge that lives in the VM — or in WSLService's view of it — survives that. So the escalation is real; it just should not be the first thing your cursor lands on.

The two confirmation messages carry the difference. `STOP_ONE` names what dies inside *that* distro and explicitly reassures you that others are untouched. `STOP_ALL` names the VM, names Docker Desktop, and ends with *use this when stopping a single distro did not clear the problem* — a confirmation dialog that tells you the *precondition for using it*, not just what it will do.

**When one action is a bigger hammer than another, the ordering, the separator and the wording should all say so.** A dropdown that lists both as peers is a dropdown that will get `--shutdown` clicked by someone who wanted `--terminate`.

### Wiring it in `App.tsx`

Import `WslControl`. Below chapter 11's `summonHotkey` read:

```tsx
	// Live WSL state, refreshed on the passes the app already makes — every
	// scan, and every stop attempt — never on a timer. `wsl -l -q --running`
	// boots nothing, so it is free to ask.
	const [distros, setDistros] = useState<string[]>([]);
	const refreshDistros = () => {
		invoke<string[]>('get_running_distros').then(setDistros).catch(() => {});
	};
	useEffect(refreshDistros, [workspaceStates]);

	// One dialog, two destructive actions with two different sentences: the
	// popover asks App to confirm, and App renders the question.
	const [confirmAction, setConfirmAction] = useState<{
		message: string;
		run: () => void;
	} | null>(null);
```

The pill sits in the title bar beside the runtime indicator:

```tsx
			<TitleBar>
				<div className='flex items-center gap-2'>
					<WslControl
						{...{
							distros,
							onChanged: refreshDistros,
							onConfirm: (message: string, run: () => void) =>
								setConfirmAction({ message, run }),
							onResult: toast
						}}
					/>
					<RuntimeIndicator runtime={runtime?.runtime ?? 'windows'} />
				</div>
			</TitleBar>
```

And a second `ConfirmDialog` above the workspace one, which gains `confirmLabel: 'Remove'`:

```tsx
			<ConfirmDialog
				{...{
					open: confirmAction !== null,
					title: 'Stop WSL',
					message: confirmAction?.message ?? '',
					confirmLabel: 'Stop',
					onConfirm: () => {
						confirmAction?.run();
						setConfirmAction(null);
					},
					onCancel: () => setConfirmAction(null)
				}}
			/>
```

Three things there are worth naming.

**`refreshDistros` runs when `workspaceStates` changes, and never on an interval.** `workspaceStates` is replaced on every scan — mount, F5, a workspace added or removed — so the pill re-reads on exactly the passes the app already makes, plus the one `onChanged` adds after a stop. Calling it on mount and after `onChanged` only would leave F5 with a stale pill; riding the scan makes the claim true. A poll would make DevGo do work forever in the background for a pill nobody is looking at — chapter 06's no-timer rule holding.

**`confirmAction` stores a message and a closure**, which is how one `ConfirmDialog` serves two different destructive actions with two different sentences. `WslControl` does not own a dialog; it calls `onConfirm(message, action)` and lets `App` render it. A modal owned by a popover would unmount when the popover closed, which is exactly what the popover does the moment you click outside it to reach the dialog.

**`onResult` is `toast` itself.** The Rust side already phrased every outcome (§12.2), including both failures, so the frontend's job is to display the string and pick a colour — not to interpret it. `WslControlProps.onResult` is typed with `ToastType` for exactly that reason: the popover speaks the toast's language and nothing is translated on the way. `catch` narrows the rejection to a string, because Tauri serialises `AppError` through its `Display`, and `WslStopFailed`'s `#[error("{0}")]` means the wire value is the sentence itself.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅UI: WslControl pill in the title bar — Stop one distro, Shut down all WSL below the separator, ConfirmDialog names its verb"
> git commit --allow-empty -m "✅STAGE: 12 wsl-control"
> git checkout main && git merge 12.wsl-control && git push origin 12.wsl-control main
> ```

---

## 12.4 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun tauri dev
```

`cargo test` still reports **26** — this chapter adds no Rust tests. Every function it introduces either shells out (`run_with_timeout`, `terminate`, `shutdown_all`) or is a two-line mapping over an enum (`describe`), and there is no pure logic in any of them worth pinning. Chapter 10's point stands: the tests live where the parsing does.

Then the checks only a running app can answer. Do these with a terminal open beside DevGo.

**Stopped means stopped.** With no distro running, the pill reads **`WSL · stopped`**, grey and dimmed, and clicking it does nothing.

**The pill does not poll.** Start a distro from the terminal:

```powershell
wsl -d Ubuntu-26.04 echo ok
wsl -l -q --running
```

The pill still reads `stopped`. Press **F5**. Now it reads **`WSL · 1 running`** in accent colour. Same relationship with WSL the whole app has: DevGo never starts a distro behind your back, and never busies the machine watching for one.

**Stop one.** Click the pill. The popover lists `Ubuntu-26.04` with a `Stop` button, a separator, and `Shut down all WSL` in red below it — the escalation order from §12.3. Click `Stop`. The confirmation is titled *Stop WSL*, names the distro, tells you other distros are left alone, and its red button says **Stop**, not Remove. Confirm it. The button reads `Stopping…` for a moment, then a success toast says `Ubuntu-26.04 stopped`, the popover closes, and the pill goes back to `stopped`. Measured live: `Stopping…` at 9 ms, toast at 318 ms. Confirm from the terminal:

```powershell
wsl -l -q --running
```

Empty. That round trip is the feature, and the "stopped" in the toast came from re-querying `running_distros()` rather than from the exit code (§12.1).

**Escalate.** Start the distro again, F5, open the popover, click `Shut down all WSL`. The dialog names the VM and Docker Desktop and ends with the precondition sentence. Confirm: `Shutting down…`, then `WSL stopped` — 1.5 s here, well inside the bound — and `wsl -l -q --running` is empty.

**The popover is a popover.** Open it and press `Escape`: it closes, and the search box's query is untouched. Open it and click anywhere else: it closes.

---

## What you built

```
src-tauri/src/
├── services/platform/wsl.rs ← STOP_TIMEOUT, StopOutcome, run_with_timeout,
│                               terminate, shutdown_all
├── commands.rs              ← get_running_distros, describe, terminate_distro,
│                               shutdown_wsl
├── error.rs                 ← WslStopFailed(message)
└── lib.rs                   ← three commands registered
src/
├── types.d.ts               ← WslControlProps; ConfirmDialogProps.confirmLabel;
│                               ButtonVariant gains 'badge'
├── App.tsx                  ← distros + refreshDistros riding the scan, WslControl
│                               in the TitleBar, second ConfirmDialog
└── components/
    ├── WslControl.tsx       ← NEW: pill + popover, escalation order, busy state
    ├── Button.tsx           ← 'badge' variant
    └── ConfirmDialog.tsx    ← names its verb
```

> **The thread running through this half of Slice 3.** It is the same one chapter 11 carried — **a claim the app makes to the user, and whether it can be wrong** — applied to a machine instead of a keyboard. A toast that says "stopped" is a claim about the machine, so the machine gets re-queried before the toast is written. A pill that says "1 running" is a claim about *now*, so it re-reads on every pass rather than trusting the last one. And a stop command that never returns is the app claiming to still be working when it has stopped waiting — so the wait is bounded, and giving up is reported as its own outcome rather than dressed up as a failure.

---

→ Next: [13 — The Editor & Terminal Registry](./13-targets.md) (Slice 4), where "VS Code" stops being hardcoded, `Ctrl+Enter` learns which editor you meant, and the Settings shell gets its second panel by adding one object to the array.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [11 — Keyboard-First & the Settings Shell](./11-keyboard.md)
