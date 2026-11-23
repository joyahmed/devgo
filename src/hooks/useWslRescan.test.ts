import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { staleWslWorkspaces, useWslRescan } from './useWslRescan';

const WSL_WS = '\\\\wsl.localhost\\Ubuntu\\home\\joy\\projects\\03_ai';
const WIN_WS = 'G:\\03_ai';

const state = (
	workspace: string,
	status: WorkspaceStatus,
	reason: UnavailableReason | null
): WorkspaceState => ({ workspace, status, reason, scanned_at: 1, count: 3 });

const cachedWsl = state(WSL_WS, 'cached', 'distro_stopped');
const live = [state(WSL_WS, 'live', null), state(WIN_WS, 'live', null)];
const up: WslState = { up: true, distros: ['Ubuntu'] };
const down: WslState = { up: false, distros: [] };

describe('staleWslWorkspaces', () => {
	it('names a workspace skipped as stopped whose distro now runs', () => {
		expect(staleWslWorkspaces([cachedWsl], ['ubuntu'])).toEqual([WSL_WS]);
	});
	it('ignores it while the distro is still stopped, and live or windows rows', () => {
		expect(staleWslWorkspaces([cachedWsl], [])).toEqual([]);
		expect(staleWslWorkspaces([cachedWsl], ['Debian'])).toEqual([]);
		expect(staleWslWorkspaces(live, ['Ubuntu'])).toEqual([]);
	});
});

describe('useWslRescan', () => {
	it('rescans once when wsl comes up under a lane read as stopped', () => {
		const refresh = vi.fn(() => Promise.resolve());
		const { rerender } = renderHook(
			({ s, w }) => useWslRescan(s, w, refresh),
			{ initialProps: { s: [cachedWsl], w: down } }
		);
		expect(refresh).not.toHaveBeenCalled();
		rerender({ s: [cachedWsl], w: up });
		expect(refresh).toHaveBeenCalledTimes(1);
		// the same mismatch again (a focus re-read of the chip) is not a loop
		rerender({ s: [cachedWsl], w: { ...up } });
		expect(refresh).toHaveBeenCalledTimes(1);
		// the pass landed live: nothing more to do
		rerender({ s: live, w: up });
		expect(refresh).toHaveBeenCalledTimes(1);
		// wsl idles out, a pass reads it stopped, then wsl comes back: again
		rerender({ s: [cachedWsl], w: down });
		rerender({ s: [cachedWsl], w: up });
		expect(refresh).toHaveBeenCalledTimes(2);
	});
});
