# 15 — Quick Actions & Paths (Slice 6)

**Branch:** `15.quick-actions` — `git checkout 15.quick-actions` gives you this chapter's finished app; `git diff 14.intelligence 15.quick-actions` is exactly what this chapter adds.

**Starting from:** Slice 5 — every project carries stack badges, a package manager and a dependency marker. DevGo can tell you what a project is and launch it three ways. What it cannot do is any of the small things you leave the launcher *for*: open the folder in Explorer, hand a path to another tool, or tell you a project lives somewhere slow.

**Goal:** a right-click menu on every project — reveal in Explorer, copy the Windows path, copy the WSL path, plus the open actions and pin — the three new actions also on the keyboard, and a warning on projects that sit on a network share.

> **Hold on to:**
> 1. **Check the platform before adding to it.** The clipboard is `navigator.clipboard`: the webview is already a secure context and every copy is already a gesture. A plugin and a capability grant would buy nothing this feature needs.
> 2. **The target belongs in the argument, not in shared state**, when two triggers disagree about "which thing". The button means `selected`; the menu means the row under the cursor; `project ?? selected` serves both.
> 3. **A menu that shows keyboard hints reads them from the same place the keys are bound.** Chapter 11's table gets three rows and the handler, the button hints, the Settings panel *and* the menu all move together.
> 4. **A launcher that already decides does not also need to advise.** Most of "filesystem intelligence" would restate DevGo's own routing on every row; the piece that survives is the one case the routing gets wrong — a slow share — flagged only when it is true.
>
> No new Rust concepts. The two commands are `Command::new("explorer").spawn()` and chapter 05's `windows_to_wsl_path` behind a command.

> This is the shortest slice in the plan by a wide margin, and the reason is the point of the chapter: **almost none of it is new capability.** Reveal is `explorer.exe` on a path you already store. Copy-WSL-path is chapter 05's converter with `.writeText` bolted on. The slow-filesystem warning is one more branch in chapter 03's `detect_file_system`. The shortcuts are three rows in chapter 11's table. Every piece is leverage over infrastructure two-to-twelve chapters old — so the chapter is really about restraint, because when a feature is this cheap the only way to get it wrong is to add weight it does not need.

---

## 15.1 — Two commands, both thin wrappers

In `src-tauri/src/commands.rs`, above `open_remote`:

```rust
/// Open the folder in Explorer. Works for WSL projects too: the UNC path is
/// what Explorer wants. Boots the distro, but the user asked for that.
#[tauri::command]
pub fn reveal_in_explorer(project: Project) -> Result<(), AppError> {
    // explorer.exe exits 1 even on success, so don't wait on it
    std::process::Command::new("explorer")
        .arg(&project.full_path)
        .spawn()
        .map_err(|e| AppError::LaunchFailed(format!("explorer: {e}")))?;
    Ok(())
}
```

**One path opens both worlds.** A WSL project's `full_path` is the `\\wsl.localhost\…` UNC form — chapter 03 stored it that way exactly so Windows tools could point at it. No `is_wsl` branch, no conversion, no distro lookup. The one thing that made WSL projects hard everywhere else — that they live behind a 9p file server — is the one thing that makes them trivial here, because Explorer *is* a Windows file browser and the UNC path is what it wants.

**The liveness gate does not apply, and the doc comment says why.** Every other WSL touch in DevGo — the scanner (06), git (10), badges (14) — refuses a stopped distro. Reveal is different in kind: the user *asked* to open this folder. Booting the distro is the thing they requested, not a side effect of DevGo's curiosity. The reflex built over eight chapters is *never touch a stopped distro*, and this is the deliberate exception, so it is written down where the code is.

The exit-code comment looks like superstition until it bites you: Explorer returns `1` in many ordinary cases, so a version that checked `.status()` would report failure on a reveal that worked. `.spawn()` does not wait, so the only failure it can surface is "could not start explorer.exe at all", which is the only one worth surfacing.

```rust
/// The path as WSL sees it. The Windows path is just full_path, which the
/// frontend already has.
#[tauri::command]
pub fn get_wsl_path(
    project: Project,
    state: State<AppState>,
) -> Result<String, AppError> {
    // a windows path ignores the distro, so the fallback is never read there
    let distro = match crate::services::scanner::distro_of(&project.full_path) {
        Some(d) => d,
        None => state
            .runtime_info
            .lock()
            .map_err(lock_err)?
            .default_distro
            .clone()
            .unwrap_or_default(),
    };
    Ok(crate::services::platform::paths::windows_to_wsl_path(
        &project.full_path,
        &distro,
    ))
}
```

**There is no `get_windows_path` command**, because the Windows path is `project.full_path`, which the frontend already holds for every row. A command to hand back a value the caller already has is a round trip to learn nothing. Only the transformation needs the backend, and the transformation is chapter 05's `windows_to_wsl_path`, untouched. The only new logic is picking the distro: a WSL path names it (`distro_of`); a Windows path has none and does not need one — `windows_to_wsl_path` converts `G:\…` to `/mnt/g/…` without reading the distro argument. `unwrap_or_default()` to `""` is not a guess that could be wrong; it is a value that is never read.

Register both in `lib.rs` after `commands::open_remote`.

---

## 15.2 — Copy without a plugin

Tauri ships `tauri-plugin-clipboard-manager`. Reaching for it is the obvious move: the Rust plugin, the JS package, a `clipboard-manager:allow-write-text` line in `capabilities/default.json`. Three files and a permission grant, to put a string on the clipboard.

DevGo does none of that. In `App.tsx`, after the three launch wrappers:

```tsx
	const revealInExplorer = (p: Project) => {
		invoke('reveal_in_explorer', { project: p }).catch(e =>
			toast(showError(e))
		);
	};

	// secure context + user gesture, so no clipboard plugin needed
	const copyText = async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast(`Copied ${label}`, 'success');
		} catch {
			toast('Could not copy to clipboard', 'error');
		}
	};

	const copyWindowsPath = (p: Project) => copyText(p.full_path, 'Windows path');

	const copyWslPath = async (p: Project) => {
		try {
			const wsl = await invoke<string>('get_wsl_path', { project: p });
			await copyText(wsl, 'WSL path');
		} catch (e) {
			toast(showError(e));
		}
	};
```

The whole clipboard feature is `navigator.clipboard.writeText`. It works because the two conditions the API demands are both met without effort: the webview is a **secure context**, and every path that reaches `copyText` starts with a **user gesture**. Neither is a thing you arrange; they are properties of where this code runs. The plugin earns its keep when you need to *read* the clipboard, or write from Rust with no window focused — none of which this feature does.

The `try/catch` is not padding. `writeText` genuinely can reject, and the failure mode without the catch is the worst kind: the user clicks "copy", nothing lands, nothing says so, and they paste last hour's clipboard into a terminal. `copyWslPath` has its own `try/catch` around the `invoke`, because that call fails for reasons the clipboard cannot, and those want the backend's message rather than "could not copy". Two failure surfaces, two messages. `revealInExplorer` is invoke-and-forget with a toast only on failure — the Explorer window is its own confirmation.

---

## 15.3 — Three rows in a table you already have

`ShortcutId` in `types.d.ts` gains `'revealExplorer' | 'copyWinPath' | 'copyWslPath'`, and `SHORTCUTS` in `shortcuts.ts` gains three rows in the Project group, above `togglePin`:

```ts
	{
		id: 'revealExplorer',
		keys: 'Ctrl+Shift+E',
		label: 'Reveal in Explorer',
		group: 'Project',
		needsSelection: true
	},
	{
		id: 'copyWinPath',
		keys: 'Ctrl+Shift+C',
		label: 'Copy Windows path',
		group: 'Project',
		needsSelection: true
	},
	{
		id: 'copyWslPath',
		keys: 'Ctrl+Shift+W',
		label: 'Copy WSL path',
		group: 'Project',
		needsSelection: true
	},
```

Three rows, and everything else follows. The three new shortcuts **appear in Settings → Shortcuts** with no second edit, grouped under Project with the "· needs a selection" note, because the panel iterates the same array the handler binds from. The keys are mnemonic — **E**xplorer, **C**opy, **W**SL — and they are chords rather than bare letters for chapter 11's reason: summon leaves focus in the search box. `Ctrl+Shift+E` also proves chapter 11's exact matching the other way round: `Ctrl+Enter` never fires on it, and it never fires on `Ctrl+E`.

Binding them is three lines in the handler, after the open actions:

```tsx
			if (fire('openBoth', handleOpenBoth)) return;
			if (fire('revealExplorer', () => revealInExplorer(selected))) return;
			if (fire('copyWinPath', () => copyWindowsPath(selected))) return;
			if (fire('copyWslPath', () => copyWslPath(selected))) return;
```

Indistinguishable in shape from the three above them, which is what a house pattern buys.

---

## 15.4 — A menu acts on the row, not the selection

Chapter 13's `openEditor` and `openTerminal` in `useLaunchActions` acted on `selected`. That is right for a shortcut and a button, both of which mean "the selected project". It is wrong for a context menu, which means "the project I right-clicked". Those are *usually* the same — right-clicking selects — but "usually" is a race: selection is a `setState`, the menu action fires from a click handler, and betting that React has re-rendered in between is betting on timing.

```ts
	// buttons and shortcuts act on the selection, a context menu on its own row
	const openEditor = (project?: Project) => {
		const p = project ?? selected;
		if (!p) return Promise.resolve();
		// targetId omitted means "use the default", resolved on the Rust side so
		// the fallback chain lives in one place.
		return invoke('open_editor', { project: p, targetId: null });
	};

	const openTerminal = (project?: Project) => {
		const p = project ?? selected;
		if (!p) return Promise.resolve();
		return invoke('open_terminal', { project: p, targetId: null });
	};
```

`(project?: Project)` with `project ?? selected` is the whole change, and it is backward-compatible by construction: every existing caller passes nothing. `openBoth` already had this shape from chapter 05, which is why it needed no edit.

---

## 15.5 — A dumb menu, and where the actions live

Props first, in `types.d.ts`:

```ts
interface MenuAction {
	label: string;
	hint?: string;
	onClick: () => void;
	danger?: boolean;
	disabled?: boolean;
}

type MenuEntry = MenuAction | 'separator';

interface ContextMenuProps {
	x: number;
	y: number;
	items: MenuEntry[];
	onClose: () => void;
}
```

`ProjectTreeProps` and `ProjectRowProps` both gain `onContextMenu?: (p: Project, x: number, y: number) => void`. Then `src/components/ContextMenu.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import Button from './Button';

const ROW_H = 30;
const WIDTH = 256;

// renders what it is given and owns none of it; the actions live in App
const ContextMenu = ({ x, y, items, onClose }: ContextMenuProps) => {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const away = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('mousedown', away);
		window.addEventListener('keydown', esc);
		return () => {
			window.removeEventListener('mousedown', away);
			window.removeEventListener('keydown', esc);
		};
	}, [onClose]);

	// keep the whole menu on screen
	const style: React.CSSProperties = {
		top: Math.max(
			8,
			Math.min(y, window.innerHeight - 8 - items.length * ROW_H)
		),
		left: Math.max(8, Math.min(x, window.innerWidth - 8 - WIDTH))
	};

	return (
		<div
			ref={ref}
			className='fixed z-50 w-64 bg-bg-secondary border border-border rounded-lg shadow-2xl py-1 text-sm'
			style={style}
			onContextMenu={e => e.preventDefault()}
		>
			{items.map((item, i) =>
				item === 'separator' ? (
					<div key={`sep-${i}`} className='my-1 border-b border-border' />
				) : (
					<Button
						key={item.label}
						variant='ghost'
						className={`w-full rounded-none px-3 py-1.5 text-sm ${
							item.danger ? 'hover:bg-danger/10' : ''
						}`}
						disabled={item.disabled}
						onClick={() => {
							item.onClick();
							onClose();
						}}
					>
						<span
							className={`flex w-full items-center justify-between gap-6 ${
								item.danger ? 'text-danger' : ''
							}`}
						>
							<span className='truncate'>{item.label}</span>
							{item.hint && (
								<span className='font-mono text-[10px] text-text-muted shrink-0'>
									{item.hint}
								</span>
							)}
						</span>
					</Button>
				)
			)}
		</div>
	);
};

export default ContextMenu;
```

The menu is **dumb**. It takes `items` and renders them; it does not know what "reveal" means or which project it applies to. That knowledge lives in `App`, next to the keyboard handler that also triggers those actions — one place says what "reveal" does, and both the menu and `Ctrl+Shift+E` call into it. The dismissal wiring is chapter 12's popover, copied deliberately: a menu you cannot get rid of by clicking away feels broken.

Two details are worth naming. The rows are `Button` ghosts, with the label/hint pair inside a `<span>` that does its own `justify-between` — the base `justify-center` cannot be overridden from `className` (chapter 11's class-order lesson), but a child element lays itself out however it likes. And the menu has a **fixed width** (`w-64`, and the clamp knows it) rather than `min-w-52`: a shrink-to-fit `fixed` box whose children are `w-full` resolves its width to *all the space to the right of the cursor* — a right-click at the left of the window opens a menu 475 pixels wide. A fixed width is the honest answer for a menu whose contents are known.

The corner clamp is the one piece of real logic: a right-click near the bottom or right edge would otherwise open a menu that runs off screen. `ROW_H = 30` is an estimate, not a measurement — good enough to keep it on screen, not worth a layout pass.

### `buildMenu`

Back in `App.tsx`, `prettyKeys` joins the shortcut imports, and beside the copy helpers:

```tsx
	// hints come from the shortcut table so the menu can't lie about the keys
	const [menu, setMenu] = useState<{
		project: Project;
		x: number;
		y: number;
	} | null>(null);
	const buildMenu = (p: Project): MenuEntry[] => {
		const hint = (id: ShortcutId) => prettyKeys(shortcutFor(id));
		const remote = git.get(p.full_path)?.remote;
		const pinned = ranks.get(p.full_path)?.pinned ?? false;
		return [
			{
				label: 'Open in editor',
				hint: hint('openEditor'),
				onClick: () => openEditor(p).catch(e => toast(showError(e)))
			},
			{
				label: 'Open terminal',
				hint: hint('openTerminal'),
				onClick: () => openTerminal(p).catch(e => toast(showError(e)))
			},
			{ label: 'Open both', hint: hint('openBoth'), onClick: () => handleLaunch(p) },
			'separator',
			{
				label: 'Reveal in Explorer',
				hint: hint('revealExplorer'),
				onClick: () => revealInExplorer(p)
			},
			{
				label: 'Copy Windows path',
				hint: hint('copyWinPath'),
				onClick: () => copyWindowsPath(p)
			},
			{
				label: 'Copy WSL path',
				hint: hint('copyWslPath'),
				onClick: () => copyWslPath(p)
			},
			...(remote
				? [{ label: 'Open remote', onClick: () => handleOpenRemote(p) }]
				: []),
			'separator',
			{
				label: pinned ? 'Unpin' : 'Pin to top',
				hint: hint('togglePin'),
				onClick: () => handleTogglePin(p)
			}
		];
	};
```

Every action passes `p` explicitly — which is what §15.4 was for. `hint(id)` reads chapter 11's table through `prettyKeys` and `shortcutFor`, so the menu's `Reveal in Explorer · Ctrl+Shift+E` and the actual binding cannot disagree. **A menu that shows keyboard hints must read them from the same place the keys are bound, or it becomes a second, lying source of truth.**

Two entries are conditional, and both conditions are about honesty. **"Open remote" only appears when there is a remote** — spread out of the array entirely rather than shown disabled, because a greyed-out item implies "this could work if something were different", and its absence says "this project has no remote". **"Pin" becomes "Unpin"** from chapter 09's rank: one item, two labels, one toggle.

The menu renders above the dialogs, and the tree is told how to open it:

```tsx
			{menu && (
				<ContextMenu
					{...{
						x: menu.x,
						y: menu.y,
						items: buildMenu(menu.project),
						onClose: () => setMenu(null)
					}}
				/>
			)}
```

```tsx
						onContextMenu: (p: Project, x: number, y: number) =>
							setMenu({ project: p, x, y })
```

`items: buildMenu(menu.project)` rebuilds the list from the project the menu was opened over, so Pin/Unpin and the presence of Open remote are computed for *that* project, at render.

In `ProjectTree`, `onContextMenu` threads through `rowProps` to `ProjectRow`, which gains one handler beside `onClick` and `onDoubleClick`:

```tsx
		// select first so the menu and the keyboard agree on the row
		onContextMenu={e => {
			e.preventDefault();
			onSelect(project);
			onContextMenu?.(project, e.clientX, e.clientY);
		}}
```

`onSelect(project)` runs so that after you close the menu, the keyboard is on the row you just acted on — the mouse and keyboard cursors stay in agreement. Because `ProjectRow` is the one row component both the Pinned strip and the tree render (chapter 09), the menu works in both places from one handler.

> **Commit checkpoints** — each piece as it lands, on the branch: the two commands (`✅LAUNCHER: reveal in explorer command`, `✅LAUNCHER: get_wsl_path`), then `✅UI: open editor and terminal take a project`, `✅UI: copy path shortcuts` (the table rows, the helpers, the three handler lines), `✅UI: context menu` (the component, unused for one commit), `✅UI: right click menu on rows` (`buildMenu`, the state, the row handler), and — because the first screenshot caught a menu 475 pixels wide — `✅FIX: context menu width`. A fix found in verification is its own commit; it is the most honest line in the log.

---

## 15.6 — Filesystem intelligence, mostly by not building it

The plan's "Filesystem Intelligence" section lists eight items: detect NTFS, detect WSL ext4, detect mounted drives, detect network drives, recommend the best runtime, warn about slow filesystems, convert paths, normalize paths. Two were already done (ext4 detection in chapter 03, path conversion in chapter 04). Of the remaining six, this slice ships **two**, and the interesting part is the four it does not.

`src-tauri/src/services/platform/paths.rs` gains the normaliser:

```rust
/// Forward slashes, no trailing separator. windows_to_wsl_path keeps its own
/// replace: it needs the trailing slash on a drive root.
pub fn normalize(path: &str) -> String {
    let forward = path.replace('\\', "/");
    let trimmed = forward.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}
```

The doc comment names the one function that does **not** adopt it, and that exception is the lesson of the cleanup: `windows_to_wsl_path` recognises a drive root by its trailing slash — `C:/` becomes `/mnt/c/`. Strip it and the drive root silently stops converting. **A shared helper is an improvement only where its normalisation is harmless; forcing it into the one place whose logic depends on the thing it strips would be a regression dressed as consistency.**

`scanner.rs`'s `detect_file_system` and `distro_of` route through it, and the classifier gains a third answer:

```rust
fn detect_file_system(workspace: &str) -> &str {
    let normalized = super::platform::paths::normalize(workspace);
    if normalized.starts_with("//wsl.localhost/")
        || normalized.starts_with("//wsl$/")
    {
        "WSL"
    } else if normalized.starts_with("//") {
        // a UNC path that isn't WSL is a network share, slow for dev tooling
        "Network"
    } else {
        "Windows"
    }
}
```

A path that starts with `//` but is not a WSL UNC path is a network share, and those run dev tooling over SMB, which is slow in the way that actually costs you: file watches miss, installs crawl, `git status` takes seconds. The label surfaces in `ProjectTree.tsx` through one shared cell, with `FsCellProps { fs: string; className?: string }` in `types.d.ts`:

```tsx
const FS_TONE: Record<string, string> = {
	WSL: 'text-accent',
	Network: 'text-amber-400'
};

const NETWORK_WARNING =
	'On a network share — file access and dev tooling are slow here. Consider a local drive or a WSL-native path.';

const FsCell = ({ fs, className = '' }: FsCellProps) => (
	<div
		className={`${FS_TONE[fs] ?? 'text-text-muted'} ${className}`.trim()}
		title={fs === 'Network' ? NETWORK_WARNING : undefined}
	>
		{fs}
		{fs === 'Network' && ' ⚠'}
	</div>
);
```

It replaces the two inline file-system cells — the project row's `<FsCell fs={project.file_system} />` and the workspace header's `<FsCell {...{ fs, className: 'font-medium' }} />` — so the warning appears everywhere the filesystem does, from one definition. The tooltip names the problem *and the fix*, which is chapter 13's house style for error text applied to a warning.

Now the four items that did **not** ship. **"Recommend the best runtime" is not built, because DevGo already does it, silently, every time you launch.** A WSL project opens with `wsl`, a Windows project opens native, the target registry picks the executable per kind. A "recommended runtime" badge would restate the decision the app already makes as advice, on every row, forever. **A recommendation is only information when the user can act on it differently than the default.** So the recommendation that survives is the one case where the default is *wrong* — a project on a slow share — folded into the warning that already flags it. **Detect NTFS and detect mounted drives are not built because they need WinAPI for no payoff**: `GetVolumeInformationW` and `GetDriveTypeW` are a dependency the project does not otherwise carry, and the actionable subset of what they would tell you — "is this a network share" — a string check already answers.

### The one test

In `scanner.rs`'s test module:

```rust
    #[test]
    fn classifies_filesystem_kinds() {
        assert_eq!(detect_file_system(r"G:\01_tauri"), "Windows");
        assert_eq!(
            detect_file_system(r"\\wsl.localhost\Ubuntu-26.04\home"),
            "WSL"
        );
        assert_eq!(detect_file_system(r"\\wsl$\Debian\home"), "WSL");
        assert_eq!(detect_file_system(r"\\nas\share\projects"), "Network");
    }
```

The `\\wsl$\` line is the one that matters: it is the older UNC spelling WSL still answers to, and the classifier has to treat it as WSL rather than fall through to the `//` network branch — the one way this three-way `if` could go wrong.

> **Commit checkpoints** — `✅LAUNCHER: normalize paths`, `✅LAUNCHER: network share label`, `✅TEST: filesystem kinds`, `✅UI: fs cell` (the three Rust ones sit right after `get_wsl_path` on the branch; `fs cell` after the width fix); then the stage:
>
> ```powershell
> git commit --allow-empty -m "✅STAGE: 15 quick-actions"
> git checkout main && git merge 15.quick-actions && git push origin 15.quick-actions main
> ```

---

## 15.7 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun tauri dev
```

`cargo test` reports **44** — chapter 14's 43 plus `classifies_filesystem_kinds`. Then the checks only a running app can answer. Everything below was run against this chapter's build.

**The menu.** Right-click a row. It selects, and a 256-pixel menu opens at the cursor: *Open in editor `Ctrl+⏎`, Open terminal `Shift+⏎`, Open both `Alt+⏎`* — separator — *Reveal in Explorer `Ctrl+Shift+E`, Copy Windows path `Ctrl+Shift+C`, Copy WSL path `Ctrl+Shift+W`, Open remote* — separator — *Pin to top `Ctrl+S`*. Right-click a project with no remote: the *Open remote* row is absent, not greyed. Right-click a pinned one: *Unpin*. `Escape` closes it; so does clicking anywhere else.

**Copy, three ways.** *Copy Windows path* from the menu: a success toast, and the clipboard holds `G:\dev\app`. `Ctrl+Shift+W` with the same row selected: `/mnt/g/dev/app`. Then click into the search box and press `Ctrl+Shift+C`: the Windows path again — the chord works from the one place the launcher always leaves you. (Checking the clipboard from the app's own devtools with `readText()` pops a WebView2 permission prompt that blocks the page; read it from a shell instead — `Get-Clipboard`.)

**Reveal.** `Ctrl+Shift+E`: an Explorer window opens on the project's folder, and DevGo shows no toast — the window is the confirmation. Close it.

**The table did the rest.** `Ctrl+,` → Shortcuts: the Project group now lists Reveal in Explorer, Copy Windows path and Copy WSL path with their chords and the "· needs a selection" note, and nothing in `Settings.tsx` changed to make that happen.

**The network share.** If you have one, add it as a workspace: its projects' File System cell reads **`Network ⚠`** in amber, and hovering it says where to move them. If you do not, the unit test is the check — `\\nas\share\projects` classifies as `Network`, and `\\wsl$\Debian\home` still classifies as `WSL`.

---

## What you built

```
src-tauri/src/
├── commands.rs                ← reveal_in_explorer, get_wsl_path
├── lib.rs                     ← two commands
└── services/
    ├── platform/paths.rs      ← normalize (and the one caller that must not use it)
    └── scanner.rs             ← "Network", normalize adopted, classifies_filesystem_kinds
src/
├── types.d.ts                 ← three ShortcutIds, MenuAction / MenuEntry / ContextMenuProps,
│                                 FsCellProps, onContextMenu on the tree and the row
├── shortcuts.ts               ← three rows
├── hooks/useLaunchActions.ts  ← openEditor / openTerminal take an optional project
├── components/
│   ├── ContextMenu.tsx        ← NEW: dumb, fixed-width, clamped, closes itself
│   └── ProjectTree.tsx        ← FsCell, onContextMenu on ProjectRow
└── App.tsx                    ← revealInExplorer, copyText / copyWindowsPath / copyWslPath,
                                  buildMenu, menu state, three handler lines
```

> **The thread running through Slice 6.** A right-click menu, three chords and a filesystem warning — and almost none of it new. Reveal is `explorer.exe` on a path chapter 03 already stored. Copy-WSL-path is chapter 05's converter with `.writeText` after it. The shortcuts are three rows in chapter 11's table. The network flag is one branch in chapter 03's classifier. Slice 6 is the chapter where the earlier chapters pay you back: the infrastructure was the expensive part, and the features are leverage over it. **The measure of a slice like this is how little it had to build.**

---

→ Next: [16 — Command Palette](./16-palette.md) (Slice 7), the one surface that turns every action in this menu and every entry in that shortcut table into something you can find by typing.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [14 — Project Intelligence](./14-intelligence.md)
