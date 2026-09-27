import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ActionForm from './ActionForm';

// the form reaches the machine through exactly one command — the same rust
// compose that will send the line — so the mock answers that command from the
// values it was handed, and the call log is the contract every test reads
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

// id-shaped literals live in named consts: src-tauri/src/commands.rs walks
// this directory and refuses a frontend file that spells an id inline next to
// an id-shaped key
const SERVER_ID = 'srv-box';
const ACTION_ID = 'pm2-restart';

const SERVER: Server = {
	id: SERVER_ID,
	name: 'Prod box',
	alias: 'box',
	host: 'box',
	user: 'joy',
	port: null,
	identity: null,
	default_path: null,
	tmux: true,
	session: null,
	tunnel: false,
	source: 'manual',
	roots: []
};

const field = (
	name: string,
	over: Partial<ServerActionField> = {}
): ServerActionField => ({
	name,
	label: null,
	type: 'text',
	required: false,
	default: null,
	options: [],
	prefill: null,
	when: null,
	arg: null,
	arg_off: null,
	hint: null,
	...over
});

const action = (over: Partial<ServerAction> = {}): ServerAction => ({
	id: ACTION_ID,
	label: 'Restart',
	kind: 'form',
	root: false,
	command: 'pm2 restart {app} {flags}',
	group: null,
	fields: [],
	preview: null,
	submit: null,
	...over
});

// the line rust answers with. nothing in it repeats a label, so a query for a
// label can never match the line box by accident
const LINE = 'pm2 restart erp-api';

// one place that decides what compose answers, from the values it was given.
// a thrown string is a rejected command — which is how rust names a bad field
const composes = (answer: (values: Record<string, string>) => string) =>
	invoke.mockImplementation(
		(cmd: string, args: { values: Record<string, string> }) => {
			if (cmd !== 'compose_server_action') {
				return Promise.reject(`no such command: ${cmd}`);
			}
			try {
				return Promise.resolve(answer(args.values));
			} catch (e) {
				return Promise.reject(e);
			}
		}
	);

const mount = (
	over: {
		action?: ServerAction;
		appDir?: string | null;
		initial?: Record<string, string>;
		onRun?: (values: Record<string, string>, preview: boolean) => Promise<void>;
	} = {}
) => {
	const onRun = vi.fn(over.onRun ?? (() => Promise.resolve()));
	const onDone = vi.fn();
	render(
		<ActionForm
			server={SERVER}
			action={over.action ?? action()}
			appDir={over.appDir ?? null}
			initial={over.initial ?? {}}
			onRun={onRun}
			onDone={onDone}
		/>
	);
	return { onRun, onDone };
};

// the fields carry no htmlFor, so a text or number box is found by its place
// in the grid — which is the declaration order of action.fields, filtered by
// `when`. that order IS the contract: the form draws what the server declared,
// in the order it declared it
const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const pill = (name: string) =>
	screen.getByRole('button', { name }) as HTMLButtonElement;
const submitButton = (name: string) => pill(name);

// a promise this file settles by hand, so the sending state can be observed
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

// the newest compose. tsconfig's lib predates Array.prototype.at, so the
// index is taken by hand
const lastCall = () => invoke.mock.calls[invoke.mock.calls.length - 1];

// the compose payload, spelled once
const composeCall = (
	values: Record<string, string>,
	appDir: string | null = null
) => [
	'compose_server_action',
	{ id: SERVER_ID, actionId: ACTION_ID, appDir, values, preview: false }
];

describe('ActionForm — the line it shows comes from the compose that will send it', () => {
	it('composes once on mount, with the whole payload and preview off', async () => {
		composes(() => LINE);
		mount({ appDir: '/srv/erp' });

		expect(await screen.findByText(LINE)).toBeTruthy();
		expect(invoke).toHaveBeenCalledTimes(1);
		// preview is false even for an action that HAS a preview word: the box
		// shows the line the submit button will send, not the dry run
		expect(invoke.mock.calls[0]).toEqual(composeCall({}, '/srv/erp'));
	});

	it('recomposes on every keystroke and carries the typed values', async () => {
		composes(v => `pm2 restart ${v.app ?? ''}`.trim());
		mount({ action: action({ fields: [field('app', { label: 'Application' })] }) });
		await screen.findByText('pm2 restart');

		const user = userEvent.setup();
		await user.type(boxes()[0], 'erp');

		// one compose on mount plus one per keystroke: a form that composed
		// twice per change would double every command it sends
		await waitFor(() => expect(invoke).toHaveBeenCalledTimes(4));
		expect(invoke.mock.calls[3]).toEqual(composeCall({ app: 'erp' }));
		expect(await screen.findByText('pm2 restart erp')).toBeTruthy();
	});

	it('names the server, the app dir and the sudo prompt a root action brings', async () => {
		composes(() => LINE);
		mount({ appDir: '/srv/erp', action: action({ root: true }) });
		await screen.findByText(LINE);

		expect(screen.getByText('Prod box')).toBeTruthy();
		expect(screen.getByText('/srv/erp')).toBeTruthy();
		expect(screen.getByText(/will ask in the terminal/)).toBeTruthy();
	});

	it('says nothing about sudo when the action does not need it', async () => {
		composes(() => LINE);
		mount();
		await screen.findByText(LINE);
		expect(screen.queryByText(/will ask in the terminal/)).toBeNull();
	});
});

describe('ActionForm — which fields are on screen', () => {
	// a field gated on a bool, which is the shape a real regen form uses
	const GATED = action({
		fields: [
			field('overwrite', { label: 'Overwrite', type: 'bool' }),
			field('backup', { label: 'Backup name', when: 'overwrite' })
		]
	});

	it('hides a gated field until its condition holds, then composes with it', async () => {
		composes(() => LINE);
		mount({ action: GATED });
		await screen.findByText(LINE);
		expect(screen.queryByText(/^Backup name/)).toBeNull();

		const user = userEvent.setup();
		await user.click(pill('On'));

		expect(await screen.findByText(/^Backup name/)).toBeTruthy();
		await waitFor(() =>
			expect(lastCall()).toEqual(composeCall({ overwrite: 'true' }))
		);
	});

	it('marks the chosen side of a bool with aria-current, not with colour alone', async () => {
		composes(() => LINE);
		mount({ action: GATED, initial: { overwrite: 'false' } });
		await screen.findByText(LINE);

		expect(pill('Off').getAttribute('aria-current')).toBe('true');
		expect(pill('On').getAttribute('aria-current')).toBeNull();

		const user = userEvent.setup();
		await user.click(pill('On'));
		expect(pill('On').getAttribute('aria-current')).toBe('true');
		expect(pill('Off').getAttribute('aria-current')).toBeNull();
	});

	it('draws a choice as one pill per option and sends the one that is picked', async () => {
		composes(() => LINE);
		mount({
			action: action({
				fields: [
					field('mode', {
						label: 'Mode',
						type: 'choice',
						options: ['fast', 'safe']
					})
				]
			}),
			initial: { mode: 'fast' }
		});
		await screen.findByText(LINE);
		expect(pill('fast').getAttribute('aria-current')).toBe('true');

		const user = userEvent.setup();
		await user.click(pill('safe'));

		expect(pill('safe').getAttribute('aria-current')).toBe('true');
		await waitFor(() =>
			expect(lastCall()).toEqual(composeCall({ mode: 'safe' }))
		);
	});

	it('shows a field hint under the box it belongs to', async () => {
		composes(() => LINE);
		mount({
			action: action({
				fields: [field('app', { label: 'Application', hint: 'the pm2 name' })]
			})
		});
		await screen.findByText(LINE);
		const hint = screen.getByText('the pm2 name');
		expect(hint.parentElement?.querySelector('input')).toBeTruthy();
	});
});

describe("ActionForm — a compose that refuses names the field it refused", () => {
	const REQUIRED = action({
		fields: [field('instances', { label: 'Instances', type: 'number', required: true })]
	});
	// exactly what rust answers for an empty required field
	const NEEDED = 'Instances is required';

	it('puts the message in the cell of the field it names and blocks the send', async () => {
		composes(v => {
			if (!v.instances) throw NEEDED;
			return `pm2 scale erp-api ${v.instances}`;
		});
		const { onRun } = mount({ action: REQUIRED });

		const message = await screen.findByText(NEEDED);
		// the cell that holds the message also holds the input: that is what
		// "the message sits under the field" means in the DOM, and it is the
		// half of it that is not layout
		expect(message.parentElement?.querySelector('input')).toBeTruthy();
		expect(submitButton('Run').disabled).toBe(true);
		expect(onRun).not.toHaveBeenCalled();
	});

	it('puts a message that names no field in the line box instead', async () => {
		const NO_ACTION = 'No such action';
		composes(() => {
			throw NO_ACTION;
		});
		mount({ action: REQUIRED });

		const message = await screen.findByText(NO_ACTION);
		// no input in this cell: it is the line box, which is where a failure
		// that belongs to no field has to go or it is shown nowhere
		expect(message.parentElement?.querySelector('input')).toBeNull();
		expect(submitButton('Run').disabled).toBe(true);
	});

	it('clears the message and unblocks the send as soon as the value composes', async () => {
		composes(v => {
			if (!v.instances) throw NEEDED;
			return `pm2 scale erp-api ${v.instances}`;
		});
		mount({ action: REQUIRED });
		await screen.findByText(NEEDED);

		const user = userEvent.setup();
		await user.type(boxes()[0], '2');

		expect(await screen.findByText('pm2 scale erp-api 2')).toBeTruthy();
		expect(screen.queryByText(NEEDED)).toBeNull();
		await waitFor(() => expect(submitButton('Run').disabled).toBe(false));
	});
});

describe('ActionForm — what the two buttons hand to onRun', () => {
	const PREVIEWABLE = action({
		fields: [field('app', { label: 'Application' })],
		preview: '--dry-run',
		submit: 'Restart'
	});

	it('sends the values with preview false, once, and then closes', async () => {
		composes(() => LINE);
		const { onRun, onDone } = mount({
			action: PREVIEWABLE,
			initial: { app: 'erp-api' }
		});
		await screen.findByText(LINE);

		const user = userEvent.setup();
		await user.click(submitButton('Restart'));

		expect(onRun).toHaveBeenCalledTimes(1);
		expect(onRun.mock.calls[0]).toEqual([{ app: 'erp-api' }, false]);
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
	});

	it('sends the same values with preview true from the Preview button', async () => {
		composes(() => LINE);
		const { onRun, onDone } = mount({
			action: PREVIEWABLE,
			initial: { app: 'erp-api' }
		});
		await screen.findByText(LINE);

		const user = userEvent.setup();
		await user.click(submitButton('Preview'));

		expect(onRun).toHaveBeenCalledTimes(1);
		expect(onRun.mock.calls[0]).toEqual([{ app: 'erp-api' }, true]);
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		// the preview word is named in words, so the button's effect is
		// readable before it is pressed
		expect(screen.queryByText('--dry-run')).toBeTruthy();
	});

	it('offers no Preview button for an action that has no preview word', async () => {
		composes(() => LINE);
		mount({ action: action({ submit: 'Restart' }) });
		await screen.findByText(LINE);
		expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
		expect(submitButton('Restart').disabled).toBe(false);
	});

	it('sends once while the first send is still in flight', async () => {
		composes(() => LINE);
		const slow = deferred<void>();
		const { onRun, onDone } = mount({
			action: PREVIEWABLE,
			initial: { app: 'erp-api' },
			onRun: () => slow.promise
		});
		await screen.findByText(LINE);

		const user = userEvent.setup();
		await user.click(submitButton('Restart'));

		const sending = await screen.findByRole('button', { name: 'Sending…' });
		expect((sending as HTMLButtonElement).disabled).toBe(true);
		expect(submitButton('Preview').disabled).toBe(true);
		await user.click(sending);
		expect(onRun).toHaveBeenCalledTimes(1);
		expect(onDone).not.toHaveBeenCalled();

		slow.settle();
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		expect(onRun).toHaveBeenCalledTimes(1);
	});

	it('shows a failed send and keeps the form open', async () => {
		composes(() => LINE);
		const REFUSED = 'ssh: no route to host';
		const { onDone } = mount({
			action: PREVIEWABLE,
			initial: { app: 'erp-api' },
			onRun: () => Promise.reject(REFUSED)
		});
		await screen.findByText(LINE);

		const user = userEvent.setup();
		await user.click(submitButton('Restart'));

		expect(await screen.findByText(REFUSED)).toBeTruthy();
		// the values are only in this form; a failed send must not close it
		expect(onDone).not.toHaveBeenCalled();
	});

	it('closes on Cancel without sending or recomposing', async () => {
		composes(() => LINE);
		const { onRun, onDone } = mount({ action: PREVIEWABLE });
		await screen.findByText(LINE);
		const composedSoFar = invoke.mock.calls.length;

		const user = userEvent.setup();
		await user.click(pill('Cancel'));

		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onRun).not.toHaveBeenCalled();
		expect(invoke).toHaveBeenCalledTimes(composedSoFar);
	});
});
