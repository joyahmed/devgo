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
// whether the ungrouped tail, the newest twenty, is shown. once the
// repos you care about are in groups the tail is noise under them, and
// a switch is cheaper than a group called everything else
const RECENTS_KEY = 'devgo.githubRecents';

// live search fires only after the box has been still this long, and
// only for a query at least this many characters: two of the three gates
// on the one place a keystroke becomes a network call. the third is the
// switch in settings, off until turned on
const LIVE_DEBOUNCE_MS = 400;
const LIVE_MIN_CHARS = 3;

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

	const [showRecents, setShowRecents] = useState(() => {
		try {
			return localStorage.getItem(RECENTS_KEY) !== 'off';
		} catch {
			return true;
		}
	});
	const toggleRecents = () => {
		try {
			localStorage.setItem(RECENTS_KEY, showRecents ? 'off' : 'on');
		} catch {
			// per-viewer convenience only
		}
		setShowRecents(!showRecents);
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
	// the cache's matches for the query: instant, no network
	const cacheMatches = sections
		? null
		: visibleRepos(payload?.cache.repos ?? [], query);

	// live hits from all of github for the same query, when the switch is
	// on. generation stamps each request and an answer to an older one is
	// dropped, so a fast typist never sees results for a query they left
	const [live, setLive] = useState<{ query: string; repos: GithubRepo[] }>({
		query: '',
		repos: []
	});
	const generation = useRef(0);
	const liveOn = Boolean(payload?.live_search);
	const q = query.trim();
	const liveEligible =
		liveOn && isOpen && q.length >= LIVE_MIN_CHARS && Boolean(status?.login);
	// searching is not state: it is eligible and not yet answered, which
	// falls out of the query and the last answer with no flag to clear
	const searching = liveEligible && live.query !== q;
	useEffect(() => {
		if (!searching) return;
		const gen = ++generation.current;
		const timer = window.setTimeout(() => {
			invoke<SearchAnswer>('search_github', { query: q, generation: gen })
				.then(answer => {
					if (answer.generation !== generation.current) return;
					setLive({ query: q, repos: answer.repos });
				})
				.catch(() => {
					// searching stays on for this query; the next keystroke retries
				});
		}, LIVE_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [q, searching]);

	// live rows the cache does not already answer with, for the current
	// query only: a stale set from the last query would sit under the
	// wrong heading
	const have = new Set((cacheMatches ?? []).map(r => r.full_name));
	const liveExtras =
		liveOn && cacheMatches && live.query === q
			? live.repos.filter(r => !have.has(r.full_name))
			: [];

	// the flat row order the keyboard walks: the sections with folded
	// groups and a hidden tail contributing nothing, or the cache's
	// matches then the live extras
	const hidden = (s: LaneSection) =>
		s.group ? folded.has(s.group) : !showRecents;
	const visible = sections
		? sections.flatMap(s => (hidden(s) ? [] : s.rows))
		: [...(cacheMatches ?? []), ...liveExtras];

	const setLiveSearch = async (on: boolean) => {
		await invoke('set_github_live_search', { on });
		reload();
	};

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
		cacheMatches,
		liveExtras,
		searching,
		liveOn,
		setLiveSearch,
		groups,
		editGroups,
		folded,
		toggleGroup,
		showRecents,
		toggleRecents,
		refresh,
		reload,
		setOrgs
	};
};
