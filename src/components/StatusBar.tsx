import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';
import Kbd from './Kbd';

// the footer's two doors have no key to show, and beside four neighbours
// that each lead with a chip they read as unfinished text. a glyph fills
// the same leading slot: one mark per item, a chip where there is a key
// and a drawing where there is not. house style - 24 viewBox, stroke 2,
// currentColor, so the six palettes reach it with no token of its own
const FooterIcon = ({ children }: { children: React.ReactNode }) => (
	<svg
		width='14'
		height='14'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
		className='shrink-0'
		aria-hidden='true'
	>
		{children}
	</svg>
);

// a keyboard seen head on: the case, three keys, a spacebar
const KeyboardGlyph = () => (
	<FooterIcon>
		<rect x='2' y='6' width='20' height='13' rx='2' />
		<path d='M7 10.5h.01M12 10.5h.01M17 10.5h.01M8 15h8' />
	</FooterIcon>
);

// the question in a ring; stem and dot drawn apart so the gap survives
// the round cap at 14 px
const HelpGlyph = () => (
	<FooterIcon>
		<circle cx='12' cy='12' r='9.5' />
		<path d='M9.3 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 3.9' />
		<path d='M12 17.6h.01' />
	</FooterIcon>
);

// the same fact TargetManager shows as a badge, before the click. an
// agent is a command on one side or the other; an editor or a terminal
// is blocked on wsl only when it has no wsl form
const choiceOf = (t: LaunchTarget, isWsl: boolean): TargetChoice => ({
	id: t.id,
	name: t.name,
	blocked:
		t.kind === 'agent'
			? (isWsl ? !t.wsl_executable : !t.executable)
				? `${t.name} is not installed on this project's side`
				: undefined
			: isWsl && !t.wsl_args_template
				? `${t.name} has no WSL configuration, so it cannot open this project`
				: undefined
});

// every target visible, none behind a chevron. a split button was built
// first and rejected on sight: a launcher has three to six targets, and
// hiding four behind a dropdown saves space the row already has
const TargetGroup = ({
	label,
	items,
	defaultId,
	hasSelection,
	shortcut,
	onPick,
	pulse
}: TargetGroupProps) => (
	<div className='flex items-center gap-2 shrink-0'>
		<span className='text-text-muted shrink-0'>{label}</span>
		{items.map(t => {
			const isDefault = t.id === defaultId;
			// the group's key is the default's; an item may carry one of its own
			const key = t.shortcut ?? (isDefault ? shortcut : undefined);
			const title =
				t.blocked ?? (key ? `${t.title ?? t.name} — ${key}` : (t.title ?? t.name));
			return (
				<Button
					key={t.id}
					variant='launch'
					className={`shrink-0 ${isDefault && pulse ? 'animate-pulse-once' : ''}`}
					aria-current={isDefault ? 'true' : undefined}
					disabled={!hasSelection || Boolean(t.blocked)}
					// the default launches with no id, so the Rust fallback chain
					// stays the one place that decides what default means
					onClick={() => onPick(isDefault ? undefined : t.id)}
					title={title}
				>
					<span className='truncate leading-none'>{t.name}</span>
					{key && <Kbd>{key}</Kbd>}
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
	otherAgentId,
	onEditor,
	onTerminal,
	onAgent,
	onBoth,
	onOpenPalette,
	summonHotkey,
	onOpenShortcuts,
	onOpenHelp,
	reattach = false,
	pulse = null,
	server = null,
	serverHosts = [],
	onServerHost,
	onServerTmux,
	onServerAttach
}: StatusBarProps) => {
	const choices = (list: LaunchTarget[]) =>
		list.map(t => choiceOf(t, selectionIsWsl));
	const terminalKey = prettyKeys(shortcutFor('openTerminal'));
	// a server row: one group, its local hosts, then the attach view, and
	// the terminal key opens the default host. the remote half is the
	// chip beside it
	const ATTACH = 'attach';
	const groups = server
		? [
				{
					label: 'Terminal',
					items: [
						...serverHosts,
						{
							id: ATTACH,
							name: 'Attach here',
							title: `${server.name}'s tmux session in a pane under the lanes — ${prettyKeys(shortcutFor('attach'))}`,
							blocked: server.tmux ? undefined : 'tmux on the box is off'
						}
					],
					defaultId: defaults.terminal,
					shortcut: terminalKey,
					onPick: (id?: string) =>
						id === ATTACH
							? onServerAttach?.(server)
							: onServerHost?.(
									serverHosts.find(h => h.id === (id ?? defaults.terminal)) ??
										serverHosts[0]
								),
					pulse: pulse === 'terminal'
				}
			]
		: [
				{
					label: 'Editor',
					items: choices(editors),
					defaultId: defaults.editor,
					shortcut: prettyKeys(shortcutFor('openEditor')),
					onPick: onEditor,
					pulse: pulse === 'editor'
				},
				{
					label: reattach ? 'Reattach' : 'Terminal',
					items: choices(terminals),
					defaultId: defaults.terminal,
					shortcut: terminalKey,
					onPick: onTerminal,
					pulse: pulse === 'terminal'
				},
				// the footer must not grow an empty group
				...(agents.length > 0
					? [
							{
								label: 'Agent',
								// the other agent carries its own key beside the default's
								items: choices(agents).map(c =>
									c.id === otherAgentId
										? { ...c, shortcut: prettyKeys(shortcutFor('openAgentAlt')) }
										: c
								),
								defaultId: defaults.agent,
								shortcut: prettyKeys(shortcutFor('openAgent')),
								onPick: onAgent,
								pulse: pulse === 'agent'
							}
						]
					: [])
			];
	const both = prettyKeys(shortcutFor('openBoth'));
	// the right end, in three groups with a rule between them: the keys
	// that act on the list, the keys that open a surface, and the two
	// doors that have no key. ↑↓ and ⏎ used to lead it and were dropped —
	// arrow keys and enter in a list are the one thing nobody looks up,
	// and their chips cost the room the rest needed to grow.
	// the first group hides under 1400, where the footer has no width and
	// the palette still lists them
	const cluster: FooterHintGroup[] = [
		{
			id: 'list',
			wide: true,
			items: [
				{ label: 'Pin', keys: prettyKeys(shortcutFor('togglePin')) },
				{ label: 'Search', keys: prettyKeys(shortcutFor('focusSearch')) }
			]
		},
		{
			id: 'surfaces',
			items: [
				{
					label: 'Commands',
					title: 'Open the command palette',
					keys: prettyKeys(shortcutFor('commandPalette')),
					onClick: onOpenPalette
				},
				// the summon hotkey is shown nowhere else, and it is the
				// door into the whole app. a fact, so no click
				{ label: 'Summon', keys: prettyKeys(summonHotkey) }
			]
		},
		{
			id: 'doors',
			items: [
				{
					label: 'Shortcuts',
					title: 'View all keyboard shortcuts',
					icon: <KeyboardGlyph />,
					onClick: onOpenShortcuts
				},
				{
					label: 'Help',
					title: 'Help',
					icon: <HelpGlyph />,
					onClick: onOpenHelp
				}
			]
		}
	];

	return (
		<footer className='flex flex-wrap items-center gap-x-6 gap-y-1.5 min-h-12 py-1.5 px-4 ground-chrome border-t border-border shrink-0 text-13 select-none'>
			{groups.map(g => (
				<TargetGroup
					key={g.label}
					{...{ ...g, hasSelection: server ? true : hasSelection }}
				/>
			))}
			{server ? (
				// the remote half: a tmux session on the box, or its plain login
				// shell. the server's own flag, so it holds across launches
				<Button
					variant='launch'
					className='shrink-0'
					aria-pressed={server.tmux}
					onClick={() => onServerTmux?.(server, !server.tmux)}
					title={
						server.tmux
							? `Attaches a tmux session on ${server.name}. Click for a plain login shell`
							: `A plain login shell on ${server.name}. Click to attach a tmux session there`
					}
				>
					<span className='leading-none'>tmux on the box</span>
					<span className='leading-none text-text-muted'>
						{server.tmux ? 'on' : 'off'}
					</span>
				</Button>
			) : (
				<Button
					variant='launch'
					className={`shrink-0 ${pulse === 'both' ? 'animate-pulse-once' : ''}`}
					disabled={!hasSelection}
					onClick={onBoth}
					title={`Open both — ${both}`}
				>
					<span className='leading-none'>Open both</span>
					<Kbd>{both}</Kbd>
				</Button>
			)}
			{/* the key chips, then the doors; without them the discovery
			    surfaces are themselves undiscoverable. the rule rides with
			    the group it follows, so hiding a group hides its rule */}
			<div className='flex items-center gap-4 shrink-0 ml-auto'>
				{cluster.map((g, i) => (
					<div
						key={g.id}
						className={`items-center gap-4 shrink-0 ${g.wide ? 'hidden min-[1400px]:flex' : 'flex'}`}
					>
						{g.items.map(h =>
							h.onClick ? (
								<Button
									key={h.label}
									variant='ghost'
									className='gap-1.5 shrink-0 hover:bg-transparent hover:text-accent'
									title={h.title}
									onClick={h.onClick}
								>
									{h.keys ? <Kbd>{h.keys}</Kbd> : h.icon}
									<span className='text-text-secondary leading-none'>{h.label}</span>
								</Button>
							) : (
								<span key={h.label} className='inline-flex items-center gap-1.5 shrink-0'>
									{h.keys ? <Kbd>{h.keys}</Kbd> : h.icon}
									<span className='text-text-secondary leading-none'>{h.label}</span>
								</span>
							)
						)}
						{i < cluster.length - 1 && (
							<span className='w-px h-5 bg-border-strong shrink-0' aria-hidden='true' />
						)}
					</div>
				))}
			</div>
		</footer>
	);
};

export default StatusBar;
