import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	compactCount,
	GH_INSTALL,
	laneSections,
	RECENT_LIMIT,
	relativeTime,
	visibleRepos
} from './github';
import { fuzzyScore } from './palette';

// the github lane's pure half: six exports, no invoke, no react, no DOM. two
// of them are FORMATTERS, and a formatter is the one kind of function whose
// exact output is the contract — nothing throws when `1.2M stars` renders as
// `1200k`, it just reads wrong forever. so compactCount and relativeTime are
// asserted as exact strings, at both sides of every boundary. visibleRepos
// and laneSections are ordering/shape functions, so those assertions are
// relative (a beats b, same object, section count) except where a shape IS
// the contract: the placeholder row's fields and the `gone` set.
//
// ⛔ the platform. jsdom's user agent is
//
//     Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/30.1.1
//
// which holds no "Macintosh" and no "Windows NT", so isMac AND isWindows from
// src/platform are BOTH false here on every host — the static GH_INSTALL
// imported above is the *last* branch of the ternary, which is the
// unrecognised-desktop fallback and happens to be the linux line. a named
// desktop goes through `onPlatform`.
//
// the clock is never the real one. relativeTime takes `now` as its second
// argument, so every boundary below is injected; one test uses fake timers
// purely to prove the default argument reads the clock per call.

const repo = (full_name: string, over: Partial<GithubRepo> = {}): GithubRepo => {
	const parts = full_name.split('/');
	return {
		full_name,
		name: parts[1] ?? full_name,
		owner: parts[0],
		url: `https://github.com/${full_name}`,
		updated_at: '2026-01-01T00:00:00Z',
		private: false,
		archived: false,
		default_branch: 'main',
		added: false,
		stars: null,
		...over
	};
};

// a cache the size of a real one: more rows than the no-query window shows,
// named so localeCompare and the eye agree on their order
const many = (n: number): GithubRepo[] =>
	Array.from({ length: n }, (_, i) => repo(`org/r${String(i).padStart(2, '0')}`));

const names = (rows: GithubRepo[]): string[] => rows.map(r => r.full_name);

// a fresh copy of the module standing on a named desktop. doMock +
// resetModules + dynamic import rather than a file-level vi.mock, because the
// rest of the file wants the real (all-false) platform and a hoisted mock
// would take that case away
type Platform = { isMac: boolean; isWindows: boolean; isLinux: boolean };
const MAC: Platform = { isMac: true, isWindows: false, isLinux: false };
const WINDOWS: Platform = { isMac: false, isWindows: true, isLinux: false };
const LINUX: Platform = { isMac: false, isWindows: false, isLinux: true };

const onPlatform = async (p: Platform) => {
	vi.resetModules();
	vi.doMock('./platform', () => p);
	return await import('./github');
};

// one fixed instant, in UTC so it is the same instant on every machine
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0); // 2026-01-01T12:00:00.000Z
const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;
const W = 7 * D;
// the module's own week→month divisor is 4.348, so its month is 30.436 days
// and its year is twelve of those — 365.232 days, not 365. both land on whole
// milliseconds (4.348 * 604800000 === 2629670400 exactly), so these constants
// are the real thresholds and not approximations of them
const MO = 4.348 * W;
const Y = 12 * MO;

// the RFC 3339 stamp gh would have written `ms` before NOW
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
// what the lane renders for a row last touched `ms` before NOW
const at = (ms: number): string => relativeTime(ago(ms), NOW);

afterEach(() => {
	vi.doUnmock('./platform');
	vi.resetModules();
	vi.useRealTimers();
});

describe('GH_INSTALL — one install line per desktop', () => {
	it('falls back to the apt line on a desktop the user agent does not name', () => {
		// jsdom is that desktop. this is not "windows is apt" — isWindows is
		// false here, and the ternary has no unknown branch of its own
		expect(GH_INSTALL).toBe('sudo apt install gh');
	});

	it('names each desktop package manager once, and computes the line at import', async () => {
		expect((await onPlatform(MAC)).GH_INSTALL).toBe('brew install gh');
		expect((await onPlatform(WINDOWS)).GH_INSTALL).toBe(
			'winget install GitHub.cli'
		);
		expect((await onPlatform(LINUX)).GH_INSTALL).toBe('sudo apt install gh');
		// a const, not a function: the string the lane heading and the Settings
		// panel both print is decided once, off a user agent that cannot change
		expect(typeof GH_INSTALL).toBe('string');
	});
});

describe('RECENT_LIMIT — the no-query page size', () => {
	it('is twenty, and is the cap on both the flat list and the ungrouped tail', () => {
		expect(RECENT_LIMIT).toBe(20);
		const list = many(25);
		expect(visibleRepos(list, '')).toHaveLength(RECENT_LIMIT);
		const tail = laneSections(list, [])[0];
		expect(tail.rows).toHaveLength(RECENT_LIMIT);
		// the cap is on what is SHOWN, never on what is counted
		expect(tail.total).toBe(25);
	});
});

describe('visibleRepos — the rows an empty and a typed box show', () => {
	it('shows the newest RECENT_LIMIT with an empty box, in cache order', () => {
		// the cache arrives newest-first (rust sorts before it writes), so the
		// no-query case is a slice and must not re-sort: r00 stays first
		const list = many(25);
		const out = visibleRepos(list, '');
		expect(names(out)[0]).toBe('org/r00');
		expect(names(out)[out.length - 1]).toBe('org/r19');
		// the same objects, not copies — the lane keys rows by identity
		expect(out[0]).toBe(list[0]);
	});

	it('treats a box holding only whitespace as an empty box', () => {
		const list = many(25);
		const empty = visibleRepos(list, '');
		expect(visibleRepos(list, '   ')).toEqual(empty);
		expect(visibleRepos(list, '\t\n')).toEqual(empty);
	});

	it('reaches every repo once you type, past the recent window', () => {
		// this is the whole design: twenty rows is the default view, not the
		// list. r24 is invisible with an empty box and findable by typing
		const list = many(25);
		expect(names(visibleRepos(list, ''))).not.toContain('org/r24');
		expect(names(visibleRepos(list, 'r24'))).toEqual(['org/r24']);
	});

	it('matches the owner too, because it scores the full name and not the bare name', () => {
		const list = [repo('vercel/next.js'), repo('facebook/react')];
		// 'verc' is nowhere in the bare name "next.js"
		expect(names(visibleRepos(list, 'verc'))).toEqual(['vercel/next.js']);
		// and 'org/' style queries work for the same reason
		expect(names(visibleRepos(list, 'facebook/'))).toEqual(['facebook/react']);
	});

	it('puts the better match first', () => {
		const list = [repo('me/notes-editor'), repo('me/devgo')];
		// 'devgo' is a contiguous word-start run in one and a scatter in the
		// other; the order is the contract, the numbers are not
		expect(names(visibleRepos(list, 'devgo'))[0]).toBe('me/devgo');
	});

	it('breaks a scoring tie on the full name, so the order never depends on the cache', () => {
		// both names put "tool" on a word start after the slash with the same
		// three adjacencies, so the matcher cannot separate them — asserted
		// rather than assumed, because the tie is what this test is about
		const a = repo('mango/tool');
		const b = repo('banjo/tool');
		expect(fuzzyScore('tool', a.full_name)).toBe(fuzzyScore('tool', b.full_name));
		expect(names(visibleRepos([a, b], 'tool'))).toEqual([
			'banjo/tool',
			'mango/tool'
		]);
		// handed in the other order, the same answer
		expect(names(visibleRepos([b, a], 'tool'))).toEqual([
			'banjo/tool',
			'mango/tool'
		]);
	});

	it('drops every repo the matcher refuses, and may answer with nothing', () => {
		const list = [repo('me/devgo'), repo('me/notes')];
		expect(visibleRepos(list, 'zzz')).toEqual([]);
		// 'ogved' is not a subsequence of either name, only an anagram of one
		expect(visibleRepos(list, 'ogved')).toEqual([]);
		expect(visibleRepos([], 'anything')).toEqual([]);
		expect(visibleRepos([], '')).toEqual([]);
	});

	it('trims the query before matching, so stray space cannot refuse a real hit', () => {
		const list = [repo('me/devgo')];
		expect(names(visibleRepos(list, ' devgo '))).toEqual(['me/devgo']);
		// …and only the outside: a space inside is a character the name must
		// hold, which is what makes a two-word query selective
		expect(visibleRepos(list, 'me devgo')).toEqual([]);
	});

	it('is case-insensitive on both sides', () => {
		const list = [repo('Vercel/Next.js')];
		expect(names(visibleRepos(list, 'vercel'))).toEqual(['Vercel/Next.js']);
		expect(names(visibleRepos(list, 'NEXT'))).toEqual(['Vercel/Next.js']);
	});

	it('never reorders or mutates the cache it was handed', () => {
		const list = many(5);
		const before = names(list);
		visibleRepos(list, 'r0');
		visibleRepos(list, '');
		expect(names(list)).toEqual(before);
	});
});

describe('compactCount — a star count as a magnitude', () => {
	it('prints anything under a thousand verbatim', () => {
		expect(compactCount(0)).toBe('0');
		expect(compactCount(1)).toBe('1');
		expect(compactCount(7)).toBe('7');
		expect(compactCount(999)).toBe('999');
	});

	it('switches to k at exactly a thousand, and shows one decimal even when it is zero', () => {
		// 999 → 1.0k is the unit change, and `1.0k` — not `1k` — is what the
		// row renders for a repo with exactly a thousand stars
		expect(compactCount(999)).toBe('999');
		expect(compactCount(1000)).toBe('1.0k');
		expect(compactCount(2000)).toBe('2.0k');
		expect(compactCount(8134)).toBe('8.1k');
	});

	it('drops the decimal at exactly ten thousand, and never shows one above it', () => {
		expect(compactCount(9999)).toBe('10.0k');
		expect(compactCount(10000)).toBe('10k');
		expect(compactCount(95000)).toBe('95k');
		// so the digit count jumps 10.0k → 10k at the boundary: the number
		// grows by one star and the string gets SHORTER
		expect(compactCount(10000).length).toBeLessThan(compactCount(9999).length);
	});

	it('rounds rather than truncates, on the value the double actually holds', () => {
		// toFixed rounds, so the top of each band can read as the bottom of the
		// next: 9999 stars render "10.0k" while 10000 render "10k"
		expect(compactCount(1049)).toBe('1.0k');
		expect(compactCount(1050)).toBe('1.1k'); // 1.05 is above .05 as a double
		expect(compactCount(9949)).toBe('9.9k');
		expect(compactCount(9950)).toBe('9.9k'); // 9.95 is BELOW .95 as a double
		expect(compactCount(10499)).toBe('10k');
		expect(compactCount(10500)).toBe('11k'); // 10.5 is exact, and rounds up
	});

	it('has no unit above k, so a million stars read as 1000k', () => {
		// the real ceiling of this function. there is no M/B branch at all:
		// react (~240k) reads fine, freeCodeCamp (~430k) reads fine, and
		// anything past a million reads as a four-digit k
		expect(compactCount(999499)).toBe('999k');
		expect(compactCount(999500)).toBe('1000k');
		expect(compactCount(1000000)).toBe('1000k');
		expect(compactCount(1500000)).toBe('1500k');
		expect(compactCount(1000000000)).toBe('1000000k');
	});

	it('prints zero and every negative verbatim, because the k branch needs a thousand or more', () => {
		// a star count is never negative — the guard is `n >= 1000`, so the
		// whole negative axis falls to String(n) and a nonsense value stays
		// readable instead of becoming "-5.0k"
		expect(compactCount(-1)).toBe('-1');
		expect(compactCount(-999)).toBe('-999');
		expect(compactCount(-5000)).toBe('-5000');
		expect(compactCount(-1000000)).toBe('-1000000');
	});

	it('passes a fraction straight through below the boundary and folds it in above', () => {
		expect(compactCount(999.4)).toBe('999.4');
		expect(compactCount(1000.4)).toBe('1.0k');
	});
});

describe('laneSections — the sections the lane shows with no query', () => {
	it('returns the ungrouped tail alone when there are no groups', () => {
		const list = many(3);
		const sections = laneSections(list, []);
		expect(sections).toHaveLength(1);
		expect(sections[0].group).toBeNull();
		expect(names(sections[0].rows)).toEqual(names(list));
		expect(sections[0].total).toBe(3);
		expect(sections[0].gone.size).toBe(0);
	});

	it('always ends with the tail, and emits exactly one section per group plus it', () => {
		const list = many(3);
		const groups: GithubGroup[] = [
			{ name: 'work', repos: ['org/r00'] },
			{ name: 'toys', repos: ['org/r01'] }
		];
		const sections = laneSections(list, groups);
		expect(sections).toHaveLength(groups.length + 1);
		expect(sections.map(s => s.group)).toEqual(['work', 'toys', null]);
		// even with every repo grouped, the tail section still exists — empty
		const all = laneSections(list, [
			{ name: 'all', repos: names(list) }
		]);
		expect(all).toHaveLength(2);
		expect(all[1].rows).toEqual([]);
		expect(all[1].total).toBe(0);
	});

	it('keeps a group in the order the group declares, not the order the cache has', () => {
		const list = many(3); // r00, r01, r02
		const sections = laneSections(list, [
			{ name: 'work', repos: ['org/r02', 'org/r00'] }
		]);
		expect(names(sections[0].rows)).toEqual(['org/r02', 'org/r00']);
	});

	it('never truncates a group, and reports its total as its own row count', () => {
		// RECENT_LIMIT is the tail's cap, not a group's: a group of 25 shows 25
		const list = many(25);
		const sections = laneSections(list, [
			{ name: 'everything', repos: names(list) }
		]);
		expect(sections[0].rows).toHaveLength(25);
		expect(sections[0].total).toBe(sections[0].rows.length);
	});

	it('caps the tail at RECENT_LIMIT while reporting how many ungrouped repos exist', () => {
		const list = many(25);
		const sections = laneSections(list, [{ name: 'work', repos: ['org/r00'] }]);
		const tail = sections[1];
		expect(tail.rows).toHaveLength(RECENT_LIMIT);
		// 24 ungrouped, 20 shown — the count the lane prints as "20 of 24"
		expect(tail.total).toBe(24);
		expect(names(tail.rows)).not.toContain('org/r00');
		expect(names(tail.rows)[0]).toBe('org/r01');
	});

	it('keeps a grouped repo out of the tail, and lets it sit in two groups at once', () => {
		const list = many(2);
		const sections = laneSections(list, [
			{ name: 'a', repos: ['org/r00'] },
			{ name: 'b', repos: ['org/r00'] }
		]);
		expect(names(sections[0].rows)).toEqual(['org/r00']);
		expect(names(sections[1].rows)).toEqual(['org/r00']);
		// the same object in both places, and gone from the tail
		expect(sections[0].rows[0]).toBe(sections[1].rows[0]);
		expect(names(sections[2].rows)).toEqual(['org/r01']);
	});

	it('keeps a duplicate inside one group and counts it twice', () => {
		// nothing de-duplicates a group's own list, so a name added twice
		// renders twice; the lane's keys are full_names, so this is worth knowing
		const sections = laneSections(many(1), [
			{ name: 'work', repos: ['org/r00', 'org/r00'] }
		]);
		expect(names(sections[0].rows)).toEqual(['org/r00', 'org/r00']);
		expect(sections[0].total).toBe(2);
	});

	it('builds a placeholder row for a name the cache no longer carries, and lists it in gone', () => {
		const sections = laneSections(many(1), [
			{ name: 'work', repos: ['org/r00', 'ghost/gone'] }
		]);
		const [work, tail] = sections;
		expect(names(work.rows)).toEqual(['org/r00', 'ghost/gone']);
		// the set names ONLY the missing one — a present row is never in it
		expect(Array.from(work.gone)).toEqual(['ghost/gone']);
		expect(work.total).toBe(2);
		// the tail's gone set is always empty: every tail row came from the cache
		expect(tail.gone.size).toBe(0);
	});

	it('gives the placeholder a full GithubRepo shape so every menu and key still works', () => {
		const sections = laneSections([], [{ name: 'work', repos: ['owner/thing'] }]);
		expect(sections[0].rows[0]).toEqual({
			full_name: 'owner/thing',
			name: 'thing',
			owner: 'owner',
			url: 'https://github.com/owner/thing',
			updated_at: '',
			private: false,
			archived: false,
			default_branch: null,
			added: false,
			stars: null
		});
		// its empty updated_at is what relativeTime answers '' for, so the row
		// renders with no timestamp rather than with "56 y ago"
		expect(relativeTime(sections[0].rows[0].updated_at, NOW)).toBe('');
	});

	it('splits a placeholder name on the first slash only, and makes a bare name its own owner', () => {
		// documented, not endorsed. `const [owner = '', name = full_name]` reads
		// two elements: a name with no slash lands owner === the whole string,
		// and a third segment is dropped from `name` while the url keeps it
		const bare = laneSections([], [{ name: 'g', repos: ['solo'] }])[0].rows[0];
		expect(bare.owner).toBe('solo');
		expect(bare.name).toBe('solo');

		const deep = laneSections([], [{ name: 'g', repos: ['a/b/c'] }])[0].rows[0];
		expect(deep.owner).toBe('a');
		expect(deep.name).toBe('b');
		expect(deep.url).toBe('https://github.com/a/b/c');
	});

	it('handles an empty group and an empty cache without inventing a section', () => {
		expect(laneSections([], [])).toHaveLength(1);
		const sections = laneSections([], [{ name: 'empty', repos: [] }]);
		expect(sections[0].rows).toEqual([]);
		expect(sections[0].total).toBe(0);
		expect(sections[0].gone.size).toBe(0);
	});

	it('never mutates the cache or the groups it was handed', () => {
		const list = many(3);
		const groups: GithubGroup[] = [{ name: 'work', repos: ['org/r02'] }];
		laneSections(list, groups);
		expect(names(list)).toEqual(['org/r00', 'org/r01', 'org/r02']);
		expect(groups).toEqual([{ name: 'work', repos: ['org/r02'] }]);
	});
});

describe('relativeTime — coarse on purpose', () => {
	it('takes the clock as an argument, so no assertion here depends on today', () => {
		// the injectable `now` is why this whole describe is deterministic
		expect(relativeTime(ago(3 * H), NOW)).toBe('3 h ago');
		expect(relativeTime(ago(3 * H), NOW + 2 * D)).toBe('2 d ago');
	});

	it('reads the real clock per call when the caller passes no now', () => {
		// the default argument is evaluated on every call, not captured at
		// import — so the same stamp ages as the app sits open
		vi.useFakeTimers();
		vi.setSystemTime(new Date(NOW));
		expect(relativeTime(ago(2 * H))).toBe('2 h ago');
		vi.setSystemTime(new Date(NOW + 5 * D));
		expect(relativeTime(ago(2 * H))).toBe('5 d ago');
	});

	it('calls anything under forty-five seconds just now', () => {
		expect(at(0)).toBe('just now');
		expect(at(1)).toBe('just now');
		expect(at(44 * S)).toBe('just now');
		expect(at(44999)).toBe('just now');
	});

	it('starts counting seconds at exactly forty-five, and rounds the top up to 60 s', () => {
		expect(at(45 * S)).toBe('45 s ago');
		expect(at(59 * S)).toBe('59 s ago');
		// Math.round, so the last half-second of the minute prints the next
		// unit's own size: "60 s ago" is a real string this function emits
		expect(at(59499)).toBe('59 s ago');
		expect(at(59500)).toBe('60 s ago');
		expect(at(59999)).toBe('60 s ago');
	});

	it('switches from seconds to minutes at exactly one minute, and rounds up to 60 min', () => {
		expect(at(60 * S)).toBe('1 min ago');
		expect(at(89 * S)).toBe('1 min ago');
		expect(at(90 * S)).toBe('2 min ago');
		expect(at(59 * MIN + 29 * S)).toBe('59 min ago');
		expect(at(59 * MIN + 30 * S)).toBe('60 min ago');
		expect(at(H - 1)).toBe('60 min ago');
	});

	it('switches from minutes to hours at exactly one hour, and rounds up to 24 h', () => {
		expect(at(H)).toBe('1 h ago');
		expect(at(H + 29 * MIN)).toBe('1 h ago');
		expect(at(H + 30 * MIN)).toBe('2 h ago');
		expect(at(23 * H + 29 * MIN)).toBe('23 h ago');
		expect(at(23 * H + 30 * MIN)).toBe('24 h ago');
		expect(at(D - 1)).toBe('24 h ago');
	});

	it('switches from hours to days at exactly one day, and rounds up to 7 d', () => {
		expect(at(D)).toBe('1 d ago');
		expect(at(6 * D + 11 * H)).toBe('6 d ago');
		expect(at(6 * D + 12 * H)).toBe('7 d ago');
		expect(at(W - 1)).toBe('7 d ago');
	});

	it('switches from days to weeks at exactly seven days', () => {
		expect(at(W)).toBe('1 w ago');
		expect(at(2 * W)).toBe('2 w ago');
		expect(at(4 * W)).toBe('4 w ago');
	});

	it('switches from weeks to months at 30.436 days, so it never prints 5 w', () => {
		// the divisor is 4.348 weeks, and the week band rounds — the largest
		// value it can reach is round(4.347…) = 4, so "5 w ago" is unreachable
		expect(at(MO - 1)).toBe('4 w ago');
		expect(at(MO)).toBe('1 mo ago');
		expect(at(MO - 60 * S)).toBe('4 w ago');
	});

	it('switches from months to years at 365.232 days, after printing 12 mo first', () => {
		// twelve of its own 30.436-day months, which is 365.232 days: a stamp
		// from exactly one calendar year ago still reads "12 mo ago"
		expect(at(11 * MO)).toBe('11 mo ago');
		expect(at(Y - 1)).toBe('12 mo ago');
		expect(at(365 * D)).toBe('12 mo ago');
		expect(at(Y)).toBe('1 y ago');
	});

	it('rounds years and never reaches a larger unit', () => {
		expect(at(Math.round(Y * 1.49))).toBe('1 y ago');
		expect(at(Math.round(Y * 1.5))).toBe('2 y ago');
		expect(at(10 * Y)).toBe('10 y ago');
		// the docstring's point: past a couple of years the string is as
		// useful as the date, and it keeps counting rather than saturating
		expect(at(56 * Y)).toBe('56 y ago');
	});

	it('answers an empty string for any stamp it cannot parse', () => {
		// including the placeholder row's '' — that is the reason for the guard
		expect(relativeTime('', NOW)).toBe('');
		expect(relativeTime('not a date', NOW)).toBe('');
		expect(relativeTime('2026-13-45T99:99:99Z', NOW)).toBe('');
		expect(relativeTime(Number.NaN, NOW)).toBe('');
	});

	it('honours an explicit utc offset in the stamp instead of assuming Z', () => {
		// 09:00+03:00 is 06:00Z, six hours before NOW. no test here parses a
		// stamp with NO zone: that one is local time by spec, so its answer
		// would depend on the machine's timezone
		expect(relativeTime('2026-01-01T09:00:00+03:00', NOW)).toBe('6 h ago');
		expect(relativeTime('2026-01-01T09:00:00Z', NOW)).toBe('3 h ago');
	});

	it('reads a number as unix seconds, which is what the cache stores', () => {
		// GithubCache.fetched_at is unix SECONDS; ClonePicker and Settings hand
		// that number straight in
		expect(relativeTime(NOW / 1000 - 2 * 3600, NOW)).toBe('2 h ago');
		// …so a caller passing milliseconds by mistake describes a date ~55000
		// years out, which clamps to 'just now' instead of reading as an error
		expect(relativeTime(NOW - 2 * H, NOW)).toBe('just now');
		// and 0 — the cache's "never fetched" sentinel — is the epoch, not a
		// blank. every caller but TrafficPopover guards `fetched_at > 0`
		expect(relativeTime(0, NOW)).toBe('56 y ago');
	});

	it('clamps a stamp ahead of now to just now instead of counting backwards', () => {
		// clock skew between this machine and GitHub's API is routine, and
		// Math.max(0, …) is what stops "-3 h ago" ever rendering
		expect(at(-1)).toBe('just now');
		expect(at(-30 * S)).toBe('just now');
		expect(at(-5 * D)).toBe('just now');
		expect(at(-10 * Y)).toBe('just now');
	});
});
