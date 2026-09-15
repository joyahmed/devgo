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
	{ id: 'settings', keys: 'Ctrl+,', label: 'Open settings', group: 'Global' },
	{ id: 'textBigger', keys: 'Ctrl+=', label: 'Text bigger', group: 'Global' },
	{ id: 'textSmaller', keys: 'Ctrl+-', label: 'Text smaller', group: 'Global' },
	{ id: 'textReset', keys: 'Ctrl+0', label: 'Text size 100%', group: 'Global' },
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
