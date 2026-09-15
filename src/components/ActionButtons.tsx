import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';

// Hints come from the shortcut table, not from strings typed here — a button
// that advertises a binding nobody registered is worse than one with no hint.
const BUTTONS: { key: string; label: string; shortcut?: ShortcutId }[] = [
	{ key: 'remove', label: 'Remove', shortcut: 'removeWorkspace' },
	{ key: 'add', label: 'Add', shortcut: 'addWorkspace' },
	{ key: 'refresh', label: 'Refresh', shortcut: 'refresh' },
	{ key: 'code', label: 'Editor', shortcut: 'openEditor' },
	{ key: 'terminal', label: 'Terminal', shortcut: 'openTerminal' },
	{ key: 'both', label: 'Open Both', shortcut: 'openBoth' }
];

// Refresh is deliberately absent: it is the way out of an empty list, so it must
// stay enabled when nothing is selected.
const NEEDS_SELECTION = new Set(['code', 'terminal', 'both']);

const ActionButtons = ({
	hasSelection,
	onAddWorkspace,
	onRemoveWorkspace,
	onEditor,
	onTerminal,
	onBoth,
	onRefresh
}: ActionButtonsProps) => {
	const handlers: Record<string, () => void> = {
		remove: onRemoveWorkspace,
		add: onAddWorkspace,
		refresh: onRefresh,
		code: onEditor,
		terminal: onTerminal,
		both: onBoth
	};

	return (
		<div className='flex justify-center gap-2.5 shrink-0 flex-wrap'>
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
		</div>
	);
};

export default ActionButtons;
