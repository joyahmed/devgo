import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TargetManager from './TargetManager';

// the only import this panel reaches the machine through: the os file
// picker behind Browse…. everything else it does travels through props, so
// the props ARE the wire here and the assertions below read them as one
const openDialog = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: (...a: unknown[]) => openDialog(...(a as []))
}));

afterEach(cleanup);
afterEach(() => openDialog.mockReset());
beforeEach(() => openDialog.mockReset());

// ⭐ every target id is a named const, referenced by name and never spelled
// inline at a call site. src-tauri/src/commands.rs walks this directory and
// refuses a frontend file that names a target id next to an id-shaped key —
// the rule a menu row broke once by pinning a manager instead of passing the
// id it was built from
const ZED = 'editor:zed';
const NEOVIM = 'editor:nvim';
const WEZTERM = 'terminal:wezterm';
const CLAUDE = 'agent:claude';
const CODEX = 'agent:codex';
const TROVE = 'file_manager:trove';
// found by a scan and not yet registered: a different id space in practice,
// and the only thing the detected rows hand back
const FOUND_KITTY = 'terminal:kitty';
const FOUND_NVIM = 'editor:nvim-in-distro';
const FOUND_TROVE = 'file_manager:trove-on-path';

const target = (
	id: string,
	name: string,
	kind: TargetKind,
	over: Partial<LaunchTarget> = {}
): LaunchTarget => ({
	id,
	name,
	kind,
	executable: name.toLowerCase(),
	args_template: '"{path}"',
	wsl_executable: null,
	wsl_args_template: null,
	run_args_template: null,
	wsl_run_args_template: null,
	reveal_args_template: null,
	...over
});

const EDITORS = [target(ZED, 'Zed', 'editor'), target(NEOVIM, 'Neovim', 'editor')];
const TERMINALS = [target(WEZTERM, 'WezTerm', 'terminal')];
const AGENTS = [
	target(CLAUDE, 'Claude Code', 'agent'),
	target(CODEX, 'Codex', 'agent')
];
const MANAGERS = [target(TROVE, 'Trove', 'file_manager')];
// agents have no default here on purpose: a kind with nothing resolved must
// still draw, and every row in it is then a candidate
const DEFAULTS = { editor: ZED, terminal: WEZTERM, file_manager: TROVE };

const manager = (over: Partial<TargetManagerProps> = {}) => {
	const props = {
		onAdd: vi.fn().mockResolvedValue(undefined),
		onDetect: vi.fn().mockResolvedValue([]),
		onAddDetected: vi.fn().mockResolvedValue(undefined),
		onRemove: vi.fn().mockResolvedValue(undefined),
		onSetDefault: vi.fn().mockResolvedValue(undefined),
		onError: vi.fn(),
		...over
	};
	render(
		<TargetManager
			editors={EDITORS}
			terminals={TERMINALS}
			agents={AGENTS}
			fileManagers={MANAGERS}
			defaults={DEFAULTS}
			{...props}
		/>
	);
	return props;
};

// the form's inputs, named by the half of the placeholder that is the same
// on every platform: the windows build adds the two WSL rows and prefixes
// the args label, so an anchored pattern is what survives both
const box = (re: RegExp) => screen.getByPlaceholderText(re) as HTMLInputElement;
const nameBox = () => box(/^Name —/);
const exeBox = () => box(/^Executable —/);
const runBox = () => box(/^Run args —/);
const revealBox = () => box(/^Reveal args —/);

const openForm = async (user: ReturnType<typeof userEvent.setup>) =>
	user.click(screen.getByRole('button', { name: 'Add a target' }));
const addButton = () => screen.getByRole('button', { name: 'Add' });
const kindTab = (label: string) => screen.getByRole('button', { name: label });

// a section is its heading plus the rows under it; two kinds both offer a
// Remove, so every row assertion is scoped to one of these
const section = (label: string) =>
	screen.getByRole('heading', { name: label }).parentElement as HTMLElement;

// a detected row, found by the text it shows rather than by position
const foundRow = (text: string) =>
	screen
		.getAllByRole('listitem')
		.find(li => li.textContent?.includes(text)) as HTMLElement;

// a promise this file settles by hand, so the scanning state can be observed
// between the click and the answer
const deferred = <T,>() => {
	let settle!: (v: T) => void;
	let fail!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		settle = res;
		fail = rej;
	});
	return { promise, settle, fail };
};

const NEVER_SCANNED = /^Looks for installed editors/;
const NOTHING_NEW = 'Nothing new: everything found is already registered.';

describe('TargetManager — what the add form hands to onAdd', () => {
	// the payload IS the contract: a trimmed name and executable, the args
	// template as typed, and an explicit null for every half left blank —
	// None on the rust side, which is a target refusing WSL rather than
	// opening the wrong directory
	it('sends the trimmed draft with null for every blank half, once', async () => {
		const user = userEvent.setup();
		const { onAdd, onError } = manager();

		await openForm(user);
		await user.type(nameBox(), '  Zed  ');
		await user.type(exeBox(), '  zed  ');
		await user.click(addButton());

		expect(onAdd).toHaveBeenCalledTimes(1);
		expect(onAdd).toHaveBeenCalledWith({
			name: 'Zed',
			kind: 'editor',
			executable: 'zed',
			args_template: '"{path}"',
			wsl_executable: null,
			wsl_args_template: null,
			run_args_template: null,
			wsl_run_args_template: null,
			reveal_args_template: null
		});
		expect(onError).not.toHaveBeenCalled();
		// the panel closes only on the success
		expect(await screen.findByRole('button', { name: 'Add a target' })).not.toBeNull();
	});

	// nothing crosses on a half-filled draft, and the reason is a sentence
	// rather than a disabled button with no explanation
	it('refuses a draft with no name and writes nothing', async () => {
		const user = userEvent.setup();
		const { onAdd, onError } = manager();

		await openForm(user);
		await user.type(exeBox(), 'zed');
		await user.click(addButton());

		expect(onAdd).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith('A target needs a name and an executable');
		// still open, so the missing field can be filled in place
		expect(nameBox()).not.toBeNull();
	});

	// whitespace is not a name: the trim happens before the check, not only
	// in the payload
	it('refuses a name and an executable that are only spaces', async () => {
		const user = userEvent.setup();
		const { onAdd, onError } = manager();

		await openForm(user);
		await user.type(nameBox(), '   ');
		await user.type(exeBox(), '   ');
		await user.click(addButton());

		expect(onAdd).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledTimes(1);
	});

	// ⭐ the refusal path, and the reason close() is chained inside the guard:
	// a rejected add must leave every typed field where the user left it, so
	// correcting the path and pressing Add again is the whole repair
	it('keeps the open panel and the typed fields when the add is refused', async () => {
		const user = userEvent.setup();
		const onAdd = vi.fn().mockRejectedValue('no program at that path');
		const { onError } = manager({ onAdd });

		await openForm(user);
		await user.type(nameBox(), 'Trove');
		await user.type(exeBox(), '/opt/trove/trove');
		await user.click(addButton());

		await waitFor(() =>
			expect(onError).toHaveBeenCalledWith('no program at that path')
		);
		expect(nameBox().value).toBe('Trove');
		expect(exeBox().value).toBe('/opt/trove/trove');
		expect(screen.queryByRole('button', { name: 'Add a target' })).toBeNull();

		// and pressing it again is a second attempt, not a no-op
		await user.click(addButton());
		expect(onAdd).toHaveBeenCalledTimes(2);
	});

	// a terminal is the only kind with run templates, and they arrived null
	// for every terminal added through this form once — its first run_script
	// then failed
	it('carries a terminal run template through as run_args_template', async () => {
		const user = userEvent.setup();
		const { onAdd } = manager();

		await openForm(user);
		await user.click(kindTab('terminal'));
		await user.type(nameBox(), 'Kitty');
		await user.type(exeBox(), 'kitty');
		// `{{` is how userEvent types a literal brace: a bare {command} is read
		// as a key descriptor and vanishes
		await user.type(runBox(), '-e {{command}');
		await user.click(addButton());

		expect(onAdd).toHaveBeenCalledTimes(1);
		expect(onAdd).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'terminal',
				name: 'Kitty',
				run_args_template: '-e {command}',
				reveal_args_template: null
			})
		);
	});

	// a file manager is the only kind with a reveal template, and blank there
	// means "opens the folder" rather than "selects the item"
	it('carries a file manager reveal template through as reveal_args_template', async () => {
		const user = userEvent.setup();
		const { onAdd } = manager();

		await openForm(user);
		await user.click(kindTab('file manager'));
		await user.type(nameBox(), 'Trove');
		await user.type(exeBox(), '/opt/trove/trove');
		await user.type(revealBox(), '--select {{path}');
		await user.click(addButton());

		expect(onAdd).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'file_manager',
				reveal_args_template: '--select {path}',
				run_args_template: null
			})
		);
	});

	// ⭐ the draft keeps every field so flipping tabs is not destructive, which
	// makes submit the only place a field that does not belong to the chosen
	// kind can be dropped. add_target stores the struct as given, with no
	// kind-based scrubbing of its own: an editor that arrived carrying a run
	// template is wrong data at rest, and the next reader of that field
	// inherits the bug
	it('drops a run template typed under terminal once the kind became editor', async () => {
		const user = userEvent.setup();
		const { onAdd, onError } = manager();

		await openForm(user);
		await user.click(kindTab('terminal'));
		// `{{` is how userEvent types a literal brace — see the terminal test
		await user.type(runBox(), '-e {{command}');
		await user.click(kindTab('editor'));
		await user.type(nameBox(), 'Zed');
		await user.type(exeBox(), 'zed');
		await user.click(addButton());

		expect(onAdd).toHaveBeenCalledTimes(1);
		expect(onAdd).toHaveBeenCalledWith({
			name: 'Zed',
			kind: 'editor',
			executable: 'zed',
			args_template: '"{path}"',
			wsl_executable: null,
			wsl_args_template: null,
			run_args_template: null,
			wsl_run_args_template: null,
			reveal_args_template: null
		});
		expect(onError).not.toHaveBeenCalled();
	});

	// the same leak the other way round: a reveal template belongs to a file
	// manager alone, and a terminal keeps the run template it does own
	it('drops a reveal template typed under file manager once the kind became terminal', async () => {
		const user = userEvent.setup();
		const { onAdd } = manager();

		await openForm(user);
		await user.click(kindTab('file manager'));
		await user.type(revealBox(), '--select {{path}');
		await user.click(kindTab('terminal'));
		await user.type(nameBox(), 'Kitty');
		await user.type(exeBox(), 'kitty');
		await user.type(runBox(), '-e {{command}');
		await user.click(addButton());

		expect(onAdd).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'terminal',
				name: 'Kitty',
				run_args_template: '-e {command}',
				reveal_args_template: null
			})
		);
	});

	// ⭐ and the scrub is on the payload, not on the draft: flipping a tab to
	// read another kind's rows must not throw away what was typed, so every
	// box still holds it when the tab comes back
	it('keeps the typed fields across a tab flip', async () => {
		const user = userEvent.setup();
		manager();

		await openForm(user);
		await user.click(kindTab('terminal'));
		await user.type(nameBox(), 'Kitty');
		await user.type(runBox(), '-e {{command}');

		await user.click(kindTab('editor'));
		expect(nameBox().value).toBe('Kitty');
		await user.click(kindTab('terminal'));

		expect(nameBox().value).toBe('Kitty');
		expect(runBox().value).toBe('-e {command}');
	});

	// the form only offers the rows the chosen kind has: a run template on an
	// editor is not a field the user can reach
	it('offers run and reveal rows only to the kinds that have them', async () => {
		const user = userEvent.setup();
		manager();

		await openForm(user);
		expect(screen.queryByPlaceholderText(/^Run args —/)).toBeNull();
		expect(screen.queryByPlaceholderText(/^Reveal args —/)).toBeNull();

		await user.click(kindTab('terminal'));
		expect(runBox()).not.toBeNull();
		expect(screen.queryByPlaceholderText(/^Reveal args —/)).toBeNull();

		await user.click(kindTab('file manager'));
		expect(revealBox()).not.toBeNull();
		expect(screen.queryByPlaceholderText(/^Run args —/)).toBeNull();
	});

	// Cancel is not "close": a draft left behind would reappear in the next
	// add and cross the wire with fields nobody typed this time
	it('clears the draft on Cancel and writes nothing', async () => {
		const user = userEvent.setup();
		const { onAdd, onError } = manager();

		await openForm(user);
		await user.type(nameBox(), 'Zed');
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		await openForm(user);

		expect(nameBox().value).toBe('');
		expect(exeBox().value).toBe('');
		expect(onAdd).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});
});

describe('TargetManager — Browse fills the executable', () => {
	// the picker is asked for a program, not a folder: a directory:true here
	// would let a mac .app bundle — which DevGo cannot spawn — into the field
	it('puts the picked path in the executable field and asks for a file', async () => {
		const user = userEvent.setup();
		openDialog.mockResolvedValue('/opt/trove/trove');
		const { onError } = manager();

		await openForm(user);
		await user.click(screen.getByRole('button', { name: 'Browse…' }));

		await waitFor(() => expect(exeBox().value).toBe('/opt/trove/trove'));
		expect(openDialog).toHaveBeenCalledTimes(1);
		// the filter list itself is the platform's (programs by extension on
		// windows, nothing elsewhere), so only the folder question is asserted
		expect(openDialog.mock.calls[0][0]).not.toHaveProperty('directory');
		expect(onError).not.toHaveBeenCalled();
	});

	// cancelling resolves null, and a path typed by hand before pressing
	// Browse… must survive it
	it('leaves a typed executable alone when the picker is cancelled', async () => {
		const user = userEvent.setup();
		openDialog.mockResolvedValue(null);
		const { onError } = manager();

		await openForm(user);
		await user.type(exeBox(), 'cursor');
		await user.click(screen.getByRole('button', { name: 'Browse…' }));

		await waitFor(() => expect(openDialog).toHaveBeenCalledTimes(1));
		expect(exeBox().value).toBe('cursor');
		expect(onError).not.toHaveBeenCalled();
	});

	it('reports a failing picker through onError', async () => {
		const user = userEvent.setup();
		openDialog.mockRejectedValue('no file dialog on this desktop');
		const { onError } = manager();

		await openForm(user);
		await user.click(screen.getByRole('button', { name: 'Browse…' }));

		await waitFor(() =>
			expect(onError).toHaveBeenCalledWith('no file dialog on this desktop')
		);
		expect(exeBox().value).toBe('');
	});
});

describe('TargetManager — the registered lists', () => {
	// ⭐ order is asserted, not assumed. the kinds are a fixed sequence, and
	// the rows inside one kind are the order the caller handed over — sorting
	// or de-duping them here would hide the ordering the store decided
	it('draws the four kinds in a fixed order and each kind in the order given', () => {
		manager();

		expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual([
			'Editors',
			'Terminals',
			'Agents',
			'File managers',
			'Detected on this machine'
		]);

		const editors = section('Editors').textContent ?? '';
		expect(editors.indexOf('Zed')).toBeGreaterThan(-1);
		expect(editors.indexOf('Zed')).toBeLessThan(editors.indexOf('Neovim'));
		const agents = section('Agents').textContent ?? '';
		expect(agents.indexOf('Claude Code')).toBeLessThan(agents.indexOf('Codex'));
	});

	// the default row is the one that would actually launch, so it is the one
	// row with nothing to promote
	it('badges only the default row and offers Make default on the others', async () => {
		const user = userEvent.setup();
		const { onSetDefault } = manager();
		const editors = within(section('Editors'));

		expect(editors.getAllByText('default')).toHaveLength(1);
		const promote = editors.getAllByRole('button', { name: 'Make default' });
		expect(promote).toHaveLength(1);

		await user.click(promote[0]);
		expect(onSetDefault).toHaveBeenCalledTimes(1);
		expect(onSetDefault).toHaveBeenCalledWith('editor', NEOVIM);
	});

	// a kind with no default resolved yet: nothing is badged and every row is
	// a candidate. the id must be that row's own, and the kind that list's
	it('offers every row of a kind with no default, and passes that kind', async () => {
		const user = userEvent.setup();
		const { onSetDefault } = manager();
		const agents = within(section('Agents'));

		expect(agents.queryByText('default')).toBeNull();
		const promote = agents.getAllByRole('button', { name: 'Make default' });
		expect(promote).toHaveLength(2);

		await user.click(promote[1]);
		expect(onSetDefault).toHaveBeenCalledWith('agent', CODEX);
	});

	it("passes the row's own id to onRemove, once", async () => {
		const user = userEvent.setup();
		const { onRemove, onError } = manager();

		await user.click(
			within(section('File managers')).getByRole('button', { name: 'Remove' })
		);

		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(onRemove).toHaveBeenCalledWith(TROVE);
		expect(onError).not.toHaveBeenCalled();
	});

	// removing the last editor is refused on purpose, with a sentence the user
	// has to read. the panel owns no toast, so the refusal has to travel up
	it('reports a refused remove through onError', async () => {
		const user = userEvent.setup();
		const onRemove = vi.fn().mockRejectedValue('the last editor cannot be removed');
		const { onError } = manager({ onRemove });

		await user.click(
			within(section('Terminals')).getByRole('button', { name: 'Remove' })
		);

		await waitFor(() =>
			expect(onError).toHaveBeenCalledWith('the last editor cannot be removed')
		);
		expect(onRemove).toHaveBeenCalledWith(WEZTERM);
	});

	it('reports a refused Make default through onError', async () => {
		const user = userEvent.setup();
		const onSetDefault = vi.fn().mockRejectedValue('that target is gone');
		const { onError } = manager({ onSetDefault });

		await user.click(
			within(section('Agents')).getAllByRole('button', { name: 'Make default' })[0]
		);

		await waitFor(() => expect(onError).toHaveBeenCalledWith('that target is gone'));
	});

	// an agent is a command the default terminal runs, so the line under its
	// name is the executable that will be run and not an args template
	it('shows an args template under a row, and none under an agent', () => {
		manager({
			agents: [target(CLAUDE, 'Claude Code', 'agent', { executable: 'claude' })]
		});

		expect(within(section('Editors')).getByText('zed "{path}"')).not.toBeNull();
		expect(within(section('Agents')).getByText('claude')).not.toBeNull();
	});
});

describe('TargetManager — detection proposes, a specific Add writes', () => {
	const detected = (
		id: string,
		name: string,
		kind: TargetKind,
		source: string,
		detail: string
	): DetectedTarget => ({ target: target(id, name, kind), source, detail });

	const ON_PATH = detected(
		FOUND_KITTY,
		'Kitty',
		'terminal',
		'path',
		'/usr/bin/kitty'
	);
	const IN_DISTRO = detected(
		FOUND_NVIM,
		'Neovim',
		'editor',
		'Ubuntu-26.04',
		'Ubuntu-26.04 · nvim'
	);
	const MANAGER_ON_PATH = detected(
		FOUND_TROVE,
		'Trove',
		'file_manager',
		'path',
		'/opt/trove/trove'
	);

	// never scanned and scanned-with-nothing-new are different answers and
	// must read differently: null is "we have not looked", [] is "we looked"
	it('reads differently before a scan and after an empty one', async () => {
		const user = userEvent.setup();
		const answer = deferred<DetectedTarget[]>();
		const onDetect = vi.fn().mockReturnValue(answer.promise);
		manager({ onDetect });

		expect(screen.getByText(NEVER_SCANNED)).not.toBeNull();
		expect(screen.queryByText(NOTHING_NEW)).toBeNull();

		await user.click(screen.getByRole('button', { name: 'Scan' }));

		// a probe shells out; while it runs the door is shut, so a second
		// click cannot start a second one
		const scanning = screen.getByRole('button', {
			name: 'Scanning…'
		}) as HTMLButtonElement;
		expect(scanning.disabled).toBe(true);
		await user.click(scanning);
		expect(onDetect).toHaveBeenCalledTimes(1);

		answer.settle([]);
		expect(await screen.findByText(NOTHING_NEW)).not.toBeNull();
		expect(screen.queryByText(NEVER_SCANNED)).toBeNull();
		expect(screen.getByRole('button', { name: 'Scan again' })).not.toBeNull();
	});

	// where a row came from is on the row: an entry with no provenance is the
	// guessing the seed policy refused
	it('names the source of each found row', async () => {
		const user = userEvent.setup();
		const onDetect = vi.fn().mockResolvedValue([ON_PATH, IN_DISTRO]);
		manager({ onDetect });

		await user.click(screen.getByRole('button', { name: 'Scan' }));

		expect(await screen.findByText('/usr/bin/kitty')).not.toBeNull();
		expect(screen.getByText('in Ubuntu-26.04')).not.toBeNull();
		expect(screen.queryByText(NEVER_SCANNED)).toBeNull();
		expect(screen.getAllByRole('listitem')).toHaveLength(2);
	});

	// the badge on a found row is a label a person reads, and the wire name is
	// snake_case: the form's own tab for that kind says 'file manager', so a
	// row reading 'file_manager' is the same kind named two ways in one panel
	it('badges a found row with the kind label the form uses, not the wire name', async () => {
		const user = userEvent.setup();
		const onDetect = vi.fn().mockResolvedValue([MANAGER_ON_PATH]);
		manager({ onDetect });

		await user.click(screen.getByRole('button', { name: 'Scan' }));
		await screen.findByText('/opt/trove/trove');

		const row = within(foundRow('Trove'));
		expect(row.getByText('file manager')).not.toBeNull();
		expect(row.queryByText('file_manager')).toBeNull();
	});

	// the row leaves only once the add succeeded, and it leaves by its own id:
	// the other proposal must still be there to add next
	it('adds one found row by id and takes only that row away', async () => {
		const user = userEvent.setup();
		const onDetect = vi.fn().mockResolvedValue([ON_PATH, IN_DISTRO]);
		const { onAddDetected, onError } = manager({ onDetect });

		await user.click(screen.getByRole('button', { name: 'Scan' }));
		await screen.findByText('/usr/bin/kitty');
		await user.click(within(foundRow('Kitty')).getByRole('button', { name: 'Add' }));

		expect(onAddDetected).toHaveBeenCalledTimes(1);
		expect(onAddDetected).toHaveBeenCalledWith(FOUND_KITTY);
		await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
		expect(screen.getByText('in Ubuntu-26.04')).not.toBeNull();
		expect(onError).not.toHaveBeenCalled();
	});

	// a refused add keeps its row, with the reason in a toast: the proposal is
	// still true, and dropping it would leave nothing to retry with
	it('keeps a found row whose add was refused', async () => {
		const user = userEvent.setup();
		const onDetect = vi.fn().mockResolvedValue([ON_PATH]);
		const onAddDetected = vi.fn().mockRejectedValue('that name is taken');
		const { onError } = manager({ onDetect, onAddDetected });

		await user.click(screen.getByRole('button', { name: 'Scan' }));
		await screen.findByText('/usr/bin/kitty');
		await user.click(within(foundRow('Kitty')).getByRole('button', { name: 'Add' }));

		await waitFor(() => expect(onError).toHaveBeenCalledWith('that name is taken'));
		expect(screen.getAllByRole('listitem')).toHaveLength(1);
		expect(screen.getByText('/usr/bin/kitty')).not.toBeNull();
	});

	// a failed probe is not an empty result: claiming "nothing new" after a
	// scan that never ran is the one reading that would be a lie
	it('keeps the never-scanned reading when the scan itself fails', async () => {
		const user = userEvent.setup();
		const onDetect = vi.fn().mockRejectedValue('wsl.exe is not installed');
		const { onError } = manager({ onDetect });

		await user.click(screen.getByRole('button', { name: 'Scan' }));

		await waitFor(() =>
			expect(onError).toHaveBeenCalledWith('wsl.exe is not installed')
		);
		expect(screen.getByText(NEVER_SCANNED)).not.toBeNull();
		expect(screen.queryByText(NOTHING_NEW)).toBeNull();
		// and the door reopens: a failed probe is retryable
		const again = screen.getByRole('button', { name: 'Scan' }) as HTMLButtonElement;
		expect(again.disabled).toBe(false);
	});
});
