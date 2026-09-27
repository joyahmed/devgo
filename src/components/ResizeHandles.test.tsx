import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResizeHandles from './ResizeHandles';

// ⛔ the platform mock below is NOT optional, and the reason is worth
// writing down because the opposite was believed when this was scoped:
// jsdom's user agent is
//
//     Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/30.1.1
//
// — measured in this suite, not guessed. it contains no "Windows NT", no
// "X11" and no "Linux", so platform.ts's three flags are ALL FALSE under
// vitest, on every host. a linux runner says `(win32)` → `(linux)` and it is
// still false, because /X11|Linux/ is case-sensitive. so ResizeHandles
// renders NOTHING here by default, and a test that just called render()
// would pass for the wrong reason forever. every assertion about the eight
// handles has to declare the platform first.
//
// ⛔ nothing here asserts a size, a position or an overlap. jsdom
// computes no layout: every box is 0x0 at 0,0, so a test that claimed the
// South strip sits at the bottom would be asserting on a class name while
// pretending to measure. what IS testable is the contract that matters —
// eight handles exist, each one starts exactly one resize, and each one
// names the right direction.

const startResizeDragging = vi.fn(() => Promise.resolve());

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({ startResizeDragging })
}));

// linux for the whole file except the last describe, which replaces this
// for its own two cases. the static import below is bound to this one
vi.mock('../platform', () => ({
	isLinux: true,
	isWindows: false,
	isMac: false
}));

// the component logs a refused resize, which is an invoke. nothing in this
// file makes it reject, but the module must not reach the real invoke if a
// future edit does
vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve() }));

afterEach(cleanup);
// ⚠️ braces, not a concise body: vitest treats a function RETURNED from a
// beforeEach as that test's teardown, and mockReset() returns the mock — so
// `beforeEach(() => m.mockReset())` registers the mock ITSELF as a cleanup
// hook and calls it with no arguments after every test
beforeEach(() => {
	startResizeDragging.mockClear();
});

const handles = () =>
	Array.from(document.querySelectorAll('[data-resize]')) as HTMLElement[];

const handle = (direction: string) => {
	const el = document.querySelector(`[data-resize="${direction}"]`);
	if (!el) throw new Error(`no ${direction} handle`);
	return el;
};

const EDGES = ['North', 'South', 'East', 'West'];
const CORNERS = ['NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'];

describe('ResizeHandles — what renders', () => {
	// eight, not four: an edge-only version cannot resize diagonally, and
	// four edges is the shape this would collapse to if the corner list were
	// ever dropped as redundant
	it('is four edges and four corners, and nothing else', () => {
		render(<ResizeHandles />);
		expect(handles()).toHaveLength(8);
	});

	it.each([...EDGES, ...CORNERS])('renders the %s handle', direction => {
		render(<ResizeHandles />);
		expect(handle(direction)).not.toBeNull();
	});

	// the directions are validated in rust, so a typo is a rejected promise
	// at runtime rather than a compile error. this is the cheap half of
	// catching that: no name outside the API's own union reaches a handle
	it('names only directions the api declares', () => {
		render(<ResizeHandles />);
		const named = handles().map(h => h.dataset.resize).sort();
		expect(named).toEqual([...EDGES, ...CORNERS].sort());
	});

	// ⛔ not decoration. a visible 4px band along an edge would be a visual
	// regression in some palette, and the cursor is the ONE appearance
	// change this file is allowed. so: a cursor on every handle, and no
	// background, border or outline on any of them
	it('carries a resize cursor and no paint of its own', () => {
		render(<ResizeHandles />);
		for (const h of handles()) {
			expect(h.className).toMatch(/cursor-(ew|ns|nesw|nwse)-resize/);
			expect(h.className).not.toMatch(/\bbg-|\bborder\b|\boutline\b/);
		}
	});

	// eight unlabelled boxes are eight tab stops on the way to the search
	// box if they are ever focusable, and eight nameless nodes in the
	// accessibility tree either way
	it('is hidden from the accessibility tree', () => {
		render(<ResizeHandles />);
		for (const h of handles()) {
			expect(h.getAttribute('aria-hidden')).toBe('true');
		}
	});
});

describe('ResizeHandles — a mousedown starts one resize, in the right direction', () => {
	it.each([
		['North', 'North'],
		['South', 'South'],
		['East', 'East'],
		['West', 'West'],
		['NorthEast', 'NorthEast'],
		['NorthWest', 'NorthWest'],
		['SouthEast', 'SouthEast'],
		['SouthWest', 'SouthWest']
	])('%s asks for %s, once', (target, direction) => {
		render(<ResizeHandles />);
		fireEvent.mouseDown(handle(target), { button: 0 });

		expect(startResizeDragging).toHaveBeenCalledTimes(1);
		expect(startResizeDragging).toHaveBeenCalledWith(direction);
	});

	// the corner half of the same rule, stated as its own test because it is
	// the one that a z-index or DOM-order edit can silently undo: every
	// corner pixel is also an edge pixel, so a corner that resolved to its
	// edge would make diagonal resizing impossible while all eight handles
	// still existed and all eight still "worked"
	it.each(CORNERS)('%s resolves to a corner and never to an edge', corner => {
		render(<ResizeHandles />);
		fireEvent.mouseDown(handle(corner), { button: 0 });

		expect(startResizeDragging).toHaveBeenCalledWith(corner);
		expect(startResizeDragging).not.toHaveBeenCalledWith('North');
		expect(startResizeDragging).not.toHaveBeenCalledWith('South');
		expect(startResizeDragging).not.toHaveBeenCalledWith('East');
		expect(startResizeDragging).not.toHaveBeenCalledWith('West');
	});

	// tao's own handler takes button 1 (left) only, and so does this one: a
	// right-click at the edge belongs to whatever context menu is above it,
	// and a middle click is a paste
	it.each([1, 2])('ignores button %i', button => {
		render(<ResizeHandles />);
		fireEvent.mouseDown(handle('East'), { button });

		expect(startResizeDragging).not.toHaveBeenCalled();
	});

	// two presses are two resizes. the handler is built per render by a
	// factory, so a memoisation edit that shared one closure across the
	// eight would show up here or nowhere
	it('starts a second resize on a second press', () => {
		render(<ResizeHandles />);
		fireEvent.mouseDown(handle('West'), { button: 0 });
		fireEvent.mouseDown(handle('South'), { button: 0 });

		expect(startResizeDragging).toHaveBeenCalledTimes(2);
		expect(startResizeDragging).toHaveBeenNthCalledWith(1, 'West');
		expect(startResizeDragging).toHaveBeenNthCalledWith(2, 'South');
	});
});

// ⛔ the scope rule, and the reason it is a rule: windows resizes an
// undecorated window through its own non-client hit testing and macOS keeps
// native decorations, so on both of them these eight boxes could only take
// clicks that already work. isLinux is read once per module instance, so the
// only way to reach the other branch is a fresh instance — resetModules plus
// doMock plus a dynamic import. the statically imported component the rest
// of the file uses was already evaluated against the linux mock and is not
// disturbed by any of this, so these two may run in any order.
// ⭐ the third case is the one the environment gives for free: NOTHING
// matched, which is what an unrecognised UA must mean — "not a mac" meant
// windows until the linux build shipped, and this component must not
// resurrect that default
describe('ResizeHandles — off every platform but linux', () => {
	afterEach(() => {
		vi.doUnmock('../platform');
		vi.resetModules();
	});

	it.each([
		['windows', { isLinux: false, isWindows: true, isMac: false }],
		['macOS', { isLinux: false, isWindows: false, isMac: true }],
		['a UA none of the three recognise', {
			isLinux: false,
			isWindows: false,
			isMac: false
		}]
	])('renders nothing at all on %s', async (_name, platform) => {
		vi.resetModules();
		vi.doMock('../platform', () => platform);
		const Fresh = (await import('./ResizeHandles')).default;

		const { container } = render(<Fresh />);

		expect(container.innerHTML).toBe('');
		expect(handles()).toHaveLength(0);
		expect(startResizeDragging).not.toHaveBeenCalled();
	});
});
