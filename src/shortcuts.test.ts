import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	isAvailable,
	isTypingTarget,
	labelFor,
	matches,
	paneOwns,
	PANE_KEYS,
	prettyKeys,
	displayKeys,
	shortcutFor,
	SHORTCUTS
} from './shortcuts';

// the keyboard contract, tested as a table plus five pure functions. no
// component renders here and nothing is mocked for the bulk of the file:
// `matches`, `isTypingTarget` and `paneOwns` only need a KeyboardEvent and a
// DOM node, both of which jsdom gives for free.
//
// ⛔ the ONE thing that is not free is the platform. jsdom's user agent is
//
//     Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/30.1.1
//
// which holds no "Windows NT", no "X11" and no "Linux", so isMac, isWindows
// AND isLinux from src/platform are ALL FALSE in here, on every host — a
// linux runner says `(linux)` and /X11|Linux/ is case-sensitive, so it is
// still false. the static import above is therefore bound to the
// "unrecognised desktop" branch of every platform-sensitive function, which
// is a real case worth asserting but is NOT windows. anything that needs a
// named desktop goes through `onPlatform` below.
//
// assertions are relative wherever the point is that two chords must not
// collide or that one label wins over another. hard strings are used where
// the string IS the contract: '' as the unknown-id sentinel, 'Cmd'/'Opt' as
// the mac modifier words, and 'Enter' spelled out rather than ⏎.

const byId = (id: ShortcutId): Shortcut => {
	const s = SHORTCUTS.find(x => x.id === id);
	expect(s, `no shortcut declared for ${id}`).toBeDefined();
	return s as Shortcut;
};

// the keydown a user pressing this chord would actually produce. `Space` is
// the interesting one: KeyboardEvent.key is the character produced, so the
// space bar reports ' ' and never the word the table stores
// tsconfig's lib predates es2022, so Array.prototype.at is not available here
const last = (parts: string[]): string => parts[parts.length - 1];

const eventFor = (keys: string): KeyboardEvent => {
	const parts = keys.split('+');
	const key = parts[parts.length - 1];
	return new KeyboardEvent('keydown', {
		key: key === 'Space' ? ' ' : key,
		ctrlKey: parts.includes('Ctrl'),
		altKey: parts.includes('Alt'),
		shiftKey: parts.includes('Shift')
	});
};

// KeyboardEvent.target is readonly and stays null until the event is
// dispatched, so the two target-reading functions need a real node in a real
// document. the listener sits on document so the event has to bubble all the
// way up, which is where the app's own handler lives
const keyOn = (el: Element, init: KeyboardEventInit): KeyboardEvent => {
	const seen: KeyboardEvent[] = [];
	const spy = (e: Event) => seen.push(e as KeyboardEvent);
	document.addEventListener('keydown', spy);
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
	document.removeEventListener('keydown', spy);
	expect(seen).toHaveLength(1);
	expect(seen[0].target).toBe(el);
	return seen[0];
};

const mount = (html: string): HTMLElement => {
	const host = document.createElement('div');
	host.innerHTML = html;
	document.body.append(host);
	return host;
};

// a fresh copy of the module standing on a named desktop. the pattern is
// doMock + resetModules + dynamic import rather than a file-level vi.mock
// because most of this file wants the real (all-false) platform, and a
// hoisted mock would take that case away
type Platform = { isMac: boolean; isWindows: boolean; isLinux: boolean };
const WINDOWS: Platform = { isMac: false, isWindows: true, isLinux: false };
const MAC: Platform = { isMac: true, isWindows: false, isLinux: false };
const LINUX: Platform = { isMac: false, isWindows: false, isLinux: true };

const onPlatform = async (p: Platform) => {
	vi.resetModules();
	vi.doMock('./platform', () => p);
	return await import('./shortcuts');
};

afterEach(() => {
	vi.doUnmock('./platform');
	vi.resetModules();
	document.body.innerHTML = '';
});

describe('SHORTCUTS — the table is the single declaration', () => {
	it('declares every id once and never binds one chord twice', () => {
		const ids = SHORTCUTS.map(s => s.id);
		const keys = SHORTCUTS.map(s => s.keys);

		expect(new Set(ids).size).toBe(ids.length);
		// the whole reason `matches` is exact: two entries on one chord means
		// whichever the handler tests first silently swallows the other
		expect(new Set(keys).size).toBe(keys.length);
		expect(SHORTCUTS.length).toBeGreaterThan(0);
	});

	it('writes every chord in the canonical Ctrl→Alt→Shift order', () => {
		// the order is documented on Shortcut.keys and load-bearing: Settings
		// and the footer print the string verbatim, so 'Shift+Ctrl+E' would
		// still bind but would read wrong in two places at once
		const ORDER = ['Ctrl', 'Alt', 'Shift'];
		for (const s of SHORTCUTS) {
			const mods = s.keys.split('+').slice(0, -1);
			expect(mods.every(m => ORDER.includes(m)), s.keys).toBe(true);
			const ranks = mods.map(m => ORDER.indexOf(m));
			expect([...ranks].sort((a, b) => a - b), s.keys).toEqual(ranks);
		}
	});

	it('gives every entry a non-empty label, a key and one of the four groups', () => {
		const GROUPS: ShortcutGroup[] = [
			'Global',
			'Navigation',
			'Project',
			'Workspace'
		];
		for (const s of SHORTCUTS) {
			expect(s.label.trim(), s.id).not.toBe('');
			// a trailing empty segment would make `matches` compare against ''
			expect(last(s.keys.split('+')), s.id).not.toBe('');
			expect(GROUPS, s.id).toContain(s.group);
		}
	});

	it('never asks a Global or Navigation binding to need a selection', () => {
		// the two groups that must work with nothing selected — a Global
		// shortcut gated on selection is one the user cannot reach on a cold
		// launch, and the palette would still advertise it
		const gated = SHORTCUTS.filter(s => s.needsSelection);
		expect(gated.length).toBeGreaterThan(0);
		for (const s of gated) expect(['Project', 'Workspace'], s.id).toContain(s.group);
	});

	it('only ever declares a per-desktop label alongside the plain one', () => {
		// macLabel/linuxLabel/managerLabel are all fallbacks THROUGH label, so
		// an entry carrying one but no label would render '' on the desktop the
		// override does not cover
		for (const s of SHORTCUTS) {
			if (s.macLabel || s.linuxLabel || s.managerLabel)
				expect(s.label, s.id).toBeTruthy();
		}
	});
});

describe('shortcutFor', () => {
	it('answers the declared chord, and the empty string for an id it has never heard of', () => {
		expect(shortcutFor('commandPalette')).toBe(byId('commandPalette').keys);
		expect(shortcutFor('attach')).toBe(byId('attach').keys);
		// '' is the sentinel, not a throw: every caller feeds the result
		// straight to `matches`, which can never match an empty chord
		expect(shortcutFor('nothingLikeThis' as ShortcutId)).toBe('');
		expect(matches(eventFor('Ctrl+K'), '')).toBe(false);
	});
});

describe('matches — modifiers are compared exactly', () => {
	it('fires each chord and nothing else in the table', () => {
		// the anti-swallowing contract, swept over the whole table: the event a
		// chord produces must be claimed by exactly one entry. this is the test
		// that breaks when someone adds a binding that overlaps an old one
		for (const s of SHORTCUTS) {
			const hits = SHORTCUTS.filter(x => matches(eventFor(s.keys), x.keys));
			expect(hits.map(x => x.id), s.keys).toEqual([s.id]);
		}
	});

	it('refuses a chord with an extra or a missing modifier', () => {
		const plain = new KeyboardEvent('keydown', { key: 'Enter' });
		const ctrl = eventFor('Ctrl+Enter');
		const ctrlShift = eventFor('Ctrl+Shift+Enter');

		expect(matches(ctrl, 'Ctrl+Enter')).toBe(true);
		// the case the doc comment names: a superset press must not fire the
		// smaller chord, or Ctrl+Alt+Shift+Enter would trip four actions
		expect(matches(ctrlShift, 'Ctrl+Enter')).toBe(false);
		expect(matches(ctrl, 'Ctrl+Shift+Enter')).toBe(false);
		expect(matches(plain, 'Ctrl+Enter')).toBe(false);
		expect(matches(ctrl, 'Enter')).toBe(false);
	});

	it('treats Cmd as a Ctrl alias, in both directions', () => {
		const cmd = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
		const both = new KeyboardEvent('keydown', {
			key: 'k',
			ctrlKey: true,
			metaKey: true
		});

		expect(matches(cmd, 'Ctrl+K')).toBe(true);
		// the two flags collapse into one before the comparison, so holding
		// both is still exactly one ctrl and not two
		expect(matches(both, 'Ctrl+K')).toBe(true);
		// and a bare-key chord must not fire under a lone Cmd
		expect(matches(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }), 'Enter')).toBe(
			false
		);
	});

	it('compares the produced character, so Space means the space bar', () => {
		const space = new KeyboardEvent('keydown', { key: ' ', ctrlKey: true });
		const word = new KeyboardEvent('keydown', { key: 'Space', ctrlKey: true });

		expect(matches(space, 'Ctrl+Space')).toBe(true);
		// no browser reports 'Space'; if one did it would not be the space bar
		expect(matches(word, 'Ctrl+Space')).toBe(false);
		expect(matches(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }), 'Ctrl+,')).toBe(
			true
		);
	});

	it('ignores the case of the key on both sides', () => {
		// a real browser reports 'P' for Ctrl+Shift+P and 'p' for Ctrl+P, so a
		// case-sensitive compare would break every shifted letter chord
		const upper = new KeyboardEvent('keydown', {
			key: 'P',
			ctrlKey: true,
			shiftKey: true
		});
		const lower = new KeyboardEvent('keydown', {
			key: 'p',
			ctrlKey: true,
			shiftKey: true
		});

		expect(matches(upper, 'Ctrl+Shift+P')).toBe(true);
		expect(matches(lower, 'Ctrl+Shift+P')).toBe(true);
		expect(matches(upper, 'ctrl+shift+p')).toBe(false); // modifiers are NOT case-folded
	});

	it('never matches a display string fed back in', () => {
		// prettyKeys/displayKeys are a one-way trip: 'Cmd' and 'Opt' are not
		// modifier names `matches` knows, so a translated chord reads as a bare
		// key with the wrong modifiers and silently matches nothing
		const cmdK = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
		expect(matches(cmdK, 'Cmd+K')).toBe(false);
		expect(matches(eventFor('Alt+Enter'), 'Opt+Enter')).toBe(false);
		expect(matches(eventFor('ArrowUp'), '↑')).toBe(false);
	});
});

describe('isTypingTarget — bare keys belong to the focused input', () => {
	it('claims an input and a textarea, and nothing else', () => {
		const host = mount(
			'<input><textarea></textarea><div tabindex="0"></div><button></button>'
		);
		const [input, textarea, div, button] = [
			host.querySelector('input')!,
			host.querySelector('textarea')!,
			host.querySelector('div')!,
			host.querySelector('button')!
		];

		expect(isTypingTarget(keyOn(input, { key: 'a' }))).toBe(true);
		expect(isTypingTarget(keyOn(textarea, { key: 'a' }))).toBe(true);
		expect(isTypingTarget(keyOn(div, { key: 'a' }))).toBe(false);
		expect(isTypingTarget(keyOn(button, { key: 'a' }))).toBe(false);
		// an undispatched event has a null target and must not throw
		expect(isTypingTarget(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
	});

	it('does not claim a contenteditable div, whatever the modifiers', () => {
		// documented as it stands today: the check is instanceof, not "can this
		// node receive text", so a contenteditable surface would let bare keys
		// through to the app handler. nothing in DevGo is contenteditable
		const host = mount('<div contenteditable="true"></div>');
		const el = host.querySelector('div')!;
		expect(isTypingTarget(keyOn(el, { key: 'a' }))).toBe(false);
		// and the modifier state is irrelevant either way — the caller decides
		// what to do with a modifier press, this only reports the target
		expect(isTypingTarget(keyOn(host.querySelector('div')!, { key: 'a', ctrlKey: true }))).toBe(
			false
		);
	});
});

describe('paneOwns — who gets the key while the attach pane has focus', () => {
	it('hands a bare key to the shell and keeps the two pane keys for the app', () => {
		const host = mount('<div data-attach><span id="deep"></span></div>');
		const deep = host.querySelector('#deep')!;

		// every ordinary key inside the pane is the shell's, ctrl+l and ctrl+r
		// included — those are readline, not the app's refresh
		expect(paneOwns(keyOn(deep, { key: 'a' }))).toBe(true);
		expect(paneOwns(keyOn(deep, { key: 'l', ctrlKey: true }))).toBe(true);
		expect(paneOwns(keyOn(deep, { key: 'r', ctrlKey: true }))).toBe(true);

		// …except the two the app must never lose: the palette and the key that
		// closes the pane you are standing in
		for (const id of PANE_KEYS) {
			const chord = shortcutFor(id);
			expect(chord).not.toBe('');
			const parts = chord.split('+');
			expect(
				paneOwns(
					keyOn(deep, {
						key: last(parts),
						ctrlKey: parts.includes('Ctrl'),
						altKey: parts.includes('Alt'),
						shiftKey: parts.includes('Shift')
					})
				),
				chord
			).toBe(false);
		}
	});

	it('claims nothing outside the pane and nothing without a target', () => {
		const host = mount('<div id="outside"></div><div data-attach></div>');
		expect(paneOwns(keyOn(host.querySelector('#outside')!, { key: 'a' }))).toBe(false);
		expect(paneOwns(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
		// the pane element itself counts, not only its descendants — closest()
		// starts at the node it is called on
		expect(paneOwns(keyOn(host.querySelector('[data-attach]')!, { key: 'a' }))).toBe(true);
	});

	it('lists exactly the palette and the attach key as app-owned', () => {
		expect([...PANE_KEYS].sort()).toEqual(['attach', 'commandPalette']);
	});
});

describe('isAvailable — a binding the desktop cannot honour is not advertised', () => {
	it('drops a windows-only binding on an unrecognised desktop', () => {
		// the static import stands on jsdom, where all three flags are false —
		// so a UA none of the three recognise is treated as "not windows"
		// rather than as windows by default
		const winOnly = SHORTCUTS.filter(s => s.windowsOnly);
		expect(winOnly.length).toBeGreaterThan(0);
		for (const s of winOnly) expect(isAvailable(s), s.id).toBe(false);
		for (const s of SHORTCUTS.filter(s => !s.windowsOnly))
			expect(isAvailable(s), s.id).toBe(true);
	});

	it('keeps the windows-only bindings on windows and drops them on mac and linux', async () => {
		const win = await onPlatform(WINDOWS);
		const winOnly = win.SHORTCUTS.filter(s => s.windowsOnly);
		for (const s of winOnly) expect(win.isAvailable(s), s.id).toBe(true);
		// every entry available, on the one desktop that has a second filesystem
		expect(win.SHORTCUTS.every(win.isAvailable)).toBe(true);

		for (const p of [MAC, LINUX]) {
			const m = await onPlatform(p);
			expect(m.SHORTCUTS.filter(m.isAvailable).length).toBe(
				m.SHORTCUTS.length - winOnly.length
			);
		}
	});
});

describe('labelFor — what the action is called on this desktop', () => {
	it('answers the empty string for an unknown id', () => {
		expect(labelFor('neverDeclared' as ShortcutId)).toBe('');
	});

	it('uses the plain label where no per-desktop override exists', () => {
		expect(labelFor('openTerminal')).toBe(byId('openTerminal').label);
		expect(labelFor('commandPalette')).toBe(byId('commandPalette').label);
		// opts are ignored by an entry with no managerLabel
		expect(labelFor('openTerminal', { manager: 'Nautilus', subject: 'x' })).toBe(
			byId('openTerminal').label
		);
	});

	it('prefers macLabel on a mac and linuxLabel on linux over the plain one', async () => {
		const mac = await onPlatform(MAC);
		const linux = await onPlatform(LINUX);
		const plain = byId('copyWinPath');

		// copyWinPath is the clean case: three different words, no managerLabel
		expect(mac.labelFor('copyWinPath')).toBe(plain.macLabel);
		expect(linux.labelFor('copyWinPath')).toBe(plain.linuxLabel);
		expect(mac.labelFor('copyWinPath')).not.toBe(plain.label);
		expect(linux.labelFor('copyWinPath')).not.toBe(plain.label);

		const win = await onPlatform(WINDOWS);
		expect(win.labelFor('copyWinPath')).toBe(plain.label);
	});

	it('names the built-in file manager when the caller registers none', async () => {
		// mac and windows both ship one the backend falls back to by name
		const mac = await onPlatform(MAC);
		expect(mac.labelFor('revealExplorer')).toContain('Finder');
		const win = await onPlatform(WINDOWS);
		expect(win.labelFor('revealExplorer')).toContain('Explorer');
		// an unrecognised desktop takes the windows branch of builtInManager
		expect(labelFor('revealExplorer')).toContain('Explorer');
	});

	it('falls back to the nameless linux label, because xdg-open has no name to print', async () => {
		const linux = await onPlatform(LINUX);
		// there IS a managerLabel on this entry, but no manager to fill it with
		// — so the managerLabel branch is skipped entirely and linuxLabel wins
		expect(linux.labelFor('revealExplorer')).toBe(byId('revealExplorer').linuxLabel);
		expect(linux.labelFor('revealExplorer')).not.toContain('{manager}');
		expect(linux.labelFor('revealWorkspace')).toBe(byId('revealWorkspace').linuxLabel);
	});

	it('lets a registered manager override the built-in one, on every desktop', async () => {
		for (const p of [MAC, WINDOWS, LINUX]) {
			const m = await onPlatform(p);
			const out = m.labelFor('revealExplorer', { manager: 'Nautilus' });
			expect(out).toContain('Nautilus');
			expect(out).not.toContain('Finder');
			expect(out).not.toContain('Explorer');
			expect(out).not.toContain('{');
		}
	});

	it('fills {subject} with a leading space, and erases it when there is none', async () => {
		const linux = await onPlatform(LINUX);
		const named = linux.labelFor('revealWorkspace', {
			manager: 'Dolphin',
			subject: 'blog'
		});
		const bare = linux.labelFor('revealWorkspace', { manager: 'Dolphin' });

		expect(named).toBe('Reveal workspace blog in Dolphin');
		expect(bare).toBe('Reveal workspace in Dolphin');
		// no placeholder and no double space survives either way
		for (const out of [named, bare]) {
			expect(out).not.toContain('{');
			expect(out).not.toContain('  ');
		}
		// an empty-string subject is treated as no subject, not as one
		expect(linux.labelFor('revealWorkspace', { manager: 'Dolphin', subject: '' })).toBe(bare);
	});

	it('drops a subject the chosen label has no slot for', async () => {
		// revealExplorer's managerLabel is 'Reveal in {manager}' — no
		// {subject} — so a caller passing one gets it silently discarded
		// rather than appended
		const win = await onPlatform(WINDOWS);
		expect(win.labelFor('revealExplorer', { manager: 'Dolphin', subject: 'blog' })).toBe(
			win.labelFor('revealExplorer', { manager: 'Dolphin' })
		);
	});

	it('treats an empty manager as no manager rather than substituting it', async () => {
		// '' is falsy but not nullish, so `?? builtInManager()` keeps it and the
		// `&& manager` guard is what saves the label from reading 'Reveal in '
		const linux = await onPlatform(LINUX);
		expect(linux.labelFor('revealExplorer', { manager: '' })).toBe(
			byId('revealExplorer').linuxLabel
		);
		const mac = await onPlatform(MAC);
		expect(mac.labelFor('revealExplorer', { manager: '' })).toBe(
			byId('revealExplorer').macLabel
		);
	});

	it('fills a manager or subject containing $&, $1, $$ or $` literally', () => {
		// String.replace with a STRING replacement expands $&, $1, $`, $' and
		// $$ as substitution patterns, and both of these values come from
		// outside — the manager is the backend's resolved default, the subject
		// is a workspace name the user typed. a function replacement is the
		// fix: every one of these has to come back byte for byte
		expect(labelFor('revealExplorer', { manager: 'a $& b' })).toBe('Reveal in a $& b');
		expect(labelFor('revealWorkspace', { manager: 'X', subject: '$&' })).toBe(
			'Reveal workspace $& in X'
		);
		expect(labelFor('revealWorkspace', { manager: '$1', subject: '$$' })).toBe(
			'Reveal workspace $$ in $1'
		);
		expect(labelFor('revealWorkspace', { manager: "$'", subject: '$`' })).toBe(
			"Reveal workspace $` in $'"
		);
		// and a filled-in value is never re-read as a placeholder: one pass, so
		// a workspace literally named '{manager}' cannot eat the real slot
		expect(labelFor('revealWorkspace', { manager: 'X', subject: '{manager}' })).toBe(
			'Reveal workspace {manager} in X'
		);
	});
});

describe('displayKeys and prettyKeys — what the user reads, never what matches parses', () => {
	it('changes nothing off a mac', () => {
		for (const s of SHORTCUTS) expect(displayKeys(s.keys), s.id).toBe(s.keys);
	});

	it('spells the mac modifiers as words and leaves Shift alone', async () => {
		const mac = await onPlatform(MAC);
		expect(mac.displayKeys('Ctrl+Alt+Shift+Enter')).toBe('Cmd+Opt+Shift+Enter');
		expect(mac.displayKeys('Ctrl+K')).toBe('Cmd+K');
		// the summon hotkey arrives from tauri already spelled Cmd, so the map
		// has to be idempotent or it would fall through to the raw word
		expect(mac.displayKeys('Cmd+Shift+D')).toBe('Cmd+Shift+D');
		expect(mac.displayKeys(mac.displayKeys('Ctrl+Alt+E'))).toBe(
			mac.displayKeys('Ctrl+Alt+E')
		);
		// no chord may still show a windows modifier name after translation
		for (const s of mac.SHORTCUTS) {
			const shown = mac.displayKeys(s.keys);
			expect(shown.split('+'), s.id).not.toContain('Ctrl');
			expect(shown.split('+'), s.id).not.toContain('Alt');
		}
	});

	it('leaves the table itself canonical — only the rendered string changes', async () => {
		const mac = await onPlatform(MAC);
		const before = mac.SHORTCUTS.map(s => s.keys);
		mac.SHORTCUTS.forEach(s => mac.prettyKeys(s.keys));
		expect(mac.SHORTCUTS.map(s => s.keys)).toEqual(before);
		// and the canonical string still matches the press it always did
		for (const s of mac.SHORTCUTS)
			expect(mac.matches(eventFor(s.keys), s.keys), s.id).toBe(true);
	});

	it('draws the arrows as glyphs and shortens Delete', () => {
		expect(prettyKeys('ArrowUp')).toBe('↑');
		expect(prettyKeys('Alt+ArrowDown')).toBe('Alt+↓');
		expect(prettyKeys('ArrowLeft')).toBe('←');
		expect(prettyKeys('ArrowRight')).toBe('→');
		expect(prettyKeys('Delete')).toBe('Del');
	});

	it('spells Enter and Space out as words rather than drawing them', () => {
		// deliberate, and measured: ⏎ is a hairline outline well under cap
		// height and unreadable at the size the footer has room for
		expect(prettyKeys('Enter')).toBe('Enter');
		expect(prettyKeys('Ctrl+Alt+Shift+Enter')).toBe('Ctrl+Alt+Shift+Enter');
		expect(prettyKeys('Ctrl+Space')).toBe('Ctrl+Space');
		for (const s of SHORTCUTS) expect(prettyKeys(s.keys), s.id).not.toContain('⏎');
	});

	it('passes a key it has no name for straight through', () => {
		expect(prettyKeys('F5')).toBe('F5');
		expect(prettyKeys('Ctrl+,')).toBe('Ctrl+,');
		expect(prettyKeys('Home')).toBe('Home');
		expect(prettyKeys('')).toBe('');
	});

	it('applies both the mac modifiers and the key glyphs at once', async () => {
		const mac = await onPlatform(MAC);
		expect(mac.prettyKeys('Alt+ArrowUp')).toBe('Opt+↑');
		expect(mac.prettyKeys('Ctrl+Shift+E')).toBe('Cmd+Shift+E');
		expect(mac.prettyKeys('Ctrl+Space')).toBe('Cmd+Space');
	});
});
