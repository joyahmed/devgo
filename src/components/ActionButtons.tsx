import Button from './Button';

const BUTTONS = [
	{ key: 'remove', label: 'Remove' },
	{ key: 'add', label: 'Add' },
	{ key: 'code', label: 'VS Code' },
	{ key: 'terminal', label: 'Terminal' },
	{ key: 'both', label: 'Open Both' }
] as const;

const NEEDS_SELECTION = new Set(['code', 'terminal', 'both']);

const ActionButtons = ({
	hasSelection,
	onAddWorkspace,
	onRemoveWorkspace,
	onVSCode,
	onTerminal,
	onBoth
}: ActionButtonsProps) => {
	const handlers: Record<(typeof BUTTONS)[number]['key'], () => void> = {
		remove: onRemoveWorkspace,
		add: onAddWorkspace,
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
