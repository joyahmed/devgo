import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearIconCache } from './useStack';
import { CARD_MIN_WIDTH, PILL_CARD_EXTRA, useStackPill } from './useStackPill';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));
const startDragging = vi.fn(() => Promise.resolve());
const close = vi.fn(() => Promise.resolve());
vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({ startDragging, close })
}));

const entry = (name: string) => ({ name, process: name, path: `C:\\${name}.exe`, args: [], delay: 0 });
const apps = ['voice', 'DevGo', 'notes', 'ghost'].map(entry);
const rows = [
	{ name: 'voice', running: true, isSelf: false, missing: false },
	{ name: 'DevGo', running: true, isSelf: true, missing: false },
	{ name: 'notes', running: false, isSelf: false, missing: false },
	{ name: 'ghost', running: false, isSelf: false, missing: true }
];
let hoverSide = 'below';

beforeEach(() => {
	invoke.mockReset();
	startDragging.mockClear();
	close.mockClear();
	hoverSide = 'below';
	invoke.mockImplementation((cmd: string) => {
		if (cmd === 'stack_list') return Promise.resolve({ apps });
		if (cmd === 'stack_status') return Promise.resolve(rows);
		if (cmd === 'stack_icon') return Promise.resolve(null);
		if (cmd === 'stack_pill_hover') return Promise.resolve(hoverSide);
		return Promise.resolve(true);
	});
	clearIconCache();
});

const ready = async () => {
	const hook = renderHook(() => useStackPill());
	await waitFor(() => expect(hook.result.current.dots.map(d => d.state)).toEqual(['running', 'running', 'stopped', 'missing']));
	invoke.mockClear();
	return hook;
};
const dot = (r: { current: ReturnType<typeof useStackPill> }, name: string) =>
	r.current.dots.find(d => d.name === name)!;
const calls = (cmd: string) => invoke.mock.calls.filter(c => c[0] === cmd);
const press = (x: number, y: number) => ({ button: 0, buttons: 1, screenX: x, screenY: y });

describe('useStackPill', () => {
	it('polls without detail: the pill shows no uptime or memory', async () => {
		renderHook(() => useStackPill());
		await waitFor(() => expect(invoke).toHaveBeenCalledWith('stack_status', { detail: false }));
	});

	it('a running dot stops its app, a stopped dot starts it', async () => {
		const { result } = await ready();
		await act(async () => {
			await result.current.clickDot(dot(result, 'voice'))();
			await result.current.clickDot(dot(result, 'notes'))();
		});
		expect(invoke).toHaveBeenCalledWith('stack_stop', { name: 'voice' });
		expect(invoke).toHaveBeenCalledWith('stack_start', { name: 'notes' });
	});

	it("DevGo's own dot does nothing", async () => {
		const { result } = await ready();
		await act(async () => {
			await result.current.clickDot(dot(result, 'DevGo'))();
		});
		expect(invoke.mock.calls.filter(c => String(c[0]).match(/^stack_(start|stop|restart|show_tab)$/))).toEqual([]);
		expect(dot(result, 'DevGo').label).toContain('this app');
	});

	it('a not-installed dot opens the Stack tab, and so does the body', async () => {
		const { result } = await ready();
		const stop = vi.fn();
		await act(async () => {
			await result.current.clickDot(dot(result, 'ghost'))({ stopPropagation: stop });
		});
		expect(stop).toHaveBeenCalled();
		expect(calls('stack_show_tab')).toHaveLength(1);
		await act(async () => {
			await result.current.openTab();
		});
		expect(calls('stack_show_tab')).toHaveLength(2);
		expect(calls('stack_start')).toHaveLength(0);
	});

	it('press and move past 3 px drags the window, and the click that ends it does nothing', async () => {
		const { result } = await ready();
		act(() => {
			result.current.onPointerDown(press(100, 100));
			result.current.onPointerMove(press(102, 101));
		});
		expect(startDragging).not.toHaveBeenCalled();
		act(() => {
			result.current.onPointerMove(press(105, 100));
		});
		expect(startDragging).toHaveBeenCalledTimes(1);
		await act(async () => {
			await result.current.openTab();
		});
		expect(calls('stack_show_tab')).toHaveLength(0);
		// the next plain click is a click again
		await act(async () => {
			result.current.onPointerDown(press(100, 100));
			result.current.onPointerUp();
			await result.current.openTab();
		});
		expect(calls('stack_show_tab')).toHaveLength(1);
	});

	it('hover grows the window for the card once, and leaving puts it back', async () => {
		const { result } = await ready();
		await act(async () => {
			await result.current.hover('voice');
			await result.current.hover('notes');
		});
		expect(result.current.hovered?.name).toBe('notes');
		expect(calls('stack_pill_hover')).toEqual([['stack_pill_hover', { open: true, extra: PILL_CARD_EXTRA }]]);
		// jsdom measures the bar as 0 wide, so the card's minimum is asked for
		expect(invoke).toHaveBeenCalledWith('stack_pill_fit', { width: CARD_MIN_WIDTH });
		await act(async () => {
			await result.current.hover(null);
		});
		expect(result.current.hovered).toBeNull();
		expect(calls('stack_pill_hover').slice(-1)[0]).toEqual(['stack_pill_hover', { open: false, extra: PILL_CARD_EXTRA }]);
	});

	it('near the bottom of the screen the card goes above', async () => {
		hoverSide = 'above';
		const { result } = await ready();
		await act(async () => {
			await result.current.hover('voice');
		});
		expect(result.current.side).toBe('above');
		await act(async () => {
			await result.current.hover(null);
		});
		expect(result.current.side).toBe('below');
	});

	it('the ✕ logs itself and closes the window', async () => {
		const { result } = await ready();
		await act(async () => {
			await result.current.close();
		});
		expect(close).toHaveBeenCalledTimes(1);
		expect(invoke).toHaveBeenCalledWith('log_ui_line', { line: 'stack: close pressed' });
	});
});
