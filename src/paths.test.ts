import { describe, expect, it } from 'vitest';
import { lastSegment, namesOf, normalizePath, parentOf } from './paths';

// pure string work, no DOM and no platform branch — the functions never ask
// which OS they are on, which is exactly why they accept either separator.
//
// normalizePath is a MIRROR of the rust `paths::normalize`
// (src-tauri/src/services/platform/paths.rs:34), and the workspace store
// refuses a duplicate root by comparing its output. So the exact string is the
// contract here: a picker that normalises a root differently from the store
// offers something the add then rejects. The relative assertions are the two
// properties that keep that comparison honest — idempotence, and agreement
// between the two separators.

describe('normalizePath — the string the store compares', () => {
	it('turns every backslash into a forward slash', () => {
		expect(normalizePath('C:\\Users\\Dev\\code')).toBe('C:/Users/Dev/code');
		expect(normalizePath('/home/dev/code')).toBe('/home/dev/code');
	});

	it('drops trailing separators of either kind, however many', () => {
		expect(normalizePath('/home/dev/code/')).toBe('/home/dev/code');
		expect(normalizePath('C:\\code\\')).toBe('C:/code');
		expect(normalizePath('/home/dev///')).toBe('/home/dev');
	});

	it('answers / for a path that was nothing but separators', () => {
		// the fallback exists so the root never normalises to '', which would
		// read as "no root" and compare equal to every other empty answer
		expect(normalizePath('/')).toBe('/');
		expect(normalizePath('///')).toBe('/');
		expect(normalizePath('\\')).toBe('/');
		expect(normalizePath('')).toBe('/');
	});

	it('keeps the case, so two roots differing only in case stay two roots', () => {
		expect(normalizePath('C:/Code')).toBe('C:/Code');
		expect(normalizePath('C:/Code')).not.toBe(normalizePath('c:/code'));
	});

	it('keeps a UNC prefix, which is a leading double slash the store must not lose', () => {
		// \\wsl.localhost\Ubuntu-26.04\home\dev is how a wsl root reaches here;
		// interior duplicate slashes are NOT collapsed, only trailing ones
		expect(normalizePath('\\\\wsl.localhost\\Ubuntu-26.04\\home\\dev')).toBe(
			'//wsl.localhost/Ubuntu-26.04/home/dev'
		);
		expect(normalizePath('/home//dev')).toBe('/home//dev');
	});

	it('agrees with itself across the two separators and across a trailing one', () => {
		expect(normalizePath('C:\\a\\b\\')).toBe(normalizePath('C:/a/b'));
	});

	it('is idempotent — normalising an already normal path changes nothing', () => {
		for (const p of [
			'C:\\Users\\Dev\\',
			'/home/dev/code/',
			'\\\\wsl.localhost\\Ubuntu\\home',
			'///',
			''
		])
			expect(normalizePath(normalizePath(p)), p).toBe(normalizePath(p));
	});

	it('shortens a bare windows drive root to the drive letter — the rust does the same', () => {
		// 'C:\' → 'C:'. Odd as a path, but the two sides agree, and agreement is
		// what the duplicate check needs
		expect(normalizePath('C:\\')).toBe('C:');
		expect(normalizePath('C:/')).toBe('C:');
	});
});

describe('lastSegment — the name a workspace is recognised by', () => {
	it('takes the final segment, with either separator', () => {
		expect(lastSegment('/home/dev/code/devgo')).toBe('devgo');
		expect(lastSegment('C:\\Users\\Dev\\devgo')).toBe('devgo');
		expect(lastSegment('\\\\wsl.localhost\\Ubuntu-26.04\\home\\dev\\devgo')).toBe('devgo');
	});

	it('ignores trailing separators before deciding what the last segment is', () => {
		expect(lastSegment('/home/dev/devgo/')).toBe('devgo');
		expect(lastSegment('/home/dev/devgo///')).toBe('devgo');
		expect(lastSegment('C:\\devgo\\')).toBe('devgo');
	});

	it('hands back a bare name unchanged', () => {
		expect(lastSegment('devgo')).toBe('devgo');
	});

	it('handles mixed separators in one path', () => {
		expect(lastSegment('C:/Users\\Dev/devgo')).toBe('devgo');
	});

	it('answers the empty string for a path that has no segment at all', () => {
		// NOT the path itself: the `?? path` fallback is unreachable, because
		// split always yields at least one element. '/'.split → [''] → ''
		expect(lastSegment('/')).toBe('');
		expect(lastSegment('///')).toBe('');
		expect(lastSegment('')).toBe('');
		expect(lastSegment('\\')).toBe('');
	});
});

describe('parentOf — the folder a path sits in', () => {
	it('drops the last segment, with either separator', () => {
		expect(parentOf('/home/dev/code/devgo')).toBe('/home/dev/code');
		expect(parentOf('C:\\Users\\Dev\\devgo')).toBe('C:\\Users\\Dev');
	});

	it('keeps the separator style it was given rather than normalising it', () => {
		// parentOf is not normalizePath: a windows path comes back with
		// backslashes, so the answer can be shown or reused as-is
		expect(parentOf('C:\\a\\b')).toContain('\\');
		expect(parentOf('/a/b')).toBe('/a');
	});

	it('ignores trailing separators before taking the parent', () => {
		expect(parentOf('/home/dev/devgo/')).toBe('/home/dev');
		expect(parentOf('/home/dev/devgo///')).toBe('/home/dev');
		expect(parentOf('C:\\a\\b\\')).toBe('C:\\a');
	});

	it('returns the path itself once there is no parent left to name', () => {
		// a one-segment absolute path, a bare name and the root are all their
		// own parent — the caller walks up and stops instead of reaching ''
		expect(parentOf('/devgo')).toBe('/devgo');
		expect(parentOf('devgo')).toBe('devgo');
		expect(parentOf('/')).toBe('/');
		expect(parentOf('')).toBe('');
	});

	it('walking up from a deep path terminates at a fixed point', () => {
		let p = '/home/dev/code/devgo/src';
		const seen: string[] = [];
		for (let i = 0; i < 10; i++) {
			const up = parentOf(p);
			if (up === p) break;
			seen.push(up);
			p = up;
		}
		expect(seen).toEqual(['/home/dev/code/devgo', '/home/dev/code', '/home/dev', '/home']);
		// '/home' is its own parent, which is where the loop stopped
		expect(parentOf(p)).toBe(p);
	});
});

describe('namesOf — a list of roots as one glanceable phrase', () => {
	it('names one root on its own', () => {
		expect(namesOf(['/home/dev/devgo'])).toBe('devgo');
	});

	it('joins exactly two with the word and', () => {
		expect(namesOf(['/home/dev/devgo', '/home/dev/zetta'])).toBe('devgo and zetta');
	});

	it('names the first two and counts the rest from three up', () => {
		expect(namesOf(['/a/one', '/a/two', '/a/three'])).toBe('one, two +1 more');
		expect(namesOf(['/a/one', '/a/two', '/a/three', '/a/four'])).toBe('one, two +2 more');
	});

	it('keeps the phrase short for the eight paths that once stretched the toast', () => {
		const eight = Array.from({ length: 8 }, (_, i) => `/home/dev/code/project-${i}`);
		const phrase = namesOf(eight);
		expect(phrase).toBe('project-0, project-1 +6 more');
		// the point of the whole function: the phrase does not grow with the
		// list — twenty roots read as long as three, bar the count's digits
		expect(phrase.length).toBeLessThan(eight.join(', ').length / 3);
		const twenty = Array.from({ length: 20 }, (_, i) => `/home/dev/code/project-${i}`);
		expect(namesOf(twenty)).toBe('project-0, project-1 +18 more');
	});

	it('answers the empty string for no roots at all', () => {
		expect(namesOf([])).toBe('');
	});

	it('speaks folder names, never the \\\\wsl.localhost path they came from', () => {
		const phrase = namesOf([
			'\\\\wsl.localhost\\Ubuntu-26.04\\home\\dev\\devgo',
			'\\\\wsl.localhost\\Ubuntu-26.04\\home\\dev\\zetta-hrm'
		]);
		expect(phrase).toBe('devgo and zetta-hrm');
		expect(phrase).not.toContain('wsl.localhost');
	});

	it('ignores a trailing separator on any root', () => {
		expect(namesOf(['/home/dev/devgo/', 'C:\\code\\zetta\\'])).toBe('devgo and zetta');
	});
});
