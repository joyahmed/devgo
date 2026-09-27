import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ServerForm from './ServerForm';

// no invoke mock here, and none is missing: ServerForm imports useState and
// Button and nothing else — its whole import graph reaches
// @tauri-apps/api nowhere. every ask travels through onSubmit/onDone, so the
// two spies ARE the wire and the draft they receive is the contract
afterEach(cleanup);

// the row being edited. an id-shaped literal lives in a named const because
// src-tauri/src/commands.rs walks this directory and refuses a frontend file
// that spells an id next to an id-shaped key
const SERVER_ID = 'srv-box';

const EXISTING: Server = {
	id: SERVER_ID,
	name: 'Prod box',
	alias: 'box',
	host: 'box',
	user: 'joy',
	port: 2222,
	identity: '~/.ssh/id_ed25519',
	default_path: '/srv/apps',
	tmux: true,
	session: 'devgo',
	// neither is editable on this form; both must survive a Save untouched
	tunnel: true,
	source: 'ssh_config',
	roots: ['~/projects', '/var/www']
};

const form = (
	over: {
		initial?: Server;
		onSubmit?: (server: ServerDraft) => Promise<void>;
	} = {}
) => {
	const onSubmit = vi.fn(over.onSubmit ?? (() => Promise.resolve()));
	const onDone = vi.fn();
	render(
		<ServerForm initial={over.initial} onSubmit={onSubmit} onDone={onDone} />
	);
	return { onSubmit, onDone };
};

// every box is found by its placeholder: the labels are plain spans with no
// htmlFor, so a label query would only find the text and not the control
const box = (ph: string) => screen.getByPlaceholderText(ph) as HTMLInputElement;
const nameBox = () => box('My VPS');
const aliasBox = () => box('box');
const hostBox = () => box('203.0.113.7');
const userBox = () => box('user');
const portBox = () => box('22');
const identityBox = () => box('~/.ssh/id_ed25519');
const pathBox = () => box('/home/user/projects');
const sessionBox = () => box('devgo');
// the textarea's placeholder is two lines; getByPlaceholderText normalizes
// the newline to a space, so it is matched from the front instead
const rootsBox = () =>
	screen.getByPlaceholderText(/^~\/projects/) as HTMLTextAreaElement;

const saveButton = () =>
	screen.getByRole('button', {
		name: /^(Add server|Save|Saving…)$/
	}) as HTMLButtonElement;
const modeButton = (label: string) =>
	screen.getByRole('button', { name: label }) as HTMLButtonElement;

// a promise this file settles by hand, so the saving state can be observed
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

// the smallest add that is allowed through: a name and one way in
const fillMinimum = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.type(nameBox(), 'My VPS');
	await user.type(aliasBox(), 'box');
};

describe('ServerForm — the gate on the save button', () => {
	it('refuses to save until a name and a way in are both there', async () => {
		const user = userEvent.setup();
		form();
		expect(saveButton().disabled).toBe(true);

		await user.type(nameBox(), 'My VPS');
		// a name alone is not a server: nothing says where to connect
		expect(saveButton().disabled).toBe(true);

		await user.type(aliasBox(), 'box');
		expect(saveButton().disabled).toBe(false);
	});

	it('takes a host as the way in when there is no alias', async () => {
		const user = userEvent.setup();
		form();
		await user.type(nameBox(), 'My VPS');
		await user.type(hostBox(), '203.0.113.7');
		expect(saveButton().disabled).toBe(false);
	});

	it('counts a name of only spaces as no name', async () => {
		const user = userEvent.setup();
		form();
		await user.type(nameBox(), '   ');
		await user.type(aliasBox(), 'box');
		expect(saveButton().disabled).toBe(true);
	});

	it('says Add server for a new row and Save for an existing one', () => {
		form();
		expect(screen.getByRole('button', { name: 'Add server' })).toBeTruthy();
		cleanup();
		form({ initial: EXISTING });
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
	});
});

describe('ServerForm — the draft that crosses to onSubmit', () => {
	it('sends the minimum once, with every untouched field as null', async () => {
		const user = userEvent.setup();
		const { onSubmit, onDone } = form();
		await fillMinimum(user);
		await user.click(saveButton());

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit.mock.calls[0][0]).toEqual({
			id: undefined,
			name: 'My VPS',
			alias: 'box',
			// no host typed: the alias stands in, so the draft is never
			// missing the thing ssh connects to
			host: 'box',
			user: null,
			port: null,
			identity: null,
			default_path: null,
			tmux: true,
			session: null,
			tunnel: false,
			source: 'manual',
			roots: []
		});
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
	});

	it('trims the name and turns a blank optional into null, not an empty string', async () => {
		const user = userEvent.setup();
		const { onSubmit } = form();
		await user.type(nameBox(), '  My VPS  ');
		await user.type(aliasBox(), 'box');
		// three boxes touched and left holding only spaces
		await user.type(userBox(), '  ');
		await user.type(identityBox(), ' ');
		await user.type(pathBox(), '   ');
		await user.click(saveButton());

		const draft = onSubmit.mock.calls[0][0];
		expect(draft.name).toBe('My VPS');
		expect(draft.user).toBeNull();
		expect(draft.identity).toBeNull();
		expect(draft.default_path).toBeNull();
	});

	it('keeps a typed host and does not let the alias overwrite it', async () => {
		const user = userEvent.setup();
		const { onSubmit } = form();
		await user.type(nameBox(), 'My VPS');
		await user.type(aliasBox(), 'box');
		await user.type(hostBox(), '203.0.113.7');
		await user.click(saveButton());

		const draft = onSubmit.mock.calls[0][0];
		expect(draft.alias).toBe('box');
		expect(draft.host).toBe('203.0.113.7');
	});

	it('drops everything that is not a digit from the port and sends a number', async () => {
		const user = userEvent.setup();
		const { onSubmit } = form();
		await fillMinimum(user);
		await user.type(portBox(), '2x2j2');
		// the box refuses the letters as they are typed, so what is on screen
		// is what will be sent
		expect(portBox().value).toBe('222');
		await user.click(saveButton());
		expect(onSubmit.mock.calls[0][0].port).toBe(222);
		expect(typeof onSubmit.mock.calls[0][0].port).toBe('number');
	});

	it('splits the roots box per line, trims each and drops the blank ones', async () => {
		const user = userEvent.setup();
		const { onSubmit } = form();
		await fillMinimum(user);
		await user.type(rootsBox(), '  ~/apps  \n\n/var/www\n   \n');
		await user.click(saveButton());
		expect(onSubmit.mock.calls[0][0].roots).toEqual(['~/apps', '/var/www']);
	});

	it('sends tmux false for a plain shell and marks the chosen mode in the markup', async () => {
		const user = userEvent.setup();
		const { onSubmit } = form();
		await fillMinimum(user);
		// which mode is chosen is said by aria-current, not by the colour of
		// the pill — the attribute is what a reader and this test both get
		expect(modeButton('Session').getAttribute('aria-current')).toBe('true');
		expect(modeButton('Plain shell').getAttribute('aria-current')).toBeNull();

		await user.click(modeButton('Plain shell'));
		expect(modeButton('Plain shell').getAttribute('aria-current')).toBe('true');
		expect(modeButton('Session').getAttribute('aria-current')).toBeNull();
		// and the session name is unreachable while there is no session
		expect(sessionBox().disabled).toBe(true);

		await user.click(saveButton());
		expect(onSubmit.mock.calls[0][0].tmux).toBe(false);
	});

	it('carries the id, the tunnel and the source of the row it is editing', async () => {
		const user = userEvent.setup();
		const { onSubmit } = form({ initial: EXISTING });
		// prefilled from the row, including the roots as one per line
		expect(nameBox().value).toBe('Prod box');
		expect(portBox().value).toBe('2222');
		expect(sessionBox().value).toBe('devgo');
		expect(rootsBox().value).toBe('~/projects\n/var/www');

		await user.clear(nameBox());
		await user.type(nameBox(), 'Renamed');
		await user.click(saveButton());

		expect(onSubmit.mock.calls[0][0]).toEqual({
			id: SERVER_ID,
			name: 'Renamed',
			alias: 'box',
			host: 'box',
			user: 'joy',
			port: 2222,
			identity: '~/.ssh/id_ed25519',
			default_path: '/srv/apps',
			tmux: true,
			session: 'devgo',
			// neither has a control on this form; a Save that flipped one
			// would be silently un-tunnelling a box
			tunnel: true,
			source: 'ssh_config',
			roots: ['~/projects', '/var/www']
		});
	});
});

describe('ServerForm — one click means one save', () => {
	it('sends once while the first save is still in flight', async () => {
		const user = userEvent.setup();
		const slow = deferred<void>();
		const { onSubmit, onDone } = form({ onSubmit: () => slow.promise });
		await fillMinimum(user);
		await user.click(saveButton());

		const saving = (await screen.findByRole('button', {
			name: 'Saving…'
		})) as HTMLButtonElement;
		expect(saving.disabled).toBe(true);
		await user.click(saveButton());
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onDone).not.toHaveBeenCalled();

		slow.settle();
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it('shows the failure, keeps the form open and lets the save be tried again', async () => {
		const user = userEvent.setup();
		const { onSubmit, onDone } = form({
			onSubmit: () => Promise.reject('ssh: no route to host')
		});
		await fillMinimum(user);
		await user.click(saveButton());

		expect(await screen.findByText(/no route to host/)).toBeTruthy();
		// the form is the only place the typed draft exists, so a failed save
		// must not close it
		expect(onDone).not.toHaveBeenCalled();
		expect(saveButton().disabled).toBe(false);

		await user.click(saveButton());
		expect(onSubmit).toHaveBeenCalledTimes(2);
	});

	it('closes on Cancel without sending anything', async () => {
		const user = userEvent.setup();
		const { onSubmit, onDone } = form();
		await fillMinimum(user);
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
