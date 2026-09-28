import { describe, expect, it } from 'vitest';
import {
	devMenuIsEmpty,
	devMenuRows,
	emptyScriptsMessage,
	readScripts,
	scriptsLogLine
} from './devScripts';

// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
//
// the owner's `project → dev → Run dev script` produced nothing, then worked
// on a retry with no code change. devgo.log proved the failing click never
// reached rust: `invoke get_project_scripts`, then end of file — no
// run_script, no refusal. the list came back EMPTY, App.tsx toasted "No dev
// scripts found for this project", no submenu was built, and nothing was
// written down. two independent causes produce that empty list, and BOTH of
// them are cases where the project was never actually consulted:
//
//   1. a WSL project whose distro is not in the 5-second running-distro memo
//      — scripts.rs skips the package.json read entirely
//   2. a tech-cache miss, which used to leave `tags` empty, so a rust, go or
//      docker project lost every conventional entry it needs no file for
//
// nothing in this suite asserts the mounting — that lives in a closure inside
// AppInner and needs the whole app on screen. what it asserts is the part
// that was wrong: what the frontend CONCLUDES from the answer, and what it
// leaves in the log.
//
// ⛔ no tauri here. the log line's one side effect (uiLog's invoke) is
// App.tsx's business; this module only builds the string.
// ─────────────────────────────────────────────────────────────────────────────

const two: DevScript[] = [
	{ name: 'dev', command: 'pnpm run dev' },
	{ name: 'build', command: 'pnpm run build' }
];

const ASLEEP =
	'The WSL distro Ubuntu is not running, so this project’s package.json ' +
	'was not read — this is not a claim that the project has no scripts.';

describe('readScripts', () => {
	it('passes the reason-bearing shape through untouched', () => {
		const list: ScriptList = { scripts: two, reason: ASLEEP, install: null };
		expect(readScripts(list)).toEqual(list);
	});

	/// ⭐ the backend carried a bare array before it carried a reason, and a
	/// test mock still hands one over. a reader that assumed the new shape
	/// would take `.length` off undefined and throw — swapping the empty menu
	/// we are here to explain for a TypeError toast, the same bug one layer up
	it('reads a bare array as a list with nothing to explain', () => {
		expect(readScripts(two)).toEqual({ scripts: two, reason: null, install: null });
		expect(readScripts([])).toEqual({ scripts: [], reason: null, install: null });
	});
});

describe('scriptsLogLine', () => {
	/// ⭐ the line the failing click did not write. one line covers every
	/// entry in the dev section, because they all come out of this one array
	it('names the count and every script, so a report can be read cold', () => {
		const line = scriptsLogLine('devgo', { scripts: two, reason: null, install: null });

		expect(line).toBe('scripts devgo: 2 [dev build]');
	});

	/// the shape of the reported failure, as it now appears in devgo.log:
	/// a zero, and immediately after it the reason it is a zero
	it('a zero carries the reason beside it', () => {
		const line = scriptsLogLine('med-store-management', {
			scripts: [],
			reason: ASLEEP,
			install: null
		});

		expect(line.startsWith('scripts med-store-management: 0 []')).toBe(true);
		expect(line).toContain(ASLEEP);
	});

	/// a stopped distro withholds package.json, not `cargo run` — that one
	/// needs no file read. the submenu renders, so the user is never told
	/// anything is missing, and the log is the only place that can say so
	it('keeps the reason on a non-empty list', () => {
		const line = scriptsLogLine('api', {
			scripts: [{ name: 'cargo run', command: 'cargo run' }],
			reason: ASLEEP,
			install: null
		});

		expect(line).toContain('1 [cargo run]');
		expect(line).toContain('not running');
	});
});

describe('emptyScriptsMessage', () => {
	/// ⭐ the sentence that was wrong. an empty list from a sleeping distro
	/// is not a fact about the project, and the user acted on it as if it
	/// were — the retry that "fixed" it only refreshed a 5-second memo
	it('says why, when the backend knows why', () => {
		expect(emptyScriptsMessage({ scripts: [], reason: ASLEEP, install: null })).toBe(ASLEEP);
	});

	/// and the old sentence survives for the case it was always true for:
	/// nothing stopped us looking, so the project really has none
	it('claims the project has none only when nothing stopped the read', () => {
		expect(emptyScriptsMessage({ scripts: [], reason: null, install: null })).toBe(
			'No dev scripts found for this project'
		);
	});
});

const INSTALL: DevScript = { name: 'Install', command: 'pnpm install' };

describe('readScripts › install', () => {
	/// an answer from before the field existed must not leave it undefined
	it('reads a missing install as null', () => {
		expect(
			readScripts({ scripts: two, reason: null } as unknown as ScriptList)
		).toEqual({ scripts: two, reason: null, install: null });
	});

	it('keeps the install the backend sent', () => {
		const list: ScriptList = { scripts: two, reason: null, install: INSTALL };
		expect(readScripts(list).install).toEqual(INSTALL);
	});
});

describe('devMenuRows', () => {
	/// ⭐ Install sits on top, split from the scripts by a separator
	it('puts Install first, then a separator, then the scripts', () => {
		expect(
			devMenuRows({ scripts: two, reason: null, install: INSTALL })
		).toEqual([INSTALL, 'separator', ...two]);
	});

	it('a package.json with no scripts is Install alone, no dangling separator', () => {
		expect(
			devMenuRows({ scripts: [], reason: null, install: INSTALL })
		).toEqual([INSTALL]);
	});

	/// no package.json (rust-only, or a sleeping distro): no Install row
	it('no install means the scripts alone, unchanged', () => {
		const cargo = [{ name: 'cargo run', command: 'cargo run' }];
		expect(devMenuRows({ scripts: cargo, reason: null, install: null })).toEqual(
			cargo
		);
	});
});

describe('devMenuIsEmpty', () => {
	it('is empty only with no install and no scripts', () => {
		expect(devMenuIsEmpty({ scripts: [], reason: null, install: null })).toBe(true);
		expect(devMenuIsEmpty({ scripts: [], reason: null, install: INSTALL })).toBe(
			false
		);
		expect(devMenuIsEmpty({ scripts: two, reason: null, install: null })).toBe(false);
	});
});

describe('scriptsLogLine › install', () => {
	it('names the install command beside the scripts', () => {
		expect(
			scriptsLogLine('devgo', { scripts: two, reason: null, install: INSTALL })
		).toBe('scripts devgo: 2 [dev build] + pnpm install');
	});
});
