# 05 — Launcher Service (Phase 4)

**Branch:** `05.launcher` — `git checkout 05.launcher` gives you this chapter's finished app; `git diff 04.wsl 05.launcher` is exactly what this chapter adds.

**Starting from:** chapter 04 — WSL detection, a cached `RuntimeInfo` and a badge that shows it.

**Goal:** open VS Code and Windows Terminal for a project — natively on Windows, or via VS Code Remote + a tmux session when the project lives in WSL — and the buttons, the double-click and the Enter key that ask for it. On the way, the one piece of path translation the launcher needs.

This is the last chapter of the first build. After it, DevGo is a launcher: add a workspace, pick a project, open it. The three chapters that follow make it one you can leave running.

> **Hold on to:**
> 1. **`spawn()` starts a process and walks away; `output()` waits for it.** Launching an editor is `spawn`. Asking `wsl.exe` a question (chapter 04) is `output`.
> 2. **A guess that can be wrong silently is worse than an error that is loud** — `distro_from_project` returns `Err` rather than assuming `"Ubuntu"`, and `?` at every call site is what enforces it.
> 3. **Never build a path out of a string you did not choose.** `sanitize_file_stem` reduces a project name to an alphabet you control before it becomes a filename.
> 4. **A command takes the whole `Project` back** — the frontend already has the object; it hands it over, Tauri deserializes it, nothing is unpacked.

---

## 5.1 — Two more errors

This chapter produces two failures the enum does not describe yet. Add to `src-tauri/src/error.rs`, after `Lock`:

```rust
    #[error("Could not determine which WSL distro to use for {0}. Check that WSL is installed and has at least one distro registered.")]
    NoWslDistro(String),

    #[error("Failed to launch: {0}")]
    LaunchFailed(String),
```

`NoWslDistro` is the one this chapter is built around — §5.2 explains why it exists instead of a default. `LaunchFailed` wraps whatever the OS says when a process will not start.

---

## 5.2 — Path translation

Windows and WSL name the same file differently: `C:\dev\app` ↔ `/mnt/c/dev/app`, and a project *inside* a distro is `\\wsl.localhost\Ubuntu\home\user\app` to Windows but `/home/user/app` to VS Code Remote. The launcher needs the Windows → Linux direction. Create `src-tauri/src/services/platform/paths.rs`:

```rust
pub fn windows_to_wsl_path(windows_path: &str, distro: &str) -> String {
    let normalized = windows_path.replace('\\', "/");

    let wsl_unc_prefix = format!("//wsl.localhost/{}", distro);
    if normalized.starts_with(&wsl_unc_prefix) {
        return normalized[wsl_unc_prefix.len()..].to_string();
    }

    if normalized == "/" {
        return normalized;
    }

    if let Some(rest) = normalized.strip_prefix('/') {
        if !rest.is_empty() && rest.contains('/') {
            return normalized;
        }
    }

    if normalized.len() >= 3
        && normalized.as_bytes()[1] == b':'
        && normalized.as_bytes()[2] == b'/'
    {
        let drive = (normalized.as_bytes()[0] as char)
            .to_lowercase()
            .to_string();
        return format!("/mnt/{}{}", drive, &normalized[2..]);
    }

    normalized
}
```

### Why the UNC prefix is checked first, and why `distro` is a parameter

Test it in your head without the first `if`: a project *inside* WSL comes through as `\\wsl.localhost\Ubuntu\home\user\app`. Normalized that's `//wsl.localhost/Ubuntu/home/user/app` — it starts with `/`, has many slashes, so the passthrough case would return it **unchanged**. But VS Code Remote wants the *Linux* path `/home/user/app`, without the `//wsl.localhost/Ubuntu` prefix.

So we strip that prefix — and to strip it we need to know the distro name. That is the entire reason `windows_to_wsl_path` takes `distro`, and why the UNC case sits above every other branch.

### Byte-level checks *(skip on first pass)*

```rust
normalized.as_bytes()[1] == b':' && normalized.as_bytes()[2] == b'/'
```

We check the second byte is `:` and the third is `/` — the `C:/` drive-letter shape (after normalizing `\` → `/`). `b':'` is a *byte literal*; drive letters are ASCII so byte indexing is safe here. Then `/mnt/{drive}{rest}` builds the WSL path, lowercasing the drive (`C` → `c`). A path that is already Unix-style (starts with `/` and has more slashes) is returned unchanged.

The inverse, `wsl_to_windows_path`, is not here: nothing calls it for many chapters, and it arrives with its first caller.

Add to `src-tauri/src/services/platform/mod.rs`:

```rust
pub mod detection;
pub mod paths;
pub mod runtime;
pub mod wsl;

pub use detection::RuntimeInfo;
```

`error.rs`, `paths.rs` and the `platform/mod.rs` line have no commit of their own: nothing calls them until the VS Code launcher in §5.5, and they are committed with it there.

---

## 5.3 — Detecting a WSL project

The launcher decides *per project* whether to go native or WSL — based on the project's own path, not the host runtime (you can browse a WSL folder from a Windows-hosted DevGo). Create `src-tauri/src/services/launcher.rs`:

```rust
use std::os::windows::process::CommandExt;
use std::process::Command;

use super::platform::RuntimeInfo;
use crate::error::AppError;
use crate::models::Project;

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn is_wsl(project: &Project) -> bool {
    let normalized = project.full_path.replace('\\', "/");
    normalized.starts_with("//wsl.localhost/")
        || normalized.starts_with("//wsl$/")
}

/// Resolve which distro a project belongs to.
///
/// A WSL-native path names its own distro, so prefer that. Otherwise fall back
/// to the detected default. There is deliberately no hardcoded distro name —
/// "Ubuntu" is not a safe guess, and silently launching into the wrong distro
/// is worse than a clear error.
fn distro_from_project(
    project: &Project,
    info: &RuntimeInfo,
) -> Result<String, AppError> {
    if is_wsl(project) {
        let path = project.full_path.replace('\\', "/");
        for prefix in ["//wsl.localhost/", "//wsl$/"] {
            if let Some(rest) = path.strip_prefix(prefix) {
                if let Some(distro) = rest.split('/').find(|s| !s.is_empty()) {
                    return Ok(distro.to_string());
                }
            }
        }
    }
    info.default_distro
        .clone()
        .ok_or_else(|| AppError::NoWslDistro(project.full_path.clone()))
}
```

### `is_wsl` — path shape, not host

A project is "in WSL" if its path is a `\\wsl.localhost\…` (or legacy `\\wsl$\…`) UNC path. We normalize slashes and check the prefix. Simple and reliable — and the same check the scanner made in chapter 03 to write the `WSL` tag; this one reads the project's own path rather than its workspace's.

### `distro_from_project` — where does the distro name come from?

For a WSL-native path like `//wsl.localhost/Ubuntu/home/user/app`, the distro is the first segment *after* the prefix (`Ubuntu`). We `strip_prefix` and take the first non-empty segment — non-empty because a doubled slash would otherwise hand us `""` as a distro name. If the project isn't WSL-native (a `C:\` project we're opening in WSL by choice), we use the host's `default_distro` from chapter 04.

### The fallback that isn't there

The tempting last line is `.unwrap_or_else(|| "Ubuntu".to_string())` — always return *something*, never fail. Resist it, and be clear about what it would actually buy you.

If we reach that line, we genuinely do not know which distro this project lives in. Guessing `"Ubuntu"` does not produce an error the user can read; it produces a **successful launch into the wrong environment**. VS Code opens. A terminal opens. The wrong Node version is on `PATH`, `git` sees a different config, the database socket isn't there — and the failure surfaces ten minutes later, somewhere with no connection to the real cause. Worse, on a machine with no distro named Ubuntu the guess isn't even wrong-but-plausible, it's a name that doesn't exist.

`AppError::NoWslDistro` (§5.1) says the true thing instead: *"Could not determine which WSL distro to use for `<path>`. Check that WSL is installed and has at least one distro registered."* One toast, cause and fix in the same sentence. **A guess that can be wrong silently is worse than an error that is always right loudly** — and the `?` in every call site below is what enforces it.

---

## 5.4 — One way to spawn

Before the first launch function, the helper every one of them goes through — because of what you would otherwise see. Spawn `code` or `wt` directly with `Command::new("code").spawn()` and a black console window *flashes* for each launch. Two reasons: (1) on Windows, `code` and `wt` are usually `.cmd` shims that resolve cleanly through `cmd`, and (2) each child process gets its own console. The fix is the same `CREATE_NO_WINDOW` trick from chapter 04, applied to a `cmd /c` wrapper:

```rust
fn spawn_cmd(args: &[&str]) -> Result<(), AppError> {
    Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .args(std::iter::once(&"/c").chain(args.iter()))
        .spawn()
        .map_err(|e| AppError::LaunchFailed(e.to_string()))?;
    Ok(())
}
```

### `spawn()` vs `output()`

`output()` (used for `wsl -l -q` in chapter 04) runs the process and *waits*, capturing stdout. `spawn()` starts the process and returns immediately — the child runs on its own. We `spawn` here because we don't want to block while VS Code is open. The returned `Child` handle is dropped right away; we never wait on it.

### `std::iter::once(&"/c").chain(args.iter())` *(skip on first pass)*

`spawn_cmd(&["code", &path])` should run `cmd /c code <path>`. We prepend `/c` by chaining a one-item iterator (`once(&"/c")`) in front of the args iterator. No intermediate `Vec` allocation.

---

## 5.5 — Launch VS Code

```rust
pub fn launch_vscode(
    project: &Project,
    info: &RuntimeInfo,
) -> Result<(), AppError> {
    if is_wsl(project) {
        let distro = distro_from_project(project, info)?;
        let linux_path = super::platform::paths::windows_to_wsl_path(
            &project.full_path,
            &distro,
        );
        let uri = format!("vscode-remote://wsl+{}{}", distro, linux_path);
        spawn_cmd(&["code", "--folder-uri", &uri])
    } else {
        spawn_cmd(&["code", &project.full_path])
    }
}
```

### The WSL Remote URI

For WSL projects we build `vscode-remote://wsl+Ubuntu/home/user/app` — this is exactly the URI VS Code's Remote-WSL extension understands. `windows_to_wsl_path` (§5.2) turns the UNC path into the Linux path VS Code expects. The native branch is `code <path>`, nothing more.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: launch VS Code (native + WSL remote)"
> git push
> ```
>
> (This commit carries §5.1–§5.4 as well: the two error variants, `paths.rs`, and the first half of `launcher.rs`.)

---

## 5.6 — Launch Windows Terminal

Native is a one-liner (`wt -d <path>`). WSL is richer: we drop the user into a **tmux session** with three windows (code / agents / git), reattaching if it already exists.

```rust
pub fn launch_terminal(
    project: &Project,
    info: &RuntimeInfo,
) -> Result<(), AppError> {
    if is_wsl(project) {
        let distro = distro_from_project(project, info)?;
        let linux_path = super::platform::paths::windows_to_wsl_path(
            &project.full_path,
            &distro,
        );
        let script = build_tmux_script(&project.name, &linux_path);
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir
            .join(format!("devgo-{}.sh", sanitize_file_stem(&project.name)));
        std::fs::write(&temp_file, &script)?;
        let wsl_temp = super::platform::paths::windows_to_wsl_path(
            &temp_file.to_string_lossy(),
            &distro,
        );
        spawn_cmd(&["wt", "wsl", "bash", &wsl_temp])
    } else {
        spawn_cmd(&["wt", "-d", &project.full_path])
    }
}
```

And the two helpers it leans on, at the bottom of the file:

```rust
/// Reduce a project name to something safe to embed in a filename. Without this
/// a project containing a separator would escape the temp directory.
fn sanitize_file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed.to_string()
    }
}

fn build_tmux_script(session: &str, linux_path: &str) -> String {
    format!(
        r#"#!/usr/bin/env bash
        if ! tmux has-session -t "{session}" 2>/dev/null; then
            tmux new-session -d -s "{session}" -n code -c "{linux_path}"
            tmux new-window -t "{session}:" -n agents -c "{linux_path}"
            tmux new-window -t "{session}:" -n git -c "{linux_path}"
        fi
        tmux attach -t "{session}"
        "#
    )
}
```

The script lines inside the raw string are indented to sit under `r#"` — and a raw string keeps every byte, so the file that lands in `/tmp` carries those eight leading spaces on each line after the shebang. Bash does not care; the shebang is on the first line, unindented, which is the one place it has to be. (`cargo fmt` never touches the inside of a string literal, so the indentation is whatever was typed.)

### Why write a temp script instead of a long `wt` command line?

Quoting a multi-line tmux setup through `wt wsl bash -c "…"` is a nightmare of nested quotes and escaping across three shells (cmd → wt → bash). Writing the script to `%TEMP%\devgo-<name>.sh` and running `wt wsl bash <path>` sidesteps all of it. We translate the temp file's Windows path to a WSL path (`/mnt/c/…/devgo-app.sh`) so bash inside WSL can find it.

### The tmux layout

`build_tmux_script` emits a raw-string (`r#"…"#`) bash script: if a session named after the project doesn't exist, create it with three windows — `code`, `agents`, `git` — all `cd`'d into the project. Then `tmux attach`. Relaunching the same project reattaches to the running session instead of spawning a duplicate. Raw strings let us write literal `"` and `\` without escaping. (Those three names are a string literal today; chapter 26 makes them yours, and finds a bug in this very `if` while doing it.)

### A project name is not a filename

Read the temp-file line with an adversarial eye, and imagine it without `sanitize_file_stem`. `project.name` is a folder name off the user's disk. We are pasting it into a path. On Windows most of the trouble is caught for us — `\` and `/` are rejected in a filename — but `join` does not reject a *string containing a separator*: `devgo-../../evil.sh` resolves out of `%TEMP%` entirely, and we then `fs::write` to it. A space or a `:` in a project name is enough to make the write fail outright, which is the milder version of the same bug.

The rule is simple: **never build a path out of a string you did not choose.** Reduce the name to an alphabet you control.

Allow-list, not deny-list *(skip on first pass)*: we enumerate the characters that are *fine* and replace everything else, rather than trying to list every character that is dangerous — a list you will always finish too early. `trim_matches('-')` stops names like `.config` becoming `-config`, and the `"project"` fallback covers a name that sanitizes down to nothing (a folder called `...`). Note the tmux **session** name still uses the raw `project.name` — that's a tmux argument, not a path, and it's quoted in the script.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: launch Windows Terminal (native) and a tmux session script for WSL"
> git push
> ```

---

## 5.7 — Launch both, and expose the commands

`launch_both` opens the editor, waits a beat so it grabs focus first, then opens the terminal:

```rust
pub fn launch_both(
    project: &Project,
    info: &RuntimeInfo,
) -> Result<(), AppError> {
    launch_vscode(project, info)?;
    std::thread::sleep(std::time::Duration::from_millis(1000));
    launch_terminal(project, info)
}
```

`std::thread::sleep` blocks this command's thread for one second. Tauri commands run on a thread pool, so the app doesn't freeze — but the frontend's `invoke('open_both')` promise resolves a second later, which is fine.

Now the Tauri commands. Add to `src-tauri/src/commands.rs`:

```rust
use crate::services::launcher;

#[tauri::command]
pub fn open_vscode(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    launcher::launch_vscode(&project, &state.runtime_info)
}

#[tauri::command]
pub fn open_terminal(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    launcher::launch_terminal(&project, &state.runtime_info)
}

#[tauri::command]
pub fn open_both(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    launcher::launch_both(&project, &state.runtime_info)
}
```

### Commands take a whole `Project`

Notice the parameter is `project: Project`, not a bundle of `path`/`use_wsl`/`distro` primitives. The frontend already *has* the `Project` object (from `get_projects`), so it just hands the whole thing back. Tauri deserializes the JSON into a `Project` (this is why the struct derives `Deserialize`). The command pulls the cached `runtime_info` from state and delegates to the launcher. Clean and symmetric.

Register the launcher module in `src-tauri/src/services/mod.rs`:

```rust
pub mod launcher;
pub mod platform;
pub mod scanner;
pub mod workspace;

pub use scanner::scan_workspace;
pub use workspace::WorkspaceStore;
```

And add the three commands to the `invoke_handler` in `src-tauri/src/lib.rs`:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::get_projects,
            commands::get_runtime_info,
            commands::open_vscode,
            commands::open_terminal,
            commands::open_both,
        ])
```

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: launch_both + open_* commands"
> git push
> ```
>
> The branch has one more Rust commit here, for `wsl.rs` alone: the two comment typos chapter 04's `cargo fmt` pass had fixed (`whitepsace`, `whic`) came back with this chapter's first commit and were fixed again. The net diff of the chapter does not touch `wsl.rs`; if yours is already clean, there is nothing to commit, and if it is not:
>
> ```powershell
> git add -A
> git commit -m "✅RUST: wsl.rs comment typos"
> git push
> ```

The **entire Rust backend of the first build** now compiles, with nothing declared ahead of its use: workspaces persist, directories scan, WSL is detected, paths translate, and VS Code + Windows Terminal launch in both modes.

```
src-tauri/src/services/
├── workspace.rs   ← persistence
├── scanner.rs     ← scan + filesystem tag
├── launcher.rs    ← code / wt / tmux, all via spawn_cmd
└── platform/
    ├── runtime.rs
    ├── wsl.rs
    ├── paths.rs
    └── detection.rs
```

---

## 5.8 — Types first

Three shapes change or arrive. In `src/types.d.ts`:

`ProjectTreeProps` gains two callbacks:

```ts
interface ProjectTreeProps {
	projects: Project[];
	selected: Project | null;
	onSelect: (p: Project) => void;
	onDoubleClick: (p: Project) => void;
	onLaunch: (p: Project) => void;
	loading?: boolean;
	ref?: React.Ref<ProjectTreeHandle>;
}
```

`ActionButtonsProps` is new:

```ts
interface ActionButtonsProps {
	hasSelection: boolean;
	onAddWorkspace: () => void;
	onRemoveWorkspace: () => void;
	onVSCode: () => void;
	onTerminal: () => void;
	onBoth: () => void;
}
```

And `Button` learns a fifth variant — the action row's pill shape:

```ts
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'pill';
```

---

## 5.9 — `useLaunchActions`

Create `src/hooks/useLaunchActions.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

export const useLaunchActions = (
	selected: Project | null,
	refreshProjects: () => void
) => {
	const [showWorkspaces, setShowWorkspaces] = useState(false);

	const addWorkspace = async (path: string) => {
		await invoke('add_workspace', { path });
		refreshProjects();
	};

	const removeWorkspace = async (index: number) => {
		await invoke('remove_workspace', { index });
		refreshProjects();
	};

	const openVSCode = () => {
		if (!selected) return Promise.resolve();
		return invoke('open_vscode', { project: selected });
	};

	const openTerminal = () => {
		if (!selected) return Promise.resolve();
		return invoke('open_terminal', { project: selected });
	};

	const openBoth = (project?: Project) => {
		const p = project ?? selected;
		if (!p) return Promise.resolve();
		return invoke('open_both', { project: p });
	};

	return {
		showWorkspaces,
		setShowWorkspaces,
		addWorkspace,
		removeWorkspace,
		openVSCode,
		openTerminal,
		openBoth
	};
};
```

### Passing the whole `Project` back

`openVSCode`/`openTerminal` send `{ project: selected }` — the entire object the backend gave us. Because the launch commands take a `Project`, there's nothing to unpack. Each guards on `selected` being non-null and returns a resolved promise if there's no selection (so callers can always `.catch()` safely).

### Why does `useLaunchActions` take `refreshProjects`?

Adding or removing a workspace changes which projects exist, so those actions call `refreshProjects()` afterward to rescan — the gap chapter 03 pointed at. The hook receives it as a parameter rather than importing `useProjects` — that keeps the hooks decoupled and lets `App` wire them together. `openBoth` also accepts an optional explicit `project`, so a double-click can launch a row without it being the current selection first.

`showWorkspaces` lives here too: whether the workspace panel is showing is a question about the action row, and the action row is what this hook drives. One hook, one file — `useRuntime` from chapter 04 stays in its own.

---

## 5.10 — The pill, and ActionButtons

First the variant. In `src/components/Button.tsx`, `VARIANT` gains one entry:

```tsx
	pill: 'px-6 py-2.5 text-[13px] border border-border rounded-[20px] bg-bg-panel text-text-secondary hover:not-disabled:bg-bg-hover hover:not-disabled:text-text-primary hover:not-disabled:border-accent'
```

`hover:not-disabled:` keeps a disabled pill from lighting up under the cursor; the `disabled:` opacity is already in `base`. Now the row — a data-driven `Button` list. Create `src/components/ActionButtons.tsx`:

```tsx
import Button from './Button';

const BUTTONS = [
	{ key: 'remove', label: 'Remove' },
	{ key: 'add', label: 'Add' },
	{ key: 'code', label: 'VS Code' },
	{ key: 'terminal', label: 'Terminal' },
	{ key: 'both', label: 'Open Both' }
] as const;

const NEEDS_SELECTION = new Set(['code', 'terminal', 'both']);

const ActionButtons = ({
	hasSelection,
	onAddWorkspace,
	onRemoveWorkspace,
	onVSCode,
	onTerminal,
	onBoth
}: ActionButtonsProps) => {
	const handlers: Record<(typeof BUTTONS)[number]['key'], () => void> = {
		remove: onRemoveWorkspace,
		add: onAddWorkspace,
		code: onVSCode,
		terminal: onTerminal,
		both: onBoth
	};

	return (
		<div className='flex justify-center gap-2.5 shrink-0 flex-wrap'>
			{BUTTONS.map(({ key, label }) => (
				<Button
					key={key}
					variant='pill'
					disabled={NEEDS_SELECTION.has(key) && !hasSelection}
					onClick={handlers[key]}
				>
					{label}
				</Button>
			))}
		</div>
	);
};

export default ActionButtons;
```

### Data-driven + `as const`

Five buttons, one `Button` mapped over `BUTTONS`. `as const` makes TypeScript infer literal string types for `key`, and `handlers` is typed against exactly those five keys — add a sixth entry to `BUTTONS` without a handler and it is a compile error, not a dead button. `NEEDS_SELECTION` is a `Set` of the keys that require a selected project — those buttons are `disabled` until `hasSelection` is true. The two workspace buttons (`Remove`/`Add`) both open the workspace manager, so they're always enabled. A sixth button joins the row in chapter 06, and the question of whether *it* belongs in `NEEDS_SELECTION` turns out to matter.

---

## 5.11 — Enter and double-click launch

`ProjectTree` learns two more ways to say "open this". Destructure the two new props (`onDoubleClick`, `onLaunch`), and the window keydown handler becomes a key → action map, the same shape `SearchBox` used in chapter 03, with Enter as its third entry:

```tsx
	useEffect(() => {
		const launch = () => {
			if (selected) onLaunch(selected);
			else if (visible.length > 0) onLaunch(visible[0]);
		};
		const keys: Record<string, () => void> = {
			ArrowDown: () => navigate(1),
			ArrowUp: () => navigate(-1),
			Enter: launch
		};
		const handler = (e: globalThis.KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement) return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const action = keys[e.key];
			if (!action) return;
			e.preventDefault();
			action();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selected, visible, navigate, onLaunch]);
```

and the row its second click handler, right under `onClick`:

```tsx
											onClick={() => onSelect(project)}
											onDoubleClick={() => onDoubleClick(project)}
```

Enter with nothing selected launches the first visible project — the list is a launcher, and the common case is "the one at the top". The modifier guard (`ctrlKey || metaKey || altKey`) keeps Ctrl+Enter and friends free for a later chapter. The effect's dependency list grows to everything the handler now reads; leave one out and Enter launches a project you selected three renders ago.

---

## 5.12 — App composition

Everything is wired here. `src/App.tsx` in full — the panel moves behind the **Add**/**Remove** buttons, and every launch path ends in a toast when it fails:

```tsx
import { lazy, Suspense, useRef, useState } from 'react';
import ActionButtons from './components/ActionButtons';
import Button from './components/Button';
import ConfirmDialog from './components/ConfirmDialog';
import ProjectTree from './components/ProjectTree';
import RuntimeIndicator from './components/RuntimeIndicator';
import SearchBox from './components/SearchBox';
import TitleBar from './components/TitleBar';
import ToastProvider, { useToast } from './components/Toast';
import { useLaunchActions } from './hooks/useLaunchActions';
import { useProjects } from './hooks/useProjects';
import { useRuntime } from './hooks/useRuntime';
import { useWorkspaces } from './hooks/useWorkspaces';

const WorkspaceManager = lazy(() => import('./components/WorkspaceManager'));

const showError = (e: unknown): string => {
	if (typeof e === 'string') return e;
	if (e && typeof e === 'object') {
		const obj = e as Record<string, unknown>;
		for (const key of Object.keys(obj)) {
			const val = obj[key];
			if (typeof val === 'string') return val;
			if (val && typeof val === 'object') return showError(val);
		}
	}
	return 'Something went wrong';
};

const AppInner = () => {
	const runtime = useRuntime();
	const { workspaces } = useWorkspaces();
	const {
		filtered,
		query,
		setQuery,
		selected,
		setSelected,
		refresh,
		loading
	} = useProjects();
	const {
		showWorkspaces,
		setShowWorkspaces,
		addWorkspace,
		removeWorkspace,
		openVSCode,
		openTerminal,
		openBoth
	} = useLaunchActions(selected, refresh);
	const { toast } = useToast();
	const [removeIndex, setRemoveIndex] = useState<number | null>(null);

	const treeRef = useRef<ProjectTreeHandle>(null);
	const handleArrow = (dir: 1 | -1) => treeRef.current?.navigate(dir);

	const handleSelect = (p: Project) => setSelected(p);

	const handleLaunch = (p: Project) => {
		setSelected(p);
		openBoth(p).catch(e => toast(showError(e)));
	};

	const handleSearchEnter = () => {
		const target = selected ?? filtered[0];
		if (target) handleLaunch(target);
	};

	const handleRemove = async (index: number) => {
		try {
			await removeWorkspace(index);
		} catch (e) {
			toast(showError(e));
		}
	};

	const handleOpenVSCode = () => openVSCode().catch(e => toast(showError(e)));
	const handleOpenTerminal = () =>
		openTerminal().catch(e => toast(showError(e)));
	const handleOpenBoth = () => openBoth().catch(e => toast(showError(e)));

	return (
		<div className='flex flex-col h-screen w-screen rounded-xl overflow-hidden'>
			<TitleBar>
				<RuntimeIndicator runtime={runtime?.runtime ?? 'windows'} />
			</TitleBar>

			{showWorkspaces && (
				<div
					className='fixed inset-0 bg-black/60 flex items-center justify-center z-40'
					onClick={() => setShowWorkspaces(false)}
				>
					<div
						className='bg-bg-secondary border border-border rounded-xl p-6 w-screen h-screen min-w-md overflow-y-auto shadow-2xl'
						onClick={e => e.stopPropagation()}
					>
						<Suspense>
							<WorkspaceManager
								{...{
									workspaces,
									onAdd: addWorkspace,
									onRemove: (i: number) => setRemoveIndex(i)
								}}
							/>
						</Suspense>
						<Button
							className='w-full mt-4'
							onClick={() => setShowWorkspaces(false)}
						>
							Close
						</Button>
					</div>
				</div>
			)}

			<ConfirmDialog
				{...{
					open: removeIndex !== null,
					title: 'Remove Workspace',
					message:
						'Are you sure you want to remove this workspace folder? Your files will not be deleted.',
					onConfirm: () => {
						if (removeIndex !== null) handleRemove(removeIndex);
						setRemoveIndex(null);
					},
					onCancel: () => setRemoveIndex(null)
				}}
			/>

			<div className='flex-1 flex flex-col p-5 gap-4 overflow-hidden'>
				<SearchBox
					{...{
						value: query,
						onChange: setQuery,
						onEnter: handleSearchEnter,
						onArrow: handleArrow,
						enterHint:
							selected || filtered.length > 0 ? '⏎ Enter' : undefined
					}}
				/>
				<ProjectTree
					{...{
						ref: treeRef,
						projects: filtered,
						selected,
						onSelect: handleSelect,
						onDoubleClick: handleLaunch,
						onLaunch: handleLaunch,
						loading
					}}
				/>
				<ActionButtons
					{...{
						hasSelection: selected !== null,
						onAddWorkspace: () => setShowWorkspaces(true),
						onRemoveWorkspace: () => setShowWorkspaces(true),
						onVSCode: handleOpenVSCode,
						onTerminal: handleOpenTerminal,
						onBoth: handleOpenBoth
					}}
				/>
			</div>
		</div>
	);
};

const App = () => (
	<ToastProvider>
		<AppInner />
	</ToastProvider>
);

export default App;
```

### How the pieces connect

- `useProjects` owns the list/query/selection; `useLaunchActions(selected, refresh)` gets the current selection and the rescan function. `addWorkspace` and `removeWorkspace` now come from the second hook — the two names chapter 02 chose — and `useWorkspaces` is only asked for its list.
- `handleLaunch` selects a project *and* opens both (used by double-click, Enter in the tree, and Enter in the search box). `openBoth(p)` takes an explicit project so you don't have to select-then-launch in two steps. Double-click *is* launch, so the same function is passed for both props.
- Every launch is wrapped so a rejected `invoke` becomes a toast instead of a silent failure. `ActionButtons` gets the `handleOpen*` wrappers, not the raw hook actions. Now "Could not determine which WSL distro…" (§5.3) and a failed temp-script write actually reach the user. (Note what does *not*: `cmd /c code` succeeds as a spawn even when `code` is missing — a "VS Code not found" error would need a check nothing makes yet. Chapter 24 is where DevGo learns which editors are actually installed, and the error variant for it arrives there.)
- The workspace modal is an overlay toggled by `showWorkspaces`; clicking the backdrop closes it, clicking the panel (`stopPropagation`) doesn't. Chapter 02's panel is the same component, in a different place; its **Close** is a `secondary` `Button` stretched to the panel width.
- `enterHint` shows the `⏎ Enter` chip only when Enter would do something.

> **Commit checkpoint** — a fully working launcher: add a workspace, see projects grouped, arrow/click to select, launch VS Code + terminal. §5.8 to §5.12 are one commit.
>
> ```powershell
> git add -A
> git commit -m "✅REACT: useLaunchActions, ActionButtons (Button pill), Enter/double-click launch, App composed"
> git push
> ```

---

## 5.13 — Verify

```powershell
bun tauri dev
```

You should see the DevGo window: title bar with the runtime badge, search box, the project tree, and the action row. Click **Add**, pick a folder that contains project subfolders, and they appear grouped under the workspace — no restart needed this time. Arrow keys and clicks select; double-click or Enter launches VS Code + terminal, and no console window flashes while they open. Select a WSL project and **Terminal** drops you into a tmux session with three windows; launch it again and you are back in the same session.

`cargo check` from `src-tauri/` is clean — nothing in this chapter is early.

> **Commit checkpoint** — the first build is complete. Stage commit, then merge the chapter into `main`:
>
> ```powershell
> git add -A
> git commit -m "✅STAGE: 05 launcher"
> git push
> git checkout main
> git merge 05.launcher
> git push
> ```

---

## 5.14 — What you built

```
src-tauri/src/
├── error.rs                  ← + NoWslDistro, LaunchFailed
├── commands.rs               ← + open_vscode / open_terminal / open_both
└── services/
    ├── launcher.rs           ← is_wsl, distro_from_project, spawn_cmd, launch_*, tmux script
    └── platform/paths.rs     ← windows_to_wsl_path
src/
├── App.tsx                   ← the whole launcher, composed
├── types.d.ts                ← + ActionButtonsProps, pill variant, tree callbacks
├── hooks/useLaunchActions.ts
└── components/
    ├── Button.tsx            ← + pill
    ├── ActionButtons.tsx     ← five buttons, data-driven
    └── ProjectTree.tsx       ← + Enter and double-click launch
```

What's still rough, and fixed over the next three chapters: an unplugged drive still blanks the list and a stopped WSL distro gets booted just to draw it (chapter 06); there's a white flash on startup, closing the window quits, and a second launch opens a second window (chapter 07); nothing is remembered between launches (chapter 08).

→ Next: [06 — The Cache, and the Rule the App Is Built Around](./06-cache.md)

→ Appendix: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)
