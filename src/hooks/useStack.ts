import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

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

export const POLL_MS = 2000;

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

	const refresh = async () => {
		try {
			const rows = await invoke<StackStatus[]>('stack_status');
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
	const close = () => getCurrentWindow().close();

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
