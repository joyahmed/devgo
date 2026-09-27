import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Settings from './Settings';

// the slice: the two panels that read a prefs.json section on mount and
// write one back on a button. everything else this drawer holds is out.
// every component that talks to rust does it through this one import
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

// ─────────────────────────────────────────────────────────────────────────
// the drawer's props. Settings is the only way in: ScanningPanel and
// TmuxPanel are module-private, and mounting the real shell is also what
// proves a panel is reached the way a user reaches it — by its nav row.
// the panel bodies are rendered lazily per active id, so a mount on the
// default panel makes no invoke call at all and the log stays clean
// ─────────────────────────────────────────────────────────────────────────

const unused = async (): Promise<never> => {
	throw new Error('this test never opens that door');
};

const targets: TargetRegistry = {
	editors: [],
	terminals: [],
	agents: [],
	fileManagers: [],
	defaults: {},
	addTarget: async () => {},
	detect: async () => [],
	addDetected: async () => {},
	removeTarget: async () => {},
	setDefaultTarget: async () => {}
};

const github: GithubState = {
	query: '',
	setQuery: () => {},
	payload: null,
	status: null,
	refreshing: false,
	lastError: null,
	available: false,
	isOpen: false,
	toggleOpen: () => {},
	visible: [],
	sections: null,
	cacheMatches: null,
	liveExtras: [],
	searching: false,
	liveOn: false,
	setLiveSearch: async () => {},
	groups: [],
	editGroups: unused,
	folded: new Set<string>(),
	toggleGroup: () => {},
	showRecents: true,
	toggleRecents: () => {},
	refresh: () => {},
	reload: () => {},
	setOrgs: async () => {}
};

const servers: ServersState = {
	servers: [],
	hasSsh: false,
	isOpen: false,
	toggleOpen: () => {},
	reload: async () => {},
	add: unused,
	update: async () => {},
	remove: async () => {},
	importSshConfig: async () => ({ added: 0, updated: 0 }),
	showDetails: false,
	setShowDetails: async () => {},
	listings: {},
	listing: new Set<string>(),
	expanded: new Set<string>(),
	toggleExpanded: () => {},
	listFolders: unused,
	query: '',
	setQuery: () => {},
	openDirs: new Set<string>(),
	loadingDirs: new Set<string>(),
	toggleDir: () => {},
	listDir: unused,
	foldedRoots: new Set<string>(),
	toggleRoot: () => {},
	showAllIn: new Set<string>(),
	toggleShowAll: () => {},
	visible: []
};

// onError and onScanChanged are the two channels a persistence failure and
// a persistence success travel on, so every test gets fresh spies
const spies = () => ({ onError: vi.fn(), onScanChanged: vi.fn() });

const mount = (spy: ReturnType<typeof spies>) =>
	render(
		<Settings
			open={true}
			onClose={() => {}}
			workspaces={[]}
			onAddWorkspace={() => {}}
			onRemoveWorkspace={() => {}}
			summonHotkey='Ctrl+Space'
			onError={spy.onError}
			onScanChanged={spy.onScanChanged}
			onImported={() => {}}
			onSummonChanged={() => {}}
			targets={targets}
			github={github}
			showHints={false}
			onToggleHints={() => {}}
			servers={servers}
			onAddServer={() => {}}
			onEditServer={() => {}}
			onImportSsh={() => {}}
		/>
	);

// one place that decides what each prefs read answers, so a test states
// the one section it cares about and inherits the rest
const wire = (over: { scan?: ScanConfig; tmux?: TmuxConfig }) =>
	invoke.mockImplementation((cmd: string) => {
		if (cmd === 'get_scan_config')
			return Promise.resolve(over.scan ?? { ignore: [], depth: 1 });
		if (cmd === 'get_tmux_config')
			return Promise.resolve(
				over.tmux ?? { enabled: true, window_names: [] }
			);
		return Promise.resolve(null);
	});

const called = (cmd: string) =>
	invoke.mock.calls.filter(c => (c as unknown[])[0] === cmd).length;

// the argument of the one write, so a test asserts the shape that reached
// prefs.json rather than the shape the panel meant to send
const payload = (cmd: string) =>
	invoke.mock.calls.find(c => (c as unknown[])[0] === cmd)?.[1];

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;

afterEach(() => {
	cleanup();
	// the drawer remembers the last panel in localStorage; a key left behind
	// would decide which panel the NEXT test's mount opens on
	localStorage.clear();
});
beforeEach(() => {
	invoke.mockReset();
	localStorage.clear();
});

// the nav row, then the panel. the panel's read fires as a passive effect
// of the commit that paints it, so nothing may be counted until a signal
// DOWNSTREAM of the read has landed: `text` stays null until the read
// resolves and that is exactly what keeps the Save button disabled
const openPanel = async (nav: string | RegExp, save: string) => {
	const user = userEvent.setup();
	await user.click(screen.getByRole('button', { name: nav }));
	const button = screen.getByRole('button', { name: save });
	await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
	return { user, button };
};

describe('Settings — the scan section of prefs.json is read, not assumed', () => {
	it('reads it once when the panel opens, and writes nothing until Save', async () => {
		const spy = spies();
		wire({ scan: { ignore: ['node_modules', 'vendor'], depth: 3 } });
		mount(spy);

		// the drawer opens on a panel that reads no prefs at all
		expect(called('get_scan_config')).toBe(0);

		await openPanel('Scanning', 'Save & rescan');

		expect(called('get_scan_config')).toBe(1);
		expect(called('set_scan_config')).toBe(0);
		expect(box().value).toBe('node_modules\nvendor');
		expect(
			screen.getByRole('button', { name: '3' }).getAttribute('aria-pressed')
		).toBe('true');
		expect(spy.onError).not.toHaveBeenCalled();
	});

	it('writes back exactly what it read when nothing was touched', async () => {
		const spy = spies();
		wire({ scan: { ignore: ['node_modules', 'archive'], depth: 4 } });
		mount(spy);
		const { user, button } = await openPanel('Scanning', 'Save & rescan');

		await user.click(button);

		await waitFor(() => expect(called('set_scan_config')).toBe(1));
		expect(payload('set_scan_config')).toEqual({
			config: { ignore: ['node_modules', 'archive'], depth: 4 }
		});
		expect(spy.onScanChanged).toHaveBeenCalledTimes(1);
		// one Save is one write: a second would re-serialize prefs.json for
		// nothing and fire a second full rescan
		expect(called('set_scan_config')).toBe(1);
	});

	// ⭐ a prefs.json without the section, and a fresh install, both arrive
	// here as the serde defaults — an EMPTY list. the box is then empty, and
	// an empty box must write [] and not ['']: one blank ignore entry is a
	// name every folder could match
	it('a prefs file with no ignore list writes an empty list, not a blank name', async () => {
		const spy = spies();
		wire({ scan: { ignore: [], depth: 1 } });
		mount(spy);
		const { user, button } = await openPanel('Scanning', 'Save & rescan');

		expect(box().value).toBe('');
		await user.click(button);

		await waitFor(() => expect(called('set_scan_config')).toBe(1));
		expect(payload('set_scan_config')).toEqual({
			config: { ignore: [], depth: 1 }
		});
	});

	// the read is the only thing that unlocks the controls. a failure that
	// left `text` null would leave the panel permanently dead, with the
	// error toast the only sign anything happened
	it('a read that fails reports it, unlocks the panel, and writes nothing', async () => {
		const spy = spies();
		invoke.mockImplementation((cmd: string) =>
			cmd === 'get_scan_config'
				? Promise.reject('prefs.json is not valid json')
				: Promise.resolve(null)
		);
		mount(spy);
		const { button } = await openPanel('Scanning', 'Save & rescan');

		expect(spy.onError).toHaveBeenCalledWith('prefs.json is not valid json');
		expect(box().value).toBe('');
		expect((button as HTMLButtonElement).disabled).toBe(false);
		expect(called('set_scan_config')).toBe(0);
	});
});

describe('Settings — what the scan panel puts on the wire', () => {
	// the box is a person's typing, the wire is a name list. commas split
	// too because a folder name never has one, and a name that survived the
	// trim twice must not be written twice
	it('trims, splits on commas as well as lines, and drops the duplicates', async () => {
		const spy = spies();
		wire({ scan: { ignore: [], depth: 2 } });
		mount(spy);
		const { user, button } = await openPanel('Scanning', 'Save & rescan');

		await user.type(box(), '  node_modules , , vendor,node_modules ,  ');
		await user.click(button);

		await waitFor(() => expect(called('set_scan_config')).toBe(1));
		expect(payload('set_scan_config')).toEqual({
			config: { ignore: ['node_modules', 'vendor'], depth: 2 }
		});
	});

	it('writes the depth the user pressed, and tells the launcher once', async () => {
		const spy = spies();
		wire({ scan: { ignore: ['vendor'], depth: 1 } });
		mount(spy);
		const { user, button } = await openPanel('Scanning', 'Save & rescan');

		await user.click(screen.getByRole('button', { name: '5' }));
		await user.click(button);

		await waitFor(() => expect(called('set_scan_config')).toBe(1));
		expect(payload('set_scan_config')).toEqual({
			config: { ignore: ['vendor'], depth: 5 }
		});
		expect(spy.onScanChanged).toHaveBeenCalledTimes(1);
	});

	// ⛔ a rescan on a write that never landed re-walks every workspace with
	// the OLD config and paints the result as if the new one took
	it('a write that fails reports it and does not claim a rescan is due', async () => {
		const spy = spies();
		invoke.mockImplementation((cmd: string) => {
			if (cmd === 'get_scan_config')
				return Promise.resolve({ ignore: ['vendor'], depth: 1 });
			if (cmd === 'set_scan_config')
				return Promise.reject('prefs.json is read-only');
			return Promise.resolve(null);
		});
		mount(spy);
		const { user, button } = await openPanel('Scanning', 'Save & rescan');

		await user.click(button);

		await waitFor(() =>
			expect(spy.onError).toHaveBeenCalledWith('prefs.json is read-only')
		);
		expect(spy.onScanChanged).not.toHaveBeenCalled();
		// and the panel is usable again rather than stuck on "Saving…"
		await waitFor(() =>
			expect((button as HTMLButtonElement).disabled).toBe(false)
		);
	});
});

describe('Settings — the tmux section round-trips through the same door', () => {
	// newlines ONLY on this side: a tmux window name legitimately contains a
	// comma, and splitting on one would write two windows where the user
	// asked for one
	it('reads the section, and a comma stays inside one window name', async () => {
		const spy = spies();
		wire({ tmux: { enabled: true, window_names: ['code', 'agents'] } });
		mount(spy);
		const { user, button } = await openPanel(/^tmux/, 'Save');

		expect(called('get_tmux_config')).toBe(1);
		expect(called('set_tmux_config')).toBe(0);
		expect(box().value).toBe('code\nagents');

		await user.clear(box());
		await user.type(box(), 'edit, test');
		await user.click(button);

		await waitFor(() => expect(called('set_tmux_config')).toBe(1));
		expect(payload('set_tmux_config')).toEqual({
			config: { enabled: true, window_names: ['edit, test'] }
		});
		expect(spy.onError).not.toHaveBeenCalled();
	});

	// `enabled` has a serde default of TRUE, so an older prefs.json arrives
	// with tmux on. switching it off must write the switch AND keep the
	// window list that was read — the list is not cleared by the switch
	it('writes the switch the user flipped and keeps the names it read', async () => {
		const spy = spies();
		wire({ tmux: { enabled: true, window_names: ['code', 'git'] } });
		mount(spy);
		const { user, button } = await openPanel(/^tmux/, 'Save');

		await user.click(screen.getByRole('button', { name: 'Plain shell' }));
		await user.click(button);

		await waitFor(() => expect(called('set_tmux_config')).toBe(1));
		expect(payload('set_tmux_config')).toEqual({
			config: { enabled: false, window_names: ['code', 'git'] }
		});
	});
});
