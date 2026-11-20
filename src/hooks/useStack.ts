import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { logLine } from '../uiLog';

// "My stack": the user's own apps, from stack.json in DevGo's data folder.
// The poll is the only running cost of this window, so it runs only while
// the document is visible, and the window is destroyed (not hidden) on close.

export type StackEntry = {
	name: string;
	process: string;
	path: string;
	args: string[];
	delay: number;
};

export type StackStatus = {
	name: string;
	running: boolean;
	isSelf: boolean;
	missing: boolean;
};

export type StackAction = 'start' | 'stop' | 'restart';

// 5 s, not 2: every poll is an IPC round trip, a process snapshot and (when
// anything changed) a repaint of a second webview. At 2 s the open window
// cost ~2.5 CPU-s a minute on the release build; see docs/plans/my-stack.md
export const POLL_MS = 5000;

// the rows as one comparable string: a poll that changes nothing must not
// hand react a new object (a new object is a re-render and a repaint)
const statusKey = (rows: StackStatus[]) =>
	rows.map(r => `${r.name}:${+r.running}${+r.isSelf}${+r.missing}`).join('|');

// `C:\x\Desk Monitor\desk-monitor.exe` -> `desk-monitor`
export const processFromPath = (path: string) =>
	(path.trim().split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '');

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useStack = () => {
	const [apps, setApps] = useState<StackEntry[]>([]);
	const [status, setStatus] = useState<Record<string, StackStatus>>({});
	const [busy, setBusy] = useState<Record<string, boolean>>({});
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);

	const lastKey = useRef('');
	const refresh = async () => {
		try {
			const rows = await invoke<StackStatus[]>('stack_status');
			const key = statusKey(rows);
			if (key === lastKey.current) return;
			lastKey.current = key;
			setStatus(Object.fromEntries(rows.map(r => [r.name, r])));
		} catch (e) {
			setError(errorText(e));
		}
	};

	useEffect(() => {
		invoke<{ apps: StackEntry[] }>('stack_list')
			.then(f => setApps(f.apps))
			.catch(e => setError(errorText(e)));
		let timer: ReturnType<typeof setInterval> | undefined;
		const arm = () => {
			clearInterval(timer);
			timer = undefined;
			if (document.visibilityState !== 'visible') return;
			refresh();
			timer = setInterval(refresh, POLL_MS);
		};
		arm();
		document.addEventListener('visibilitychange', arm);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', arm);
		};
	}, []);

	const run = async (key: string, command: string, args?: Record<string, unknown>) => {
		setBusy(b => ({ ...b, [key]: true }));
		setError(null);
		try {
			await invoke(command, args);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(b => ({ ...b, [key]: false }));
			refresh();
		}
	};

	const act = (name: string, action: StackAction) =>
		run(name, `stack_${action}`, { name });
	const startAll = () => run('*', 'stack_start_all');

	const save = async (next: StackEntry[]) => {
		setError(null);
		try {
			const f = await invoke<{ apps: StackEntry[] }>('stack_save', {
				file: { apps: next }
			});
			setApps(f.apps);
			refresh();
			return true;
		} catch (e) {
			setError(errorText(e));
			return false;
		}
	};

	const move = (index: number, by: -1 | 1) => {
		const to = index + by;
		if (to < 0 || to >= apps.length) return;
		const next = [...apps];
		[next[index], next[to]] = [next[to], next[index]];
		save(next);
	};
	const remove = (index: number) => save(apps.filter((_, i) => i !== index));
	const add = (entry: Omit<StackEntry, 'process' | 'args'>) =>
		save([
			...apps,
			{ ...entry, process: processFromPath(entry.path), args: [] }
		]);

	// destroys the window: its webview and this poll go with it
	// the log line tells this close apart from one sent from outside, and a
	// click (detail >= 1) from a key press on the focused button (detail 0)
	const close = (e?: { detail?: number }) => {
		const how = e?.detail === undefined ? '' : e.detail === 0 ? ' (key)' : ' (click)';
		logLine(`stack: close pressed${how}`);
		return getCurrentWindow().close();
	};

	return {
		apps,
		close,
		status,
		busy,
		error,
		editing,
		setEditing,
		act,
		startAll,
		move,
		remove,
		add
	};
};

export type UseStack = ReturnType<typeof useStack>;
