import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import Button from './Button';

const STOP_ONE = (d: string) =>
	`Stop ${d}? Anything running inside it — dev servers, tmux sessions, VS Code Remote — will be terminated. Other distros are left alone.`;
const STOP_ALL =
	'Shut down all of WSL? This stops every distro and the virtual machine itself — including Docker Desktop if it uses the WSL2 backend. Use this when stopping a single distro did not clear the problem.';

/// The two ways to switch WSL off, under the chip.
///
/// Stopping one distro comes first; shutting everything down sits below a
/// separator as the escalation. That ordering is not just tidiness — it is the
/// real troubleshooting order, because `--terminate` leaves the VM up and will
/// not always clear a wedged VM, which is when `--shutdown` earns its keep.
const WslMenu = ({
	wsl,
	close,
	onChanged,
	onConfirm,
	onResult
}: WslMenuProps) => {
	// Which row is working, or null. One value answers both "is anything in
	// flight?" and "which button says Stopping…", so two can never be at once.
	const [busy, setBusy] = useState<string | null>(null);

	const run = (label: string, command: string, args: Record<string, unknown>) => {
		setBusy(label);
		invoke<string>(command, args)
			.then(msg => onResult(msg, 'success'))
			.catch(e => onResult(typeof e === 'string' ? e : String(e), 'error'))
			.finally(() => {
				// Whatever happened, the displayed state is now questionable —
				// especially on failure — so it is re-read, not assumed.
				setBusy(null);
				close();
				onChanged();
			});
	};

	return (
		// bg-popover: a dropdown hangs over the rows below the button it
		// belongs to, so its ground is the one that does not follow the knob
		<div className='absolute right-0 mt-1 z-50 min-w-56 bg-bg-popover border border-border rounded-control shadow-surface py-1 text-15'>
			{wsl.distros.map(d => (
				<div
					key={d}
					className='flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-bg-hover/50'
				>
					<span className='font-mono text-13 truncate text-text-secondary'>
						{d}
					</span>
					<Button
						variant='ghost'
						className='text-13 px-2'
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
				className='w-full justify-start text-13 px-3 hover:bg-danger/10'
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
	);
};

export default WslMenu;
