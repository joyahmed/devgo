import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, savedThemeId, setTheme, THEMES } from './themes';

// themes.ts is 117 lines of palette and 20 lines of logic. the palette is
// asserted as INVARIANTS only — every colour pinned here would make the table
// unchangeable, and scripts/check-contrast.mjs (run by `bun run build`) is
// already the authority on whether a palette is legible. the logic — the two
// fallbacks, the --solid-/--color- split, the write order — is pinned exactly.

const THEME_KEY = 'devgo.theme';

// the fifteen names in ThemeKey (src/types.d.ts:522), mirrored here so a key
// added to the type without a value in a palette, or a palette carrying a key
// the loop never writes, both fail
const KEYS = [
	'bg-primary',
	'bg-secondary',
	'bg-panel',
	'bg-hover',
	'bg-selected',
	'bg-raised',
	'text-primary',
	'text-secondary',
	'text-muted',
	'accent',
	'accent-hover',
	'danger',
	'border',
	'border-strong',
	'glow'
];

const root = () => document.documentElement;
const cssVar = (name: string) => root().style.getPropertyValue(name);

// every inline custom property currently on :root, by name. jsdom's
// CSSStyleDeclaration is real here, so this reads back what the module wrote
// rather than what a spy saw it ask for
const vars = (): Record<string, string> => {
	const out: Record<string, string> = {};
	const style = root().style;
	for (let i = 0; i < style.length; i += 1) {
		const name = style.item(i);
		out[name] = style.getPropertyValue(name);
	}
	return out;
};

// both sides: before, so a stray theme cannot decide what a test reads back,
// and after, so nothing leaves the file. removeAttribute takes the whole style
// attribute, which is what applyTheme writes into
beforeEach(() => {
	localStorage.clear();
	root().removeAttribute('style');
});
afterEach(() => {
	localStorage.clear();
	root().removeAttribute('style');
});

describe('THEMES', () => {
	// applyTheme's `?? THEMES[0]` has no answer for an empty table: it would
	// hand `undefined.colors` to the loop and every unknown id would crash
	it('is not empty, because the fallback theme is THEMES[0]', () => {
		expect(THEMES.length).toBeGreaterThan(0);
	});

	it('ships five themes today', () => {
		expect(THEMES.map(t => t.id)).toEqual([
			'neon',
			'matrix',
			'nord',
			'dracula',
			'black'
		]);
	});

	// the id is the localStorage value AND the React key in Settings' swatch
	// grid, so a duplicate would make one theme unselectable
	it('gives every theme a unique id', () => {
		const ids = THEMES.map(t => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('gives every theme an id that is a safe storage token', () => {
		for (const t of THEMES) expect(t.id).toMatch(/^[a-z][a-z0-9-]*$/);
	});

	it('gives every theme a non-empty display name', () => {
		for (const t of THEMES) expect(t.name.length).toBeGreaterThan(0);
	});

	// ⭐ the table invariant applyTheme depends on: the loop reads
	// theme.colors[key] for all fifteen keys with no guard, so a missing one
	// would write the literal string "undefined" into the stylesheet
	it('gives every theme exactly the fifteen keys the loop writes', () => {
		for (const t of THEMES) {
			expect(Object.keys(t.colors).sort(), `theme ${t.id}`).toEqual(
				KEYS.slice().sort()
			);
		}
	});

	it('gives every key a non-empty value in every theme', () => {
		for (const t of THEMES)
			for (const key of KEYS)
				expect(
					(t.colors as Record<string, string>)[key].length,
					`${t.id}.${key}`
				).toBeGreaterThan(0);
	});

	// scripts/check-contrast.mjs parses hex and nothing else (themes.ts:32),
	// so a colour written as rgb() or as a named colour would silently skip
	// the gate. that is the invariant — not which hex
	it('writes every colour but glow as a six-digit lowercase hex', () => {
		for (const t of THEMES)
			for (const key of KEYS) {
				if (key === 'glow') continue;
				expect(
					(t.colors as Record<string, string>)[key],
					`${t.id}.${key}`
				).toMatch(/^#[0-9a-f]{6}$/);
			}
	});

	// glow is a box-shadow, not a colour: 'none' everywhere but neon
	it('sets glow to a box-shadow or the string none', () => {
		for (const t of THEMES)
			expect(
				t.colors.glow === 'none' || /^\d/.test(t.colors.glow),
				`${t.id}.glow`
			).toBe(true);
		expect(
			THEMES.filter(t => t.colors.glow !== 'none').map(t => t.id)
		).toEqual(['neon']);
	});

	// the --solid-/--color- split in applyTheme is `startsWith('bg-')`, with
	// the hyphen. today no key is bg-prefixed WITHOUT the hyphen, so the two
	// readings of the rule cannot be told apart from outside the module — this
	// pins the precondition, so a future 'bgFoo' (which WOULD land on
	// --color-bgFoo, not --solid-bgFoo) shows up here first
	it('has no key that starts with bg but not with bg-', () => {
		for (const key of KEYS)
			if (key.indexOf('bg') === 0) expect(key.indexOf('bg-')).toBe(0);
	});

	it('names six surfaces and nine non-surfaces', () => {
		const surfaces = KEYS.filter(k => k.indexOf('bg-') === 0);
		expect(surfaces).toEqual([
			'bg-primary',
			'bg-secondary',
			'bg-panel',
			'bg-hover',
			'bg-selected',
			'bg-raised'
		]);
		expect(KEYS.length - surfaces.length).toBe(9);
	});
});

// ⭐ the highest-value assertions in this file. themes.ts reaches the default
// down two paths — savedThemeId falls back to the private `DEFAULT`
// (themes.ts:158) and applyTheme falls back to `THEMES[0]` (themes.ts:163) —
// and main.tsx:12 composes them as `applyTheme(savedThemeId())`. They agree by
// derivation now, not by coincidence: `DEFAULT = THEMES[0].id`. What these
// tests guard is that the derivation stays, and that a reorder of the table
// still moves both halves together.
describe('the default theme, which the module reaches two ways', () => {
	it('is neon when nothing has been stored', () => {
		expect(savedThemeId()).toBe('neon');
	});

	it('is the same theme both fallbacks choose, because DEFAULT derives from THEMES[0]', () => {
		expect(
			THEMES[0].id,
			'BROKEN DERIVATION: themes.ts:158 is meant to read ' +
				'`const DEFAULT = THEMES[0].id`, so savedThemeId()\'s fallback and ' +
				"applyTheme()'s `?? THEMES[0]` fallback (themes.ts:163) cannot " +
				'disagree. This failed because the derivation was undone — almost ' +
				'certainly someone re-hardcoded the string (back to DEFAULT = ' +
				"'neon' or another id) and then the table was reordered, or " +
				'savedThemeId stopped returning DEFAULT. Restore the derivation ' +
				'rather than re-syncing two literals: main.tsx:12 composes both ' +
				'fallbacks, so a split stores one theme and paints another.'
		).toBe(savedThemeId());
	});

	// main.tsx:12 is literally `applyTheme(savedThemeId())`. on a fresh install
	// that composes the two fallbacks, so if they ever split, the first paint
	// stores one theme's id and paints the other theme's colours
	it('paints the same palette on a fresh install however the two fallbacks are reached', () => {
		applyTheme(savedThemeId());
		const fromNothingStored = vars();
		root().removeAttribute('style');
		applyTheme(THEMES[0].id);
		expect(fromNothingStored).toEqual(vars());
	});
});

describe('savedThemeId', () => {
	it('returns the stored id', () => {
		localStorage.setItem(THEME_KEY, 'dracula');
		expect(savedThemeId()).toBe('dracula');
	});

	it('reads the key devgo.theme and no other', () => {
		localStorage.setItem('devgo.textScale', 'matrix');
		localStorage.setItem('theme', 'matrix');
		expect(savedThemeId()).toBe('neon');
	});

	// ⚠️ no validation: the id is handed back whether or not a theme wears it.
	// applyTheme then falls back to neon, so Settings shows NO swatch selected
	// while the window is painted neon (Settings.tsx:679 seeds `current` from
	// this value and compares it to t.id). documented, not endorsed
	it('returns an unknown id verbatim rather than falling back', () => {
		localStorage.setItem(THEME_KEY, 'gruvbox');
		expect(savedThemeId()).toBe('gruvbox');
	});

	it('returns a retired theme id verbatim, so a theme deleted from the table strands the stored value', () => {
		localStorage.setItem(THEME_KEY, 'solarized');
		expect(savedThemeId()).toBe('solarized');
		expect(THEMES.find(t => t.id === savedThemeId())).toBeUndefined();
	});

	// ⭐ `?? DEFAULT` only fires on null. an empty string is a stored value, so
	// it survives — and applyTheme('') then falls back to THEMES[0] anyway
	it('returns the empty string when the stored value is empty, because ?? only catches null', () => {
		localStorage.setItem(THEME_KEY, '');
		expect(savedThemeId()).toBe('');
	});

	it.each(['null', 'undefined', '{"id":"neon"}', '   ', 'NEON'])(
		'returns the corrupt stored value %s untouched',
		raw => {
			localStorage.setItem(THEME_KEY, raw);
			expect(savedThemeId()).toBe(raw);
		}
	);

	it('falls back again after the stored value is removed', () => {
		localStorage.setItem(THEME_KEY, 'nord');
		localStorage.removeItem(THEME_KEY);
		expect(savedThemeId()).toBe('neon');
	});

	// ⭐ the boot guard. main.tsx:12 is `applyTheme(savedThemeId())` before the
	// first paint, with nothing above it to catch — so a throw out of here is not
	// a wrong theme, it is a window that never opens. a webview with site data
	// blocked throws on access rather than answering null, and a read that
	// refuses is the same as an unset one: DEFAULT, exactly as textSize.ts:19
	// returns its unset 1
	it('falls back to the default when localStorage itself refuses to be read', () => {
		const spy = vi
			.spyOn(Storage.prototype, 'getItem')
			.mockImplementation(() => {
				throw new Error('storage is denied');
			});
		try {
			expect(savedThemeId()).toBe('neon');
		} finally {
			spy.mockRestore();
		}
	});

	it('returns the same value on a refused read as on an absent one', () => {
		const absent = savedThemeId();
		const spy = vi
			.spyOn(Storage.prototype, 'getItem')
			.mockImplementation(() => {
				throw new Error('storage is denied');
			});
		try {
			expect(savedThemeId()).toBe(absent);
		} finally {
			spy.mockRestore();
		}
	});

	// the whole point of the guard: the composed boot call paints rather than
	// throwing, and it paints the palette a fresh install gets
	it('lets the main.tsx boot call paint on a storage-denied webview', () => {
		const spy = vi
			.spyOn(Storage.prototype, 'getItem')
			.mockImplementation(() => {
				throw new Error('storage is denied');
			});
		try {
			expect(() => applyTheme(savedThemeId())).not.toThrow();
		} finally {
			spy.mockRestore();
		}
		const fromDeniedStorage = vars();
		root().removeAttribute('style');
		applyTheme(THEMES[0].id);
		expect(fromDeniedStorage).toEqual(vars());
	});
});

describe('applyTheme', () => {
	// ⭐ exact values, because the point is a computed string: the six surfaces
	// become --solid-bg-*, NOT --color-bg-*. index.css derives --color-bg-*
	// from these and the transparency knob, so writing --color-bg-* inline here
	// would defeat see-through mode entirely
	it('writes the six surfaces as --solid-bg-*', () => {
		applyTheme('neon');
		expect(cssVar('--solid-bg-primary')).toBe('#05070d');
		expect(cssVar('--solid-bg-secondary')).toBe('#090e19');
		expect(cssVar('--solid-bg-panel')).toBe('#0c1322');
		expect(cssVar('--solid-bg-hover')).toBe('#131f38');
		expect(cssVar('--solid-bg-selected')).toBe('#0f2f57');
		expect(cssVar('--solid-bg-raised')).toBe('#243c66');
	});

	// ⭐ the other half of the split: index.css owns --color-bg-*, and this
	// loop must never touch it
	it('writes no --color-bg-* variable at all, leaving those to the transparency derivation', () => {
		applyTheme('neon');
		const written = Object.keys(vars());
		expect(written.filter(n => n.indexOf('--color-bg-') === 0)).toEqual([]);
	});

	it('writes the nine non-surface keys as --color-*', () => {
		applyTheme('neon');
		expect(cssVar('--color-text-primary')).toBe('#f4f8ff');
		expect(cssVar('--color-text-secondary')).toBe('#b9c6de');
		expect(cssVar('--color-text-muted')).toBe('#8f9dba');
		expect(cssVar('--color-accent')).toBe('#22d3ee');
		expect(cssVar('--color-accent-hover')).toBe('#67e8f9');
		expect(cssVar('--color-danger')).toBe('#fb7185');
		expect(cssVar('--color-border')).toBe('#161f33');
		expect(cssVar('--color-border-strong')).toBe('#5f7fb5');
		expect(cssVar('--color-glow')).toBe(
			'0 0 0 1px rgb(34 211 238 / 0.45), 0 0 18px rgb(34 211 238 / 0.25)'
		);
	});

	// the rule stated once, mechanically, for every theme in the table: a key
	// prefixed 'bg-' goes to --solid-<key>, every other key to --color-<key>
	it.each(THEMES.map(t => t.id))(
		'sends every bg- key of %s to --solid- and every other key to --color-',
		id => {
			const theme = THEMES.find(t => t.id === id) as (typeof THEMES)[number];
			applyTheme(id);
			for (const key of KEYS) {
				const value = (theme.colors as Record<string, string>)[key];
				const prefix = key.indexOf('bg-') === 0 ? '--solid-' : '--color-';
				expect(cssVar(`${prefix}${key}`), `${id} ${key}`).toBe(value);
			}
		}
	);

	// the sixteenth write, outside the loop: the red as a FILL is derived the
	// same way the surfaces are, so it needs a --solid- name of its own
	it('writes --solid-danger-bg from the palette danger, alongside --color-danger', () => {
		applyTheme('matrix');
		expect(cssVar('--solid-danger-bg')).toBe('#ef4444');
		expect(cssVar('--color-danger')).toBe('#ef4444');
	});

	it('writes exactly sixteen variables and nothing else', () => {
		applyTheme('neon');
		const names = Object.keys(vars()).sort();
		expect(names).toEqual(
			KEYS.map(k => (k.indexOf('bg-') === 0 ? `--solid-${k}` : `--color-${k}`))
				.concat(['--solid-danger-bg'])
				.sort()
		);
	});

	// ⭐ the second fallback: an id no theme wears paints THEMES[0], which is
	// neon only by the coincidence pinned above
	it.each(['gruvbox', '', '   ', 'NEON', 'null', 'undefined'])(
		'falls back to THEMES[0] for the unknown id "%s"',
		id => {
			applyTheme(id);
			const fromUnknown = vars();
			root().removeAttribute('style');
			applyTheme(THEMES[0].id);
			expect(fromUnknown).toEqual(vars());
		}
	);

	it('matches on the id exactly, not by display name and not case-insensitively', () => {
		applyTheme('Matrix');
		expect(cssVar('--solid-bg-primary')).toBe(THEMES[0].colors['bg-primary']);
		root().removeAttribute('style');
		applyTheme('Pure Black');
		expect(cssVar('--solid-bg-primary')).toBe(THEMES[0].colors['bg-primary']);
	});

	it('replaces every variable when a second theme is applied: last writer wins', () => {
		applyTheme('neon');
		expect(cssVar('--color-glow')).not.toBe('none');
		applyTheme('black');
		expect(cssVar('--solid-bg-primary')).toBe('#000000');
		expect(cssVar('--color-accent')).toBe('#3b82f6');
		// the neon halo is overwritten rather than left behind, which is why
		// every other palette spells out glow: 'none'
		expect(cssVar('--color-glow')).toBe('none');
		expect(Object.keys(vars())).toHaveLength(16);
	});

	it('is a pure write to :root and stores nothing', () => {
		applyTheme('dracula');
		expect(localStorage.length).toBe(0);
		expect(savedThemeId()).toBe('neon');
	});

	it('does not read localStorage at all, so it works where storage is denied', () => {
		const spy = vi
			.spyOn(Storage.prototype, 'getItem')
			.mockImplementation(() => {
				throw new Error('storage is denied');
			});
		try {
			expect(() => applyTheme('nord')).not.toThrow();
			expect(cssVar('--color-accent')).toBe('#88c0d0');
		} finally {
			spy.mockRestore();
		}
	});
});

describe('setTheme', () => {
	it('persists the id under devgo.theme', () => {
		setTheme('nord');
		expect(localStorage.getItem('devgo.theme')).toBe('nord');
	});

	it('applies the palette in the same call, so the window recolours without a reload', () => {
		setTheme('dracula');
		expect(cssVar('--solid-bg-primary')).toBe('#282a36');
		expect(cssVar('--color-accent')).toBe('#bd93f9');
		expect(cssVar('--solid-danger-bg')).toBe('#ff5555');
	});

	it('round-trips through savedThemeId', () => {
		setTheme('matrix');
		expect(savedThemeId()).toBe('matrix');
	});

	// ⭐ the order, proven from inside the write: at the moment setItem runs the
	// accent is still the PREVIOUS theme's, so the persist happens first and
	// the paint second
	it('persists before it applies', () => {
		applyTheme('neon');
		const original = Storage.prototype.setItem;
		const accentWhenStored: string[] = [];
		const spy = vi
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation((key: string, value: string) => {
				accentWhenStored.push(cssVar('--color-accent'));
				original.call(localStorage, key, value);
			});
		try {
			setTheme('matrix');
		} finally {
			spy.mockRestore();
		}
		expect(accentWhenStored).toEqual(['#22d3ee']);
		expect(cssVar('--color-accent')).toBe('#22c55e');
		expect(localStorage.getItem(THEME_KEY)).toBe('matrix');
	});

	it('writes localStorage exactly once, with the one key', () => {
		const spy = vi.spyOn(Storage.prototype, 'setItem');
		try {
			setTheme('black');
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith('devgo.theme', 'black');
		} finally {
			spy.mockRestore();
		}
	});

	// ⭐ it announces NOTHING. textSize dispatches a 'devgo:textscale' event so
	// an open Settings panel can follow a keyboard change; themes have no such
	// channel, which is why Settings.tsx:713-715 has to call setCurrent(id)
	// itself right after setTheme(id). a theme changed from anywhere else would
	// leave an open panel highlighting the wrong swatch
	it('announces nothing: no event is dispatched for other views to follow', () => {
		const dispatch = vi.spyOn(window, 'dispatchEvent');
		try {
			setTheme('nord');
			expect(dispatch).not.toHaveBeenCalled();
		} finally {
			dispatch.mockRestore();
		}
	});

	// ⚠️ the split from savedThemeId, end to end: the unknown id is STORED as
	// asked while the palette applied is THEMES[0]. the next launch reads the
	// unknown id back, paints neon, and Settings highlights nothing
	it('persists an unknown id verbatim while painting the THEMES[0] fallback', () => {
		setTheme('gruvbox');
		expect(localStorage.getItem(THEME_KEY)).toBe('gruvbox');
		expect(savedThemeId()).toBe('gruvbox');
		expect(cssVar('--solid-bg-primary')).toBe(THEMES[0].colors['bg-primary']);
	});

	it('is idempotent, and the last call decides', () => {
		setTheme('matrix');
		setTheme('nord');
		setTheme('nord');
		expect(localStorage.getItem(THEME_KEY)).toBe('nord');
		expect(cssVar('--color-accent')).toBe('#88c0d0');
		expect(localStorage.length).toBe(1);
	});

	// ⭐ a refused write still paints. the user picked a theme; storage being
	// unavailable costs them persistence across restarts, not the theme itself —
	// the same trade textSize.ts:26-28 makes (a refused write still zooms) and
	// App.tsx:270-277 makes (a refused write still flips the hints). the persist
	// runs FIRST, so this only holds because the throw is swallowed
	it('still paints the palette when localStorage refuses the write', () => {
		applyTheme('neon');
		const spy = vi
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(() => {
				throw new Error('storage is full');
			});
		try {
			expect(() => setTheme('matrix')).not.toThrow();
		} finally {
			spy.mockRestore();
		}
		expect(cssVar('--color-accent')).toBe('#22c55e');
		expect(cssVar('--solid-bg-primary')).toBe('#000000');
		expect(cssVar('--solid-danger-bg')).toBe('#ef4444');
	});

	// nothing is persisted, so the next launch is the default again: the cost of
	// a refused write is exactly that and nothing more
	it('persists nothing when the write is refused, so the choice is for this run only', () => {
		const spy = vi
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(() => {
				throw new Error('storage is full');
			});
		try {
			setTheme('matrix');
		} finally {
			spy.mockRestore();
		}
		expect(localStorage.length).toBe(0);
		expect(savedThemeId()).toBe('neon');
	});

	// the caller: Settings.tsx:713 calls setTheme(id) inside pick() with no
	// try/catch, so an escaping throw would take the panel down on a click
	it('lets a refused write escape nothing to its caller, and still applies every theme', () => {
		const spy = vi
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(() => {
				throw new Error('storage is full');
			});
		try {
			for (const t of THEMES) {
				expect(() => setTheme(t.id), t.id).not.toThrow();
				expect(cssVar('--color-accent'), t.id).toBe(t.colors.accent);
			}
		} finally {
			spy.mockRestore();
		}
	});
});
