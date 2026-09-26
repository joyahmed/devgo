import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

// ⭐ the footer's order of surrender, and the ONLY place it is written
// down: the strip gives up the front of this list first and takes the
// last thing back first, so re-ordering what goes when is a one-line edit
// here. every entry is either a target group's id-free name the render
// knows ('chips', 'labels') or the id of a hint group in the cluster
// below, which is what makes step 2 need no class of its own.
//
// chips FIRST, because a key chip is the only thing on this strip whose
// loss costs no information: the button it sits in stays visible, named,
// clickable and tooltipped with that very key, and Settings › Shortcuts
// lists all of them. nothing else here is that cheap.
//
// the two hint groups NEXT, Pin/Search before Commands/Summon. these
// words exist nowhere else on the strip, so hiding one deletes it for
// anyone who has not memorised the key — but Shortcuts, which never
// sheds, is one hop away and lists every one of them, so the loss is
// recoverable and the chips' loss is not even a loss.
//
// ⛔ labels LAST, and they must stay last: `Terminal` is ALSO A TARGET
// NAME. 15d157a took these at every width on the reasoning that they were
// decoration, and on joy's mac the strip then read
// "VS Code · Zed · Terminal · Ghostty · Claude" — a flat list in which
// Terminal looks like a peer of Zed and Claude is stranded with nothing
// marking it an agent. the labels are the only thing grouping that row.
// do not tidy them forward for symmetry with the chips.
//
// Shortcuts and Help are absent from this list on purpose, not by
// omission: they are the door back to everything in step 2, so they never
// shed at any width
const SHED_ORDER = ['chips', 'list', 'surfaces', 'labels'] as const;

// a settle pass is a handful of steps — one per entry, at most one undone
// — and it cannot be more than that, because at a fixed width the level
// is a pure function of the widths measured at it (see settle below). the
// cap is the belt under that braces: a bug upstream stops the strip, it
// does not spin the main thread
const STEP_CAP = SHED_ORDER.length * 2 + 4;

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
	pulse,
	showLabel = true,
	showKeys = true
}: TargetGroupProps) => (
	<div className='flex items-center gap-2 shrink-0'>
		{/* the label is the LAST thing the footer gives up, not the first:
		    `Terminal` is also the name of a target, so without these words
		    the strip is a flat list of five apps. it went at every width in
		    15d157a on the reasoning that it was decoration, and two
		    breakpoints before that — min-[2400px], a viewport literal that
		    could never match on a 1920-point mac panel. neither asked the
		    only honest question, which is whether this line has run out of
		    room; the footer now measures that and tells us (see settle).
		    sr-only rather than hidden when it does go, so a screen reader
		    still hears which group it is and, being absolutely positioned,
		    it costs the row no width */}
		<span className={`text-text-muted shrink-0 ${showLabel ? '' : 'sr-only'}`}>
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
					{/* the first thing the footer sheds. the title above keeps the
					    key either way, so a chip dropped here is still readable on
					    hover and still listed in Settings › Shortcuts */}
					{key && showKeys && <Kbd>{key}</Kbd>}
				</Button>
			);
		})}
	</div>
);

// the footer is the action bar. it was two strips, a launch row over a
// status footer, and the buttons said everything a hint could. pinned to
// the bottom: you aim at these from muscle memory while your eyes are
// still on the list, and expanding a workspace must not move them.
// it is one centred row of a measured width, and it stays one row: when
// the room runs out it gives up a step of SHED_ORDER rather than a line,
// and wrapping by whole groups is only the floor under that, for a window
// narrower than the strip can shed its way into
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
	// the first two groups' ids are entries in SHED_ORDER: that is the
	// whole of how they hide. three attempts to gate them on a number have
	// now shipped wrong — min-[2400px] and min-[2000px] asked the viewport,
	// which on a 1920-point mac panel could not match at any window size,
	// so Pin, Search, Commands and Summon were not hidden until you
	// widened, they were gone; and the container queries that replaced them
	// asked the right element but still against a literal, 56rem for a
	// cluster that measures 670px at joy's real window, which left the same
	// two items unreachable at any width he can use. a threshold the author
	// picks is a guess about a machine the author cannot see. the footer
	// now measures the room it has and sheds only when it has actually run
	// out (see settle), so these are gone only while they genuinely do not
	// fit — and the two doors never go, which is what keeps that loss
	// recoverable: Shortcuts lists every binding here, and the summon
	// hotkey is also set and shown in Settings
	const hints: FooterHintGroup[] = [
		{
			id: 'list',
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
	// how many entries of SHED_ORDER the strip has had to give up
	const [shed, setShed] = useState(0);
	const gone = (what: (typeof SHED_ORDER)[number] | string) => {
		const i = SHED_ORDER.indexOf(what as (typeof SHED_ORDER)[number]);
		return i >= 0 && i < shed;
	};
	const footerRef = useRef<HTMLElement>(null);
	const stripRef = useRef<HTMLDivElement>(null);
	const clusterRef = useRef<HTMLDivElement>(null);
	// the width the strip ACTUALLY needed at each level, measured at the
	// instant that level was given up. taking a level back asks for its own
	// number again rather than guessing at one, which is the whole of why
	// this cannot oscillate: we shed level L only when the room is under
	// need[L] - 1, and we restore it only when the room is need[L] or more,
	// so the two conditions cannot both hold at one width and the level is
	// a pure function of the room
	const need = useRef<number[]>([]);
	// what those numbers are numbers OF: the names on the strip, the keys
	// in the chips, and the root font size the text-scale knob moves. when
	// this changes they are lies, so they go and the strip starts over from
	// nothing shed. it is built from props and not from the dom on purpose:
	// the dom's text changes every time a chip sheds, which would reset the
	// cache in a loop
	const sig = useRef('');
	const steps = useRef(0);
	const settleRef = useRef<() => void>(null);

	const settle = () => {
		const footer = footerRef.current;
		const strip = stripRef.current;
		const cluster = clusterRef.current;
		if (!footer || !strip || !cluster) return;
		const fs = getComputedStyle(footer);
		const stamp = JSON.stringify([
			fs.fontSize,
			groups.map(g => [g.label, g.shortcut, g.items.map(i => [i.name, i.shortcut])]),
			both,
			hints.map(g => [g.id, g.items.map(h => [h.label, h.keys])])
		]);
		if (stamp !== sig.current) {
			sig.current = stamp;
			need.current = [];
			steps.current = 0;
			if (shed > 0) {
				setShed(0);
				return;
			}
		}
		// the width the strip wants on one line, not the width it happens to
		// occupy: every child is shrink-0, so its box is its natural size even
		// on a wrapped line, and the gaps come from the computed style rather
		// than from a literal so the text-scale knob cannot lie to us.
		// getBoundingClientRect, not offsetWidth: eight children rounded to
		// whole pixels is up to 4px of error, which is wider than the dead
		// band below
		const wide = (el: Element) => el.getBoundingClientRect().width;
		const ss = getComputedStyle(strip);
		const cs = getComputedStyle(cluster);
		const gap = parseFloat(ss.columnGap) || 0;
		// the cluster's box is its content until the day that content wraps
		// inside it, and on that day the box is a lie, so it is summed from
		// its groups either way. a display:none group takes neither width nor
		// gap, hence the filter
		const shown = [...cluster.children].filter(c => wide(c) > 0);
		const clusterWants =
			shown.reduce((w, c) => w + wide(c), 0) +
			(parseFloat(cs.columnGap) || 0) * Math.max(shown.length - 1, 0);
		// ⚠️ every child of the strip counts and every one of them is asked
		// for its own natural box — which is only true because none of them
		// grows. a grower's box is a function of the room it was given, and a
		// room-shaped number inside a natural width is the circular
		// measurement all over again: the spacer this replaced grew to fill a
		// wrapped line, came out ~300px too wide, and the strip shed two steps
		// more than it had to and would not take them back until 2560
		const kids = [...strip.children];
		const wants =
			kids.reduce((w, c) => w + (c === cluster ? clusterWants : wide(c)), 0) +
			gap * Math.max(kids.length - 1, 0);
		const room =
			footer.clientWidth - parseFloat(fs.paddingLeft) - parseFloat(fs.paddingRight);
		// 1px of dead band, for subpixel text at a fractional device ratio
		if (wants > room + 1 && shed < SHED_ORDER.length) {
			need.current[shed] = wants;
			if (++steps.current < STEP_CAP) setShed(shed + 1);
			return;
		}
		const back = need.current[shed - 1];
		if (shed > 0 && back !== undefined && back <= room) {
			if (++steps.current < STEP_CAP) setShed(shed - 1);
			return;
		}
		// the strip fits and has nothing to take back: the walk is over, so
		// the cap starts again from here. without this a later pass that has
		// to shed two more steps could inherit a spent budget
		steps.current = 0;
	};

	// one step per pass, and a pass runs after every render: shedding a chip
	// changes no box the observer watches, so the walk down the list has to
	// be driven from here. a layout effect, so the whole walk lands before
	// the browser paints and nobody sees an intermediate strip
	useLayoutEffect(() => {
		settleRef.current = settle;
		settle();
	});

	useEffect(() => {
		const footer = footerRef.current;
		if (!footer) return;
		// ⭐ the observer cannot feed itself: the footer's width is its
		// parent's, set by the window, and nothing this component hides can
		// change it. so a resize here is always news from outside, never an
		// echo of our own shedding — which is what keeps the loop from
		// existing rather than merely damping it
		const ro = new ResizeObserver(() => {
			steps.current = 0;
			settleRef.current?.();
		});
		ro.observe(footer);
		// a key chip is jetbrains mono with font-display: swap, so every
		// width measured before the file lands is a width of the fallback.
		// clearing the stamp makes the next pass throw the cache away
		document.fonts?.ready.then(() => {
			sig.current = '';
			steps.current = 0;
			settleRef.current?.();
		});
		return () => ro.disconnect();
	}, []);

	return (
		<footer
			ref={footerRef}
			// what the strip has given up, in the order it gave it up. three
			// slices have now shipped a confident wrong claim about this
			// footer, so the shed is readable from the dom: a session measures
			// it with one attribute read instead of inferring it from class
			// names
			data-shed={SHED_ORDER.slice(0, shed).join(' ') || 'none'}
			className='flex items-center min-h-12 py-1.5 px-4 ground-chrome border-t border-border shrink-0 text-13 select-none'
		>
			{/* ⭐ the strip has a WIDTH now, and the footer is only the room
			    around it. it used to be the footer: one flex row edge to edge,
			    which on joy's maximised mac put several hundred px of dead air
			    between Open both and the first hint and then, one notch
			    narrower, snapped into two rows with the hints alone on the
			    second — "the most awkward thing in the ui", and he is right,
			    because a row that fills whatever width exists has no shape of
			    its own.
			    w-fit is what closes the dead gap: the strip is as wide as its
			    contents and mx-auto centres it, so at 2560 it is the same strip
			    as at 1686, standing in the middle, rather than the same items
			    pulled apart. justify-center is the other half of that, and it
			    is the half that only shows when the strip has run out of shed
			    and wrapped: a wrapped line is laid out in a box the full width
			    of the window, so without it the second row sits flush left
			    under a centred first row — "not centered in smaller screen",
			    measured at 723px. ⛔ it also supersedes the flush-LEFT wrapped
			    line 15d157a aimed at: flush left was the answer to ml-auto
			    stranding a wrapped line flush right, and centring answers that
			    better. there is deliberately NO grower in here and no minimum
			    width: either one takes the slack on the first line, and a line
			    whose slack is spoken for cannot be centred.
			    ⚠️ the room the shed measures against is the FOOTER's content
			    box, never this element's: w-fit means this box is a function of
			    what is in it, and measuring the thing you are resizing is the
			    circular question that makes a footer oscillate */}
			<div
				ref={stripRef}
				className='w-fit mx-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5'
			>
				{groups.map(g => (
					<TargetGroup
						key={g.label}
						{...{
							...g,
							hasSelection: server ? true : hasSelection,
							showLabel: !gone('labels'),
							showKeys: !gone('chips')
						}}
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
						{/* a launch button like the five before it, so its chip goes
						    with theirs */}
						{!gone('chips') && <Kbd>{both}</Kbd>}
					</Button>
				)}
				{/* the key chips, then the doors; without them the discovery
				    surfaces are themselves undiscoverable. the rule rides with the
				    group it follows, so hiding a group hides its rule, and its own
				    mx-2 keeps the air equal on both sides of it. three steps of
				    space, the smallest innermost: 8px between items, 16px across a
				    rule, 24px between whole footer groups. at the old flat gap-4 the
				    space between Shortcuts and Help was the space between groups,
				    so the strip had no grain.

				    shrink-0 is the whole of what reserves the two doors' room:
				    they never hide, so nothing may squeeze them off the end — the
				    launch groups give up a step, or failing that a line, first. it
				    replaces a 13rem min-width that guessed at the same room in a
				    literal, and a grow/basis-0 with justify-end that held the two
				    ends apart from this side — which on a second line took the
				    whole line and left the two doors hanging off the far right
				    with nothing to their left, the same defect ml-auto shipped
				    once already. hugging its own content, it goes where the
				    strip's justify-center puts it, centred like every other row.
				    flex-wrap stays as the floor under everything: at the very
				    narrowest the doors drop to a second line rather than overflow
				    the strip. it was a named container while the container queries
				    lived here; nothing queries it now, so the name went with them.
				    ⚠️ spelling a dead utility in a comment does not kill it:
				    tailwind reads these files as plain text, so the class was
				    still in the built stylesheet until this sentence stopped
				    quoting it */}
				<div
					ref={clusterRef}
					className='shrink-0 flex flex-wrap items-center gap-2'
				>
					{hints.map((g, i) => (
						<div
							key={g.id}
							className={`items-center gap-2 shrink-0 ${gone(g.id) ? 'hidden' : 'flex'}`}
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
							{i < hints.length - 1 && (
								<span
									className='w-px h-5 bg-border-strong shrink-0 mx-2'
									aria-hidden='true'
								/>
							)}
						</div>
					))}
				</div>
			</div>
		</footer>
	);
};

export default StatusBar;
