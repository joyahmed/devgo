import { isMac } from './platform';

/// Every keyboard binding in DevGo, declared once.
///
/// Three things read this list: the handler that binds them, the hints rendered
/// on buttons, and the Settings → Shortcuts panel. Declaring them anywhere else
/// guarantees the three drift apart — a shortcut the UI advertises but does not
/// bind is worse than one it never mentions.
export const SHORTCUTS: Shortcut[] = [
	{
		id: 'commandPalette',
		keys: 'Ctrl+Shift+P',
		label: 'Command palette',
		group: 'Global'
	},
	{ id: 'focusSearch', keys: 'Ctrl+K', label: 'Focus search', group: 'Global' },
	{
		id: 'focusGithubSearch',
		keys: 'Ctrl+G',
		label: 'Focus GitHub search',
		group: 'Global'
	},
	{ id: 'clearSearch', keys: 'Ctrl+L', label: 'Clear search', group: 'Global' },
	{ id: 'refresh', keys: 'F5', label: 'Refresh projects', group: 'Global' },
	// the browser's habit. matched by hand in the key handler since 11, so
	// settings never listed it: a key not in the table is a key nobody sees
	{
		id: 'refreshAlt',
		keys: 'Ctrl+R',
		label: 'Refresh projects (browser habit)',
		group: 'Global'
	},
	{ id: 'settings', keys: 'Ctrl+,', label: 'Open settings', group: 'Global' },
	{ id: 'textBigger', keys: 'Ctrl+=', label: 'Text bigger', group: 'Global' },
	{ id: 'textSmaller', keys: 'Ctrl+-', label: 'Text smaller', group: 'Global' },
	{ id: 'textReset', keys: 'Ctrl+0', label: 'Text size 100%', group: 'Global' },
	{ id: 'quit', keys: 'Ctrl+Q', label: 'Quit DevGo', group: 'Global' },

	// bound by the tree, not the handler: they are here so the footer's
	// chips and Settings › Shortcuts can read them
	{
		id: 'moveUp',
		keys: 'ArrowUp',
		label: 'Move selection up',
		group: 'Navigation'
	},
	{
		id: 'moveDown',
		keys: 'ArrowDown',
		label: 'Move selection down',
		group: 'Navigation'
	},
	{
		id: 'openSelected',
		keys: 'Enter',
		label: 'Open selected project',
		group: 'Navigation'
	},
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
		id: 'openAgent',
		keys: 'Ctrl+Alt+Enter',
		label: 'Open in agent',
		group: 'Project',
		needsSelection: true
	},
	// the second agent: the WSL form of Claude Code beside the Windows one
	// is what a WSL project needs, and the default's key never reached it
	{
		id: 'openAgentAlt',
		keys: 'Ctrl+Alt+Shift+Enter',
		label: 'Open in the other agent',
		group: 'Project',
		needsSelection: true
	},
	{
		id: 'revealExplorer',
		keys: 'Ctrl+Shift+E',
		label: 'Reveal in Explorer',
		macLabel: 'Reveal in Finder',
		group: 'Project',
		needsSelection: true
	},
	{
		id: 'copyWinPath',
		keys: 'Ctrl+Shift+C',
		label: 'Copy Windows path',
		macLabel: 'Copy path',
		group: 'Project',
		needsSelection: true
	},
	{
		id: 'copyWslPath',
		keys: 'Ctrl+Shift+W',
		label: 'Copy WSL path',
		windowsOnly: true,
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
	// menu-only since 15 and 32 for no reason anyone recorded
	{
		id: 'runScript',
		keys: 'Ctrl+Shift+D',
		label: 'Run dev script…',
		group: 'Project',
		needsSelection: true
	},
	{
		id: 'openRemote',
		keys: 'Ctrl+Shift+G',
		label: 'Open remote in browser',
		group: 'Project',
		needsSelection: true
	},
	// the attach view: the row's session in a pane under the lanes; with
	// the pane open the same key detaches
	{
		id: 'attach',
		keys: 'Ctrl+Shift+A',
		label: 'Attach session here / detach',
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
	},
	// ctrl+shift+e reveals the project; its workspace is one modifier over
	{
		id: 'revealWorkspace',
		keys: 'Ctrl+Alt+E',
		label: 'Reveal workspace in Explorer',
		macLabel: 'Reveal workspace in Finder',
		group: 'Workspace',
		needsSelection: true
	},
	{
		id: 'moveWorkspaceUp',
		keys: 'Alt+ArrowUp',
		label: 'Move workspace up',
		group: 'Workspace',
		needsSelection: true
	},
	{
		id: 'moveWorkspaceDown',
		keys: 'Alt+ArrowDown',
		label: 'Move workspace down',
		group: 'Workspace',
		needsSelection: true
	}
];

export const shortcutFor = (id: ShortcutId): string =>
	SHORTCUTS.find(s => s.id === id)?.keys ?? '';

// the action's name on this desktop. the context menus, the palette and
// the settings panel all ask here, so reveal in finder is decided once
export const labelFor = (id: ShortcutId): string => {
	const s = SHORTCUTS.find(x => x.id === id);
	if (!s) return '';
	return (isMac && s.macLabel) || s.label;
};

// does this binding mean anything on this desktop? a shortcut the table
// declares but the desktop cannot honour must not be advertised
export const isAvailable = (s: Shortcut): boolean => !(isMac && s.windowsOnly);

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

// modifiers as this desktop's user reads them. the table stays canonical
// (Ctrl+…, which matches already accepts from a cmd press); only what is
// shown changes, so matches never sees a translated string. words, not
// ⌘ and ⌥: both glyphs are hairline outlines in jetbrains mono at 11px,
// the class 09 measured vanishing. the summon hotkey arrives from tauri
// already spelled Cmd, so it maps to itself
const MAC_MODIFIER: Record<string, string> = { Ctrl: 'Cmd', Cmd: 'Cmd', Alt: 'Opt' };
export const displayKeys = (keys: string): string =>
	isMac
		? keys
				.split('+')
				.map(p => MAC_MODIFIER[p] ?? p)
				.join('+')
		: keys;

/// Compact form for rendering next to a button. The table stores what
/// `KeyboardEvent.key` says; the user reads `→`. Nothing parses `→` back.
/// Every hint in the app comes through here, so this is the one place the
/// desktop's modifier names apply.
export const prettyKeys = (keys: string): string =>
	displayKeys(keys)
		.split('+')
		.map(p => NAMED[p] ?? p)
		.join('+');

// the keys that stay the app's while the attach pane has focus: the
// palette and the attach key itself. every other key is the shell's,
// ctrl+l and ctrl+r included
export const PANE_KEYS: ShortcutId[] = ['commandPalette', 'attach'];

export const paneOwns = (e: KeyboardEvent): boolean =>
	e.target instanceof Element &&
	e.target.closest('[data-attach]') !== null &&
	!PANE_KEYS.some(id => matches(e, shortcutFor(id)));
