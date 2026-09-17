# 04 — WSL Detection (Phase 3)

**Branch:** `04.wsl` — `git checkout 04.wsl` gives you this chapter's finished app; `git diff 03.scanner 04.wsl` is exactly what this chapter adds.

**Starting from:** chapter 03 — the scanner tags a workspace `WSL` by the shape of its path, and the app knows nothing else about WSL.

**Goal:** detect whether WSL is available, list distros, expose a `RuntimeInfo` the frontend can read — and show it, as a badge in the title bar.

> **Hold on to (the rest is `wsl.exe` trivia):**
> 1. **A function that shells out returns a plain value, not a `Result`** — `list_distros() -> Vec<String>`, empty if anything went wrong. Absence of WSL is a state, not an error.
> 2. **`#[serde(rename_all = "lowercase")]`** — the Rust enum and the TS union must agree on the wire, and lowercase is the convention.
> 3. **Compute once at startup, keep it in `AppState`, clone it out** — the pattern for anything expensive that doesn't change.
>
> **Why DevGo cares about WSL.** On Windows, a project can live on the Windows filesystem (`C:\dev\app`) *or* inside a WSL distro (`\\wsl.localhost\Ubuntu\home\user\app`). The two need different launch commands — native `code` vs `code --folder-uri vscode-remote://…`. Everything in this chapter exists so the launcher (chapter 05) can tell them apart; chapter 05 also brings the path translation that addresses each one correctly.

---

## 4.1 — Runtime enum

A project's world is one of two things. Create `src-tauri/src/services/platform/runtime.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]

pub enum Runtime {
    Windows,
    Wsl,
}
```

### `#[serde(rename_all = "lowercase")]`

By default serde serializes `Runtime::Windows` as `"Windows"`. Our TypeScript type will be `runtime: 'windows' | 'wsl'` (lowercase — the JS convention), so we tell serde to lowercase variant names on the wire. **Get this wrong and the frontend's `runtime === 'wsl'` check silently never matches** — a nasty, invisible bug. Lowercase on both sides, always.

Create `src-tauri/src/services/platform/mod.rs` (we'll add the other modules as we write them):

```rust
pub mod runtime;
```

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: Runtime enum"
> git push
> ```

---

## 4.2 — WSL distro detection

We shell out to `wsl.exe` to discover installed distros. The file is longer than the job sounds because `wsl.exe` has two traps — its output encoding and its localisation — and the code carries the fixes for both. **You do not need to understand the traps to type the file**; the comments on `decode` and `clean` say what they are for. The two paragraphs below and the "deep dive" sections after the code are there for the day something prints a phantom distro — skip them on a first pass.

*(skip on first pass)*

**Trap 1: `wsl.exe` does not speak UTF-8.** It emits UTF-16LE. Decode its output with `String::from_utf8_lossy` and a distro name — `Ubuntu-26.04` on the machine this was written on; yours may be `Debian`, `Ubuntu-24.04`, anything `wsl -l -q` prints — comes out as:

```
U\0b\0u\0n\0t\0u\0-\02\06\0.\00\04\0
```

Every second byte is a NUL. Worse, `str::trim` will not save you — NUL is not whitespace, so a trailing `"\0"` line survives an `is_empty()` filter and registers as a **second, phantom distro**. Setting `WSL_UTF8=1` fixes it at the source, but that env var only landed in WSL 0.64, so we also sniff the bytes.

**Trap 2: `wsl --status` is localized.** It prints `Default Distribution: Ubuntu` on an English install and something else entirely elsewhere. Matching that literal string means your default-distro detection silently fails for a large chunk of users. `wsl -l -v` marks the default with a `*` instead — a structural marker, identical in every language.

Create `src-tauri/src/services/platform/wsl.rs`:

```rust
use std::os::windows::process::CommandExt;
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Every `wsl.exe` invocation goes through here.
///
/// `WSL_UTF8=1` makes wsl.exe emit UTF-8. Without it the default is UTF-16LE,
/// and decoding that as UTF-8 turns "Ubuntu-26.04" into
/// "U\0b\0u\0n\0t\0u\0-\02\06\0.\00\04\0" — see `decode`.

fn wsl_command() -> Command {
    let mut cmd = Command::new("wsl");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.env("WSL_UTF8", "1");
    cmd
}

/// `WSL_UTF8` only landed in WSL 0.64; older builds ignore it and still emit
/// UTF-16LE. Sniff the buffer instead of trusting the env var: interior NUL
/// bytes never occur in this command's UTF-8 output, but appear in every other
/// byte of ASCII-range UTF-16LE.

fn decode(bytes: &[u8]) -> String {
    if bytes.contains(&0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

/// Trim whitespace *and* stray NULs. `str::trim` leaves NUL in place — NUL is
/// not whitespace — which is how a bogus "\0" entry used to survive the
/// is-empty filter and register as a second, phantom distro.
fn clean(line: &str) -> &str {
    line.trim_matches(|c: char| c.is_whitespace() || c == '\0')
}

fn run(args: &[&str]) -> Option<String> {
    let output = wsl_command().args(args).output().ok()?;
    if output.status.success() {
        Some(decode(&output.stdout))
    } else {
        None
    }
}

fn parse_list(text: &str) -> Vec<String> {
    text.lines()
        .map(clean)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

pub fn list_distros() -> Vec<String> {
    run(&["-l", "-q"])
        .as_deref()
        .map(parse_list)
        .unwrap_or_default()
}

/// The `*` marker in `wsl -l -v` is structural, so this works on any Windows
/// display language. Parsing `wsl --status` for the literal
/// "Default Distribution:" is localized and never matches on a non-English
/// install.

pub fn default_distro() -> Option<String> {
    if let Some(text) = run(&["-l", "-v"]) {
        for line in text.lines() {
            if let Some(rest) = clean(line).strip_prefix('*') {
                if let Some(name) = rest.split_whitespace().next() {
                    return Some(name.to_string());
                }
            }
        }
    }
    list_distros().into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact bytes `wsl -l -q` produced on a machine that ignored WSL_UTF8.
    #[test]
    fn decodes_utf16le_output() {
        let bytes: &[u8] = &[
            0x55, 0x00, 0x62, 0x00, 0x75, 0x00, 0x6E, 0x00, 0x74, 0x00, 0x75,
            0x00, 0x2D, 0x00, 0x32, 0x00, 0x36, 0x00, 0x2E, 0x00, 0x30, 0x00,
            0x34, 0x00, 0x0D, 0x00, 0x0A, 0x00,
        ];
        assert_eq!(decode(bytes), "Ubuntu-26.04\r\n");
        assert_eq!(parse_list(&decode(bytes)), vec!["Ubuntu-26.04"]);
    }

    #[test]
    fn decodes_utf8_output() {
        assert_eq!(
            parse_list(&decode(b"Ubuntu-26.04\r\n")),
            vec!["Ubuntu-26.04"]
        );
    }

    /// Regression: a trailing "\0" line used to survive `.trim()` + is-empty and
    /// register as a second distro.
    #[test]
    fn drops_nul_only_lines() {
        assert_eq!(parse_list("Ubuntu-26.04\r\n\0\n"), vec!["Ubuntu-26.04"]);
    }

    #[test]
    fn finds_default_marker_without_locale_text() {
        let listing = "  NAME            STATE           VERSION\n\
                       * Ubuntu-26.04    Stopped         2\n\
                         Debian          Stopped         2\n";
        let default = listing
            .lines()
            .filter_map(|l| clean(l).strip_prefix('*'))
            .filter_map(|rest| rest.split_whitespace().next())
            .next();
        assert_eq!(default, Some("Ubuntu-26.04"));
    }
}
```

### `CREATE_NO_WINDOW` — no console flashes *(hold on to this one)*

`std::process::Command` spawns a child that inherits console behavior. Even though our release binary hides its own console (`windows_subsystem = "windows"` in `main.rs`), child processes like `wsl.exe` get their *own* console — a black window flickers on screen. `creation_flags(0x08000000)` (`CREATE_NO_WINDOW`) tells Windows: no console for this child. `CommandExt` is the Windows-only trait that adds `.creation_flags()`; it's in the standard library (`std::os::windows::process`), no crate needed. **Every process we spawn in DevGo uses this flag** — remember it for the launcher.

### One builder, one decoder *(skip on first pass)*

`wsl_command()` exists so no call site can forget `WSL_UTF8`, and `decode` exists because we cannot assume the env var was honored. The check is deliberately crude — "does this buffer contain a zero byte" — but a NUL never appears in the UTF-8 output of these commands, so it is a reliable discriminator. `chunks_exact(2)` walks the buffer two bytes at a time; a trailing odd byte is dropped rather than panicking.

`clean` trims whitespace **and** NUL. This one line is the difference between one distro and two.

### These return plain values, not `Result`

`list_distros` returns `Vec<String>` — an empty vec if WSL isn't installed or the command fails. `default_distro` returns `Option<String>`. WSL being absent isn't an *error* for a Windows-only user; it's just "no distros". Detection should degrade quietly, so we bake the fallback into the return type instead of propagating errors upward.

### What this file does *not* do yet *(skip on first pass)*

It never asks which distros are *running*. That question matters enormously — reading a `\\wsl.localhost\…` path cold-boots the whole WSL virtual machine, so the app should ask before it reads — but nothing in this chapter reads such a path with that care yet. Chapter 06 is built around that rule, and the two functions that answer it (`running_distros`, `is_running`) arrive there, in this file.

### The tests are the bug reports *(skip on first pass)*

The four tests at the bottom are worth reading as history. `decodes_utf16le_output` holds the *exact bytes* `wsl -l -q` produced on one machine that ignored `WSL_UTF8` — which is why a specific distro name appears in a test that otherwise has nothing to do with Ubuntu: a decoding test needs real bytes, and these are the ones that were captured. Any distro name would exercise the same path; `drops_nul_only_lines` is the phantom-distro regression; `finds_default_marker_without_locale_text` is Trap 2 with a real listing. They run with `cargo test` and never touch `wsl.exe`. The `#[cfg(test)] mod tests { use super::*; … }` block and the `#[test] fn` shape are the same in every Rust file in the book; the assertions are the content.

### Prove it to yourself *(skip on first pass)*

Both traps are visible from PowerShell in about thirty seconds:

```powershell
# Trap 1 — the raw bytes
$p = [Diagnostics.Process]::Start((New-Object Diagnostics.ProcessStartInfo -Property @{
  FileName='wsl.exe'; Arguments='-l -q'; RedirectStandardOutput=$true; UseShellExecute=$false }))
$b = New-Object byte[] 20
$n = $p.StandardOutput.BaseStream.Read($b,0,20)
($b[0..($n-1)] | % { $_.ToString('X2') }) -join ' '   # 55 00 62 00 75 00 ...

# The boot-on-read behaviour (the reason chapter 06 exists)
wsl --shutdown; wsl -l -v                      # Stopped
Get-ChildItem \\wsl.localhost\<your distro>\home | Out-Null
wsl -l -v                                      # Running
```

Add to `src-tauri/src/services/platform/mod.rs`:

```rust
pub mod runtime;
pub mod wsl;
```

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: WSL distro detection (list + default)"
> git push
> ```
>
> The block above is the file as it stands at the end of the chapter. On the branch this commit's `wsl.rs` did not build on its own — it lacked the two `use std::…` lines and had two typos in identifiers — and the next two commits (§4.4's, and a `cargo fmt` pass) put it right. If you typed the block as printed, your commit is already the final file and those later fixes have nothing left to touch.

---

## 4.3 — Runtime detection & `RuntimeInfo`

Now bundle it into a single struct the frontend can read. Create `src-tauri/src/services/platform/detection.rs`:

```rust
use super::runtime::Runtime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub runtime: Runtime,
    pub wsl_available: bool,
    pub distros: Vec<String>,
    pub default_distro: Option<String>,
}

pub fn detect_runtime() -> RuntimeInfo {
    let is_wsl = std::env::var("WSL_DISTRO_NAME").is_ok();

    if is_wsl {
        return RuntimeInfo {
            runtime: Runtime::Wsl,
            wsl_available: true,
            distros: vec![],
            default_distro: std::env::var("WSL_DISTRO_NAME").ok(),
        };
    }

    let distros = super::wsl::list_distros();
    let default_distro = super::wsl::default_distro();

    RuntimeInfo {
        runtime: Runtime::Windows,
        wsl_available: !distros.is_empty(),
        distros,
        default_distro,
    }
}
```

### `WSL_DISTRO_NAME` — the cheapest check *(skip on first pass)*

If DevGo itself is running *inside* WSL, the environment variable `WSL_DISTRO_NAME` is set (e.g. `"Ubuntu"`). That's a zero-cost check — no process spawn — so we do it first and short-circuit. Otherwise we're on Windows: enumerate distros and mark WSL available if any exist.

### Note where `RuntimeInfo` lives

`RuntimeInfo` is defined in `detection.rs`, **not** `runtime.rs`. `runtime.rs` holds only the `Runtime` enum (the primitive); `detection.rs` holds the composite plus the logic that fills it. Re-export the composite from the platform module — `src-tauri/src/services/platform/mod.rs`:

```rust
pub mod detection;
pub mod runtime;
pub mod wsl;

pub use detection::RuntimeInfo;
```

And expose the platform module from `src-tauri/src/services/mod.rs`:

```rust
pub mod platform;
pub mod scanner;
pub mod workspace;

pub use scanner::scan_workspace;
pub use workspace::WorkspaceStore;
```

---

## 4.4 — Cache `RuntimeInfo` in `AppState`

`detect_runtime` spawns `wsl.exe` twice, and both calls go through WSLService — the same Windows service that hands out distro state, and the one that stalls for tens of seconds when it is having a bad day. There is no reason to pay that on every `get_runtime_info`. Detect **once at startup**, store it in `AppState`, and hand out clones.

Extend `AppState` in `src-tauri/src/commands.rs` — one import, one field, one command:

```rust
use crate::services::platform::RuntimeInfo;

pub struct AppState {
    pub workspace_store: Mutex<WorkspaceStore>,
    pub runtime_info: RuntimeInfo,
}

#[tauri::command]
pub fn get_runtime_info(state: State<AppState>) -> RuntimeInfo {
    state.runtime_info.clone()
}
```

`runtime_info` is plain data (not behind a `Mutex`) because it's computed once and never mutated — a `Mutex` would be pointless overhead. The command just clones it out. It returns `RuntimeInfo` directly, not a `Result`: there is nothing here that can fail.

That "never mutated" holds for exactly two chapters. Chapter 06 gives the user a Refresh that re-probes WSL, and a value that can be replaced through a shared `&AppState` needs the same interior mutability the workspace store has — so the field gains a `Mutex` there, when the reason for it arrives. Chapter 08 then moves the value into `prefs.json`, so a normal launch reads it off disk and shells out to nothing at all.

Wire it in `src-tauri/src/lib.rs` — detect at the top of `run`, move it into `setup`, and register the command:

```rust
mod commands;
mod error;
mod models;
mod services;

use commands::AppState;
use services::platform::detection;
use services::workspace::WorkspaceStore;
use tauri::Manager;

pub fn run() {
    let runtime_info = detection::detect_runtime();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app data dir");

            let store = WorkspaceStore::new(app_data_dir)
                .expect("failed to initialize workspace store");

            app.manage(AppState {
                workspace_store: std::sync::Mutex::new(store),
                runtime_info,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::get_projects,
            commands::get_runtime_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

The closure was already `move` (chapter 02 wrote it that way); now it has something to capture — `runtime_info` moves into the closure by value and from there into `AppState`.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: runtime detection + RuntimeInfo, cached in AppState"
> git push
> ```
>
> Then `cargo fmt` from `src-tauri/` and read the diff: the branch has one more commit here, for two comment typos in `wsl.rs` (`whitepsace`, `whic`) and the import order in `commands.rs`. If `cargo fmt` moved anything for you, commit it the same way:
>
> ```powershell
> git add -A
> git commit -m "✅RUST: comment typos, import order (cargo fmt)"
> git push
> ```

---

## 4.5 — The badge

Four lines of Rust reach the screen through one type, one hook and one component.

### The types

Add the mirror of `RuntimeInfo` to `src/types.d.ts` under the Rust wire types, and the badge's props under the component props:

```ts
interface RuntimeInfo {
	runtime: 'windows' | 'wsl';
	wsl_available: boolean;
	distros: string[];
	default_distro: string | null;
}
```

```ts
interface RuntimeIndicatorProps {
	runtime: RuntimeInfo['runtime'];
}
```

`RuntimeInfo.runtime` is `'windows' | 'wsl'` — **lowercase**, matching the `#[serde(rename_all = "lowercase")]` from §4.1. `default_distro` is `string | null` because Rust's `Option<String>` serializes to `null` when `None`. The badge's prop is typed as `RuntimeInfo['runtime']` — the same two strings, written once — rather than a bare `string`, so a typo at the call site is a compile error, not a badge that silently says `"widnows"`.

### `useRuntime`

Create `src/hooks/useRuntime.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export const useRuntime = () => {
	const [info, setInfo] = useState<RuntimeInfo | null>(null);

	useEffect(() => {
		invoke<RuntimeInfo>('get_runtime_info').then(setInfo);
	}, []);

	return info;
};
```

`useRuntime` is tiny and independent — it fires `get_runtime_info` once and returns the badge data (or `null` while loading). One hook, one file, named for the hook: the same rule as `useWorkspaces` and `useProjects`.

### RuntimeIndicator

A tiny pill badge. Create `src/components/RuntimeIndicator.tsx`:

```tsx
const LABELS: Record<RuntimeInfo['runtime'], string> = {
	windows: 'Windows',
	wsl: 'WSL'
};

const RuntimeIndicator = ({ runtime }: RuntimeIndicatorProps) => (
	<span className='inline-block px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-bg-panel text-accent border border-border'>
		{LABELS[runtime]}
	</span>
);

export default RuntimeIndicator;
```

It takes the lowercase `'windows'`/`'wsl'` from `RuntimeInfo` and maps it to a display label. Because the prop is the union type, `LABELS` is `Record<RuntimeInfo['runtime'], string>` and the lookup cannot miss — no `?? runtime` fallback needed. Keeping the prop a bare value (not the whole `RuntimeInfo`) means the badge re-renders only when the runtime actually changes.

### Into the title bar's slot

`src/App.tsx` — two imports, one hook call at the top of `AppInner`, and the `children` slot chapter 01 left in the title bar finally has an occupant:

```tsx
import RuntimeIndicator from './components/RuntimeIndicator';
import { useRuntime } from './hooks/useRuntime';
```

```tsx
	const runtime = useRuntime();
```

```tsx
			<TitleBar>
				<RuntimeIndicator runtime={runtime?.runtime ?? 'windows'} />
			</TitleBar>
```

`runtime?.runtime ?? 'windows'` — `useRuntime` returns `null` until the command answers, and the badge should not flicker through an empty state for the sake of a few milliseconds. One prop, so it is written as one prop; the spread-object form is for components that take several.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅REACT: RuntimeInfo type, useRuntime, RuntimeIndicator badge in the title bar"
> git push
> ```

---

## 4.6 — Verify

```powershell
cd src-tauri
cargo check
cargo test
```

Clean — nothing in this chapter is early. Four tests pass without touching `wsl.exe`. In your head, `invoke('get_runtime_info')` now returns:

```json
{
  "runtime": "windows",
  "wsl_available": true,
  "distros": ["<whatever wsl -l -q prints>"],
  "default_distro": "<the one wsl -l -v marks with *>"
}
```

Note the lowercase `"windows"` — that's the `rename_all` working. Then `bun tauri dev`: the title bar carries a **WINDOWS** pill beside the window buttons.

> **Commit checkpoint** — DevGo knows what WSL is. Stage commit, then merge the chapter into `main`:
>
> ```powershell
> git add -A
> git commit -m "✅STAGE: 04 wsl"
> git push
> git checkout main
> git merge 04.wsl
> git push
> ```

---

## 4.7 — What you just built

```
src-tauri/src/
├── lib.rs                 ← detect_runtime() once, before the builder
├── commands.rs            ← AppState + runtime_info, get_runtime_info
└── services/platform/
    ├── mod.rs
    ├── runtime.rs         ← Runtime { Windows, Wsl }
    ├── wsl.rs             ← list/default distros, UTF-16 decode, 4 tests
    └── detection.rs       ← RuntimeInfo + detect_runtime()
src/
├── types.d.ts             ← + RuntimeInfo, RuntimeIndicatorProps
├── hooks/useRuntime.ts
└── components/RuntimeIndicator.tsx
```

What was left out of this chapter on purpose, and where it lands: `windows_to_wsl_path` (chapter 05 — the launcher is the first caller), `running_distros` / `is_running` (chapter 06 — the never-boot rule is the first caller). A function nothing calls is a promise, and this chapter makes none.

→ Next: [05 — Launcher Service](./05-launcher.md)

→ Appendix: [Rust Concepts](./appendix/rust-concepts.md)
