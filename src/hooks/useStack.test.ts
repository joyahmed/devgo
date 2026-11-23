import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, clearIconCache, processFromPath, useStack } from './useStack';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

const apps = [
	{ name: 'voice', process: 'voice-app', path: 'C:\\v\\voice-app.exe', args: [], delay: 10 },
	{ name: 'DevGo', process: 'DevGo', path: 'C:\\d\\DevGo.exe', args: [], delay: 30 }
];

let visibility: DocumentVisibilityState = 'visible';
const statusCalls = () => invoke.mock.calls.filter(c => c[0] === 'stack_status').length;

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	visibility = 'visible';
	vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
	invoke.mockReset();
	invoke.mockImplementation((cmd: string, args?: { file?: { apps: unknown[] } }) => {
		if (cmd === 'stack_list') return Promise.resolve({ apps });
		if (cmd === 'stack_save') return Promise.resolve(args?.file);
		if (cmd === 'stack_status')
			return Promise.resolve([{ name: 'voice', running: true, isSelf: false, missing: false }]);
		if (cmd === 'stack_icon') return Promise.resolve(`data:image/png;base64,${args ? 'x' : ''}`);
		return Promise.resolve(true);
	});
	clearIconCache();
});
afterEach(() => vi.useRealTimers());

describe('processFromPath', () => {
	it('takes the exe name without .exe from either slash', () => {
		expect(processFromPath('%LOCALAPPDATA%\\Desk Monitor\\desk-monitor.exe')).toBe('desk-monitor');
		expect(processFromPath('/usr/bin/devgo')).toBe('devgo');
	});
});

describe('useStack', () => {
	it('polls every POLL_MS while visible and stops while hidden', async () => {
		const { result, unmount } = renderHook(() => useStack());
		await waitFor(() => expect(result.current.apps).toHaveLength(2));
		await waitFor(() => expect(result.current.status.voice?.running).toBe(true));
		const first = statusCalls();
		await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
		expect(statusCalls()).toBe(first + 3);

		visibility = 'hidden';
		act(() => document.dispatchEvent(new Event('visibilitychange')));
		const paused = statusCalls();
		await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 5));
		expect(statusCalls()).toBe(paused);

		unmount();
	});

	it('stops polling when the window goes away', async () => {
		const { unmount } = renderHook(() => useStack());
		await waitFor(() => expect(statusCalls()).toBeGreaterThan(0));
		unmount();
		const after = statusCalls();
		await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 5));
		expect(statusCalls()).toBe(after);
	});

	it('moves, removes and adds through stack_save', async () => {
		const { result } = renderHook(() => useStack());
		await waitFor(() => expect(result.current.apps).toHaveLength(2));
		await act(async () => result.current.move(0, 1));
		expect(result.current.apps.map(a => a.name)).toEqual(['DevGo', 'voice']);
		await act(async () => {
			await result.current.add({ name: 'mon', path: 'C:\\m\\desk-monitor.exe', delay: 20 });
		});
		expect(result.current.apps[2]).toEqual({
			name: 'mon',
			process: 'desk-monitor',
			path: 'C:\\m\\desk-monitor.exe',
			args: [],
			delay: 20
		});
		await act(async () => result.current.remove(0));
		expect(result.current.apps.map(a => a.name)).toEqual(['voice', 'mon']);
	});

	it('shows the error a refused action returns', async () => {
		invoke.mockImplementation((cmd: string) =>
			cmd === 'stack_stop'
				? Promise.reject('voice: still running')
				: Promise.resolve(cmd === 'stack_list' ? { apps } : [])
		);
		const { result } = renderHook(() => useStack());
		await act(() => result.current.act('voice', 'stop'));
		expect(result.current.error).toBe('voice: still running');
		expect(invoke).toHaveBeenCalledWith('stack_stop', { name: 'voice' });
	});

	it('polls no faster than every 5 s', () => {
		expect(POLL_MS).toBeGreaterThanOrEqual(5000);
	});

	it('a poll that changes nothing does not re-render', async () => {
		let renders = 0;
		const { result } = renderHook(() => {
			renders++;
			return useStack();
		});
		await waitFor(() => expect(result.current.status.voice?.running).toBe(true));
		const before = renders;
		const status = result.current.status;
		await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
		expect(statusCalls()).toBeGreaterThanOrEqual(4);
		expect(renders).toBe(before);
		expect(result.current.status).toBe(status);
	});

	it('does not poll or read the list while not active, and starts when it is', async () => {
		const { rerender, result } = renderHook(({ active }) => useStack({ active }), {
			initialProps: { active: false }
		});
		await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
		expect(statusCalls()).toBe(0);
		expect(invoke).not.toHaveBeenCalledWith('stack_list');
		rerender({ active: true });
		await waitFor(() => expect(result.current.apps).toHaveLength(2));
		await waitFor(() => expect(statusCalls()).toBe(1));
		rerender({ active: false });
		const off = statusCalls();
		await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
		expect(statusCalls()).toBe(off);
	});

	it('asks for uptime and memory only with detail', async () => {
		renderHook(() => useStack({ detail: true }));
		await waitFor(() => expect(invoke).toHaveBeenCalledWith('stack_status', { detail: true }));
		expect(invoke).not.toHaveBeenCalledWith('stack_status', { detail: false });
	});

	it('re-renders when the printed uptime moves, not on every poll', async () => {
		let secs = 3600;
		invoke.mockImplementation((cmd: string) => {
			if (cmd === 'stack_list') return Promise.resolve({ apps });
			if (cmd === 'stack_status') {
				secs += 5;
				return Promise.resolve([
					{ name: 'voice', running: true, isSelf: false, missing: false, uptimeSecs: secs, memBytes: 1 << 20 }
				]);
			}
			return Promise.resolve(null);
		});
		const { result } = renderHook(() => useStack({ detail: true }));
		await waitFor(() => expect(result.current.status.voice?.uptimeSecs).toBeDefined());
		const first = result.current.status;
		// 3605 s -> 3610 s: both print "1 h", nothing to repaint
		await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
		expect(result.current.status).toBe(first);
		// eleven more polls cross a minute: "1 h 1 min"
		await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 11));
		expect(result.current.status).not.toBe(first);
	});

	it('reads each icon once, and keeps it across mounts', async () => {
		const first = renderHook(() => useStack());
		await waitFor(() => expect(first.result.current.icons[apps[0].path]).toBeTruthy());
		const iconCalls = () => invoke.mock.calls.filter(c => c[0] === 'stack_icon').length;
		expect(iconCalls()).toBe(2);
		first.unmount();
		const second = renderHook(() => useStack());
		await waitFor(() => expect(second.result.current.icons[apps[0].path]).toBeTruthy());
		expect(iconCalls()).toBe(2);
	});

	it('update patches one row, and a new path brings its process name', async () => {
		const { result } = renderHook(() => useStack());
		await waitFor(() => expect(result.current.apps).toHaveLength(2));
		await act(async () => {
			await result.current.update(0, { delay: 15 });
		});
		expect(result.current.apps[0]).toMatchObject({ name: 'voice', process: 'voice-app', delay: 15 });
		await act(async () => {
			await result.current.update(0, { path: 'D:\\x\\Talk.exe' });
		});
		expect(result.current.apps[0]).toMatchObject({ path: 'D:\\x\\Talk.exe', process: 'Talk' });
		await act(async () => {
			await result.current.update(0, { path: 'D:\\y\\t.exe', process: 'talk-core' });
		});
		expect(result.current.apps[0].process).toBe('talk-core');
		expect(result.current.apps[1].name).toBe('DevGo');
	});

	it('stop all goes through stack_stop_all and marks the header busy', async () => {
		let release: (v: unknown) => void = () => {};
		invoke.mockImplementation((cmd: string) => {
			if (cmd === 'stack_list') return Promise.resolve({ apps });
			if (cmd === 'stack_stop_all') return new Promise(r => (release = r));
			return Promise.resolve([]);
		});
		const { result } = renderHook(() => useStack());
		let done: Promise<void> | undefined;
		act(() => {
			done = result.current.stopAll();
		});
		expect(result.current.busy['*']).toBe(true);
		await act(async () => {
			release(['voice']);
			await done;
		});
		expect(result.current.busy['*']).toBe(false);
		expect(invoke).toHaveBeenCalledWith('stack_stop_all', undefined);
	});
});
