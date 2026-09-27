import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from 'vitest';
import ClonePicker from './ClonePicker';

// the only door out of this component: the os folder picker. it is a
// promise the picker chains a destination off, so every test that touches
// the destination decides what the dialog answers — the same one-stub
// idiom the other component tests use for invoke
const openDialog = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: (...a: unknown[]) => openDialog(...(a as []))
}));

afterEach(cleanup);

// jsdom ships no scrollIntoView at all, and the row cursor calls it in an
// effect on mount and on every move — so without this the component throws
// before a single assertion. restored afterwards: a stub left on
// Element.prototype is a mutated global the next file inherits
const noScroll = () => {};
let realScroll: typeof Element.prototype.scrollIntoView;
beforeAll(() => {
	realScroll = Element.prototype.scrollIntoView;
	Element.prototype.scrollIntoView = noScroll;
});
afterAll(() => {
	Element.prototype.scrollIntoView = realScroll;
});

// the destination is remembered in localStorage, so a test that picks one
// would hand it to every test after it. cleared both sides: before, so a
// stray entry cannot decide where this test's clone lands, and after, so
// nothing leaves the file
const INTO_KEY = 'devgo.cloneWorkspace';
beforeEach(() => localStorage.clear());
afterEach(() => {
	localStorage.clear();
	openDialog.mockReset();
});

const repo = (name: string): GithubRepo => ({
	full_name: `joyahmed/${name}`,
	name,
	owner: 'joyahmed',
	url: `https://github.com/joyahmed/${name}`,
	updated_at: '2026-09-01T00:00:00Z',
	private: false,
	archived: false,
	default_branch: 'main',
	added: false,
	stars: null
});

// three names with no letter in common beyond the shared owner, so the
// fuzzy filter narrows to exactly one row and the test says which
const ALPHA = repo('alpha');
const BRAVO = repo('bravo');
const CHARLIE = repo('charlie');
const REPOS = [ALPHA, BRAVO, CHARLIE];
// a fourth name none of the three can fuzzy-match, for the one test that
// needs a filter that matches nothing and then matches something
const ZULU = repo('zzz');

const WORKSPACES = ['/g/01_tauri', '/g/02_next'];
// a folder under no workspace at all — the case the add-as-workspace tick
// exists for. a const and not an inline literal: the rust suite walks this
// directory and reads the strings in it
const OUTSIDE = '/g/scratch';

const picker = (over: Partial<ClonePickerProps> = {}) => {
	const onStart = vi.fn();
	const onDone = vi.fn();
	const at = (extra: Partial<ClonePickerProps>) => (
		<ClonePicker
			repos={REPOS}
			local={{}}
			workspaces={WORKSPACES}
			onStart={onStart}
			onDone={onDone}
			{...over}
			{...extra}
		/>
	);
	const { rerender } = render(at({}));
	// the drawer stays open while the github cache refreshes behind it, so
	// repos is a live prop: rerender is how a test says the list grew
	return { onStart, onDone, again: (extra: Partial<ClonePickerProps>) => rerender(at(extra)) };
};

const tick = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
	user.click(screen.getByRole('checkbox', { name: new RegExp(name) }));
const row = (name: string) => screen.getByRole('option', { name: new RegExp(name) });
const clone = () => screen.getByRole('button', { name: /^Clone / });
// the repo list and the destination dropdown are both listboxes, so the
// label is the only way to name the one this component owns
const list = () => screen.getByRole('listbox', { name: 'Repositories to clone' });
// open the destination dropdown and choose the row with this text
const chooseInto = async (
	user: ReturnType<typeof userEvent.setup>,
	label: string
) => {
	await user.click(screen.getByRole('combobox', { name: 'into' }));
	await user.click(screen.getByText(label));
};

describe('ClonePicker — what crosses to onStart', () => {
	// the payload IS the contract: which repos, which folder, and whether
	// that folder is to be added as a workspace. everything else in this
	// component exists to get these three right
	it('hands over the ticked repos, the destination and no add flag', async () => {
		const user = userEvent.setup();
		const { onStart, onDone } = picker();

		await tick(user, 'alpha');
		await tick(user, 'charlie');
		await user.click(clone());

		expect(onStart).toHaveBeenCalledTimes(1);
		// repo order is the cache's, not the order they were ticked in
		expect(onStart).toHaveBeenCalledWith([ALPHA, CHARLIE], '/g/01_tauri', false);
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	// a repo already on this disk is listed rather than hidden, so the answer
	// to "is it here?" is on the same screen — but it must never be cloned
	// again, and Tick shown is the way it would slip through
	it('never lets a repo already on disk cross the wire', async () => {
		const user = userEvent.setup();
		const { onStart } = picker({ local: { 'joyahmed/alpha': 'C:/g/alpha' } });

		expect(row('alpha').getAttribute('aria-disabled')).toBe('true');
		expect(
			(screen.getByRole('checkbox', { name: /alpha/ }) as HTMLInputElement).disabled
		).toBe(true);

		await user.click(screen.getByText('Tick shown'));
		await user.click(clone());

		expect(onStart).toHaveBeenCalledWith([BRAVO, CHARLIE], '/g/01_tauri', false);
	});

	// the filter narrows the list, not the batch. a tick placed before the
	// search box was typed in is still a tick, and losing it is how a batch
	// silently shrinks between two keystrokes
	it('keeps ticks the filter hides, and sends them all', async () => {
		const user = userEvent.setup();
		const { onStart } = picker();

		await tick(user, 'alpha');
		await user.type(screen.getByPlaceholderText('Find a repo…'), 'bravo');
		// one row left on screen, and the tick on the hidden row still counted
		expect(screen.getByText(/^1 of 3/).textContent).toContain('1 ticked');

		await tick(user, 'bravo');
		expect(screen.getByText(/^1 of 3/).textContent).toContain('2 ticked');
		await user.click(clone());

		expect(onStart).toHaveBeenCalledWith([ALPHA, BRAVO], '/g/01_tauri', false);
	});

	// written the moment it is picked and not when the clone starts: closing
	// the drawer to tick one more repo used to lose the destination
	it('remembers the destination before any clone is started', async () => {
		const user = userEvent.setup();
		const { onStart } = picker();

		await chooseInto(user, '02_next');

		expect(localStorage.getItem(INTO_KEY)).toBe('/g/02_next');
		expect(onStart).not.toHaveBeenCalled();

		await tick(user, 'alpha');
		await user.click(clone());
		expect(onStart).toHaveBeenCalledWith([ALPHA], '/g/02_next', false);
	});

	// ⭐ the destination row is a <label> wrapping the Select, so a click on an
	// option used to bubble to the label, which re-dispatched it on the trigger
	// and re-opened the list the pick had just shut. on screen: you chose a
	// folder and the dropdown was still hanging over the repo list, needing a
	// second click or Escape to get rid of. Select.tsx now keeps the option
	// click inside the listbox; this is the caller that was hurt by it
	it('shuts the destination list when a destination is picked', async () => {
		const user = userEvent.setup();
		picker();

		await chooseInto(user, '02_next');

		const trigger = screen.getByRole('combobox', { name: 'into' });
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByRole('listbox', { name: 'into' })).toBeNull();
	});

	// a folder aimed at here and now is the user's own choice, so the offer
	// to add it as a workspace starts ticked — otherwise the clone lands
	// somewhere no lane ever scans and reads as a clone that did nothing
	it('offers a freshly picked outside folder as a workspace, ticked', async () => {
		const user = userEvent.setup();
		openDialog.mockResolvedValue(OUTSIDE);
		const { onStart } = picker();

		await chooseInto(user, 'Choose a folder…');

		// the dialog opens where the destination already points, not at home
		expect(openDialog).toHaveBeenCalledWith({
			directory: true,
			defaultPath: '/g/01_tauri'
		});
		const add = await screen.findByRole('checkbox', { name: 'Add as workspace' });
		expect((add as HTMLInputElement).checked).toBe(true);

		await tick(user, 'alpha');
		await user.click(clone());
		expect(onStart).toHaveBeenCalledWith([ALPHA], OUTSIDE, true);
	});

	// ⭐ the other half, and the reason the tick is not simply always on:
	// deleting a workspace in Settings turns its own path into an outside
	// folder that is still the remembered destination. a tick nobody placed
	// would add the workspace straight back
	it('opens a remembered outside folder with the add tick clear', async () => {
		const user = userEvent.setup();
		localStorage.setItem(INTO_KEY, OUTSIDE);
		const { onStart } = picker();

		const add = screen.getByRole('checkbox', { name: 'Add as workspace' });
		expect((add as HTMLInputElement).checked).toBe(false);

		await tick(user, 'alpha');
		await user.click(clone());
		expect(onStart).toHaveBeenCalledWith([ALPHA], OUTSIDE, false);
	});

	// a folder inside a workspace is scanned already, so there is nothing to
	// add and no question to ask about it
	it('asks nothing about a picked folder that is inside a workspace', async () => {
		const user = userEvent.setup();
		openDialog.mockResolvedValue('/g/01_tauri/nested');
		const { onStart } = picker();

		await chooseInto(user, 'Choose a folder…');
		await waitFor(() =>
			expect(localStorage.getItem(INTO_KEY)).toBe('/g/01_tauri/nested')
		);
		expect(screen.queryByRole('checkbox', { name: 'Add as workspace' })).toBeNull();

		await tick(user, 'alpha');
		await user.click(clone());
		expect(onStart).toHaveBeenCalledWith([ALPHA], '/g/01_tauri/nested', false);
	});

	// ⭐ one folder, one row. the workspace store keeps a root exactly as it
	// was typed (workspace.rs) while the os dialog answers in its own
	// spelling, so the same folder arrives as '/g/02_next' and '/g/02_next/'.
	// insideAny already reads those as one path; the de-dupe that builds the
	// destination list has to agree, or the dropdown offers the same folder
	// twice and the destination it holds matches neither row
	it('lists a picked folder that is already a workspace only once', async () => {
		const user = userEvent.setup();
		openDialog.mockResolvedValue(`${WORKSPACES[1]}/`);
		const { onStart } = picker();

		await chooseInto(user, 'Choose a folder…');
		await waitFor(() => expect(localStorage.getItem(INTO_KEY)).not.toBeNull());

		// open it again, so the assertion below reads a list that was built
		// after the pick — the pick itself shut it
		await user.click(screen.getByRole('combobox', { name: 'into' }));
		// one row per folder, counted inside the open list: the shut trigger
		// carries the same label and would be a third match
		const menu = screen.getByRole('listbox', { name: 'into' });
		expect(within(menu).getAllByText('02_next')).toHaveLength(1);
		// the same folder as a workspace, so there is nothing to add
		expect(screen.queryByRole('checkbox', { name: 'Add as workspace' })).toBeNull();
		await user.keyboard('{Escape}');

		await tick(user, 'alpha');
		await user.click(clone());
		// the store's spelling, not the dialog's: the destination has to be a
		// row the dropdown can point at
		expect(onStart).toHaveBeenCalledWith([ALPHA], WORKSPACES[1], false);
	});

	// the other way the same folder arrives twice: a destination remembered
	// under a spelling the workspace list does not use. one row for that
	// folder, and the destination has to BE that row — a value no row carries
	// leaves the trigger reading the first workspace while the clone goes
	// somewhere else, which is worse than the duplicate row it replaced
	it('opens a remembered workspace spelled another way on its own row', async () => {
		const user = userEvent.setup();
		localStorage.setItem(INTO_KEY, `${WORKSPACES[1]}/`);
		const { onStart } = picker();

		const trigger = screen.getByRole('combobox', { name: 'into' });
		expect(trigger.textContent).toContain('02_next');
		expect(trigger.textContent).not.toContain('01_tauri');
		expect(screen.queryByRole('checkbox', { name: 'Add as workspace' })).toBeNull();

		await tick(user, 'alpha');
		await user.click(clone());
		expect(onStart).toHaveBeenCalledWith([ALPHA], WORKSPACES[1], false);
	});

	// cancelling the os picker resolves with null, and the row that opened it
	// is a sentinel — a destination of '__pick__' reaching the backend is the
	// failure this guards
	it('leaves the destination alone when the folder picker is cancelled', async () => {
		const user = userEvent.setup();
		openDialog.mockResolvedValue(null);
		const { onStart } = picker();

		await chooseInto(user, 'Choose a folder…');
		await waitFor(() => expect(openDialog).toHaveBeenCalledTimes(1));

		await tick(user, 'alpha');
		await user.click(clone());
		expect(onStart).toHaveBeenCalledWith([ALPHA], '/g/01_tauri', false);
	});
});

describe('ClonePicker — the list is one tab stop', () => {
	// a checkbox per row meant a few hundred tab stops between the search box
	// and the destination below. the cursor moves inside the list instead, and
	// aria-activedescendant is what a screen reader follows
	const activeRow = () => {
		const id = list().getAttribute('aria-activedescendant');
		return id ? document.getElementById(id) : null;
	};

	it('moves the cursor with the arrows and ticks the row under it', async () => {
		const user = userEvent.setup();
		const { onStart } = picker();

		list().focus();
		expect(activeRow()?.textContent).toContain('alpha');

		await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
		expect(activeRow()?.textContent).toContain('bravo');

		await user.keyboard(' ');
		expect(row('bravo').getAttribute('aria-selected')).toBe('true');
		expect(screen.getByText(/^3 of 3/).textContent).toContain('1 ticked');

		await user.click(clone());
		expect(onStart).toHaveBeenCalledWith([BRAVO], '/g/01_tauri', false);
	});

	// the same keys over a row that is already on disk: the row is inert from
	// the keyboard exactly as its checkbox is from the mouse
	it('ticks nothing when the row under the cursor is already on disk', async () => {
		const user = userEvent.setup();
		picker({ local: { 'joyahmed/alpha': 'C:/g/alpha' } });

		list().focus();
		await user.keyboard(' {Enter}');

		expect(screen.getByText('3 of 3').textContent).not.toContain('ticked');
		expect((clone() as HTMLButtonElement).disabled).toBe(true);
	});

	// the cursor is an index into the rows on screen, so it has to stay one.
	// End took visible.length - 1 with no clamp, which is -1 over a filter
	// that matches nothing — and -1 outlives the empty list: the cache
	// refreshing behind the open drawer brings rows back without touching the
	// cursor, and the cursor then points at no row at all
	it('keeps the cursor on a real row when End is pressed over an empty list', async () => {
		const user = userEvent.setup();
		const { onStart, again } = picker();

		await user.type(screen.getByPlaceholderText('Find a repo…'), 'zzz');
		expect(screen.getByText('No repository matches.')).not.toBeNull();

		list().focus();
		await user.keyboard('{End}');

		// the cache refreshes behind the drawer and the filter now has a match
		again({ repos: [...REPOS, ZULU] });
		expect(activeRow()?.textContent).toContain('zzz');

		await user.keyboard(' ');
		expect(row('zzz').getAttribute('aria-selected')).toBe('true');
		await user.click(clone());
		expect(onStart).toHaveBeenCalledWith([ZULU], '/g/01_tauri', false);
	});

	// the lanes behind the drawer listen on window for the same arrows, so a
	// key this list owns has to go no further. window is where they listen,
	// so that is the question asked here — not whether stopPropagation ran
	describe('and the keys it owns reach nothing above it', () => {
		const seen = vi.fn();
		const on = (e: KeyboardEvent) => seen(e.key);
		beforeEach(() => {
			seen.mockClear();
			window.addEventListener('keydown', on);
		});
		afterEach(() => window.removeEventListener('keydown', on));

		it('keeps the arrows, Home, End and space to itself', async () => {
			const user = userEvent.setup();
			picker();

			list().focus();
			await user.keyboard('{ArrowDown}{ArrowUp}{Home}{End} ');
			expect(seen).not.toHaveBeenCalled();

			// a key the list does not own still bubbles: it stops the six it
			// handles, not every key that lands on it
			await user.keyboard('{PageDown}');
			expect(seen).toHaveBeenCalledWith('PageDown');
		});
	});
});

describe('ClonePicker — Escape belongs to the search box only while it has text', () => {
	// the drawer closes on a window keydown; this is that listener, standing
	// in for it. the defect: Escape did the same thing either way — closed
	// the drawer and threw away the filter and the ticks with it
	const seen = vi.fn();
	const on = (e: KeyboardEvent) => {
		if (e.key === 'Escape') seen();
	};
	beforeEach(() => {
		seen.mockClear();
		window.addEventListener('keydown', on);
	});
	afterEach(() => window.removeEventListener('keydown', on));

	it('clears the filter, keeps the ticks, and the drawer never sees the key', async () => {
		const user = userEvent.setup();
		picker();

		await tick(user, 'alpha');
		const box = screen.getByPlaceholderText('Find a repo…') as HTMLInputElement;
		await user.type(box, 'bravo');
		expect(screen.getByText(/^1 of 3/)).not.toBeNull();

		await user.keyboard('{Escape}');

		expect(box.value).toBe('');
		expect(screen.getByText(/^3 of 3/).textContent).toContain('1 ticked');
		expect(row('alpha').getAttribute('aria-selected')).toBe('true');
		expect(seen).not.toHaveBeenCalled();
	});

	it('lets the key through once there is nothing to clear', async () => {
		const user = userEvent.setup();
		picker();

		await user.click(screen.getByPlaceholderText('Find a repo…'));
		await user.keyboard('{Escape}');
		expect(seen).toHaveBeenCalledTimes(1);
	});
});

describe('ClonePicker — group mode clones nothing', () => {
	const GROUPS: GithubGroup[] = [{ name: 'Work', repos: [] }];

	// grouping a repo that is already on disk is the ordinary case, so every
	// row is a candidate here — the opposite of clone mode, where a local row
	// is inert. same list, same checkboxes, different question
	it('takes every row, local ones included, and hands them to onGroup', async () => {
		const user = userEvent.setup();
		const onGroup = vi.fn().mockResolvedValue(undefined);
		const { onStart, onDone } = picker({
			mode: 'group',
			groups: GROUPS,
			onGroup,
			local: { 'joyahmed/alpha': 'C:/g/alpha' }
		});

		expect(row('alpha').getAttribute('aria-disabled')).toBeNull();
		await user.click(screen.getByText('Tick shown'));
		await user.click(screen.getByRole('button', { name: 'Add 3 repos to group' }));

		expect(onGroup).toHaveBeenCalledWith([ALPHA, BRAVO, CHARLIE], 'Work');
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		// nothing is cloned in this mode, and no destination is remembered
		expect(onStart).not.toHaveBeenCalled();
		expect(localStorage.getItem(INTO_KEY)).toBeNull();
	});

	// a refusal from the store is the user's to read, and the ticks they
	// placed have to still be there to retry with
	it('shows a refusal and stays open on it', async () => {
		const user = userEvent.setup();
		const onGroup = vi.fn().mockRejectedValue('that name is taken by a lane');
		const { onDone } = picker({ mode: 'group', groups: GROUPS, onGroup });

		await tick(user, 'alpha');
		await user.click(screen.getByRole('button', { name: 'Add 1 repo to group' }));

		expect(await screen.findByText('that name is taken by a lane')).not.toBeNull();
		expect(onDone).not.toHaveBeenCalled();
		expect(row('alpha').getAttribute('aria-selected')).toBe('true');
	});
});
