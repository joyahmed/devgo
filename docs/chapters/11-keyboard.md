# 11 — Keyboard-First & the Settings Shell (Slice 3)

**Branch:** `11.keyboard` — `git checkout 11.keyboard` gives you this chapter's finished app; `git diff 10.git 11.keyboard` is exactly what this chapter adds.

**Starting from:** Slice 2 — a launcher you summon with one keystroke, ranked by frecency, with branch and dirty state on every row and not a single cold-booted VM anywhere in it. Every shortcut it has was written as an `if` in whatever file needed it.

**Goal:** every binding declared exactly once and read by three different consumers, and a Settings shell with a panel registry. (The reason this slice moved up the queue — a way to stop a wedged WSL distro without opening a terminal — is chapter 12.)

> **Hold on to:**
> 1. **One declaration, three readers.** A keybinding is one fact that the handler, the button hint and the Settings list must all agree on. Written three times they drift; derived from one array they cannot.
> 2. **Exact matching.** `Ctrl+Enter` must refuse `Ctrl+Shift+Enter`. Subset matching is how one shortcut silently swallows the next one someone adds.
> 3. **When two listeners see the same event, one of them renounces the overlap in code.** Never rely on which `useEffect` registered first.
> 4. **A claim the UI makes must be one it can keep.** A hint for a key nobody bound, a chord that fires twice, an Escape that closes one thing and clears another — the chapter is a list of ways a launcher can lie, and the fixes.
>
> This chapter adds one Rust command (eight lines). Everything else is TypeScript.

> A launcher is judged on whether you can hit it blind. Slices 1 and 2 got the window in front of you fast and put the right project at the top. What they did not do is let you *finish* without reaching for the mouse: the arrow keys moved a selection, Enter opened both, Ctrl+S pinned, and that was the whole vocabulary.
>
> Adding the missing bindings is an afternoon. Adding them *without* creating the failure this chapter is really about takes the rest of the chapter. That failure is drift: a keybinding is a fact that three separate parts of the app need to agree on — the code that binds it, the button that advertises it, and the list a user reads when they forget it. Written down three times, they will disagree within a month, and the version the user trusts is the one on the button.

---

## 11.1 — The one Rust change

Chapter 09 registered the summon hotkey from `setup` and left a note: the read and write commands for it wait for a caller. The Shortcuts panel (§11.7) is the reader. In `src-tauri/src/commands.rs`, above `quit_app`:

```rust
/// The summon accelerator as the user will read it. Chapter 09 registers it
/// from `setup`; nothing in the frontend needed the value until the Shortcuts
/// panel wanted to show it. Changing it is still a prefs.json edit.
#[tauri::command]
pub fn get_summon_hotkey(state: State<AppState>) -> Result<String, AppError> {
    Ok(state.pref_store.lock().map_err(lock_err)?.summon_hotkey())
}
```

and one line in `lib.rs`'s `generate_handler!`, after `commands::toggle_pin`:

```rust
            commands::get_summon_hotkey,
```

`summon_hotkey()` is the chapter 09 getter that falls back to `DEFAULT_SUMMON_HOTKEY`. The write half — `set_summon_hotkey`, `summon::rebind`, `AppError::HotkeyFailed` — still has no caller and still waits.

> **Commit checkpoint**
>
> ```powershell
> git add -A && git commit -m "✅RUST: get_summon_hotkey — the Shortcuts panel reads the accelerator prefs.json holds"
> ```

---

## 11.2 — One declaration, three readers

The types go where every type in this repo goes. In `src/types.d.ts`, above `/* Component props */`:

```ts
/* Shortcuts — see src/shortcuts.ts */

type ShortcutId =
	| 'focusSearch'
	| 'clearSearch'
	| 'refresh'
	| 'settings'
	| 'quit'
	| 'addWorkspace'
	| 'removeWorkspace'
	| 'openEditor'
	| 'openTerminal'
	| 'openBoth'
	| 'togglePin'
	| 'expand'
	| 'collapse'
	| 'toggleWorkspace'
	| 'top'
	| 'bottom';

type ShortcutGroup = 'Global' | 'Navigation' | 'Project' | 'Workspace';

interface Shortcut {
	id: ShortcutId;
	/// Canonical form: modifiers in Ctrl→Alt→Shift order, then the key.
	keys: string;
	label: string;
	group: ShortcutGroup;
	/// Requires a selected project to do anything.
	needsSelection?: boolean;
}
```

Then the table itself. Create `src/shortcuts.ts`:

```ts
/// Every keyboard binding in DevGo, declared once.
///
/// Three things read this list: the handler that binds them, the hints rendered
/// on buttons, and the Settings → Shortcuts panel. Declaring them anywhere else
/// guarantees the three drift apart — a shortcut the UI advertises but does not
/// bind is worse than one it never mentions.
export const SHORTCUTS: Shortcut[] = [
	{ id: 'focusSearch', keys: 'Ctrl+K', label: 'Focus search', group: 'Global' },
	{ id: 'clearSearch', keys: 'Ctrl+L', label: 'Clear search', group: 'Global' },
	{ id: 'refresh', keys: 'F5', label: 'Refresh projects', group: 'Global' },
	{ id: 'settings', keys: 'Ctrl+,', label: 'Open settings', group: 'Global' },
	{ id: 'quit', keys: 'Ctrl+Q', label: 'Quit DevGo', group: 'Global' },

	{
		id: 'expand',
		keys: 'ArrowRight',
		label: 'Expand workspace',
		group: 'Navigation'
	},
	{
		id: 'collapse',
		keys: 'ArrowLeft',
		label: 'Collapse workspace',
		group: 'Navigation'
	},
	{
		id: 'toggleWorkspace',
		keys: 'Ctrl+Space',
		label: 'Toggle workspace',
		group: 'Navigation'
	},
	{ id: 'top', keys: 'Home', label: 'Jump to top', group: 'Navigation' },
	{ id: 'bottom', keys: 'End', label: 'Jump to bottom', group: 'Navigation' },

	{
		id: 'openEditor',
		keys: 'Ctrl+Enter',
		label: 'Open in editor',
		group: 'Project',
		needsSelection: true
	},
	{
		id: 'openTerminal',
		keys: 'Shift+Enter',
		label: 'Open terminal',
		group: 'Project',
		needsSelection: true
	},
	{
		id: 'openBoth',
		keys: 'Alt+Enter',
		label: 'Open both',
		group: 'Project',
		needsSelection: true
	},
	{
		id: 'togglePin',
		keys: 'Ctrl+S',
		label: 'Pin / unpin',
		group: 'Project',
		needsSelection: true
	},

	{
		id: 'addWorkspace',
		keys: 'Ctrl+N',
		label: 'Add workspace',
		group: 'Workspace'
	},
	{
		id: 'removeWorkspace',
		keys: 'Delete',
		label: 'Remove workspace',
		group: 'Workspace',
		needsSelection: true
	}
];

export const shortcutFor = (id: ShortcutId): string =>
	SHORTCUTS.find(s => s.id === id)?.keys ?? '';
```

### What the problem actually is

A keybinding is not one fact in one place. It is one fact that **three** independent parts of the app have to agree on:

1. the `keydown` handler, which decides whether an event fires an action;
2. the button, which renders `Ctrl+⏎` in a `<kbd>` so you learn the binding without reading docs;
3. the Settings → Shortcuts panel, which is where you look when you have forgotten it.

Before this file, DevGo had (1) written as `if`s across `App.tsx` and `ProjectTree.tsx`, and did not have (2) or (3) at all. The obvious way to add them is to type the strings into the JSX. That works on the day you type it, and then someone moves "open editor" from `Ctrl+Enter` to `Ctrl+Alt+Enter` in the handler, does not grep the JSX, and ships.

**A button advertising a binding nobody registered is worse than a button with no hint at all.** No hint costs you nothing — you use the mouse, as you were already doing. A wrong hint costs you a habit: you learn the key, use it blind, nothing happens, and now you do not trust *any* of the hints. One wrong label discredits the whole set.

The fix is not discipline; discipline is what fails here. The fix is making the disagreement unrepresentable: there is one array, and all three readers derive from it. Change `keys` and the handler, the button and the panel all move together in the same commit, because none of them contains a key name.

`ShortcutId` is a union of literals, so an id that is not in the table is a *compile* error at every call site. `shortcutFor`'s `?? ''` covers a table entry being deleted while a caller still references it — which TypeScript also catches. The runtime fallback exists so that the failure mode, if one ever slips through, is a missing hint rather than a crashed render.

`removeWorkspace` carries `needsSelection`. It acts on the *selected project's* workspace (§11.5); with nothing selected it has nothing unambiguous to remove. The flag is what the Shortcuts panel prints as "· needs a selection", so it has to tell the truth.

---

## 11.3 — Why bare single keys were rejected

The plan asked for single-key project actions: `T` for terminal, `C` for code editor, `B` for both. They are not in the table, and the reason is the most interesting design decision in the slice.

Chapter 09 built the summon hotkey so that it **deliberately leaves focus in the search box**. That is not incidental polish — it is the property that makes DevGo a launcher rather than a window: you hit `Ctrl+Alt+Space` and start typing to filter, with no intervening click.

Which means a bare `T` types the letter `t` into the search box. Always. In the state the app is in every single time you summon it.

There were three ways out, and the rejected two are the tempting ones:

**Option A — an explicit mode.** `Esc` blurs the search box; while blurred, bare letters act. This is `vim`'s normal/insert split, and it works in `vim` because `vim` is a program you live in for hours and it shows you which mode you are in. DevGo is on screen for about four seconds. You would summon it, hit `T`, and get either a terminal or the letter `t` depending on whether the *previous* summon happened to end blurred.

**Option B — magic on emptiness.** Letters act while the query is empty and type once it is not. No mode to remember. It also means `T` on an empty box opens a terminal and `T` after you have typed `dev` filters — the same key, two meanings, switching on state that is *technically* visible but that nobody looks at before pressing a key they press blind.

**Option C — modifier combos.** `Ctrl+Enter`, `Shift+Enter`, `Alt+Enter`. They work identically regardless of what has focus, because no input claims them.

C shipped. A and B share one defect: **they make a single key mean two different things depending on state the user is not looking at.** In an application whose entire value proposition is being operated blind, that is the one property you cannot trade away. A slightly longer chord that always works beats a shorter one that usually works, because "usually" is what destroys the habit — and the habit is the whole product.

**Write the rejected options down.** A plan item that goes from unticked to ticked with different keys than it asked for looks like a shortcut taken, unless the reasoning sits next to it. Six months later the only difference between "we thought about this" and "we could not be bothered" is whether someone wrote the paragraph.

---

## 11.4 — Matching, and the two guards

The rest of `src/shortcuts.ts`:

```ts
/// Does this event match a declared binding?
///
/// Exact modifier matching, deliberately: `Ctrl+Enter` must not fire on
/// `Ctrl+Shift+Enter`. Loose matching is how one shortcut quietly swallows
/// another that gets added later.
export const matches = (e: KeyboardEvent, keys: string): boolean => {
	const parts = keys.split('+');
	const key = parts[parts.length - 1];
	const want = {
		ctrl: parts.includes('Ctrl'),
		alt: parts.includes('Alt'),
		shift: parts.includes('Shift')
	};
	// Cmd is a Ctrl alias for the Mac port, so they collapse into one flag
	// before the comparison — and the comparison stays exact.
	const ctrl = e.ctrlKey || e.metaKey;
	if (ctrl !== want.ctrl) return false;
	if (e.altKey !== want.alt) return false;
	if (e.shiftKey !== want.shift) return false;

	// `KeyboardEvent.key` is the character produced, not the key pressed.
	if (key === 'Space') return e.key === ' ';
	if (key === ',') return e.key === ',';
	return e.key.toLowerCase() === key.toLowerCase();
};

/// Bare keys belong to whatever input has focus. Anything with a modifier is
/// app-level and must still fire while the search box is focused — which is
/// exactly where the summon hotkey leaves you.
export const isTypingTarget = (e: KeyboardEvent): boolean =>
	e.target instanceof HTMLInputElement ||
	e.target instanceof HTMLTextAreaElement;

const NAMED: Record<string, string> = {
	ArrowRight: '→',
	ArrowLeft: '←',
	ArrowUp: '↑',
	ArrowDown: '↓',
	Enter: '⏎',
	Delete: 'Del',
	Space: 'Space'
};

/// Compact form for rendering next to a button. The table stores what
/// `KeyboardEvent.key` says; the user reads `→`. Nothing parses `→` back.
export const prettyKeys = (keys: string): string =>
	keys
		.split('+')
		.map(p => NAMED[p] ?? p)
		.join('+');
```

`KeyboardEvent` here is the DOM global, not React's — `shortcuts.ts` imports nothing from React and the two window listeners that call `matches` hand it native events.

### Exact matching, not "at least these modifiers"

The tempting implementation is a subset test: does the event have *at least* the modifiers the binding asks for? It is shorter, and it is how a lot of hand-rolled shortcut code works.

Follow it forward. `Ctrl+Enter` (open editor) is declared. Under subset matching it fires on `Ctrl+Enter`, and also on `Ctrl+Shift+Enter`, and also on `Ctrl+Alt+Enter`. Today nothing else is bound to those, so nothing looks wrong.

Then a later slice adds `Ctrl+Shift+Enter` for "open in the *other* editor." It never fires. The handler is a top-to-bottom chain of `if (fire(...)) return;` (§11.5), `openEditor` is earlier in the chain, and it claims the event first. There is no error, no warning, no failing test — the new shortcut simply does nothing, and the bug report says "the new shortcut doesn't work," which sends you to the new code, which is fine.

**Loose matching is how one shortcut silently swallows the next one someone adds.** The cost of getting it right is one `!==` per modifier instead of a `&&`, paid once, forever.

### The version of this that shipped broken *(skip on first pass)*

An earlier cut of `matches` collapsed the Cmd alias like this:

```ts
if (e.ctrlKey !== want.ctrl && e.metaKey !== want.ctrl) return false;
```

It reads like "reject if the modifiers disagree." It rejects only when **both** flags disagree. Walk `Home`, which wants no Ctrl, against a real `Ctrl+Home` press:

| | value |
|---|---|
| `want.ctrl` | `false` |
| `e.ctrlKey` | `true` |
| `e.metaKey` | `false` |
| `e.ctrlKey !== want.ctrl` | `true` |
| `e.metaKey !== want.ctrl` | **`false`** |
| `true && false` | `false` → guard does not reject |

So `Ctrl+Home` fired the `Home` binding, in the file whose entire purpose is exact matching, under a doc comment that promised it. The version above collapses the alias *before* comparing, which keeps the Mac behaviour and restores exactness.

The lesson worth carrying is not the boolean algebra. It is that **a comment asserting a property is not the property**. If a guarantee matters, the thing to trust is a test or a table you actually walked, not a sentence.

### The typing guard, promoted to a helper

Chapter 09 discovered this the hard way: an early `ProjectTree` handler bailed out entirely when the event target was an input, which meant `Ctrl+S` did nothing in the one state summon always produces. The guard has to be about *typing*, not about focus. It moves into `shortcuts.ts` because `ProjectTree` is no longer the only file that needs it, and `HTMLTextAreaElement` joins `HTMLInputElement` because there will be a textarea the day a panel grows a notes field.

### Rendering keys

The table stores `ArrowRight` because that is what `KeyboardEvent.key` says and the matcher has to compare against something real. The user should read `→`. Keeping the display transform in a separate function means the canonical form stays machine-shaped and the pretty form stays a leaf. `NAMED[p] ?? p` passes anything unmapped straight through, so `Ctrl`, `F5`, `Home` and every letter render as themselves.

---

## 11.5 — One handler in `App`, driven by the table

The imports gain the shortcut module, and the lazy split moves (§11.8 explains why):

```tsx
import { isTypingTarget, matches, shortcutFor } from './shortcuts';

// Settings pulls in WorkspaceManager and the shortcut table, none of which the
// launcher needs to start. The split used to sit on WorkspaceManager; now that
// Settings imports it, the split moves up to Settings or it silently vanishes.
const Settings = lazy(() => import('./components/Settings'));
```

`import Button from './components/Button'` goes — the modal that used it is gone. `App` stops destructuring `showWorkspaces` / `setShowWorkspaces` from `useLaunchActions` and the hook stops holding them (delete the `useState` and the two return fields in `src/hooks/useLaunchActions.ts`). The state that replaces it, plus the one value `App` did not already hold:

```tsx
	const { addWorkspace, removeWorkspace, openVSCode, openTerminal, openBoth } =
		useLaunchActions(selected, refresh);
	const { toast } = useToast();
	const [removeIndex, setRemoveIndex] = useState<number | null>(null);

	// Read once, on mount. The literal is only what the Shortcuts panel shows
	// for the frame before the command answers; prefs.json is the value.
	const [summonHotkey, setSummonHotkey] = useState('Ctrl+Alt+Space');
	useEffect(() => {
		invoke<string>('get_summon_hotkey').then(setSummonHotkey).catch(() => {});
	}, []);
```

Below the `searchRef` declaration (it reads it — nothing in this repo is declared ahead of its use):

```tsx
	// The search box keeps focus under the dialog's backdrop, and its own
	// Escape handler would clear the query on the keystroke that closes the
	// dialog. So opening Settings takes focus away and closing it gives it back.
	const [showSettings, setShowSettings] = useState(false);
	const openSettings = () => {
		searchRef.current?.blur();
		setShowSettings(true);
	};
	const closeSettings = () => {
		setShowSettings(false);
		searchRef.current?.focus();
	};
```

That comment records a bug the first cut had. The overlay is `fixed inset-0`, but a backdrop does not take focus: the search box keeps it, and the search box's own `Escape` (chapter 03: clear the query) fired on the same keystroke that closed the dialog. Press `Ctrl+,` with a filter typed, `Esc`, and the filter is gone. Two components each doing their documented job, and the composition lying. Blur on open and focus on close means `Esc` reaches `Settings` alone, and closing lands you back where the launcher always wants you.

Then, after the three launch wrappers, the handler that replaces chapter 06's two-branch effect:

```tsx
	// Delete acts on the selected project's workspace. With no selection there
	// is nothing unambiguous to remove, so it opens Settings rather than guess.
	const handleRemoveShortcut = () => {
		const idx = selected ? workspaces.indexOf(selected.workspace) : -1;
		if (idx >= 0) setRemoveIndex(idx);
		else openSettings();
	};

	// One handler, driven by the declared shortcut table. Everything here is
	// either modified or a non-typing key, so it all survives search focus —
	// which is where the summon hotkey leaves you. The order is the table's:
	// the bindings that work with nothing selected, then the ones that need one.
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const fire = (id: ShortcutId, run: () => void) => {
				if (!matches(e, shortcutFor(id))) return false;
				e.preventDefault();
				run();
				return true;
			};

			if (fire('focusSearch', () => searchRef.current?.select())) return;
			if (fire('clearSearch', () => setQuery(''))) return;
			if (fire('refresh', handleRefresh)) return;
			if (fire('settings', openSettings)) return;
			if (fire('quit', () => invoke('quit_app').catch(() => {}))) return;
			if (fire('addWorkspace', openSettings)) return;
			// Delete is the one bare typing key in the table: in the search box it
			// deletes a character, and that stays the search box's.
			if (!isTypingTarget(e) && fire('removeWorkspace', handleRemoveShortcut))
				return;

			// Ctrl+R is a second binding for refresh, kept because it is muscle
			// memory from the browser and costs nothing. The table maps one id to
			// one chord; an alias is written out here rather than widening the type.
			if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
				e.preventDefault();
				handleRefresh();
				return;
			}

			if (!selected) return;
			if (fire('openEditor', handleOpenVSCode)) return;
			if (fire('openTerminal', handleOpenTerminal)) return;
			if (fire('openBoth', handleOpenBoth)) return;
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selected, workspaces]);
```

`fire` is the shape that makes this readable: it does the match, the `preventDefault`, and the call, and returns whether it claimed the event. The caller reads as a table of intent — `if (fire('settings', openSettings)) return;` — with no key names in sight. Add a binding and you add one line here and one entry in `SHORTCUTS`, and there is exactly one place each can be wrong.

`preventDefault` runs only on a match. That is why it lives inside `fire` rather than at the top of the handler: an unmatched keystroke must reach the search box untouched, or the launcher stops being typeable.

Four things in that block are deliberate and easy to get wrong:

**The `if (!selected) return;` line.** Everything above it works with nothing selected; everything below needs a project. Putting the check between the two groups rather than inside each action means "needs a selection" is stated once, structurally, in the same order as the `needsSelection` flag in the table.

**`Delete` gets a guard the others do not.** Every other binding in this handler is either a chord or a key that produces no character (`F5`). `Delete` is a real editing key: in the search box it deletes the character after the caret, and the handler must not take that away. `isTypingTarget` is the same test the tree uses (§11.6), applied to the one entry that needs it. The Remove button's `Del` hint is therefore true whenever focus is not in the search box — after a click on a row, say — and the search box keeps its own key. That is the asymmetry §11.3 warned about, in the one place it is unavoidable, and the guard makes it a rule rather than an accident.

**`Ctrl+R` is hand-written, not a table entry.** It is a second accelerator for an action that already has one. The table maps *one* id to *one* `keys` string, and the honest options were to complicate the type into `keys: string | string[]` for a single case, or to write the alias out. The alias won, with a comment saying why it exists. **A single-declaration table is only as good as its willingness to say when something is outside it.** The alternative — quietly widening the type for one caller — makes every future reader wonder which shortcuts have hidden second bindings.

**The dependency array holds `selected` and `workspaces` and nothing else.** The handler closes over `handleRefresh`, the three launch wrappers and `openSettings`, which are plain arrow functions recreated on every render. With the React Compiler on (chapter 01) they are memoized where that is safe, but the effect must not be *taught* to re-subscribe on their identity — that is a listener torn down and re-attached on every render of the app. The array names the values whose *change* has to be observed: the selection the project actions act on, and the workspace list `Delete` indexes into.

### Wiring

The `showWorkspaces` modal block in the JSX collapses to:

```tsx
			<Suspense>
				<Settings
					{...{
						open: showSettings,
						onClose: closeSettings,
						workspaces,
						onAddWorkspace: addWorkspace,
						onRemoveWorkspace: (i: number) => setRemoveIndex(i),
						summonHotkey
					}}
				/>
			</Suspense>
```

and `ActionButtons`' two workspace props become `onAddWorkspace: openSettings` and `onRemoveWorkspace: handleRemoveShortcut` — the Remove *button* and the `Delete` *key* run the same function, which is the only way their behaviour can stay identical.

`Settings` is rendered unconditionally with an `open` prop rather than wrapped in `{showSettings && …}`. The component's own `if (!open) return null` does the hiding. That is what lets it own its `Escape` listener and its `localStorage` write without `App` coordinating them — and `lazy` still means the chunk is not fetched until the first render that actually needs it, because a component that returns `null` before its chunk arrives has nothing to show anyway.

---

## 11.6 — Tree navigation, and who owns which key

`src/components/ProjectTree.tsx` imports the three helpers:

```tsx
import { isTypingTarget, matches, shortcutFor } from '../shortcuts';
```

Two small helpers go in below `useImperativeHandle`, beside `navigate`. No `useCallback` — the compiler's job:

```tsx
	// Takes the state wanted rather than toggling: → always expands and ←
	// always collapses, and only Ctrl+Space computes the flip, at its call site.
	const setCollapsedFor = (ws: string, want: boolean) => {
		setCollapsed(prev => {
			const next = new Set(prev);
			if (want) next.add(ws);
			else next.delete(ws);
			return next;
		});
	};

	// Reads `visible` — the flattened, filtered list on screen — so Home and
	// End land on what you can see, not on the unfiltered project set.
	const jump = (to: 'top' | 'bottom') => {
		const target = to === 'top' ? visible[0] : visible[visible.length - 1];
		if (target) onSelect(target);
	};
```

`setCollapsedFor` takes the *desired* state rather than toggling, because three of the four callers know exactly what they want. A toggle-only helper would force `→` to read the current state and decide whether to act, which is how you get an expand key that collapses.

Then chapter 05's key→action map grows, and gains a second map for chords:

```tsx
	useEffect(() => {
		const launch = () => {
			if (selected) onLaunch(selected);
			else if (visible.length > 0) onLaunch(visible[0]);
		};
		const ws = selected?.workspace;
		// Bare navigation keys. While the search box has focus these belong to
		// it — it forwards ↑ ↓ ⏎ itself, and ← → Home End move its caret.
		const keys: Record<string, () => void> = {
			ArrowDown: () => navigate(1),
			ArrowUp: () => navigate(-1),
			ArrowRight: () => ws && setCollapsedFor(ws, false),
			ArrowLeft: () => ws && setCollapsedFor(ws, true),
			Home: () => jump('top'),
			End: () => jump('bottom'),
			Enter: launch
		};
		// Modifier combos are app-level and must still work while the search
		// box is focused — which is exactly where summon leaves you. A bare
		// letter is unreachable there, which is why every project action is
		// a combo.
		const combos: [ShortcutId, () => void][] = [
			['togglePin', () => selected && onTogglePin?.(selected)],
			['toggleWorkspace', () => ws && setCollapsedFor(ws, !collapsed.has(ws))]
		];
		const handler = (e: globalThis.KeyboardEvent) => {
			const modified = e.ctrlKey || e.metaKey || e.altKey;
			// Enter combos are project actions, owned by App's handler. Two
			// window listeners see every key; one of them renouncing the overlap
			// is what keeps the boundary from being a coin flip on effect order.
			if (e.key === 'Enter' && (modified || e.shiftKey)) return;
			if (modified) {
				const combo = combos.find(([id]) => matches(e, shortcutFor(id)));
				if (!combo) return;
				e.preventDefault();
				combo[1]();
				return;
			}
			if (isTypingTarget(e)) return;
			const action = keys[e.key];
			if (!action) return;
			e.preventDefault();
			action();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selected, visible, collapsed, navigate, onLaunch, onTogglePin]);
```

`collapsed` joins the dependency array. `Ctrl+Space` reads it to decide which way to flip, so a stale closure would make the toggle stick.

### Bare keys stay with the input — all of them

A tempting variant lets the arrows, `Home`, `End` and `Enter` through the typing guard, on the argument that they are not typing keys. This tree does not, and the difference is worth stating because it is a design choice, not an omission.

`↑`, `↓` and `⏎` already reach the tree while you type: `SearchBox` forwards them through `onArrow` and `onEnter` (chapter 03), and if the tree's window listener *also* acted on them, every keystroke would run twice — harmless only because `navigate` happens to be idempotent within one event. `←` and `→` in a text input move the caret, and `Home` / `End` jump it, and those are real losses: with `dev|go` typed, `←` should move the bar, not collapse a workspace three hundred pixels away. That variant needs a second `!typing` check on `Home` and `End` for exactly this reason, and still accepts the arrow-key trade.

The rule here is simpler and has no exceptions: **while an input has focus, a bare key is the input's.** What the search box wants the tree to know about, it forwards. Everything with a modifier is the app's, anywhere. After summon, `Ctrl+Space` toggles the workspace under the selection without leaving the search box — which is the §11.3 argument again, and the reason the table has a chord for it.

### Two handlers, one boundary

There are now two `window` `keydown` listeners: this one and `App`'s. `ProjectTree` owns *navigation* — the things that need `visible`, `collapsed` and `selected`, none of which `App` has. `App` owns *project actions* — the things that call `useLaunchActions`. Plain `Enter` is navigation-adjacent (open what is selected, or the first row if nothing is), so the tree keeps it. `Ctrl+Enter`, `Shift+Enter` and `Alt+Enter` are actions, so the tree explicitly declines them and lets them reach `App`.

Both listeners are on `window`, so both see every event; the boundary is enforced by that one early return rather than by event ordering. **When two components legitimately need the same global event, make one of them explicitly renounce the overlap.** The alternative is depending on which `useEffect` ran first.

Note `e.shiftKey` in the renunciation. `modified` deliberately excludes Shift — `Shift+ArrowDown` should still navigate — but `Shift+Enter` is a project action, and a renunciation that forgot Shift would let the tree launch "both" on the chord `App` is about to use for "terminal".

### The third listener

The same chord reached a third handler nobody had thought of. `SearchBox`'s `onKeyDown` forwards `Enter` to `onEnter`, and it checked the key, not the modifiers: `Ctrl+Enter` in the search box was a plain Enter to it. Verification in the running app (§11.9) showed `Ctrl+Enter` opening VS Code twice and a terminal once — `App` firing `openEditor` *and* `SearchBox` firing `openBoth`. In `src/components/SearchBox.tsx`, the first line of `handleKeyDown`:

```tsx
		// Bare keys only. Ctrl+Enter, Shift+Enter and Alt+Enter are project
		// actions declared in the shortcut table and owned by App's handler; if
		// this forwarded them as a plain Enter, one chord would launch twice.
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
```

The search box forwards bare keys and nothing else. Three listeners, and the rule is the same for all of them: the component that owns an event says so in code, and the others say the opposite.

---

## 11.7 — Hints that cannot lie

`src/components/ActionButtons.tsx` gains an import and a `shortcut` column:

```tsx
import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';

// Hints come from the shortcut table, not from strings typed here — a button
// that advertises a binding nobody registered is worse than one with no hint.
const BUTTONS: { key: string; label: string; shortcut?: ShortcutId }[] = [
	{ key: 'remove', label: 'Remove', shortcut: 'removeWorkspace' },
	{ key: 'add', label: 'Add', shortcut: 'addWorkspace' },
	{ key: 'refresh', label: 'Refresh', shortcut: 'refresh' },
	{ key: 'code', label: 'VS Code', shortcut: 'openEditor' },
	{ key: 'terminal', label: 'Terminal', shortcut: 'openTerminal' },
	{ key: 'both', label: 'Open Both', shortcut: 'openBoth' }
];
```

The `as const` from chapter 05 goes, and `handlers` becomes `Record<string, () => void>` — the row type is now an explicit interface, and a `key` that is not in `handlers` would be a missing entry rather than a type error. That is a small loss, accepted for the optional `shortcut`: a button without a keyboard equivalent is a perfectly normal thing, and both the `title` and the `<kbd>` handle its absence. The render:

```tsx
			{BUTTONS.map(({ key, label, shortcut }) => {
				const hint = shortcut ? prettyKeys(shortcutFor(shortcut)) : '';
				return (
					<Button
						key={key}
						variant='pill'
						className='gap-2'
						disabled={NEEDS_SELECTION.has(key) && !hasSelection}
						onClick={handlers[key]}
						title={hint ? `${label} — ${hint}` : label}
					>
						{label}
						{hint && (
							<kbd className='font-mono text-[10px] text-text-muted border border-border rounded px-1 py-px'>
								{hint}
							</kbd>
						)}
					</Button>
				);
			})}
```

The button stores a `ShortcutId`, never a key string. `shortcutFor` resolves it at render, `prettyKeys` makes it readable, and the type system makes an id that is not in the table a compile error. There is no path by which this button can display a binding that does not exist in `SHORTCUTS` — the second of the three readers, wired.

---

## 11.8 — The Settings shell, and its panel registry

Props first, in `types.d.ts` above `ConfirmDialogProps`:

```ts
/// A settings section. Later chapters add panels by adding to the registry in
/// Settings.tsx — the shell itself never changes.
interface SettingsPanel {
	id: string;
	label: string;
	render: () => React.ReactNode;
}

interface SettingsProps {
	open: boolean;
	onClose: () => void;
	workspaces: string[];
	onAddWorkspace: (path: string) => void;
	onRemoveWorkspace: (index: number) => void;
	summonHotkey: string;
}

interface ShortcutTableProps {
	summonHotkey: string;
}
```

One more variant on `Button`. The panel nav is a column of selectable items, and the selected one has to *look* selected — which the `ghost` variant cannot be talked into, because `bg-transparent` and `bg-bg-selected` set the same property and Tailwind emits them in an order a `className` cannot override. So the state moves off the class list and onto the element. In `src/components/Button.tsx` and `ButtonVariant`:

```tsx
	// A sidebar item; the selected one says so with aria-current="page".
	tab: 'justify-start px-3 py-1.5 text-sm font-medium rounded bg-transparent border-none text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary aria-[current=page]:bg-bg-selected aria-[current=page]:text-text-primary'
```

`aria-current='page'` is what a nav is supposed to say about its active item anyway; the variant only styles the attribute. The selection is declared once, as a fact about the element, and the CSS reads it — the same shape as the shortcut table, one level down.

Now `src/components/Settings.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { prettyKeys, SHORTCUTS } from '../shortcuts';
import Button from './Button';
import WorkspaceManager from './WorkspaceManager';

// Which panel you last looked at is frontend-only UI state, like sortMode:
// nothing in Rust reads it, so it never goes near prefs.json.
const LAST_PANEL = 'devgo.settingsPanel';

const kbd =
	'font-mono text-[11px] px-2 py-0.5 border border-border rounded bg-bg-panel text-text-primary';
const heading =
	'text-xs font-bold uppercase tracking-wider text-text-secondary mb-2';
```

The Shortcuts panel is the third reader, and it is almost nothing:

```tsx
/// The third reader of the shortcut table. Not one key name lives here.
const ShortcutTable = ({ summonHotkey }: ShortcutTableProps) => {
	const groups = [...new Set(SHORTCUTS.map(s => s.group))];
	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h4 className={heading}>Summon</h4>
				<div className='flex items-center justify-between py-1 text-sm'>
					<span className='text-text-secondary'>
						Show / hide DevGo from anywhere
					</span>
					<kbd className={kbd}>{prettyKeys(summonHotkey)}</kbd>
				</div>
				<p className='text-xs text-text-muted mt-1'>
					Rebinding this from the UI is not built yet — it lives in prefs.json
					for now.
				</p>
			</div>

			{groups.map(g => (
				<div key={g}>
					<h4 className={heading}>{g}</h4>
					{SHORTCUTS.filter(s => s.group === g).map(s => (
						<div
							key={s.id}
							className='flex items-center justify-between py-1 text-sm'
						>
							<span className='text-text-secondary'>
								{s.label}
								{s.needsSelection && (
									<span className='text-text-muted text-xs'>
										{' '}
										· needs a selection
									</span>
								)}
							</span>
							<kbd className={kbd}>{prettyKeys(s.keys)}</kbd>
						</div>
					))}
				</div>
			))}
		</div>
	);
};
```

`[...new Set(SHORTCUTS.map(s => s.group))]` derives the section headings from the data in declaration order, so a shortcut with a new `group` grows the panel a section with no edit here. `needsSelection` becomes the "· needs a selection" note — the flag exists on the type for exactly this, so that "why did nothing happen?" is answered in the place you go to look.

The summon hotkey gets its own block above the groups because it is a different *kind* of binding: OS-level, registered by Rust, and not something `matches` ever sees. `prettyKeys` still renders it, since the accelerator string shares the `Ctrl+Alt+Space` shape.

The paragraph under it is the honest bit. The read command shipped in §11.1; the write half has a working service and no editor. Rather than showing the value with no way to change it and letting you hunt for the missing button, the panel says where the value lives. **A read-only field that explains why it is read-only is a smaller lie than one that just sits there.**

### The registry

```tsx
const Settings = ({
	open,
	onClose,
	workspaces,
	onAddWorkspace,
	onRemoveWorkspace,
	summonHotkey
}: SettingsProps) => {
	// The registry. A later chapter adds a panel by adding an object here; the
	// nav, the persistence, Escape and the layout never learn what a panel holds.
	const panels: SettingsPanel[] = [
		{
			id: 'workspaces',
			label: 'Workspaces',
			render: () => (
				<WorkspaceManager
					{...{
						workspaces,
						onAdd: onAddWorkspace,
						onRemove: onRemoveWorkspace
					}}
				/>
			)
		},
		{
			id: 'shortcuts',
			label: 'Shortcuts',
			render: () => <ShortcutTable {...{ summonHotkey }} />
		}
	];

	const [active, setActive] = useState(
		() => localStorage.getItem(LAST_PANEL) ?? panels[0].id
	);
	const choose = (id: string) => {
		setActive(id);
		localStorage.setItem(LAST_PANEL, id);
	};

	// Registered only while open: the shell is mounted on every render, and a
	// closed dialog must not own a global key.
	useEffect(() => {
		if (!open) return;
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', esc);
		return () => window.removeEventListener('keydown', esc);
	}, [open, onClose]);

	if (!open) return null;

	// A stored id that no longer names a panel costs one click, not an empty pane.
	const current = panels.find(p => p.id === active) ?? panels[0];
```

A panel is `{ id, label, render }` and nothing else. Adding one — Editors & Terminals, Scanning, Appearance, each in a later slice — is one object in that array. The nav, the persistence, the Escape handling and the layout are all written against `SettingsPanel`, so they never learn what a panel contains.

This is the plan's reason for building the shell now rather than when the first panel needs it: the cost of building it now is one afternoon of layout. The cost of building it later is *also* one afternoon of layout, plus migrating however many standalone modals shipped in the meantime, each with its own slightly different close button. **When you can see six features coming that all need the same container, the container is cheapest before any of them exist.**

`render` is a function rather than a component reference so the panel closes over the props the shell was given. `find(...) ?? panels[0]` covers a `localStorage` value naming a panel that no longer exists.

An effect watching `open` and `active` could write `localStorage`; `choose` writes it at the click instead: the value changes in exactly one place, so that is where the side effect goes, and there is one effect fewer to reason about. Persisting in `localStorage` rather than `prefs.json` is the same judgement chapter 09 made for `sortMode`: which settings tab you last looked at is UI state nothing in Rust reads, and routing it through a command and a JSON file would buy exactly nothing.

### The shell

```tsx
	return (
		<div
			className='fixed inset-0 bg-black/60 flex items-center justify-center z-40'
			onClick={onClose}
		>
			<div
				className='bg-bg-secondary border border-border rounded-xl w-[min(760px,92vw)] h-[min(560px,88vh)] flex overflow-hidden shadow-2xl'
				onClick={e => e.stopPropagation()}
			>
				<nav className='w-44 shrink-0 border-r border-border bg-bg-primary/40 p-2 flex flex-col gap-1'>
					<h3 className='text-xs font-bold uppercase tracking-wider text-text-muted px-2 py-2'>
						Settings
					</h3>
					{panels.map(p => (
						<Button
							key={p.id}
							variant='tab'
							aria-current={p.id === active ? 'page' : undefined}
							onClick={() => choose(p.id)}
						>
							{p.label}
						</Button>
					))}
				</nav>

				<div className='flex-1 flex flex-col min-w-0'>
					<div className='flex-1 overflow-y-auto p-6'>{current.render()}</div>
					<div className='border-t border-border p-3'>
						<Button className='w-full' onClick={onClose}>
							Close
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
};

export default Settings;
```

`w-[min(760px,92vw)]` and `h-[min(560px,88vh)]` give a fixed size that still fits a small window — the old workspace modal was `w-screen h-screen`, which on a 900×720 launcher meant the modal was the app. A fixed-size dialog also means switching panels does not resize the window under your cursor. `e.stopPropagation()` on the inner div is what makes the backdrop `onClick={onClose}` safe.

### Lazy, and why it still is

`WorkspaceManager` was code-split in chapter 02 because it carries the folder picker and nothing about starting the launcher needs it. `Settings` now *imports* `WorkspaceManager` — so if `Settings` were imported normally, `WorkspaceManager` would come back into the main bundle through the side door and the split would silently evaporate. Moving the `lazy()` up one level to `Settings` keeps the boundary where it was and puts the shortcut panel behind it too.

**When you wrap a lazily-loaded component in a new one, the split moves to the wrapper or it disappears.** The bundle still builds, the app still works, and the only symptom is a first paint that is quietly heavier every release. `bun run build` is the check: `Settings-*.js` is its own chunk, and there is no `WorkspaceManager-*.js` beside it because it is inside.

---

> **Commit checkpoint** — the table and its first two readers, then the shell and the handler that wires it all:
>
> ```powershell
> git add src/shortcuts.ts src/types.d.ts src/components/ActionButtons.tsx src/components/ProjectTree.tsx src/components/SearchBox.tsx
> git commit -m "✅KEYBOARD: every binding declared once in shortcuts.ts — exact matching, tree nav from the table, hints on the action buttons"
> git add -A
> git commit -m "✅SETTINGS: panel registry shell with Workspaces + Shortcuts, one table-driven handler in App, lazy split moves up to Settings"
> git commit --allow-empty -m "✅STAGE: 11 keyboard"
> git checkout main && git merge 11.keyboard && git push origin 11.keyboard main
> ```

---

## 11.9 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun run build
bun tauri dev
```

`cargo test` still reports **26** — the one Rust change has no logic to test. `bun run build` lists `Settings-*.js` as a separate chunk (about 6 kB) and no `WorkspaceManager` chunk: it is inside.

Then the checks only a running app can answer. Every one of these was run against this chapter's build over the WebView2 debug port, with real key events.

**The shortcut that proves the whole design.** Summon DevGo with `Ctrl+Alt+Space`. Do not click anything — the caret is in the search box, which is the state §11.3 is about. Type enough to filter to a project, press `↓` to select it, then press **`Ctrl+Enter`**. VS Code opens, **and the search box still has focus with your query still in it.** That is the entire argument for modifier combos in one gesture: the action fired from the state the launcher always puts you in, without a mode, without blurring, without the key meaning something else. `Shift+Enter` opens one terminal. `Alt+Enter` opens both.

Now press a bare `t` in the same state. You get the letter `t` in the search box. That is correct and it is the thing that could not be made to also mean "terminal".

**Exact matching, and one launch per chord.** With a project selected, press `Ctrl+Shift+Enter`. **Nothing happens** — no editor, no terminal. That is §11.4 working: `Ctrl+Enter` refuses an event carrying a Shift it did not ask for. Then count what `Ctrl+Enter` opened: one editor window, no terminal. Before §11.6's `SearchBox` guard it was two editors and a terminal.

**Settings.** Press `Ctrl+,`. The shell opens on whichever panel you last used (first run: Workspaces), and focus has left the search box. Click Shortcuts: every binding is listed under its group heading, the four project actions and Remove workspace carry "· needs a selection", and the Summon row shows `Ctrl+Alt+Space` with the note about `prefs.json`. Press `Escape` — it closes, the filter you typed is still there, and the caret is back in the search box. Press `Ctrl+,` again: it reopens on **Shortcuts**, because `devgo.settingsPanel` is in `localStorage`. `Ctrl+N` and the Add and Remove buttons open the same shell.

**Hints match reality.** `Remove` reads `Del`, `Add` reads `Ctrl+N`, `Refresh` reads `F5`, `VS Code` reads `Ctrl+⏎`, `Terminal` reads `Shift+⏎`, `Open Both` reads `Alt+⏎`. Then, as a check on §11.2, change one `keys` value in `src/shortcuts.ts`, save, and watch the button hint, the tooltip and the Settings row all change together with no other edit.

**Tree navigation.** From the search box, `Ctrl+Space` collapses the selected project's workspace and `Ctrl+Space` again reopens it. `←` in the search box moves the caret one character — the list does not change. Click a row (focus leaves the input): `←` collapses, `→` expands. Type a filter first, then `End` and `Home` — they land on the last and first rows *of the filtered list*, not of the full one.

**Delete.** With the caret in the search box and a filter typed, `Delete` deletes a character and nothing else. Click a row, press `Delete`: the Remove Workspace confirmation opens for that project's workspace. `Escape` cancels it.

**`Ctrl+K`, `Ctrl+L`, `F5`, `Ctrl+R`, `Ctrl+S`, `Ctrl+Q`.** From anywhere: `Ctrl+K` selects the search text, `Ctrl+L` empties it, `F5` and `Ctrl+R` both show the scanning state, `Ctrl+S` pins the selection into the strip and `Ctrl+S` again unpins it, and `Ctrl+Q` exits the process.

---

## What you built

```
src-tauri/src/
├── commands.rs              ← get_summon_hotkey
└── lib.rs                   ← registered
src/
├── shortcuts.ts             ← NEW: SHORTCUTS, shortcutFor, matches, isTypingTarget, prettyKeys
├── types.d.ts               ← ShortcutId, ShortcutGroup, Shortcut; SettingsPanel, SettingsProps,
│                               ShortcutTableProps; ButtonVariant gains 'tab'
├── App.tsx                  ← one table-driven keydown handler, lazy Settings,
│                               summonHotkey read on mount, open/closeSettings own focus
├── hooks/useLaunchActions.ts ← showWorkspaces gone
└── components/
    ├── Settings.tsx         ← NEW: panel registry, ShortcutTable, panel persistence
    ├── Button.tsx           ← 'tab' variant, selected via aria-current
    ├── ActionButtons.tsx    ← BUTTONS carry a ShortcutId; <kbd> hints from the table
    ├── ProjectTree.tsx      ← setCollapsedFor, jump; keys + combos maps; isTypingTarget
    └── SearchBox.tsx        ← forwards bare keys only
```

> **The thread running through this half of Slice 3.** Every decision here is about **a claim the app makes to the user, and whether it can be wrong.** A button that names a keybinding is making a claim, so the keybinding is declared once and derived everywhere. A shortcut that fires on a chord it did not ask for is claiming an event it does not own, so matching is exact. A search box that forwards `Ctrl+Enter` as `Enter` is claiming a key that was declared for something else, so it stops. The keyboard is just the surface; the chapter is about not lying — and chapter 12 carries the same thread into a toast that says "stopped".

> **What this chapter deliberately did not build.** No rebind UI for the summon hotkey — the Shortcuts panel says so out loud rather than showing a field that does nothing. No `Ctrl+Backspace` for clearing a path segment, no `F2` rename and no `Ctrl+D` duplicate: a workspace is a bare path string, so renaming needs a display-name field on the model and duplicating one yields the same path twice. Both are data changes wearing keyboard-shortcut costumes. And no command palette: a palette is a *second* way to reach every action, which is only worth building once the first way is declared in one place — which is what this chapter just did.

---

→ Next: [12 — WSL Control](./12-wsl-control.md) (Slice 3, the other half), where a wedged distro is stopped from the title bar, and a timeout turns out to be the feature rather than padding around it.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [10 — Git at a Glance](./10-git.md)
