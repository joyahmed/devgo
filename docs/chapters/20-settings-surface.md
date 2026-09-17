# 20 — The Settings That Were Already There (post-plan)

**Branch:** `20.settings-surface` — `git checkout 20.settings-surface` gives you this chapter's finished app; `git diff 19.themes-portability 20.settings-surface` is exactly what this chapter adds.

**Starting from:** Slice 10 — DevGo is a complete launcher, and the plan that scheduled it is finished. It has six Settings panels you can reach only if you know `Ctrl+,`; a Shortcuts panel that still apologises for not rebinding the hotkey; and a stack detector that knows a project's package manager but never reads its scripts.

**Goal:** a gear in the title bar, a Rebind button that does what chapter 11's panel promised, and a *Run dev script…* entry on the context menu. Three doors — and the room behind the third one, because chapter 14 deferred the scripts half until something could call it.

> **Hold on to:**
> 1. **A backend with no door was never built, from the chair.** Chapter 19 wrote `rebind` beside chapter 09's `register`, chapter 11 shipped a panel that apologised, chapter 14 refused a script picker. Each was right on its day; together they were three halves. This chapter is the other halves — and every one is a call into code that needed no second draft.
> 2. **A template that does not exist is a refusal, not a guess.** `run_args_template` is `Option`; a target without one returns `None` from `resolve_run` and the launcher reports `TargetCannotRun`. Inventing flags for an unknown terminal would open the wrong thing.
> 3. **Capture the physical key, refuse the bare one — and stop the event.** `e.code` is what the OS registration wants; a global hotkey without a modifier steals a letter from every app; and a capture-phase listener that only calls `preventDefault` still lets `Escape` reach the panel that owns it.
> 4. **On demand is a signature, not a comment.** `get_project_scripts` takes one project, so nothing can read them all; the picker inherits the limit by construction.
>
> Rust: a private `resolve_inner` behind two public entry points; a `match` on a tuple of booleans `(wsl.is_some(), command)`; `let … else` twice. TypeScript: a nested ternary as a lookup, `[...].filter(Boolean)` to build a modifier list.

> Three times in this book a chapter ended with a working backend and the honest sentence "no UI for this yet." Chapter 11 built the panel and said rebinding "is not built yet — it lives in prefs.json for now"; chapter 19 wrote `rebind` beside chapter 09's `register` for import's sake and gave the panel no button; chapter 14 detected the stack and refused a script picker until "the chapter that gives it a menu". **A feature with a backend and no door is, to the person using the app, a feature that was never built.** Chapter 14's scripts half lands here too — it waited because nothing used it, so it lands now, in the order its callers appear: template → launcher → reader → commands → doors.

---

## 20.1 — Run templates on the target

A terminal that *opens* a directory and a terminal that *runs a command* in one are different command lines, and the difference is per terminal — `wt` wants `cmd /k` after the directory, another terminal wants something else. So the template is a field on the target, like the two chapter 13 gave it, and the absence of one means "cannot", not "guess". In `src-tauri/src/models/target.rs`, after `wsl_args_template`:

```rust
    /// Arguments for running a command in a Windows project. `{command}` is
    /// substituted alongside `{path}`. `None` means this target cannot run
    /// commands: the flags differ per terminal and guessing opens the wrong
    /// thing.
    #[serde(default)]
    pub run_args_template: Option<String>,
    /// The same for a WSL project.
    #[serde(default)]
    pub wsl_run_args_template: Option<String>,
```

`#[serde(default)]` is what lets an existing `targets.json` — written by chapter 13 with neither field — still load: a missing key reads as `None` rather than a parse error that would wipe the registry.

`resolve` becomes a wrapper over one private function with a `command` argument:

```rust
    pub fn resolve(
        &self,
        windows_path: &str,
        wsl: Option<(&str, &str)>,
    ) -> Option<(String, String)> {
        self.resolve_inner(windows_path, wsl, None)
    }

    pub fn resolve_run(
        &self,
        windows_path: &str,
        wsl: Option<(&str, &str)>,
        command: &str,
    ) -> Option<(String, String)> {
        self.resolve_inner(windows_path, wsl, Some(command))
    }

    fn resolve_inner(
        &self,
        windows_path: &str,
        wsl: Option<(&str, &str)>,
        command: Option<&str>,
    ) -> Option<(String, String)> {
        let template = match (wsl.is_some(), command) {
            (true, None) => self.wsl_args_template.as_ref()?,
            (true, Some(_)) => self.wsl_run_args_template.as_ref()?,
            (false, None) => &self.args_template,
            (false, Some(_)) => self.run_args_template.as_ref()?,
        };

        let exe = match wsl {
            Some(_) => self
                .wsl_executable
                .clone()
                .unwrap_or_else(|| self.executable.clone()),
            None => self.executable.clone(),
        };

        let mut args = template.replace("{path}", windows_path);
        if let Some((distro, linux_path)) = wsl {
            args = args
                .replace("{distro}", distro)
                .replace("{linux_path}", linux_path);
        }
        if let Some(cmd) = command {
            args = args.replace("{command}", cmd);
        }
        Some((exe, args))
    }
```

The four-arm `match` on `(wsl.is_some(), command)` is the whole decision table: which of the four templates applies, and three of the four are `Option`s whose `?` is the refusal. Chapter 13's two tests still pass unchanged, because `resolve` is the `None` column of that table.

The seeded Windows Terminal gets both run forms; VS Code gets none, with the reason in one line:

```rust
            // an editor is not a place to run a dev command
            run_args_template: None,
            wsl_run_args_template: None,
```

```rust
            // cmd /k keeps the window open, so a failing script leaves its
            // error on screen
            run_args_template: Some("-d \"{path}\" cmd /k {command}".into()),
            wsl_run_args_template: Some(
                "wsl -d {distro} --cd \"{linux_path}\" -e bash -lc \"{command}; exec bash\"".into(),
            ),
```

`cmd /k` and `; exec bash` are the same decision on two platforms: the terminal outlives the command. A `bun run dev` that dies on a missing dependency should leave its stack trace in a window, not vanish with it. The four struct literals in tests (`target.rs`, `launcher.rs`, `target_store.rs`) each gain the two `None`s, and `error.rs` gains the refusal's message:

```rust
    #[error("{0} has no run template, so it cannot run a command")]
    TargetCannotRun(String),
```

The message does not end "— add a run template in Settings", because the Editors & Terminals panel has no such field — a custom terminal you registered in chapter 13 cannot run scripts until it does. That is honest, and the field is a later chapter's if anyone wants it.

> `✅TARGET: run templates`

Two tests, beside chapter 13's:

```rust
    #[test]
    fn run_templates_substitute_the_command() {
        let wt = defaults().into_iter().nth(1).unwrap();
        let (exe, args) =
            wt.resolve_run(r"G:\dev\app", None, "bun run dev").unwrap();
        assert_eq!(exe, "wt");
        assert_eq!(args, r#"-d "G:\dev\app" cmd /k bun run dev"#);

        let (_, args) = wt
            .resolve_run("x", Some(("Ubuntu", "/home/joy/app")), "bun run dev")
            .unwrap();
        assert!(args.contains(r#"--cd "/home/joy/app""#));
        assert!(args.ends_with(r#""bun run dev; exec bash""#));
    }

    /// An editor has no run form; asking is a refusal, not a plain open.
    #[test]
    fn a_target_without_a_run_template_refuses_commands() {
        assert!(vscode().resolve_run("x", None, "bun run dev").is_none());
        assert!(vscode().resolve("x", None).is_some());
    }
```

> `✅TEST: run templates`

---

## 20.2 — The launcher runs a command

In `src-tauri/src/services/launcher.rs`, above `launch_both`:

```rust
/// Open a terminal that runs a command in the project directory.
pub fn launch_with_command(
    target: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    command: &str,
) -> Result<(), AppError> {
    let resolved = if is_wsl(project) {
        let distro = distro_from_project(project, info)?;
        let linux_path = super::platform::paths::windows_to_wsl_path(
            &project.full_path,
            &distro,
        );
        target.resolve_run(
            &project.full_path,
            Some((&distro, &linux_path)),
            &escape(command),
        )
    } else {
        target.resolve_run(&project.full_path, None, command)
    };

    let (exe, args) = resolved
        .ok_or_else(|| AppError::TargetCannotRun(target.name.clone()))?;

    spawn_raw(&exe, &args)
}

// the command sits inside a double-quoted bash -lc argument
fn escape(command: &str) -> String {
    command.replace('\\', "\\\\").replace('"', "\\\"")
}
```

The shape is `launch_target` with `resolve_run` in place of `resolve`, and without the tmux script — a script run is a one-shot command, not the three-window session chapter 05 built for opening. `escape` exists for the WSL form only: the command is spliced into `bash -lc "…"`, so a quote inside it would end the string early. The Windows form hands the command to `cmd /k` unquoted, which is what `cmd` expects. `spawn_raw` is chapter 13's, unchanged — the template already carries its own quoting, and `raw_arg` passes it through verbatim.

> `✅LAUNCHER: launch_with_command`

---

## 20.3 — Scripts, read when asked

Chapter 14 named the constraint that shaped this file: a `package.json` read per Node project, over 9p, is the cost the badge design exists to avoid. So the reader takes one project, and nothing in DevGo calls it in a loop. Create `src-tauri/src/services/scripts.rs`:

```rust
use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

use super::platform::{paths, wsl};
use super::scanner::distro_of;
use crate::error::AppError;
use crate::models::Project;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize)]
pub struct DevScript {
    pub name: String,
    pub command: String,
}

// tolerant on purpose: a package.json we half understand still yields its
// scripts
fn parse_scripts(json: &str, runner: &str) -> Vec<DevScript> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let Some(scripts) = value.get("scripts").and_then(|s| s.as_object()) else {
        return Vec::new();
    };
    scripts
        .keys()
        .map(|name| DevScript {
            command: format!("{runner} run {name}"),
            name: name.clone(),
        })
        .collect()
}

// conventions, not declarations: offered, not asserted
fn conventional(tags: &[String]) -> Vec<DevScript> {
    let mut out = Vec::new();
    if tags.iter().any(|t| t == "rust") {
        out.push(DevScript {
            name: "cargo run".into(),
            command: "cargo run".into(),
        });
        out.push(DevScript {
            name: "cargo test".into(),
            command: "cargo test".into(),
        });
    }
    if tags.iter().any(|t| t == "go") {
        out.push(DevScript {
            name: "go run".into(),
            command: "go run .".into(),
        });
    }
    if tags.iter().any(|t| t == "docker") {
        out.push(DevScript {
            name: "compose up".into(),
            command: "docker compose up".into(),
        });
    }
    out
}
```

`parse_scripts` reads the file as a `serde_json::Value` rather than a struct, because a `package.json` has a hundred fields and DevGo wants one. Two `let … else`s are the two ways it can be missing — not JSON at all, or JSON without a `scripts` object — and both yield an empty list rather than an error: a malformed manifest must not take the feature down with it. The runner is the package manager chapter 14 detected, so a `bun.lock` project gets `bun run dev`, not `npm run dev`. `conventional` is the non-Node half: nothing in a `Cargo.toml` says "run me with `cargo run`", so those entries are offered as conventions, keyed off the tags the badge pass already found.

```rust
fn read_windows(path: &str) -> Option<String> {
    std::fs::read_to_string(std::path::Path::new(path).join("package.json"))
        .ok()
}

fn read_wsl(distro: &str, linux_path: &str) -> Option<String> {
    let output = Command::new("wsl")
        .creation_flags(CREATE_NO_WINDOW)
        .env("WSL_UTF8", "1")
        .args([
            "-d",
            distro,
            "-e",
            "cat",
            &format!("{linux_path}/package.json"),
        ])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

// on demand only, never in the scan or the badge pass: one package.json per
// node project over 9p is the cost the badges were designed to avoid
pub fn for_project(
    project: &Project,
    tags: &[String],
    package_manager: Option<&str>,
    running: &[String],
) -> Vec<DevScript> {
    let runner = package_manager.unwrap_or("npm");

    let json = match distro_of(&project.full_path) {
        Some(distro) if wsl::is_running(&distro, running) => {
            let linux = paths::windows_to_wsl_path(&project.full_path, &distro);
            read_wsl(&distro, &linux)
        }
        // stopped distro: no scripts, same rule as everywhere else
        Some(_) => None,
        None => read_windows(&project.full_path),
    };

    let mut scripts =
        json.map(|j| parse_scripts(&j, runner)).unwrap_or_default();
    scripts.extend(conventional(tags));
    scripts
}

pub fn run(
    project: &Project,
    command: &str,
    terminal: &crate::models::target::LaunchTarget,
    info: &super::platform::RuntimeInfo,
) -> Result<(), AppError> {
    super::launcher::launch_with_command(terminal, project, info, command)
}
```

The three-arm `match` in `for_project` is chapter 06's liveness gate one more time. A WSL project on a *running* distro is read from the inside with `cat` — chapter 17's discovery trick, one `wsl -e` for one file rather than a `\\wsl.localhost\` read that goes through 9p. A WSL project on a *stopped* distro gets no scripts, and no boot. The UI inherits the law by calling the function that obeys it. Add `pub mod scripts;` to `services/mod.rs`.

> `✅SCRIPTS: read scripts on demand`

Four tests on the two pure functions:

```rust
    #[test]
    fn extracts_scripts_with_the_right_runner() {
        let json =
            r#"{"name":"x","scripts":{"dev":"next dev","build":"next build"}}"#;
        let mut got = parse_scripts(json, "pnpm");
        got.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "build");
        assert_eq!(got[0].command, "pnpm run build");
    }

    #[test]
    fn a_package_json_without_scripts_yields_nothing() {
        assert!(parse_scripts(r#"{"name":"x"}"#, "npm").is_empty());
    }

    /// A malformed package.json must not take the feature down with it.
    #[test]
    fn malformed_json_degrades_quietly() {
        assert!(parse_scripts("{ not json", "npm").is_empty());
        assert!(parse_scripts("", "npm").is_empty());
    }

    #[test]
    fn non_node_stacks_get_conventional_commands() {
        let rust = conventional(&["rust".to_string()]);
        assert!(rust.iter().any(|s| s.command == "cargo run"));
        assert!(conventional(&["node".to_string()]).is_empty());
    }
```

> `✅TEST: scripts`

---

## 20.4 — Two commands for the picker, one for the panel

In `commands.rs`, above `running_for`:

```rust
// one project, one read, at the moment of the click
#[tauri::command]
pub fn get_project_scripts(
    project: Project,
    state: State<AppState>,
) -> Result<Vec<crate::services::scripts::DevScript>, AppError> {
    let (tags, pm) = {
        let cache = state.tech_cache.lock().map_err(lock_err)?;
        match cache.get(&project.full_path) {
            Some(t) => (
                t.tags.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                t.package_manager.map(|s| s.to_string()),
            ),
            None => (Vec::new(), None),
        }
    };
    let running = running_for(std::slice::from_ref(&project));
    Ok(crate::services::scripts::for_project(
        &project,
        &tags,
        pm.as_deref(),
        &running,
    ))
}

#[tauri::command]
pub fn run_script(
    project: Project,
    command: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let terminal = resolve_target(&state, TargetKind::Terminal, None)?;
    crate::services::scripts::run(&project, &command, &terminal, &info)?;
    record_launch(&state, &project)
}
```

The `tech_cache` chapter 14 filled has its reader at last: the tags and package manager come out of it as owned `String`s inside a braced block, so the lock is released before any `wsl.exe` call. `running_for` is chapter 14's gate with a one-element slice — `std::slice::from_ref` — so a Windows project never shells out to `wsl -l --running` at all. `run_script` resolves the *default terminal* through chapter 13's fallback and counts as a launch: running a project's dev server is opening it, for frecency's purposes.

Then the command chapter 11's panel was waiting for, above `get_summon_hotkey`:

```rust
// the new chord is registered before the old one is dropped, so a taken
// key leaves the working binding in place
#[tauri::command]
pub fn set_summon_hotkey(
    accelerator: Option<String>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<String, AppError> {
    let previous = state.pref_store.lock().map_err(lock_err)?.summon_hotkey();
    let next = accelerator.clone().unwrap_or_else(|| {
        crate::services::preferences::DEFAULT_SUMMON_HOTKEY.to_string()
    });

    crate::summon::rebind(&app, &previous, &next)
        .map_err(|e| AppError::HotkeyFailed(next.clone(), e))?;

    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .set_summon_hotkey(accelerator)
        .map_err(AppError::Lock)?;
    Ok(next)
}
```

with `HotkeyFailed(String, String)` — `"Could not bind {0}: {1}"` — in `error.rs`. It **returns** the accelerator it bound. That is the contract the panel will lean on: the frontend shows a new chord only when the backend hands one back, and the backend hands one back only after `rebind` succeeded. Chapter 19's import called `rebind` the same way and swallowed the failure; here the failure is the answer, because the user is watching. `None` means "back to the default", which is how `Option` reads in the store.

Register `get_project_scripts` and `run_script` after `get_project_tech`, and `set_summon_hotkey` after `get_summon_hotkey`.

> `✅SCRIPTS: commands` → `✅SUMMON: set_summon_hotkey command`. `cargo check` is clean; `cargo test` reports **54**.

---

## 20.5 — A gear, because `Ctrl+,` is not a door

Every path into Settings already goes through one function — chapter 16's `openSettings(panel)`, so a deep-link and a plain open share a door. What was missing was anything on screen that called it. The footer reaches one panel; `Ctrl+,` reaches the rest, if you know it. First the wire type, in `types.d.ts` above `ScanConfig`:

```typescript
/// a runnable script: what to show, and the command line behind it
interface DevScript {
	name: string;
	command: string;
}
```

> `✅UI: dev script type`

Then the gear, in `App.tsx`'s title bar after `RuntimeIndicator` — `Button` imported, `ghost` variant, the icon as its child:

```tsx
					<Button
						variant='ghost'
						onClick={() => openSettings()}
						title='Settings (Ctrl+,)'
					>
						<svg
							width='16'
							height='16'
							viewBox='0 0 24 24'
							fill='none'
							stroke='currentColor'
							strokeWidth='2'
							strokeLinecap='round'
							strokeLinejoin='round'
						>
							<circle cx='12' cy='12' r='3' />
							<path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' />
						</svg>
					</Button>
```

The gear is a `ghost` `Button`. `openSettings()` with no panel restores whichever section you used last — chapter 11's `localStorage` behaviour. The `title` says `Ctrl+,`, the one place the mouse user is told what the keyboard user knows. `stroke='currentColor'` means the gear takes its colour from the text tokens and therefore from whichever of chapter 19's themes is active.

> `✅UI: gear in the title bar`

---

## 20.6 — Rebind: the panel stops apologising

Capturing is the part with a decision in it. A `KeyboardEvent` is not an accelerator string; something has to translate, and the translation has a rule. In `Settings.tsx`, above `ShortcutTable`:

```tsx
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);
const NAV_KEYS: Record<string, string> = {
	Space: 'Space',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right'
};

// a key event as a tauri accelerator, or null while only modifiers are down
// or the key is one we cannot bind. a global hotkey must carry a modifier
const toAccelerator = (e: KeyboardEvent): string | null => {
	if (MODIFIER_KEYS.has(e.key)) return null;
	const mods = [
		e.ctrlKey && 'Ctrl',
		e.altKey && 'Alt',
		e.shiftKey && 'Shift',
		e.metaKey && 'Super'
	].filter(Boolean);
	if (mods.length === 0) return null;

	const c = e.code;
	const key = c.startsWith('Key')
		? c.slice(3)
		: c.startsWith('Digit')
			? c.slice(5)
			: /^F\d{1,2}$/.test(c)
				? c
				: (NAV_KEYS[c] ?? null);
	if (!key) return null;

	return [...mods, key].join('+');
};
```

Three `null`s, and they mean different things. The first — a modifier on its own — is *keep waiting*: pressing `Ctrl` on the way to `Ctrl+Alt+D` fires a keydown for `Control` alone, and binding that would fire the hotkey every time you copy something. The second — no modifier at all — is *refuse*: a global hotkey without one steals `D` from every application on the machine. Chapter 11 drew the same line for the in-app shortcuts from the other side: bare keys belong to whatever input has focus. For a hotkey the whole OS sees, the modifier is not a preference; it is the condition for binding at all. The third — a key the accelerator parser has no name for — is *keep waiting* again.

It reads `e.code`, not `e.key`: chapter 11's lesson. `key` is the character produced — `Shift+3` is `#` — while `code` is the physical key, `Digit3`, which is what the OS registration wants.

`ShortcutTable` takes two more props — `onSummonChanged: (hotkey: string) => void` and `onError`, declared on `ShortcutTableProps` — and the Summon row grows a button:

```tsx
const ShortcutTable = ({
	summonHotkey,
	onSummonChanged,
	onError
}: ShortcutTableProps) => {
	const groups = [...new Set(SHORTCUTS.map(s => s.group))];
	const [capturing, setCapturing] = useState(false);

	// capture phase, so the keys pressed to choose a chord never reach the
	// app's own bindings
	useEffect(() => {
		if (!capturing) return;
		const onKey = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const accel = toAccelerator(e);
			if (!accel) return;
			setCapturing(false);
			// shown only once the backend has bound it
			invoke<string>('set_summon_hotkey', { accelerator: accel })
				.then(onSummonChanged)
				.catch(err => onError(String(err)));
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	}, [capturing, onSummonChanged, onError]);

	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h4 className={heading}>Summon</h4>
				<div className='flex items-center justify-between gap-3 py-1 text-sm'>
					<span className='text-text-secondary'>
						Show / hide DevGo from anywhere
					</span>
					<span className='flex items-center gap-2 shrink-0'>
						<kbd className={kbd}>
							{capturing ? 'Press keys…' : prettyKeys(summonHotkey)}
						</kbd>
						<Button variant='ghost' onClick={() => setCapturing(c => !c)}>
							<span className={`text-xs ${capturing ? 'text-accent' : ''}`}>
								{capturing ? 'Cancel' : 'Rebind'}
							</span>
						</Button>
					</span>
				</div>
				<p className='text-xs text-text-muted mt-1'>
					Click Rebind, then press the combination — it needs a modifier
					(Ctrl / Alt / Shift / Super). If another app owns the keys, the old
					binding stays.
				</p>
			</div>
```

The third argument to `addEventListener` is `true` — capture phase — and it is not optional. While you are choosing a hotkey you will press things chapter 11 bound: `Escape` closes Settings, `Ctrl+,` closes it, `F5` refreshes. Capture runs before any of them.

**And `preventDefault` alone is not enough.** The first cut of this listener called `preventDefault` and assumed that "stops the event". It stops the *default action*; it does not stop propagation. Settings' own `Escape` listener is on `window` in the bubble phase, and it still ran: press `Escape` while capturing and the panel closed under you, mid-capture. `e.stopPropagation()` in a capture-phase listener on `window` is what keeps the bubble-phase listeners on `window` from seeing the event. It was found by pressing `Escape` in the running app, and it is its own commit — `✅FIX: rebind keeps its keys`, the last fix of the chapter: in git it landed after the script menu of 20.7.

Then the line that matters: `.then(onSummonChanged)`. The `<kbd>` shows the new combination only after the command returns it — which it does only after `rebind` succeeded. If another application owns the keys, the command fails, `onError` toasts it, and the display still shows the binding that works, because nothing ever told it otherwise. `Settings` passes the two props through (`SettingsProps` gains `onSummonChanged`), and `App` supplies `onSummonChanged: setSummonHotkey` — the same state the footer and the Shortcuts panel both read, so a rebind moves the hint everywhere at once.

> `✅UI: rebind the summon hotkey`

---

## 20.7 — Run dev script…: on demand, and only then

The picker honours chapter 14's refusal by not existing until you ask for it. In `App.tsx`, above `buildMenu`:

```tsx
	// one package.json, read when you ask: never per row, never in the scan
	const [scriptMenu, setScriptMenu] = useState<{
		x: number;
		y: number;
		items: MenuEntry[];
	} | null>(null);
	const openScripts = async (p: Project, x: number, y: number) => {
		try {
			const scripts = await invoke<DevScript[]>('get_project_scripts', {
				project: p
			});
			if (scripts.length === 0) {
				toast('No dev scripts found for this project', 'info');
				return;
			}
			setScriptMenu({
				x,
				y,
				items: scripts.map(s => ({
					label: s.name,
					hint: s.command,
					onClick: () =>
						invoke('run_script', { project: p, command: s.command }).catch(
							e => toast(showError(e), 'error')
						)
				}))
			});
		} catch (e) {
			toast(showError(e), 'error');
		}
	};
```

One project, one read, at the moment of the click. A project with nothing to run gets an `info` toast rather than an empty menu, because an empty menu is a question ("did that work?") and a toast is an answer. The entry lives in chapter 15's context menu, between the path actions and the pin, with a separator on each side:

```tsx
			'separator',
			{
				label: 'Run dev script…',
				onClick: () => openScripts(p, menu?.x ?? 240, menu?.y ?? 200)
			},
			'separator',
```

The ellipsis is the convention for "this opens something else", and what it opens is a *second* `ContextMenu` after the first, in the same JSX:

```tsx
			{scriptMenu && (
				<ContextMenu
					{...{
						x: scriptMenu.x,
						y: scriptMenu.y,
						items: scriptMenu.items,
						onClose: () => setScriptMenu(null)
					}}
				/>
			)}
```

It has to be separate state. `ContextMenu` calls `onClose()` right after an item's `onClick`, so the first menu is gone by the time the scripts arrive; a picker that reused `menu` would be closed by the click that opened it. It opens at the first menu's coordinates — where your cursor already is — and each row reuses the `hint` slot, which chapter 15 built for keyboard hints, to show the command line: `dev` on the left, `bun run dev` on the right. Picking one calls `run_script`, which resolves your default terminal and hands the command to `launch_with_command` — a terminal that stays open on failure, because 20.1 made sure of it.

> `✅UI: run dev script` → `✅FIX: rebind keeps its keys`

---

## 20.8 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun tauri dev
```

`cargo test` reports **54** — chapter 19's 48 plus two for run templates and four for scripts. Move `targets.json` aside before launching so the seeded Windows Terminal, with its run template, is the default terminal; a terminal you registered yourself has none yet. WSL stopped throughout.

**The gear.** Next to the runtime badge. Hover: *Settings (Ctrl+,)*. Click: Settings opens on whichever panel you used last.

**Rebind.** Shortcuts → *Rebind*: the `<kbd>` reads *Press keys…* and the button reads *Cancel*. Press `Ctrl` alone: still waiting. Press `d` alone: still waiting. Press `Escape`: still waiting — and Settings is still open (before the fix it closed). Press `Ctrl+Alt+D`: the `<kbd>` reads `Ctrl+Alt+D`, `prefs.json` holds it. Close Settings and press the chord for real: the window focuses, then hides on a second press. Press the old `Ctrl+Alt+Space`: nothing — `rebind` unregistered it.

**Scripts.** Right-click `devgo` → *Run dev script…*: a second menu at the same spot — `build`, `dev`, `preview`, `tauri`, each with `bun run …` on the right, because chapter 14 saw the `bun.lock`. Pick `build`: a new terminal tab whose command line is `cmd /k bun run build`; it finishes and the tab stays open; `launch_count` for `devgo` went up by one. Close the tab. Right-click a project with no `package.json` and no badges → *Run dev script…*: no menu, one toast — *No dev scripts found for this project*.

Restore `targets.json` and `prefs.json` when done.

> `✅STAGE: 20 settings-surface`; ff-merge; push.

---

## What you built

```
src-tauri/src/
├── models/target.rs           ← run_args_template, wsl_run_args_template; resolve_run / resolve_inner;
│                                 wt seeded with cmd /k and bash -lc forms; 2 tests
├── services/
│   ├── launcher.rs            ← launch_with_command, escape
│   ├── scripts.rs             ← NEW: DevScript, parse_scripts, conventional, read_windows/read_wsl,
│   │                             for_project (liveness gate), run; 4 tests
│   └── mod.rs                 ← scripts
├── commands.rs                ← get_project_scripts (first reader of tech_cache), run_script,
│                                 set_summon_hotkey (returns what it bound)
├── error.rs                   ← TargetCannotRun, HotkeyFailed
└── lib.rs                     ← three commands
src/
├── types.d.ts                 ← DevScript; ShortcutTableProps + SettingsProps.onSummonChanged
├── components/Settings.tsx    ← toAccelerator, capture effect (stopPropagation), Rebind button
└── App.tsx                    ← gear (ghost Button), scriptMenu + openScripts, menu entry, second ContextMenu
```

> **The thread running through this chapter.** No new rooms — a gear onto `openSettings`, a button onto `rebind`, a menu onto a reader that reads one file. Three chapters each shipped half a feature for a good reason; the halves only became features when something on screen called them, and none of the backends needed a second draft when it did. One thing *did* need a second draft, and it was the first cut of the capture listener, which forgot `stopPropagation` and let `Escape` close the panel it was capturing for. **The measure of this chapter is how little each door had to know.**

---

→ Next: [21 — Nested Projects, Any Layout](./21-nested-discovery.md) (post-plan), the scan knob chapter 17 refused, built the way that refusal said it would have to be.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [19 — Polish, Themes & Portability](./19-themes-portability.md)
