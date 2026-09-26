import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { fuzzyScore } from '../palette';

/// A workspace on a virtual disk can be missing for a few seconds after boot
/// while the disk attaches. Retry a bounded number of times so the list heals
/// itself instead of needing a restart.
const RETRY_DELAYS = [2000, 5000, 15000];

/// Only local workspaces are retried. A stopped distro is a deliberate decision,
/// not a transient failure — auto-retrying it would make DevGo boot WSL in the
/// background, which is the exact behaviour this all exists to prevent.
const isRetryable = (w: WorkspaceState) =>
	w.status !== 'live' && w.reason !== 'distro_stopped';

// focus used to refresh unconditionally, and a refresh is nine wsl.exe and
// ~20 git.exe for six workspaces; every launch opens another window and
// hands focus back, so each launch paid all of it on the way back. A minute
// makes two summons cost one pass and still shows a distro started or a
// branch switched by the next visit
const FOCUS_REFRESH_COOLDOWN_MS = 60_000;

const SORT_KEY = 'devgo.sortMode';
const SORT_CYCLE: SortMode[] = ['frecency', 'activity', 'name'];

export const useProjects = () => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [workspaceStates, setWorkspaceStates] = useState<WorkspaceState[]>(
		[]
	);
	const [ranks, setRanks] = useState<Map<string, ProjectRank>>(new Map());
	const [git, setGit] = useState<Map<string, GitInfo>>(new Map());
	const [tech, setTech] = useState<Map<string, ProjectTech>>(new Map());
	// projects with a live tmux / psmux session: read with the badges and
	// on the same focus cooldown, one tmux ls per running distro and one
	// psmux list-sessions, never more often
	const [sessions, setSessions] = useState<Set<string>>(new Set());
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<Project | null>(null);
	const [loading, setLoading] = useState(true);
	const [sortMode, setSortMode] = useState<SortMode>(
		() => (localStorage.getItem(SORT_KEY) as SortMode) ?? 'frecency'
	);
	const retryTimer = useRef<number | null>(null);
	const retryStep = useRef(0);
	// when the last pass landed and whether one is in flight: the focus
	// handler reads them, nothing renders from them
	const lastPassAt = useRef(0);
	const inFlight = useRef(false);
	// the paths the badge pass last covered; a payload with a path not in
	// here (a workspace that just attached) is the one case a non-explicit
	// refresh still pays for git
	const badgedPaths = useRef<Set<string>>(new Set());

	// Git and stack detection both spawn processes, so neither gates the list.
	// These fire after the payload is already on screen and merge in as they
	// arrive — independently, so a slow git pass does not hold up the badges.
	//
	// merge keeps what the maps hold for paths outside list: a one-workspace
	// pass asks for that workspace's badges only, and replacing the whole
	// map would strip every other row's branch and stack. a full pass
	// replaces, so a project that left the list leaves the maps
	const loadDetails = (list: Project[], merge = false) => {
		if (list.length === 0) return;
		const asked = new Set(list.map(p => p.full_path));
		const kept = <V,>(prev: Map<string, V>) =>
			merge
				? new Map([...prev].filter(([k]) => !asked.has(k)))
				: new Map<string, V>();
		invoke<GitInfo[]>('get_git_info', { projects: list })
			.then(infos => {
				setGit(
					prev => new Map([...kept(prev), ...infos.map(i => [i.full_path, i] as const)])
				);
			})
			.catch(() => {});
		invoke<ProjectTech[]>('get_project_tech', { projects: list })
			.then(infos => {
				setTech(
					prev => new Map([...kept(prev), ...infos.map(i => [i.full_path, i] as const)])
				);
			})
			.catch(() => {});
		invoke<string[]>('get_live_sessions', { projects: list })
			.then(paths =>
				setSessions(
					prev =>
						new Set([
							...(merge ? [...prev].filter(k => !asked.has(k)) : []),
							...paths
						])
				)
			)
			.catch(() => {});
	};

	// after a kill: the set is known to have changed before the next pass
	const forgetSession = (fullPath: string) =>
		setSessions(prev => {
			if (!prev.has(fullPath)) return prev;
			const next = new Set(prev);
			next.delete(fullPath);
			return next;
		});

	// badges used to run on every apply, which is how one focus gain turned
	// into three backend commands; get_git_info's own comment said "only on
	// an explicit refresh" for ten chapters
	const paint = (payload: ProjectsPayload) => {
		setProjects(payload.projects);
		setWorkspaceStates(payload.workspaces);
		setRanks(new Map(payload.ranks.map(r => [r.full_path, r])));
	};

	const apply = (payload: ProjectsPayload, withBadges: boolean) => {
		paint(payload);
		lastPassAt.current = Date.now();
		const unseen = payload.projects.some(
			p => !badgedPaths.current.has(p.full_path)
		);
		if (withBadges || unseen) {
			badgedPaths.current = new Set(payload.projects.map(p => p.full_path));
			loadDetails(payload.projects);
		}
		return payload;
	};

	// force is the explicit refresh, the only path allowed to boot a stopped
	// distro, and it always re-reads badges
	const runPass = async (force: boolean, withBadges: boolean) => {
		inFlight.current = true;
		setLoading(true);
		try {
			const payload = force
				? await invoke<ProjectsPayload>('refresh_projects', { force: true })
				: await invoke<ProjectsPayload>('get_projects');
			return apply(payload, force || withBadges);
		} finally {
			inFlight.current = false;
			setLoading(false);
		}
	};

	const refresh = (force = false) => runPass(force, false);

	// one workspace, live: the header's refresh. the backend reads that one
	// alone (and may boot its distro, the ask names it) and answers with
	// its projects; they replace that workspace's slice of the list, its
	// header state and ranks, and its badges are re-read with merge so no
	// other row goes bare. not in flight and no spinner: the list stays on
	// screen and the header's count and pill are what change
	const refreshWorkspace = async (ws: string) => {
		const payload = await invoke<ProjectsPayload>('refresh_workspace', {
			workspace: ws
		});
		const state = payload.workspaces.find(s => s.workspace === ws);
		setProjects(prev => [
			...prev.filter(p => p.workspace !== ws),
			...payload.projects
		]);
		setWorkspaceStates(prev =>
			state
				? prev.some(s => s.workspace === ws)
					? prev.map(s => (s.workspace === ws ? state : s))
					: [...prev, state]
				: prev
		);
		const gone = new Set(
			projects.filter(p => p.workspace === ws).map(p => p.full_path)
		);
		setRanks(prev => {
			const next = new Map([...prev].filter(([k]) => !gone.has(k)));
			for (const r of payload.ranks) next.set(r.full_path, r);
			return next;
		});
		for (const p of payload.projects) badgedPaths.current.add(p.full_path);
		loadDetails(payload.projects, true);
		return payload;
	};

	// Schedule a retry whenever something is recoverably missing. Cleared as soon
	// as a pass comes back with nothing left to retry.
	useEffect(() => {
		if (retryTimer.current !== null) {
			window.clearTimeout(retryTimer.current);
			retryTimer.current = null;
		}

		// the cached paint is not a pass: the one in flight brings its own
		// states, and every one of them reads as cached until then
		if (inFlight.current || !workspaceStates.some(isRetryable)) {
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

	// Summoning the window should show a current list, but not at any price:
	// focus is the one trigger the user does not choose, so it is the one
	// that is rate-limited. Skipped while a pass is in flight (the window
	// takes focus as it first appears) and while the last one is younger
	// than the cooldown. The retry budget still resets on every focus.
	useEffect(() => {
		const unlisten = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (!focused) return;
				retryStep.current = 0;
				if (inFlight.current) return;
				if (Date.now() - lastPassAt.current < FOCUS_REFRESH_COOLDOWN_MS) return;
				runPass(false, true).catch(() => {});
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
		// cache first: the last known list is on screen in one read, no
		// read_dir, no wsl.exe, no git, and the live pass replaces it a
		// moment later. no badges on it either, the pass brings those. an
		// empty cache (first run) keeps the spinner, the honest state then
		invoke<ProjectsPayload>('get_cached_projects')
			.then(cached => {
				if (cached.projects.length === 0) return;
				paint(cached);
				setLoading(false);
				requestAnimationFrame(() => {
					invoke('mark_startup', { stage: 'first-list' }).catch(() => {});
				});
			})
			.catch(() => {});
		runPass(false, true)
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
			const next =
				SORT_CYCLE[(SORT_CYCLE.indexOf(prev) + 1) % SORT_CYCLE.length];
			localStorage.setItem(SORT_KEY, next);
			return next;
		});
	};

	// the sort control picks a mode outright; the palette still cycles
	const setSort = (mode: SortMode) => {
		localStorage.setItem(SORT_KEY, mode);
		setSortMode(mode);
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

	const q = query.trim();

	// Both ranked modes fall back to name, so the long tail (equal scores, or
	// projects with no git history) keeps a stable alphabetical order instead
	// of whatever the scan happened to return. `[...projects]` because sort
	// mutates.
	const byName = (a: Project, b: Project) =>
		a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	const byActivity = (a: Project, b: Project) => {
		const ta = git.get(a.full_path)?.last_commit ?? 0;
		const tb = git.get(b.full_path)?.last_commit ?? 0;
		return tb !== ta ? tb - ta : byName(a, b);
	};
	const byFrecency = (a: Project, b: Project) => {
		const sa = ranks.get(a.full_path)?.score ?? 0;
		const sb = ranks.get(b.full_path)?.score ?? 0;
		return sb !== sa ? sb - sa : byName(a, b);
	};
	// the palette's matcher, a third time: `dvgo` finds `devgo-app`. while you
	// type, the top hit belongs under Enter, so best match first
	//
	// `name` sorts here too rather than taking the payload's order on trust:
	// the backend does hand its rows back alphabetical, but refreshWorkspace
	// appends one workspace's rows after every other, so that order holds only
	// until the first per-workspace refresh
	const filtered = q
		? projects
				.map(p => ({ p, s: fuzzyScore(q, p.name) }))
				.filter((x): x is { p: Project; s: number } => x.s !== null)
				.sort((a, b) => (b.s !== a.s ? b.s - a.s : byName(a.p, b.p)))
				.map(x => x.p)
		: [...projects].sort(
				sortMode === 'activity'
					? byActivity
					: sortMode === 'frecency'
						? byFrecency
						: byName
			);

	// Derived from `filtered`, not `projects`, so pins respect the search.
	const pinnedProjects = filtered.filter(p => ranks.get(p.full_path)?.pinned);

	return {
		projects,
		workspaceStates,
		ranks,
		git,
		tech,
		sessions,
		forgetSession,
		filtered,
		pinnedProjects,
		query,
		setQuery,
		selected,
		setSelected: selectAndSave,
		refresh,
		refreshWorkspace,
		loading,
		sortMode,
		toggleSort,
		setSort,
		togglePin
	};
};
