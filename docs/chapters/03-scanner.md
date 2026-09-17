# 03 — The Scanner (Phase 2)

**Branch:** `03.scanner` — `git checkout 03.scanner` gives you this chapter's finished app; `git diff 02.workspaces 03.scanner` is exactly what this chapter adds.

**Starting from:** chapter 02 — a persisted workspace list you can edit from the window, and a `Project` type nothing constructs yet.

**Goal:** a filesystem scanner that turns each workspace into projects, one command that returns them all, and the React that shows them — a hook that owns the list, the search and the selection, a tree grouped by workspace you can drive with the arrow keys, and a search box.

> This is the chapter where the list appears, and it is also the chapter that leaves a deliberate hole. `get_projects` propagates the first read error it meets, which means one unplugged drive blanks the whole list. That is wrong, and it is left wrong on purpose: fixing it properly needs a cache and a rule about WSL that the app does not have the vocabulary for yet. Chapter 06 is that fix, and it is the rule the whole app is built around. Everything written here stays; the loop gains a cache lookup, and the scanner's return type grows a second outcome.

---

## 3.1 — Two more errors

Chapter 02's `AppError` has `Io` and `Json`. This chapter produces two failures neither of those describes, so the enum grows first. Add to `src-tauri/src/error.rs`, inside the enum after `Json`:

```rust
    #[error("Cannot access directory: {0}")]
    DirAccess(String),

    #[error("Internal lock poisoned: {0}")]
    Lock(String),
```

- **`DirAccess(String)`** — a workspace folder that could not be read, carrying *which* one. The scanner in §3.2 produces it.
- **`Lock(String)`** — a poisoned `Mutex`. Everything DevGo keeps in memory sits behind one (the workspace list, and later a cache and a preferences file), so "another thread panicked while holding this lock" gets a variant of its own rather than being flattened into whatever error is nearest. `get_projects` in §3.3 is the first command to return `AppError` and so the first to need it. (Chapter 06 adds a one-line helper so no command spells the `map_err` out by hand; the variant it maps to is this one.)

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: AppError gains DirAccess and Lock"
> git push
> ```

---

## 3.2 — Directory Scanner

The scanner turns a workspace path into a `Vec<Project>` by reading it one level deep. Create `src-tauri/src/services/scanner.rs`:

```rust
use crate::error::AppError;
use crate::models::Project;

fn detect_file_system(workspace: &str) -> &str {
    let normalized = workspace.replace('\\', "/");
    if normalized.starts_with("//wsl.localhost/")
        || normalized.starts_with("//wsl$/")
    {
        "WSL"
    } else {
        "Windows"
    }
}

pub fn scan_workspace(path: &str) -> Result<Vec<Project>, AppError> {
    let entries = std::fs::read_dir(path)
        .map_err(|_| AppError::DirAccess(path.to_string()))?;

    let fs_type = detect_file_system(path).to_string();

    let mut projects: Vec<Project> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let file_type = entry.file_type().ok()?;
            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden folders (.git, .vscode, .cache, ...) — they are
                // never projects and only clutter the list.
                if name.starts_with('.') {
                    return None;
                }
                let full_path = entry.path().to_string_lossy().to_string();
                Some(Project::new(
                    name,
                    full_path,
                    path.to_string(),
                    fs_type.clone(),
                ))
            } else {
                None
            }
        })
        .collect();

    projects.sort_by_key(|p| p.name.to_lowercase());
    Ok(projects)
}
```

### `map_err` for a friendlier error

`read_dir` fails with a raw `io::Error` ("Access is denied", "The system cannot find the path"). We `map_err` it into `AppError::DirAccess(path)` so the error names *which* folder is unreadable — more useful than a bare OS message. (We *don't* use a bare `?` here precisely because we want to swap the error, not pass it through.)

### `filter_map` — filter and map in one pass

`filter_map` keeps only the `Some(...)` results and drops the `None`s. Inside the closure, `?` operates on `Option`: `entry.ok()?` converts `Result<T, E>` → `Option<T>` and bails to `None` on error (skipping unreadable entries instead of failing the whole scan). We return `None` for files, hidden folders, and anything we can't read; `Some(project)` for real directories.

### `detect_file_system` — a string check, not a WSL check

A workspace path that normalizes to a `//wsl.localhost/` (or legacy `//wsl$/`) prefix lives in WSL; everything else is Windows. That is the whole function: it looks at the shape of a string and never talks to WSL, which is why it can exist a chapter before DevGo knows what a distro is. We compute `fs_type` once per workspace (all its projects share it) and `.clone()` it into each `Project` inside the closure. Chapter 04 gives the app a real picture of WSL; this tag is what the launcher in chapter 05 reads to decide how to open a project.

### Sorted A–Z, case-insensitively

`read_dir` returns entries in *filesystem order*, which on NTFS is roughly insertion order — not alphabetical. Without the sort, the list would look random. And because `Zebra` and `apple` sort differently depending on case (uppercase bytes come first in ASCII), we sort by the lowercased name so the order matches what a human expects. `sort_by_key` takes a closure that turns each element into the thing to compare — here a `String` — and does the comparing itself; clippy flags the longer `sort_by(|a, b| a.x.cmp(&b.x))` form and suggests this one. `projects` is `mut` for exactly that one line.

This is the chapter's first `Project::new` — the warnings chapter 02 promised go quiet here.

Update `src-tauri/src/services/mod.rs` to re-export the scanner function:

```rust
pub mod scanner;
pub mod workspace;

pub use scanner::scan_workspace;
pub use workspace::WorkspaceStore;
```

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: directory scanner (sorted, hidden-filtered, filesystem tag)"
> git push
> ```

---

## 3.3 — `get_projects`

Now expose it. Add to `src-tauri/src/commands.rs` — two imports at the top, and one command:

```rust
use crate::error::AppError;
use crate::models::Project;

#[tauri::command]
pub fn get_projects(state: State<AppState>) -> Result<Vec<Project>, AppError> {
    let store = state
        .workspace_store
        .lock()
        .map_err(|e| AppError::Lock(e.to_string()))?;
    let mut projects = Vec::new();
    for ws in store.list() {
        let mut found = crate::services::scan_workspace(&ws)?;
        projects.append(&mut found);
    }
    projects.sort_by_key(|p| p.name.to_lowercase());
    Ok(projects)
}
```

### `get_projects` scans *all* workspaces

The frontend calls `get_projects()` with **no arguments** — the backend owns the workspace list, so it loops over `store.list()`, scans each, and appends. We sort the combined list again (each workspace was sorted, but the concatenation isn't). One command, one round trip, the whole project list.

It returns `Result<_, AppError>` where the workspace commands returned `Result<_, String>`, because `scan_workspace` produces a rich `AppError::DirAccess` we want to preserve. The poisoned-lock case maps to `Lock` — the variant §3.1 added for it.

### The `?` on the scan is the hole

Look at the loop. There is a `?` on `scan_workspace`, and it means: if any workspace fails to read, `get_projects` returns `Err` and the frontend renders *nothing at all*. Say you have three workspaces and the external drive holding the second one is unplugged. Two perfectly healthy workspaces vanish because a third is temporarily absent. That is the difference between "this list is slightly incomplete" and "DevGo is broken." The user reads the second one, and they aren't wrong to.

It stays for now because the right answer is not "skip it". The right answer is "show what we saw there last time, say that it is stale, and look again shortly" — and that needs a cache, a per-workspace verdict the UI can render, and a rule about which workspaces may be read at all. Chapter 06 builds all three. The loop keeps its shape; it gains a `match` on a second outcome.

Register the command in `src-tauri/src/lib.rs`:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::get_projects
        ])
```

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: get_projects across all workspaces"
> git push
> ```

---

## 3.4 — Types first

Three components arrive in this chapter, and every one of their prop shapes goes into `src/types.d.ts` — plus the one handle type the tree exposes to its parent. Add:

```ts
interface SearchBoxProps {
	value: string;
	onChange: (v: string) => void;
	onEnter?: () => void;
	onArrow?: (dir: 1 | -1) => void;
	enterHint?: string;
}

interface ProjectTreeHandle {
	navigate: (dir: 1 | -1) => void;
}

interface ProjectTreeProps {
	projects: Project[];
	selected: Project | null;
	onSelect: (p: Project) => void;
	loading?: boolean;
	ref?: React.Ref<ProjectTreeHandle>;
}
```

There is no `query` on the tree's props: the search box owns the query and the tree receives the already-filtered list. A prop nothing reads is a promise to a later chapter; it arrives in the chapter that uses it.

`ref` is an ordinary prop on `ProjectTreeProps` — React 19 passes `ref` to function components like any other prop, so there is no `forwardRef` wrapper anywhere in this book. `ProjectTreeHandle` is what the parent gets to call through that ref: one method, `navigate`, added in §3.7.

---

## 3.5 — `useProjects`

This hook owns the project list, the search query, the selection, and loading state. Create `src/hooks/useProjects.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export const useProjects = () => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<Project | null>(null);
	const [loading, setLoading] = useState(true);

	const refresh = async () => {
		setLoading(true);
		try {
			const p = await invoke<Project[]>('get_projects');
			setProjects(p);
			return p;
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		refresh();
	}, []);

	const q = query.trim().toLowerCase();
	const filtered = q
		? projects.filter(p => p.name.toLowerCase().includes(q))
		: projects;

	return {
		projects,
		filtered,
		query,
		setQuery,
		selected,
		setSelected,
		refresh,
		loading
	};
};
```

### `get_projects` takes no arguments

The backend owns the workspace list and scans them all, so the frontend just calls `invoke<Project[]>('get_projects')` — no `workspacePath` to pass. One call, the whole sorted list. `refresh` also *returns* the list it fetched; nothing reads the return value yet, and chapter 08 does.

### `filtered` is a plain derived value

`filtered` is *derived* from `projects` + `query` — a `const` computed on the way out. The React Compiler sees that it depends on exactly those two and re-runs the filter only when one of them changes, which is what a hand-written `useMemo(…, [projects, query])` used to say out loud. Here we filter by project name, case-insensitively; an empty query short-circuits to the full list.

### `loading` with `try/finally`

`setLoading(true)` before the scan, `setLoading(false)` in a `finally` so it resets even if `get_projects` throws. The `ProjectTree` uses this to show its `Scanning workspaces...` line. There is no `catch`: a rejected `get_projects` is left unhandled — see §3.9 for what that looks like, and chapter 06 for the fix.

> **Note for later:** chapter 06 extends this exact hook — `refresh` will take a `force` flag and return a payload, the hook will track per-workspace status, and a bounded retry will heal a workspace that shows up late. Chapter 08 adds the restore of the last-selected project. All additions to the same file. For now, plain selection is enough.

---

## 3.6 — SearchBox

A controlled input that filters as you type and forwards arrow/enter keys to the parent. Create `src/components/SearchBox.tsx`:

```tsx
import type { KeyboardEvent } from 'react';
import Button from './Button';

const SearchBox = ({
	value,
	onChange,
	onEnter,
	onArrow,
	enterHint
}: SearchBoxProps) => {
	const keys: Record<string, (() => void) | undefined> = {
		ArrowDown: () => onArrow?.(1),
		ArrowUp: () => onArrow?.(-1),
		Enter: onEnter
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		const action = keys[e.key];
		if (!action) return;
		e.preventDefault();
		action();
	};

	return (
		<div className='shrink-0'>
			<label className='block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2'>
				Search Projects
			</label>
			<div className='relative bg-bg-panel rounded-lg border border-border focus-within:border-accent transition-colors'>
				<input
					type='text'
					className='w-full py-2.5 pl-3.5 pr-20 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted'
					placeholder='Type to filter...'
					value={value}
					onChange={e => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
				/>
				<div className='absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5'>
					{value && (
						<Button
							variant='ghost'
							className='text-text-secondary'
							onClick={() => onChange('')}
						>
							&#10005;
						</Button>
					)}
					{enterHint && (
						<span className='text-[10px] text-text-muted px-1.5 py-0.5 border border-border rounded'>
							{enterHint}
						</span>
					)}
				</div>
			</div>
		</div>
	);
};

export default SearchBox;
```

### Keyboard forwarding

The input is where focus lives, so it's the natural place to catch keys. `keys` maps each key the box cares about to what it does: `ArrowDown`/`ArrowUp` call `onArrow?.(1 | -1)` (moving the selection in the list below), `Enter` calls `onEnter`. `handleKeyDown` looks the key up and, if there is an action, prevents the default (so arrows don't move the text cursor) and runs it. A key with no entry — or `Enter` while `onEnter` is undefined — falls through untouched. The `?.` optional-call means the box works even if a parent doesn't pass `onArrow`; `App` passes no `onEnter` until chapter 05 gives Enter something to do.

Three `if`s that each do "prevent, call" became one lookup — that is the map-don't-repeat rule applied to handlers rather than elements.

### Controlled input + affordances

`value`/`onChange` make this a controlled component — the parent owns the query string. A clear (`✕`) `ghost` `Button` appears only when there's text, and an optional `enterHint` chip (`⏎ Enter`) hints that pressing Enter does something.

---

## 3.7 — ProjectTree

This is the centerpiece: projects grouped under collapsible workspace headers, with a header row of columns, and keyboard navigation the parent can drive through a ref. Create `src/components/ProjectTree.tsx`:

```tsx
import { useEffect, useImperativeHandle, useState } from 'react';

const col = 'grid grid-cols-[1fr_1fr_80px_52px] items-center text-sm';

const COLUMNS = [
	{ label: 'Workspace', className: '' },
	{ label: 'Location', className: '' },
	{ label: 'File System', className: '' },
	{ label: 'Count', className: 'text-right' }
];

const lastSegment = (path: string) =>
	path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;

const ProjectTree = ({
	projects,
	selected,
	onSelect,
	loading,
	ref
}: ProjectTreeProps) => {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const grouped = new Map<string, Project[]>();
	for (const p of projects) {
		const existing = grouped.get(p.workspace) ?? [];
		existing.push(p);
		grouped.set(p.workspace, existing);
	}

	const visible: Project[] = [];
	for (const [ws, wsProjects] of grouped) {
		if (!collapsed.has(ws)) visible.push(...wsProjects);
	}

	const navigate = (dir: 1 | -1) => {
		const idx = visible.findIndex(p => p.full_path === selected?.full_path);
		const next = idx === -1 ? visible[0] : visible[idx + dir];
		if (next) onSelect(next);
	};

	useImperativeHandle(ref, () => ({ navigate }));

	useEffect(() => {
		const handler = (e: globalThis.KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement) return;
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				navigate(1);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				navigate(-1);
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [navigate]);

	const toggle = (ws: string) => {
		setCollapsed(prev => {
			const next = new Set(prev);
			if (next.has(ws)) next.delete(ws);
			else next.add(ws);
			return next;
		});
	};

	if (loading) {
		return (
			<div className='flex-1 flex items-center justify-center text-sm text-text-muted'>
				<span className='animate-spin text-lg mr-2'>&#9696;</span>
				Scanning workspaces...
			</div>
		);
	}

	if (projects.length === 0) {
		return (
			<div className='flex-1 flex items-center justify-center text-sm text-text-muted'>
				No projects found. Add a workspace to begin.
			</div>
		);
	}

	const workspaces = [...grouped.entries()];

	return (
		<div className='flex-1 flex flex-col min-h-0'>
			<div
				className={`${col} px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-text-primary bg-bg-hover/30 rounded-t-md shrink-0 border-b border-border`}
			>
				{COLUMNS.map(({ label, className }) => (
					<div key={label} className={className}>
						{label}
					</div>
				))}
			</div>

			<div className='flex-1 overflow-y-auto'>
				{workspaces.map(([ws, wsProjects]) => {
					const isOpen = !collapsed.has(ws);
					const count = wsProjects.length;
					const fs = wsProjects[0]?.file_system ?? 'Windows';

					return (
						<div key={ws}>
							<div
								className={`${col} px-3 py-2 cursor-pointer hover:bg-bg-hover/50 select-none`}
								onClick={() => toggle(ws)}
								title={ws}
							>
								<div className='flex items-center gap-2 text-text-secondary min-w-0'>
									<span
										className={`text-xs shrink-0 ${isOpen ? 'text-accent' : 'text-text-muted'}`}
									>
										{isOpen ? '▼' : '▶'}
									</span>
									<span className='truncate font-semibold text-text-primary'>
										{lastSegment(ws)}
									</span>
								</div>
								<div className='text-text-muted truncate' title={ws}>
									{ws}
								</div>
								<div
									className={`font-medium ${fs === 'WSL' ? 'text-accent' : 'text-text-muted'}`}
								>
									{fs}
								</div>
								<div className='text-right text-text-muted font-mono'>
									{count}
								</div>
							</div>

							{isOpen &&
								wsProjects.map(project => {
									const isSelected =
										selected?.full_path === project.full_path;
									return (
										<div
											key={project.full_path}
											className={`${col} ml-6 px-3 py-1.5 cursor-pointer select-none transition-colors border-l border-border ${
												isSelected
													? 'bg-bg-selected text-text-primary border-l-accent'
													: 'text-text-secondary hover:bg-bg-hover/50 border-l-transparent'
											}`}
											onClick={() => onSelect(project)}
										>
											<div
												className='truncate text-text-muted'
												title={project.workspace}
											>
												{lastSegment(project.workspace)}
											</div>
											<div
												className={`font-medium font-mono truncate ${isSelected ? 'text-text-primary' : ''}`}
											>
												{project.name}
											</div>
											<div
												className={
													project.file_system === 'WSL'
														? 'text-accent'
														: 'text-text-muted'
												}
											>
												{project.file_system}
											</div>
											<div />
										</div>
									);
								})}
						</div>
					);
				})}
			</div>
		</div>
	);
};

export default ProjectTree;
```

### Grouping with a `Map`

`grouped` builds a `Map<workspace, Project[]>` from the flat `projects` list. `grouped.get(p.workspace) ?? []` gets-or-creates the bucket. It is a plain loop at the top of the render; the compiler caches the result against `projects`, so the regroup only happens when the list changes. The `col` constant is a shared CSS grid template so the header row and every data row line up in four columns — and the header row's four cells are one `<div>` mapped over `COLUMNS`. This is what `Project.workspace` is for.

### `ref` is a prop, `useImperativeHandle` fills it

`ref` arrives destructured with the other props — React 19, no `forwardRef`. `useImperativeHandle(ref, () => ({ navigate }))` — no dependency array; the compiler tracks what `navigate` closes over — is what the parent gets when it reads `treeRef.current`: a `ProjectTreeHandle`. That's how the `SearchBox` (which has focus) can move the tree's selection — `App` forwards the box's arrow keys into `treeRef.current.navigate(dir)`. Meanwhile the `window` keydown listener handles arrows when focus is *not* in the input (`e.target instanceof HTMLInputElement` is the guard, so the two paths never both fire). Two input paths, one `navigate`. Enter joins this handler in chapter 05, when there is something to launch.

The listener's event is `globalThis.KeyboardEvent` — the DOM one — because a `window` listener receives DOM events, not React's synthetic `KeyboardEvent`. `SearchBox` imports React's; this file needs the global. Naming it explicitly is what keeps TypeScript from picking the wrong one.

### `visible` — only what you can actually see

Arrow keys should skip projects hidden inside collapsed workspaces. `visible` flattens only the *expanded* groups, in display order. `navigate` finds the current selection's index in `visible` and moves `±1`; if nothing's selected it picks the first item. All three — `grouped`, `visible`, `navigate` — are plain code; the compiler memoizes each against what it reads. The keyboard effect lists `[navigate]`, and because the compiler gives `navigate` a new identity only when `visible`, `selected` or `onSelect` change, the listener is re-attached exactly when it needs to be.

### Hooks above the early returns

Every hook — `useState`, `useImperativeHandle`, `useEffect` — sits above `if (loading)` and `if (projects.length === 0)`. Same rule as `ConfirmDialog` in chapter 02: hooks run in the same order every render, so nothing conditional may come before them. `toggle` and `workspaces` are plain values and can go anywhere.

### `collapsed` as a `Set`

Collapse state is a `Set<string>` of workspace paths. `toggle` clones the set (never mutate state in place), flips membership, and returns it. A workspace is open when it's *not* in the set — so everything starts expanded (empty set). For now collapsing is entirely manual; chapter 08 makes the tree tidy itself around the selected project.

### `lastSegment`

Workspace headers show `lastSegment(ws)` (the folder name, `dev`) big, and the full path (`C:\dev`) muted beside it. `lastSegment` strips trailing slashes and takes the final path component. It is a plain function outside the component — it closes over nothing, so it need not be recreated per render. Each project row shows its filesystem badge (accent-colored for WSL — the tag from §3.2, rendered) and highlights when selected; `isSelected` is computed once per row and used twice.

---

## 3.8 — App composition

`src/App.tsx` gains the hook, the two components, and the bridge between them. The workspace panel stays where chapter 02 put it, above the list. The whole file, with the chapter-02 parts unchanged:

```tsx
import { lazy, Suspense, useRef, useState } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import ProjectTree from './components/ProjectTree';
import SearchBox from './components/SearchBox';
import TitleBar from './components/TitleBar';
import ToastProvider, { useToast } from './components/Toast';
import { useProjects } from './hooks/useProjects';
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
	const { filtered, query, setQuery, selected, setSelected, loading } =
		useProjects();
	const { toast } = useToast();
	const [removeIndex, setRemoveIndex] = useState<number | null>(null);

	const treeRef = useRef<ProjectTreeHandle>(null);
	const handleArrow = (dir: 1 | -1) => treeRef.current?.navigate(dir);

	const handleSelect = (p: Project) => setSelected(p);

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
				<SearchBox
					{...{
						value: query,
						onChange: setQuery,
						onArrow: handleArrow
					}}
				/>
				<ProjectTree
					{...{
						ref: treeRef,
						projects: filtered,
						selected,
						onSelect: handleSelect,
						loading
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

- `useProjects` owns the list/query/selection. `filtered` — not `projects` — is what the tree renders, so typing narrows it.
- `treeRef` + `handleArrow` bridge the `SearchBox`'s arrow keys into `ProjectTree.navigate` — arrow while typing still moves the list. `ref` goes in the spread with the other props, because it *is* one.
- `handleSelect` is one line now. It is a named function rather than `setSelected` passed straight through because chapter 08 gives `setSelected` a second job inside the hook.

One thing is missing, and you will notice it the first time you add a workspace: the list does not rescan. `useWorkspaces` updates its own list, but nothing tells `useProjects` to look again. Chapter 05 replaces the add/remove wiring with a hook that does both, which is why those two names were chosen in chapter 02.

> **Commit checkpoint** — §3.4 to §3.8 are one commit: the types, the hook, the two components and the composed `App`.
>
> ```powershell
> git add -A
> git commit -m "✅REACT: useProjects, SearchBox, ProjectTree (ref as a prop) composed in App"
> git push
> ```

---

## 3.9 — Verify

```powershell
bun tauri dev
```

With a workspace added in chapter 02, the projects appear grouped under it, sorted, hidden folders filtered, with a Windows badge on each row. Type in the search box and the list narrows; arrow keys move the highlight, in the box and out of it; click a workspace header to fold it. Add a second workspace and restart to see it scanned.

Now the hole, so you have seen it before chapter 06 closes it: add a workspace on a USB drive, unplug the drive, restart. The list is empty — `No projects found. Add a workspace to begin.` — and the other workspaces are gone with it. Nothing on screen says why: `useProjects` has no `catch`, so the `Cannot access directory: E:\...` error only reaches the devtools console as an unhandled rejection. `App` toasts only a failed *remove*; a failed scan has no toast yet.

`cargo check` from `src-tauri/` is clean — the `Project` warnings from chapter 02 are gone, and `DirAccess` and `Lock` are both constructed.

> **Commit checkpoint** — the backend scans, the UI lists. Stage commit, then merge the chapter into `main`:
>
> ```powershell
> git add -A
> git commit -m "✅STAGE: 03 scanner"
> git push
> git checkout main
> git merge 03.scanner
> git push
> ```

---

## 3.10 — What you just built

```
src-tauri/src/
├── error.rs          ← + DirAccess, Lock
├── commands.rs       ← + get_projects
└── services/
    └── scanner.rs    ← scan_workspace(): one level deep, sorted, hidden-filtered, file_system tag
src/
├── types.d.ts                 ← + SearchBoxProps, ProjectTreeHandle, ProjectTreeProps
├── hooks/
│   └── useProjects.ts         ← scan + search + select
└── components/
    ├── SearchBox.tsx          ← controlled input, key → action map
    └── ProjectTree.tsx        ← grouped, collapsible, keyboard-driven; ref as a prop
```

What evolves from here, and where: `scan_workspace` gains two parameters and a second outcome (chapter 06); `get_projects` gains a cache and stops using `?` (chapter 06); `useProjects.refresh` gains a `force` flag (chapter 06) and a restore step (chapter 08); `ProjectTree` gains a launch on Enter and double-click (chapter 05), a status pill (chapter 06) and auto-collapse (chapter 08). Additions, every one.

→ Next: [04 — WSL Detection](./04-wsl.md)

→ Appendix: [Rust Concepts](./appendix/rust-concepts.md)
