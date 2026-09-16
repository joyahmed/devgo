import { useState } from 'react';
import Button from './Button';

const field =
	'w-full px-3 py-2 bg-bg-panel border border-border-strong rounded-control font-mono text-13 text-text-primary outline-none focus:border-accent placeholder:text-text-muted disabled:opacity-50';
const label = 'text-13 text-text-muted mb-1 block';

// what the form edits, as text; the row is built from it on submit
type Draft = {
	name: string;
	alias: string;
	host: string;
	user: string;
	port: string;
	identity: string;
	defaultPath: string;
	session: string;
};

const FIELDS: {
	key: keyof Draft;
	label: string;
	placeholder: string;
	wide?: boolean;
	digits?: boolean;
}[] = [
	{ key: 'name', label: 'Name', placeholder: 'Hostinger VPS', wide: true },
	{ key: 'alias', label: 'Alias (from ~/.ssh/config)', placeholder: 'box' },
	{ key: 'host', label: 'Host (if no alias)', placeholder: '203.0.113.7' },
	{ key: 'user', label: 'User', placeholder: 'joy' },
	{ key: 'port', label: 'Port', placeholder: '22', digits: true },
	{
		key: 'identity',
		label: 'Key path (optional, manual hosts only)',
		placeholder: '~/.ssh/id_ed25519',
		wide: true
	},
	{
		key: 'defaultPath',
		label: 'Default path on the server',
		placeholder: '/home/joy/projects',
		wide: true
	}
];

const MODES = [
	{ value: true, label: 'Session' },
	{ value: false, label: 'Plain shell' }
];

const fromServer = (s?: Server): Draft => ({
	name: s?.name ?? '',
	alias: s?.alias ?? '',
	host: s?.host ?? '',
	user: s?.user ?? '',
	port: s?.port ? String(s.port) : '',
	identity: s?.identity ?? '',
	defaultPath: s?.default_path ?? '',
	session: s?.session ?? ''
});

const orNull = (v: string) => v.trim() || null;

// add or edit a server: name, alias or host, user, port, key path, default
// path, the tmux switch and its session name. no password field: devgo
// holds no secrets, ssh uses your keys
const ServerForm = ({ initial, onSubmit, onDone }: ServerFormProps) => {
	const [draft, setDraft] = useState<Draft>(() => fromServer(initial));
	const [tmux, setTmux] = useState(initial?.tmux ?? true);
	const [roots, setRoots] = useState((initial?.roots ?? []).join('\n'));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const valid = draft.name.trim() && (draft.alias.trim() || draft.host.trim());

	const set = (key: keyof Draft, digits?: boolean) => (value: string) =>
		setDraft({ ...draft, [key]: digits ? value.replace(/\D/g, '') : value });

	const submit = async () => {
		if (!valid || busy) return;
		setBusy(true);
		setError(null);
		try {
			await onSubmit({
				id: initial?.id,
				name: draft.name.trim(),
				alias: orNull(draft.alias),
				host: draft.host.trim() || draft.alias.trim(),
				user: orNull(draft.user),
				port: draft.port.trim() ? Number(draft.port) : null,
				identity: orNull(draft.identity),
				default_path: orNull(draft.defaultPath),
				tmux,
				session: orNull(draft.session),
				tunnel: initial?.tunnel ?? false,
				source: initial?.source ?? 'manual',
				roots: roots
					.split('\n')
					.map(r => r.trim())
					.filter(Boolean)
			});
			onDone();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='text-left flex flex-col gap-3 overflow-y-auto'>
			<p className='text-13 text-text-muted'>
				An <span className='font-mono'>alias</span> from{' '}
				<span className='font-mono'>~/.ssh/config</span> is the best way in: it
				carries your key and every option. Or type a host. DevGo stores no
				password; <span className='font-mono'>ssh</span> uses your keys.
			</p>
			<div className='grid grid-cols-2 gap-3'>
				{FIELDS.map((f, i) => (
					<div key={f.key} className={f.wide ? 'col-span-2' : ''}>
						<span className={label}>{f.label}</span>
						<input
							className={field}
							autoFocus={i === 0}
							value={draft[f.key]}
							onChange={e => set(f.key, f.digits)(e.target.value)}
							placeholder={f.placeholder}
						/>
					</div>
				))}
				<div>
					<span className={label}>tmux session on the server</span>
					<div className='flex items-center gap-2'>
						{MODES.map(m => (
							<Button
								key={m.label}
								variant='target'
								aria-current={tmux === m.value ? 'true' : undefined}
								onClick={() => setTmux(m.value)}
							>
								{m.label}
							</Button>
						))}
					</div>
				</div>
				<div>
					<span className={label}>Session name</span>
					<input
						className={field}
						value={draft.session}
						onChange={e => set('session')(e.target.value)}
						placeholder='devgo'
						disabled={!tmux}
					/>
				</div>
				<div className='col-span-2'>
					<span className={label}>
						Top-level folders to list, one per line (empty = ~, ~/projects,
						/var/www, /srv)
					</span>
					<textarea
						className={`${field} h-20 resize-none`}
						value={roots}
						onChange={e => setRoots(e.target.value)}
						placeholder={'~/projects\n/var/www'}
					/>
				</div>
			</div>
			{error && <p className='text-13 text-danger'>{error}</p>}
			<div className='flex justify-end gap-3 mt-1'>
				<Button onClick={onDone}>Cancel</Button>
				<Button variant='primary' onClick={submit} disabled={busy || !valid}>
					{busy ? 'Saving…' : initial ? 'Save' : 'Add server'}
				</Button>
			</div>
		</div>
	);
};

export default ServerForm;
