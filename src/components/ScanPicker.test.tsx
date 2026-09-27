import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanPicker from './ScanPicker';

// the picker reaches the machine through exactly one command, and it is the
// whole of its input: everything else it knows arrives as a prop. so the mock
// answers that one command and the call log is the contract every test reads —
// how many scans were asked for, and nothing was asked for twice
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

afterEach(cleanup);
// ⚠️ braces, not a concise body: vitest treats a function RETURNED from a
// beforeEach as that test's teardown, and mockReset() returns the mock — so
// `beforeEach(() => invoke.mockReset())` registers invoke ITSELF as a cleanup
// hook and calls it with no arguments after every test
beforeEach(() => {
	invoke.mockReset();
});

// the only command this component knows, named once
const DISCOVER = 'discover_roots';

// ⭐ 01_tauri is spelled with BACKSLASHES on purpose: it is what the windows
// half of the scan answers, and the path the picker hands to onAddMany has to
// be this spelling and not the normalised one — normalizePath exists to
// COMPARE with the store, not to rewrite what crosses the wire
const TAURI: DiscoveredRoot = {
	path: 'C:\\g\\01_tauri',
	label: '01_tauri',
	kind: 'windows'
};
const NEXT: DiscoveredRoot = {
	path: 'C:/g/02_next',
	label: '02_next',
	kind: 'windows'
};
const CODE: DiscoveredRoot = {
	path: '/home/joy/code',
	label: 'code',
	kind: 'wsl'
};
// three labels with no substring in common, so a query for one row can never
// match a second one
const FOUND = [TAURI, NEXT, CODE];

// what the store spells the same two folders as: one with the other
// separator, one with a trailing slash. both are paths normalizePath reads as
// the discovered path, and both are shapes the workspace list really holds
const ADDED_TAURI = 'C:/g/01_tauri';
const ADDED_CODE = '/home/joy/code/';

const mount = (existing: string[] = []) => {
	const onAddMany = vi.fn();
	const onError = vi.fn();
	const onDone = vi.fn();
	render(<ScanPicker {...{ existing, onAddMany, onError, onDone }} />);
	return { onAddMany, onError, onDone };
};

// a promise this file settles by hand, so the scanning state can be observed
// between the mount and the answer
const deferred = <T,>() => {
	let settle!: (v: T) => void;
	const promise = new Promise<T>(res => {
		settle = res;
	});
	return { promise, settle };
};

const box = (name: string) =>
	screen.getByRole('checkbox', { name: new RegExp(name) }) as HTMLInputElement;
// the row a checkbox belongs to, so a chip is read off its own row and not off
// whichever row happens to hold that word
const rowOf = (name: string) => box(name).closest('li') as HTMLElement;
const button = (name: string | RegExp) =>
	screen.getByRole('button', { name }) as HTMLButtonElement;
const addButton = () => button(/^Add /);
// the heading, which is the one place the counts are stated in words
const heading = () => screen.getByText(/^Found /).textContent;

describe('ScanPicker — the scan is the mount, and it runs once', () => {
	it('says it is scanning before the answer lands, and asks exactly once', async () => {
		const slow = deferred<DiscoveredRoot[]>();
		invoke.mockReturnValue(slow.promise);
		mount();

		// "found 0" before the scan has run is a lie, so the first frame is the
		// scanning line and not an empty list
		expect(screen.getByText('Scanning…')).toBeTruthy();
		expect(screen.queryByRole('checkbox')).toBeNull();
		expect(invoke).toHaveBeenCalledTimes(1);
		// no payload at all: the scan takes no argument, and one appearing here
		// would be a root or a depth this component decided by itself
		expect(invoke.mock.calls[0]).toEqual([DISCOVER]);

		slow.settle([TAURI]);

		expect(await screen.findByText('Found 1')).toBeTruthy();
		expect(screen.queryByText('Scanning…')).toBeNull();
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it('asks again on Rescan and takes the new answer as the whole truth', async () => {
		invoke.mockResolvedValueOnce([TAURI, NEXT]).mockResolvedValueOnce(FOUND);
		mount();
		await screen.findByText('Found 2');

		const user = userEvent.setup();
		await user.click(box('02_next'));
		expect(addButton().textContent).toBe('Add 1 folder');

		await user.click(button('Rescan'));

		await screen.findByText('Found 3');
		expect(invoke).toHaveBeenCalledTimes(2);
		// the untick belonged to the list that is gone: a scan's answer decides
		// what is ticked, or a rescan quietly carries a stale pick forward
		expect(addButton().textContent).toBe('Add 3 folders');
		expect(box('02_next').checked).toBe(true);
	});
});

describe('ScanPicker — what a finished scan shows', () => {
	it('lists every root with its path and starts each new one ticked', async () => {
		invoke.mockResolvedValue([TAURI, NEXT]);
		mount();
		await screen.findByText('Found 2');

		// nothing already added, so the count says only what was found
		expect(heading()).toBe('Found 2');
		expect(box('01_tauri').checked).toBe(true);
		expect(box('02_next').checked).toBe(true);
		// the path, not only the folder name: two 01_tauri folders on two disks
		// are told apart by nothing else
		expect(screen.getByText(TAURI.path)).toBeTruthy();
		expect(screen.getByText(NEXT.path)).toBeTruthy();
		expect(addButton().textContent).toBe('Add 2 folders');
		expect(addButton().disabled).toBe(false);
	});

	it('keeps a root already added on screen, ticked, inert and out of the batch', async () => {
		invoke.mockResolvedValue(FOUND);
		const { onAddMany } = mount([TAURI.path]);
		await screen.findByText(/^Found 3/);

		// listed and not hidden, or a rescan looks like it found less than the
		// scan before it
		expect(heading()).toBe('Found 3 · 1 already added');
		expect(box('01_tauri').checked).toBe(true);
		expect(box('01_tauri').disabled).toBe(true);
		// the tick is not what says "already here" — the word on the row is,
		// and it replaces the file system chip rather than sitting beside it
		expect(within(rowOf('01_tauri')).getByText('added')).toBeTruthy();
		expect(addButton().textContent).toBe('Add 2 folders');

		const user = userEvent.setup();
		await user.click(addButton());
		expect(onAddMany).toHaveBeenCalledTimes(1);
		expect(onAddMany.mock.calls[0]).toEqual([[NEXT.path, CODE.path]]);
	});

	it('reads a root as added through the same normalisation the store uses', async () => {
		invoke.mockResolvedValue(FOUND);
		// the other separator, and a trailing slash: the two spellings the
		// workspace store would refuse as duplicates
		const { onAddMany, onDone } = mount([ADDED_TAURI, ADDED_CODE]);
		await screen.findByText(/^Found 3/);

		expect(heading()).toBe('Found 3 · 2 already added');
		expect(box('01_tauri').disabled).toBe(true);
		expect(box('code').disabled).toBe(true);
		expect(box('02_next').disabled).toBe(false);
		expect(addButton().textContent).toBe('Add 1 folder');

		const user = userEvent.setup();
		await user.click(addButton());
		// only the one folder the store does not have, in the scan's spelling
		expect(onAddMany).toHaveBeenCalledTimes(1);
		expect(onAddMany.mock.calls[0]).toEqual([[NEXT.path]]);
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it('names a wsl root in words on its own row, not in colour alone', async () => {
		invoke.mockResolvedValue(FOUND);
		mount();
		await screen.findByText('Found 3');

		expect(within(rowOf('code')).getByText('WSL')).toBeTruthy();
		// the hue is the only other thing that says which file system a row is
		// on, so the word has to be on the row that owns it
		expect(within(rowOf('02_next')).queryByText('WSL')).toBeNull();
	});

	it('offers the manual route when the scan finds nothing, and lists nothing', async () => {
		invoke.mockResolvedValue([]);
		const { onError } = mount();

		expect(
			await screen.findByText(/No common project folders found/)
		).toBeTruthy();
		expect(screen.queryByRole('checkbox')).toBeNull();
		// ⚠️ deliberately NOT asserted: which controls this state offers. it
		// offers none — no Rescan — and the line it shows on windows ends
		// "…or start a WSL distro and scan again", which is an instruction with
		// no button behind it. reported, not locked in
		// an empty answer is an answer, not a failure
		expect(onError).not.toHaveBeenCalled();
	});
});

describe('ScanPicker — what crosses to onAddMany', () => {
	it('hands over exactly the ticked paths, once, and then closes', async () => {
		invoke.mockResolvedValue(FOUND);
		const { onAddMany, onDone } = mount();
		await screen.findByText('Found 3');

		const user = userEvent.setup();
		await user.click(box('02_next'));
		expect(addButton().textContent).toBe('Add 2 folders');

		await user.click(addButton());

		// once, with the two that are still ticked and the spelling the scan
		// gave — an add that fires twice is a duplicate the store has to refuse
		expect(onAddMany).toHaveBeenCalledTimes(1);
		expect(onAddMany.mock.calls[0]).toEqual([[TAURI.path, CODE.path]]);
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it('ticks only the addable rows from Check all, and says which way it will go', async () => {
		invoke.mockResolvedValue(FOUND);
		const { onAddMany } = mount([TAURI.path]);
		await screen.findByText(/^Found 3/);

		// everything addable is already ticked, so the control offers the other
		// direction — the word is the only thing that says which
		const user = userEvent.setup();
		await user.click(button('Uncheck all'));
		expect(addButton().disabled).toBe(true);
		expect(box('02_next').checked).toBe(false);
		// the row already added stays ticked through both directions: it is not
		// a pick, so neither word can reach it
		expect(box('01_tauri').checked).toBe(true);

		await user.click(button('Check all'));
		expect(addButton().textContent).toBe('Add 2 folders');

		await user.click(addButton());
		expect(onAddMany.mock.calls[0]).toEqual([[NEXT.path, CODE.path]]);
	});

	it('adds nothing at all while nothing is ticked', async () => {
		invoke.mockResolvedValue([TAURI, NEXT]);
		const { onAddMany, onDone } = mount();
		await screen.findByText('Found 2');

		const user = userEvent.setup();
		await user.click(button('Uncheck all'));

		const add = addButton();
		expect(add.disabled).toBe(true);
		await user.click(add);

		expect(onAddMany).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
	});

	it('offers nothing to check when every root is already added', async () => {
		invoke.mockResolvedValue(FOUND);
		const { onAddMany } = mount([TAURI.path, NEXT.path, CODE.path]);
		await screen.findByText(/^Found 3/);

		expect(heading()).toBe('Found 3 · 3 already added');
		// no addable row, so there is nothing for either control to do and both
		// say so instead of looking pressable
		expect(button('Check all').disabled).toBe(true);
		expect(addButton().disabled).toBe(true);
		for (const label of ['01_tauri', '02_next', 'code']) {
			expect(box(label).disabled).toBe(true);
			expect(box(label).checked).toBe(true);
		}
		expect(onAddMany).not.toHaveBeenCalled();
	});
});

describe('ScanPicker — a scan that fails', () => {
	// the string rust answers when there is no distro to look inside
	const REFUSED = 'no running wsl distro';

	it('hands the failure to onError once and asks for nothing twice', async () => {
		invoke.mockRejectedValue(REFUSED);
		const { onError, onAddMany } = mount();

		expect(
			await screen.findByText(/No common project folders found/)
		).toBeTruthy();
		// the message belongs to the host's toast, not to this panel, so the
		// call log is where it has to be observed
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0]).toEqual([REFUSED]);
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(onAddMany).not.toHaveBeenCalled();
	});
});
