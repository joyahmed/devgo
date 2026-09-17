# 16 — Command Palette (Slice 7)

**Branch:** `16.palette` — `git checkout 16.palette` gives you this chapter's finished app; `git diff 15.quick-actions 16.palette` is exactly what this chapter adds.

**Starting from:** Slice 6 — every project has a right-click menu, three quick actions on the keyboard, and a shortcut table that documents every binding. DevGo can do a lot. Finding the thing you want still means either knowing its keystroke or knowing where its button is.

**Goal:** `Ctrl+Shift+P` opens one searchable list of everything DevGo can do — open the project, reveal it, copy a path, jump to a settings panel, cycle the sort, quit — found by typing part of its name or an alias, driven entirely by the keyboard, remembering what you ran last.

> **Hold on to:**
> 1. **A command is a description, not an action.** `PaletteCommand` is a label, ways to find it, and `run: () => void` — a handle to a handler `App` already has. The palette is a third front door onto a house that is already built.
> 2. **A scored subsequence match, not a library.** Twenty lines: contiguous runs and word starts score extra, `null` means no match, `0` is a real score. In a list you navigate with ↓, *first* is the entire game.
> 3. **Persist the name of the thing, never the thing**, when the thing is a closure over live state. Recents are ids in `localStorage`, mapped back to fresh commands on every open.
> 4. **Disable when the user can make it applicable; omit when applicability is a fact about the world.** Project actions with nothing selected are greyed and say why; "Open remote" for a repo with no remote is simply absent.
>
> No Rust. The whole slice is frontend, because there was no new capability to add — only a new way to reach the ones Slices 1–6 built.

> This is the smallest slice in the plan that feels like the most, and the reason is the whole chapter: **the palette implements no new actions.** "Reveal in Explorer" in the palette is the same `revealInExplorer` the context menu fires and the same one `Ctrl+Shift+E` fires. If the palette owned its own action logic it would be a second implementation of every command, drifting from the menu's the day one of them changed. So it owns exactly two things the other front doors do not need — a way to match a typed query against a list of names, and a memory of what you ran — and borrows everything else.

---

## 16.1 — A command is a description, not an action

In `src/types.d.ts`, a new section above the component props:

```ts
/* Command palette */

/// a label, ways to find it, and a handle to an action that lives in App
interface PaletteCommand {
	id: string;
	title: string;
	subtitle?: string;
	/// from shortcuts.ts, never typed here
	hint?: string;
	/// aliases matched beside the title, so `term` finds "Open terminal"
	keywords?: string[];
	/// shown greyed, not hidden, e.g. a project action with nothing selected
	disabled?: boolean;
	run: () => void;
}
```

Everything on the struct except `run` exists to make the command **findable**: `title` is what you read and mostly type against; `keywords` are the aliases — you think "terminal", you type `t`; `hint` is the keybinding, read from the shortcut table and never typed here, or it would be a third place that key lives; `subtitle` is context — which project, or why it cannot run; `disabled` is §16.4's discoverability decision. **When a data structure's fields are all "how to find this" and one "what it does", you are looking at an index, not an implementation.**

---

## 16.2 — Fuzzy matching, scored, without a library

The one algorithm the palette needs that nothing else in DevGo has: given what the user typed and a command's name, does it match, and how well? The reflex is `fuse.js`. DevGo writes it instead, in `src/palette.ts`, because the strings are never longer than "Settings: Editors & Terminals" and the scoring it wants is specific:

```ts
/// Subsequence score, or null when `query` is not a subsequence of `text`.
/// Contiguous runs and word starts score extra, so `ote` ranks "Open TErminal"
/// above a scattering of the same letters.
export const fuzzyScore = (query: string, text: string): number | null => {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (!q) return 0;

	let qi = 0;
	let score = 0;
	let streak = 0;
	let prev = -2;

	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] !== q[qi]) continue;

		let bonus = 1;
		if (prev === ti - 1) {
			streak += 1;
			bonus += streak * 2;
		} else {
			streak = 0;
		}
		// start of a word: the letter you'd type first
		if (ti === 0 || /[\s\-_/.:]/.test(t[ti - 1])) bonus += 4;

		score += bonus;
		prev = ti;
		qi += 1;
	}

	return qi === q.length ? score : null;
};
```

At heart it is a **subsequence test**: walk `text`, and every time its current character equals the character `query` wants next, consume it. If the walk consumes all of `query`, it matched — `ote` matches "**O**pen **TE**rminal". The three bonuses turn the boolean into a ranking: `1` per matched character; a contiguous run grows (`streak * 2`), so a real substring like `term` scores far above four scattered letters; and a word start — the string's first character or one after a separator — is worth `4`, because those are the letters you reach for when you abbreviate.

`null` for no match rather than `0`, because `0` is a legitimate score: an empty query scores every command `0`. **A boolean fuzzy match tells you what to show; a scored one tells you what to show *first*.**

```ts
/// Best score across title and aliases. A keyword hit is worth a hair less
/// than the same hit on the title, so titles float up but an alias still wins.
export const scoreCommand = (
	query: string,
	cmd: PaletteCommand
): number | null => {
	if (!query.trim()) return 0;

	let best: number | null = fuzzyScore(query, cmd.title);
	for (const kw of cmd.keywords ?? []) {
		const s = fuzzyScore(query, kw);
		if (s !== null) {
			const weighted = s * 0.9;
			best = best === null ? weighted : Math.max(best, weighted);
		}
	}
	return best;
};
```

The `* 0.9` is a small thumb on the scale: a query that hits a visible title should rank above one that only hit a hidden alias, all else equal, because the user can see the title. But `0.9` is close enough to `1` that a *strong* alias hit still beats a *weak* title hit. The empty-query short-circuit is what lets §16.3 show recents instead of a scored list.

---

## 16.3 — The modal: recents, then matches

`ButtonProps` gains `ref?: React.Ref<HTMLButtonElement>` (React 19: `ref` is a prop, and `Button` spreads it through), and `CommandPaletteProps { commands: PaletteCommand[]; onClose: () => void }` goes in `types.d.ts`. Then `src/components/CommandPalette.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { scoreCommand } from '../palette';
import Button from './Button';

const RECENT_KEY = 'devgo.recentCommands';
const RECENT_MAX = 10;

const readRecent = (): string[] => {
	try {
		const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
		return Array.isArray(raw) ? (raw as string[]) : [];
	} catch {
		return [];
	}
};

// move to front, capped; ids not commands, a command is a closure over live state
const pushRecent = (id: string) => {
	const next = [id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_MAX);
	localStorage.setItem(RECENT_KEY, JSON.stringify(next));
};
```

`localStorage`, not `prefs.json`, for chapter 09's reason: view state only the frontend reads. `readRecent` is defensive on both axes a persisted blob can be wrong — absent, and present-but-not-an-array — because a hand-edited value should degrade to "no recents", never throw during render. `pushRecent` is move-to-front with a cap. And it stores the **id**: the command is a closure that will be stale by next launch; the id is a stable string that `buildCommands` hands back a fresh command for.

```tsx
const divider =
	'px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted';

const CommandPalette = ({ commands, onClose }: CommandPaletteProps) => {
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const activeRef = useRef<HTMLButtonElement>(null);

	// empty query: recents that are still runnable, then the rest; typed: best first
	const q = query.trim();
	const byId = new Map(commands.map(c => [c.id, c]));
	const recents = q
		? []
		: readRecent()
				.map(id => byId.get(id))
				.filter((c): c is PaletteCommand => !!c && !c.disabled);
	const recentIds = new Set(recents.map(c => c.id));
	const list: PaletteCommand[] = q
		? commands
				.map(c => ({ c, s: scoreCommand(q, c) }))
				.filter((x): x is { c: PaletteCommand; s: number } => x.s !== null)
				.sort((a, b) => b.s - a.s)
				.map(x => x.c)
		: [...recents, ...commands.filter(c => !recentIds.has(c.id))];
	const recentCount = recents.length;
```

No `useMemo`: this is plain derivation — the compiler's job. **Empty query is a different feature from a typed one.** With nothing typed, the useful thing is not an alphabetical dump; it is *what you keep doing*, so recents come first, followed by everything else. Two details are load-bearing: a recent id might name a command that no longer exists or is currently disabled (you ran "Copy WSL path" an hour ago; right now nothing is selected) — dropped, not shown broken; and `recentIds` prevents a command appearing twice — a recent command is *moved* to the top, not copied.

```tsx
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: 'nearest' });
	}, [active]);

	// close before run, so a command that opens something opens on a clean screen
	const run = (cmd: PaletteCommand | undefined) => {
		if (!cmd || cmd.disabled) return;
		pushRecent(cmd.id);
		onClose();
		cmd.run();
	};

	const keys: Record<string, () => void> = {
		ArrowDown: () => setActive(i => Math.min(i + 1, list.length - 1)),
		ArrowUp: () => setActive(i => Math.max(i - 1, 0)),
		Enter: () => run(list[active]),
		Escape: onClose
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		const action = keys[e.key];
		if (!action) return;
		e.preventDefault();
		action();
	};

	const heading = (i: number) => {
		if (q || recentCount === 0) return null;
		if (i === 0) return 'Recent';
		if (i === recentCount) return 'All commands';
		return null;
	};
```

The one effect that survives is the one an effect is for — reaching outside React to scroll the active row into view; `block: 'nearest'` moves the viewport only when it must. `run` guards both the empty list and a disabled command, and the order of its last three lines is deliberate: `pushRecent` regardless of what `run` does; `onClose()` **before** `cmd.run()`, because some commands open another surface — Settings, the WSL confirm — and the palette should be gone before that appears rather than stacked behind it.

The keys are the same key→action map shape as `SearchBox` (chapter 03) and the tree: `↑↓` clamp at the ends rather than wrap, `Enter` runs, `Escape` closes. The handler lives on the **input**, which has focus the whole time the palette is open, so there is no `window` listener to add, gate and tear down.

```tsx
	return (
		<div
			className='fixed inset-0 bg-black/60 flex items-start justify-center z-50 pt-[12vh]'
			onClick={onClose}
		>
			<div
				className='w-[min(640px,92vw)] max-h-[70vh] flex flex-col bg-bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden'
				onClick={e => e.stopPropagation()}
			>
				<input
					autoFocus
					className='w-full px-4 py-3 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted border-b border-border'
					placeholder='Type a command…'
					value={query}
					onChange={e => {
						// reset the cursor here, not in an effect
						setQuery(e.target.value);
						setActive(0);
					}}
					onKeyDown={handleKeyDown}
				/>

				<div className='flex-1 overflow-y-auto py-1'>
					{list.length === 0 && (
						<div className='px-4 py-6 text-center text-sm text-text-muted'>
							No matching commands
						</div>
					)}

					{list.map((cmd, i) => (
						<div key={cmd.id}>
							{heading(i) && <div className={divider}>{heading(i)}</div>}
							<Button
								ref={i === active ? activeRef : undefined}
								variant='tab'
								className='w-full rounded-none px-4 py-2 text-left'
								aria-current={i === active ? 'page' : undefined}
								disabled={cmd.disabled}
								onMouseMove={() => setActive(i)}
								onClick={() => run(cmd)}
							>
								<span className='flex w-full items-center justify-between gap-4'>
									<span className='min-w-0'>
										<span className='block truncate text-sm text-text-primary'>
											{cmd.title}
										</span>
										{cmd.subtitle && (
											<span className='block truncate text-xs text-text-muted'>
												{cmd.subtitle}
											</span>
										)}
									</span>
									{cmd.hint && (
										<kbd className='font-mono text-[10px] shrink-0 px-1.5 py-0.5 border border-border rounded bg-bg-panel text-text-muted'>
											{cmd.hint}
										</kbd>
									)}
								</span>
							</Button>
						</div>
					))}
				</div>
			</div>
		</div>
	);
};

export default CommandPalette;
```

The cursor has to snap back to the top whenever the result list changes, or `Enter` runs whatever row your index landed on before you typed. The tempting version is `useEffect(() => setActive(0), [query])`, and it is wrong twice: it cascades an extra render per keystroke, and it is the pattern the compiler's lint exists to stop. The query changes in one place, so the reset goes *there* — two `setState`s in one handler batch into one render.

The rows are the `tab` variant from chapter 11, with `aria-current` marking the active one; `text-left` is the one thing the variant did not carry, and its absence showed up in the first screenshot as a subtitle-bearing title sitting oddly indented — a `<button>` centres its text by default, and a title narrower than its own subtitle centred inside the subtitle's width. `✅FIX: palette rows left aligned` is the commit.

---

## 16.4 — The registry, and disabled-not-hidden

Before the registry, one small door: `openSettings` learns to open on a *specific* panel. `SettingsProps` gains `panel?: string`, `App` holds `settingsPanel` beside `showSettings`, and `openSettings(panel?)` sets both (closing clears it). In `Settings.tsx`, a requested panel wins over the remembered one, once per request — the adjust-while-rendering pattern from chapter 08's tree:

```tsx
	// a requested panel wins over the remembered one, once per request
	const [requested, setRequested] = useState(panel);
	if (panel !== requested) {
		setRequested(panel);
		if (panel) choose(panel);
	}
```

`Ctrl+N` and the Add button now open on Workspaces rather than on whatever you last looked at — a small honesty the registry needs for its three `Settings: …` commands.

`buildCommands` in `App.tsx` is where the palette meets the rest of the app — the one place that knows both every action and the current state:

```tsx
	// every run is a handler that already exists; the palette only finds them
	const [paletteOpen, setPaletteOpen] = useState(false);
	const buildCommands = (): PaletteCommand[] => {
		const hint = (id: ShortcutId) => prettyKeys(shortcutFor(id));
		const p = selected;
		// project actions are disabled, not hidden, so they stay discoverable
		const proj = (
			id: ShortcutId,
			title: string,
			keywords: string[],
			act: (p: Project) => void
		): PaletteCommand => ({
			id,
			title,
			hint: hint(id),
			subtitle: p?.name ?? 'Select a project first',
			keywords,
			disabled: !p,
			run: () => p && act(p)
		});
```

`proj` is the shape of a project command, written once: a shortcut id (which gives both the hint and the command's own id), a title, some aliases, and a function that takes a project. The seven project commands become one line each, and they all get the **disabled-not-hidden** behaviour for free. With a project selected the subtitle names it; with nothing selected the command is greyed, its subtitle says *why*, and `run` is a no-op — but it is still in the list.

**Hiding an action the user cannot take right now is the wrong default, and the palette is exactly where it is wrong.** A palette is how you *discover* what an app can do. If "Copy WSL path" vanishes whenever nothing is selected, a user who has never selected a project has no way to learn the command exists. Shown-but-disabled, with the precondition in the subtitle, teaches.

```tsx
		const commands: PaletteCommand[] = [
			{
				id: 'refresh',
				title: 'Refresh projects',
				hint: hint('refresh'),
				keywords: ['rescan', 'reload'],
				run: handleRefresh
			},
			{
				id: 'settings',
				title: 'Open Settings',
				hint: hint('settings'),
				keywords: ['preferences', 'config'],
				run: () => openSettings()
			},
			{
				id: 'settings.workspaces',
				title: 'Settings: Workspaces',
				subtitle: 'Add or remove workspace folders',
				keywords: ['add', 'remove', 'folder'],
				run: () => openSettings('workspaces')
			},
			{
				id: 'settings.targets',
				title: 'Settings: Editors & Terminals',
				keywords: ['editor', 'terminal', 'vscode'],
				run: () => openSettings('targets')
			},
			{
				id: 'settings.shortcuts',
				title: 'Settings: Shortcuts',
				keywords: ['keybindings', 'keys', 'hotkey'],
				run: () => openSettings('shortcuts')
			},
			{
				id: 'sort',
				title: `Sort order: ${sortMode} (cycle)`,
				keywords: ['order', 'frecency', 'activity', 'name'],
				run: toggleSort
			},
			proj('openEditor', 'Open in editor', ['code', 'edit'], pr =>
				openEditor(pr).catch(e => toast(showError(e)))
			),
			proj('openTerminal', 'Open terminal', ['term', 'shell', 'wt'], pr =>
				openTerminal(pr).catch(e => toast(showError(e)))
			),
			proj('openBoth', 'Open both', ['launch'], handleLaunch),
			proj(
				'revealExplorer',
				'Reveal in Explorer',
				['folder', 'files'],
				revealInExplorer
			),
			proj('copyWinPath', 'Copy Windows path', ['path', 'clipboard'], copyWindowsPath),
			proj('copyWslPath', 'Copy WSL path', ['path', 'linux'], copyWslPath),
			proj(
				'togglePin',
				p && ranks.get(p.full_path)?.pinned ? 'Unpin project' : 'Pin project',
				['favorite', 'star'],
				handleTogglePin
			),
			{
				id: 'quit',
				title: 'Quit DevGo',
				hint: hint('quit'),
				keywords: ['exit', 'close'],
				run: () => invoke('quit_app').catch(() => {})
			}
		];

		// present only when they apply; nothing to teach by showing them otherwise
		if (p && git.get(p.full_path)?.remote) {
			commands.push({
				id: 'openRemote',
				title: 'Open remote in browser',
				subtitle: p.name,
				keywords: ['git', 'github', 'url'],
				run: () => handleOpenRemote(p)
			});
		}
		if (distros.length > 0) {
			commands.push({
				id: 'wsl.shutdown',
				title: 'Shut down all WSL',
				subtitle: distros.join(', '),
				keywords: ['wsl', 'stop', 'kill'],
				run: () =>
					setConfirmAction({
						message:
							'Shut down all of WSL? This stops every distro and the virtual machine itself, including Docker Desktop on the WSL2 backend.',
						run: () =>
							invoke<string>('shutdown_wsl')
								.then(m => toast(m, 'success'))
								.catch(e => toast(showError(e), 'error'))
								.finally(refreshDistros)
					})
			});
		}

		return commands;
	};
```

Note the difference from `disabled`. "Open remote" and "Shut down all WSL" are **conditionally present**, not conditionally disabled — because unlike the project actions, there is nothing to teach by showing them when they do not apply. The rule that separates the two cases: **disable when the user can make it applicable (select a project); omit when applicability is a fact about the world (this repo has no remote; no distro is up).**

Every `run` in the registry is a handler that already existed before this slice — `handleRefresh`, `openSettings`, `openEditor`, `revealInExplorer`, `handleTogglePin`, `handleOpenRemote`, `setConfirmAction`. `buildCommands` composes them; it does not reimplement any. And the hints are chapter 11's table, again.

---

## 16.5 — Wiring, and the one visible door

`ShortcutId` gains `'commandPalette'` and `SHORTCUTS` gains its row, first in the Global group:

```ts
	{
		id: 'commandPalette',
		keys: 'Ctrl+Shift+P',
		label: 'Command palette',
		group: 'Global'
	},
```

which means the palette lists itself in Settings → Shortcuts with no second edit. In `App`'s handler, at the very top — before `focusSearch`, so it wins from anywhere:

```tsx
			if (fire('commandPalette', () => setPaletteOpen(true))) return;
```

and the render, above the context menu:

```tsx
			{paletteOpen && (
				<CommandPalette
					{...{
						commands: buildCommands(),
						onClose: () => setPaletteOpen(false)
					}}
				/>
			)}
```

`{paletteOpen && …}` mounts the palette only while open, so `buildCommands()` runs only then, and every open starts with a fresh, empty query and the current registry — a command disabled last time is enabled now if you have since selected a project.

A palette with no visible entry point — `Ctrl+Shift+P` and nothing else — makes a launcher whose discovery surface is the palette itself undiscoverable. So the chapter ships a door: `src/components/StatusBar.tsx`, a footer with one door, `StatusBarProps { onOpenPalette: () => void }`:

```tsx
import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';

// the palette's only visible door; without it the discovery surface is itself undiscoverable
const StatusBar = ({ onOpenPalette }: StatusBarProps) => (
	<footer className='flex items-center justify-end h-10 px-4 bg-bg-secondary border-t border-border shrink-0 text-[13px] select-none'>
		<Button
			variant='ghost'
			className='gap-1.5 text-[13px] hover:bg-transparent hover:text-accent'
			title='Open the command palette'
			onClick={onOpenPalette}
		>
			<kbd className='font-mono text-[11px] leading-none px-2 py-1 border border-border rounded bg-bg-panel text-text-primary'>
				{prettyKeys(shortcutFor('commandPalette'))}
			</kbd>
			<span className='text-text-secondary'>Commands</span>
		</Button>
	</footer>
);

export default StatusBar;
```

The chip reads `Ctrl+Shift+P` from the table like every other chip in the app. `App` renders `<StatusBar {...{ onOpenPalette: () => setPaletteOpen(true) }} />` after the main column — the same setter the shortcut fires.

> **Commit checkpoints** — `✅UI: palette command type`, `✅UI: fuzzy score`, `✅UI: command palette`, `✅UI: settings opens on a panel`, `✅UI: palette shortcut`, `✅UI: command registry`, `✅UI: commands door in the footer`, then the screenshot's `✅FIX: palette rows left aligned`, then:
>
> ```powershell
> git commit --allow-empty -m "✅STAGE: 16 palette"
> git checkout main && git merge 16.palette && git push origin 16.palette main
> ```

---

## 16.6 — Verify

```powershell
bun tauri dev
```

No Rust changed; `cargo test` still reports **44**. Everything below was run against this chapter's build.

**The registry.** With a project selected, `Ctrl+Shift+P`. The input has focus; fifteen commands are listed, the first highlighted: *Refresh projects `F5`, Open Settings `Ctrl+,`, Settings: Workspaces, Settings: Editors & Terminals, Settings: Shortcuts, Sort order: frecency (cycle)*, then seven project commands each subtitled with the project's name and carrying its chord, *Quit DevGo `Ctrl+Q`*, and — because this project has a remote — *Open remote in browser*. With WSL stopped, no *Shut down all WSL*; start a distro and F5, and it appears with the distro's name as subtitle.

**Ranking.** Type `ote`: *Open terminal* is first (its `t` and `e` are word starts and adjacent), *Settings: Editors & Terminals* second. Type `short`: *Settings: Shortcuts* alone. Type `targ`: *No matching commands* — `g` is nowhere in that title, and a subsequence match is honest about it.

**Run, and remember.** With `short` typed, `Enter`: the palette closes *first*, Settings opens on the Shortcuts panel. `Escape`, then click **Commands** in the footer: the palette opens with a **Recent** heading over *Settings: Shortcuts* and **All commands** over the rest, because `devgo.recentCommands` now holds `["settings.shortcuts"]`. `↓` `↓` moves the highlight two rows; `Escape` closes.

**Deep links.** Type `editors`, `Enter`: Settings opens on Editors & Terminals. `Escape`, `Ctrl+Shift+P`, `workspaces`, `Enter`: Workspaces. `Ctrl+N` now lands on Workspaces too.

**Disabled, not hidden.** Clear the selection (quit and relaunch with no last project, or remove the workspace the selected project is in): the seven project commands are still listed, greyed, subtitled *Select a project first*, and `Enter` on one does nothing and records nothing.

---

## What you built

```
src/
├── types.d.ts                  ← PaletteCommand, CommandPaletteProps, StatusBarProps,
│                                  ButtonProps.ref, SettingsProps.panel, 'commandPalette'
├── palette.ts                  ← NEW: fuzzyScore, scoreCommand
├── shortcuts.ts                ← the Ctrl+Shift+P row
├── components/
│   ├── CommandPalette.tsx      ← NEW: recents / matches, key map, run, tab rows
│   ├── StatusBar.tsx           ← NEW: the Commands door
│   └── Settings.tsx            ← panel prop, requested-wins-once
└── App.tsx                     ← openSettings(panel), buildCommands, paletteOpen, the fire line
```

> **The thread running through Slice 7.** The palette added no capability and still feels like a feature. When every command it runs already existed, the palette is not new power — it is the app becoming *findable*, which for a launcher that had grown a menu, a shortcut table and fourteen bindings was the missing half of "keyboard-first". Its whole weight is a twenty-line matcher, a ten-string memory, and the discipline of a registry that describes actions rather than owning them.

---

→ Next: [17 — Onboarding & Scan Config](./17-onboarding.md) (Slice 8), the first-run experience for someone who opens DevGo with no workspaces at all.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [15 — Quick Actions & Paths](./15-quick-actions.md)
