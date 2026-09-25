import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { GH_INSTALL, relativeTime } from '../github';
import { isMac, isWindows } from '../platform';
import {
	isAvailable,
	labelFor,
	prettyKeys,
	SHORTCUTS,
	shortcutFor
} from '../shortcuts';
import { applyTextScale, savedTextScale, stepTextScale, TEXT_STEPS } from '../textSize';
import {
	MAX_TRANSPARENCY,
	launchedTransparent,
	setTransparency
} from '../transparency';
import { savedThemeId, setTheme, THEMES } from '../themes';
import Button from './Button';
import AboutPanel from './AboutPanel';
import Drawer from './Drawer';
import HelpPanel from './HelpPanel';
import Kbd from './Kbd';
import TargetManager from './TargetManager';
import WorkspaceManager from './WorkspaceManager';

// Which panel you last looked at is frontend-only UI state, like sortMode:
// nothing in Rust reads it, so it never goes near prefs.json.
const LAST_PANEL = 'devgo.settingsPanel';

const heading = 'text-15 font-semibold text-text-primary mb-2';
// the explaining line under a heading, held to a reading measure. the panel
// is wide for the rows that need it — a template, a path — and a sentence
// the full width of it is a worse read, not a better one
const hint = 'text-13 text-text-muted max-w-[76ch]';
// the same measure in the boxes' own monospace: a list of folder or window
// names stops where the sentence above it does
const namesBox =
	'w-full max-w-[68ch] h-32 px-3 py-2 bg-bg-panel border border-border-strong rounded-control font-mono text-13 text-text-primary outline-none focus:border-accent resize-none';

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);
const NAV_KEYS: Record<string, string> = {
	Space: 'Space',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right'
};

// a key event as a tauri accelerator, or null while only modifiers are down
// or the key is one we cannot bind. a global hotkey must carry a modifier.
// metaKey is two keys: ⌘ on a mac, the win key on windows; tauri spells
// them Cmd and Super, and a ⌘ binding written Super registers the wrong key
const toAccelerator = (e: KeyboardEvent): string | null => {
	if (MODIFIER_KEYS.has(e.key)) return null;
	const mods = [
		e.ctrlKey && 'Ctrl',
		e.altKey && 'Alt',
		e.shiftKey && 'Shift',
		e.metaKey && (isMac ? 'Cmd' : 'Super')
	].filter(Boolean);
	if (mods.length === 0) return null;

	const c = e.code;
	const key = c.startsWith('Key')
		? c.slice(3)
		: c.startsWith('Digit')
			? c.slice(5)
			: /^F\d{1,2}$/.test(c)
				? c
				: (NAV_KEYS[c] ?? null);
	if (!key) return null;

	return [...mods, key].join('+');
};

/// The third reader of the shortcut table. Not one key name lives here.
const ShortcutTable = ({
	summonHotkey,
	onSummonChanged,
	onError
}: ShortcutTableProps) => {
	const groups = [...new Set(SHORTCUTS.map(s => s.group))];
	const [capturing, setCapturing] = useState(false);

	// capture phase, so the keys pressed to choose a chord never reach the
	// app's own bindings
	useEffect(() => {
		if (!capturing) return;
		const onKey = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const accel = toAccelerator(e);
			if (!accel) return;
			setCapturing(false);
			// shown only once the backend has bound it
			invoke<string>('set_summon_hotkey', { accelerator: accel })
				.then(onSummonChanged)
				.catch(err => onError(String(err)));
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	}, [capturing, onSummonChanged, onError]);

	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h4 className={heading}>Summon</h4>
				<div className='flex items-center justify-between gap-3 py-1 text-15 max-w-[76ch]'>
					<span className='text-text-secondary'>
						Show / hide DevGo from anywhere
					</span>
					<span className='flex items-center gap-2 shrink-0'>
						<Kbd>{capturing ? 'Press keys…' : prettyKeys(summonHotkey)}</Kbd>
						<Button variant='ghost' onClick={() => setCapturing(c => !c)}>
							<span className={`text-13 ${capturing ? 'text-accent' : ''}`}>
								{capturing ? 'Cancel' : 'Rebind'}
							</span>
						</Button>
					</span>
				</div>
				<p className={`${hint} mt-1`}>
					Click Rebind, then press the combination — it needs a modifier (
					{isMac ? 'Cmd / Opt / Shift / Ctrl' : 'Ctrl / Alt / Shift / Super'}
					). If another app owns the keys, the old binding stays.
				</p>
			</div>

			{groups.map(g => (
				<div key={g}>
					<h4 className={heading}>{g}</h4>
					{/* two columns once the panel is at its full width: a key half
					    a panel away from its label is a longer read than two short
					    rows side by side. below that the panel is on 94vw and one
					    column is all there is room for */}
					<div className='grid grid-cols-1 lg:grid-cols-2 gap-x-8'>
						{SHORTCUTS.filter(s => s.group === g && isAvailable(s)).map(s => (
							<div
								key={s.id}
								className='flex items-center justify-between gap-3 py-1 text-15'
							>
								<span className='text-text-secondary'>
									{labelFor(s.id)}
									{s.needsSelection && (
										<span className='text-text-muted text-13'>
											{' '}
											· needs a selection
										</span>
									)}
								</span>
								<Kbd>{prettyKeys(s.keys)}</Kbd>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
};

const DEPTHS = [1, 2, 3, 4, 5];

// the ignore list, and how deep to look. depth is safe on wsl because the
// distro walks in one spawn; a watcher is still out, it would never stop
const ScanningPanel = ({ onSaved, onError }: ScanningPanelProps) => {
	const [text, setText] = useState<string | null>(null);
	const [depth, setDepth] = useState(1);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		invoke<ScanConfig>('get_scan_config')
			.then(c => {
				setText(c.ignore.join('\n'));
				setDepth(c.depth);
			})
			.catch(e => {
				onError(String(e));
				setText('');
			});
	}, []);

	const save = async () => {
		setSaving(true);
		const ignore = [
			...new Set(
				(text ?? '')
					.split(/[\n,]/)
					.map(s => s.trim())
					.filter(Boolean)
			)
		];
		try {
			await invoke('set_scan_config', { config: { ignore, depth } });
			onSaved();
		} catch (e) {
			onError(String(e));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h4 className={heading}>Scan depth</h4>
				<p className={`${hint} mb-2`}>
					How many folder levels deep to look for projects. 1 keeps the
					original scan (every immediate child). Higher also surfaces nested
					projects — a monorepo's{' '}
					<code className='text-text-secondary'>apps/web</code>, or any nested
					layout — as their own launchable rows. On WSL this is one batched
					lookup, so depth stays cheap.
				</p>
				<div className='flex items-center gap-2'>
					{DEPTHS.map(n => (
						<Button
							key={n}
							variant='choice'
							aria-pressed={depth === n}
							onClick={() => setDepth(n)}
							disabled={text === null}
						>
							{n}
						</Button>
					))}
				</div>
			</div>
			<div>
				<h4 className={heading}>Ignore folders</h4>
				<p className={`${hint} mb-2`}>
					Folder names to skip while scanning, one per line — on top of the
					hidden dotfolders that are always skipped. Matched by name,
					case-insensitive.
				</p>
				<textarea
					className={namesBox}
					placeholder={'node_modules\narchive\nvendor'}
					value={text ?? ''}
					onChange={e => setText(e.target.value)}
					disabled={text === null}
				/>
			</div>
			<Button
				variant='primary'
				className='self-start'
				onClick={save}
				disabled={saving || text === null}
			>
				{saving ? 'Saving…' : 'Save & rescan'}
			</Button>
		</div>
	);
};

// one list for both sides: tmux for a WSL project, psmux for a Windows one.
// no onSaved: a window list is not scan input, and the only "changed"
// channel Settings hands a panel is onScanChanged, which re-walks every
// workspace. Success is a line under the button, like ConfigPanel
const TmuxPanel = ({ onError }: TmuxPanelProps) => {
	const [text, setText] = useState<string | null>(null);
	const [enabled, setEnabled] = useState(true);
	const [saving, setSaving] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);

	useEffect(() => {
		invoke<TmuxConfig>('get_tmux_config')
			.then(c => {
				setEnabled(c.enabled);
				setText(c.window_names.join('\n'));
			})
			// text stays null until this resolves, which is what disables the
			// controls; the failure path has to set it too
			.catch(e => {
				onError(String(e));
				setText('');
			});
	}, []);

	const save = async () => {
		setSaving(true);
		setMsg(null);
		// newlines only: ScanningPanel also splits on commas because a folder
		// name never has one, and a tmux window name legitimately can
		const window_names = [
			...new Set(
				(text ?? '')
					.split('\n')
					.map(s => s.trim())
					.filter(Boolean)
			)
		];
		try {
			await invoke('set_tmux_config', { config: { enabled, window_names } });
			setMsg('Saved. Takes effect on the next launch.');
		} catch (e) {
			onError(String(e));
		} finally {
			setSaving(false);
		}
	};

	const modes = [
		{ value: true, label: 'Session' },
		{ value: false, label: 'Plain shell' }
	];

	return (
		<div className='flex flex-col gap-5'>
			{/* the switch first, and the list dims under it: a live text box
			    under a disabled feature is a promise the app is not keeping */}
			<div>
				<h4 className={heading}>{isWindows ? 'Use tmux / psmux' : 'Use tmux'}</h4>
				<p className={`${hint} mb-2`}>
					On, a terminal launch opens a session with the windows below
					{isWindows
						? ' — tmux inside the distro for a WSL project, psmux for a Windows project'
						: ' in tmux'}
					. Off, it opens one plain shell in the project directory and starts
					no multiplexer at all — the right answer if you only ever use one
					tab.
				</p>
				{/* two install hints, not one with a swapped word: psmux is a
				    windows port and exists nowhere else, and tmux is not
				    installed the same way on a mac and on debian */}
				{isWindows ? (
					<p className={`${hint} mb-2`}>
						psmux is a tmux for Windows and is installed separately:{' '}
						<code className='text-text-secondary'>
							winget install marlocarlo.psmux
						</code>
						. Without it a Windows launch falls back to a plain shell and
						says so.
					</p>
				) : (
					<p className={`${hint} mb-2`}>
						tmux is installed separately:{' '}
						<code className='text-text-secondary'>
							{isMac ? 'brew install tmux' : 'sudo apt install tmux'}
						</code>
						. Without it a launch falls back to a plain shell and says so.
					</p>
				)}
				<div className='flex items-center gap-2'>
					{modes.map(m => (
						<Button
							key={m.label}
							variant='target'
							aria-current={enabled === m.value ? 'true' : undefined}
							onClick={() => setEnabled(m.value)}
							disabled={text === null}
						>
							{m.label}
						</Button>
					))}
				</div>
			</div>
			<div className={enabled ? '' : 'opacity-50'}>
				<h4 className={heading}>Windows</h4>
				<p className={`${hint} mb-2`}>
					One name per line, in order; the first is the window you land in.
					Existing windows are left alone — one you opened by hand, or
					renamed, survives every relaunch, and nothing here is ever killed
					or pruned. Leave the box empty for a single plain window.
				</p>
				<textarea
					className={namesBox}
					placeholder={'code\nagents\ngit'}
					value={text ?? ''}
					onChange={e => setText(e.target.value)}
					disabled={text === null || !enabled}
				/>
			</div>
			<Button
				variant='primary'
				className='self-start'
				onClick={save}
				disabled={saving || text === null}
			>
				{saving ? 'Saving…' : 'Save'}
			</Button>
			{msg && <p className='text-13 text-accent'>{msg}</p>}
		</div>
	);
};

// the three-state status line, which organisations to list, the cache's
// age, and the one button that fetches. the line is the same three
// sentences the lane header says, each with its fix, and a refresh here
// is the same thread the header's ↻ starts. devgo holds no token; gh
// does, which is why log out is gh auth logout and not a button
// on or off; the same pair the tmux panel uses
const LIVE_MODES = [
	{ label: 'On', value: true },
	{ label: 'Off', value: false }
];

const GithubPanel = ({ github, onError }: GithubPanelProps) => {
	const { status, payload } = github;
	const cache = payload?.cache;
	const known = cache?.orgs ?? [];
	// undefined: untouched, show the saved choice. null: every org
	const [chosen, setChosen] = useState<string[] | null | undefined>(
		undefined
	);
	const effective = chosen === undefined ? (payload?.orgs ?? null) : chosen;
	const isOn = (org: string) => effective === null || effective.includes(org);
	const [saving, setSaving] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);

	const toggle = (org: string) => {
		const next = known.filter(o => (o === org ? !isOn(o) : isOn(o)));
		// every box ticked is "all" again, so a new org joins the list
		// without a visit here, which is what a default should mean
		setChosen(next.length === known.length ? null : next);
		setMsg(null);
	};

	const save = async () => {
		if (chosen === undefined) return;
		setSaving(true);
		try {
			await github.setOrgs(chosen);
			setChosen(undefined);
			setMsg('Saved. Applies on the next refresh.');
		} catch (e) {
			onError(String(e));
		} finally {
			setSaving(false);
		}
	};

	const statusLine = !status
		? 'Checking for gh…'
		: !status.installed
			? `gh not found. Install it: ${GH_INSTALL}`
			: !status.login
				? 'gh is installed but not logged in. Run: gh auth login'
				: `gh ${status.version ?? ''} · logged in as ${status.login}`;

	const cacheLine =
		cache && cache.fetched_at > 0
			? `${cache.repos.length} repositories, fetched ${relativeTime(cache.fetched_at)}${
					payload?.stale ? ' (stale)' : ''
				}.`
			: 'Nothing fetched yet.';

	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h4 className={heading}>GitHub CLI</h4>
				<p
					className={`text-15 font-mono ${status?.login ? 'text-text-primary' : 'text-danger'}`}
				>
					{statusLine}
				</p>
				<p className={`${hint} mt-2`}>
					DevGo lists your repositories through{' '}
					<code className='text-text-secondary'>gh</code> and stores no token
					of its own: <code className='text-text-secondary'>gh auth login</code>{' '}
					signs in, <code className='text-text-secondary'>gh auth logout</code>{' '}
					signs out. The list is fetched only when you ask (↻ on the group, or
					here) or when the group opens on a cache older than six hours. Never
					on launch, never on focus.
				</p>
			</div>

			<div>
				<h4 className={heading}>Organisations</h4>
				<p className={`${hint} mb-2`}>
					Your own repositories are always listed. Tick the organisations to
					list beside them; all of them are ticked until you change it.
				</p>
				{known.length === 0 ? (
					<p className={`${hint} italic`}>
						{cache && cache.fetched_at > 0
							? 'You are not a member of any organisation.'
							: 'Refresh once to discover your organisations.'}
					</p>
				) : (
					<div className='flex flex-col gap-1'>
						{known.map(org => (
							<label
								key={org}
								className='flex items-center gap-2 text-15 text-text-secondary cursor-pointer'
							>
								<input
									type='checkbox'
									className='accent-accent'
									checked={isOn(org)}
									onChange={() => toggle(org)}
								/>
								<span className='font-mono'>{org}</span>
							</label>
						))}
					</div>
				)}
				{chosen !== undefined && (
					<Button
						variant='primary'
						className='mt-3'
						onClick={save}
						disabled={saving}
					>
						{saving ? 'Saving…' : 'Save'}
					</Button>
				)}
				{msg && <p className='text-13 text-accent mt-2'>{msg}</p>}
			</div>

			<div>
				<h4 className={heading}>Search all of GitHub as you type</h4>
				<p className={`${hint} mb-2`}>
					Off, the GitHub box matches your cached list instantly and never
					touches the network. On, it also asks GitHub, any owner, once you
					have typed three characters and paused for a moment; the hits appear
					under a <em>More from GitHub</em> line. This is the one place a
					keystroke becomes a network call, which is why it is off until you
					turn it on.
				</p>
				<div className='flex items-center gap-2'>
					{LIVE_MODES.map(m => (
						<Button
							key={m.label}
							variant='target'
							aria-current={github.liveOn === m.value ? 'true' : undefined}
							disabled={!payload}
							onClick={() =>
								github.setLiveSearch(m.value).catch(e => onError(String(e)))
							}
						>
							{m.label}
						</Button>
					))}
				</div>
			</div>

			<div>
				<h4 className={heading}>Cache</h4>
				<p className={`${hint} mb-2`}>{cacheLine}</p>
				<Button
					onClick={github.refresh}
					disabled={!status?.login || github.refreshing}
					title={
						status?.login
							? 'Runs gh repo list on a background thread'
							: 'Log in with gh first'
					}
				>
					{github.refreshing ? 'Refreshing…' : 'Refresh now'}
				</Button>
				{github.lastError && (
					<p className='text-13 text-danger mt-2'>{github.lastError}</p>
				)}
			</div>
		</div>
	);
};

const SWATCHES: ThemeKey[] = [
	'bg-primary',
	'bg-panel',
	'accent',
	'text-primary',
	'danger'
];

// no reload, no round trip: a theme is CSS variables and lives in localStorage
// the words are shown and hidden: the switch is about the row, not a
// feature being on
const HINT_MODES = [
	{ label: 'Show', value: true },
	{ label: 'Hide', value: false }
];

// minus, the number, plus, and reset when it is not 100%
const TextStep = ({ scale, onScale }: TextStepProps) => {
	const ends = [
		{ label: '−', dir: -1 as const, title: 'Smaller', at: TEXT_STEPS[0] },
		{ label: '+', dir: 1 as const, title: 'Bigger', at: TEXT_STEPS[TEXT_STEPS.length - 1] }
	];
	const [minus, plus] = ends.map(e => (
		<Button
			key={e.label}
			variant='choice'
			disabled={scale === e.at}
			title={e.title}
			onClick={() => stepTextScale(e.dir).then(onScale)}
		>
			{e.label}
		</Button>
	));
	return (
		<div className='flex items-center gap-2'>
			{minus}
			<span className='font-mono text-15 text-text-primary w-14 text-center'>
				{Math.round(scale * 100)}%
			</span>
			{plus}
			{scale !== 1 && (
				<Button
					variant='ghost'
					className='ml-2 text-13 text-accent'
					onClick={() => applyTextScale(1).then(onScale)}
				>
					Reset
				</Button>
			)}
		</div>
	);
};

// a stepper and a typed number, not a slider: a slider on a five-step
// grid was too rigid. one percent at a time from the buttons, any number
// typed, the same shape as text size. null until the preference has been
// read, so the controls never say 0 on a see-through window
const TransparencyStep = ({ value, onChange }: TransparencyStepProps) => {
	const clamp = (n: number) =>
		Math.max(0, Math.min(MAX_TRANSPARENCY, Math.round(n)));
	const ends = [
		{ label: '−', by: -1, title: 'One percent more opaque', at: 0 },
		{ label: '+', by: 1, title: 'One percent more see-through', at: MAX_TRANSPARENCY }
	];
	const [minus, plus] = ends.map(e => (
		<Button
			key={e.label}
			variant='choice'
			disabled={value === null || value === e.at}
			title={e.title}
			onClick={() => onChange(clamp((value ?? 0) + e.by))}
		>
			{e.label}
		</Button>
	));
	return (
		<div className='flex items-center gap-2'>
			{minus}
			<input
				type='number'
				min={0}
				max={MAX_TRANSPARENCY}
				step={1}
				inputMode='numeric'
				value={value ?? 0}
				disabled={value === null}
				aria-label='Transparency, percent see-through'
				className='w-16 px-2 py-1 bg-bg-panel border border-border-strong rounded-control font-mono text-15 text-text-primary text-center outline-none focus:border-accent'
				onChange={e => {
					const n = Number(e.target.value);
					if (Number.isFinite(n)) onChange(clamp(n));
				}}
			/>
			<span className='text-13 text-text-muted'>% see-through</span>
			{plus}
			{(value ?? 0) > 0 && (
				<Button
					variant='ghost'
					className='ml-2 text-13 text-accent'
					onClick={() => onChange(0)}
				>
					Opaque
				</Button>
			)}
		</div>
	);
};

const AppearancePanel = ({ showHints, onToggleHints }: AppearancePanelProps) => {
	const [current, setCurrent] = useState(savedThemeId());
	const [scale, setScale] = useState(savedTextScale());
	const [transparency, setTransparencyShown] = useState<number | null>(null);
	// born see-through or not is decided at creation and cannot change on
	// a live window: the knob previews live only on a window born
	// see-through, otherwise it is stored for the next launch
	const [born, setBorn] = useState<boolean | null>(null);
	// windows' own switch: off, and the ground goes black instead of
	// see-through, which reads as a devgo bug. say so
	const [osEffects, setOsEffects] = useState<boolean | null>(null);
	useEffect(() => {
		invoke<number>('get_window_transparency')
			.then(setTransparencyShown)
			.catch(() => setTransparencyShown(0));
		launchedTransparent().then(setBorn);
		invoke<boolean | null>('os_transparency_effects_enabled')
			.then(setOsEffects)
			.catch(() => setOsEffects(null));
	}, []);
	// the number follows the step at once; the stored value, clamped,
	// comes back and settles it
	const previewTransparency = (percent: number) => {
		setTransparencyShown(percent);
		setTransparency(percent, born === true)
			.then(setTransparencyShown)
			.catch(() => {});
	};
	const knob = transparency ?? 0;
	// ctrl+= / ctrl+- while this panel is open must move the number too
	useEffect(() => {
		const sync = () => setScale(savedTextScale());
		window.addEventListener('devgo:textscale', sync);
		return () => window.removeEventListener('devgo:textscale', sync);
	}, []);
	const pick = (id: string) => {
		setTheme(id);
		setCurrent(id);
	};

	return (
		<div className='flex flex-col gap-5'>
			<div>
			<h4 className={heading}>Theme</h4>
			<div className='grid grid-cols-2 lg:grid-cols-3 gap-2.5'>
				{THEMES.map(t => (
					<Button
						key={t.id}
						variant='card'
						aria-pressed={t.id === current}
						onClick={() => pick(t.id)}
					>
						<span className='flex items-center justify-between mb-2'>
							<span className='text-13'>{t.name}</span>
							{t.id === current && (
								<span className='text-accent text-13'>✓</span>
							)}
						</span>
						<span className='flex gap-1'>
							{SWATCHES.map(k => (
								<span
									key={k}
									className='w-6 h-6 rounded-control border border-white/10'
									style={{ background: t.colors[k] }}
								/>
							))}
						</span>
					</Button>
				))}
			</div>
			</div>
			<div>
				<h4 className={heading}>Text size</h4>
				<p className={`${hint} mb-2`}>
					The whole window, in steps: the same as{' '}
					<span className='font-mono'>{prettyKeys(shortcutFor('textBigger'))}</span>{' '}
					and{' '}
					<span className='font-mono'>{prettyKeys(shortcutFor('textSmaller'))}</span>;{' '}
					<span className='font-mono'>{prettyKeys(shortcutFor('textReset'))}</span>{' '}
					is 100%.
				</p>
				<TextStep {...{ scale, onScale: setScale }} />
			</div>
			<div>
				<h4 className={heading}>Transparency</h4>
				<p className={`${hint} mb-2`}>
					How much of what is behind the window shows through: sharp, in
					the theme's own colour, no system blur. Every surface follows it;
					text, icons and borders stay solid. Type a number or step it;
					capped at {MAX_TRANSPARENCY}%: past that, text would sit on
					whatever is behind you.
				</p>
				<TransparencyStep
					{...{ value: transparency, onChange: previewTransparency }}
				/>
				{born === false && knob > 0 && (
					<p className={`${hint} mt-2`}>
						Saved. DevGo opened opaque this time, so the window goes
						see-through on the next launch — a see-through window holds
						about 30 MB more, and an opaque one is not asked to.
					</p>
				)}
				{born === true && knob === 0 && (
					<p className={`${hint} mt-2`}>
						Opaque. The memory a see-through window holds is given back on
						the next launch.
					</p>
				)}
				{osEffects === false && born === true && knob > 0 && (
					<p className={`${hint} mt-2`}>
						Windows' <em>Transparency effects</em> is off (Settings ›
						Personalization › Colors). If the ground turns black instead of
						see-through, that switch is why.
					</p>
				)}
			</div>
			<div>
				<h4 className={heading}>Hint words</h4>
				<p className={`${hint} mb-2`}>
					<em>recent</em> and <em>frequent</em> on project rows. Off by
					default: the frecency sort already puts those projects first, and
					the word was one more thing on every row.
				</p>
				<div className='flex items-center gap-2'>
					{HINT_MODES.map(m => (
						<Button
							key={m.label}
							variant='target'
							aria-current={showHints === m.value ? 'true' : undefined}
							onClick={() => showHints !== m.value && onToggleHints()}
						>
							{m.label}
						</Button>
					))}
				</div>
			</div>
		</div>
	);
};

const FILTERS = [{ name: 'JSON', extensions: ['json'] }];

// the backend does the file io; this panel runs the dialogs and hands over
// the path
const ConfigPanel = ({ onChanged, onError }: ConfigPanelProps) => {
	const [msg, setMsg] = useState<string | null>(null);

	// null means the dialog was cancelled: nothing to say
	const attempt = async (action: () => Promise<string | null>) => {
		try {
			const done = await action();
			if (done) setMsg(done);
		} catch (e) {
			onError(String(e));
		}
	};

	const exportConfig = () =>
		attempt(async () => {
			const path = await save({
				defaultPath: 'devgo-config.json',
				filters: FILTERS
			});
			if (!path) return null;
			await invoke('export_config_to_file', { path });
			return 'Exported.';
		});

	const importConfig = () =>
		attempt(async () => {
			const path = await openDialog({ filters: FILTERS });
			if (typeof path !== 'string') return null;
			await invoke('import_config_from_file', { path });
			onChanged();
			return 'Imported.';
		});

	const resetCache = () =>
		attempt(async () => {
			await invoke('reset_cache');
			onChanged();
			return 'Cache cleared.';
		});

	const sections = [
		{
			title: 'Export / Import',
			text: 'Carry your workspaces, editors and settings to another machine as one file. Import is additive — it never removes what you already have. The project cache is deliberately not exported; those paths are machine-local.',
			actions: [
				{ label: 'Export…', onClick: exportConfig },
				{ label: 'Import…', onClick: importConfig }
			]
		},
		{
			title: 'Project cache',
			text: 'Clear the cached project list. The next scan rebuilds it — useful if a moved or renamed folder is lingering.',
			actions: [{ label: 'Reset cache', onClick: resetCache }]
		}
	];

	return (
		<div className='flex flex-col gap-5'>
			{sections.map(s => (
				<div key={s.title}>
					<h4 className={heading}>{s.title}</h4>
					<p className={`${hint} mb-3`}>{s.text}</p>
					<div className='flex gap-2'>
						{s.actions.map(a => (
							<Button key={a.label} onClick={a.onClick}>
								{a.label}
							</Button>
						))}
					</div>
				</div>
			))}
			{msg && <p className='text-13 text-accent'>{msg}</p>}
		</div>
	);
};


// the line under a server's name: the ssh line as the row would run it,
// and the default path when there is one. by host only when the lane may
// say it; otherwise the line says how, not where
const serverLine = (s: Server, details: boolean) => {
	const target = s.alias
		? s.alias
		: details
			? `${s.user ? `${s.user}@` : ''}${s.host}${s.port && s.port !== 22 ? ` -p ${s.port}` : ''}`
			: 'by host';
	return `ssh ${target}${s.default_path ? ` · ${s.default_path}` : ''}`;
};

// the machines, an edit per row, the tmux switch inline, and the two
// doors: add, and import from ~/.ssh/config. devgo stores aliases and key
// paths, never a password
const ServersPanel = ({
	servers,
	onAdd,
	onEdit,
	onImport,
	onError
}: ServersPanelProps) => {
	const attempt = (action: Promise<unknown>) =>
		action.catch(e => onError(String(e)));
	const doors = [
		{ label: 'Add server…', onClick: onAdd, title: undefined },
		{
			label: 'Import from ~/.ssh/config',
			onClick: onImport,
			title: 'Every Host block becomes a row; the file is never written'
		}
	];
	const rowButtons = (s: Server) => [
		{
			label: 'tmux',
			on: s.tmux,
			title: s.tmux
				? `tmux session ${s.session ?? 'devgo'}. Click for a plain shell`
				: 'Plain shell. Click for a tmux session',
			onClick: () => attempt(servers.update({ ...s, tmux: !s.tmux }))
		},
		{ label: 'Edit', on: false, title: undefined, onClick: () => onEdit(s) },
		{
			label: 'Remove',
			on: false,
			title: 'Your ssh config and keys are untouched',
			onClick: () => attempt(servers.remove(s.id))
		}
	];

	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h4 className={heading}>Machines</h4>
				<p className={`${hint} mb-3`}>
					Each row is a machine you SSH into. Enter opens a terminal on it, in
					a tmux session that survives when the switch is on. DevGo stores the
					alias or host and a key <em>path</em>, never a password;{' '}
					<code className='text-text-secondary'>ssh</code> uses your own keys
					and config.
				</p>
				{!servers.hasSsh && (
					<p className='text-13 text-danger mb-3'>
						No <code>ssh</code> client on PATH.{' '}
						{isWindows
							? 'Windows ships one under Settings › Apps › Optional features › OpenSSH Client.'
							: isMac
								? 'macOS ships one at /usr/bin/ssh, so something has stripped PATH.'
								: 'Install it with sudo apt install openssh-client.'}
					</p>
				)}
				{servers.servers.length === 0 ? (
					<p className={`${hint} italic mb-3`}>None yet.</p>
				) : (
					<div className='flex flex-col gap-1 mb-3'>
						{servers.servers.map(s => (
							<div
								key={s.id}
								className='flex items-center justify-between gap-3 px-3 py-2 bg-bg-panel rounded-control'
							>
								<div className='min-w-0'>
									<div className='flex items-center gap-2'>
										<span className='text-15 text-text-primary truncate'>
											{s.name}
										</span>
										{s.source === 'ssh-config' && (
											<span
												className='text-11 text-text-muted border border-border-strong rounded-control px-1'
												title='From ~/.ssh/config'
											>
												config
											</span>
										)}
										{s.tunnel && (
											<span className='text-11 text-text-muted'>tunnel</span>
										)}
									</div>
									<div className='font-mono text-11 text-text-muted truncate'>
										{serverLine(s, servers.showDetails)}
									</div>
								</div>
								<div className='flex items-center gap-1 shrink-0'>
									{rowButtons(s).map(b => (
										<Button
											key={b.label}
											variant='target'
											aria-current={b.on ? 'true' : undefined}
											title={b.title}
											onClick={b.onClick}
										>
											{b.label}
										</Button>
									))}
								</div>
							</div>
						))}
					</div>
				)}
				<div className='flex items-center gap-2'>
					{doors.map(d => (
						<Button
							key={d.label}
							title={d.title}
							onClick={d.onClick}
							disabled={!servers.hasSsh}
						>
							{d.label}
						</Button>
					))}
				</div>
			</div>

			<div>
				<h4 className={heading}>Show connection details in the lane</h4>
				<p className={`${hint} mb-2`}>
					Off, a server row is its name. On, the row also prints user@host
					and the port, as the row menu's <em>Show connection details</em>{' '}
					does.
				</p>
				<div className='flex items-center gap-2'>
					{HINT_MODES.map(m => (
						<Button
							key={m.label}
							variant='target'
							aria-current={servers.showDetails === m.value ? 'true' : undefined}
							onClick={() => attempt(servers.setShowDetails(m.value))}
						>
							{m.label}
						</Button>
					))}
				</div>
			</div>
		</div>
	);
};

const Settings = ({
	open,
	onClose,
	workspaces,
	onAddWorkspace,
	onRemoveWorkspace,
	summonHotkey,
	onError,
	panel,
	onScanChanged,
	onImported,
	onSummonChanged,
	targets,
	github,
	showHints,
	onToggleHints,
	servers,
	onAddServer,
	onEditServer,
	onImportSsh
}: SettingsProps) => {

	// help's reveal button opens the DEFAULT manager, so its label names that
	// one; a default that is unset or points at a deleted target leaves the
	// static "Reveal in Explorer" in place
	const defaultManagerName = targets.fileManagers.find(
		t => t.id === targets.defaults.file_manager
	)?.name;

	// The registry. A later chapter adds a panel by adding an object here; the
	// nav, the persistence, Escape and the layout never learn what a panel holds.
	const panels: SettingsPanel[] = [
		{
			id: 'workspaces',
			label: 'Workspaces',
			render: () => (
				<WorkspaceManager
					{...{
						workspaces,
						onAdd: onAddWorkspace,
						onRemove: onRemoveWorkspace
					}}
				/>
			)
		},
		{
			id: 'targets',
			label: 'Launch targets',
			render: () => (
				<TargetManager
					{...{
						editors: targets.editors,
						terminals: targets.terminals,
						agents: targets.agents,
						fileManagers: targets.fileManagers,
						defaults: targets.defaults,
						onAdd: targets.addTarget,
						onDetect: targets.detect,
						onAddDetected: targets.addDetected,
						onRemove: targets.removeTarget,
						onSetDefault: targets.setDefaultTarget,
						onError
					}}
				/>
			)
		},
		{
			id: 'tmux',
			label: isWindows ? 'tmux / psmux' : 'tmux',
			render: () => <TmuxPanel {...{ onError }} />
		},
		{
			id: 'github',
			label: 'GitHub',
			render: () => <GithubPanel {...{ github, onError }} />
		},
		{
			id: 'shortcuts',
			label: 'Shortcuts',
			render: () => (
				<ShortcutTable {...{ summonHotkey, onSummonChanged, onError }} />
			)
		},
		{
			id: 'scanning',
			label: 'Scanning',
			render: () => (
				<ScanningPanel {...{ onSaved: onScanChanged, onError }} />
			)
		},
		{
			id: 'appearance',
			label: 'Appearance',
			render: () => <AppearancePanel {...{ showHints, onToggleHints }} />
		},
		{
			id: 'config',
			label: 'Config',
			render: () => <ConfigPanel {...{ onChanged: onImported, onError }} />
		},
		{
			id: 'servers',
			label: 'Servers',
			render: () => (
				<ServersPanel
					{...{
						servers,
						onAdd: onAddServer,
						onEdit: onEditServer,
						onImport: onImportSsh,
						onError
					}}
				/>
			)
		},
		{
			id: 'help',
			label: 'Help',
			render: () => (
				<HelpPanel
					{...{
						onError,
						revealLabel:
							defaultManagerName && `Reveal in ${defaultManagerName}`
					}}
				/>
			)
		},
		{ id: 'about', label: 'About', render: () => <AboutPanel /> }
	];

	const [active, setActive] = useState(
		() => localStorage.getItem(LAST_PANEL) ?? panels[0].id
	);
	const choose = (id: string) => {
		setActive(id);
		localStorage.setItem(LAST_PANEL, id);
	};

	// a requested panel wins over the remembered one, once per request
	const [requested, setRequested] = useState(panel);
	if (panel !== requested) {
		setRequested(panel);
		if (panel) choose(panel);
	}

	if (!open) return null;

	// A stored id that no longer names a panel costs one click, not an empty pane.
	const current = panels.find(p => p.id === active) ?? panels[0];

	// a right drawer, full height, the nav column inside it and the list
	// still visible beside it. escape, focus and the backdrop are the
	// drawer's; this was a second copy of the modal frame with its own
	// escape handler
	return (
		<Drawer
			{...{
				open,
				side: 'right' as const,
				onClose,
				width: 'w-[min(960px,94vw)]',
				z: 40 as const
			}}
		>
			<div className='flex-1 min-h-0 flex overflow-hidden'>
				<nav className='w-56 shrink-0 border-r border-border bg-bg-primary/40 p-2 flex flex-col gap-1'>
					<h3 className='text-18 font-bold text-text-primary px-2 py-2'>
						Settings
					</h3>
					{panels.map(p => (
						<Button
							key={p.id}
							variant='tab'
							aria-current={p.id === active ? 'page' : undefined}
							onClick={() => choose(p.id)}
						>
							{p.label}
						</Button>
					))}
				</nav>

				<div className='flex-1 flex flex-col min-w-0'>
					<div className='flex-1 overflow-y-auto p-6'>{current.render()}</div>
					<div className='border-t border-border p-3'>
						<Button className='w-full' onClick={onClose}>
							Close
						</Button>
					</div>
				</div>
			</div>
		</Drawer>
	);
};

export default Settings;
