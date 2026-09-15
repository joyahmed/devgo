import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import Button from './Button';

// add any repository to the github group by name: one you do not own but
// keep visiting. one box, one button; the parsing (owner/name, a url, an
// ssh remote) and the gh repo view happen in rust
const AddRepo = ({ onAdded, onDone }: AddRepoProps) => {
	const [spec, setSpec] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const add = async () => {
		if (!spec.trim() || busy) return;
		setBusy(true);
		setError(null);
		try {
			const repo = await invoke<GithubRepo>('add_github_repo', { spec });
			onAdded(repo);
			onDone();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='text-left'>
			<p className='text-xs text-text-muted mb-3'>
				<span className='font-mono'>owner/name</span> or a GitHub URL. The row
				joins the group without cloning, and stays through refreshes.
			</p>
			<input
				type='text'
				autoFocus
				className='w-full px-3 py-2 bg-bg-panel border border-border-strong rounded-md font-mono text-sm text-text-primary outline-none focus:border-accent placeholder:text-text-muted'
				placeholder='tauri-apps/tauri'
				value={spec}
				onChange={e => setSpec(e.target.value)}
				onKeyDown={e => {
					if (e.key === 'Enter') add();
				}}
				disabled={busy}
			/>
			{error && <p className='text-xs text-danger mt-2'>{error}</p>}
			<div className='flex justify-end mt-4'>
				<Button variant='primary' onClick={add} disabled={busy || !spec.trim()}>
					{busy ? 'Looking it up…' : 'Add to the list'}
				</Button>
			</div>
		</div>
	);
};

export default AddRepo;
