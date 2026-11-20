import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, processFromPath, useStack } from './useStack';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));
vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({ close: vi.fn() })
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
		return Promise.resolve(true);
	});
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
});
