import { useEffect, useRef } from 'react';
import { wslDistroOf } from '../paths';

// the workspaces the last pass skipped as "distro stopped" whose distro the
// chip now says is running. a pass never boots a distro on its own, so a
// workspace read while wsl was down stays on its cache; nothing re-read it
// when wsl came up, and the lanes said "cached · WSL stopped" under a chip
// that said "1 running" until a focus pass past the 60s cooldown
export const staleWslWorkspaces = (
	states: WorkspaceState[],
	running: string[]
): string[] =>
	states
		.filter(s => {
			if (s.reason !== 'distro_stopped') return false;
			const distro = wslDistroOf(s.workspace);
			return (
				!!distro && running.some(r => r.toLowerCase() === distro.toLowerCase())
			);
		})
		.map(s => s.workspace);

// one plain pass (no force: the distro is already up, nothing gets booted)
// per new mismatch. the key stops a loop when the pass comes back with the
// same answer, e.g. the distro stopped again in between
export const useWslRescan = (
	states: WorkspaceState[],
	wsl: WslState,
	refresh: () => Promise<unknown>
) => {
	const lastKey = useRef('');
	useEffect(() => {
		const stale = staleWslWorkspaces(states, wsl.distros);
		if (stale.length === 0) {
			lastKey.current = '';
			return;
		}
		const key = `${wsl.distros.join(',')}|${stale.join(',')}`;
		if (key === lastKey.current) return;
		lastKey.current = key;
		refresh().catch(() => {});
	}, [states, wsl]);
};
