import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closingBecause, logLine, logSessionStart, takeReason } from './uiLog';

// the webview's door into devgo.log. one boundary, stubbed the way
// Drawer.test.tsx and every hook suite stub it, and for the same reason: the
// real command appends to a file on disk.
const invoke = vi.fn(() => Promise.resolve());
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

// ⚠️ braces, not a concise body: vitest treats a function RETURNED from a
// beforeEach as that test's teardown, and mockClear() returns the mock — the
// note Drawer.test.tsx leaves about this applies here too
beforeEach(() => {
	invoke.mockClear();
	invoke.mockImplementation(() => Promise.resolve());
});

// the lines that actually left, in order, so a test asks what devgo.log will
// say rather than how it was asked to say it
const logged = () =>
	invoke.mock.calls
		.filter(c => (c as unknown[])[0] === 'log_ui_line')
		.map(c => ((c as unknown[])[1] as { line: string }).line);

describe('logLine', () => {
	it('sends the line to rust under log_ui_line', () => {
		logLine('workspace scan refused');
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(invoke).toHaveBeenCalledWith('log_ui_line', {
			line: 'workspace scan refused'
		});
	});

	// ⭐ best effort, like the backend half. a log that can throw is a log that
	// takes down the thing it was watching — and the callers are catch handlers
	// and cleanup paths, the places least able to handle a second failure
	it('swallows a refusal from rust rather than raising one of its own', async () => {
		invoke.mockImplementation(() => Promise.reject(new Error('log file locked')));
		expect(() => logLine('something odd')).not.toThrow();
		// the rejection is settled inside the call, so nothing is left
		// unhandled for the runner to report against a later test
		await Promise.resolve();
		await Promise.resolve();
	});

	// it returns nothing and awaits nothing: a caller cannot know the line
	// landed, which is the deliberate shape — logging must not order the code
	// around it
	it('returns nothing, so no caller can wait on the write', () => {
		expect(logLine('x')).toBeUndefined();
	});

	// the 512-character cut and the 2000-line budget are the backend's
	// (runtime_log.rs). this side hands the line over whole, so a long line is
	// trimmed once, in one place
	it('hands a long line over whole and leaves the cut to rust', () => {
		const long = new Array(601).join('x'); // 600 characters
		logLine(long);
		expect(logged()).toEqual([long]);
		expect(logged()[0].length).toBe(600);
	});

	it('sends an empty line as an empty line', () => {
		logLine('');
		expect(logged()).toEqual(['']);
	});

	it('sends a newline inside a line as-is, without splitting it', () => {
		logLine('first\nsecond');
		expect(logged()).toEqual(['first\nsecond']);
	});
});

describe('logSessionStart', () => {
	// the user agent is read from the live navigator rather than asserted as a
	// string: jsdom's UA carries its own version and would pin this test to a
	// dependency. what matters is the shape — the words, the separator, and
	// that the agent string is in there for a bug report to identify the
	// webview with
	it('writes one line naming the webview it started in', () => {
		logSessionStart();
		expect(logged()).toEqual([`session started · ${navigator.userAgent}`]);
	});

	it('leads with the words a reader greps for and joins with a middle dot', () => {
		logSessionStart();
		const line = logged()[0];
		expect(line.startsWith('session started · ')).toBe(true);
		expect(line).toContain(navigator.userAgent);
	});

	// ⭐ no guard of its own, and that is the point: the SECOND
	// "session started" under one process header is the only evidence a webview
	// reloaded underneath the user. a dedupe here would erase exactly the
	// signal the line exists for
	it('writes a line every time it is called, with nothing deduped', () => {
		logSessionStart();
		logSessionStart();
		expect(logged()).toHaveLength(2);
		expect(logged()[0]).toBe(logged()[1]);
	});
});

// ── why a surface closed ────────────────────────────────────────────────
//
// ⚠️ `pending` is module state with no reset export, so every test below uses
// a drawer name of its own and takes back what it leaves. that is not
// tidiness: it is the same discipline the production callers need, and the
// reason takeReason takes instead of reading
describe('closingBecause / takeReason', () => {
	it('hands the reason to the drawer that was named', () => {
		closingBecause('settings', 'a project was launched');
		expect(takeReason('settings')).toBe('a project was launched');
	});

	// ⭐ take, not read. a caller that announced a close and then did not close
	// (a refusal, an early return, a guard) has left a reason behind; if the
	// next close of that drawer could pick it up, devgo.log would state a cause
	// that belongs to a different moment — a lie in the one file being trusted
	it('is taken and not read: a second take finds nothing', () => {
		closingBecause('clone', 'the clone started');
		expect(takeReason('clone')).toBe('the clone started');
		expect(takeReason('clone')).toBeUndefined();
	});

	it('answers undefined for a drawer nobody left a reason for', () => {
		expect(takeReason('never-named')).toBeUndefined();
	});

	// the drawers are keyed by their log name and do not share a slot, so two
	// surfaces closing in the same tick cannot take each other's cause
	it('keeps two drawers apart', () => {
		closingBecause('about', 'the update was accepted');
		closingBecause('targets', 'a target was chosen');
		expect(takeReason('about')).toBe('the update was accepted');
		// taking one leaves the other exactly where it was
		expect(takeReason('targets')).toBe('a target was chosen');
		expect(takeReason('about')).toBeUndefined();
		expect(takeReason('targets')).toBeUndefined();
	});

	// the caller says it immediately before the state change, so the last word
	// before the close is the one that describes it
	it('lets the last word win when a caller speaks twice', () => {
		closingBecause('scan', 'the scan was cancelled');
		closingBecause('scan', 'the scan finished');
		expect(takeReason('scan')).toBe('the scan finished');
		expect(takeReason('scan')).toBeUndefined();
	});

	// ⚠️ the flip side of take-not-read, and the part a caller has to know: the
	// reason is NOT time-limited. it waits for the next close of that same
	// drawer however long that takes, so `closingBecause` on a path that might
	// not close is a reason attached to whatever closes next
	it('keeps an untaken reason waiting for that drawer, however much happens first', () => {
		closingBecause('stale', 'the close that never happened');
		logSessionStart();
		closingBecause('other', 'something else entirely');
		expect(takeReason('other')).toBe('something else entirely');
		// still there, still the old cause
		expect(takeReason('stale')).toBe('the close that never happened');
	});

	// nothing is written when the reason is left: the drawer's own close log is
	// the only line, and it reads the reason as it goes
	it('writes nothing to devgo.log on its own', () => {
		closingBecause('quiet', 'no line of its own');
		expect(invoke).not.toHaveBeenCalled();
		expect(takeReason('quiet')).toBe('no line of its own');
		expect(invoke).not.toHaveBeenCalled();
	});

	// an empty reason is stored and handed back as '', which is NOT the same
	// answer as "nobody said anything" — a caller that tests truthiness rather
	// than undefined would read the two the same way
	it('stores an empty reason as an empty string, not as nothing', () => {
		closingBecause('blank', '');
		const why = takeReason('blank');
		expect(why).toBe('');
		expect(why).not.toBeUndefined();
	});
});
