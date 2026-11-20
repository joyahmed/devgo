// the words and numbers the Stack tab and the pill print about an app. pure,
// so the tests can pin them without a window

export type StackStatus = {
	name: string;
	running: boolean;
	isSelf: boolean;
	missing: boolean;
	uptimeSecs?: number | null;
	memBytes?: number | null;
};

export type StackState = 'checking' | 'running' | 'stopped' | 'missing';

export const stateOf = (s?: StackStatus): StackState =>
	!s ? 'checking' : s.running ? 'running' : s.missing ? 'missing' : 'stopped';

export const STATE_WORD: Record<StackState, string> = {
	checking: 'Checking…',
	running: 'Running',
	stopped: 'Stopped',
	missing: 'Not installed'
};

// one dot, three readings: emerald is the app's existing "online" (the
// servers lane, the fs chip), red a stopped app (it should be running and
// is not), a grey ring an app that is not installed (nothing to start)
export const DOT_CLASS: Record<StackState, string> = {
	checking: 'border border-border-strong',
	running: 'bg-emerald-400 shadow-[0_0_6px_#34d399]',
	stopped: 'bg-danger',
	missing: 'border-2 border-text-muted'
};

// 42 s, 7 min, 2 h 14 min, 3 d 4 h: two units at most, the second only
// when it is not zero
export const formatUptime = (secs: number) => {
	const m = Math.floor(secs / 60);
	const h = Math.floor(m / 60);
	const d = Math.floor(h / 24);
	if (d > 0) return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
	if (h > 0) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
	if (m > 0) return `${m} min`;
	return `${secs} s`;
};

// working set: MB under a gigabyte, one decimal of GB above
export const formatMem = (bytes: number) => {
	const mb = bytes / (1024 * 1024);
	return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`;
};

// "Running · 2 h 14 min · 312 MB"
export const statusLine = (s?: StackStatus) => {
	const parts = [STATE_WORD[stateOf(s)]];
	if (s?.running && s.uptimeSecs != null) parts.push(formatUptime(s.uptimeSecs));
	if (s?.running && s.memBytes != null) parts.push(formatMem(s.memBytes));
	return parts.join(' · ');
};

// the start delay as the rail prints it
export const delayLabel = (secs: number) =>
	secs >= 60 && secs % 60 === 0 ? `${secs / 60} min` : `${secs} s`;

// the letter tile when an exe has no icon: the first letter or digit
export const initialOf = (name: string) =>
	(name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
