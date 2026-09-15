import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { prettyKeys, SHORTCUTS } from '../shortcuts';
import { savedThemeId, setTheme, THEMES } from '../themes';
import { useTargets } from '../hooks/useTargets';
import Button from './Button';
import TargetManager from './TargetManager';
import WorkspaceManager from './WorkspaceManager';

// Which panel you last looked at is frontend-only UI state, like sortMode:
// nothing in Rust reads it, so it never goes near prefs.json.
const LAST_PANEL = 'devgo.settingsPanel';

const kbd =
	'font-mono text-[11px] px-2 py-0.5 border border-border rounded bg-bg-panel text-text-primary';
const heading =
	'text-xs font-bold uppercase tracking-wider text-text-secondary mb-2';

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);
const NAV_KEYS: Record<string, string> = {
	Space: 'Space',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right'
};

// a key event as a tauri accelerator, or null while only modifiers are down
// or the key is one we cannot bind. a global hotkey must carry a modifier
const toAccelerator = (e: KeyboardEvent): string | null => {
	if (MODIFIER_KEYS.has(e.key)) return null;
	const mods = [
		e.ctrlKey && 'Ctrl',
		e.altKey && 'Alt',
		e.shiftKey && 'Shift',
		e.metaKey && 'Super'
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
				<div className='flex items-center justify-between gap-3 py-1 text-sm'>
					<span className='text-text-secondary'>
						Show / hide DevGo from anywhere
					</span>
					<span className='flex items-center gap-2 shrink-0'>
						<kbd className={kbd}>
							{capturing ? 'Press keys…' : prettyKeys(summonHotkey)}
						</kbd>
						<Button variant='ghost' onClick={() => setCapturing(c => !c)}>
							<span className={`text-xs ${capturing ? 'text-accent' : ''}`}>
								{capturing ? 'Cancel' : 'Rebind'}
							</span>
						</Button>
					</span>
				</div>
				<p className='text-xs text-text-muted mt-1'>
					Click Rebind, then press the combination — it needs a modifier
					(Ctrl / Alt / Shift / Super). If another app owns the keys, the old
					binding stays.
				</p>
			</div>

			{groups.map(g => (
				<div key={g}>
					<h4 className={heading}>{g}</h4>
					{SHORTCUTS.filter(s => s.group === g).map(s => (
						<div
							key={s.id}
							className='flex items-center justify-between py-1 text-sm'
						>
							<span className='text-text-secondary'>
								{s.label}
								{s.needsSelection && (
									<span className='text-text-muted text-xs'>
										{' '}
										· needs a selection
									</span>
								)}
							</span>
							<kbd className={kbd}>{prettyKeys(s.keys)}</kbd>
						</div>
					))}
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
				<p className='text-xs text-text-muted mb-2'>
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
				<p className='text-xs text-text-muted mb-2'>
					Folder names to skip while scanning, one per line — on top of the
					hidden dotfolders that are always skipped. Matched by name,
					case-insensitive.
				</p>
				<textarea
					className='w-full h-32 px-3 py-2 bg-bg-panel border border-border rounded-md font-mono text-xs text-text-primary outline-none focus:border-accent resize-none'
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

const SWATCHES: ThemeKey[] = [
	'bg-primary',
	'bg-panel',
	'accent',
	'text-primary',
	'danger'
];

// no reload, no round trip: a theme is CSS variables and lives in localStorage
const AppearancePanel = () => {
	const [current, setCurrent] = useState(savedThemeId());
	const pick = (id: string) => {
		setTheme(id);
		setCurrent(id);
	};

	return (
		<div>
			<h4 className={heading}>Theme</h4>
			<div className='grid grid-cols-2 gap-2.5'>
				{THEMES.map(t => (
					<Button
						key={t.id}
						variant='card'
						aria-pressed={t.id === current}
						onClick={() => pick(t.id)}
					>
						<span className='flex items-center justify-between mb-2'>
							<span className='text-[13px]'>{t.name}</span>
							{t.id === current && (
								<span className='text-accent text-xs'>✓</span>
							)}
						</span>
						<span className='flex gap-1'>
							{SWATCHES.map(k => (
								<span
									key={k}
									className='w-6 h-6 rounded border border-white/10'
									style={{ background: t.colors[k] }}
								/>
							))}
						</span>
					</Button>
				))}
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
					<p className='text-xs text-text-muted mb-3'>{s.text}</p>
					<div className='flex gap-2'>
						{s.actions.map(a => (
							<Button key={a.label} onClick={a.onClick}>
								{a.label}
							</Button>
						))}
					</div>
				</div>
			))}
			{msg && <p className='text-xs text-accent'>{msg}</p>}
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
	onSummonChanged
}: SettingsProps) => {
	const targets = useTargets();

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
			label: 'Editors & Terminals',
			render: () => (
				<TargetManager
					{...{
						editors: targets.editors,
						terminals: targets.terminals,
						defaults: targets.defaults,
						onAdd: targets.addTarget,
						onRemove: targets.removeTarget,
						onSetDefault: targets.setDefaultTarget,
						onError
					}}
				/>
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
			id: 'shortcuts',
			label: 'Shortcuts',
			render: () => (
				<ShortcutTable {...{ summonHotkey, onSummonChanged, onError }} />
			)
		},
		{
			id: 'appearance',
			label: 'Appearance',
			render: () => <AppearancePanel />
		},
		{
			id: 'config',
			label: 'Config',
			render: () => <ConfigPanel {...{ onChanged: onImported, onError }} />
		}
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

	// Registered only while open: the shell is mounted on every render, and a
	// closed dialog must not own a global key.
	useEffect(() => {
		if (!open) return;
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', esc);
		return () => window.removeEventListener('keydown', esc);
	}, [open, onClose]);

	if (!open) return null;

	// A stored id that no longer names a panel costs one click, not an empty pane.
	const current = panels.find(p => p.id === active) ?? panels[0];

	return (
		<div
			className='fixed inset-0 bg-black/60 flex items-center justify-center z-40'
			onClick={onClose}
		>
			<div
				className='bg-bg-secondary border border-border rounded-xl w-[min(760px,92vw)] h-[min(560px,88vh)] flex overflow-hidden shadow-2xl'
				onClick={e => e.stopPropagation()}
			>
				<nav className='w-44 shrink-0 border-r border-border bg-bg-primary/40 p-2 flex flex-col gap-1'>
					<h3 className='text-xs font-bold uppercase tracking-wider text-text-muted px-2 py-2'>
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
		</div>
	);
};

export default Settings;
