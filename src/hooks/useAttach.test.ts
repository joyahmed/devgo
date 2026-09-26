import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAttach } from './useAttach';

// the same seam every other hook test here uses, plus the Channel the pty's
// bytes ride. a real Channel serialises into the ipc; this one just holds the
// onmessage the hook assigns, which is how a test feeds the pane bytes. it is
// hoisted because the core factory reads Channel the moment the hook is
// imported — before a plain top-level class has been initialised
const { FakeChannel } = vi.hoisted(() => ({
	FakeChannel: class {
		onmessage: ((buf: ArrayBuffer) => void) | null = null;
	}
}));
const invoke = vi.fn();
const order: string[] = [];
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => {
		order.push(String(a[0]));
		return invoke(...(a as []));
	},
	Channel: FakeChannel
}));

let fireExit: ((p: PtyExit) => void) | null = null;
const unlisten = vi.fn();
let listened: string | null = null;
vi.mock('@tauri-apps/api/event', () => ({
	listen: (name: string, handler: (e: { payload: PtyExit }) => void) => {
		listened = name;
		order.push(`listen:${name}`);
		fireExit = p => handler({ payload: p });
		return Promise.resolve(unlisten);
	}
}));

// xterm rides its own chunk and is imported dynamically, so the stub stands
// in for the chunk. it records what the pane did to the terminal — jsdom has
// no canvas and the real Terminal would not render anyway
type Handler = (e: KeyboardEvent) => boolean;
class FakeTerminal {
	static made: FakeTerminal[] = [];
	cols = 120;
	rows = 30;
	opts: Record<string, unknown>;
	opened: HTMLElement | null = null;
	focused = 0;
	disposed = 0;
	writes: (string | Uint8Array)[] = [];
	keyHandler: Handler | null = null;
	addons: unknown[] = [];
	onDataCb: ((d: string) => void) | null = null;
	onResizeCb: ((s: { cols: number; rows: number }) => void) | null = null;
	dataDisposed = 0;
	resizeDisposed = 0;
	constructor(opts: Record<string, unknown>) {
		this.opts = opts;
		FakeTerminal.made.push(this);
	}
	loadAddon(a: unknown) {
		this.addons.push(a);
	}
	open(el: HTMLElement) {
		this.opened = el;
	}
	focus() {
		this.focused += 1;
	}
	attachCustomKeyEventHandler(h: Handler) {
		this.keyHandler = h;
	}
	onData(cb: (d: string) => void) {
		this.onDataCb = cb;
		return { dispose: () => (this.dataDisposed += 1) };
	}
	onResize(cb: (s: { cols: number; rows: number }) => void) {
		this.onResizeCb = cb;
		return { dispose: () => (this.resizeDisposed += 1) };
	}
	write(d: string | Uint8Array) {
		this.writes.push(d);
	}
	dispose() {
		this.disposed += 1;
	}
}
// a getter, not a plain key: the chunk is imported once and cached, so a test
// that wants the load to fail has to fail at the moment the hook reaches for
// Terminal rather than at the moment the module was first pulled in
let importFails: Error | null = null;
vi.mock('@xterm/xterm', () => ({
	get Terminal() {
		if (importFails) throw importFails;
		return FakeTerminal;
	}
}));
class FakeFit {
	fits = 0;
	fit() {
		this.fits += 1;
	}
}
let lastFit: FakeFit | null = null;
vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		constructor() {
			lastFit = this as unknown as FakeFit;
			(this as unknown as FakeFit).fits = 0;
		}
		fit() {
			(this as unknown as FakeFit).fits += 1;
		}
	}
}));

// jsdom ships no ResizeObserver, and the effect constructs one unconditionally
let observed: Element[] = [];
const disconnect = vi.fn();
class FakeRO {
	static cb: (() => void) | null = null;
	constructor(cb: () => void) {
		FakeRO.cb = cb;
	}
	observe(el: Element) {
		observed.push(el);
	}
	disconnect() {
		disconnect();
	}
}

const PROJECT: AttachTarget = {
	kind: 'project',
	project: {
		name: 'devgo',
		full_path: 'C:/dev/devgo',
		workspace: 'C:/dev',
		file_system: 'windows'
	}
};
const SERVER: AttachTarget = { kind: 'server', id: 'srv-1' };

const OPENED: AttachOpened = {
	id: 'pty-1',
	line: 'wsl.exe -d Ubuntu -- psmux attach devgo',
	session: 'devgo',
	place: 'Ubuntu'
};

const onError = vi.fn();
const term = () => FakeTerminal.made[FakeTerminal.made.length - 1]!;
const argsOf = (cmd: string) =>
	invoke.mock.calls.find(c => c[0] === cmd)?.[1] as Record<string, unknown>;
const called = (cmd: string) => invoke.mock.calls.filter(c => c[0] === cmd).length;

// the effect is four promise layers deep — the xterm chunk, then listen, then
// pty_open — so only a turn of the event loop is guaranteed to have drained it
const settle = () =>
	act(async () => {
		await new Promise(r => setTimeout(r, 0));
	});

// renderHook renders no markup, so the pane body the terminal mounts into is
// handed to the ref directly. the effect reads host.current and bails without
// it, which is the real "the pane has not laid out yet" case
const mounted = () => {
	const h = renderHook(() => useAttach(onError));
	h.result.current.host.current = document.createElement('div');
	return h;
};

const attached = async (target: AttachTarget = PROJECT, title = 'devgo') => {
	const h = mounted();
	act(() => h.result.current.open(target, title));
	await settle();
	return h;
};

beforeEach(() => {
	invoke.mockReset();
	invoke.mockResolvedValue(OPENED);
	onError.mockReset();
	unlisten.mockReset();
	disconnect.mockReset();
	FakeTerminal.made = [];
	observed = [];
	order.length = 0;
	listened = null;
	fireExit = null;
	importFails = null;
	lastFit = null;
	globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
});
afterEach(() => vi.restoreAllMocks());

describe('useAttach — opening and replacing the pane', () => {
	// the pane renders from the first frame, before rust knows anything: every
	// field rust fills is null and the status says so
	it('shows an opening pane with nothing filled in yet', () => {
		const h = mounted();

		act(() => h.result.current.open(SERVER, 'box'));

		expect(h.result.current.pane).toEqual({
			seq: 1,
			target: SERVER,
			title: 'box',
			id: null,
			session: null,
			place: null,
			line: null,
			status: 'opening',
			code: null
		});
	});

	// ⛔ seq is what makes the effect re-run, and re-opening the SAME target is
	// the common case (the row is still selected). a seq that did not bump
	// would leave the old pty attached to a pane the user thinks is new
	it('bumps the seq on every open, same target or not', async () => {
		const h = await attached();
		expect(h.result.current.pane?.seq).toBe(1);

		act(() => h.result.current.open(PROJECT, 'devgo'));

		expect(h.result.current.pane?.seq).toBe(2);
	});

	// "one pane at a time: opening another replaces it, which detaches"
	it('closes the old pty when a second pane replaces the first', async () => {
		const h = await attached();
		expect(argsOf('pty_open')).toBeTruthy();

		act(() => h.result.current.open(SERVER, 'box'));
		await settle();

		expect(argsOf('pty_close')).toEqual({ id: 'pty-1' });
		expect(h.result.current.pane?.target).toEqual(SERVER);
	});

	it('detach drops the pane and closes the pty', async () => {
		const h = await attached();

		act(() => h.result.current.detach());
		await settle();

		expect(h.result.current.pane).toBeNull();
		expect(argsOf('pty_close')).toEqual({ id: 'pty-1' });
	});

	// the launcher that never attaches must not pay for the xterm chunk, and
	// the pane body does not exist until a pane does
	it('loads no terminal and opens no pty until a pane is opened', async () => {
		mounted();
		await settle();

		expect(FakeTerminal.made).toHaveLength(0);
		expect(invoke).not.toHaveBeenCalled();
	});

	// the ref is filled by the pane's own render, so a seq change with no body
	// yet must not spawn a pty that nothing is showing
	it('opens no pty while the pane body has not mounted', async () => {
		const h = renderHook(() => useAttach(onError));

		act(() => h.result.current.open(PROJECT, 'devgo'));
		await settle();

		expect(called('pty_open')).toBe(0);
		expect(h.result.current.pane?.status).toBe('opening');
	});
});

describe('useAttach — what crosses to rust', () => {
	// ⛔ the wire contract. `onData` is the channel rust writes the pty's bytes
	// into, and cols/rows are the size the pty is born at — a pty opened at
	// 80x24 against a 120x30 pane wraps every line until the first resize
	it('opens the pty with the target, the measured size and the channel', async () => {
		await attached();

		const args = argsOf('pty_open');
		expect(args.target).toEqual(PROJECT);
		expect(args.cols).toBe(120);
		expect(args.rows).toBe(30);
		expect(args.onData).toBeInstanceOf(FakeChannel);
	});

	it('passes a server target through as the id-only shape', async () => {
		await attached(SERVER, 'box');

		expect(argsOf('pty_open').target).toEqual({ kind: 'server', id: 'srv-1' });
	});

	// ⛔ "the listener first, then the spawn: a client that dies at once must
	// not end before anyone is listening". a pty_open that raced ahead of the
	// subscription loses the exit of anything that fails instantly — a stopped
	// distro, a missing psmux — and the pane hangs on "opening" forever
	it('subscribes to the exit event before it spawns the pty', async () => {
		await attached();

		expect(listened).toBe('devgo://pty-exit');
		expect(order.indexOf('listen:devgo://pty-exit')).toBeLessThan(
			order.indexOf('pty_open')
		);
	});

	it('fills the pane from what pty_open answered', async () => {
		const h = await attached();

		expect(h.result.current.pane).toMatchObject({
			id: 'pty-1',
			line: OPENED.line,
			session: 'devgo',
			place: 'Ubuntu',
			status: 'attached',
			code: null
		});
	});

	// keystrokes are the pty's, and they are addressed by the id rust minted
	it('sends typed bytes to the pty by id', async () => {
		const h = await attached();

		act(() => term().onDataCb?.('ls\r'));

		expect(argsOf('pty_write')).toEqual({ id: 'pty-1', data: 'ls\r' });
		expect(h.result.current.pane?.status).toBe('attached');
	});

	// ⛔ `if (id)` — before pty_open answers there is nothing to write to, and
	// a pty_write with a null id is a rust error the user would see as a toast
	it('swallows keystrokes typed before the pty exists', async () => {
		const h = mounted();
		let answer: ((o: AttachOpened) => void) | null = null;
		invoke.mockImplementation((cmd: string) =>
			cmd === 'pty_open'
				? new Promise<AttachOpened>(r => (answer = r))
				: Promise.resolve(null)
		);
		act(() => h.result.current.open(PROJECT, 'devgo'));
		await settle();

		act(() => term().onDataCb?.('early'));

		expect(called('pty_write')).toBe(0);
		// and once it is attached the same keystroke lands
		await act(async () => {
			answer?.(OPENED);
			await Promise.resolve();
		});
		act(() => term().onDataCb?.('late'));
		expect(argsOf('pty_write')).toEqual({ id: 'pty-1', data: 'late' });
	});

	it('forwards a resize to the pty as cols and rows', async () => {
		await attached();

		act(() => term().onResizeCb?.({ cols: 100, rows: 40 }));

		expect(argsOf('pty_resize')).toEqual({ id: 'pty-1', cols: 100, rows: 40 });
	});

	// a pty_write that fails is not worth a dialog: the exit event is coming
	it('ignores a failed write rather than throwing out of the key handler', async () => {
		await attached();
		invoke.mockRejectedValue(new Error('pty gone'));

		act(() => term().onDataCb?.('x'));
		await settle();

		expect(onError).not.toHaveBeenCalled();
	});

	// the pty's bytes are bytes: the channel hands an ArrayBuffer and the pane
	// wraps it, so a pane that expected a string would render [object ...]
	it('writes the channel’s bytes into the terminal as a Uint8Array', async () => {
		await attached();
		const channel = argsOf('pty_open').onData as InstanceType<typeof FakeChannel>;

		act(() => channel.onmessage?.(new Uint8Array([104, 105]).buffer));

		const last = term().writes[term().writes.length - 1];
		expect(last).toBeInstanceOf(Uint8Array);
		expect(Array.from(last as Uint8Array)).toEqual([104, 105]);
	});
});

describe('useAttach — the client ending', () => {
	// "the exit event is the other way out, and the pane stays on screen
	// saying so": the session outlives the client, so dropping the pane here
	// would hide the exit code the user needs
	it('keeps the pane and records the exit code', async () => {
		const h = await attached();

		await act(async () => fireExit?.({ id: 'pty-1', code: 130 }));

		expect(h.result.current.pane).toMatchObject({ status: 'ended', code: 130 });
		expect(h.result.current.pane).not.toBeNull();
	});

	// ⛔ one pty-exit event stream for every pane the app ever opened: an exit
	// for someone else's id must not end this pane
	it('ignores an exit for another pty', async () => {
		const h = await attached();

		await act(async () => fireExit?.({ id: 'pty-other', code: 1 }));

		expect(h.result.current.pane?.status).toBe('attached');
		expect(h.result.current.pane?.code).toBeNull();
	});

	// ⛔ the `exits` map. a client that dies before pty_open has answered (a
	// stopped distro is the common one) fires its exit against an id this side
	// does not know yet. without the map the pane sits on "opening" forever
	it('applies an exit that landed before pty_open answered', async () => {
		const h = mounted();
		let answer: ((o: AttachOpened) => void) | null = null;
		invoke.mockImplementation((cmd: string) =>
			cmd === 'pty_open'
				? new Promise<AttachOpened>(r => (answer = r))
				: Promise.resolve(null)
		);
		act(() => h.result.current.open(PROJECT, 'devgo'));
		await settle();

		await act(async () => fireExit?.({ id: 'pty-1', code: 127 }));
		expect(h.result.current.pane?.status).toBe('opening');

		await act(async () => {
			answer?.(OPENED);
			await Promise.resolve();
		});

		expect(h.result.current.pane).toMatchObject({ status: 'ended', code: 127 });
	});

	// ⛔ the whole reason the notice waits 150ms and leads with \x1b[?1049l: a
	// multiplexer's last word is to leave the alternate screen, and a notice
	// written into that screen is wiped by it
	it('leaves the alternate screen before printing the detached notice', async () => {
		const h = await attached();
		await act(async () => fireExit?.({ id: 'pty-1', code: 0 }));
		expect(term().writes).toHaveLength(0);

		await act(async () => {
			await new Promise(r => setTimeout(r, 200));
		});

		expect(term().writes).toEqual([
			'\x1b[?1049l\r\n\x1b[2m[detached · exit 0]\x1b[0m'
		]);
		expect(h.result.current.pane?.status).toBe('ended');
	});

	// a detach inside that 150ms window disposes the terminal; writing to a
	// disposed terminal is what the `if (!gone)` guard is for
	it('does not write the notice into a pane that was detached meanwhile', async () => {
		const h = await attached();
		await act(async () => fireExit?.({ id: 'pty-1', code: 0 }));

		act(() => h.result.current.detach());
		await act(async () => {
			await new Promise(r => setTimeout(r, 200));
		});

		expect(term().writes).toHaveLength(0);
	});

	// the client is gone, so its id is gone: a close for a dead pty would be a
	// rust error, and a write would go nowhere
	it('closes no pty and writes nothing once the client has exited', async () => {
		const h = await attached();
		await act(async () => fireExit?.({ id: 'pty-1', code: 0 }));

		act(() => h.result.current.detach());
		await settle();

		expect(called('pty_close')).toBe(0);
	});
});

describe('useAttach — when it cannot attach at all', () => {
	// ⛔ the pane must NOT be left saying "opening" against nothing. the error
	// goes to the caller's toast and the pane goes away
	it('drops the pane and reports a refused pty_open', async () => {
		invoke.mockRejectedValue(new Error('Ubuntu is not running'));
		const h = await attached();

		expect(h.result.current.pane).toBeNull();
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
		expect(String(onError.mock.calls[0][0])).toContain('Ubuntu is not running');
	});

	// the chunk is fetched at attach time, so a bad build or an offline asset
	// fails here rather than at startup — same ending as a refused pty
	it('drops the pane and reports a terminal chunk that will not load', async () => {
		importFails = new Error('chunk load failed');
		const h = mounted();

		act(() => h.result.current.open(PROJECT, 'devgo'));
		await settle();

		expect(h.result.current.pane).toBeNull();
		expect(onError).toHaveBeenCalledTimes(1);
		expect(called('pty_open')).toBe(0);
	});

	// ⛔ the leak this guard closes: detach lands while pty_open is in flight,
	// so nothing will ever call cleanup for that id. rust would keep the pty
	// and the multiplexer window alive with no pane pointing at it
	it('closes a pty that finished opening after the pane was dropped', async () => {
		const h = mounted();
		let answer: ((o: AttachOpened) => void) | null = null;
		invoke.mockImplementation((cmd: string) =>
			cmd === 'pty_open'
				? new Promise<AttachOpened>(r => (answer = r))
				: Promise.resolve(null)
		);
		act(() => h.result.current.open(PROJECT, 'devgo'));
		await settle();

		act(() => h.result.current.detach());
		await act(async () => {
			answer?.(OPENED);
			await Promise.resolve();
		});

		expect(argsOf('pty_close')).toEqual({ id: 'pty-1' });
		expect(h.result.current.pane).toBeNull();
	});
});

describe('useAttach — cleanup', () => {
	// every subscription the effect made: the event, the observer, both xterm
	// listeners and the terminal itself. a pane replaced twenty times is
	// twenty terminals if any of these is missed
	it('unwinds everything it subscribed on unmount', async () => {
		const h = await attached();

		h.unmount();
		await settle();

		expect(unlisten).toHaveBeenCalledTimes(1);
		expect(disconnect).toHaveBeenCalledTimes(1);
		expect(term().dataDisposed).toBe(1);
		expect(term().resizeDisposed).toBe(1);
		expect(term().disposed).toBe(1);
		expect(argsOf('pty_close')).toEqual({ id: 'pty-1' });
	});

	it('observes the pane body so the pty follows the pane’s size', async () => {
		const h = await attached();

		expect(observed).toEqual([h.result.current.host.current]);
		act(() => FakeRO.cb?.());
		expect(lastFit!.fits).toBeGreaterThan(1);
	});

	it('mounts the terminal into the pane body and focuses it', async () => {
		const h = await attached();

		expect(term().opened).toBe(h.result.current.host.current);
		expect(term().focused).toBe(1);
	});
});

// ⛔ "the palette and the attach key stay the app's; the rest is the shell's,
// escape included". a handler that swallowed too much would break vim inside
// the pane; one that swallowed too little would make Ctrl+Shift+A type an
// escape sequence instead of detaching
describe('useAttach — which keys the pane keeps', () => {
	const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

	it('gives the attach key and the palette back to the app', async () => {
		await attached();
		const handler = term().keyHandler!;

		expect(handler(key({ key: 'A', ctrlKey: true, shiftKey: true }))).toBe(false);
		expect(handler(key({ key: 'P', ctrlKey: true, shiftKey: true }))).toBe(false);
	});

	it.each([
		['Escape', {}],
		['c', { ctrlKey: true }],
		['l', { ctrlKey: true }],
		['r', { ctrlKey: true }],
		['a', { ctrlKey: true }],
		['k', { ctrlKey: true }]
	])('hands %s to the shell', async (k, mods) => {
		await attached();
		const handler = term().keyHandler!;

		expect(handler(key({ key: k, ...mods }))).toBe(true);
	});
});
