import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGithub } from './useGithub';

// the same seam every other test in this tree uses: one stub over the rust
// boundary, answering per command name, so the assertions are about which
// command ran, when, and with what payload — the contract tsc cannot see
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

// the refresh runs on a rust thread and answers by event, so the event is
// half the hook. the mock keeps the NAME it subscribed to (a rust contract,
// invisible to tsc) and a way to emit one
let listened: string | null = null;
let fire: ((p: GithubUpdated) => void) | null = null;
vi.mock('@tauri-apps/api/event', () => ({
	listen: (name: string, handler: (e: { payload: GithubUpdated }) => void) => {
		listened = name;
		fire = p => handler({ payload: p });
		return Promise.resolve(() => {});
	}
}));

const REPO = (full_name: string, over: Partial<GithubRepo> = {}): GithubRepo => ({
	full_name,
	name: full_name.split('/')[1] ?? full_name,
	owner: full_name.split('/')[0] ?? '',
	url: `https://github.com/${full_name}`,
	updated_at: '2026-09-01T00:00:00Z',
	private: false,
	archived: false,
	default_branch: 'main',
	added: false,
	stars: null,
	...over
});

type PayloadOver = Partial<Omit<GithubPayload, 'cache'>> & {
	cache?: Partial<GithubCache>;
};
const PAYLOAD = (over: PayloadOver = {}): GithubPayload => ({
	stale: false,
	refreshing: false,
	orgs: null,
	local: {},
	live_search: false,
	...over,
	cache: {
		fetched_at: 1_700_000_000,
		login: 'joyahmed',
		orgs: [],
		repos: [],
		...over.cache
	}
});

const IN: GhStatus = { installed: true, version: '2.97.0', login: 'joyahmed' };
const OUT: GhStatus = { installed: true, version: '2.97.0', login: null };

type Wired = {
	payload?: GithubPayload;
	status?: GhStatus;
	groups?: GithubGroup[];
	/// what edit_github_groups hands back — the whole list, always
	edited?: GithubGroup[];
	/// a live search answer stamped by the caller's own generation
	searchRepos?: GithubRepo[];
	/// a live search answer with a generation of its own, for the stale case
	search?: SearchAnswer;
	fail?: string[];
};

const wire = (over: Wired = {}) =>
	invoke.mockImplementation((cmd: string, args?: unknown) => {
		if (over.fail?.includes(cmd))
			return Promise.reject(new Error(`${cmd} refused`));
		switch (cmd) {
			case 'get_github_repos':
				return Promise.resolve(over.payload ?? PAYLOAD());
			case 'get_github_status':
				return Promise.resolve(over.status ?? IN);
			case 'get_github_groups':
				return Promise.resolve(over.groups ?? []);
			case 'edit_github_groups':
				return Promise.resolve(over.edited ?? []);
			case 'search_github':
				return Promise.resolve(
					over.search ?? {
						generation: (args as { generation: number }).generation,
						repos: over.searchRepos ?? []
					}
				);
			default:
				return Promise.resolve(null);
		}
	});

const called = (cmd: string) =>
	invoke.mock.calls.filter(c => (c as unknown[])[0] === cmd).length;
const arg = (cmd: string) =>
	invoke.mock.calls.find(c => (c as unknown[])[0] === cmd)?.[1];
// the newest call's payload, for the assertions about a second ask
const lastArg = (cmd: string) => {
	const all = invoke.mock.calls.filter(c => (c as unknown[])[0] === cmd);
	return all[all.length - 1]?.[1];
};

// the status read sits behind a 250 ms defer and live search behind a 400 ms
// one, so the clock is the test's to turn. advanceTimersByTimeAsync drains
// the promise chains each timer starts
const tick = (ms = 0) =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});

const NO_PROJECTS: Project[] = [];
const NO_GIT = new Map<string, GitInfo>();

// mounted and settled: the cache and the groups have landed and the
// deferred gh status has too, which is the state the lane really renders in
const mount = async (over: Wired = {}) => {
	wire(over);
	const h = renderHook(() => useGithub(NO_PROJECTS, NO_GIT));
	await tick(250);
	return h;
};

const emit = (p: GithubUpdated) =>
	act(async () => {
		fire?.(p);
		await vi.advanceTimersByTimeAsync(0);
	});

beforeEach(() => {
	vi.useFakeTimers();
	invoke.mockReset();
	localStorage.clear();
	listened = null;
	fire = null;
});
afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
});

describe('useGithub — what launch is allowed to cost', () => {
	// the cache is a file and the groups are a file; `gh --version` and
	// `gh config get` are two process spawns, and they are deferred so the
	// first paint does not wait on them
	it('reads the two files at once and defers the gh spawns behind the paint', async () => {
		wire({ payload: PAYLOAD({ stale: false }) });
		const h = renderHook(() => useGithub(NO_PROJECTS, NO_GIT));
		await tick(0);

		expect(called('get_github_repos')).toBe(1);
		expect(called('get_github_groups')).toBe(1);
		expect(called('get_github_status')).toBe(0);

		await tick(250);
		expect(called('get_github_status')).toBe(1);
		// and nothing has reached the network: every automatic fetch is
		// governed by the stale-on-open rule, and this cache is fresh
		expect(called('refresh_github_repos')).toBe(0);
		h.unmount();
	});

	// the name is rust's, and a typo here is a lane that spins forever with
	// no error anywhere
	it('subscribes to the event name rust emits', async () => {
		await mount();
		expect(listened).toBe('devgo://github-updated');
	});

	// the local mark is rust's answer over the projects listed and the
	// remotes the badge pass read, so a new clone or a fresh badge has to
	// re-read it — that is the only reason this effect names those two
	it('re-reads the cache when the project list changes', async () => {
		wire({});
		const { rerender } = renderHook(
			(p: { projects: Project[] }) => useGithub(p.projects, NO_GIT),
			{ initialProps: { projects: NO_PROJECTS } }
		);
		await tick(250);
		expect(called('get_github_repos')).toBe(1);

		await act(async () => {
			rerender({ projects: [] });
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(called('get_github_repos')).toBe(2);
	});
});

describe('useGithub — whether the lane is open decides whether anything fetches', () => {
	// ⭐ a first run has no cache, so the lane starts CLOSED and the very
	// first fetch is a click on the header. otherwise launching DevGo for
	// the first time spends a gh repo list nobody asked for
	it('starts closed with no cache, and fetches nothing however stale that is', async () => {
		const { result } = await mount({
			payload: PAYLOAD({ stale: true, cache: { fetched_at: 0 } })
		});

		expect(result.current.isOpen).toBe(false);
		expect(called('refresh_github_repos')).toBe(0);
	});

	it('opens itself once there is a cache to show', async () => {
		const { result } = await mount();
		expect(result.current.isOpen).toBe(true);
	});

	it('lets a remembered choice beat the presence of a cache', async () => {
		localStorage.setItem('devgo.githubLane', 'closed');
		const { result } = await mount();

		expect(result.current.isOpen).toBe(false);
		act(() => result.current.toggleOpen());
		expect(localStorage.getItem('devgo.githubLane')).toBe('open');
	});
});

describe('useGithub — the one automatic fetch and its whole condition', () => {
	it('refreshes a stale cache when the lane is open and gh is logged in', async () => {
		const { result } = await mount({ payload: PAYLOAD({ stale: true }) });

		expect(called('refresh_github_repos')).toBe(1);
		expect(result.current.refreshing).toBe(true);
	});

	// ⭐ the signed-out path: `gh repo list` without a login is an error, not
	// an empty list, so the rule must not fire and the lane must keep showing
	// the cache it has
	it('never refreshes while gh is signed out, however often the lane is toggled', async () => {
		const { result } = await mount({
			payload: PAYLOAD({ stale: true }),
			status: OUT
		});

		expect(called('refresh_github_repos')).toBe(0);
		act(() => result.current.toggleOpen());
		act(() => result.current.toggleOpen());
		await tick(0);
		expect(called('refresh_github_repos')).toBe(0);
	});

	// the rule is once a session: a lane the user opens and shuts while
	// waiting must not queue a second gh run behind the first
	it('fires once a session, not once per open', async () => {
		const { result } = await mount({ payload: PAYLOAD({ stale: true }) });

		expect(called('refresh_github_repos')).toBe(1);
		act(() => result.current.toggleOpen());
		act(() => result.current.toggleOpen());
		await tick(0);
		expect(called('refresh_github_repos')).toBe(1);
	});

	it('leaves a cache rust calls fresh alone', async () => {
		await mount({ payload: PAYLOAD({ stale: false }) });
		expect(called('refresh_github_repos')).toBe(0);
	});
});

describe('useGithub — signed out is not the same as unavailable', () => {
	// the cached list is the user's own and is worth showing; only the
	// heading's tense changes. `available` gating on the login would blank
	// the whole lane on a `gh auth logout`
	it('stays available signed out as long as there is a cache', async () => {
		const { result } = await mount({
			status: { installed: false, version: null, login: null }
		});
		expect(result.current.available).toBe(true);
	});

	it('is available with gh installed and no cache at all', async () => {
		const { result } = await mount({
			payload: PAYLOAD({ cache: { fetched_at: 0 } }),
			status: OUT
		});
		expect(result.current.available).toBe(true);
	});

	it('is unavailable with no cache and no gh', async () => {
		const { result } = await mount({
			payload: PAYLOAD({ cache: { fetched_at: 0 } }),
			fail: ['get_github_status']
		});

		expect(result.current.status).toBeNull();
		expect(result.current.available).toBe(false);
	});
});

describe('useGithub — the refresh and the answer that comes back as an event', () => {
	// the header says "refreshing" the instant the button is pressed, and
	// must stop saying it if the ask itself never started
	it('says refreshing at once and stops if rust refuses the ask', async () => {
		const { result } = await mount({ fail: ['refresh_github_repos'] });

		await act(async () => {
			result.current.refresh();
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.refreshing).toBe(false);
	});

	// a failed refresh must NOT re-read the cache: the file is unchanged and
	// a re-read would only repaint the same rows under a cleared error
	it('names the error and keeps the cache it had when the refresh fails', async () => {
		const { result } = await mount({ payload: PAYLOAD({ stale: true }) });
		const before = called('get_github_repos');

		await emit({ ok: false, error: 'gh: HTTP 401' });
		expect(result.current.lastError).toBe('gh: HTTP 401');
		expect(result.current.refreshing).toBe(false);
		expect(called('get_github_repos')).toBe(before);
	});

	it('clears the error and re-reads the cache when the refresh succeeds', async () => {
		const { result } = await mount({ payload: PAYLOAD({ stale: true }) });
		await emit({ ok: false, error: 'gh: HTTP 401' });
		const before = called('get_github_repos');

		await emit({ ok: true, error: null });
		expect(result.current.lastError).toBeNull();
		expect(result.current.refreshing).toBe(false);
		expect(called('get_github_repos')).toBe(before + 1);
	});

	// an ok:false with no message still has to say something, or the lane
	// shows a cleared error and no explanation
	it('invents a sentence when rust sends a failure with no message', async () => {
		const { result } = await mount({ payload: PAYLOAD({ stale: true }) });

		await emit({ ok: false, error: null });
		expect(result.current.lastError).toBe('GitHub refresh failed');
	});
});

describe('useGithub — the row order the keyboard walks', () => {
	const repos = [REPO('joy/a'), REPO('joy/b')];
	const grouped = {
		payload: PAYLOAD({ cache: { repos } }),
		groups: [{ name: 'Work', repos: ['joy/a'] }]
	};

	// the groups in order and then the ungrouped tail — and a repo in a
	// group appears ONCE: the tail is what is in no group, not everything
	it('puts the groups first and never repeats a grouped repo in the tail', async () => {
		const { result } = await mount(grouped);

		expect(result.current.visible.map(r => r.full_name)).toEqual([
			'joy/a',
			'joy/b'
		]);
		expect(result.current.sections?.map(s => s.group)).toEqual(['Work', null]);
	});

	// a folded group contributes nothing, exactly as a collapsed workspace:
	// if it still contributed, the keyboard would walk rows nobody can see
	it('drops a folded group out of the walk', async () => {
		const { result } = await mount(grouped);

		act(() => result.current.toggleGroup('Work'));
		expect(result.current.visible.map(r => r.full_name)).toEqual(['joy/b']);
		expect(localStorage.getItem('devgo.githubGroupsFolded')).toBe('["Work"]');
	});

	it('drops the recents tail out of the walk when it is switched off', async () => {
		const { result } = await mount(grouped);

		act(() => result.current.toggleRecents());
		expect(result.current.visible.map(r => r.full_name)).toEqual(['joy/a']);
		expect(localStorage.getItem('devgo.githubRecents')).toBe('off');
	});

	// a group naming a repo the cache no longer carries must still walk, or
	// the only row that could unassign it is unreachable
	it('keeps a row for a repo the cache lost and marks it gone', async () => {
		const { result } = await mount({
			payload: PAYLOAD({ cache: { repos: [REPO('joy/b')] } }),
			groups: [{ name: 'Work', repos: ['joy/ghost'] }]
		});

		expect(result.current.visible.map(r => r.full_name)).toEqual([
			'joy/ghost',
			'joy/b'
		]);
		expect([...(result.current.sections?.[0].gone ?? [])]).toEqual([
			'joy/ghost'
		]);
	});

	// every edit goes through one command that returns the whole list, so
	// the hook never predicts what the store did with it
	it('takes the group list rust returned rather than predicting the edit', async () => {
		const { result } = await mount({
			groups: [{ name: 'Work', repos: [] }],
			edited: [{ name: 'Day job', repos: ['joy/a'] }]
		});

		await act(async () => {
			await result.current.editGroups({
				op: 'rename',
				from: 'Work',
				to: 'Day job'
			});
		});
		expect(arg('edit_github_groups')).toEqual({
			edit: { op: 'rename', from: 'Work', to: 'Day job' }
		});
		expect(result.current.groups).toEqual([
			{ name: 'Day job', repos: ['joy/a'] }
		]);
	});
});

describe('useGithub — live search: three gates before a keystroke is a network call', () => {
	const live = {
		payload: PAYLOAD({ live_search: true, cache: { repos: [REPO('joy/devgo')] } })
	};

	it('waits for the box to be still before it asks github anything', async () => {
		const { result } = await mount(live);

		act(() => result.current.setQuery('devgo'));
		await tick(399);
		expect(called('search_github')).toBe(0);
		expect(result.current.searching).toBe(true);

		await tick(1);
		expect(called('search_github')).toBe(1);
		expect(arg('search_github')).toEqual({ query: 'devgo', generation: 1 });
	});

	it('asks nothing under three characters', async () => {
		const { result } = await mount(live);

		act(() => result.current.setQuery('de'));
		await tick(1000);
		expect(called('search_github')).toBe(0);
		expect(result.current.searching).toBe(false);
	});

	it('asks nothing while gh is signed out', async () => {
		const { result } = await mount({ ...live, status: OUT });

		act(() => result.current.setQuery('devgo'));
		await tick(1000);
		expect(called('search_github')).toBe(0);
	});

	it('asks nothing while the lane is shut', async () => {
		localStorage.setItem('devgo.githubLane', 'closed');
		const { result } = await mount(live);

		act(() => result.current.setQuery('devgo'));
		await tick(1000);
		expect(called('search_github')).toBe(0);
	});

	it('asks nothing while the switch in settings is off', async () => {
		const { result } = await mount({
			payload: PAYLOAD({ live_search: false, cache: { repos: [REPO('joy/devgo')] } })
		});

		act(() => result.current.setQuery('devgo'));
		await tick(1000);
		expect(called('search_github')).toBe(0);
		expect(result.current.liveOn).toBe(false);
	});

	it('sends the switch to rust and re-reads what it stored', async () => {
		const { result } = await mount();

		await act(async () => {
			await result.current.setLiveSearch(true);
		});
		expect(arg('set_github_live_search')).toEqual({ on: true });
		expect(called('get_github_repos')).toBe(2);
	});
});

describe('useGithub — what the live hits are allowed to add', () => {
	const live = (searchRepos: GithubRepo[]) => ({
		payload: PAYLOAD({
			live_search: true,
			cache: { repos: [REPO('joy/devgo')] }
		}),
		searchRepos
	});

	// the cache already answers with joy/devgo; listing it again under
	// "more on github" is the same row twice in one list
	it('lists only the hits the cache does not already answer with', async () => {
		const { result } = await mount(
			live([REPO('joy/devgo'), REPO('other/devgo-fork')])
		);

		act(() => result.current.setQuery('devgo'));
		await tick(400);
		expect(result.current.cacheMatches?.map(r => r.full_name)).toEqual([
			'joy/devgo'
		]);
		expect(result.current.liveExtras.map(r => r.full_name)).toEqual([
			'other/devgo-fork'
		]);
		expect(result.current.visible.map(r => r.full_name)).toEqual([
			'joy/devgo',
			'other/devgo-fork'
		]);
	});

	// a fast typist: the answer for the query they left must not sit under
	// the heading of the query they are on
	it('drops the hits for a query the user has already left', async () => {
		const { result } = await mount(live([REPO('other/devgo-fork')]));

		act(() => result.current.setQuery('devgo'));
		await tick(400);
		expect(result.current.liveExtras.length).toBe(1);

		act(() => result.current.setQuery('devgozz'));
		expect(result.current.liveExtras).toEqual([]);
		expect(result.current.visible).toEqual([]);
	});

	// the generation stamp: an answer to an older request is dropped, so a
	// slow first call cannot overwrite a fast second one
	it('drops an answer stamped with a generation that is no longer current', async () => {
		const { result } = await mount({
			payload: PAYLOAD({
				live_search: true,
				cache: { repos: [REPO('joy/devgo')] }
			}),
			search: { generation: 999, repos: [REPO('other/devgo-fork')] }
		});

		act(() => result.current.setQuery('devgo'));
		await tick(400);
		expect(called('search_github')).toBe(1);
		expect(result.current.liveExtras).toEqual([]);
		// ⭐ and the spinner comes down with the request. it used to stay on
		// for the life of the query, waiting for a keystroke the user has no
		// way to know is what clears it: nothing is in flight, so a spinner
		// is a claim that work is happening when none is
		expect(result.current.searching).toBe(false);
	});

	// the same rule for the other way a request ends with nothing: gh was
	// not there, the token was refused, rust said no
	it('stops claiming to be searching when the search itself fails', async () => {
		const { result } = await mount({
			payload: PAYLOAD({
				live_search: true,
				cache: { repos: [REPO('joy/devgo')] }
			}),
			fail: ['search_github']
		});

		act(() => result.current.setQuery('devgo'));
		await tick(400);
		expect(called('search_github')).toBe(1);
		expect(result.current.searching).toBe(false);
		// the cache still answers: a dead live search costs the extras, not
		// the rows the lane already had
		expect(result.current.cacheMatches?.map(r => r.full_name)).toEqual([
			'joy/devgo'
		]);
	});

	// a query that came back with nothing is re-armed, not spent: the next
	// keystroke is a new query and asks again
	it('searches again on the next keystroke after a request came back empty-handed', async () => {
		const { result } = await mount({
			payload: PAYLOAD({
				live_search: true,
				cache: { repos: [REPO('joy/devgo')] }
			}),
			fail: ['search_github']
		});

		act(() => result.current.setQuery('devgo'));
		await tick(400);
		expect(result.current.searching).toBe(false);

		act(() => result.current.setQuery('devgoz'));
		expect(result.current.searching).toBe(true);
		await tick(400);
		expect(called('search_github')).toBe(2);
		expect(lastArg('search_github')).toEqual({
			query: 'devgoz',
			generation: 2
		});
	});

	// ⭐ and the same query typed again is a new ask, not a spent one: clear
	// the box after a failure, type the very same word, and the lane must
	// search rather than sit there with the results it never got
	it('searches again when the query that came back empty-handed is retyped', async () => {
		const { result } = await mount({
			payload: PAYLOAD({
				live_search: true,
				cache: { repos: [REPO('joy/devgo')] }
			}),
			fail: ['search_github']
		});

		act(() => result.current.setQuery('devgo'));
		await tick(400);
		expect(called('search_github')).toBe(1);

		// the box cleared: under three characters nothing is asked and
		// nothing is claimed
		act(() => result.current.setQuery(''));
		expect(result.current.searching).toBe(false);

		act(() => result.current.setQuery('devgo'));
		expect(result.current.searching).toBe(true);
		await tick(400);
		expect(called('search_github')).toBe(2);
	});
});

describe('useGithub — the refresh spinner has a ceiling', () => {
	// ⭐ the event is the ONLY thing that used to lower it, and a gh child
	// blocked on a socket never emits one: Command::output() waits forever,
	// the thread never finishes, and the header spun for the whole session
	it('brings the spinner down and names the timeout when nothing ever answers', async () => {
		const { result } = await mount({ payload: PAYLOAD({ stale: true }) });
		expect(result.current.refreshing).toBe(true);

		// a slow success must not be called a failure: five minutes is
		// fourteen owners at the slow-day price rust documents
		await tick(299_999);
		expect(result.current.refreshing).toBe(true);
		expect(result.current.lastError).toBeNull();

		await tick(1);
		expect(result.current.refreshing).toBe(false);
		expect(result.current.lastError).toBe(
			'GitHub refresh timed out after 5 minutes; gh never answered'
		);
	});

	// the clock belongs to one refresh: left running past the answer it
	// would fire over an idle header and invent a failure out of nothing
	it('clears the ceiling when the event answers in time', async () => {
		const { result } = await mount({ payload: PAYLOAD({ stale: true }) });

		await tick(120_000);
		await emit({ ok: true, error: null });
		expect(result.current.refreshing).toBe(false);

		await tick(300_000);
		expect(result.current.lastError).toBeNull();
		expect(result.current.refreshing).toBe(false);
	});

	// the answer that turns up after the ceiling has fired is still the
	// answer — it may repaint the rows and clear the error, but it may not
	// put the spinner back up
	it('lets a late event answer without resurrecting the spinner', async () => {
		const { result } = await mount({ payload: PAYLOAD({ stale: true }) });
		await tick(300_000);
		const before = called('get_github_repos');

		await emit({ ok: true, error: null });
		expect(result.current.refreshing).toBe(false);
		expect(result.current.lastError).toBeNull();
		expect(called('get_github_repos')).toBe(before + 1);
	});

	// rust raises the spinner too: a payload saying a refresh is in flight
	// is a thread this window never started and may already have lost
	it('puts the same ceiling over a refresh rust says is already in flight', async () => {
		const { result } = await mount({ payload: PAYLOAD({ refreshing: true }) });
		expect(result.current.refreshing).toBe(true);

		await tick(300_000);
		expect(result.current.refreshing).toBe(false);
		expect(result.current.lastError).toBe(
			'GitHub refresh timed out after 5 minutes; gh never answered'
		);
	});

	// a timer outliving its component is a state update nobody reads, and
	// on a lane that unmounts and remounts, one per mount
	it('leaves no timer behind when the lane unmounts mid-refresh', async () => {
		const h = await mount({ payload: PAYLOAD({ stale: true }) });
		expect(h.result.current.refreshing).toBe(true);
		expect(vi.getTimerCount()).toBe(1);

		h.unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('useGithub — the org choice', () => {
	// null is "every org in cache.orgs", which is not the same as an empty
	// list, and the difference has to survive the boundary
	it('sends null for every org rather than an empty list', async () => {
		const { result } = await mount();

		await act(async () => {
			await result.current.setOrgs(null);
		});
		expect(arg('set_github_orgs')).toEqual({ orgs: null });
		expect(called('get_github_repos')).toBe(2);
	});
});
