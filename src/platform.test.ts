import { afterEach, describe, expect, it, vi } from 'vitest';

// ⛔ the ONE thing this file establishes is: a user agent nobody recognises
// is NONE of the three platforms, rather than Windows by default. this is
// load-bearing behaviour that other suites depend on.
//
// the three regexes are evaluated ONCE at module import time, off a UA that
// cannot change after that, so every assertion requires stubbing the UA,
// resetting modules, and dynamically importing a fresh copy of the module.
// the helper below wraps that pattern.

type Platform = { isMac: boolean; isWindows: boolean; isLinux: boolean };

const onPlatform = async (ua: string): Promise<Platform> => {
	vi.stubGlobal('navigator', { userAgent: ua });
	vi.resetModules();
	const mod = await import('./platform');
	return {
		isMac: mod.isMac,
		isWindows: mod.isWindows,
		isLinux: mod.isLinux
	};
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('platform — which desktop the webview is standing on', () => {
	it('detects Windows from "Windows NT" in the user agent', async () => {
		const p = await onPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
		expect(p.isWindows).toBe(true);
		expect(p.isMac).toBe(false);
		expect(p.isLinux).toBe(false);
	});

	it('detects macOS from "Macintosh" in the user agent', async () => {
		const p = await onPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
		expect(p.isMac).toBe(true);
		expect(p.isWindows).toBe(false);
		expect(p.isLinux).toBe(false);
	});

	it('detects macOS from "Mac OS X" in the user agent', async () => {
		const p = await onPlatform('Mozilla/5.0 (Mac OS X 10_15_7) AppleWebKit/537.36');
		expect(p.isMac).toBe(true);
		expect(p.isWindows).toBe(false);
		expect(p.isLinux).toBe(false);
	});

	it('detects Linux from "X11" in the user agent', async () => {
		const p = await onPlatform('Mozilla/5.0 (X11; Linux x86_64)');
		expect(p.isLinux).toBe(true);
		expect(p.isMac).toBe(false);
		expect(p.isWindows).toBe(false);
	});

	it('detects Linux from "Linux" in the user agent', async () => {
		const p = await onPlatform('Mozilla/5.0 (Linux armv7l)');
		expect(p.isLinux).toBe(true);
		expect(p.isMac).toBe(false);
		expect(p.isWindows).toBe(false);
	});

	it('says all three are false when the user agent is unrecognised', async () => {
		const p = await onPlatform('Mozilla/5.0 (SomethingElse)');
		expect(p.isMac).toBe(false);
		expect(p.isWindows).toBe(false);
		expect(p.isLinux).toBe(false);
	});

	it('says all three are false when the user agent is empty', async () => {
		const p = await onPlatform('');
		expect(p.isMac).toBe(false);
		expect(p.isWindows).toBe(false);
		expect(p.isLinux).toBe(false);
	});

	it(
		'⛔ says all three are false under jsdom — the user agent is ' +
			'"Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/30.1.1", ' +
			'which holds no "Windows NT", no "Macintosh", no "Mac OS X", no "X11", and no "Linux". ' +
			'this is load-bearing: the whole test suite depends on unrecognised desktop being treated ' +
			'as "not windows" by default, not as windows itself',
		async () => {
			const p = await onPlatform(
				'Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/30.1.1'
			);
			expect(p.isMac).toBe(false);
			expect(p.isWindows).toBe(false);
			expect(p.isLinux).toBe(false);
		}
	);

	it('treats the regexes as case-sensitive: "linux" lowercase does not match', async () => {
		const p = await onPlatform('Mozilla/5.0 (linux)');
		expect(p.isLinux).toBe(false);
		expect(p.isMac).toBe(false);
		expect(p.isWindows).toBe(false);
	});

	it('treats the regexes as case-sensitive: "windows nt" lowercase does not match', async () => {
		const p = await onPlatform('Mozilla/5.0 (windows nt)');
		expect(p.isWindows).toBe(false);
		expect(p.isMac).toBe(false);
		expect(p.isLinux).toBe(false);
	});

	it('prioritises macOS over Linux: a UA with both "Macintosh" and "Linux" is a Mac', async () => {
		// this is how isLinux works: it checks !isMac && !isWindows first,
		// so a UA that triggers both regexes still comes back as Mac only
		const p = await onPlatform('Mozilla/5.0 (Macintosh; X11; Linux)');
		expect(p.isMac).toBe(true);
		expect(p.isLinux).toBe(false);
		expect(p.isWindows).toBe(false);
	});

	it('prioritises Windows over Linux: a UA with both "Windows NT" and "Linux" is Windows', async () => {
		// similarly, isLinux requires !isWindows, so Windows takes precedence
		const p = await onPlatform('Mozilla/5.0 (Windows NT 10.0; Linux)');
		expect(p.isWindows).toBe(true);
		expect(p.isLinux).toBe(false);
		expect(p.isMac).toBe(false);
	});
});
