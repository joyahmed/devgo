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

// the footer is the action bar. it was two strips, a launch row over a
// status footer, and the buttons said everything a hint could. pinned to
// the bottom: you aim at these from muscle memory while your eyes are
// still on the list, and expanding a workspace must not move them
const StatusBar = ({
	hasSelection,
	selectionIsWsl,
	editors,
	terminals,
	defaults,
	onEditor,
	onTerminal,
	onBoth,
	onManageTargets,
	onOpenPalette
}: StatusBarProps) => {
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
		<footer className='flex items-center justify-between gap-6 h-12 px-4 bg-bg-secondary border-t border-border shrink-0 text-[13px] select-none overflow-hidden'>
			<div className='flex items-center gap-4 min-w-0 overflow-hidden'>
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
					className='text-[11px] px-2 shrink-0'
					onClick={onManageTargets}
					title='Add, remove or scan for editors and terminals'
				>
					Manage…
				</Button>
			</div>
			{/* the palette's only visible door; without it the discovery
			    surface is itself undiscoverable */}
			<Button
				variant='ghost'
				className='gap-1.5 text-[13px] shrink-0 hover:bg-transparent hover:text-accent'
				title='Open the command palette'
				onClick={onOpenPalette}
			>
				<Kbd>{prettyKeys(shortcutFor('commandPalette'))}</Kbd>
				<span className='text-text-secondary leading-none'>Commands</span>
			</Button>
		</footer>
	);
};

export default StatusBar;
