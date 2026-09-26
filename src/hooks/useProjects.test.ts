import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjects } from './useProjects';

// the one boundary every component test in this tree stubs, for the same
// reason: these commands spawn wsl.exe and git.exe. this hook is the busiest
// caller of them in the app, and what it must NOT call is half its contract
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

// the second trigger, and the only one the user does not choose. the real
// window fires it on every summon; holding the callback lets a test fire it
// at a chosen moment, which is the only way the cooldown is observable
let onFocus: ((e: { payload: boolean }) => void) | null = null;
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: (cb: (e: { payload: boolean }) => void) => {
			onFocus = cb;
			return Promise.resolve(unlisten);
		}
	})
}));

const proj = (name: string, workspace = 'C:/dev'): Project => ({
	name,
	full_path: `${workspace}/${name}`,
	workspace,
	file_system: 'windows'
});

const ws = (
	workspace: string,
	over: Partial<WorkspaceState> = {}
): WorkspaceState => ({
	workspace,
	status: 'live',
	reason: null,
	scanned_at: 1_700_000_000,
	count: 0,
	...over
});

const rank = (full_path: string, over: Partial<ProjectRank> = {}): ProjectRank => ({
	full_path,
	score: 0,
	launch_count: 0,
	last_opened: 0,
	hint: null,
	pinned: false,
	...over
});

// ranks default to one per project, which is what rust sends; a test that
// cares about score or pinned hands its own
const payload = (
	projects: Project[],
	over: Partial<ProjectsPayload> = {}
): ProjectsPayload => ({
	projects,
	workspaces: [...new Set(projects.map(p => p.workspace))].map(w =>
		ws(w, { count: projects.filter(p => p.workspace === w).length })
	),
	ranks: projects.map(p => rank(p.full_path)),
	...over
});

const EMPTY = payload([]);

// ⭐ every answer is a FRESH object, because rust's is: the retry effect keys
// off the identity of the workspaces array, so a mock that handed back the
// same array twice would silently stop the retry chain a real IPC continues
const fresh = (p: ProjectsPayload): ProjectsPayload => ({
	projects: [...p.projects],
	workspaces: [...p.workspaces],
	ranks: [...p.ranks]
});

type Wiring = {
	cached?: ProjectsPayload;
	list?: ProjectsPayload;
	/// the second and later answers to get_projects — a retry or a refresh
	next?: ProjectsPayload;
	forced?: ProjectsPayload;
	workspace?: ProjectsPayload;
	last?: LastProject | null;
	/// last_commit per path, for the activity sort
	commits?: Record<string, number>;
	/// paths with a live tmux session
	sessions?: string[];
	pin?: boolean;
	fail?: string[];
};

// one place that decides what each command answers. the three badge commands
// answer for exactly the projects they were ASKED about, which is the only way
// a merge (one workspace re-read) is distinguishable from a replace
const wire = (over: Wiring = {}) => {
	let lists = 0;
	invoke.mockImplementation((cmd: string, args?: unknown) => {
		if (over.fail?.includes(cmd)) return Promise.reject(new Error(cmd));
		const asked = () => ((args as { projects?: Project[] })?.projects ?? []);
		switch (cmd) {
			case 'get_cached_projects':
				return Promise.resolve(fresh(over.cached ?? EMPTY));
			case 'get_projects':
				lists += 1;
				return Promise.resolve(
					fresh((lists > 1 ? over.next : undefined) ?? over.list ?? EMPTY)
				);
			case 'refresh_projects':
				return Promise.resolve(fresh(over.forced ?? over.next ?? over.list ?? EMPTY));
			case 'refresh_workspace':
				return Promise.resolve(fresh(over.workspace ?? EMPTY));
			case 'get_last_project':
				return Promise.resolve(over.last ?? null);
			case 'get_git_info':
				return Promise.resolve(
					asked().map(p => ({
						full_path: p.full_path,
						branch: 'main',
						dirty: false,
						remote: null,
						last_commit: over.commits?.[p.full_path] ?? 0,
						remote_branches: null
					}))
				);
			case 'get_project_tech':
				return Promise.resolve(
					asked().map(p => ({
						full_path: p.full_path,
						tags: ['node'],
						package_manager: 'bun',
						pins_node_version: false,
						has_deps: true
					}))
				);
			case 'get_live_sessions':
				return Promise.resolve(
					asked()
						.filter(p => over.sessions?.includes(p.full_path))
						.map(p => p.full_path)
				);
			case 'toggle_pin':
				return Promise.resolve(over.pin ?? true);
			default:
				return Promise.resolve(null);
		}
	});
	// handed back so a test can change an answer mid-flight
	return over;
};

const calls = (cmd: string) =>
	invoke.mock.calls.filter(c => (c as unknown[])[0] === cmd);
const called = (cmd: string) => calls(cmd).length;
const argsOf = (cmd: string, nth = 0) => calls(cmd)[nth]?.[1];

// ⭐ a requestAnimationFrame OUTLIVES the test that scheduled it. the hook
// sends mark_startup from inside a frame, right after painting a non-empty
// cache (useProjects.ts:243) — and jsdom runs that frame ~16 ms later, while
// settle() below is a 0 ms macrotask. so a test that paints a cached list and
// never waits for the marker ends with the frame still PENDING: it fires
// during a later test, after beforeEach's invoke.mockReset(), and its invoke
// lands in that test's call log. that is how `does not mark a first list that
// never appeared` read one mark_startup for a state its own hook cannot send
// one in — a foreign call, not a product bug. it needs the two tests adjacent,
// which source order is not: `--sequence.shuffle --sequence.seed=20` is.
//
// so every frame is tracked and afterEach cancels whatever is still pending: a
// frame dies with the test that asked for it. in afterEach rather than inside
// the one guilty test on purpose — the next test someone writes over a cached
// paint is covered without having to know any of this first.
const frames = new Set<number>();
const realFrame = globalThis.requestAnimationFrame.bind(globalThis);
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
	const id = realFrame(cb);
	frames.add(id);
	return id;
});
// only ever holds REAL ids: under fake timers vitest swaps the global out from
// under the stub, and useRealTimers() drops that clock's frames with it — so
// this runs after the clock is back, when the ids and the canceller match
const dropPendingFrames = () => {
	for (const id of frames) cancelAnimationFrame(id);
	frames.clear();
};

// a macrotask inside act: the mount effect chains get_cached_projects, a pass
// and get_last_project, and only a turn of the loop has drained all of it
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const tick = (ms: number) =>
	act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const mounted = async () => {
	const h = renderHook(() => useProjects());
	await settle();
	return h;
};

const deferred = <T,>() => {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>(r => { resolve = r; });
	return { promise, resolve };
};

afterEach(() => {
	vi.useRealTimers();
	dropPendingFrames();
	onFocus = null;
});
beforeEach(() => {
	invoke.mockReset();
	unlisten.mockClear();
	// the sort mode is read out of localStorage at mount, so a test that
	// toggles it would otherwise choose the next test's starting mode
	localStorage.clear();
});

describe('useProjects — what is on screen before the scan answers', () => {
	// the cache exists so the window opens on a list instead of a spinner. a
	// paint that left loading true would show the spinner over the list, and
	// the whole point is the first frame
	it('paints the cached list and drops the spinner before the live pass answers', async () => {
		const live = deferred<ProjectsPayload>();
		wire({ cached: payload([proj('devgo'), proj('zetta')]) });
		const base = invoke.getMockImplementation()!;
		invoke.mockImplementation((cmd: string, args?: unknown) =>
			cmd === 'get_projects' ? live.promise : base(cmd, args)
		);
		const { result } = await mounted();

		expect(result.current.projects.map(p => p.name)).toEqual(['devgo', 'zetta']);
		expect(result.current.loading).toBe(false);
		// and the cache costs nothing else: no git, no tech, no tmux
		expect(called('get_git_info')).toBe(0);
		expect(called('get_live_sessions')).toBe(0);

		await act(async () => { live.resolve(payload([proj('devgo')])); });
	});

	// ⛔ first run has no cache. painting an empty list with loading false says
	// "you have no projects", which is a different sentence from "still looking"
	it('keeps the spinner on an empty cache instead of claiming an empty list', async () => {
		const live = deferred<ProjectsPayload>();
		wire({ cached: EMPTY });
		const base = invoke.getMockImplementation()!;
		invoke.mockImplementation((cmd: string, args?: unknown) =>
			cmd === 'get_projects' ? live.promise : base(cmd, args)
		);
		const { result } = await mounted();

		expect(result.current.loading).toBe(true);
		expect(result.current.projects).toEqual([]);

		await act(async () => { live.resolve(payload([proj('devgo')])); });
		await settle();
		expect(result.current.loading).toBe(false);
		expect(result.current.projects.map(p => p.name)).toEqual(['devgo']);
	});

	// the startup marker measures time-to-first-list, so it may only be sent
	// when a list actually reached the screen
	it('marks the first list only when a cache was there to show', async () => {
		wire({ cached: payload([proj('devgo')]), list: payload([proj('devgo')]) });
		await mounted();
		await waitFor(() =>
			expect(calls('mark_startup').length).toBeGreaterThan(0)
		);
		expect(argsOf('mark_startup')).toEqual({ stage: 'first-list' });
	});

	it('does not mark a first list that never appeared', async () => {
		wire({ cached: EMPTY, list: payload([proj('devgo')]) });
		await mounted();
		await settle();
		expect(called('mark_startup')).toBe(0);
	});

	// the cache is a convenience; losing it must not cost the real list
	it('still lands the live list when the cache read fails', async () => {
		wire({ list: payload([proj('devgo')]), fail: ['get_cached_projects'] });
		const { result } = await mounted();

		expect(result.current.projects.map(p => p.name)).toEqual(['devgo']);
		expect(result.current.loading).toBe(false);
	});
});

describe('useProjects — the selection that survives a restart', () => {
	it('re-selects the saved project when it is still in the list', async () => {
		wire({
			list: payload([proj('devgo'), proj('zetta')]),
			last: { full_path: 'C:/dev/zetta', workspace: 'C:/dev' }
		});
		const { result } = await mounted();

		expect(result.current.selected?.name).toBe('zetta');
		// the object out of the payload, not a reconstruction of it
		expect(result.current.selected).toBe(
			result.current.projects.find(p => p.name === 'zetta')
		);
	});

	// the saved project was deleted or its disk is detached: selecting a path
	// that is not on the list arms every action in the app against a ghost
	it('selects nothing when the saved project is no longer there', async () => {
		wire({
			list: payload([proj('devgo')]),
			last: { full_path: 'C:/dev/gone', workspace: 'C:/dev' }
		});
		const { result } = await mounted();

		expect(result.current.selected).toBeNull();
	});

	// the payload rust stores, and only it: name and file_system are scan
	// output that would be stale on the next launch
	it('persists the path and the workspace, and nothing else', async () => {
		wire({ list: payload([proj('devgo')]) });
		const { result } = await mounted();

		await act(async () => {
			result.current.setSelected(proj('zetta', 'D:/work'));
		});

		expect(argsOf('set_last_project')).toEqual({
			project: { full_path: 'D:/work/zetta', workspace: 'D:/work' }
		});
	});

	it('writes nothing when the selection is cleared', async () => {
		wire({ list: payload([proj('devgo')]) });
		const { result } = await mounted();

		await act(async () => { result.current.setSelected(null); });

		expect(result.current.selected).toBeNull();
		expect(called('set_last_project')).toBe(0);
	});
});

// ⭐ the perf contract this hook's comments are mostly about: one refresh is
// nine wsl.exe and ~20 git.exe, and a launch hands focus back
describe('useProjects — when the badges are paid for', () => {
	it('asks for git, stack and sessions for exactly the list it just got', async () => {
		const list = payload([proj('devgo'), proj('zetta')]);
		wire({ list });
		await mounted();

		expect(called('get_git_info')).toBe(1);
		expect(argsOf('get_git_info')).toEqual({ projects: list.projects });
		expect(argsOf('get_project_tech')).toEqual({ projects: list.projects });
		expect(argsOf('get_live_sessions')).toEqual({ projects: list.projects });
	});

	// `if (list.length === 0) return` — three commands that can only answer
	// "nothing", each one a process spawn, on every empty pass
	it('asks for no badges at all when the list is empty', async () => {
		wire({ list: EMPTY });
		await mounted();

		expect(called('get_git_info')).toBe(0);
		expect(called('get_project_tech')).toBe(0);
		expect(called('get_live_sessions')).toBe(0);
	});

	it('does not pay for badges again when a pass lists what it already badged', async () => {
		wire({ list: payload([proj('devgo'), proj('zetta')]) });
		const { result } = await mounted();
		expect(called('get_git_info')).toBe(1);

		await act(async () => { await result.current.refresh(); });

		expect(called('get_projects')).toBe(2);
		expect(called('get_git_info')).toBe(1);
	});

	// the one case a cheap pass still pays: a workspace that just attached
	// brings paths nothing has ever read a branch for, and a bare row is worse
	// than a slow one
	it('re-reads badges when a pass brings a project it has never badged', async () => {
		const next = payload([proj('devgo'), proj('zetta'), proj('fresh')]);
		wire({ list: payload([proj('devgo'), proj('zetta')]), next });
		const { result } = await mounted();

		await act(async () => { await result.current.refresh(); });

		expect(called('get_git_info')).toBe(2);
		// the whole list, not just the newcomer
		expect(argsOf('get_git_info', 1)).toEqual({ projects: next.projects });
	});

	it('always re-reads badges on an explicit refresh', async () => {
		wire({ list: payload([proj('devgo')]) });
		const { result } = await mounted();

		await act(async () => { await result.current.refresh(true); });

		expect(called('get_git_info')).toBe(2);
	});

	// a branch name from a project that left the list is worse than none: the
	// map is keyed by path and a re-added path would show yesterday's branch
	it('replaces the branch and stack maps on a full pass', async () => {
		wire({
			list: payload([proj('devgo'), proj('zetta')]),
			forced: payload([proj('devgo')])
		});
		const { result } = await mounted();
		expect([...result.current.git.keys()]).toHaveLength(2);

		await act(async () => { await result.current.refresh(true); });

		expect([...result.current.git.keys()]).toEqual(['C:/dev/devgo']);
		expect([...result.current.tech.keys()]).toEqual(['C:/dev/devgo']);
	});

	// neither gates the list, and neither may take it down with it
	it('keeps the list when a badge pass fails', async () => {
		wire({ list: payload([proj('devgo')]), fail: ['get_git_info'] });
		const { result } = await mounted();

		expect(result.current.projects.map(p => p.name)).toEqual(['devgo']);
		expect(result.current.git.size).toBe(0);
		// and the independent ones still landed
		expect(result.current.tech.size).toBe(1);
	});

	it('marks a project with a live session, and forgets it after a kill', async () => {
		wire({ list: payload([proj('devgo'), proj('zetta')]), sessions: ['C:/dev/zetta'] });
		const { result } = await mounted();
		expect([...result.current.sessions]).toEqual(['C:/dev/zetta']);

		await act(async () => { result.current.forgetSession('C:/dev/zetta'); });
		expect(result.current.sessions.size).toBe(0);
	});

	// the early return in forgetSession: a kill for a project with no session
	// must not hand react a new Set and re-render every row
	it('keeps the same session set when told to forget a path it never had', async () => {
		wire({ list: payload([proj('devgo')]), sessions: ['C:/dev/devgo'] });
		const { result } = await mounted();
		const before = result.current.sessions;

		await act(async () => { result.current.forgetSession('C:/dev/nothing'); });
		expect(result.current.sessions).toBe(before);
	});
});

describe('useProjects — which command a refresh is', () => {
	// ⛔ force is the ONLY path allowed to boot a stopped distro. a refresh
	// that sent force:true by default would make opening the window start WSL
	it('an explicit refresh forces, a plain one does not', async () => {
		wire({ list: payload([proj('devgo')]) });
		const { result } = await mounted();

		await act(async () => { await result.current.refresh(); });
		expect(called('refresh_projects')).toBe(0);
		expect(called('get_projects')).toBe(2);

		await act(async () => { await result.current.refresh(true); });
		expect(argsOf('refresh_projects')).toEqual({ force: true });
	});

	// the finally in runPass. a stuck spinner over a stale list is the failure
	// mode that needs a restart to clear
	it('clears the spinner when a pass fails, and lets the next one run', async () => {
		const w = wire({ list: payload([proj('devgo')]), fail: ['get_projects'] });
		const { result } = await mounted();

		expect(result.current.loading).toBe(false);
		expect(result.current.projects).toEqual([]);

		w.fail = [];
		await act(async () => { await result.current.refresh(); });
		expect(result.current.projects.map(p => p.name)).toEqual(['devgo']);
		expect(result.current.loading).toBe(false);
	});
});

// the header's per-workspace refresh: the list stays on screen and only that
// workspace's slice changes
describe('useProjects — refreshing one workspace', () => {
	const twoWorkspaces = payload([
		proj('alpha', 'C:/dev'),
		proj('beta', '//wsl/ubuntu'),
		proj('gamma', 'C:/dev')
	]);

	it('names the workspace it asks for', async () => {
		wire({ list: twoWorkspaces, workspace: payload([proj('beta', '//wsl/ubuntu')]) });
		const { result } = await mounted();

		await act(async () => { await result.current.refreshWorkspace('//wsl/ubuntu'); });
		expect(argsOf('refresh_workspace')).toEqual({ workspace: '//wsl/ubuntu' });
	});

	it('replaces that workspace’s rows and leaves the others alone', async () => {
		wire({
			list: twoWorkspaces,
			workspace: payload([
				proj('beta', '//wsl/ubuntu'),
				proj('delta', '//wsl/ubuntu')
			])
		});
		const { result } = await mounted();

		await act(async () => { await result.current.refreshWorkspace('//wsl/ubuntu'); });

		expect(result.current.projects.map(p => p.name).sort()).toEqual([
			'alpha',
			'beta',
			'delta',
			'gamma'
		]);
	});

	it('upserts the header state, adding a workspace that was never listed', async () => {
		wire({
			list: payload([proj('alpha', 'C:/dev')]),
			workspace: payload([proj('beta', '//wsl/ubuntu')], {
				workspaces: [ws('//wsl/ubuntu', { count: 1 })]
			})
		});
		const { result } = await mounted();
		expect(result.current.workspaceStates.map(s => s.workspace)).toEqual(['C:/dev']);

		await act(async () => { await result.current.refreshWorkspace('//wsl/ubuntu'); });

		expect(result.current.workspaceStates.map(s => s.workspace)).toEqual([
			'C:/dev',
			'//wsl/ubuntu'
		]);
	});

	it('updates the header state in place rather than adding a second one', async () => {
		wire({
			list: twoWorkspaces,
			workspace: payload([proj('beta', '//wsl/ubuntu')], {
				workspaces: [ws('//wsl/ubuntu', { status: 'unavailable', reason: 'distro_stopped', count: 0 })]
			})
		});
		const { result } = await mounted();

		await act(async () => { await result.current.refreshWorkspace('//wsl/ubuntu'); });

		const states = result.current.workspaceStates.filter(
			s => s.workspace === '//wsl/ubuntu'
		);
		expect(states).toHaveLength(1);
		expect(states[0].reason).toBe('distro_stopped');
	});

	// a payload with no state for the asked workspace: keep the one on screen
	// rather than dropping the header's pill to nothing
	it('keeps the old header state when the answer carries none', async () => {
		wire({
			list: twoWorkspaces,
			workspace: payload([proj('beta', '//wsl/ubuntu')], { workspaces: [] })
		});
		const { result } = await mounted();

		await act(async () => { await result.current.refreshWorkspace('//wsl/ubuntu'); });
		expect(
			result.current.workspaceStates.map(s => s.workspace)
		).toEqual(['C:/dev', '//wsl/ubuntu']);
	});

	it('drops ranks for rows that left that workspace and keeps every other', async () => {
		wire({
			list: payload([proj('alpha', 'C:/dev'), proj('beta', '//wsl/ubuntu')], {
				ranks: [
					rank('C:/dev/alpha', { score: 9 }),
					rank('//wsl/ubuntu/beta', { score: 5 })
				]
			}),
			workspace: payload([proj('delta', '//wsl/ubuntu')], {
				ranks: [rank('//wsl/ubuntu/delta', { score: 3 })]
			})
		});
		const { result } = await mounted();

		await act(async () => { await result.current.refreshWorkspace('//wsl/ubuntu'); });

		expect([...result.current.ranks.keys()]).toEqual([
			'C:/dev/alpha',
			'//wsl/ubuntu/delta'
		]);
		expect(result.current.ranks.get('C:/dev/alpha')?.score).toBe(9);
	});

	// merge, not replace: a one-workspace pass asks for that workspace's
	// badges only, and replacing the map would strip every other row's branch
	it('merges the badges so no other row goes bare', async () => {
		wire({
			list: twoWorkspaces,
			workspace: payload([proj('delta', '//wsl/ubuntu')])
		});
		const { result } = await mounted();

		await act(async () => { await result.current.refreshWorkspace('//wsl/ubuntu'); });

		// it asked for the refreshed workspace alone
		expect(argsOf('get_git_info', 1)).toEqual({
			projects: [proj('delta', '//wsl/ubuntu')]
		});
		// and the other workspace's rows still have a branch
		expect(result.current.git.get('C:/dev/alpha')?.branch).toBe('main');
		expect(result.current.git.get('//wsl/ubuntu/delta')?.branch).toBe('main');
	});

	// the list is already on screen and the user pressed a per-workspace
	// control; raising the global spinner would blank the other workspaces
	it('never raises the spinner', async () => {
		const slow = deferred<ProjectsPayload>();
		wire({ list: twoWorkspaces });
		const base = invoke.getMockImplementation()!;
		invoke.mockImplementation((cmd: string, args?: unknown) =>
			cmd === 'refresh_workspace' ? slow.promise : base(cmd, args)
		);
		const { result } = await mounted();

		let pending!: Promise<unknown>;
		await act(async () => {
			pending = result.current.refreshWorkspace('//wsl/ubuntu');
		});
		expect(result.current.loading).toBe(false);

		await act(async () => {
			slow.resolve(payload([proj('beta', '//wsl/ubuntu')]));
			await pending;
		});
		expect(result.current.loading).toBe(false);
	});

	// refreshWorkspace appends the refreshed workspace's rows after every other
	// row, so `name` mode cannot lean on rust's order: it sorts for itself
	it('keeps the name-sorted list alphabetical after one workspace refresh', async () => {
		wire({
			list: twoWorkspaces,
			workspace: payload([proj('beta', '//wsl/ubuntu')])
		});
		const { result } = await mounted();
		await act(async () => { result.current.setSort('name'); });
		expect(result.current.filtered.map(p => p.name)).toEqual([
			'alpha',
			'beta',
			'gamma'
		]);

		await act(async () => { await result.current.refreshWorkspace('//wsl/ubuntu'); });

		// beta belongs between alpha and gamma, wherever the refresh put it
		expect(result.current.filtered.map(p => p.name)).toEqual([
			'alpha',
			'beta',
			'gamma'
		]);
	});
});

// ⛔ the rule this whole retry block exists to respect: a workspace on a
// virtual disk heals in seconds, a stopped distro is a decision
describe('useProjects — the retry budget', () => {
	const missing = payload([proj('alpha', 'D:/work')], {
		workspaces: [ws('D:/work', { status: 'unavailable', reason: 'not_mounted' })]
	});
	const stopped = payload([], {
		workspaces: [
			ws('//wsl/ubuntu', { status: 'unavailable', reason: 'distro_stopped' })
		]
	});

	it('retries a workspace that is merely missing, at 2s then 5s then 15s', async () => {
		vi.useFakeTimers();
		wire({ list: missing });
		renderHook(() => useProjects());
		await tick(0);
		expect(called('get_projects')).toBe(1);

		await tick(2_000);
		expect(called('get_projects')).toBe(2);
		await tick(5_000);
		expect(called('get_projects')).toBe(3);
		await tick(15_000);
		expect(called('get_projects')).toBe(4);
		// three delays, then it stops asking
		await tick(120_000);
		expect(called('get_projects')).toBe(4);
	});

	// ⛔ THE rule. auto-retrying a stopped distro makes DevGo boot WSL in the
	// background, which is the exact behaviour this app exists to prevent
	it('never retries a stopped distro', async () => {
		vi.useFakeTimers();
		wire({ list: stopped });
		renderHook(() => useProjects());
		await tick(0);
		expect(called('get_projects')).toBe(1);

		await tick(120_000);
		expect(called('get_projects')).toBe(1);
		expect(called('refresh_projects')).toBe(0);
	});

	it('stops retrying as soon as the workspace comes back', async () => {
		vi.useFakeTimers();
		wire({ list: missing, next: payload([proj('alpha', 'D:/work')]) });
		renderHook(() => useProjects());
		await tick(0);

		await tick(2_000);
		expect(called('get_projects')).toBe(2);
		await tick(120_000);
		expect(called('get_projects')).toBe(2);
	});

	it('does not retry a live list at all', async () => {
		vi.useFakeTimers();
		wire({ list: payload([proj('devgo')]) });
		renderHook(() => useProjects());
		await tick(0);

		await tick(120_000);
		expect(called('get_projects')).toBe(1);
	});

	// "the cached paint is not a pass": every workspace in the cache reads as
	// cached, and the pass in flight is about to bring the real states. a timer
	// armed off the cache would fire a second scan seconds after launch
	it('does not arm a retry off the cached paint while the first pass is in flight', async () => {
		vi.useFakeTimers();
		const live = deferred<ProjectsPayload>();
		wire({
			cached: payload([proj('alpha', 'D:/work')], {
				workspaces: [ws('D:/work', { status: 'cached', reason: null })]
			})
		});
		const base = invoke.getMockImplementation()!;
		invoke.mockImplementation((cmd: string, args?: unknown) =>
			cmd === 'get_projects' ? live.promise : base(cmd, args)
		);
		const { result } = renderHook(() => useProjects());
		await tick(0);

		expect(result.current.projects.map(p => p.name)).toEqual(['alpha']);
		await tick(120_000);
		expect(called('get_projects')).toBe(1);

		await act(async () => { live.resolve(payload([proj('alpha', 'D:/work')])); });
	});
});

describe('useProjects — the focus the user did not ask for', () => {
	it('does nothing when the window LOSES focus', async () => {
		vi.useFakeTimers();
		wire({ list: payload([proj('devgo')]) });
		renderHook(() => useProjects());
		await tick(0);

		await tick(120_000);
		await act(async () => { onFocus?.({ payload: false }); });
		await tick(0);
		expect(called('get_projects')).toBe(1);
	});

	// every launch opens a window and hands focus back, so without the cooldown
	// each launch paid nine wsl.exe and ~20 git.exe on the way back
	it('ignores a focus gain inside the cooldown', async () => {
		vi.useFakeTimers();
		wire({ list: payload([proj('devgo')]) });
		renderHook(() => useProjects());
		await tick(0);

		await tick(59_000);
		await act(async () => { onFocus?.({ payload: true }); });
		await tick(0);
		expect(called('get_projects')).toBe(1);
	});

	it('refreshes with badges once the cooldown has passed', async () => {
		vi.useFakeTimers();
		wire({ list: payload([proj('devgo')]) });
		renderHook(() => useProjects());
		await tick(0);
		expect(called('get_git_info')).toBe(1);

		await tick(61_000);
		await act(async () => { onFocus?.({ payload: true }); });
		await tick(0);

		// a cheap pass, and the badges re-read because a summon is when a
		// branch switched elsewhere should show up
		expect(called('get_projects')).toBe(2);
		expect(called('refresh_projects')).toBe(0);
		expect(called('get_git_info')).toBe(2);
	});

	it('gives the focus listener back on unmount', async () => {
		wire({ list: payload([proj('devgo')]) });
		const { unmount } = await mounted();

		unmount();
		await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
	});
});

describe('useProjects — the order of the list', () => {
	const three = payload([proj('alpha'), proj('beta'), proj('gamma')], {
		ranks: [
			rank('C:/dev/alpha', { score: 1 }),
			rank('C:/dev/beta', { score: 50 }),
			rank('C:/dev/gamma', { score: 50 })
		]
	});

	it('starts on the mode saved last session', async () => {
		localStorage.setItem('devgo.sortMode', 'activity');
		wire({ list: three });
		const { result } = await mounted();

		expect(result.current.sortMode).toBe('activity');
	});

	it('cycles frecency → activity → name → frecency, persisting each', async () => {
		wire({ list: three });
		const { result } = await mounted();
		expect(result.current.sortMode).toBe('frecency');

		await act(async () => { result.current.toggleSort(); });
		expect(result.current.sortMode).toBe('activity');
		expect(localStorage.getItem('devgo.sortMode')).toBe('activity');

		await act(async () => { result.current.toggleSort(); });
		expect(result.current.sortMode).toBe('name');

		await act(async () => { result.current.toggleSort(); });
		expect(result.current.sortMode).toBe('frecency');
		expect(localStorage.getItem('devgo.sortMode')).toBe('frecency');
	});

	it('persists a mode the sort control picks outright', async () => {
		wire({ list: three });
		const { result } = await mounted();

		await act(async () => { result.current.setSort('name'); });
		expect(result.current.sortMode).toBe('name');
		expect(localStorage.getItem('devgo.sortMode')).toBe('name');
	});

	// equal scores, or projects with no git history at all, must not be left in
	// whatever order the scan returned
	it('ranks by score, and breaks a tie on the name', async () => {
		wire({ list: three });
		const { result } = await mounted();

		expect(result.current.filtered.map(p => p.name)).toEqual([
			'beta',
			'gamma',
			'alpha'
		]);
	});

	it('ranks by last commit in activity mode, and breaks a tie on the name', async () => {
		wire({
			list: three,
			commits: { 'C:/dev/alpha': 300, 'C:/dev/beta': 100, 'C:/dev/gamma': 100 }
		});
		const { result } = await mounted();
		await act(async () => { result.current.setSort('activity'); });

		expect(result.current.filtered.map(p => p.name)).toEqual([
			'alpha',
			'beta',
			'gamma'
		]);
	});

	// a project with no git info reads as commit 0 and sinks, rather than
	// throwing off the comparator
	it('sinks a project with no git reading to the bottom of activity order', async () => {
		wire({
			list: payload([proj('alpha'), proj('zeta')]),
			commits: { 'C:/dev/zeta': 900 },
			fail: []
		});
		const { result } = await mounted();
		await act(async () => { result.current.setSort('activity'); });

		expect(result.current.filtered.map(p => p.name)).toEqual(['zeta', 'alpha']);
	});
});

describe('useProjects — searching', () => {
	const list = payload([proj('devgo-app'), proj('deployer'), proj('zetta')], {
		ranks: [
			rank('C:/dev/devgo-app', { score: 1 }),
			rank('C:/dev/deployer', { score: 99 }),
			rank('C:/dev/zetta', { score: 50 })
		]
	});

	// the palette's matcher, so `dvgo` finds `devgo-app`; and while you type
	// the top hit is what Enter opens, so match quality outranks frecency
	it('puts the best fuzzy match first, ahead of the frecency winner', async () => {
		wire({ list });
		const { result } = await mounted();
		expect(result.current.filtered[0].name).toBe('deployer');

		await act(async () => { result.current.setQuery('dvgo'); });

		expect(result.current.filtered.map(p => p.name)).toEqual(['devgo-app']);
	});

	it('drops everything the query does not match', async () => {
		wire({ list });
		const { result } = await mounted();

		await act(async () => { result.current.setQuery('zz'); });
		expect(result.current.filtered).toEqual([]);
	});

	// trimmed: a stray space left in the box is not a search, and treating it
	// as one would empty the list
	it('treats a query of only spaces as no search at all', async () => {
		wire({ list });
		const { result } = await mounted();

		await act(async () => { result.current.setQuery('   '); });
		expect(result.current.filtered.map(p => p.name)).toEqual([
			'deployer',
			'zetta',
			'devgo-app'
		]);
	});

	it('keeps pins out of the pinned strip when the search excludes them', async () => {
		wire({
			list: payload([proj('devgo-app'), proj('zetta')], {
				ranks: [
					rank('C:/dev/devgo-app', { pinned: true }),
					rank('C:/dev/zetta', { pinned: true })
				]
			})
		});
		const { result } = await mounted();
		expect(result.current.pinnedProjects.map(p => p.name)).toEqual([
			'devgo-app',
			'zetta'
		]);

		await act(async () => { result.current.setQuery('zet'); });
		expect(result.current.pinnedProjects.map(p => p.name)).toEqual(['zetta']);
	});
});

describe('useProjects — pinning', () => {
	it('names the path, and lights only that star', async () => {
		wire({
			list: payload([proj('alpha'), proj('beta')]),
			pin: true
		});
		const { result } = await mounted();

		await act(async () => {
			await result.current.togglePin(proj('beta'));
		});

		expect(argsOf('toggle_pin')).toEqual({ fullPath: 'C:/dev/beta' });
		expect(result.current.ranks.get('C:/dev/beta')?.pinned).toBe(true);
		expect(result.current.ranks.get('C:/dev/alpha')?.pinned).toBe(false);
		// the rest of the rank is the command's, not rebuilt from nothing
		expect(result.current.ranks.get('C:/dev/beta')?.score).toBe(0);
		expect(result.current.pinnedProjects.map(p => p.name)).toEqual(['beta']);
	});

	it('takes the pin back off when the command answers false', async () => {
		wire({
			list: payload([proj('alpha')], {
				ranks: [rank('C:/dev/alpha', { pinned: true })]
			}),
			pin: false
		});
		const { result } = await mounted();
		expect(result.current.pinnedProjects).toHaveLength(1);

		await act(async () => {
			await result.current.togglePin(proj('alpha'));
		});
		expect(result.current.pinnedProjects).toEqual([]);
	});

	// ⛔ DOCUMENTS CURRENT BEHAVIOUR, which is arguably wrong: `if (existing)`
	// means a project rust sent no rank for gets its star flipped on disk and
	// nothing on screen until the next full pass. every payload in this app
	// carries a rank per project, so it is unreachable today — and the guard is
	// the reason a missing one fails silently rather than loudly
	it('writes the pin but cannot show it for a project with no rank', async () => {
		wire({
			list: payload([proj('alpha')], { ranks: [] }),
			pin: true
		});
		const { result } = await mounted();

		await act(async () => {
			await result.current.togglePin(proj('alpha'));
		});

		expect(called('toggle_pin')).toBe(1);
		expect(result.current.ranks.has('C:/dev/alpha')).toBe(false);
		expect(result.current.pinnedProjects).toEqual([]);
	});
});
