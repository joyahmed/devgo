import { describe, expect, it } from 'vitest';
import {
	DOT_CLASS,
	delayLabel,
	formatMem,
	formatUptime,
	initialOf,
	stateOf,
	statusLine,
	type StackStatus
} from './stackFormat';

const row = (patch: Partial<StackStatus> = {}): StackStatus => ({
	name: 'voice',
	running: false,
	isSelf: false,
	missing: false,
	...patch
});

describe('stateOf', () => {
	it('reads checking, running, stopped and not installed', () => {
		expect(stateOf(undefined)).toBe('checking');
		expect(stateOf(row({ running: true }))).toBe('running');
		expect(stateOf(row())).toBe('stopped');
		expect(stateOf(row({ missing: true }))).toBe('missing');
	});
	it('a running app is running even when its path is gone', () => {
		expect(stateOf(row({ running: true, missing: true }))).toBe('running');
	});
});

describe('DOT_CLASS', () => {
	it('green running, red stopped, grey ring not installed', () => {
		expect(DOT_CLASS.running).toContain('emerald');
		expect(DOT_CLASS.stopped).toContain('bg-danger');
		expect(DOT_CLASS.missing).toContain('border');
		expect(DOT_CLASS.missing).not.toContain('bg-');
	});
});

describe('formatUptime', () => {
	it('prints at most two units, the second only when not zero', () => {
		expect(formatUptime(42)).toBe('42 s');
		expect(formatUptime(7 * 60 + 5)).toBe('7 min');
		expect(formatUptime(2 * 3600 + 14 * 60)).toBe('2 h 14 min');
		expect(formatUptime(3 * 3600)).toBe('3 h');
		expect(formatUptime(3 * 86400 + 4 * 3600 + 59)).toBe('3 d 4 h');
		expect(formatUptime(2 * 86400 + 30)).toBe('2 d');
	});
});

describe('formatMem', () => {
	it('MB under a gigabyte, one decimal of GB above', () => {
		expect(formatMem(312 * 1024 * 1024)).toBe('312 MB');
		expect(formatMem(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
	});
});

describe('statusLine', () => {
	it('adds uptime and memory only when running', () => {
		expect(statusLine(row({ running: true, uptimeSecs: 8040, memBytes: 312 * 1048576 }))).toBe(
			'Running · 2 h 14 min · 312 MB'
		);
		expect(statusLine(row({ uptimeSecs: 8040 }))).toBe('Stopped');
		expect(statusLine(row({ missing: true }))).toBe('Not installed');
		expect(statusLine(undefined)).toBe('Checking…');
	});
	it('a running app without detail is just Running', () => {
		expect(statusLine(row({ running: true }))).toBe('Running');
	});
});

describe('delayLabel', () => {
	it('seconds, or whole minutes', () => {
		expect(delayLabel(0)).toBe('0 s');
		expect(delayLabel(10)).toBe('10 s');
		expect(delayLabel(90)).toBe('90 s');
		expect(delayLabel(120)).toBe('2 min');
	});
});

describe('initialOf', () => {
	it('the first letter or digit, upper case', () => {
		expect(initialOf('desk monitor')).toBe('D');
		expect(initialOf('  7zip')).toBe('7');
		expect(initialOf('(élan)')).toBe('É');
		expect(initialOf('---')).toBe('?');
	});
});
