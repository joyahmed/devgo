import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { laneSections, visibleRepos } from '../github';

// whether the lane is open, remembered across sessions. absent means
// "open once there is something to show": a first run with no cache
// starts closed, so the very first fetch is a click on the header, an
// explicit ask, and never a surprise on launch
const OPEN_KEY = 'devgo.githubLane';
// which groups are folded, remembered like the tree's collapse set
const FOLDED_KEY = 'devgo.githubGroupsFolded';

const loadFolded = (): Set<string> => {
	try {
		const raw = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
		return new Set(Array.isArray(raw) ? (raw as string[]) : []);
	} catch {
		return new Set();
	}
};

const loadOpen = (): boolean | null => {
	try {
		const v = localStorage.getItem(OPEN_KEY);
		return v === null ? null : v === 'open';
	} catch {
		return null;
	}
};

// reads the cache on mount (a file, no network), listens for the refresh
// thread to finish, and owns the one rule about when a refresh may start
// on its own: the lane's first open in a session, when the cache is
// stale. everything else that fetches is a button or a palette command
export const useGithub = (git: Map<string, GitInfo>): GithubState => {
	// the github rows' own box: the project box never sees this
	const [query, setQuery] = useState('');
	const [payload, setPayload] = useState<GithubPayload | null>(null);
	const [status, setStatus] = useState<GhStatus | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [lastError, setLastError] = useState<string | null>(null);
	const [open, setOpen] = useState<boolean | null>(loadOpen);
	// set once the stale-on-open rule has fired; it does not fire twice in
	// one session however often the lane is toggled
	const askedOnOpen = useRef(false);

	const reload = () => {
		invoke<GithubPayload>('get_github_repos')
			.then(p => {
				setPayload(p);
				setRefreshing(p.refreshing);
			})
			.catch(() => {});
	};

	// runs on a rust thread and returns at once; the answer is an event.
	// refreshing flips here so the header can say so straight away
	const refresh = () => {
		setRefreshing(true);
		invoke('refresh_github_repos').catch(() => setRefreshing(false));
	};

	useEffect(() => {
		const unlisten = listen<GithubUpdated>(
			'devgo://github-updated',
			({ payload: result }) => {
				setRefreshing(false);
				if (result.ok) {
					setLastError(null);
					reload();
				} else {
					setLastError(result.error ?? 'GitHub refresh failed');
				}
			}
		);
		return () => {
			unlisten.then(f => f()).catch(() => {});
		};
	}, []);

	// mount: is gh there, and as whom. local, no network. this decides
	// whether the lane renders at all before a cache exists, and which of
	// the three sentences its header says
	useEffect(() => {
		invoke<GhStatus>('get_github_status').then(setStatus).catch(() => {});
	}, []);

	// the local map is computed from the git cache on the rust side, so it
	// is as current as the last badge pass: re-read after each one. the
	// map is a new one when a pass lands, and the first run is the mount
	useEffect(reload, [git]);

	const hasCache = (payload?.cache.fetched_at ?? 0) > 0;
	const isOpen = open ?? hasCache;

	const toggleOpen = () => {
		const next = !isOpen;
		try {
			localStorage.setItem(OPEN_KEY, next ? 'open' : 'closed');
		} catch {
			// per-viewer convenience only
		}
		setOpen(next);
	};

	// the one automatic fetch, and its whole condition: lane open, cache
	// stale or absent, gh logged in, nothing in flight, not yet this session
	useEffect(() => {
		if (!isOpen || !payload || !status?.login) return;
		if (!payload.stale || refreshing || askedOnOpen.current) return;
		askedOnOpen.current = true;
		refresh();
	}, [isOpen, payload, status, refreshing]);

	// groups: loaded once, and every edit goes through one command that
	// returns the whole list, so this never predicts what the store did
	const [groups, setGroups] = useState<GithubGroup[]>([]);
	useEffect(() => {
		invoke<GithubGroup[]>('get_github_groups').then(setGroups).catch(() => {});
	}, []);
	const editGroups = async (edit: GroupEdit) => {
		const next = await invoke<GithubGroup[]>('edit_github_groups', { edit });
		setGroups(next);
		return next;
	};

	const [folded, setFolded] = useState<Set<string>>(loadFolded);
	const toggleGroup = (name: string) => {
		const next = new Set(folded);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		try {
			localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
		} catch {
			// per-viewer convenience only
		}
		setFolded(next);
	};

	// with a query the list is one flat list of matches, groups aside;
	// without one it is the groups in order and then the ungrouped tail.
	// visible is the flattened row order in both cases, what the keyboard
	// walks, with folded groups contributing nothing, exactly as a
	// collapsed workspace
	const sections = query.trim()
		? null
		: laneSections(payload?.cache.repos ?? [], groups);
	const visible = sections
		? sections.flatMap(s => (s.group && folded.has(s.group) ? [] : s.rows))
		: visibleRepos(payload?.cache.repos ?? [], query);

	const setOrgs = async (orgs: string[] | null) => {
		await invoke('set_github_orgs', { orgs });
		reload();
	};

	return {
		query,
		setQuery,
		payload,
		status,
		refreshing,
		lastError,
		available: hasCache || Boolean(status?.installed),
		isOpen,
		toggleOpen,
		visible,
		sections,
		groups,
		editGroups,
		folded,
		toggleGroup,
		refresh,
		reload,
		setOrgs
	};
};
