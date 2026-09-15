import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';
import Kbd from './Kbd';

// every target visible, none behind a chevron. a split button was built
// first and rejected on sight: a launcher has three to six targets, and
// hiding four behind a dropdown saves space the row already has
const TargetGroup = ({
	label,
	items,
	defaultId,
	isWsl,
	hasSelection,
	shortcut,
	onPick
}: TargetGroupProps) => (
	<div className='flex items-center gap-1.5 min-w-0'>
		<span className='text-[10px] uppercase tracking-wider text-text-muted shrink-0'>
			{label}
		</span>
		{items.map(t => {
			// the same fact TargetManager shows as a badge, before the click
			const blocked = isWsl && !t.wsl_args_template;
			const isDefault = t.id === defaultId;
			const title = blocked
				? `${t.name} has no WSL configuration, so it cannot open this project`
				: isDefault
					? `${t.name} — ${shortcut}`
					: t.name;
			return (
				<Button
					key={t.id}
					variant='target'
					className='shrink-0'
					aria-current={isDefault ? 'true' : undefined}
					disabled={!hasSelection || blocked}
					// the default launches with no id, so the Rust fallback chain
					// stays the one place that decides what default means
					onClick={() => onPick(isDefault ? undefined : t.id)}
					title={title}
				>
					<span className='truncate leading-none'>{t.name}</span>
					{isDefault && <Kbd>{shortcut}</Kbd>}
				</Button>
			);
		})}
	</div>
);

const ActionButtons = ({
	hasSelection,
	selectionIsWsl,
	editors,
	terminals,
	defaults,
	onEditor,
	onTerminal,
	onBoth,
	onManageTargets
}: ActionButtonsProps) => {
	const groups = [
		{
			label: 'Edit',
			items: editors,
			defaultId: defaults.editor,
			shortcut: prettyKeys(shortcutFor('openEditor')),
			onPick: onEditor
		},
		{
			label: 'Terminal',
			items: terminals,
			defaultId: defaults.terminal,
			shortcut: prettyKeys(shortcutFor('openTerminal')),
			onPick: onTerminal
		}
	];
	const both = prettyKeys(shortcutFor('openBoth'));

	return (
		// wraps rather than scrolls: a second line stays readable
		<div className='flex flex-wrap items-center justify-center gap-x-5 gap-y-2 shrink-0'>
			{groups.map(g => (
				<TargetGroup
					key={g.label}
					{...{ ...g, isWsl: selectionIsWsl, hasSelection }}
				/>
			))}
			<Button
				variant='target'
				className='shrink-0'
				disabled={!hasSelection}
				onClick={onBoth}
				title={`Open Both — ${both}`}
			>
				<span className='leading-none'>Open Both</span>
				<Kbd>{both}</Kbd>
			</Button>
			<Button
				variant='ghost'
				className='text-[11px] px-2'
				onClick={onManageTargets}
				title='Add, remove or scan for editors and terminals'
			>
				Manage…
			</Button>
		</div>
	);
};

export default ActionButtons;
