import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
//
// `buildMenu` in App.tsx is the project row's context menu, and until this
// file nothing asserted that any entry in it reaches the backend command its
// label promises. The pure-module suite would stay green with every entry
// wired to the wrong command, because the wiring lives in a closure inside
// AppInner and is never exported. So the menu is tested the only way it can
// be without touching production code: the whole app is mounted, a row is
// right-clicked, an entry is clicked, and the assertion is on invoke's CALL
// LOG — the command name AND its payload — the shape WslDoctor.test.tsx uses.
//
// ⛔ jsdom reports NEITHER windows, mac nor linux: the UA is `… (win32) …
// jsdom/30.1.1`, so isMac / isWindows / isLinux from src/platform are all
// false and every platform branch takes its unrecognised-desktop arm. The
// windows-only `Copy WSL path` row is therefore absent from the default menu
// and is reached through PLATFORM below, the getter-backed mock of
// src/platform — a `vi.resetModules()` + re-import of App (the shape
// shortcuts.test.ts uses for pure modules) would give App its own React
// instance and break every hook.
// ─────────────────────────────────────────────────────────────────────────────

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as [])),
	// the attach pane's byte channel; the pane only assigns onmessage
	Channel: class {
		onmessage: ((buf: ArrayBuffer) => void) | null = null;
	}
}));
vi.mock('@tauri-apps/api/event', () => ({
	listen: () => Promise.resolve(() => {})
}));
vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		show: () => Promise.resolve(),
		isMaximized: () => Promise.resolve(false),
		isFullscreen: () => Promise.resolve(false),
		onResized: () => Promise.resolve(() => {}),
		onFocusChanged: () => Promise.resolve(() => {}),
		startDragging: () => Promise.resolve(),
		startResizeDragging: () => Promise.resolve(),
		minimize: () => Promise.resolve(),
		toggleMaximize: () => Promise.resolve(),
		close: () => Promise.resolve()
	})
}));
vi.mock('@tauri-apps/api/webview', () => ({
	getCurrentWebview: () => ({
		setZoom: () => Promise.resolve(),
		onDragDropEvent: () => Promise.resolve(() => {})
	})
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: () => Promise.resolve(null),
	save: () => Promise.resolve(null)
}));
// xterm rides its own chunk behind a dynamic import, so the stub stands in
// for the chunk: jsdom has no canvas and the real Terminal would not render.
// it exists so `Attach here` can be clicked and its pty_open asserted
vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		cols = 80;
		rows = 24;
		loadAddon() {}
		open() {}
		focus() {}
		write() {}
		dispose() {}
		attachCustomKeyEventHandler() {}
		onData() {
			return { dispose() {} };
		}
		onResize() {
			return { dispose() {} };
		}
	}
}));
vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	}
}));

// ⚠️ vi.hoisted, not a plain const: the mock factory is hoisted above the
// module body, and src/github.ts + src/shortcuts.ts read isMac at MODULE scope
// while App's import graph is still loading — before any test-file statement
// has run. The flags therefore have to exist before the body, and each test
// MUTATES this object rather than replacing it, because the getters close over
// this exact reference.
const { PLATFORM } = vi.hoisted(() => ({
	PLATFORM: { isMac: false, isWindows: false, isLinux: false }
}));
vi.mock('./platform', () => ({
	get isMac() {
		return PLATFORM.isMac;
	},
	get isWindows() {
		return PLATFORM.isWindows;
	},
	get isLinux() {
		return PLATFORM.isLinux;
	}
}));
// jsdom's own answer: none of the three. `onWindows()` is the only way to
// reach a named desktop here, and a test that calls it is asserting the
// windows arm, never "linux"
const unrecognisedDesktop = () =>
	Object.assign(PLATFORM, { isMac: false, isWindows: false, isLinux: false });
const onWindows = () =>
	Object.assign(PLATFORM, { isMac: false, isWindows: true, isLinux: false });

// jsdom ships neither: useMediaQuery reads matchMedia on its first render and
// StatusBar measures its footer with a ResizeObserver
window.matchMedia = ((query: string) => ({
	matches: false,
	media: query,
	onchange: null,
	addEventListener: () => {},
	removeEventListener: () => {},
	addListener: () => {},
	removeListener: () => {},
	dispatchEvent: () => false
})) as typeof window.matchMedia;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;

// jsdom has no clipboard at all, so the copy rows need one to reach
const writeText = vi.fn((_text: string) => Promise.resolve());
Object.defineProperty(navigator, 'clipboard', {
	value: { writeText: (t: string) => writeText(t) },
	configurable: true
});

// ── fixtures ────────────────────────────────────────────────────────────────
// ⛔ no real home path in here: this repo is public and a commit-time guard
// refuses one
const WS = 'C:\\Users\\Dev\\code';
const PROJ: Project = {
	name: 'devgo',
	full_path: 'C:\\Users\\Dev\\code\\devgo',
	workspace: WS,
	file_system: 'C:'
};
const WSL_WS = '\\\\wsl$\\Ubuntu\\home\\dev';
const WSL_PROJ: Project = {
	name: 'linbox',
	full_path: '\\\\wsl$\\Ubuntu\\home\\dev\\linbox',
	workspace: WSL_WS,
	file_system: 'WSL'
};

const target = (over: Partial<LaunchTarget> & { id: string; kind: TargetKind }) =>
	({
		name: over.id,
		executable: `${over.id}.exe`,
		args_template: '{path}',
		wsl_executable: null,
		wsl_args_template: null,
		run_args_template: null,
		wsl_run_args_template: null,
		reveal_args_template: null,
		...over
	}) as LaunchTarget;

const CLAUDE = target({
	id: 'claude',
	kind: 'agent',
	name: 'Claude Code',
	wsl_executable: 'claude'
});
const WIN_ONLY_AGENT = target({
	id: 'winagent',
	kind: 'agent',
	name: 'WinAgent',
	wsl_executable: null
});
const NO_EXE_AGENT = target({
	id: 'ghost',
	kind: 'agent',
	name: 'Ghost',
	executable: ''
});
const EXPLORER = target({ id: 'explorer', kind: 'file_manager', name: 'Explorer' });
const TROVE = target({ id: 'trove', kind: 'file_manager', name: 'Trove' });

const rank = (p: Project, pinned: boolean): ProjectRank => ({
	full_path: p.full_path,
	score: 1,
	launch_count: 1,
	last_opened: 1,
	hint: null,
	pinned
});

const gitInfo = (p: Project, remote: string | null): GitInfo => ({
	full_path: p.full_path,
	branch: 'main',
	dirty: false,
	remote,
	last_commit: 1,
	remote_branches: null
});

type Wiring = {
	project?: Project;
	pinned?: boolean;
	targets?: LaunchTarget[];
	defaults?: [string, string][];
	remote?: string | null;
	live?: boolean;
	tmux?: boolean;
	scripts?: DevScript[];
	/// the backend's install entry; set, the answer is the full ScriptList
	install?: DevScript;
	/// command name → the value it rejects with
	fail?: Record<string, string>;
};

const payloadFor = (p: Project, pinned: boolean): ProjectsPayload => ({
	projects: [p],
	workspaces: [
		{
			workspace: p.workspace,
			status: 'live',
			reason: null,
			scanned_at: 1,
			count: 1
		}
	],
	ranks: [rank(p, pinned)]
});

// one place that decides what every command answers, so a test names only the
// piece it cares about and inherits the rest
const wire = (w: Wiring = {}) => {
	const p = w.project ?? PROJ;
	const payload = payloadFor(p, w.pinned ?? false);
	invoke.mockImplementation((cmd: string) => {
		const boom = w.fail?.[cmd];
		if (boom !== undefined) return Promise.reject(boom);
		switch (cmd) {
			case 'get_projects':
			case 'get_cached_projects':
			case 'refresh_projects':
			case 'refresh_workspace':
				return Promise.resolve(payload);
			case 'get_workspaces':
				return Promise.resolve([p.workspace]);
			case 'get_targets':
				return Promise.resolve(w.targets ?? []);
			case 'get_default_targets':
				return Promise.resolve(w.defaults ?? []);
			case 'get_git_info':
				return Promise.resolve(
					w.remote === undefined ? [] : [gitInfo(p, w.remote)]
				);
			case 'get_project_tech':
				return Promise.resolve([]);
			case 'get_live_sessions':
				return Promise.resolve(w.live ? [p.full_path] : []);
			case 'get_tmux_config':
				return Promise.resolve({
					enabled: w.tmux ?? true,
					window_names: ['dev']
				});
			case 'get_project_scripts':
				return Promise.resolve(
					w.install
						? { scripts: w.scripts ?? [], reason: null, install: w.install }
						: (w.scripts ?? [])
				);
			case 'get_wsl_path':
				return Promise.resolve('/home/dev/code/devgo');
			case 'pty_open':
				return Promise.resolve({
					id: 'pty-1',
					session: null,
					place: null,
					line: null
				});
			case 'get_servers':
				return Promise.resolve([]);
			case 'has_ssh':
				return Promise.resolve(false);
			case 'get_show_server_details':
				return Promise.resolve(false);
			case 'get_runtime_info':
				return Promise.resolve({
					runtime: 'windows',
					wsl_available: false,
					distros: [],
					default_distro: null,
					local_fs: 'C:'
				});
			case 'get_wsl_state':
				return Promise.resolve({ up: false, distros: [] });
			case 'get_github_status':
				return Promise.resolve({ installed: false, version: null, login: null });
			case 'get_github_repos':
				return Promise.resolve({
					cache: { fetched_at: 0, login: null, orgs: [], repos: [] },
					stale: false,
					refreshing: false,
					orgs: null,
					local: {},
					live_search: false
				});
			case 'get_github_groups':
				return Promise.resolve([]);
			case 'get_summon_hotkey':
				return Promise.resolve('Ctrl+Alt+Space');
			case 'get_window_transparency':
				return Promise.resolve(0);
			default:
				return Promise.resolve(null);
		}
	});
	return p;
};

// ── the menu, as the DOM has it ─────────────────────────────────────────────
const panel = () => {
	// ContextMenu's own shell (ContextMenu.tsx:53): `fixed z-50 w-72
	// bg-bg-popover …`. `.z-50` alone also matches the drawer scrim and the
	// toast stack, neither of which holds menu rows
	const all = document.querySelectorAll<HTMLElement>('div.z-50.w-72.bg-bg-popover');
	// row menu and script submenu never stand at once: picking an entry closes
	// the menu it was in (ContextMenu's contract)
	return all[all.length - 1] ?? null;
};
const buttons = () =>
	Array.from(panel()?.querySelectorAll<HTMLButtonElement>('button') ?? []);
const labelOf = (b: HTMLButtonElement) =>
	b.querySelector('span.truncate')?.textContent ?? '';
const labels = () => buttons().map(labelOf);
const entry = (label: string): HTMLButtonElement => {
	const found = buttons().find(b => labelOf(b) === label);
	if (!found)
		throw new Error(`no menu entry "${label}" — the menu has: ${labels().join(' | ')}`);
	return found;
};
const hintOf = (label: string) =>
	entry(label).querySelector('span.font-mono')?.textContent ?? null;
// label / 'separator' in DOM order: the sections are separator-delimited and
// carry no headings, so this is the only way to assert the grouping
const structure = () =>
	Array.from(panel()?.children ?? []).map(el =>
		el.tagName === 'BUTTON'
			? labelOf(el as HTMLButtonElement)
			: el.className.includes('border-b')
				? 'separator'
				: `heading:${el.textContent}`
	);

const calls = (cmd: string) =>
	invoke.mock.calls.filter(c => c[0] === cmd).map(c => c[1]);

/// mount, wait for the row, right-click it, wait for the menu
const openMenu = async (w: Wiring = {}) => {
	const p = wire(w);
	render(<App />);
	const name = await screen.findByText(p.name);
	// the badge pass lands after the first paint and `live` / the remote come
	// with it; the menu must be built from the settled state
	await waitFor(() => expect(calls('get_live_sessions').length).toBe(1), {
		timeout: 5000
	});
	await waitFor(() => expect(calls('get_git_info').length).toBe(1), {
		timeout: 5000
	});
	await userEvent.pointer({ target: name, keys: '[MouseRight]' });
	await waitFor(() => expect(labels().length).toBeGreaterThan(0), {
		timeout: 5000
	});
	return p;
};

const pick = async (label: string) => {
	const button = entry(label);
	// a detached node swallows the click silently, which is exactly how a
	// wiring test goes green while asserting nothing
	expect(button.isConnected, `menu entry "${label}" is detached`).toBe(true);
	await userEvent.click(button);
};

// the submenu arrives after an await, and this box is shared with other
// agents: a 1s default is not enough headroom under load
const untilRows = (n: number) =>
	waitFor(() => expect(labels().length).toBe(n), { timeout: 5000 });

// ⚠️ braces, not a concise body: vitest treats a value RETURNED from
// beforeEach as that test's teardown, and mockReset() returns the mock
beforeEach(() => {
	invoke.mockReset();
	writeText.mockReset();
	writeText.mockResolvedValue(undefined);
	unrecognisedDesktop();
	localStorage.clear();
});
afterEach(() => {
	unrecognisedDesktop();
	localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('project menu — the inventory', () => {
	it('lists exactly seven entries in four sections with no targets, no session, no remote', async () => {
		await openMenu();

		expect(structure()).toEqual([
			'Open in editor',
			'Open terminal',
			'Open both',
			'separator',
			'Reveal in Explorer',
			'Copy Windows path',
			'separator',
			'Run dev script…',
			'separator',
			'Pin to top'
		]);
	});

	it('every entry carries the hint the shortcut table declares, and no entry invents one', async () => {
		await openMenu({ remote: 'https://github.com/dev/devgo' });

		expect(hintOf('Open in editor')).toBe('Ctrl+Enter');
		expect(hintOf('Open terminal')).toBe('Shift+Enter');
		expect(hintOf('Open both')).toBe('Alt+Enter');
		expect(hintOf('Reveal in Explorer')).toBe('Ctrl+Shift+E');
		expect(hintOf('Copy Windows path')).toBe('Ctrl+Shift+C');
		expect(hintOf('Run dev script…')).toBe('Ctrl+Shift+D');
		expect(hintOf('Open remote')).toBe('Ctrl+Shift+G');
		expect(hintOf('Pin to top')).toBe('Ctrl+S');
	});

	it('grows to thirteen entries in the same four sections when every conditional arm is on', async () => {
		onWindows();
		await openMenu({
			live: true,
			remote: 'https://github.com/dev/devgo',
			pinned: true,
			targets: [CLAUDE, EXPLORER, TROVE],
			defaults: [
				['agent', 'claude'],
				['file_manager', 'explorer']
			]
		});

		expect(structure()).toEqual([
			'Open in editor',
			'Reattach terminal',
			'Open both',
			'Open in Claude Code',
			'Attach here',
			'Kill session',
			'separator',
			'Reveal in Explorer',
			'Reveal in Trove',
			'Copy Windows path',
			'Copy WSL path',
			'separator',
			'Run dev script…',
			'Open remote',
			'separator',
			'Unpin'
		]);
	});
});

// ── section 1: the launches ─────────────────────────────────────────────────
describe('project menu › launch section', () => {
	it('"Open in editor" invokes open_editor for the right-clicked project with the default target', async () => {
		const p = await openMenu();
		await pick('Open in editor');

		expect(calls('open_editor')).toEqual([{ project: p, targetId: null }]);
		expect(calls('open_terminal')).toEqual([]);
		expect(calls('open_both')).toEqual([]);
	});

	it('"Open in editor" surfaces the refusal as a toast and opens nothing else', async () => {
		await openMenu({ fail: { open_editor: 'Code is not installed' } });
		await pick('Open in editor');

		expect(await screen.findByText('Code is not installed')).toBeTruthy();
	});

	it('"Open terminal" invokes open_terminal with the default target', async () => {
		const p = await openMenu();
		await pick('Open terminal');

		expect(calls('open_terminal')).toEqual([{ project: p, targetId: null }]);
	});

	it('"Open terminal" reads "Reattach terminal" for a project with a live session, and still calls open_terminal', async () => {
		const p = await openMenu({ live: true });
		expect(labels()).toContain('Reattach terminal');
		expect(labels()).not.toContain('Open terminal');

		await pick('Reattach terminal');
		expect(calls('open_terminal')).toEqual([{ project: p, targetId: null }]);
	});

	it('the terminal row stays "Open terminal" when a session exists but the multiplexer is off', async () => {
		// live is `sessions.has(path) && tmuxOn` in buildMenu: the session
		// alone is not enough, and the kill / attach rows go with it
		await openMenu({ live: true, tmux: false });

		expect(labels()).toContain('Open terminal');
		expect(labels()).not.toContain('Attach here');
		expect(labels()).not.toContain('Kill session');
	});

	it('"Open both" invokes open_both with both ids left to the backend', async () => {
		const p = await openMenu();
		await pick('Open both');

		expect(calls('open_both')).toEqual([
			{ project: p, editorId: null, terminalId: null }
		]);
	});

	it('"Open both" surfaces its refusal as a toast', async () => {
		await openMenu({ fail: { open_both: 'no terminal registered' } });
		await pick('Open both');

		expect(await screen.findByText('no terminal registered')).toBeTruthy();
	});

	it('one row per registered agent, and it invokes open_agent with THAT agent id', async () => {
		const p = await openMenu({
			targets: [CLAUDE, WIN_ONLY_AGENT],
			defaults: [['agent', 'claude']]
		});

		expect(labels()).toContain('Open in Claude Code');
		expect(labels()).toContain('Open in WinAgent');

		await pick('Open in WinAgent');
		expect(calls('open_agent')).toEqual([{ project: p, targetId: 'winagent' }]);
	});

	it('the default agent shows the agent key and the second shows the alt key', async () => {
		await openMenu({
			targets: [CLAUDE, WIN_ONLY_AGENT],
			defaults: [['agent', 'claude']]
		});

		expect(hintOf('Open in Claude Code')).toBe('Ctrl+Alt+Enter');
		expect(hintOf('Open in WinAgent')).toBe('Ctrl+Alt+Shift+Enter');
	});

	it('an agent with no WSL form is DISABLED on a WSL project, says why, and swallows the click', async () => {
		await openMenu({
			project: WSL_PROJ,
			targets: [WIN_ONLY_AGENT],
			defaults: [['agent', 'winagent']]
		});

		expect(entry('Open in WinAgent').disabled).toBe(true);
		expect(hintOf('Open in WinAgent')).toBe('no WSL form');

		await pick('Open in WinAgent');
		expect(calls('open_agent')).toEqual([]);
	});

	it('an agent with a WSL form is enabled on a WSL project', async () => {
		const p = await openMenu({
			project: WSL_PROJ,
			targets: [CLAUDE],
			defaults: [['agent', 'claude']]
		});

		expect(entry('Open in Claude Code').disabled).toBe(false);
		await pick('Open in Claude Code');
		expect(calls('open_agent')).toEqual([{ project: p, targetId: 'claude' }]);
	});

	it('an agent with no executable is disabled on a local project and names the desktop it is missing from', async () => {
		await openMenu({ targets: [NO_EXE_AGENT], defaults: [['agent', 'ghost']] });

		expect(entry('Open in Ghost').disabled).toBe(true);
		// ⛔ "unrecognised desktop", NOT linux: jsdom is none of the three, so
		// the fallback arm of the isMac / isWindows ladder is what renders
		expect(hintOf('Open in Ghost')).toBe('not found on this machine');
	});

	it('"Open in <agent>" surfaces its refusal as a toast', async () => {
		await openMenu({
			targets: [CLAUDE],
			defaults: [['agent', 'claude']],
			fail: { open_agent: 'claude is not installed on the WSL side' }
		});
		await pick('Open in Claude Code');

		expect(
			await screen.findByText('claude is not installed on the WSL side')
		).toBeTruthy();
	});

	it('"Attach here" and "Kill session" are absent for a project with no live session', async () => {
		await openMenu();

		expect(labels()).not.toContain('Attach here');
		expect(labels()).not.toContain('Kill session');
	});

	it('"Attach here" opens a pty for THIS project in a pane', async () => {
		const p = await openMenu({ live: true });
		await pick('Attach here');

		await waitFor(() => expect(calls('pty_open').length).toBe(1), {
			timeout: 5000
		});
		expect(calls('pty_open')[0]).toMatchObject({
			target: { kind: 'project', project: p }
		});
	});

	it('⭐ "Kill session" DEFERS: the click only opens the confirm, and kill_session is not called', async () => {
		// ⛔ the highest-value assertion in this file. the sibling surface
		// WslMenu.tsx:75 wires its destructive shutdown the same deferred way
		// — `onConfirm(STOP_ALL, () => run(...))` — and a refactor to a direct
		// `run(...)` there or here ships a one-click destructive action with
		// the whole suite green
		const p = await openMenu({ live: true });
		await pick('Kill session');

		expect(calls('kill_session')).toEqual([]);
		expect(
			await screen.findByText(
				`Kill the session for ${p.name}? Every window in it closes.`
			)
		).toBeTruthy();
	});

	it('confirming "Kill session" invokes kill_session with the project', async () => {
		const p = await openMenu({ live: true });
		await pick('Kill session');
		await userEvent.click(await screen.findByRole('button', { name: 'Kill' }));

		expect(calls('kill_session')).toEqual([{ project: p }]);
		expect(await screen.findByText(`Session for ${p.name} killed`)).toBeTruthy();
	});

	it('cancelling "Kill session" never invokes kill_session', async () => {
		await openMenu({ live: true });
		await pick('Kill session');
		await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

		expect(calls('kill_session')).toEqual([]);
	});

	it('a failed kill_session is reported, not swallowed', async () => {
		await openMenu({ live: true, fail: { kill_session: 'no such session' } });
		await pick('Kill session');
		await userEvent.click(await screen.findByRole('button', { name: 'Kill' }));

		expect(await screen.findByText('no such session')).toBeTruthy();
	});

	it('the row is marked danger, so a kill is not a plain row', async () => {
		await openMenu({ live: true });

		expect(entry('Kill session').querySelector('.text-danger')).toBeTruthy();
		expect(entry('Open both').querySelector('.text-danger')).toBeNull();
	});
});

// ── section 2: paths ────────────────────────────────────────────────────────
describe('project menu › path section', () => {
	it('one reveal row with no manager registered, and it lets the backend resolve the default', async () => {
		const p = await openMenu();
		await pick('Reveal in Explorer');

		expect(calls('reveal_in_explorer')).toEqual([
			{ path: p.full_path, targetId: null }
		]);
	});

	it('one reveal row per manager once a second is registered, default first and only it carries the key', async () => {
		await openMenu({
			targets: [TROVE, EXPLORER],
			defaults: [['file_manager', 'explorer']]
		});

		// registration order is Trove then Explorer; the DEFAULT still leads,
		// so the row in the old single-row position is the one the key opens
		expect(labels().filter(l => l.startsWith('Reveal in'))).toEqual([
			'Reveal in Explorer',
			'Reveal in Trove'
		]);
		expect(hintOf('Reveal in Explorer')).toBe('Ctrl+Shift+E');
		expect(hintOf('Reveal in Trove')).toBeNull();
	});

	it('a non-default reveal row names its own manager in the call', async () => {
		const p = await openMenu({
			targets: [EXPLORER, TROVE],
			defaults: [['file_manager', 'explorer']]
		});
		await pick('Reveal in Trove');

		expect(calls('reveal_in_explorer')).toEqual([
			{ path: p.full_path, targetId: 'trove' }
		]);
	});

	it('a reveal that the backend refuses is reported', async () => {
		await openMenu({ fail: { reveal_in_explorer: 'Explorer is not there' } });
		await pick('Reveal in Explorer');

		expect(await screen.findByText('Explorer is not there')).toBeTruthy();
	});

	it('"Copy Windows path" writes the project path to the clipboard and invokes nothing', async () => {
		const p = await openMenu();
		const before = invoke.mock.calls.length;
		await pick('Copy Windows path');

		expect(writeText.mock.calls).toEqual([[p.full_path]]);
		expect(invoke.mock.calls.length).toBe(before);
		expect(await screen.findByText('Copied path')).toBeTruthy();
	});

	it('a clipboard the browser refuses is reported, not silent', async () => {
		await openMenu();
		writeText.mockRejectedValueOnce(new Error('denied'));
		await pick('Copy Windows path');

		expect(
			await screen.findByText('Could not copy to clipboard')
		).toBeTruthy();
	});

	it('"Copy WSL path" is ABSENT on a desktop that is not windows', async () => {
		// the shortcut is windowsOnly (shortcuts.ts:141) and the row is behind
		// the same `isWindows` gate in buildMenu
		await openMenu();

		expect(labels()).not.toContain('Copy WSL path');
	});

	it('"Copy WSL path" asks the backend to translate, then copies what it answers', async () => {
		onWindows();
		const p = await openMenu();
		await pick('Copy WSL path');

		expect(calls('get_wsl_path')).toEqual([{ project: p }]);
		await waitFor(() =>
			expect(writeText.mock.calls).toEqual([['/home/dev/code/devgo']])
		);
		expect(await screen.findByText('Copied WSL path')).toBeTruthy();
	});

	it('a refused translation is reported and nothing is copied', async () => {
		onWindows();
		await openMenu({ fail: { get_wsl_path: 'not a WSL path' } });
		await pick('Copy WSL path');

		expect(await screen.findByText('not a WSL path')).toBeTruthy();
		expect(writeText.mock.calls).toEqual([]);
	});
});

// ── section 3: the dev section ──────────────────────────────────────────────
// ⭐ the entry the owner saw fail and then work on a retry with no code change.
// the assembly, end to end: openScripts in App.tsx asks
// get_project_scripts for the project and NOTHING else, and each submenu row
// sends `run_script { project, command }` with the command string the backend
// handed it, verbatim — the frontend never builds one. Both halves of the
// string are decided in rust: `format!("{runner} run {name}")`
// (services/scripts.rs:29) where runner is the tech cache's package_manager
// or "npm" when the cache has no entry yet
// (commands.rs:852-861) — so the SAME click can send `npm run dev` before the
// badge pass lands and `bun run dev` after it. For a WSL project the
// package.json is only read when `wsl::is_running` says the distro is up
// (scripts.rs:96-101); a stopped distro yields NO scripts, which is the
// "No dev scripts found" arm below.
describe('project menu › dev section — "Run dev script…"', () => {
	it('asks get_project_scripts for the right-clicked project and for nothing else', async () => {
		const p = await openMenu({ scripts: [{ name: 'dev', command: 'bun run dev' }] });
		await pick('Run dev script…');

		expect(calls('get_project_scripts')).toEqual([{ project: p }]);
		// reading the scripts must not launch anything by itself
		expect(calls('run_script')).toEqual([]);
	});

	it('an empty answer opens no submenu and says so — the retry arm of the live bug', async () => {
		await openMenu({ scripts: [] });
		await pick('Run dev script…');

		expect(
			await screen.findByText('No dev scripts found for this project')
		).toBeTruthy();
		expect(labels()).toEqual([]);
	});

	it('the submenu is one row per script: the name is the label, the command is the hint', async () => {
		await openMenu({
			scripts: [
				{ name: 'dev', command: 'bun run dev' },
				{ name: 'build', command: 'bun run build' },
				{ name: 'cargo run', command: 'cargo run' }
			]
		});
		await pick('Run dev script…');
		await untilRows(3);

		expect(labels()).toEqual(['dev', 'build', 'cargo run']);
		expect(hintOf('dev')).toBe('bun run dev');
		expect(hintOf('cargo run')).toBe('cargo run');
	});

	it('picking a script invokes run_script with the project and the backend command, byte for byte', async () => {
		const p = await openMenu({
			scripts: [
				{ name: 'dev', command: 'bun run dev' },
				{ name: 'build', command: 'bun run build' }
			]
		});
		await pick('Run dev script…');
		await untilRows(2);
		await pick('dev');

		expect(calls('run_script')).toEqual([{ project: p, command: 'bun run dev' }]);
	});

	it('the command is a pass-through: the same script name under a different runner sends a different string', async () => {
		// the one thing that can differ between two runs of the same click
		// without a code change — commands.rs reads package_manager out of the
		// tech cache, which is empty until the badge pass lands, and then
		// scripts.rs:29 formats "npm run dev" instead of "bun run dev"
		const p = await openMenu({ scripts: [{ name: 'dev', command: 'npm run dev' }] });
		await pick('Run dev script…');
		await untilRows(1);
		await pick('dev');

		expect(calls('run_script')).toEqual([{ project: p, command: 'npm run dev' }]);
	});

	it('a shell-ish command string is forwarded unmangled', async () => {
		const command = 'pnpm run "dev:all" -- --host 0.0.0.0 && echo done';
		const p = await openMenu({ scripts: [{ name: 'dev:all', command }] });
		await pick('Run dev script…');
		await untilRows(1);
		await pick('dev:all');

		expect(calls('run_script')).toEqual([{ project: p, command }]);
	});

	it('a refused get_project_scripts is reported and opens no submenu', async () => {
		await openMenu({
			fail: { get_project_scripts: 'Ubuntu is not running' }
		});
		await pick('Run dev script…');

		expect(await screen.findByText('Ubuntu is not running')).toBeTruthy();
		expect(labels()).toEqual([]);
	});

	it('a refused run_script is reported', async () => {
		await openMenu({
			scripts: [{ name: 'dev', command: 'bun run dev' }],
			fail: { run_script: 'wt cannot run a command' }
		});
		await pick('Run dev script…');
		await untilRows(1);
		await pick('dev');

		expect(await screen.findByText('wt cannot run a command')).toBeTruthy();
	});

	it('the menu closes on the pick, so the entry cannot be double-fired from it', async () => {
		// there is no `busy` guard on this entry: the guard is ContextMenu's
		// onClose, which unmounts the row menu after the first click
		await openMenu({ scripts: [{ name: 'dev', command: 'bun run dev' }] });
		const button = entry('Run dev script…');
		await userEvent.click(button);
		await untilRows(1);

		// the node is detached now; a second click on it reaches nothing
		expect(button.isConnected).toBe(false);
		expect(calls('get_project_scripts').length).toBe(1);
	});

	it('picking a script closes the submenu, so one pick is one launch', async () => {
		await openMenu({ scripts: [{ name: 'dev', command: 'bun run dev' }] });
		await pick('Run dev script…');
		await untilRows(1);
		const row = entry('dev');
		await userEvent.click(row);

		expect(row.isConnected).toBe(false);
		expect(calls('run_script').length).toBe(1);
	});

	// ── Install: the backend sends `{pm} install` when it read a package.json
	it('Install tops the dev menu, split from the scripts by a separator', async () => {
		await openMenu({
			scripts: [
				{ name: 'dev', command: 'pnpm run dev' },
				{ name: 'build', command: 'pnpm run build' }
			],
			install: { name: 'Install', command: 'pnpm install' }
		});
		await pick('Run dev script…');
		await untilRows(3);

		expect(structure()).toEqual(['Install', 'separator', 'dev', 'build']);
		expect(hintOf('Install')).toBe('pnpm install');
	});

	it('picking Install sends its command through run_script, the dev-script launcher', async () => {
		const p = await openMenu({
			scripts: [{ name: 'dev', command: 'bun run dev' }],
			install: { name: 'Install', command: 'bun install' }
		});
		await pick('Run dev script…');
		await untilRows(2);
		await pick('Install');

		expect(calls('run_script')).toEqual([{ project: p, command: 'bun install' }]);
	});

	it('a package.json with no scripts still offers Install instead of "No dev scripts"', async () => {
		await openMenu({
			scripts: [],
			install: { name: 'Install', command: 'npm install' }
		});
		await pick('Run dev script…');
		await untilRows(1);

		expect(labels()).toEqual(['Install']);
	});

	it('no package.json, no Install row', async () => {
		await openMenu({ scripts: [{ name: 'cargo run', command: 'cargo run' }] });
		await pick('Run dev script…');
		await untilRows(1);

		expect(labels()).toEqual(['cargo run']);
	});

	it('"Open remote" is ABSENT for a project with no git remote', async () => {
		await openMenu({ remote: null });

		expect(labels()).not.toContain('Open remote');
	});

	it('"Open remote" invokes open_remote by path, letting rust pick the url and branch', async () => {
		const p = await openMenu({ remote: 'https://github.com/dev/devgo' });
		await pick('Open remote');

		expect(calls('open_remote')).toEqual([
			{ fullPath: p.full_path, url: null, branch: null }
		]);
	});

	it('a refused open_remote is reported', async () => {
		await openMenu({
			remote: 'https://github.com/dev/devgo',
			fail: { open_remote: 'no browser' }
		});
		await pick('Open remote');

		expect(await screen.findByText('no browser')).toBeTruthy();
	});
});

// ── section 4: pin ──────────────────────────────────────────────────────────
describe('project menu › pin section', () => {
	it('"Pin to top" invokes toggle_pin with the project path', async () => {
		const p = await openMenu();
		await pick('Pin to top');

		expect(calls('toggle_pin')).toEqual([{ fullPath: p.full_path }]);
	});

	it('an already pinned row reads "Unpin" and calls the same command', async () => {
		const p = await openMenu({ pinned: true });
		expect(labels()).toContain('Unpin');
		expect(labels()).not.toContain('Pin to top');

		await pick('Unpin');
		expect(calls('toggle_pin')).toEqual([{ fullPath: p.full_path }]);
	});

	it('a refused toggle_pin is reported', async () => {
		await openMenu({ fail: { toggle_pin: 'ranks file is read-only' } });
		await pick('Pin to top');

		expect(await screen.findByText('ranks file is read-only')).toBeTruthy();
	});

	it('the project menu carries no workspace action — a workspace is the header menu\'s', async () => {
		await openMenu({ live: true, remote: 'https://github.com/dev/devgo' });

		expect(labels().filter(l => /workspace/i.test(l))).toEqual([]);
		expect(labels().filter(l => /^Remove/.test(l))).toEqual([]);
	});
});
