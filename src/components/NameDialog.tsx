import { useState } from 'react';
import Button from './Button';

// one box, one button, one error line: the shape every "give it a name"
// moment shares (a new group, a rename). enter submits; the store's own
// refusal (empty, duplicate) is the message, unedited
const NameDialog = ({
	hint,
	initial = '',
	submitLabel,
	onSubmit,
	onDone
}: NameDialogProps) => {
	const [name, setName] = useState(initial);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		if (!name.trim() || busy) return;
		setBusy(true);
		setError(null);
		try {
			await onSubmit(name);
			onDone();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='text-left'>
			<p className='text-xs text-text-muted mb-3'>{hint}</p>
			<input
				type='text'
				autoFocus
				className='w-full px-3 py-2 bg-bg-panel border border-border-strong rounded-md text-sm text-text-primary outline-none focus:border-accent placeholder:text-text-muted'
				value={name}
				onChange={e => setName(e.target.value)}
				onKeyDown={e => {
					if (e.key === 'Enter') submit();
				}}
				disabled={busy}
			/>
			{error && <p className='text-xs text-danger mt-2'>{error}</p>}
			<div className='flex justify-end mt-4'>
				<Button variant='primary' onClick={submit} disabled={busy || !name.trim()}>
					{submitLabel}
				</Button>
			</div>
		</div>
	);
};

export default NameDialog;
