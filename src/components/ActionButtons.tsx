import Button from './Button';

const BUTTONS = [
	{ key: 'remove', label: 'Remove' },
	{ key: 'add', label: 'Add' },
	{ key: 'refresh', label: 'Refresh' },
	{ key: 'code', label: 'VS Code' },
	{ key: 'terminal', label: 'Terminal' },
	{ key: 'both', label: 'Open Both' }
] as const;

// Refresh is deliberately absent: it is the way out of an empty list, so it must
// stay enabled when nothing is selected.
const NEEDS_SELECTION = new Set(['code', 'terminal', 'both']);

const ActionButtons = ({
	hasSelection,
	onAddWorkspace,
	onRemoveWorkspace,
	onVSCode,
	onTerminal,
	onBoth,
	onRefresh
}: ActionButtonsProps) => {
	const handlers: Record<(typeof BUTTONS)[number]['key'], () => void> = {
		remove: onRemoveWorkspace,
		add: onAddWorkspace,
		refresh: onRefresh,
		code: onVSCode,
		terminal: onTerminal,
		both: onBoth
	};

	return (
		<div className='flex justify-center gap-2.5 shrink-0 flex-wrap'>
			{BUTTONS.map(({ key, label }) => (
				<Button
					key={key}
					variant='pill'
					disabled={NEEDS_SELECTION.has(key) && !hasSelection}
					onClick={handlers[key]}
				>
					{label}
				</Button>
			))}
		</div>
	);
};

export default ActionButtons;
