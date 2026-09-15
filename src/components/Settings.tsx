import { useEffect, useState } from 'react';
import { prettyKeys, SHORTCUTS } from '../shortcuts';
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

/// The third reader of the shortcut table. Not one key name lives here.
const ShortcutTable = ({ summonHotkey }: ShortcutTableProps) => {
	const groups = [...new Set(SHORTCUTS.map(s => s.group))];
	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h4 className={heading}>Summon</h4>
				<div className='flex items-center justify-between py-1 text-sm'>
					<span className='text-text-secondary'>
						Show / hide DevGo from anywhere
					</span>
					<kbd className={kbd}>{prettyKeys(summonHotkey)}</kbd>
				</div>
				<p className='text-xs text-text-muted mt-1'>
					Rebinding this from the UI is not built yet — it lives in prefs.json
					for now.
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

const Settings = ({
	open,
	onClose,
	workspaces,
	onAddWorkspace,
	onRemoveWorkspace,
	summonHotkey,
	onError,
	panel
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
			id: 'shortcuts',
			label: 'Shortcuts',
			render: () => <ShortcutTable {...{ summonHotkey }} />
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
