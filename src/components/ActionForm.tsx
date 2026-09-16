import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { whenHolds } from '../serverApps';
import Button from './Button';

const field =
	'w-full px-3 py-2 bg-bg-panel border border-border-strong rounded-control font-mono text-13 text-text-primary outline-none focus:border-accent placeholder:text-text-muted';
const label = 'text-13 text-text-muted mb-1 block';

const BOOLS = [
	{ value: 'true', label: 'On' },
	{ value: 'false', label: 'Off' }
];

// a form action: the fields the server declared, the line they compose
// shown as you type from the same rust compose that will send it, and two
// buttons. preview appends the action's preview word; the submit button
// sends the line as it stands. both land in a tmux window on the server,
// where sudo asks. a value is a word: rust refuses a space or a quote and
// names the field, and that message sits under it
const ActionForm = ({
	server,
	action,
	appDir,
	initial,
	onRun,
	onDone
}: ActionFormProps) => {
	const [values, setValues] = useState<Record<string, string>>(initial);
	const [line, setLine] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const set = (name: string, v: string) =>
		setValues(prev => ({ ...prev, [name]: v }));

	// the truth on screen before the click: every change re-composes
	useEffect(() => {
		let live = true;
		invoke<string>('compose_server_action', {
			id: server.id,
			actionId: action.id,
			appDir,
			values,
			preview: false
		})
			.then(l => {
				if (!live) return;
				setLine(l);
				setError(null);
			})
			.catch(e => {
				if (live) setError(String(e));
			});
		return () => {
			live = false;
		};
	}, [server.id, action.id, appDir, values]);

	const send = async (preview: boolean) => {
		if (busy || error) return;
		setBusy(true);
		try {
			await onRun(values, preview);
			onDone();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	const visible = action.fields.filter(f => whenHolds(f.when, values));
	// the field the error names, so the message sits under it
	const errorField = error
		? visible.find(f => error.startsWith(f.label ?? f.name))
		: undefined;

	// a choice or a bool is a row of target buttons; the rest is a box
	const control = (f: ServerActionField, v: string, mine: boolean) => {
		const options =
			f.type === 'choice'
				? f.options.map(o => ({ value: o, label: o }))
				: f.type === 'bool'
					? BOOLS
					: null;
		if (options) {
			return (
				<div className='flex items-center gap-2 flex-wrap'>
					{options.map(o => (
						<Button
							key={o.value}
							variant='target'
							className={f.type === 'choice' ? 'font-mono uppercase' : ''}
							aria-current={v === o.value ? 'true' : undefined}
							onClick={() => set(f.name, o.value)}
						>
							{o.label}
						</Button>
					))}
				</div>
			);
		}
		return (
			<input
				className={`${field} ${mine ? 'border-danger' : ''}`}
				value={v}
				inputMode={f.type === 'number' ? 'numeric' : undefined}
				onChange={e => set(f.name, e.target.value)}
				placeholder={f.type === 'number' ? '3025' : ''}
				autoFocus={visible[0]?.name === f.name && !v}
			/>
		);
	};

	return (
		<div className='flex flex-col gap-4'>
			<p className='text-13 text-text-muted'>
				On <span className='font-mono text-text-primary'>{server.name}</span>
				{appDir && (
					<>
						{' '}
						· <span className='font-mono text-text-primary'>{appDir}</span>
					</>
				)}
				{action.root && (
					<>
						{' '}
						· <span className='font-mono'>sudo</span> will ask in the terminal
					</>
				)}
			</p>
			<div className='grid grid-cols-2 gap-x-4 gap-y-3'>
				{visible.map(f => {
					const v = values[f.name] ?? '';
					const mine = errorField?.name === f.name;
					return (
						<div key={f.name} className={f.type === 'text' ? 'col-span-2' : ''}>
							<span className={label}>
								{f.label ?? f.name}
								{f.required && <span className='text-text-muted'> *</span>}
							</span>
							{control(f, v, mine)}
							{mine && <p className='text-11 text-danger mt-1'>{error}</p>}
							{!mine && f.hint && (
								<p className='text-11 text-text-muted mt-1'>{f.hint}</p>
							)}
						</div>
					);
				})}
			</div>

			<div>
				<span className={label}>The line, exactly as it will be typed</span>
				<div
					className={`px-3 py-2 rounded-control border font-mono text-13 break-all ${
						error
							? 'border-danger/60 text-text-muted'
							: 'border-border text-text-primary bg-bg-secondary/40'
					}`}
				>
					{error && !errorField ? (
						<span className='text-danger'>{error}</span>
					) : (
						line || '…'
					)}
				</div>
				{action.preview && !error && (
					<p className='text-11 text-text-muted mt-1'>
						Preview adds <span className='font-mono'>{action.preview}</span>:
						the script prints what it would do and changes nothing.
					</p>
				)}
			</div>

			<div className='flex justify-end gap-3 mt-1'>
				<Button onClick={onDone}>Cancel</Button>
				{action.preview && (
					<Button onClick={() => send(true)} disabled={busy || !!error}>
						Preview
					</Button>
				)}
				<Button
					variant='primary'
					onClick={() => send(false)}
					disabled={busy || !!error}
				>
					{busy ? 'Sending…' : (action.submit ?? 'Run')}
				</Button>
			</div>
		</div>
	);
};

export default ActionForm;
