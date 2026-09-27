import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWsl } from './useWsl';

// the same boundary every hook test in this tree stubs, matched to
// Drawer.test.tsx:9's shape
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

// the event path: devgo://wsl. holding the callback lets a test fire it at
// a chosen moment, and the unlisten spy is how the cleanup is observed —
// copied from useProjects.test.ts's onFocus/unlisten wiring
let onWslEvent: ((e: { payload: WslState }) => void) | null = null;
const unlistenEvent = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
	listen: (name: string, cb: (e: { payload: WslState }) => void) => {
		if (name === 'devgo://wsl') onWslEvent = cb;
		return Promise.resolve(unlistenEvent);
	}
}));

// the focus path: the window's own onFocusChanged, same shape as
// useProjects.test.ts
let onFocus: ((e: { payload: boolean }) => void) | null = null;
const unlistenFocus = vi.fn();
vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: (cb: (e: { payload: boolean }) => void) => {
			onFocus = cb;
			return Promise.resolve(unlistenFocus);
		}
	})
}));

const UP = (distros: string[] = ['Ubuntu']): WslState => ({ up: true, distros });
const STOPPED: WslState = { up: false, distros: [] };

const called = (cmd: string) =>
	invoke.mock.calls.filter(c => (c as unknown[])[0] === cmd).length;

// a macrotask inside act: the mount effect's invoke().then(setWsl) needs a
// turn of the loop to land
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
	invoke.mockReset();
	unlistenEvent.mockClear();
	unlistenFocus.mockClear();
	onWslEvent = null;
	onFocus = null;
});
afterEach(() => {
	onWslEvent = null;
	onFocus = null;
});

describe('useWsl — the initial read', () => {
	it('asks get_wsl_state exactly once on mount', async () => {
		invoke.mockResolvedValue(UP());
		renderHook(() => useWsl());
		await settle();

		expect(called('get_wsl_state')).toBe(1);
		expect(invoke).toHaveBeenCalledWith('get_wsl_state');
	});

	it('paints the state the answer carries', async () => {
		invoke.mockResolvedValue(UP(['Ubuntu', 'Debian']));
		const { result } = renderHook(() => useWsl());
		await settle();

		expect(result.current.wsl).toEqual(UP(['Ubuntu', 'Debian']));
	});

	// the module-level default before any answer has landed
	it('starts stopped, before the first answer lands', () => {
		invoke.mockReturnValue(new Promise(() => {}));
		const { result } = renderHook(() => useWsl());

		expect(result.current.wsl).toEqual(STOPPED);
	});
});

describe('useWsl — the event path', () => {
	it('registers a devgo://wsl listener on mount', async () => {
		invoke.mockResolvedValue(STOPPED);
		renderHook(() => useWsl());
		await settle();

		expect(onWslEvent).not.toBeNull();
	});

	it('updates the state when devgo://wsl fires, without a fresh invoke', async () => {
		invoke.mockResolvedValue(STOPPED);
		const { result } = renderHook(() => useWsl());
		await settle();
		expect(result.current.wsl).toEqual(STOPPED);
		const before = called('get_wsl_state');

		await act(async () => {
			onWslEvent?.({ payload: UP(['Ubuntu']) });
		});

		expect(result.current.wsl).toEqual(UP(['Ubuntu']));
		expect(called('get_wsl_state')).toBe(before);
	});

	// ⭐ the classic defect in this shape: a listener promise resolved after
	// unmount, still wired to setWsl on a torn-down component
	it('unsubscribes the devgo://wsl listener on unmount', async () => {
		invoke.mockResolvedValue(STOPPED);
		const { unmount } = renderHook(() => useWsl());
		await settle();

		unmount();
		await waitFor(() => expect(unlistenEvent).toHaveBeenCalledTimes(1));
	});
});

describe('useWsl — the focus path', () => {
	it('re-reads get_wsl_state when the window gains focus', async () => {
		invoke.mockResolvedValue(STOPPED);
		renderHook(() => useWsl());
		await settle();
		expect(called('get_wsl_state')).toBe(1);

		await act(async () => {
			onFocus?.({ payload: true });
		});
		await settle();

		expect(called('get_wsl_state')).toBe(2);
	});

	it('does not re-read when the window LOSES focus', async () => {
		invoke.mockResolvedValue(STOPPED);
		renderHook(() => useWsl());
		await settle();
		expect(called('get_wsl_state')).toBe(1);

		await act(async () => {
			onFocus?.({ payload: false });
		});
		await settle();

		expect(called('get_wsl_state')).toBe(1);
	});

	it('gives the focus listener back on unmount', async () => {
		invoke.mockResolvedValue(STOPPED);
		const { unmount } = renderHook(() => useWsl());
		await settle();

		unmount();
		await waitFor(() => expect(unlistenFocus).toHaveBeenCalledTimes(1));
	});
});

describe('useWsl — the failure path', () => {
	// useWsl.ts:16 — `.catch(() => {})`: a rejection is swallowed and the
	// state simply never updates from whatever it already was. no error
	// surface, no re-throw, nothing for a caller to observe
	it('leaves the state exactly where it was when get_wsl_state rejects, silently', async () => {
		invoke.mockRejectedValue(new Error('wsl.exe not found'));
		const { result } = renderHook(() => useWsl());

		await act(async () => {
			await Promise.resolve().catch(() => {});
			await Promise.resolve().catch(() => {});
		});

		expect(result.current.wsl).toEqual(STOPPED);
	});

	it('does not throw out of the hook when a later refresh rejects', async () => {
		invoke.mockResolvedValueOnce(UP(['Ubuntu']));
		const { result } = renderHook(() => useWsl());
		await settle();
		expect(result.current.wsl).toEqual(UP(['Ubuntu']));

		invoke.mockRejectedValueOnce(new Error('wsl.exe not found'));
		await act(async () => {
			result.current.refreshWsl();
			await Promise.resolve().catch(() => {});
			await Promise.resolve().catch(() => {});
		});

		// the rejection is swallowed: the stale "up" state from before the
		// failed re-read is what is still on screen
		expect(result.current.wsl).toEqual(UP(['Ubuntu']));
	});
});

describe('useWsl — races', () => {
	// a request token in a ref: refreshWsl bumps it per call, and the
	// `.then` discards its answer unless the token still matches current —
	// so the *last-issued* read wins, never merely the last to settle
	it('the last-issued read wins, and a focus event mid-flight still asks again', async () => {
		let resolveFirst!: (v: WslState) => void;
		const first = new Promise<WslState>(r => { resolveFirst = r; });
		invoke.mockReturnValueOnce(first);
		const { result } = renderHook(() => useWsl());
		expect(called('get_wsl_state')).toBe(1);

		// an in-flight flag would swallow this: the mount read above is
		// still outstanding. a token does not care — it fires anyway
		invoke.mockResolvedValueOnce(UP(['Ubuntu']));
		await act(async () => {
			onFocus?.({ payload: true });
			await Promise.resolve();
		});
		expect(called('get_wsl_state')).toBe(2);
		expect(result.current.wsl).toEqual(UP(['Ubuntu']));

		// the mount's read, fired first but settling last, must not clobber
		// the fresher answer that already landed
		await act(async () => {
			resolveFirst(STOPPED);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(result.current.wsl).toEqual(UP(['Ubuntu']));
	});
});
