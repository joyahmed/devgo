import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { visibleRepos } from '../github';

// whether the lane is open, remembered across sessions. absent means
// "open once there is something to show": a first run with no cache
// starts closed, so the very first fetch is a click on the header, an
// explicit ask, and never a surprise on launch
const OPEN_KEY = 'devgo.githubLane';

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
export const useGithub = (
	query: string,
	git: Map<string, GitInfo>
): GithubState => {
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

	const visible = visibleRepos(payload?.cache.repos ?? [], query);

	const setOrgs = async (orgs: string[] | null) => {
		await invoke('set_github_orgs', { orgs });
		reload();
	};

	return {
		payload,
		status,
		refreshing,
		lastError,
		available: hasCache || Boolean(status?.installed),
		isOpen,
		toggleOpen,
		visible,
		refresh,
		reload,
		setOrgs
	};
};
