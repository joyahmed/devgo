import { useState } from 'react';
import Button from './Button';

const KINDS: TargetKind[] = ['editor', 'terminal'];

const BLANK: TargetDraft = {
	name: '',
	executable: '',
	args_template: '"{path}"',
	wsl_executable: '',
	wsl_args_template: ''
};

const FIELDS: { key: keyof TargetDraft; placeholder: string }[] = [
	{ key: 'name', placeholder: 'Name — e.g. Cursor' },
	{ key: 'executable', placeholder: 'Executable — e.g. cursor' },
	{ key: 'args_template', placeholder: 'Windows args — e.g. "{path}"' },
	{
		key: 'wsl_executable',
		placeholder: 'WSL executable — blank if it speaks WSL itself'
	},
	{
		key: 'wsl_args_template',
		placeholder: 'WSL args — blank means it cannot open WSL projects'
	}
];

const PLACEHOLDERS = [
	{ code: '{path}', note: 'the Windows path' },
	{ code: '{distro}', note: 'and' },
	{ code: '{linux_path}', note: 'for WSL, and' },
	{ code: '{script}', note: '— terminals only — the generated tmux session script' }
];

const heading =
	'text-xs font-bold uppercase tracking-wider text-text-secondary mb-2';
const field =
	'w-full px-2 py-1.5 bg-bg-panel border border-border-strong rounded text-xs font-mono text-text-primary outline-none focus:border-accent';
const badge = 'text-[9px] uppercase tracking-wider rounded px-1 border';

const TargetList = ({
	kind,
	items,
	defaultId,
	onRemove,
	onSetDefault
}: TargetListProps) => (
	<div className='flex flex-col gap-1'>
		{items.map(t => {
			// The "windows only" badge reads the refusal straight off the model:
			// a null WSL template is the target saying it cannot open WSL projects.
			const badges = [
				{
					show: t.id === defaultId,
					label: 'default',
					className: 'text-accent border-accent/40'
				},
				{
					show: !t.wsl_args_template,
					label: 'windows only',
					className: 'text-text-muted border-border-strong',
					title: 'No WSL configuration — this target cannot open WSL projects'
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
					className='flex items-center justify-between gap-3 px-3 py-2 bg-bg-panel rounded-md'
				>
					<div className='min-w-0'>
						<div className='flex items-center gap-2'>
							<span className='text-sm text-text-primary truncate'>{t.name}</span>
							{badges
								.filter(b => b.show)
								.map(({ label, className, title }) => (
									<span key={label} className={`${badge} ${className}`} title={title}>
										{label}
									</span>
								))}
						</div>
						<div className='font-mono text-[11px] text-text-muted truncate'>
							{t.executable} {t.args_template}
						</div>
					</div>
					<div className='flex items-center gap-1 shrink-0'>
						{actions
							.filter(a => a.show)
							.map(({ label, className, onClick }) => (
								<Button
									key={label}
									variant='ghost'
									className={`text-xs px-2 ${className}`}
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
	defaults,
	onAdd,
	onRemove,
	onSetDefault,
	onError
}: TargetManagerProps) => {
	const [kind, setKind] = useState<TargetKind>('editor');
	const [draft, setDraft] = useState(BLANK);
	const [open, setOpen] = useState(false);

	// Every action here can fail on purpose — removing the last editor is
	// refused with a sentence the user needs to read. The panel does not own
	// a toast; the failure travels up.
	const guard = (p: Promise<void>) => p.catch(e => onError(String(e)));

	const lists = [
		{ kind: 'editor' as TargetKind, label: 'Editors', items: editors },
		{ kind: 'terminal' as TargetKind, label: 'Terminals', items: terminals }
	];

	const close = () => {
		setDraft(BLANK);
		setOpen(false);
	};

	const submit = () => {
		if (!draft.name.trim() || !draft.executable.trim()) {
			onError('A target needs a name and an executable');
			return;
		}
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
				wsl_args_template: draft.wsl_args_template.trim() || null
			})
		).then(close);
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

			{open ? (
				<div className='flex flex-col gap-2 border border-border rounded-lg p-3'>
					<div className='flex gap-2'>
						{KINDS.map(k => (
							<Button
								key={k}
								variant='tab'
								aria-current={kind === k ? 'page' : undefined}
								onClick={() => setKind(k)}
							>
								{k}
							</Button>
						))}
					</div>

					{FIELDS.map(({ key, placeholder }) => (
						<input
							key={key}
							className={field}
							placeholder={placeholder}
							value={draft[key]}
							onChange={e => setDraft({ ...draft, [key]: e.target.value })}
						/>
					))}

					<p className='text-[11px] text-text-muted leading-relaxed'>
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
					Add editor or terminal
				</Button>
			)}
		</div>
	);
};

export default TargetManager;
