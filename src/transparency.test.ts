import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applyGroundAlpha,
	launchedTransparent,
	loadGroundAlpha,
	MAX_TRANSPARENCY,
	setTransparency
} from './transparency';

// three rust commands and one css variable. the commands are stubbed the way
// every other suite in this tree stubs them — one vi.fn behind
// '@tauri-apps/api/core' — because the real ones set a window flag on the os.
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

// ⭐ the alpha is asserted as an EXACT string throughout, and the strings are
// not always pretty. `1 - pct / 100` is plain float arithmetic and its result
// goes into the stylesheet through String(), so 59% really does write
// '0.41000000000000003' and 55% really does write '0.44999999999999996'. those
// are the values the browser parses today; rounding them in a test would be
// testing an intention instead of the file.
const alpha = () =>
	document.documentElement.style.getPropertyValue('--ground-alpha');

beforeEach(() => {
	invoke.mockReset();
	document.documentElement.style.removeProperty('--ground-alpha');
});
afterEach(() => {
	document.documentElement.style.removeProperty('--ground-alpha');
});

// what rust answered, by command name, so a test only names the answers it
// cares about. an unnamed command rejects rather than resolving undefined:
// undefined would silently become NaN alpha and pass for a while
const rustSays = (answers: Record<string, unknown>) => {
	invoke.mockImplementation((cmd: string) =>
		cmd in answers
			? Promise.resolve(answers[cmd])
			: Promise.reject(new Error(`no stub for ${cmd}`))
	);
};

describe('MAX_TRANSPARENCY', () => {
	// the end of the slider, not the authority: preferences.rs clamps too, and
	// setTransparency below trusts rust's number over the one it asked for
	it('ends the slider at 60 percent', () => {
		expect(MAX_TRANSPARENCY).toBe(60);
	});
});

describe('applyGroundAlpha', () => {
	it('writes a fully opaque ground at 0 percent', () => {
		applyGroundAlpha(0);
		expect(alpha()).toBe('1');
	});

	// the arithmetic IS the contract: percent is how much of the desktop shows
	// through, alpha is how much ground is left
	it.each([
		[5, '0.95'],
		[10, '0.9'],
		[15, '0.85'],
		[20, '0.8'],
		[25, '0.75'],
		[30, '0.7'],
		[40, '0.6'],
		[50, '0.5']
	])('writes alpha %s%% -> %s', (pct, expected) => {
		applyGroundAlpha(pct);
		expect(alpha()).toBe(expected);
	});

	// ⭐ the clamp boundary, exactly, and the two steps either side of it
	it('writes 0.4 at the 60 percent cap', () => {
		applyGroundAlpha(MAX_TRANSPARENCY);
		expect(alpha()).toBe('0.4');
	});

	it('writes 0.401 just inside the cap', () => {
		applyGroundAlpha(59.9);
		expect(alpha()).toBe('0.401');
	});

	it.each([60.1, 61, 80, 100, 1000])(
		'clamps %s percent down to the cap and still writes 0.4',
		pct => {
			applyGroundAlpha(pct);
			expect(alpha()).toBe('0.4');
		}
	);

	it.each([-0.1, -3, -100])(
		'clamps %s percent up to zero and writes a solid ground',
		pct => {
			applyGroundAlpha(pct);
			expect(alpha()).toBe('1');
		}
	);

	// the float artefacts, written down rather than rounded away. harmless to
	// css, but a test that expected '0.41' would fail and a reader deserves to
	// know why
	it('writes the raw float for percentages that do not divide cleanly', () => {
		applyGroundAlpha(59);
		expect(alpha()).toBe('0.41000000000000003');
		applyGroundAlpha(55);
		expect(alpha()).toBe('0.44999999999999996');
	});

	// ⚠️ today's behaviour, not an endorsement: neither clamp catches NaN
	// (Math.min(60, NaN) is NaN), so the variable is set to the literal string
	// 'NaN' and the ground loses its alpha until something valid is written.
	// no caller reaches this — rust answers numbers and the slider is a number
	// input — so it is documented here rather than guarded there
	it('writes the string NaN when handed a NaN percent', () => {
		applyGroundAlpha(Number.NaN);
		expect(alpha()).toBe('NaN');
	});

	it('is the last writer to win: a second call replaces the first', () => {
		applyGroundAlpha(30);
		expect(alpha()).toBe('0.7');
		applyGroundAlpha(0);
		expect(alpha()).toBe('1');
	});
});

describe('launchedTransparent', () => {
	it('asks rust the one question, with no payload', async () => {
		rustSays({ window_launched_transparent: true });
		await launchedTransparent();
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(invoke).toHaveBeenCalledWith('window_launched_transparent');
	});

	it.each([true, false])('passes rust\'s answer %s straight back', async born => {
		rustSays({ window_launched_transparent: born });
		await expect(launchedTransparent()).resolves.toBe(born);
	});

	// a window whose birth cannot be established is treated as opaque, which
	// is the safe end: opaque renders correctly, a wrong "transparent" renders
	// as a dark tint
	it('answers false when the command fails', async () => {
		invoke.mockRejectedValue(new Error('no such command'));
		await expect(launchedTransparent()).resolves.toBe(false);
	});
});

describe('loadGroundAlpha', () => {
	it('applies the stored percent on a window born see-through', async () => {
		rustSays({ get_window_transparency: 25, window_launched_transparent: true });
		await loadGroundAlpha();
		expect(alpha()).toBe('0.75');
	});

	// ⭐ the rule the whole `born` argument exists for. the stored knob can say
	// 40 and the window can still be opaque — transparent is a creation flag,
	// so it is only true of the window the user is looking at if it was set at
	// creation. alpha in the page then composites over the webview's own solid
	// background: a dark tint, not a see-through window. so it must be 1
	it('keeps the ground solid on a window born opaque, whatever the knob says', async () => {
		rustSays({
			get_window_transparency: 40,
			window_launched_transparent: false
		});
		await loadGroundAlpha();
		expect(alpha()).toBe('1');
	});

	it('treats a window whose birth cannot be read as born opaque', async () => {
		invoke.mockImplementation((cmd: string) =>
			cmd === 'get_window_transparency'
				? Promise.resolve(50)
				: Promise.reject(new Error('flag lost'))
		);
		await loadGroundAlpha();
		expect(alpha()).toBe('1');
	});

	it('clamps a stored percent above the cap', async () => {
		rustSays({ get_window_transparency: 90, window_launched_transparent: true });
		await loadGroundAlpha();
		expect(alpha()).toBe('0.4');
	});

	// mount-time code with nothing to report to: App.tsx calls this and then
	// shows the window in a .finally, so a rejection here would leave the
	// window hidden. it swallows instead, and leaves the variable alone rather
	// than writing a guessed one
	it('resolves and touches nothing when the stored percent cannot be read', async () => {
		document.documentElement.style.setProperty('--ground-alpha', '0.5');
		invoke.mockImplementation((cmd: string) =>
			cmd === 'window_launched_transparent'
				? Promise.resolve(true)
				: Promise.reject(new Error('prefs unreadable'))
		);
		await expect(loadGroundAlpha()).resolves.toBeUndefined();
		expect(alpha()).toBe('0.5');
	});

	it('asks both questions at once', async () => {
		rustSays({ get_window_transparency: 10, window_launched_transparent: true });
		await loadGroundAlpha();
		const asked = invoke.mock.calls.map(c => (c as unknown[])[0]);
		expect(asked).toHaveLength(2);
		expect(asked).toContain('get_window_transparency');
		expect(asked).toContain('window_launched_transparent');
	});
});

describe('setTransparency', () => {
	it('sends the percent rust is to store', async () => {
		invoke.mockResolvedValue(30);
		await setTransparency(30, true);
		expect(invoke).toHaveBeenCalledWith('set_window_transparency', {
			percent: 30
		});
	});

	it('previews the window it was born see-through', async () => {
		invoke.mockResolvedValue(20);
		await expect(setTransparency(20, true)).resolves.toBe(20);
		expect(alpha()).toBe('0.8');
	});

	// same rule as loadGroundAlpha, on the live slider: born opaque, the knob
	// is remembered for the next launch and the ground stays solid, so dragging
	// the slider changes nothing the user can see until they restart
	it('stores only, and keeps the ground solid, on a window born opaque', async () => {
		invoke.mockResolvedValue(45);
		await expect(setTransparency(45, false)).resolves.toBe(45);
		expect(alpha()).toBe('1');
	});

	// rust clamps, and the stepper shows what rust stored rather than what the
	// user asked for. the applied alpha comes from the STORED number too
	it('applies the number rust stored, not the one it was asked for', async () => {
		invoke.mockResolvedValue(45);
		await expect(setTransparency(90, true)).resolves.toBe(45);
		expect(alpha()).toBe('0.55');
	});

	// ⚠️ the one place the two clamps can disagree. the returned number is
	// rust's, unclamped by this file, while the css goes through
	// applyGroundAlpha's own clamp — so a rust that answered 80 would show
	// "80%" in Settings over a ground drawn at the 60% cap. today rust cannot
	// answer that; the asymmetry is written down in case it ever can
	it('returns rust\'s number untouched while the css stays capped', async () => {
		invoke.mockResolvedValue(80);
		await expect(setTransparency(80, true)).resolves.toBe(80);
		expect(alpha()).toBe('0.4');
	});

	// no catch of its own: the Settings panel owns the refusal, and a silent
	// success here would leave the slider showing a value nothing stored
	it('rejects when the command fails, leaving the ground untouched', async () => {
		document.documentElement.style.setProperty('--ground-alpha', '0.7');
		invoke.mockRejectedValue(new Error('window is gone'));
		await expect(setTransparency(10, true)).rejects.toThrow('window is gone');
		expect(alpha()).toBe('0.7');
	});
});
