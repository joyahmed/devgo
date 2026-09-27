import { describe, expect, it } from 'vitest';
import { curate, ETC_CURATED, isEtc } from './etcCuration';

// pure: no DOM, no timers, nothing to reset. the module decides what the /etc
// row of the file manager shows, and the same answer drives both what renders
// and what the keyboard walks — so the *order* and the *count* are as much the
// contract as the membership.
//
// ETC_CURATED's contents are deliberately NOT asserted one by one: the list is
// a judgement call that will grow. What is asserted is the shape every entry
// has to keep for `curate` to be able to match it at all.

const folder = (name: string, parent = '/etc'): RemoteFolder => ({
	name,
	path: `${parent}/${name}`,
	root: parent
});

const names = (fs: RemoteFolder[]) => fs.map(f => f.name);

describe('ETC_CURATED — the list curate matches against', () => {
	it('lists every folder once', () => {
		expect(new Set(ETC_CURATED).size).toBe(ETC_CURATED.length);
	});

	it('holds bare folder names only — no slash, no leading dot-dot, nothing empty', () => {
		// curate compares against `f.name`, which is one path segment. an entry
		// with a slash or a trailing separator in it could never match, and
		// would silently hide the folder it was added to show
		for (const name of ETC_CURATED) {
			expect(name, name).not.toBe('');
			expect(name, name).not.toMatch(/[\\/]/);
			expect(name, name).toBe(name.trim());
		}
	});

	it('is lowercase throughout, because the match is case-sensitive', () => {
		for (const name of ETC_CURATED) expect(name, name).toBe(name.toLowerCase());
	});

	it('is not empty — an empty list would curate /etc down to nothing', () => {
		expect(ETC_CURATED.length).toBeGreaterThan(0);
	});
});

describe('isEtc — only /etc itself is curated', () => {
	it('is true for /etc, with or without trailing separators', () => {
		expect(isEtc('/etc')).toBe(true);
		expect(isEtc('/etc/')).toBe(true);
		expect(isEtc('/etc///')).toBe(true);
	});

	it('is false inside /etc, where everything is the point', () => {
		expect(isEtc('/etc/nginx')).toBe(false);
		expect(isEtc('/etc/nginx/sites-available')).toBe(false);
	});

	it('is false for a path that merely ends in etc, and for a relative one', () => {
		expect(isEtc('/usr/local/etc')).toBe(false);
		expect(isEtc('etc')).toBe(false);
		expect(isEtc('')).toBe(false);
		expect(isEtc('/')).toBe(false);
	});

	it('is case-sensitive — this is a linux box', () => {
		expect(isEtc('/ETC')).toBe(false);
		expect(isEtc('/Etc')).toBe(false);
	});
});

describe('curate — the developer-relevant subset and what it hid', () => {
	const keep = ETC_CURATED[0];
	const also = ETC_CURATED[1];

	it('keeps the curated folders at /etc and counts the rest as hidden', () => {
		const folders = [folder(keep), folder('alternatives'), folder(also), folder('skel')];
		const [kept, hidden] = curate('/etc', folders, false);
		expect(names(kept)).toEqual([keep, also]);
		expect(hidden).toBe(2);
		// the two numbers always add back up to what the box listed
		expect(kept.length + hidden).toBe(folders.length);
	});

	it('keeps the listing’s own order, not the curated list’s', () => {
		// the keyboard walks this array, so reordering it would move the cursor
		const folders = [folder(also), folder('skel'), folder(keep)];
		const [kept] = curate('/etc', folders, false);
		expect(names(kept)).toEqual([also, keep]);
	});

	it('hands back everything and hides nothing once the user asks for all', () => {
		const folders = [folder(keep), folder('alternatives'), folder('skel')];
		const [kept, hidden] = curate('/etc', folders, true);
		expect(kept).toBe(folders);
		expect(hidden).toBe(0);
	});

	it('leaves a parent that is not /etc completely alone', () => {
		const folders = [
			folder('sites-available', '/etc/nginx'),
			folder('conf.d', '/etc/nginx')
		];
		// inside /etc/nginx every folder is the point, so nothing is curated
		const [kept, hidden] = curate('/etc/nginx', folders, false);
		expect(kept).toBe(folders);
		expect(hidden).toBe(0);
		expect(curate('/var/www', folders, false)[1]).toBe(0);
	});

	it('still curates when the parent carries a trailing slash', () => {
		const folders = [folder(keep), folder('skel')];
		expect(curate('/etc/', folders, false)[1]).toBe(1);
		expect(names(curate('/etc//', folders, false)[0])).toEqual([keep]);
	});

	it('hides nothing for an empty listing, at /etc or anywhere', () => {
		expect(curate('/etc', [], false)).toEqual([[], 0]);
		expect(curate('/var/www', [], false)).toEqual([[], 0]);
	});

	it('hides every folder when the box lists none the list knows', () => {
		const folders = [folder('skel'), folder('alternatives'), folder('default')];
		const [kept, hidden] = curate('/etc', folders, false);
		expect(kept).toEqual([]);
		expect(hidden).toBe(folders.length);
	});

	it('matches the name exactly and case-sensitively', () => {
		const folders = [
			folder(keep.toUpperCase()),
			folder(`${keep}.d`),
			folder(`my-${keep}`),
			folder(keep)
		];
		const [kept, hidden] = curate('/etc', folders, false);
		// only the exact name survives; a near miss is hidden, not kept
		expect(names(kept)).toEqual([keep]);
		expect(hidden).toBe(3);
	});

	it('counts a repeated name once per row', () => {
		const folders = [folder('skel'), folder('skel')];
		expect(curate('/etc', folders, false)[1]).toBe(2);
	});
});
