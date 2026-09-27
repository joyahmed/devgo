import { describe, expect, it } from 'vitest';
import { fuzzyScore, scoreCommand } from './palette';

// pure scoring: no DOM, no timers, no localStorage, no @tauri-apps import
// anywhere in this graph — so there is nothing to stub and nothing to reset
// between tests. every number below came out of the implementation, but the
// assertions are deliberately RELATIVE wherever the point is ranking: a suite
// that pins every bonus makes the scorer unrefactorable, and "ote beats a
// scatter" is the contract, not "ote is 13".
//
// hard numbers are used for three things only, where the number IS the
// contract: `null` for a non-match, `0` for an empty query, and the 0.9
// keyword weight.

const run = () => {};
// ids are noise to the scorer — it never reads `id` — so one is enough, and it
// lives in a const rather than inline in every literal
const ID = 'probe';
const cmd = (over: Partial<PaletteCommand> & { title: string }): PaletteCommand => ({
	id: ID,
	run,
	...over
});

// `null` is a match/no-match verdict, not a low score, so it can never be
// compared with toBeGreaterThan. every ordering assertion goes through this so
// a regression that starts returning null reads as a failure here and not as a
// confusing NaN comparison
const scored = (q: string, t: string): number => {
	const s = fuzzyScore(q, t);
	expect(s).not.toBeNull();
	return s as number;
};

describe('fuzzyScore — match or no match', () => {
	it('orders an exact hit above a prefix above a scatter, and refuses a non-match', () => {
		const t = 'Open terminal';
		const exact = scored('open terminal', t);
		const prefix = scored('open', t);
		const scatter = scored('otl', t); // o … t … l, three words apart

		expect(exact).toBeGreaterThan(prefix);
		expect(prefix).toBeGreaterThan(scatter);
		// a letter the text does not hold at all, and a letter it holds only
		// BEFORE the previous match — both are simply not subsequences
		expect(fuzzyScore('zzz', t)).toBeNull();
		expect(fuzzyScore('lo', t)).toBeNull();
		// and a query longer than the text can never be consumed
		expect(fuzzyScore('terminals', 'terminal')).toBeNull();
	});

	it('is case-insensitive on both sides, and lowercases nothing else', () => {
		const mixed = fuzzyScore('OpEn', 'oPeN terminal');
		expect(mixed).toBe(fuzzyScore('open', 'open terminal'));
		expect(mixed).toBe(fuzzyScore('OPEN', 'OPEN TERMINAL'));
	});

	it('answers 0 for an empty query and null for an empty candidate', () => {
		// 0, not null: the empty query matches everything, so the caller keeps
		// the row. 0 is falsy, which is why the palette tests `!== null` and
		// never the truthiness of a score
		expect(fuzzyScore('', 'Open terminal')).toBe(0);
		expect(fuzzyScore('', '')).toBe(0);
		// nothing to walk, so nothing can be consumed
		expect(fuzzyScore('a', '')).toBeNull();
	});
});

describe('fuzzyScore — the two bonuses', () => {
	it('pays a word start, and counts exactly six characters as one', () => {
		// the class is /[\s\-_/.:]/ — whitespace, hyphen, underscore, slash,
		// dot, colon. a comma is NOT a word break here, which is worth pinning
		// because it looks like one to a reader
		const plain = scored('b', 'ab');
		for (const sep of [' ', '\t', '\n', '-', '_', '/', '.', ':']) {
			expect(scored('b', `a${sep}b`)).toBeGreaterThan(plain);
		}
		expect(scored('b', 'a,b')).toBe(plain);
		// index 0 counts as a word start too, with no separator in front of it
		expect(scored('a', 'ab')).toBeGreaterThan(plain);
	});

	it('pays more for every further contiguous letter, so the run grows faster than its length', () => {
		const two = scored('co', 'Configure roots');
		const four = scored('conf', 'Configure roots');
		// superlinear, not additive: each adjacency is worth more than the last
		expect(four).toBeGreaterThan(2 * two);
	});

	it('ranks a contiguous pair above the same two letters spread out', () => {
		expect(scored('cr', 'Create')).toBeGreaterThan(scored('cr', 'Clear'));
	});

	it('ranks a word-start prefix above the same letters buried mid-word', () => {
		expect(scored('op', 'Open Settings')).toBeGreaterThan(scored('op', 'Stop it'));
	});

	it('ranks an acronym across word starts above a contiguous hit mid-word', () => {
		// this is the bonus balance in one line: two word starts (the letters
		// you would actually type) beat an adjacent pair nobody aimed at
		expect(scored('ct', 'Configure toolchain')).toBeGreaterThan(
			scored('ct', 'Select target')
		);
		// and the docstring's own example: `ote` on a word-start scatter beats
		// the same letters inside one word
		expect(scored('ote', 'Open terminal')).toBeGreaterThan(
			scored('ote', 'Notes editor')
		);
	});
});

describe('fuzzyScore — greedy, leftmost, no backtracking', () => {
	it('spends each query letter on its first occurrence even when a later one scores far better', () => {
		// documented, not endorsed. 'rec' on "Reopen recent" is consumed as
		// R-e-open re[c]ent — the r and e go to the FIRST word, so the c lands
		// mid-word with no streak and no word start. matching the second word
		// instead would have been a contiguous word-start run
		const split = scored('rec', 'Reopen recent');
		const whole = scored('rec', 'Recent');
		expect(split).toBeLessThan(whole);
		// the sharp edge: putting a partially-matching word IN FRONT of a
		// perfect match makes the title score worse than the bare word did
		expect(scored('ab', 'a ab')).toBeLessThan(scored('ab', 'ab'));
	});
});

describe('scoreCommand — the fields it reads', () => {
	it('scores the title, and reads no other string on the command', () => {
		// title only. subtitle, hint and id are display and bookkeeping — none
		// of them is searchable, which is the answer to "why can I not find
		// this by its subtitle"
		const c = cmd({
			title: 'Open Settings',
			subtitle: 'theme, roots and shortcuts',
			hint: 'CTRL+COMMA'
		});
		expect(scoreCommand('set', c)).toBe(fuzzyScore('set', 'Open Settings'));
		expect(scoreCommand('shortcuts', c)).toBeNull(); // subtitle
		expect(scoreCommand('ctrl', c)).toBeNull(); // hint
		expect(scoreCommand(ID, c)).toBeNull(); // id
	});

	it('matches a keyword the title cannot, at nine tenths of the weight', () => {
		const c = cmd({ title: 'Refresh projects', keywords: ['rescan'] });
		const direct = scored('rescan', 'rescan');
		expect(fuzzyScore('rescan', 'Refresh projects')).toBeNull();
		// the weight is the contract, so here the number is asserted
		expect(scoreCommand('rescan', c)).toBe(direct * 0.9);
	});

	it('keeps the title score when the title and a keyword would score the same', () => {
		// the tie-break the implementation performs: `Math.max(title, kw*0.9)`,
		// and 0.9 < 1, so an alias never displaces an identical title hit
		const title = 'Open terminal';
		const c = cmd({ title, keywords: [title] });
		expect(scoreCommand(title, c)).toBe(fuzzyScore(title, title));
	});

	it('lets a strong keyword outrank a weak title hit', () => {
		// 'resc' IS a subsequence of "Refresh projects" — scattered — and a
		// contiguous word-start run in the alias. the alias wins even after the
		// 0.9, which is the whole point of having aliases
		const c = cmd({ title: 'Refresh projects', keywords: ['rescan'] });
		const titleOnly = scored('resc', 'Refresh projects');
		expect(scoreCommand('resc', c)).toBeGreaterThan(titleOnly);
	});

	it('takes the best keyword, not the first one that matches', () => {
		const best = cmd({ title: 'Zzz', keywords: ['ab', 'a b'] });
		const reversed = cmd({ title: 'Zzz', keywords: ['a b', 'ab'] });
		// 'ab' is contiguous in "ab" but lands on a word start in "a b", and
		// the word start is worth more than the adjacency. declaration order
		// must not change the answer
		expect(scored('ab', 'a b')).toBeGreaterThan(scored('ab', 'ab'));
		expect(scoreCommand('ab', best)).toBe(scoreCommand('ab', reversed));
		expect(scoreCommand('ab', best)).toBe(scored('ab', 'a b') * 0.9);
	});

	it('can return a fractional score, so callers may only compare scores', () => {
		// 0.9 × an odd integer. nothing may round or bucket this: the palette
		// sorts on it and shows none of it
		const c = cmd({ title: 'Zzz', keywords: ['recent'] });
		const s = scoreCommand('rec', c) as number;
		expect(Number.isInteger(s)).toBe(false);
		expect(s).toBeCloseTo(scored('rec', 'recent') * 0.9, 10);
	});

	it('returns null when nothing matches, and treats no keywords as no keywords', () => {
		expect(scoreCommand('zzz', cmd({ title: 'Refresh projects' }))).toBeNull();
		expect(scoreCommand('term', cmd({ title: 'Refresh' }))).toBeNull();
		expect(scoreCommand('term', cmd({ title: 'Refresh', keywords: [] }))).toBeNull();
		// a matching keyword rescues a command whose title has no hope
		expect(
			scoreCommand('term', cmd({ title: 'Refresh', keywords: ['terminal'] }))
		).not.toBeNull();
	});

	it('answers 0 for a blank query without looking at the command at all', () => {
		// the gate is `query.trim()`, so a box holding spaces is an empty box —
		// every command survives with the same score, and the palette shows its
		// own order (recents first) instead of a scoring of whitespace
		const c = cmd({ title: 'Open terminal' });
		expect(scoreCommand('', c)).toBe(0);
		expect(scoreCommand('   ', c)).toBe(0);
		expect(scoreCommand('\t\n', c)).toBe(0);
		expect(scoreCommand('   ', cmd({ title: '' }))).toBe(0);
	});

	it('trims the query it matches with, so surrounding space cannot refuse a real hit', () => {
		// one trim serves both the blank gate and the scan, so the string that
		// decides "is this blank" is the string handed to fuzzyScore. before
		// this, a leading space was a character the text had to contain AFTER
		// it — "Open terminal" holds its only 'o' BEFORE its only space, so
		// ' open' scored null while 'open' scored well. the palette never saw
		// it only because CommandPalette hands over an already-trimmed query
		const c = cmd({ title: 'Open terminal' });
		const bare = scoreCommand('open', c);
		expect(bare).not.toBeNull();
		// leading, trailing and both — all three are the bare query
		expect(scoreCommand(' open', c)).toBe(bare);
		expect(scoreCommand('open ', c)).toBe(bare);
		expect(scoreCommand('  open  ', c)).toBe(bare);
		expect(scoreCommand('\topen\n', c)).toBe(bare);

		// …and only the OUTSIDE is trimmed. a space between words is a real
		// character the title must hold, which is what makes a multi-word query
		// selective at all. the number is pinned here because the point is that
		// it did not move: 'open term' scored 89 before the trim and after it
		expect(scoreCommand('open term', c)).toBe(89);
		expect(scoreCommand('open term', c)).toBe(
			fuzzyScore('open term', 'Open terminal')
		);
		expect(scoreCommand('open term', cmd({ title: 'Openterminal' }))).toBeNull();

		// and a query that is nothing BUT whitespace still trims away to blank,
		// which is still 0 — the gate's answer is unchanged
		expect(scoreCommand('   ', c)).toBe(0);
		expect(scoreCommand('\t\n', c)).toBe(0);
	});
});

describe('scoreCommand — the ranking a real deck produces', () => {
	// the palette's own pipeline: score, drop the nulls, best first. sort is
	// stable in every engine this ships on, so equal scores keep deck order
	const rank = (query: string, deck: PaletteCommand[]): string[] =>
		deck
			.map(c => ({ c, s: scoreCommand(query, c) }))
			.filter((x): x is { c: PaletteCommand; s: number } => x.s !== null)
			.sort((a, b) => b.s - a.s)
			.map(x => x.c.title);

	const deck: PaletteCommand[] = [
		cmd({ title: 'Refresh projects', keywords: ['rescan', 'reload'] }),
		cmd({ title: 'Open Settings', keywords: ['preferences', 'config'] }),
		cmd({ title: 'Configure roots' }),
		cmd({ title: 'Clone from GitHub' }),
		cmd({ title: 'Open terminal' })
	];

	it('puts the title hit first, the alias hit next, and the scatter last', () => {
		// the alias for "Open Settings" is 'config' — the SAME letters as the
		// winner's title hit, docked 10% — so it lands between the title that
		// earned it and a row that only happens to hold c-o-n-f
		expect(rank('conf', deck)).toEqual([
			'Configure roots',
			'Open Settings',
			'Clone from GitHub'
		]);
	});

	it('finds one command by its alias alone and drops the rest', () => {
		// 'rescan' is on no title in the deck
		expect(rank('rescan', deck)).toEqual(['Refresh projects']);
	});

	it('ranks a word-start acronym above every mid-word scatter, and the scatters tie', () => {
		// 'ot' is the acronym of "Open terminal" — both letters on a word start.
		// "Open Settings" gets one word start and a buried t. the other three
		// hold nothing but buried letters, so all three score identically and
		// the stable sort leaves them in deck order
		expect(rank('ot', deck)).toEqual([
			'Open terminal',
			'Open Settings',
			'Refresh projects',
			'Configure roots',
			'Clone from GitHub'
		]);
	});

	it('keeps deck order between rows that tie', () => {
		// 'open' hits both "Open …" titles identically — same letters, same
		// positions, same bonuses — so the only thing separating them is the
		// order they were handed in, and the sort must not shuffle them
		expect(scoreCommand('open', deck[1])).toBe(scoreCommand('open', deck[4]));
		expect(rank('open', deck).slice(0, 2)).toEqual([
			'Open Settings',
			'Open terminal'
		]);
	});

	it('returns every command when the query is blank', () => {
		expect(rank('  ', deck)).toHaveLength(deck.length);
	});
});
