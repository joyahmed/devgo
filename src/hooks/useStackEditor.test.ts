import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StackEntry } from './useStack';
import { nextDelay, useStackEditor } from './useStackEditor';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));
const open = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: (...a: unknown[]) => open(...(a as []))
}));

const apps: StackEntry[] = [
	{ name: 'Voice', process: 'voice-app', path: 'C:\\v\\voice-app.exe', args: [], delay: 10 },
	{ name: 'DevGo', process: 'DevGo', path: 'C:\\d\\DevGo.exe', args: [], delay: 30 }
];

const makeStack = () => ({
	apps,
	add: vi.fn(() => Promise.resolve(true)),
	update: vi.fn(() => Promise.resolve(true))
});

beforeEach(() => {
	invoke.mockReset();
	open.mockReset();
	open.mockResolvedValue('C:\\m\\desk-monitor.exe');
	invoke.mockResolvedValue({ name: 'Desk Monitor', process: 'desk-monitor', icon: 'data:image/png;base64,AA' });
});

describe('nextDelay', () => {
	it('10 s after the latest start, or 0 for the first app', () => {
		expect(nextDelay([])).toBe(0);
		expect(nextDelay(apps)).toBe(40);
	});
});

describe('useStackEditor', () => {
	it('add starts at the exe picker and fills name, process and icon from it', async () => {
		const stack = makeStack();
		const { result } = renderHook(() => useStackEditor(stack));
		await act(() => result.current.startAdd());
		expect(open).toHaveBeenCalledWith(
			expect.objectContaining({ filters: [{ name: 'Programs', extensions: ['exe'] }] })
		);
		expect(invoke).toHaveBeenCalledWith('stack_describe', { path: 'C:\\m\\desk-monitor.exe' });
		expect(result.current.draft).toEqual({
			index: null,
			name: 'Desk Monitor',
			path: 'C:\\m\\desk-monitor.exe',
			process: 'desk-monitor',
			delay: '40',
			icon: 'data:image/png;base64,AA'
		});
		await act(async () => {
			await result.current.save();
		});
		expect(stack.add).toHaveBeenCalledWith({
			name: 'Desk Monitor',
			path: 'C:\\m\\desk-monitor.exe',
			delay: 40,
			process: 'desk-monitor'
		});
		expect(result.current.draft).toBeNull();
	});

	it('a cancelled picker opens no form', async () => {
		open.mockResolvedValue(null);
		const { result } = renderHook(() => useStackEditor(makeStack()));
		await act(() => result.current.startAdd());
		expect(invoke).not.toHaveBeenCalled();
		expect(result.current.draft).toBeNull();
	});

	it('edit fills the row, saves the delay, and keeps the process', async () => {
		const stack = makeStack();
		const { result } = renderHook(() => useStackEditor(stack));
		act(() => result.current.startEdit(0));
		expect(result.current.draft).toMatchObject({ index: 0, name: 'Voice', delay: '10' });
		act(() => result.current.change('delay', '25'));
		await act(async () => {
			await result.current.save();
		});
		expect(stack.update).toHaveBeenCalledWith(0, {
			name: 'Voice',
			path: 'C:\\v\\voice-app.exe',
			delay: 25
		});
	});

	it('a path typed by hand lets the save derive the process', async () => {
		const stack = makeStack();
		const { result } = renderHook(() => useStackEditor(stack));
		act(() => result.current.startEdit(0));
		act(() => result.current.change('path', 'D:\\x\\talk.exe'));
		await act(async () => {
			await result.current.save();
		});
		expect(stack.update).toHaveBeenCalledWith(0, { name: 'Voice', path: 'D:\\x\\talk.exe', delay: 10 });
	});

	it('Browse while editing takes the new exe but keeps a name the person set', async () => {
		const stack = makeStack();
		const { result } = renderHook(() => useStackEditor(stack));
		act(() => result.current.startEdit(0));
		await act(() => result.current.browse());
		expect(result.current.draft).toMatchObject({
			name: 'Voice',
			path: 'C:\\m\\desk-monitor.exe',
			process: 'desk-monitor'
		});
		await act(async () => {
			await result.current.save();
		});
		expect(stack.update).toHaveBeenCalledWith(0, {
			name: 'Voice',
			path: 'C:\\m\\desk-monitor.exe',
			delay: 10,
			process: 'desk-monitor'
		});
	});

	it('refuses a bad delay, an empty name and a name already in the stack', async () => {
		const stack = makeStack();
		const { result } = renderHook(() => useStackEditor(stack));
		act(() => result.current.startEdit(0));
		const tries: [('name' | 'delay'), string, RegExp][] = [
			['delay', '2.5', /whole seconds/],
			['delay', '-1', /whole seconds/],
			['name', '  ', /a name and a program/i],
			['name', 'devgo', /already in the stack/]
		];
		for (const [key, value, message] of tries) {
			act(() => {
				result.current.change('delay', '10');
				result.current.change('name', 'Voice');
				result.current.change(key, value);
			});
			let ok: boolean | undefined;
			await act(async () => {
				ok = await result.current.save();
			});
			expect(ok).toBe(false);
			expect(result.current.error).toMatch(message);
		}
		expect(stack.update).not.toHaveBeenCalled();
	});

	it('cancel closes the form and clears the error', async () => {
		const { result } = renderHook(() => useStackEditor(makeStack()));
		act(() => result.current.startEdit(1));
		act(() => result.current.change('delay', 'x'));
		await act(async () => {
			await result.current.save();
		});
		expect(result.current.error).not.toBeNull();
		act(() => result.current.cancel());
		expect(result.current.draft).toBeNull();
		expect(result.current.error).toBeNull();
	});
});
