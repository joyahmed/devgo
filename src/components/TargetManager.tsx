import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { isMac, isWindows } from '../platform';
import Button from './Button';

const KINDS: TargetKind[] = ['editor', 'terminal', 'agent', 'file_manager'];

// what the tabs and the headings call each kind: the wire name is snake_case
// and nobody writes a button label that way
const LABELS: Record<TargetKind, string> = {
	editor: 'editor',
	terminal: 'terminal',
	agent: 'agent',
	file_manager: 'file manager'
};

const BLANK: TargetDraft = {
	name: '',
	executable: '',
	args_template: '"{path}"',
	wsl_executable: '',
	wsl_args_template: '',
	run_args_template: '',
	wsl_run_args_template: '',
	reveal_args_template: ''
};

// terminals only: blank means the target cannot run dev scripts
const RUN_FIELDS: { key: keyof TargetDraft; placeholder: string }[] = [
	{
		key: 'run_args_template',
		placeholder: isWindows
			? 'Run args — {command} in a Windows project'
			: 'Run args — {command} in the project'
	},
	...(isWindows
		? [
				{
					key: 'wsl_run_args_template' as const,
					placeholder: 'WSL run args — {command} in a WSL project'
				}
			]
		: [])
];

// file managers only: blank means this one cannot select an item inside its
// parent, and the folder itself opens. the windows example is Explorer's own
// switch, which is what a manager written for Windows copies — Trove takes
// the same /select, — and nothing on Linux has an equivalent, so that line
// offers no example to copy
const REVEAL_FIELDS: { key: keyof TargetDraft; placeholder: string }[] = [
	{
		key: 'reveal_args_template',
		placeholder: isMac
			? 'Reveal args — the item selected in its parent, e.g. -R "{path}"'
			: isWindows
				? 'Reveal args — the item selected in its parent, e.g. /select,"{path}"'
				: 'Reveal args — the item selected in its parent; blank opens the folder'
	}
];

// what the Browse button will show. windows names its programs by extension,
// so the filter is real there; elsewhere an executable is any file, and a mac
// .app is a directory a file dialog cannot pick — which is right, because a
// bundle is not something DevGo can spawn, `open -a` is
const EXE_FILTERS = isWindows
	? [{ name: 'Programs', extensions: ['exe', 'cmd', 'bat', 'com'] }]
	: undefined;

// the form for one kind. wsl is a windows story: the wsl half has nothing
// to describe on a mac or a linux box, and the fields stay in the draft
// (blank) so the struct the backend gets is one shape. a file manager has
// no wsl half on any platform — a WSL project is revealed through its UNC
// path, which is a windows path already — and it is the one kind usually
// registered by its full exe path, because no installer puts one on PATH
const fieldsFor = (
	kind: TargetKind
): { key: keyof TargetDraft; placeholder: string }[] => [
	{
		key: 'name',
		placeholder: kind === 'file_manager' ? 'Name — e.g. Trove' : 'Name — e.g. Cursor'
	},
	{
		key: 'executable',
		placeholder:
			kind === 'file_manager'
				? isWindows
					? 'Executable — a full path, e.g. C:\\Program Files\\Trove\\trove.exe'
					: 'Executable — a command on PATH, or a full path'
				: 'Executable — e.g. cursor'
	},
	{
		key: 'args_template',
		placeholder: isWindows ? 'Windows args — e.g. "{path}"' : 'Args — e.g. "{path}"'
	},
	...(isWindows && kind !== 'file_manager'
		? [
				{
					key: 'wsl_executable' as const,
					placeholder: 'WSL executable — blank if it speaks WSL itself'
				},
				{
					key: 'wsl_args_template' as const,
					placeholder: 'WSL args — blank means it cannot open WSL projects'
				}
			]
		: []),
	...(kind === 'terminal' ? RUN_FIELDS : []),
	...(kind === 'file_manager' ? REVEAL_FIELDS : [])
];

const PLACEHOLDERS = [
	{ code: '{path}', note: isWindows ? 'the Windows path' : 'the project path,' },
	...(isWindows
		? [
				{ code: '{distro}', note: 'and' },
				{ code: '{linux_path}', note: 'for WSL,' }
			]
		: []),
	{ code: '{command}', note: 'in the run templates, and' },
	{ code: '{script}', note: '— terminals only — the generated tmux session script' }
];

const heading = 'text-15 font-semibold text-text-primary mb-2';
// the reading measure Settings holds its explaining lines to. the rows
// below take the panel's width; a sentence does not need it
const hint = 'text-13 text-text-muted max-w-[76ch]';
const field =
	'w-full px-2 py-1.5 bg-bg-panel border border-border-strong rounded-control text-13 font-mono text-text-primary outline-none focus:border-accent';
const badge = 'text-11 rounded-control px-1 border';

const TargetList = ({
	kind,
	items,
	defaultId,
	onRemove,
	onSetDefault
}: TargetListProps) => (
	<div className='flex flex-col gap-1'>
		{items.map(t => {
			// the side badges read the refusal straight off the model: a null
			// template is the target saying which half it cannot open. only
			// windows has two halves, so only there do they say anything — on
			// a mac or a linux box every row would be badged for a filesystem
			// the machine does not have. an agent and a file manager have no
			// halves to badge either: one is a command the terminal runs, the
			// other takes a WSL project's UNC path as it stands
			const agent = t.kind === 'agent';
			const crosses = t.kind === 'editor' || t.kind === 'terminal';
			const badges = [
				{
					show: t.id === defaultId,
					label: 'default',
					className: 'text-accent border-accent/40'
				},
				{
					show: isWindows && crosses && !t.wsl_args_template,
					label: 'windows only',
					className: 'text-text-muted border-border-strong',
					title: 'No WSL configuration — this target cannot open WSL projects'
				},
				{
					show: isWindows && crosses && !t.args_template,
					label: 'wsl only',
					className: 'text-text-muted border-border-strong',
					title: 'Runs inside a distro — this target cannot open Windows projects'
				},
				{
					show: isWindows && agent,
					label: t.wsl_executable ? 'in distro' : 'windows',
					className: 'text-text-muted border-border-strong',
					title: 'The side this agent is installed on'
				}
			];
			const actions = [
				{
					show: t.id !== defaultId,
					label: 'Make default',
					className: 'hover:text-accent',
					onClick: () => onSetDefault(kind, t.id)
				},
				{
					show: true,
					label: 'Remove',
					className: 'hover:text-danger',
					onClick: () => onRemove(t.id)
				}
			];
			return (
				<div
					key={t.id}
					className='flex items-center justify-between gap-3 px-3 py-2 bg-bg-panel rounded-control'
				>
					<div className='min-w-0'>
						<div className='flex items-center gap-2'>
							<span className='text-15 text-text-primary truncate'>{t.name}</span>
							{badges
								.filter(b => b.show)
								.map(({ label, className, title }) => (
									<span key={label} className={`${badge} ${className}`} title={title}>
										{label}
									</span>
								))}
						</div>
						<div className='font-mono text-11 text-text-muted truncate'>
							{agent
								? (t.wsl_executable ?? t.executable)
								: `${t.executable} ${t.args_template}`}
						</div>
					</div>
					<div className='flex items-center gap-1 shrink-0'>
						{actions
							.filter(a => a.show)
							.map(({ label, className, onClick }) => (
								<Button
									key={label}
									variant='ghost'
									className={`text-13 px-2 ${className}`}
									onClick={onClick}
								>
									{label}
								</Button>
							))}
					</div>
				</div>
			);
		})}
	</div>
);

const TargetManager = ({
	editors,
	terminals,
	agents,
	fileManagers,
	defaults,
	onAdd,
	onDetect,
	onAddDetected,
	onRemove,
	onSetDefault,
	onError
}: TargetManagerProps) => {
	const [kind, setKind] = useState<TargetKind>('editor');
	const [draft, setDraft] = useState(BLANK);
	const [open, setOpen] = useState(false);
	// null is never scanned; [] is scanned and everything is already
	// registered. They say different things and must read differently.
	const [found, setFound] = useState<DetectedTarget[] | null>(null);
	const [scanning, setScanning] = useState(false);

	// Every action here can fail on purpose — removing the last editor is
	// refused with a sentence the user needs to read. The panel does not own
	// a toast; the failure travels up.
	const guard = (p: Promise<void>) => p.catch(e => onError(String(e)));

	const lists = [
		{ kind: 'editor' as TargetKind, label: 'Editors', items: editors },
		{ kind: 'terminal' as TargetKind, label: 'Terminals', items: terminals },
		{ kind: 'agent' as TargetKind, label: 'Agents', items: agents },
		{
			kind: 'file_manager' as TargetKind,
			label: 'File managers',
			items: fileManagers
		}
	];

	const close = () => {
		setDraft(BLANK);
		setOpen(false);
	};

	// a probe is a thing you ask for: it shells out to where.exe and wsl.exe,
	// which has no place on the launch path
	const scan = () => {
		setScanning(true);
		onDetect()
			.then(setFound)
			.catch(e => onError(String(e)))
			.finally(() => setScanning(false));
	};

	// the row leaves only once the add succeeded; a failure keeps it, with
	// the reason in a toast
	const addDetected = (id: string) =>
		onAddDetected(id)
			.then(() =>
				setFound(prev => (prev ?? []).filter(d => d.target.id !== id))
			)
			.catch(e => onError(String(e)));

	const scanLabel = scanning ? 'Scanning…' : found ? 'Scan again' : 'Scan';
	const scanHint =
		found === null
			? isMac
				? 'Looks for installed editors, terminals, file managers and coding agents (Claude Code, Codex, OpenCode, Gemini CLI) on this Mac: on your login PATH, and in /Applications. An agent opens in your default terminal, in the project directory.'
				: isWindows
					? 'Looks for installed editors, terminals, file managers and coding agents (Claude Code, Codex, OpenCode, Gemini CLI) on PATH, and for command-line editors and agents inside distros that are already running. It never starts a distro. An agent opens in your default terminal, in the project directory.'
					: 'Looks for installed editors, terminals, file managers and coding agents (Claude Code, Codex, OpenCode, Gemini CLI) on your login PATH. An agent opens in your default terminal, in the project directory.'
			: found.length === 0
				? 'Nothing new: everything found is already registered.'
				: null;

	// the executable is a path you find rather than a name you know, for the
	// one kind no installer puts on PATH: a file manager. typing it is still
	// there, and the store refuses a full path with no program at it either way
	const browse = () =>
		openDialog({ filters: EXE_FILTERS })
			.then(picked => {
				if (typeof picked === 'string')
					setDraft(d => ({ ...d, executable: picked }));
			})
			.catch(e => onError(String(e)));

	const submit = () => {
		if (!draft.name.trim() || !draft.executable.trim()) {
			onError('A target needs a name and an executable');
			return;
		}
		// close is chained INSIDE the guard, not after it: guard is a .catch,
		// which resolves once it has handled the rejection, so anything after
		// it runs on the failure path too. A refused add — a path with no
		// program at it is the usual one — must leave the panel open with
		// every typed field where the user left it, the reason in a toast,
		// and focus still on Add, so correcting the path and pressing it
		// again is the whole repair.
		guard(
			onAdd({
				name: draft.name.trim(),
				kind,
				executable: draft.executable.trim(),
				args_template: draft.args_template,
				// Empty means "not configured", which is what None means on the
				// Rust side — a target with no WSL form refuses WSL projects
				// rather than opening the wrong directory.
				wsl_executable: draft.wsl_executable.trim() || null,
				wsl_args_template: draft.wsl_args_template.trim() || null,
				run_args_template: draft.run_args_template.trim() || null,
				wsl_run_args_template: draft.wsl_run_args_template.trim() || null,
				reveal_args_template: draft.reveal_args_template.trim() || null
			}).then(close)
		);
	};

	return (
		<div className='flex flex-col gap-5'>
			{lists.map(({ kind, label, items }) => (
				<div key={kind}>
					<h4 className={heading}>{label}</h4>
					<TargetList
						{...{
							kind,
							items,
							defaultId: defaults[kind],
							onRemove: (id: string) => guard(onRemove(id)),
							onSetDefault: (k: TargetKind, id: string) =>
								guard(onSetDefault(k, id))
						}}
					/>
				</div>
			))}

			{/* detection proposes; nothing is written until a specific Add */}
			<div>
				<div className='flex items-center justify-between mb-2'>
					<h4 className='text-15 font-semibold text-text-primary'>
						Detected on this machine
					</h4>
					<Button
						variant='ghost'
						className='text-13 px-2 hover:text-accent'
						disabled={scanning}
						onClick={scan}
					>
						{scanLabel}
					</Button>
				</div>
				{scanHint ? (
					<p className={hint}>{scanHint}</p>
				) : (
					<ul className='list-none flex flex-col gap-1.5'>
						{(found ?? []).map(d => (
							<li
								key={d.target.id}
								className='flex items-center justify-between gap-3 px-3 py-2 bg-bg-panel rounded-control'
							>
								<span className='flex flex-col min-w-0 flex-1' title={d.detail}>
									<span className='text-15 text-text-primary truncate'>
										{d.target.name}
									</span>
									{/* where it came from: an entry with no provenance is
									    the guessing the old seed policy refused */}
									<span className='font-mono text-11 text-text-muted truncate'>
										{d.source === 'path' || d.source === 'shortcut'
										? d.detail
										: `in ${d.source}`}
									</span>
								</span>
								<span className={`${badge} text-text-muted border-border-strong shrink-0`}>
									{d.target.kind}
								</span>
								<Button
									variant='ghost'
									className='text-13 px-2 hover:text-accent'
									onClick={() => addDetected(d.target.id)}
								>
									Add
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>

			{open ? (
				<div className='flex flex-col gap-2 border border-border rounded-control p-3'>
					<div className='flex gap-2'>
						{KINDS.map(k => (
							<Button
								key={k}
								variant='tab'
								aria-current={kind === k ? 'page' : undefined}
								onClick={() => setKind(k)}
							>
								{LABELS[k]}
							</Button>
						))}
					</div>

					{fieldsFor(kind).map(({ key, placeholder }) => (
						<div key={key} className='flex gap-2'>
							<input
								className={field}
								placeholder={placeholder}
								value={draft[key]}
								onChange={e => setDraft({ ...draft, [key]: e.target.value })}
							/>
							{key === 'executable' ? (
								<Button className='shrink-0 text-13' onClick={browse}>
									Browse…
								</Button>
							) : null}
						</div>
					))}

					<p className='text-11 text-text-muted leading-relaxed max-w-[76ch]'>
						Placeholders:{' '}
						{PLACEHOLDERS.map(({ code, note }) => (
							<span key={code}>
								<code className='text-text-secondary'>{code}</code> {note}{' '}
							</span>
						))}
					</p>

					<div className='flex gap-2'>
						<Button variant='primary' className='flex-1' onClick={submit}>
							Add
						</Button>
						<Button onClick={close}>Cancel</Button>
					</div>
				</div>
			) : (
				<Button className='self-start' onClick={() => setOpen(true)}>
					Add a target
				</Button>
			)}
		</div>
	);
};

export default TargetManager;
