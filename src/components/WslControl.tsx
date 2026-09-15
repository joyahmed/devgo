import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import Button from './Button';

const STOP_ONE = (d: string) =>
	`Stop ${d}? Anything running inside it — dev servers, tmux sessions, VS Code Remote — will be terminated. Other distros are left alone.`;
const STOP_ALL =
	'Shut down all of WSL? This stops every distro and the virtual machine itself — including Docker Desktop if it uses the WSL2 backend. Use this when stopping a single distro did not clear the problem.';

/// Live WSL state, and the two ways to stop it.
///
/// Stopping one distro comes first; shutting everything down sits below a
/// separator as the escalation. That ordering is not just tidiness — it is the
/// real troubleshooting order, because `--terminate` leaves the VM up and will
/// not always clear a wedged VM, which is when `--shutdown` earns its keep.
const WslControl = ({
	distros,
	onChanged,
	onConfirm,
	onResult
}: WslControlProps) => {
	const [open, setOpen] = useState(false);
	// Which row is working, or null. One value answers both "is anything in
	// flight?" and "which button says Stopping…", so two can never be at once.
	const [busy, setBusy] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		window.addEventListener('mousedown', away);
		window.addEventListener('keydown', esc);
		return () => {
			window.removeEventListener('mousedown', away);
			window.removeEventListener('keydown', esc);
		};
	}, [open]);

	const run = (label: string, command: string, args: Record<string, unknown>) => {
		setBusy(label);
		invoke<string>(command, args)
			.then(msg => onResult(msg, 'success'))
			.catch(e => onResult(typeof e === 'string' ? e : String(e), 'error'))
			.finally(() => {
				// Whatever happened, the displayed state is now questionable —
				// especially on failure — so it is re-read, not assumed.
				setBusy(null);
				setOpen(false);
				onChanged();
			});
	};

	const running = distros.length > 0;

	return (
		<div className='relative' ref={ref}>
			<Button
				variant='badge'
				title={
					running
						? `WSL running: ${distros.join(', ')}`
						: 'No WSL distro is running'
				}
				onClick={() => setOpen(v => !v)}
				disabled={!running}
			>
				WSL · {running ? `${distros.length} running` : 'stopped'}
			</Button>

			{open && (
				<div className='absolute right-0 mt-1 z-50 min-w-56 bg-bg-secondary border border-border rounded-lg shadow-2xl py-1 text-sm'>
					{distros.map(d => (
						<div
							key={d}
							className='flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-bg-hover/50'
						>
							<span className='font-mono text-xs truncate text-text-secondary'>
								{d}
							</span>
							<Button
								variant='ghost'
								className='text-xs px-2'
								disabled={busy !== null}
								onClick={() =>
									onConfirm(STOP_ONE(d), () =>
										run(d, 'terminate_distro', { distro: d })
									)
								}
							>
								{busy === d ? 'Stopping…' : 'Stop'}
							</Button>
						</div>
					))}

					<div className='my-1 border-b border-border' />

					<Button
						variant='ghost'
						className='w-full justify-start text-xs px-3 hover:bg-danger/10'
						disabled={busy !== null}
						onClick={() =>
							onConfirm(STOP_ALL, () => run('all', 'shutdown_wsl', {}))
						}
					>
						<span className='text-danger'>
							{busy === 'all' ? 'Shutting down…' : 'Shut down all WSL'}
						</span>
					</Button>
				</div>
			)}
		</div>
	);
};

export default WslControl;
