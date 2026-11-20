import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { statusLine, type StackStatus } from '../stackFormat';
import { logLine } from '../uiLog';

// "My stack": the user's own apps, from stack.json in DevGo's data folder.
// The poll is the only running cost, so it runs only while the caller says
// it is on screen (`active`: the Stack tab is open, the pill is up) AND the
// document is visible. `detail` asks Rust for uptime and memory, which costs
// a per-process open; the tab wants them, the pill does not.

export type { StackStatus } from '../stackFormat';

export type StackEntry = {
	name: string;
	process: string;
	path: string;
	args: string[];
	delay: number;
};

export type StackAction = 'start' | 'stop' | 'restart';

export type NewStackEntry = Omit<StackEntry, 'process' | 'args'> & { process?: string };

// 5 s, not 2: every poll is an IPC round trip, a process snapshot and (when
// anything changed) a repaint. At 2 s the open window cost ~2.5 CPU-s a
// minute on the release build; see docs/plans/my-stack.md
export const POLL_MS = 5000;

// the rows as one comparable string, built from what the screen PRINTS: a
// poll that changes nothing visible must not hand react a new object (a new
// object is a re-render and a repaint). uptime moves every poll, but its
// printed form moves once a minute after the first one
const statusKey = (rows: StackStatus[]) =>
	rows.map(r => `${r.name}:${+r.running}${+r.isSelf}${+r.missing}:${statusLine(r)}`).join('|');

// `C:\x\Desk Monitor\desk-monitor.exe` -> `desk-monitor`
export const processFromPath = (path: string) =>
	(path.trim().split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '');

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// icons by path, for the life of the page: Rust caches them too, this saves
// the IPC hop when the tab is opened again. null = no icon (a letter tile)
const iconCache = new Map<string, string | null>();
export const clearIconCache = () => iconCache.clear();

type Options = { active?: boolean; detail?: boolean };

export const useStack = ({ active = true, detail = false }: Options = {}) => {
	const [apps, setApps] = useState<StackEntry[]>([]);
	const [status, setStatus] = useState<Record<string, StackStatus>>({});
	const [icons, setIcons] = useState<Record<string, string | null>>({});
	const [busy, setBusy] = useState<Record<string, boolean>>({});
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	// the old stack window's Edit mode; S8 removes it with the window
	const [editing, setEditing] = useState(false);

	const lastKey = useRef('');
	const refresh = async () => {
		try {
			const rows = await invoke<StackStatus[]>('stack_status', { detail });
			const key = statusKey(rows);
			if (key === lastKey.current) return;
			lastKey.current = key;
			setStatus(Object.fromEntries(rows.map(r => [r.name, r])));
		} catch (e) {
			setError(errorText(e));
		}
	};

	// the list is read each time the caller comes on screen: the sign-in
	// script's file can be edited by hand, and by the other window
	useEffect(() => {
		if (!active) return;
		invoke<{ apps: StackEntry[] }>('stack_list')
			.then(f => setApps(f.apps))
			.catch(e => setError(errorText(e)))
			.finally(() => setLoaded(true));
	}, [active]);

	// re-armed when detail flips, so the timer's refresh asks for the right one
	useEffect(() => {
		if (!active) return;
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
	}, [active, detail]);

	// icons for the paths on screen, each asked for once
	useEffect(() => {
		if (!active) return;
		const cached = apps.filter(a => iconCache.get(a.path));
		if (cached.length)
			setIcons(i =>
				cached.every(a => i[a.path] === iconCache.get(a.path))
					? i
					: { ...i, ...Object.fromEntries(cached.map(a => [a.path, iconCache.get(a.path)!])) }
			);
		apps
			.filter(a => !iconCache.has(a.path))
			.forEach(a => {
				iconCache.set(a.path, null);
				invoke<string | null>('stack_icon', { path: a.path })
					.then(icon => {
						iconCache.set(a.path, icon);
						if (icon) setIcons(i => ({ ...i, [a.path]: icon }));
					})
					.catch(() => iconCache.delete(a.path));
			});
	}, [apps, active]);

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

	const act = (name: string, action: StackAction) => run(name, `stack_${action}`, { name });
	const startAll = () => run('*', 'stack_start_all');
	// every running app but DevGo, last first (Rust decides the order)
	const stopAll = () => run('*', 'stack_stop_all');

	const save = async (next: StackEntry[]) => {
		setError(null);
		try {
			const f = await invoke<{ apps: StackEntry[] }>('stack_save', { file: { apps: next } });
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
		if (to < 0 || to >= apps.length) return Promise.resolve(false);
		const next = [...apps];
		[next[index], next[to]] = [next[to], next[index]];
		return save(next);
	};
	const remove = (index: number) => save(apps.filter((_, i) => i !== index));
	// a new path brings its own process name unless the caller gave one
	const update = (index: number, patch: Partial<StackEntry>) =>
		save(
			apps.map((a, i) =>
				i !== index
					? a
					: {
							...a,
							...patch,
							process:
								patch.process ??
								(patch.path && patch.path !== a.path ? processFromPath(patch.path) : a.process)
						}
			)
		);
	const add = ({ process, ...entry }: NewStackEntry) =>
		save([...apps, { ...entry, process: process || processFromPath(entry.path), args: [] }]);

	// the old stack window's ✕: destroys the window, its webview and poll go
	// with it. the log line tells this close apart from one sent from outside,
	// and a click (detail >= 1) from a key press on the focused button
	const close = (e?: { detail?: number }) => {
		const how = e?.detail === undefined ? '' : e.detail === 0 ? ' (key)' : ' (click)';
		logLine(`stack: close pressed${how}`);
		return getCurrentWindow().close();
	};

	return {
		apps,
		status,
		icons,
		busy,
		error,
		setError,
		loaded,
		editing,
		setEditing,
		act,
		startAll,
		stopAll,
		move,
		remove,
		update,
		add,
		close
	};
};

export type UseStack = ReturnType<typeof useStack>;
