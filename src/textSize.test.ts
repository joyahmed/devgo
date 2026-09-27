import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applyTextScale,
	savedTextScale,
	stepTextScale,
	TEXT_STEPS
} from './textSize';

// text size is the webview's own zoom, so the one thing that cannot run in a
// test is the only thing that leaves the page: getCurrentWebview().setZoom.
// it is stubbed the same shape every other suite here stubs a tauri module —
// one vi.fn behind a vi.mock of the exact import path — and nothing else is
// faked: localStorage is jsdom's real one, cleared on both sides of every
// test the way ClonePicker.test.tsx does, and the 'devgo:textscale' event is
// listened for on the real window.
const setZoom = vi.fn((_scale: number): Promise<void> => Promise.resolve());
vi.mock('@tauri-apps/api/webview', () => ({
	getCurrentWebview: () => ({ setZoom: (s: number) => setZoom(s) })
}));

// the module's own key. spelled out rather than imported because it is not
// exported, and because the string is the thing that has to stay stable across
// versions for a user's setting to survive an update
const KEY = 'devgo.textScale';

const scaleAnnounced = vi.fn();

beforeEach(() => {
	localStorage.clear();
	setZoom.mockReset();
	setZoom.mockResolvedValue(undefined);
	scaleAnnounced.mockClear();
	window.addEventListener('devgo:textscale', scaleAnnounced);
});
afterEach(() => {
	window.removeEventListener('devgo:textscale', scaleAnnounced);
	localStorage.clear();
});

describe('TEXT_STEPS', () => {
	// the ladder itself, exactly: a step added or moved changes what ctrl+=
	// does on every machine, and 1 has to be ON it or savedTextScale's
	// fallback would sit off the ladder and stepTextScale could not find it
	it('is the seven steps from 0.85 to 1.5, with 1 among them', () => {
		expect(TEXT_STEPS).toEqual([0.85, 0.9, 1, 1.1, 1.2, 1.35, 1.5]);
		expect(TEXT_STEPS.indexOf(1)).toBe(2);
	});

	it('ascends, so an index step up is a size up', () => {
		const sorted = [...TEXT_STEPS].sort((a, b) => a - b);
		expect([...TEXT_STEPS]).toEqual(sorted);
	});

	// two steps below 100% and four above: the ladder is built for growing
	it('leaves more room above 100% than below it', () => {
		const i = TEXT_STEPS.indexOf(1);
		expect(i).toBe(2);
		expect(TEXT_STEPS.length - 1 - i).toBe(4);
	});
});

describe('savedTextScale', () => {
	it.each([...TEXT_STEPS])('reads back the stored step %s', step => {
		localStorage.setItem(KEY, String(step));
		expect(savedTextScale()).toBe(step);
	});

	// a fresh machine: getItem is null, Number(null) is 0, 0 is not a step
	it('falls back to 1 with nothing stored', () => {
		expect(savedTextScale()).toBe(1);
	});

	// ⭐ the validation is membership of the table, not a range. a value that
	// is a perfectly reasonable zoom but is not ON the ladder is thrown away
	// rather than honoured, because stepTextScale could not step from it
	it.each(['1.05', '2', '0', '0.5', '-1', '1.25'])(
		'falls back to 1 on %s, a number that is off the table',
		stored => {
			localStorage.setItem(KEY, stored);
			expect(savedTextScale()).toBe(1);
		}
	);

	it.each(['abc', '', ' ', 'NaN', '1.1x', 'null'])(
		'falls back to 1 on %s, which is not a number at all',
		stored => {
			localStorage.setItem(KEY, stored);
			expect(savedTextScale()).toBe(1);
		}
	);

	// Number() does the comparing, so the spelling of the stored string does
	// not have to match what applyTextScale wrote — only its value
	it('compares the number and not the string it was written as', () => {
		localStorage.setItem(KEY, '1.10');
		expect(savedTextScale()).toBe(1.1);
		localStorage.setItem(KEY, ' 1.1 ');
		expect(savedTextScale()).toBe(1.1);
		localStorage.setItem(KEY, '1.1e0');
		expect(savedTextScale()).toBe(1.1);
	});

	// ⭐ a webview with site data blocked THROWS on access rather than
	// answering null, which is why App.tsx and useGithub.ts wrap every
	// localStorage read in try/catch. this one does too, so an unreadable
	// setting is worth exactly what an unset one is — and the throw no longer
	// travels out of savedTextScale, or out of stepTextScale with it
	it('falls back to 1 when localStorage itself throws, like the guarded readers elsewhere', () => {
		const spy = vi
			.spyOn(Storage.prototype, 'getItem')
			.mockImplementation(() => {
				throw new Error('site data blocked');
			});
		// restored in a finally: a failure here would otherwise leave getItem
		// throwing for every test after it in the file
		try {
			expect(savedTextScale()).toBe(1);
		} finally {
			spy.mockRestore();
		}
	});
});

describe('applyTextScale', () => {
	it('persists the number, zooms the webview and announces it', async () => {
		await expect(applyTextScale(1.2)).resolves.toBe(1.2);
		expect(localStorage.getItem(KEY)).toBe('1.2');
		expect(setZoom).toHaveBeenCalledTimes(1);
		expect(setZoom).toHaveBeenCalledWith(1.2);
		// the settings panel shows the number, so a shortcut has to move it
		expect(scaleAnnounced).toHaveBeenCalledTimes(1);
	});

	it('announces after the webview has zoomed, not before', async () => {
		const order: string[] = [];
		setZoom.mockImplementation(() => {
			order.push('zoom');
			return Promise.resolve();
		});
		window.addEventListener('devgo:textscale', () => order.push('announce'), {
			once: true
		});
		await applyTextScale(0.9);
		expect(order).toEqual(['zoom', 'announce']);
	});

	// ⚠️ it validates nothing. the callers all hand it a step, but a number off
	// the ladder is stored and zoomed happily — and is then unreadable, because
	// savedTextScale throws it away on the next launch. a setting that applies
	// once and then silently reverts to 100%
	it('takes a number off the table, applies it, and cannot read it back', async () => {
		await expect(applyTextScale(3)).resolves.toBe(3);
		expect(setZoom).toHaveBeenCalledWith(3);
		expect(localStorage.getItem(KEY)).toBe('3');
		expect(savedTextScale()).toBe(1);
	});

	// the write happens BEFORE the await, so a webview that refuses leaves the
	// number stored and the panel never told: the next launch zooms to a size
	// this run never showed
	it('has already persisted when the webview refuses, and announces nothing', async () => {
		setZoom.mockRejectedValueOnce(new Error('webview is gone'));
		await expect(applyTextScale(1.35)).rejects.toThrow('webview is gone');
		expect(localStorage.getItem(KEY)).toBe('1.35');
		expect(scaleAnnounced).not.toHaveBeenCalled();
	});

	// ⭐ the same blocked webview that throws on read throws on write, and the
	// write is guarded the way every setItem in the app is: the size still
	// zooms and the panel is still told, it simply will not survive a restart
	it('still zooms and announces when localStorage refuses the write', async () => {
		const spy = vi
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(() => {
				throw new Error('site data blocked');
			});
		try {
			await expect(applyTextScale(1.2)).resolves.toBe(1.2);
		} finally {
			spy.mockRestore();
		}
		expect(setZoom).toHaveBeenCalledWith(1.2);
		expect(scaleAnnounced).toHaveBeenCalledTimes(1);
		// nothing was persisted, so the next launch is back at 100%
		expect(localStorage.getItem(KEY)).toBeNull();
		expect(savedTextScale()).toBe(1);
	});
});

describe('stepTextScale', () => {
	it('steps up one rung from the saved scale', async () => {
		localStorage.setItem(KEY, '1');
		await expect(stepTextScale(1)).resolves.toBe(1.1);
		expect(setZoom).toHaveBeenCalledWith(1.1);
		expect(localStorage.getItem(KEY)).toBe('1.1');
	});

	it('steps down one rung from the saved scale', async () => {
		localStorage.setItem(KEY, '1');
		await expect(stepTextScale(-1)).resolves.toBe(0.9);
		expect(localStorage.getItem(KEY)).toBe('0.9');
	});

	// the whole ladder walked in both directions, which is what a user holding
	// ctrl+= actually does
	it('climbs every rung to the top and back down', async () => {
		localStorage.setItem(KEY, String(TEXT_STEPS[0]));
		for (let i = 1; i < TEXT_STEPS.length; i++) {
			await expect(stepTextScale(1)).resolves.toBe(TEXT_STEPS[i]);
		}
		for (let i = TEXT_STEPS.length - 2; i >= 0; i--) {
			await expect(stepTextScale(-1)).resolves.toBe(TEXT_STEPS[i]);
		}
	});

	// ⭐ the clamp at both ends is a no-op step, NOT a refusal: it still writes,
	// still zooms and still announces at the same value. so the settings panel
	// gets an event on a keypress that changed nothing, which is harmless, and
	// the value never walks off the table
	it('holds at the top rung and still reapplies it', async () => {
		localStorage.setItem(KEY, '1.5');
		await expect(stepTextScale(1)).resolves.toBe(1.5);
		expect(setZoom).toHaveBeenCalledWith(1.5);
		expect(scaleAnnounced).toHaveBeenCalledTimes(1);
	});

	it('holds at the bottom rung and still reapplies it', async () => {
		localStorage.setItem(KEY, '0.85');
		await expect(stepTextScale(-1)).resolves.toBe(0.85);
		expect(setZoom).toHaveBeenCalledWith(0.85);
		expect(scaleAnnounced).toHaveBeenCalledTimes(1);
	});

	// a stored value off the table is read as 1, so the first keypress after a
	// hand-edited or older localStorage lands next to 100% rather than nowhere
	it('steps from 100% when the stored value is unrecognised', async () => {
		localStorage.setItem(KEY, '2');
		await expect(stepTextScale(1)).resolves.toBe(1.1);
		localStorage.setItem(KEY, 'abc');
		await expect(stepTextScale(-1)).resolves.toBe(0.9);
	});

	it('steps from 100% on a machine that has never set a size', async () => {
		await expect(stepTextScale(1)).resolves.toBe(1.1);
	});

	// ⭐ the whole reason both sides are guarded: on a webview with site data
	// blocked every access throws, and ctrl+= used to throw with it. now the
	// shortcut still works — it just starts from 100% every session
	it('still works with storage throwing on both read and write', async () => {
		const read = vi
			.spyOn(Storage.prototype, 'getItem')
			.mockImplementation(() => {
				throw new Error('site data blocked');
			});
		const write = vi
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(() => {
				throw new Error('site data blocked');
			});
		try {
			await expect(stepTextScale(1)).resolves.toBe(1.1);
			await expect(stepTextScale(-1)).resolves.toBe(0.9);
		} finally {
			read.mockRestore();
			write.mockRestore();
		}
		expect(setZoom).toHaveBeenNthCalledWith(1, 1.1);
		expect(setZoom).toHaveBeenNthCalledWith(2, 0.9);
		expect(scaleAnnounced).toHaveBeenCalledTimes(2);
	});
});
