import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';
import Kbd from './Kbd';

// the footer's two doors have no key to show, and beside four neighbours
// that each end in a chip they read as unfinished text. a glyph fills the
// same trailing slot: one mark per item, a chip where there is a key and
// a drawing where there is not. muted on purpose - it stands where a key
// chip stands without being one, and at the pill's full ink it read as
// the louder of the two. house style - 24 viewBox, stroke 2, currentColor,
// so the six palettes reach it with no token of its own
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
		className='shrink-0 text-text-muted'
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

// the footer is the only surface where a target's name pays rent in
// pixels, so it says the name shorter than the rest of the app does.
// both rules choose a shorter name rather than clipping one: a trailing
// parenthetical — "Claude Code (Ubuntu-26.04)", the form editors.rs
// gives every in-distro target — becomes a muted suffix at the chip
// size, so which row runs in the distro is still on the screen, and the
// two seeded agent clis whose product name is unambiguous at one word
// lose the second word. a name devgo did not seed is left exactly as
// the user typed it: a forty-character one stays forty characters and
// the footer gives up a group to a second line sooner, which is the
// degradation it was built for. settings, the command palette and the
// context menus keep the stored name, and so does this button's tooltip
const SHORT_NAME: Record<string, string> = {
	'Claude Code': 'Claude',
	'Gemini CLI': 'Gemini'
};

const footerName = (name: string) => {
	const m = /^(.*) \(([^()]+)\)$/.exec(name);
	const base = m ? m[1] : name;
	return { short: SHORT_NAME[base] ?? base, suffix: m?.[2] };
};

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
		{/* the label is the first thing the footer gives up: every button
		    under it already names its target, and only a window wider than
		    the whole cluster has the room to say it twice. sr-only rather
		    than hidden, so a screen reader still hears which group it is
		    and, being absolutely positioned, it costs the row no width */}
		<span className='text-text-muted shrink-0 sr-only min-[2400px]:not-sr-only'>
			{label}
		</span>
		{items.map(t => {
			const isDefault = t.id === defaultId;
			// the group's key is the default's; an item may carry one of its own
			const key = t.shortcut ?? (isDefault ? shortcut : undefined);
			const title =
				t.blocked ?? (key ? `${t.title ?? t.name} — ${key}` : (t.title ?? t.name));
			const { short, suffix } = footerName(t.name);
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
					<span className='truncate leading-none'>{short}</span>
					{suffix && (
						<span className='leading-none text-11 text-text-muted shrink-0'>
							{suffix}
						</span>
					)}
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
// direct child of the footer, and a grower between the launch groups and
// the hints holds the two ends apart without stranding the hints
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
	//
	// the footer sheds these as it narrows, and the numbers are measured
	// rather than picked: with everything shown the row is ~2300px wide,
	// so a maximised 1920 screen (2133 css px at joy's 0.9 scale) has
	// never fit it — the two-line footer was not a small-window bug, it
	// was every window. without the list group it is ~1920, without the
	// surfaces group ~1480. each group carries the width it needs as a
	// literal class, because tailwind cannot see a class built at runtime.
	// what is lost is only ever a hint: every key below is in the shortcut
	// table, so the Shortcuts door — which never hides — still lists it,
	// and the summon hotkey is also set and shown in Settings. Search is
	// the cheapest of them twice over, since the box it focuses wears the
	// same chip
	const cluster: FooterHintGroup[] = [
		{
			id: 'list',
			show: 'hidden min-[2400px]:flex',
			items: [
				{ label: 'Pin', keys: prettyKeys(shortcutFor('togglePin')) },
				{ label: 'Search', keys: prettyKeys(shortcutFor('focusSearch')) }
			]
		},
		{
			id: 'surfaces',
			show: 'hidden min-[2000px]:flex',
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
			{/* a spacer, not ml-auto on the cluster. an auto margin pushed the
			    hints right on one line and then, the moment they wrapped to a
			    line of their own, ate that whole line and left them hanging off
			    the far edge with nothing to their left — an alignment nobody
			    chose. a zero-width grower is its own flex item, so it stays
			    behind on the first line and the wrapped cluster starts flush
			    left, under the groups it came from */}
			<span className='grow' aria-hidden='true' />
			{/* the key chips, then the doors; without them the discovery
			    surfaces are themselves undiscoverable. the rule rides with the
			    group it follows, so hiding a group hides its rule, and its own
			    mx-2 keeps the air equal on both sides of it. three steps of
			    space, the smallest innermost: 8px between items, 16px across a
			    rule, 24px between whole footer groups. at the old flat gap-4 the
			    space between Shortcuts and Help was the space between groups,
			    so the strip had no grain */}
			<div className='flex items-center gap-2 shrink-0'>
				{cluster.map((g, i) => (
					<div
						key={g.id}
						className={`items-center gap-2 shrink-0 ${g.show ?? 'flex'}`}
					>
						{g.items.map(h =>
							h.onClick ? (
								// a door wears the launch pill: name first, mark trailing,
								// the same box as a target above it. on this strip the
								// bordered box is the whole affordance
								<Button
									key={h.label}
									variant='launch'
									className='shrink-0'
									title={h.title}
									onClick={h.onClick}
								>
									<span className='leading-none'>{h.label}</span>
									{h.keys ? <Kbd>{h.keys}</Kbd> : h.icon}
								</Button>
							) : (
								// a fact, so no click — and now it does not offer one
								// either. same grammar and the same height, but no box:
								// no edge, no ground, nothing that lifts under the
								// pointer, and its name a step under a door's ink. these
								// are keys you already hold, not doors devgo is opening.
								// px-1 only so a bare word never sits against the edge of
								// the pill before it
								<span
									key={h.label}
									className='inline-flex items-center gap-1.5 shrink-0 h-9 px-1 text-text-secondary'
								>
									<span className='leading-none'>{h.label}</span>
									{h.keys ? <Kbd>{h.keys}</Kbd> : h.icon}
								</span>
							)
						)}
						{i < cluster.length - 1 && (
							<span
								className='w-px h-5 bg-border-strong shrink-0 mx-2'
								aria-hidden='true'
							/>
						)}
					</div>
				))}
			</div>
		</footer>
	);
};

export default StatusBar;
