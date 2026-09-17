# 02 — Workspaces (Phase 2)

**Branch:** `02.workspaces` — `git checkout 02.workspaces` gives you this chapter's finished app; `git diff --ignore-cr-at-eol 01.scaffold 02.workspaces` is exactly what this chapter adds (the flag hides the line-ending change §2.0 makes to every chapter-01 file).

**Starting from:** chapter 01 — a frameless Tauri window with Tailwind and a title bar, and nothing behind it.

**Goal:** the data model, an error type, a persisted list of workspace folders with three Tauri commands over it — and the React that lets you add and remove them: a hook, the folder picker, a toast for when something goes wrong, and a confirm step for the one destructive action.

> **How workspaces and projects relate.** A **workspace** is a folder you point DevGo at (e.g. `C:\dev`). A **project** is a direct subfolder of a workspace (e.g. `C:\dev\my-app`). DevGo stores a flat list of workspace *paths* and scans each one level deep to find projects. That's the whole data model — no database, just JSON files in the app data dir. This chapter builds the workspace half and the `Project` type; chapter 03 builds the scan that fills it.

> **Before you start.** Two files created in §2.0 make this chapter's Rust read the way it is printed: `src-tauri/rustfmt.toml` with `max_width = 80`, so every signature that would run past 80 columns breaks one parameter per line, and `.gitattributes` pinning LF. Run `cargo fmt` from `src-tauri/` whenever a block here looks different from what you typed.

---

## 2.0 — Also since 01: line endings, `rustfmt`, and the opener plugin

Three housekeeping changes ride on this branch that are not about workspaces. Two come first, because everything else in the chapter is formatted by them; the third is a one-commit clean-up near the end.

**LF and `rustfmt`.** On Windows an editor will happily rewrite a whole file to CRLF, and a twenty-line change becomes a two-thousand-line diff. Create `.gitattributes` at the project root:

```
# Source is LF in the repo. Without this, editing on Windows silently rewrites
# whole files to CRLF and buries a 20-line change in a 2000-line diff.
* text=auto eol=lf
*.png binary
*.ico binary
*.icns binary
```

and `src-tauri/rustfmt.toml`, so every Rust block in the book fits the page:

```toml
# src-tauri/rustfmt.toml
max_width = 80
```

Then renormalise once — `git add --renormalize .` rewrites every text file chapter 01 committed with CRLF (eleven of them: `README.md`, `.vscode/extensions.json`, `src-tauri/.gitignore`, `build.rs`, `lib.rs`, `main.rs`, `tauri.conf.json`, `index.css`, `main.tsx`, `vite-env.d.ts`, `tsconfig.json`) to LF in one commit. That is why the plain `git diff 01.scaffold 02.workspaces` is enormous and `--ignore-cr-at-eol` is the one to read.

> **Commit checkpoint**
>
> ```powershell
> git add --renormalize .
> git add -A
> git commit -m "✅CHORE: LF in the repo (.gitattributes), rustfmt at 80 columns; every file renormalized once"
> git push
> ```

**The opener plugin.** Chapter 01 unplugged `tauri-plugin-opener` from `lib.rs` and the capabilities but left the crate and the npm package listed. `shell` covers everything it did, so it goes now: remove `tauri-plugin-opener = "2"` from `src-tauri/Cargo.toml` and `"@tauri-apps/plugin-opener"` from `package.json`, then `cargo check` and `bun install` rewrite the two lock files (`Cargo.lock` loses 449 lines — the opener's whole dependency tree). On the branch this is its own commit, made after the React below and before the stage commit (the checkpoint is at the end of §2.6); it is described here so the chapter's file list is complete.

---

## 2.1 — Project Model

Create `src-tauri/src/models/project.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub full_path: String,
    pub workspace: String,
    pub file_system: String,
}

impl Project {
    pub fn new(
        name: String,
        full_path: String,
        workspace: String,
        file_system: String,
    ) -> Self {
        Self {
            name,
            full_path,
            workspace,
            file_system,
        }
    }
}
```

### Why these four fields?

- **`name`** — the folder name, shown in the list (e.g. `my-app`).
- **`full_path`** — the absolute path. This is the project's *unique identity* — two workspaces can both contain a `docs` folder, but the full paths differ. We use it as the React list key and, in chapter 08, to remember the last-selected project.
- **`workspace`** — the workspace path this project came from. We need it so the UI can **group** projects by workspace (chapter 03's tree).
- **`file_system`** — `"Windows"` or `"WSL"`. Chapter 03's scanner fills it in from the shape of the workspace path; chapter 04 is where DevGo learns what WSL actually is. Storing it per-project lets the UI badge each row.

### `#[derive(...)]` — what each trait buys us

- **`Debug`** — print with `{:?}` for `dbg!(project)` debugging.
- **`Clone`** — `.clone()` makes an independent copy. Tauri commands return *owned* data to the frontend, so this saves us from lifetime gymnastics.
- **`Serialize`** — Rust struct → JSON. Tauri uses this when returning a `Project` from a command.
- **`Deserialize`** — JSON → Rust struct. Tauri uses this when the frontend *sends* a `Project` back (chapter 05's launch commands will receive one).

### `String` vs `&str`

`String` is owned, heap-allocated text. Struct fields that *own* their data use `String`. If we used `&str` (a borrow), we'd need lifetime annotations (`<'a>`) — painful to serialize and store. Rule of thumb: **`&str` for function parameters, `String` for struct fields.**

### `fn new(...) -> Self`

Rust has no constructors — the convention is an associated function called `new`. `Self` is shorthand for the type (`Project`) — capital S; lowercase `self` is the receiver inside a method and does not exist here. The field-init shorthand `Self { name, full_path, ... }` works because the parameter names match the field names.

Create `src-tauri/src/models/mod.rs`:

```rust
pub mod project;

pub use project::Project;
```

`pub use project::Project` re-exports the type so the rest of the app writes `models::Project`, not `models::project::Project`.

> **Note:** there is deliberately **no `Workspace` struct.** A workspace is just a path — a `String`. Introducing a struct with a single meaningful field would be ceremony with no payoff. We store `Vec<String>`.

Nothing constructs a `Project` until chapter 03, and `rustc` will say so — "struct `Project` is never constructed", "unused import: `project::Project`" — warnings that go away the moment the scanner exists. The type is here now because it is the other half of the data model this chapter is about; it is the one thing in this chapter that is early, and this is why.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: Project model"
> git push
> ```

---

## 2.2 — Error Type

Every fallible operation in DevGo returns `Result<T, AppError>`. Add the crate first — from `src-tauri/`:

```powershell
cargo add thiserror
```

Create `src-tauri/src/error.rs`:

```rust
use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

// std::io::Error and serde_json::Error don't implement Serialize, so we can't
// derive Serialize on the enum. Tauri only needs the error as a string on the
// frontend, so we serialize via the Display impl that thiserror generated.
impl Serialize for AppError {
    fn serialize<S: Serializer>(
        &self,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
```

Two variants, because this chapter has two ways to fail: the file system (`fs::read_to_string`, `fs::write`) and JSON (`serde_json::from_str`, `to_string_pretty`). The enum grows one variant at a time as chapters bring new failures — a poisoned lock, a missing WSL distro, an editor not on PATH — each in the chapter that first produces it. An error nothing can raise is a promise the code is not keeping yet.

### Deep dive: `thiserror` + `#[from]`

`thiserror`'s `#[derive(Error)]` writes the boilerplate `Error`/`Display` impls for us.

- **`#[error("IO error: {0}")]`** defines the `Display` message. `{0}` is the variant's first field.
- **`#[from]`** auto-implements `From<std::io::Error> for AppError`. This is what makes the `?` operator convert errors for free:

  ```rust
  let data = fs::read_to_string(&path)?; // io::Error → AppError::Io, automatically
  ```

  When `read_to_string` fails, `?` calls `.into()`, and because of `#[from]` that turns the `io::Error` into `AppError::Io`, then returns early. Same story for `serde_json::Error → AppError::Json`.

### Why the manual `Serialize` impl?

Tauri sends command errors to the frontend as JSON, so `AppError` must be `Serialize`. But `std::io::Error` and `serde_json::Error` (wrapped by our `#[from]` variants) **aren't** `Serialize` — so `#[derive(Serialize)]` won't compile. The idiomatic Tauri fix is to serialize the error as its `Display` string. That's the eight lines at the bottom. The frontend gets `"IO error: The system cannot find the path specified."` instead of an opaque object.

> This is a genuinely common Tauri gotcha — "`the trait Serialize is not implemented for std::io::Error`". Now you know the fix.

`error.rs` has no commit of its own: nothing uses it until the store in §2.3, and it is committed together with the store there.

---

## 2.3 — Workspace Store

Workspaces are persisted to `workspaces.json`. Rather than free functions that re-read the file on every call, we keep the list **in memory** inside a small store struct and write to disk on mutation. That store becomes part of the app state.

Create `src-tauri/src/services/workspace.rs`:

```rust
use crate::error::AppError;
use serde_json;
use std::fs;
use std::path::PathBuf;

#[derive(Debug)]
pub struct WorkspaceStore {
    workspaces: Vec<String>,
    file_path: PathBuf,
}

impl WorkspaceStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;

        let file_path = app_data_dir.join("workspaces.json");
        let workspaces = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            let default: Vec<String> = Vec::new();
            fs::write(&file_path, serde_json::to_string_pretty(&default)?)?;
            default
        };

        Ok(Self {
            workspaces,
            file_path,
        })
    }

    pub fn list(&self) -> Vec<String> {
        self.workspaces.clone()
    }

    pub fn add(&mut self, path: &str) -> Result<(), AppError> {
        let normalized = path.replace('\\', "/");
        if !self
            .workspaces
            .iter()
            .any(|w| w.replace('\\', "/") == normalized)
        {
            self.workspaces.push(path.to_string());
            self.save()?;
        }
        Ok(())
    }

    pub fn remove(&mut self, index: usize) -> Result<(), AppError> {
        if index < self.workspaces.len() {
            self.workspaces.remove(index);
            self.save()?;
        }
        Ok(())
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.workspaces)?;
        fs::write(&self.file_path, data)?;
        Ok(())
    }
}
```

### Why a stateful store instead of free functions?

The list is small and read constantly (every scan, every render). Holding it in memory means reads are free and only mutations touch the disk. The store owns its `file_path`, so callers never pass it around. In the next section we wrap this in a `Mutex` and hand it to Tauri as managed state.

### `&self` vs `&mut self`

- `list` takes `&self` — read-only, borrows immutably.
- `add` / `remove` take `&mut self` — they mutate `self.workspaces`, so they need a mutable borrow. The compiler enforces that you can't call `add` through a shared borrow (`&self`). This is why the state gets a `Mutex` later.

### Dedup by normalized path

`C:\dev` and `C:/dev` are the same folder. Before pushing, `add` normalizes `\` → `/` on both sides and skips the insert if it's already there. We store the path *as the user gave it* (`path.to_string()`), but compare normalized. (The `if !self.workspaces.iter().any(...)` chain is one expression; at 80 columns `cargo fmt` stands it up one method per line.)

### `unwrap_or_default()` on a corrupt file

```rust
serde_json::from_str(&data).unwrap_or_default()
```

If `workspaces.json` is somehow corrupt, we fall back to an empty `Vec` instead of crashing on launch. `Default` for `Vec<String>` is `[]`. A launcher that refuses to start because one JSON file got mangled is a bad launcher.

Create `src-tauri/src/services/mod.rs`:

```rust
pub mod workspace;

pub use workspace::WorkspaceStore;
```

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: WorkspaceStore (JSON load/save/add/remove)"
> git push
> ```
>
> (This commit carries `error.rs` from §2.2 as well as `services/`.)

---

## 2.4 — App State & Commands

Now expose the store to the frontend. Create `src-tauri/src/commands.rs`:

```rust
use std::sync::Mutex;
use tauri::State;

use crate::services::WorkspaceStore;

pub struct AppState {
    pub workspace_store: Mutex<WorkspaceStore>,
}

#[tauri::command]
pub fn get_workspaces(state: State<AppState>) -> Result<Vec<String>, String> {
    let store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    Ok(store.list())
}

#[tauri::command]
pub fn add_workspace(
    path: String,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    store.add(&path).map_err(|e| e.to_string())?;
    Ok(store.list())
}

#[tauri::command]
pub fn remove_workspace(
    index: usize,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    store.remove(index).map_err(|e| e.to_string())?;
    Ok(store.list())
}
```

### `State<AppState>` — Tauri's dependency injection

Tauri stores managed state as `Arc<T>` and injects it by type. Declare a `state: State<AppState>` parameter and Tauri hands you the managed value, borrowed. Only one instance of each type can be managed. We'll register `AppState` in `lib.rs` in the next section.

### Why `Mutex<WorkspaceStore>`?

`add`/`remove` need `&mut self`, but `State` only gives you a *shared* borrow (`&AppState`). A `Mutex` gives interior mutability: `lock()` returns a guard you can mutate through. Tauri commands can run concurrently on a thread pool, so the `Mutex` also serializes access — two `add_workspace` calls can't race.

`lock()` returns `Result` (it fails only if another thread panicked while holding the lock — "poisoning"). We map that to a string rather than `.unwrap()`ing so a poisoned lock surfaces as a toast instead of a crash.

### The command returns the new list

`add_workspace` and `remove_workspace` hand back the updated `Vec<String>` rather than `()`. That is for the frontend's benefit: the hook in §2.6 sets its state straight from the return value, so a mutation is one round trip, not a write followed by a re-read.

> **Why `Result<_, String>` and not `AppError`?** These three commands have exactly one real failure — a poisoned lock — and a plain string is enough for it. Both `String` and `AppError` are `Serialize`, so Tauri is happy either way. Chapter 03's `get_projects` returns `Result<_, AppError>` because it has richer failures to report. Mixing is fine; use the richest type each command actually needs.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: AppState + workspace commands"
> git push
> ```

---

## 2.5 — Wire It Into `lib.rs`

Register the modules, build the store in `setup`, manage it as state, and list the commands. Update `src-tauri/src/lib.rs`:

```rust
mod commands;
mod error;
mod models;
mod services;

use commands::AppState;
use services::workspace::WorkspaceStore;
use tauri::Manager;

pub fn run() {
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
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### `setup` runs once at startup

Here we resolve the OS app-data dir (`C:\Users\you\AppData\Roaming\app.zetta.devgo`), create it, build the `WorkspaceStore` from `workspaces.json`, and `manage` it. Every command can now reach the store via `State<AppState>`. `use tauri::Manager` is what puts `.path()` and `.manage()` on the app handle. The scaffold's `#[cfg_attr(mobile, tauri::mobile_entry_point)]` line above `run` goes at the same time — this app never builds for a phone, and the attribute was the only trace of one.

### `expect` in `setup`, `?` in commands

`setup` uses `.expect(...)` — if the app data dir can't be resolved or the store won't initialize, there's no meaningful recovery, so panicking with a clear message is correct. Commands use `?` / `map_err` to return errors *gracefully* to the frontend, where they become toasts. **Panic at startup for unrecoverable setup; return `Result` for anything the user can react to.**

> `AppState` holds only `workspace_store` for now. It grows in later chapters — chapter 04 adds a cached `runtime_info`, chapter 06 a `cache_store`, chapter 07 the single-instance `lock_path`, chapter 08 a `pref_store`. We add fields as features need them, never up front.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: AppError, WorkspaceStore, AppState + workspace commands wired into lib.rs"
> git push
> ```
>
> The subject names everything the compiler sees for the first time here: until `lib.rs` declares `mod error; mod services; mod commands;`, the three files from §2.2–§2.4 are not part of the crate at all, and `cargo check` has been reading only `models/`. This is the first commit in which the whole backend builds as one — on the branch it also carries the last touches to `error.rs`, `workspace.rs` and `commands.rs` that `cargo fmt` and `cargo check` asked for once they were compiled together, so if your earlier commits differ slightly from the printed blocks, this is where they converge.

---

## 2.6 — The React that drives it

Three commands and nothing to call them. The rest of the chapter is the smallest UI that makes the workspace list real: a hook that mirrors the store, a panel with the native folder picker, a toast for errors, and a confirm dialog in front of the one destructive action.

The four rules from chapter 01 apply to every file below — default exports for components, mapped elements, hooks only where there is state, no manual memoization — and two more show up for the first time. **A hook is a named export** (`export const useWorkspaces`, imported with braces): a component is the one thing its file is about, a hook is a function among functions, and the braces at the import site are what tells them apart at a glance. And **a component with several props takes them as one spread object**, `{...{ workspaces, onAdd, onRemove }}`, which is `workspaces={workspaces} onAdd={onAdd} onRemove={onRemove}` with the names written once.

### Ambient type declarations

Every type in the app lives in one ambient file, `src/types.d.ts`: the Rust wire types (so no component has to import a type to talk to the backend) *and* every component's props. Chapter 01 left it empty and kept `TitleBarProps` / `TitleBarButtonProps` beside their components; this chapter is where the rule starts, so those two move here and the four new shapes join them. The whole file as it stands at the end of the chapter — give it its first entry:

```ts
// ambient type declarations — usable everywhere, no import needed.
// No top-level import/export in this file: the moment one appears, every
// interface here stops being global. React's types are reached through the
// global `React` namespace (React.ReactNode, React.Ref<T>) for the same reason.

/* Rust wire types — mirror the structs in src-tauri/src/models */

interface Project {
	name: string;
	full_path: string;
	workspace: string;
	file_system: string;
}

/* Component props */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
}

interface TitleBarProps {
	children?: React.ReactNode;
}

interface TitleBarButtonProps {
	className?: string;
	onClick: () => void;
	children: React.ReactNode;
}

interface WorkspaceManagerProps {
	workspaces: string[];
	onAdd: (path: string) => void;
	onRemove: (index: number) => void;
}

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/* Toast */

type ToastType = 'error' | 'success' | 'info';

interface Toast {
	id: number;
	message: string;
	type: ToastType;
}

interface ToastContextType {
	toasts: Toast[];
	toast: (message: string, type?: ToastType) => void;
}

interface ToastProviderProps {
	children: React.ReactNode;
}
```

#### Why no `import`, no `declare global`, no `export {}`

A `.d.ts` file with **no top-level `import` or `export`** is treated as a *global script* — its declarations land in the global scope automatically. So `Project` is available in every `.tsx` file with no import line, like `HTMLElement`. The moment you add an `import`/`export` to this file it becomes a *module* and the globals vanish (then you'd need `declare global { … }`). We keep it a plain script on purpose. If a shape in here needs a React type, reach it through the global namespace — `React.ReactNode` — never through a top-level import.

#### Match the Rust exactly

`Project` has the same four fields as the Rust struct. There's no `Workspace` type — workspaces are just `string[]`. Every later chapter that gives Rust a new wire type adds its mirror to this one file, so the whole contract stays in one place.

#### Props live here too

`ButtonProps`, `WorkspaceManagerProps`, `ConfirmDialogProps`, the three toast shapes — and, moved in from chapter 01, `TitleBarProps` and `TitleBarButtonProps`. Moving them is an edit in two files: delete the `interface TitleBarProps { … }` block from `TitleBar.tsx` together with its `import { type ReactNode } from 'react'` line (the ambient file names the type as `React.ReactNode`, so the import has no other use), and delete the `interface TitleBarButtonProps { … }` block from `TitleBarButton.tsx`. Neither component changes otherwise. A component file then contains only the component; its contract is one `Ctrl+Click` away in the one file every contract is in. React's own types are reached as `React.ReactNode`, `React.ButtonHTMLAttributes<…>` — the global namespace `@types/react` declares — never through an `import` line, because a top-level `import` would turn the file into a module and un-global everything. The comment at the top of the file says so, for the next person who reaches for one.

### `useWorkspaces`

Create `src/hooks/useWorkspaces.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export const useWorkspaces = () => {
	const [workspaces, setWorkspaces] = useState<string[]>([]);

	const refresh = async () => {
		const ws = await invoke<string[]>('get_workspaces');
		setWorkspaces(ws);
	};

	useEffect(() => {
		refresh();
	}, []);

	const add = async (path: string) => {
		const ws = await invoke<string[]>('add_workspace', { path });
		setWorkspaces(ws);
	};

	const remove = async (index: number) => {
		const ws = await invoke<string[]>('remove_workspace', { index });
		setWorkspaces(ws);
	};

	return { workspaces, add, remove, refresh };
};
```

#### The command returns the new list

Notice `add`/`remove` call `invoke<string[]>` and use the **returned** list directly (`setWorkspaces(ws)`) — no separate refetch. Our Rust `add_workspace`/`remove_workspace` return the updated `Vec<String>` exactly so the frontend can update in one round trip. The store is the single source of truth; the hook just mirrors it.

#### Plain functions, not `useCallback`

`refresh`, `add` and `remove` are ordinary `async` arrow functions. In pre-compiler React they would each be wrapped in `useCallback(…, [])` so their identity stayed stable across renders; the React Compiler (chapter 01) does that wrapping itself, so the source stays the shape it would be in any other TypeScript file. The initial-load effect lists no dependencies because it runs once on mount — `refresh` reads nothing that changes. Note this hook does **not** open the folder picker; that lives in the `WorkspaceManager` component below, which calls `add(path)` once it has a path.

#### This is what a hook is for

`useWorkspaces` holds state (`workspaces`), an effect (the initial load), and the three operations that change the state. That is the whole reason it is a hook and not a plain function: the component that uses it stays markup. Compare `TitleBar` in chapter 01, which has none of that and gets no hook.

### Button

Before any button is drawn, the one component every button in the app will be. Create `src/components/Button.tsx`:

```tsx
const base =
	'inline-flex items-center justify-center font-semibold rounded-lg cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANT: Record<ButtonVariant, string> = {
	primary:
		'px-5 py-2.5 text-[13px] border border-accent bg-accent text-text-primary hover:bg-accent-hover',
	secondary:
		'px-5 py-2 text-[13px] border border-border bg-bg-panel text-text-secondary hover:bg-bg-hover hover:text-text-primary',
	danger:
		'px-5 py-2 text-[13px] border border-danger bg-danger text-white hover:bg-danger/80',
	ghost:
		'p-1 text-sm rounded bg-transparent border-none text-text-muted hover:text-text-primary hover:bg-bg-hover'
};

const Button = ({
	variant = 'secondary',
	className = '',
	type = 'button',
	children,
	...rest
}: ButtonProps) => (
	<button {...{ type, className: `${base} ${VARIANT[variant]} ${className}`, ...rest }}>
		{children}
	</button>
);

export default Button;
```

#### One element, four variants

`base` is what makes a button a button — inline-flex centring, weight, radius, cursor, the disabled look. `VARIANT` is the four ways it can be dressed: `primary` (the one action on a panel), `secondary` (the safe choice in a pair), `danger` (the destructive one), `ghost` (an icon sitting on a row — no border, no fill until hovered). A caller picks a variant and, if the row needs it, appends a class or two; it never writes a button's classes from scratch again.

The props are the DOM's own — `ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>` — plus `variant`. `type` defaults to `'button'` (a `<button>` without it submits the nearest form), `className` to `''` (so the template literal never prints `undefined`), and `...rest` carries `onClick`, `disabled`, `title`, whatever the caller passes, straight to the element.

The reason this file exists in chapter 02 and not chapter 20: a launcher with no shared button ends up, twenty chapters on, with dozens of hand-styled `<button>`s across as many files, each a slightly different copy of these strings. One element, mapped — rule 2 applied to the primitive, not just the list.

### WorkspaceManager

The add/remove workspaces panel — and the home of the native folder picker. It's lazy-loaded, so it lives in its own chunk. Create `src/components/WorkspaceManager.tsx`:

```tsx
import { open } from '@tauri-apps/plugin-dialog';
import Button from './Button';

const WorkspaceManager = ({
	workspaces,
	onAdd,
	onRemove
}: WorkspaceManagerProps) => {
	const handleAdd = async () => {
		const selected = await open({ directory: true });
		if (selected) onAdd(selected);
	};

	return (
		<div>
			<h3 className='text-base font-bold mb-4'>Workspaces</h3>

			{workspaces.length === 0 ? (
				<p className='text-[13px] text-text-muted mb-4'>
					No workspaces added yet.
				</p>
			) : (
				<ul className='list-none flex flex-col gap-1.5 mb-4'>
					{workspaces.map((ws, i) => (
						<li
							key={ws}
							className='flex items-center justify-between px-3 py-2 bg-bg-panel rounded-md font-mono text-xs break-all'
						>
							<span className='text-text-secondary flex-1'>{ws}</span>
							<Button
								variant='ghost'
								className='px-2 hover:text-danger hover:bg-danger/10'
								onClick={() => onRemove(i)}
							>
								&#10005;
							</Button>
						</li>
					))}
				</ul>
			)}

			<Button variant='primary' onClick={handleAdd}>
				Add Folder
			</Button>
		</div>
	);
};

export default WorkspaceManager;
```

#### The folder picker lives here

`handleAdd` calls the dialog plugin's `open({ directory: true })` — the native OS folder picker, permitted by the `dialog:allow-open` line chapter 01 put in the capabilities. If the user picks a folder (not cancel), it calls `onAdd(path)`, which flows up to the hook's `add` → the Rust command → the returned list. The component itself is presentational: it renders the list and the buttons, and delegates every mutation to props.

`handleAdd` is a local `async` function, not a hook: it has no state of its own, it just awaits the picker and forwards the answer. The `workspaces.map` is the one list in the file. The ✕ on each row is a `ghost` `Button` with two extra classes for its red hover; **Add Folder** is the panel's one `primary`.

### Toast notifications

A global, context-based notification system so any component can raise a message. Create `src/components/Toast.tsx`:

```tsx
import { createContext, useContext, useState } from 'react';

const ToastContext = createContext<ToastContextType>({
	toasts: [],
	toast: () => {}
});

let toastId = 0;

const VARIANT: Record<ToastType, string> = {
	error: 'border-danger/40 text-red-300',
	success: 'border-emerald-500/40 text-emerald-300',
	info: 'border-border text-text-secondary'
};

const ToastProvider = ({ children }: ToastProviderProps) => {
	const [toasts, setToasts] = useState<Toast[]>([]);

	const toast = (message: string, type: ToastType = 'error') => {
		const id = ++toastId;
		setToasts(prev => [...prev, { id, message, type }]);
		setTimeout(() => {
			setToasts(prev => prev.filter(t => t.id !== id));
		}, 4000);
	};

	return (
		<ToastContext.Provider value={{ toasts, toast }}>
			{children}
			<div className='fixed bottom-4 right-4 z-50 flex flex-col gap-2'>
				{toasts.map(t => (
					<div
						key={t.id}
						className={`px-4 py-3 bg-bg-panel border rounded-lg text-sm shadow-lg animate-fade-in ${VARIANT[t.type]}`}
					>
						{t.message}
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
};

export default ToastProvider;

export const useToast = () => useContext(ToastContext);
```

#### Context = talk to any component without prop threading

Errors can originate anywhere — a workspace mutation now, a launch handler in chapter 05. Passing a `toast` callback through every component's props would be miserable. Context makes it globally available: wrap the app once in `ToastProvider`, call `useToast()` anywhere. React can't react to a plain global variable, but Context is backed by state, so pushing a toast re-renders the list.

#### Two exports, one file

The provider is the component, so it is the default export. `useToast` is the hook that reads the provider's context — it only makes sense next to it, so it rides along as a named export: `import ToastProvider, { useToast } from './components/Toast'`. Same shape as `TitleBarButton` and `TITLE_BAR_BUTTONS` in chapter 01. `toast` itself is a plain function — the compiler keeps its identity stable for the consumers, no `useCallback`.

#### Typed variants

`toast(message, type?)` defaults to `'error'` (the common case), with `success` and `info` for confirmations and notices. `VARIANT` maps each to a border/text color. Each toast gets a monotonic `id` and auto-dismisses after 4 s via `setTimeout` + a filter.

#### `animate-fade-in` is a theme token

The class on each toast is not a Tailwind default. Add it to the `@theme` block in `src/index.css`, right after `--radius-panel: 12px;` — Tailwind v4 mints `animate-fade-in` from the `--animate-*` variable, and the keyframes live beside it so nothing outside the block needs to know the animation's name:

```css
	/* Toast entrance. Tailwind v4 mints `animate-fade-in` from this variable. */
	--animate-fade-in: fade-in 0.18s ease-out;
	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
```

The `@theme` block from chapter 01 ends with these thirteen lines from now on.

### Confirm before removing a workspace

Removing a workspace is destructive-ish (it drops your saved folder), so gate it behind a dialog. Create `src/components/ConfirmDialog.tsx`:

```tsx
import { useEffect } from 'react';
import Button from './Button';

const ConfirmDialog = ({
	open,
	title,
	message,
	onConfirm,
	onCancel
}: ConfirmDialogProps) => {
	// Close on Escape. The effect runs unconditionally (hooks must not sit behind
	// an early return); it only wires the listener while the dialog is open.
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onCancel();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [open, onCancel]);

	if (!open) return null;

	const actions: { label: string; variant: ButtonVariant; onClick: () => void }[] = [
		{ label: 'Cancel', variant: 'secondary', onClick: onCancel },
		{ label: 'Remove', variant: 'danger', onClick: onConfirm }
	];

	return (
		<div
			className='fixed inset-0 bg-black/60 flex items-center justify-center z-50'
			onClick={onCancel}
		>
			<div
				className='bg-bg-secondary border border-border rounded-xl p-6 max-w-sm w-90 shadow-2xl'
				onClick={e => e.stopPropagation()}
			>
				<h3 className='text-base font-bold mb-2'>{title}</h3>
				<p className='text-sm text-text-secondary mb-6'>{message}</p>
				<div className='flex justify-end gap-3'>
					{actions.map(({ label, ...button }) => (
						<Button key={label} {...button}>
							{label}
						</Button>
					))}
				</div>
			</div>
		</div>
	);
};

export default ConfirmDialog;
```

#### Hooks before early returns

`useEffect` sits **above** `if (!open) return null` — React requires hooks to run in the same order every render, so they can't hide behind a conditional return. The effect guards internally (`if (!open) return`) and only attaches the Escape listener while the dialog is open. Backdrop click closes; `stopPropagation` on the panel keeps inner clicks from bubbling out.

#### Two buttons, one element

Cancel and Remove are one `Button` mapped over `actions`; each entry is a label, a variant and a handler, and nothing else — the colours are the variant's business. `{ label, ...button }` peels the label off for the key and the text and spreads the rest straight onto the component. `actions` sits *below* the early return on purpose: it is plain data, not a hook, so it is allowed there, and there is no reason to build it for a dialog that is not open.

### App composition

Wire it together. `src/App.tsx` splits into an inner component wrapped by `ToastProvider`, gains an error formatter, and renders the panel straight into the content area — there is no button row to hide it behind yet, so for the next three chapters the workspace list simply sits in the window:

```tsx
import { lazy, Suspense, useState } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import TitleBar from './components/TitleBar';
import ToastProvider, { useToast } from './components/Toast';
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
	const {
		workspaces,
		add: addWorkspace,
		remove: removeWorkspace
	} = useWorkspaces();
	const { toast } = useToast();
	const [removeIndex, setRemoveIndex] = useState<number | null>(null);

	const handleRemove = async (index: number) => {
		try {
			await removeWorkspace(index);
		} catch (e) {
			toast(showError(e));
		}
	};

	return (
		<div className='flex flex-col h-screen w-screen rounded-xl overflow-hidden'>
			<TitleBar />

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
				<Suspense>
					<WorkspaceManager
						{...{
							workspaces,
							onAdd: addWorkspace,
							onRemove: (i: number) => setRemoveIndex(i)
						}}
					/>
				</Suspense>
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

#### How the pieces connect

- `showError` exists because Tauri errors arrive as strings OR nested objects (`{ Io: "..." }`); it digs out a message. Our `AppError` serializes to a plain string (§2.2), so the string branch is the one that usually fires — the object walk is for everything else that can reject an `invoke`.
- Clicking the ✕ in the manager does not remove anything. It stages a removal (`removeIndex`), which opens the dialog; confirming calls `handleRemove`, and a failure there becomes a toast rather than a silent nothing.
- `addWorkspace` and `removeWorkspace` are the hook's `add` and `remove`, renamed at the destructure. The names are the ones `App` keeps: in chapter 05 the same two names come from a different hook, one that also rescans projects, and every line that uses them stays as it is.
- **`AppInner` exists for one reason:** `useToast()` reads the context that `ToastProvider` provides, so it must be called *inside* the provider. `App` renders the provider; `AppInner` is the first component under it. In chapter 01 there was no provider, so there was no inner component — it appears in the chapter that gives it a job.
- `lazy` + `Suspense` put `WorkspaceManager` in its own chunk. It is the only component that pulls in the dialog plugin, so the main bundle never pays for it. Because the component is a default export, `lazy(() => import('./components/WorkspaceManager'))` is the whole line — no `.then(m => ({ default: m.X }))` shim. `<Suspense>` with no fallback is deliberate: the chunk is on local disk and loads in a millisecond, and the panel starts empty anyway; there is nothing to show while it arrives.
- `{...{ value, onChange }}` is the same as `value={value} onChange={onChange}` — a compact way to pass a bag of props when the names match. Used throughout DevGo for the components with several props.

> **Commit checkpoint** — the whole of §2.6 is one commit: the ambient types, the hook, the three components and the composed `App`, plus the two chapter-01 edits that moved the title-bar props out and the `index.css` keyframes.
>
> ```powershell
> git add -A
> git commit -m "✅REACT: useWorkspaces, WorkspaceManager, Toast, ConfirmDialog composed in App; props in types.d.ts"
> git push
> ```
>
> Then the opener clean-up described in §2.0, on its own:
>
> ```powershell
> git add -A
> git commit -m "✅CHORE: drop tauri-plugin-opener — shell covers it"
> git push
> ```

---

## 2.7 — Verify

```powershell
bun tauri dev
```

The window opens with the title bar and a **Workspaces** panel. Click **Add Folder**, pick a directory, and it appears in the list; restart the app and it is still there. Click ✕ and a dialog asks first; Escape or the backdrop cancels, **Remove** goes through. `%APPDATA%\app.zetta.devgo\workspaces.json` is a JSON array of the paths you picked.

In a second terminal:

```powershell
cd src-tauri
cargo check
```

Clean apart from the `Project` warnings §2.1 promised. `AppState` is managed and three commands are registered.

> **Commit checkpoint** — the backend persists workspaces and the UI edits them. Stage commit, then merge the chapter into `main`:
>
> ```powershell
> git add -A
> git commit -m "✅STAGE: 02 workspaces"
> git push
> git checkout main
> git merge 02.workspaces
> git push
> ```
>
> On the branch this stage commit is not empty: `Button.tsx` and the final shape of the four components, the hook and `types.d.ts` landed in it, after the verify pass above. The blocks printed in §2.6 are the tip's, so if you typed them as printed your stage commit has nothing to add.

---

## 2.8 — What you just built

```
.gitattributes                     ← LF in the repo (§2.0)
src/
├── App.tsx                        ← ToastProvider › AppInner: hook, dialog, panel
├── index.css                      ← (chapter 01) + the fade-in animation token
├── types.d.ts                     ← Project + every component's props
├── hooks/
│   └── useWorkspaces.ts           ← state + the three invokes
└── components/
    ├── TitleBar.tsx               ← (chapter 01; its props moved to types.d.ts)
    ├── TitleBarButton.tsx         ← (chapter 01; same)
    ├── Button.tsx                 ← the one button: primary / secondary / danger / ghost
    ├── WorkspaceManager.tsx       ← list + native folder picker
    ├── Toast.tsx                  ← ToastProvider (default) + useToast
    └── ConfirmDialog.tsx          ← Escape / backdrop / two mapped buttons
src-tauri/rustfmt.toml             ← max_width = 80 (§2.0)
src-tauri/src/
├── lib.rs                         ← setup: app data dir → WorkspaceStore → AppState
├── error.rs                       ← AppError: Io, Json
├── commands.rs                    ← AppState + get/add/remove_workspace
├── models/
│   ├── mod.rs
│   └── project.rs                 ← Project (constructed from chapter 03)
└── services/
    ├── mod.rs
    └── workspace.rs               ← WorkspaceStore: in memory, JSON on mutation
```

→ Next: [03 — Scanner](./03-scanner.md)
