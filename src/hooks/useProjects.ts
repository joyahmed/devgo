import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';

/// A workspace on a virtual disk can be missing for a few seconds after boot
/// while the disk attaches. Retry a bounded number of times so the list heals
/// itself instead of needing a restart.
const RETRY_DELAYS = [2000, 5000, 15000];

/// Only local workspaces are retried. A stopped distro is a deliberate decision,
/// not a transient failure — auto-retrying it would make DevGo boot WSL in the
/// background, which is the exact behaviour this all exists to prevent.
const isRetryable = (w: WorkspaceState) =>
	w.status !== 'live' && w.reason !== 'distro_stopped';

const SORT_KEY = 'devgo.sortMode';

export const useProjects = () => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [workspaceStates, setWorkspaceStates] = useState<WorkspaceState[]>(
		[]
	);
	const [ranks, setRanks] = useState<Map<string, ProjectRank>>(new Map());
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<Project | null>(null);
	const [loading, setLoading] = useState(true);
	const [sortMode, setSortMode] = useState<SortMode>(
		() => (localStorage.getItem(SORT_KEY) as SortMode) ?? 'frecency'
	);
	const retryTimer = useRef<number | null>(null);
	const retryStep = useRef(0);

	const apply = (payload: ProjectsPayload) => {
		setProjects(payload.projects);
		setWorkspaceStates(payload.workspaces);
		setRanks(new Map(payload.ranks.map(r => [r.full_path, r])));
		return payload;
	};

	const refresh = async (force = false) => {
		setLoading(true);
		try {
			const payload = force
				? await invoke<ProjectsPayload>('refresh_projects', { force: true })
				: await invoke<ProjectsPayload>('get_projects');
			return apply(payload);
		} finally {
			setLoading(false);
		}
	};

	// Schedule a retry whenever something is recoverably missing. Cleared as soon
	// as a pass comes back with nothing left to retry.
	useEffect(() => {
		if (retryTimer.current !== null) {
			window.clearTimeout(retryTimer.current);
			retryTimer.current = null;
		}

		if (!workspaceStates.some(isRetryable)) {
			retryStep.current = 0;
			return;
		}

		const delay = RETRY_DELAYS[retryStep.current];
		if (delay === undefined) return;
		retryStep.current += 1;

		retryTimer.current = window.setTimeout(() => {
			refresh().catch(() => {});
		}, delay);

		return () => {
			if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
		};
	}, [workspaceStates]);

	// Summoning the window should show a current list. Resets the retry budget so
	// a workspace that came back is picked up promptly.
	useEffect(() => {
		const unlisten = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (!focused) return;
				retryStep.current = 0;
				refresh().catch(() => {});
			}
		);
		return () => {
			unlisten.then(f => f()).catch(() => {});
		};
	}, []);

	// First-launch restore: scan, then re-select the project saved last time if
	// it still exists. Runs exactly once — re-running it after a rescan would
	// steal the selection the user just made.
	useEffect(() => {
		refresh()
			.then(payload =>
				invoke<LastProject | null>('get_last_project')
					.then(last => {
						if (!last) return;
						const match = payload.projects.find(
							p => p.full_path === last.full_path
						);
						if (match) setSelected(match);
					})
					.catch(() => {})
			)
			.catch(() => {});
	}, []);

	// Every selection is persisted, so the next launch can land on it.
	const selectAndSave = (proj: Project | null) => {
		setSelected(proj);
		if (proj) {
			invoke('set_last_project', {
				project: { full_path: proj.full_path, workspace: proj.workspace }
			}).catch(() => {});
		}
	};

	const toggleSort = () => {
		setSortMode(prev => {
			const next: SortMode = prev === 'frecency' ? 'name' : 'frecency';
			localStorage.setItem(SORT_KEY, next);
			return next;
		});
	};

	// Patch one rank from the command's answer rather than rescanning every
	// workspace to change a star.
	const togglePin = async (project: Project) => {
		const pinned = await invoke<boolean>('toggle_pin', {
			fullPath: project.full_path
		});
		setRanks(prev => {
			const next = new Map(prev);
			const existing = prev.get(project.full_path);
			if (existing) next.set(project.full_path, { ...existing, pinned });
			return next;
		});
	};

	const q = query.trim().toLowerCase();
	const matched = q
		? projects.filter(p => p.name.toLowerCase().includes(q))
		: projects;

	// Frecency descending, falling back to name so equal-scored projects (the
	// long tail, all zero) keep a stable alphabetical order rather than
	// whatever the scan happened to return. `[...matched]` because sort mutates.
	const filtered =
		sortMode === 'name'
			? matched
			: [...matched].sort((a, b) => {
					const sa = ranks.get(a.full_path)?.score ?? 0;
					const sb = ranks.get(b.full_path)?.score ?? 0;
					if (sb !== sa) return sb - sa;
					return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
				});

	// Derived from `filtered`, not `projects`, so pins respect the search.
	const pinnedProjects = filtered.filter(p => ranks.get(p.full_path)?.pinned);

	return {
		projects,
		workspaceStates,
		ranks,
		filtered,
		pinnedProjects,
		query,
		setQuery,
		selected,
		setSelected: selectAndSave,
		refresh,
		loading,
		sortMode,
		toggleSort,
		togglePin
	};
};
