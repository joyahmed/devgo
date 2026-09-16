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
	onPick,
	pulse
}: TargetGroupProps) => (
	<div className='flex items-center gap-1.5 shrink-0'>
		<span className='text-11 text-text-muted shrink-0'>
			{label}
		</span>
		{items.map(t => {
			// the same fact TargetManager shows as a badge, before the click. an
			// agent is a command on one side or the other; an editor or a
			// terminal is blocked on wsl only when it has no wsl form
			const blocked =
				t.kind === 'agent'
					? isWsl
						? !t.wsl_executable
						: !t.executable
					: isWsl && !t.wsl_args_template;
			const isDefault = t.id === defaultId;
			const title = blocked
				? t.kind === 'agent'
					? `${t.name} is not installed on this project's side`
					: `${t.name} has no WSL configuration, so it cannot open this project`
				: isDefault
					? `${t.name} — ${shortcut}`
					: t.name;
			return (
				<Button
					key={t.id}
					variant='target'
					className={`shrink-0 ${isDefault && pulse ? 'animate-pulse-once' : ''}`}
					aria-current={isDefault ? 'true' : undefined}
					disabled={!hasSelection || blocked}
					// the default launches with no id, so the Rust fallback chain
					// stays the one place that decides what default means
					onClick={() => onPick(isDefault ? undefined : t.id)}
					title={title}
				>
					<span className='truncate text-11 leading-none'>{t.name}</span>
					{isDefault && <Kbd>{shortcut}</Kbd>}
				</Button>
			);
		})}
	</div>
);

// the footer is the action bar. it was two strips, a launch row over a
// status footer, and the buttons said everything a hint could. pinned to
// the bottom: you aim at these from muscle memory while your eyes are
// still on the list, and expanding a workspace must not move them.
// when it runs out of width it wraps by whole groups: every group is a
// direct child of the footer, and the hints ml-auto onto the last line
const StatusBar = ({
	hasSelection,
	selectionIsWsl,
	editors,
	terminals,
	agents,
	defaults,
	onEditor,
	onTerminal,
	onAgent,
	onBoth,
	onManageTargets,
	onOpenPalette,
	onOpenHelp,
	reattach = false,
	pulse = null
}: StatusBarProps) => {
	const groups = [
		{
			label: 'Edit',
			items: editors,
			defaultId: defaults.editor,
			shortcut: prettyKeys(shortcutFor('openEditor')),
			onPick: onEditor,
			pulse: pulse === 'editor'
		},
		{
			label: reattach ? 'Reattach' : 'Terminal',
			items: terminals,
			defaultId: defaults.terminal,
			shortcut: prettyKeys(shortcutFor('openTerminal')),
			onPick: onTerminal,
			pulse: pulse === 'terminal'
		},
		// the footer must not grow an empty group
		...(agents.length > 0
			? [
					{
						label: 'Agent',
						items: agents,
						defaultId: defaults.agent,
						shortcut: prettyKeys(shortcutFor('openAgent')),
						onPick: onAgent,
						pulse: pulse === 'agent'
					}
				]
			: [])
	];
	const both = prettyKeys(shortcutFor('openBoth'));

	return (
		<footer className='flex flex-wrap items-center gap-x-6 gap-y-1.5 min-h-12 py-1.5 px-4 ground-chrome border-t border-border shrink-0 text-11 select-none'>
			{groups.map(g => (
				<TargetGroup
					key={g.label}
					{...{ ...g, isWsl: selectionIsWsl, hasSelection }}
				/>
			))}
			<Button
				variant='target'
				className={`shrink-0 ${pulse === 'both' ? 'animate-pulse-once' : ''}`}
				disabled={!hasSelection}
				onClick={onBoth}
				title={`Open Both — ${both}`}
			>
				<span className='text-11 leading-none'>Open Both</span>
				<Kbd>{both}</Kbd>
			</Button>
			<Button
				variant='ghost'
				className='text-11 px-2 shrink-0'
				onClick={onManageTargets}
				title='Add, remove or scan for editors and terminals'
			>
				Manage…
			</Button>
			{/* the palette's only visible door, and help beside it; without
			    them the discovery surfaces are themselves undiscoverable */}
			<div className='flex items-center gap-4 shrink-0 ml-auto'>
				<Button
					variant='ghost'
					className='gap-1.5 text-11 shrink-0 hover:bg-transparent hover:text-accent'
					title='Open the command palette'
					onClick={onOpenPalette}
				>
					<Kbd>{prettyKeys(shortcutFor('commandPalette'))}</Kbd>
					<span className='text-text-secondary leading-none'>Commands</span>
				</Button>
				<Button
					variant='ghost'
					className='gap-1.5 text-11 shrink-0 hover:bg-transparent hover:text-accent'
					title='Help'
					onClick={onOpenHelp}
				>
					<span className='text-11 leading-none font-semibold'>?</span>
					<span className='text-text-secondary leading-none'>Help</span>
				</Button>
			</div>
		</footer>
	);
};

export default StatusBar;
