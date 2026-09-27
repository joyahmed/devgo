import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from './ConfirmDialog';
import WslMenu from './WslMenu';

// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
//
// WslMenu is the only destructive WSL surface in the app: `Shut down all WSL`
// kills every distro, the WSL2 VM, and Docker Desktop with it if Docker rides
// the WSL2 backend. The whole contract is (1) a click NEVER reaches the
// backend directly — it only hands the sentence and the action to `onConfirm`,
// so a real confirm has to fire it — and (2) each entry reaches the exact
// rust command its label promises, with the exact payload.
//
// ⭐ THE assertion that matters most: `onConfirm(message, () => run(...))` —
// WslMenu.tsx:58 and :75 — passes a DEFERRED closure, never an invoked call.
// A refactor that turned either site into `onConfirm(message, run(...))`
// (invoking eagerly, handing `onConfirm` the return value) would fire the
// backend command on the click alone, before any dialog exists, and every
// test that only checks the confirm dialog's TEXT — never its wiring — would
// stay green. So most tests below click through a REAL ConfirmDialog (not a
// mocked onConfirm that swallows the callback), the same shape App.tsx wires
// at its own ConfirmDialog (App.tsx ~2545-2557): the harness below is that
// wiring, copied verbatim, so "click Cancel" and "click Stop" exercise the
// real confirm/cancel branches rather than a stand-in.
//
// mock shape: WslDoctor.test.tsx's — invoke mocked as one fn, every assertion
// reads its CALL LOG (command name + payload), never a returned promise.
// ─────────────────────────────────────────────────────────────────────────────

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

// the exact sentences WslMenu.tsx builds (STOP_ONE/STOP_ALL are module-scope,
// not exported) — copied verbatim so a changed word here is asserted, not
// silently tolerated by a looser match
const stopOne = (d: string) =>
	`Stop ${d}? Anything running inside it — dev servers, tmux sessions, VS Code Remote — will be terminated. Other distros are left alone.`;
const STOP_ALL =
	'Shut down all of WSL? This stops every distro and the virtual machine itself — including Docker Desktop if it uses the WSL2 backend. Use this when stopping a single distro did not clear the problem.';

const calls = (cmd: string) =>
	invoke.mock.calls.filter(c => (c as unknown[])[0] === cmd);

// App.tsx's own confirmAction state + ConfirmDialog wiring (App.tsx
// ~2032-2041, ~2545-2557), reproduced here rather than imported so the test
// exercises WslMenu's real onConfirm contract without mounting the whole app
const Harness = ({
	wsl,
	close,
	onChanged,
	onResult
}: {
	wsl: WslState;
	close: () => void;
	onChanged: () => void;
	onResult: (message: string, kind: ToastType) => void;
}) => {
	const [confirmAction, setConfirmAction] = useState<{
		message: string;
		run: () => void;
	} | null>(null);

	return (
		<>
			<WslMenu
				{...{
					wsl,
					close,
					onChanged,
					onResult,
					onConfirm: (message: string, run: () => void) =>
						setConfirmAction({ message, run })
				}}
			/>
			<ConfirmDialog
				{...{
					open: confirmAction !== null,
					title: 'Stop WSL',
					message: confirmAction?.message ?? '',
					confirmLabel: 'Stop',
					onConfirm: () => {
						confirmAction?.run();
						setConfirmAction(null);
					},
					onCancel: () => setConfirmAction(null)
				}}
			/>
		</>
	);
};

const dialog = () => screen.getByRole('dialog');
const rowStop = (label = 'Stop') =>
	screen.getAllByRole('button', { name: label })[0];

afterEach(cleanup);
// ⚠️ braces, not a concise body: vitest treats a function RETURNED from a
// beforeEach as that test's teardown, and mockReset() returns the mock — so
// `beforeEach(() => invoke.mockReset())` registers invoke ITSELF as a
// cleanup hook and calls it with no arguments after every test
beforeEach(() => {
	invoke.mockReset();
});

describe('WslMenu — the rows it renders', () => {
	it('one row per distro, Stop on each, and Shut down all WSL below a separator', () => {
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu', 'Debian'] }}
				close={vi.fn()}
				onChanged={vi.fn()}
				onResult={vi.fn()}
			/>
		);

		expect(screen.getByText('Ubuntu')).not.toBeNull();
		expect(screen.getByText('Debian')).not.toBeNull();
		expect(screen.getAllByRole('button', { name: 'Stop' }).length).toBe(2);
		expect(screen.getByText('Shut down all WSL')).not.toBeNull();
	});

	// item 5 of the brief: is anything hidden or disabled by STATE here? no —
	// WslMenu does not gate rows on `wsl.distros.length`. an empty list is
	// simply zero mapped rows; "Shut down all WSL" is unconditional and
	// always renders regardless of whether there is anything else to stop.
	// the ONLY thing that ever disables a button in this component is `busy`
	// (asserted below), and it disables every button uniformly, never one
	// selectively
	it('renders no Stop rows with zero distros, but Shut down all WSL stays', () => {
		render(
			<Harness
				wsl={{ up: true, distros: [] }}
				close={vi.fn()}
				onChanged={vi.fn()}
				onResult={vi.fn()}
			/>
		);

		expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
		expect(screen.getByText('Shut down all WSL')).not.toBeNull();
	});
});

describe('WslMenu — destructive entries DEFER, they do not fire on click', () => {
	it('⭐ "Stop" on a distro defers: the click opens the confirm, terminate_distro is not called', async () => {
		const user = userEvent.setup();
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu'] }}
				close={vi.fn()}
				onChanged={vi.fn()}
				onResult={vi.fn()}
			/>
		);

		await user.click(rowStop());

		expect(calls('terminate_distro')).toEqual([]);
		expect(await screen.findByText(stopOne('Ubuntu'))).not.toBeNull();
	});

	it('⭐ "Shut down all WSL" defers: the click opens the confirm, shutdown_wsl is not called', async () => {
		const user = userEvent.setup();
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu'] }}
				close={vi.fn()}
				onChanged={vi.fn()}
				onResult={vi.fn()}
			/>
		);

		await user.click(screen.getByText('Shut down all WSL'));

		expect(calls('shutdown_wsl')).toEqual([]);
		expect(await screen.findByText(STOP_ALL)).not.toBeNull();
	});

	it('cancelling the Stop confirm leaves terminate_distro uncalled', async () => {
		const user = userEvent.setup();
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu'] }}
				close={vi.fn()}
				onChanged={vi.fn()}
				onResult={vi.fn()}
			/>
		);

		await user.click(rowStop());
		await screen.findByText(stopOne('Ubuntu'));
		await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

		expect(calls('terminate_distro')).toEqual([]);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('cancelling the Shut down all confirm leaves shutdown_wsl uncalled', async () => {
		const user = userEvent.setup();
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu'] }}
				close={vi.fn()}
				onChanged={vi.fn()}
				onResult={vi.fn()}
			/>
		);

		await user.click(screen.getByText('Shut down all WSL'));
		await screen.findByText(STOP_ALL);
		await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

		expect(calls('shutdown_wsl')).toEqual([]);
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});

describe('WslMenu — confirming reaches the exact command with the exact payload', () => {
	it('confirming Stop invokes terminate_distro with { distro }', async () => {
		const user = userEvent.setup();
		invoke.mockResolvedValue('stopped');
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu'] }}
				close={vi.fn()}
				onChanged={vi.fn()}
				onResult={vi.fn()}
			/>
		);

		await user.click(rowStop());
		await screen.findByText(stopOne('Ubuntu'));
		await user.click(within(dialog()).getByRole('button', { name: 'Stop' }));

		await waitFor(() => expect(calls('terminate_distro').length).toBe(1), {
			timeout: 5000
		});
		expect(calls('terminate_distro')[0][1]).toEqual({ distro: 'Ubuntu' });
	});

	it('confirming Shut down all WSL invokes shutdown_wsl with {}', async () => {
		const user = userEvent.setup();
		invoke.mockResolvedValue('stopped');
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu'] }}
				close={vi.fn()}
				onChanged={vi.fn()}
				onResult={vi.fn()}
			/>
		);

		await user.click(screen.getByText('Shut down all WSL'));
		await screen.findByText(STOP_ALL);
		await user.click(within(dialog()).getByRole('button', { name: 'Stop' }));

		await waitFor(() => expect(calls('shutdown_wsl').length).toBe(1), {
			timeout: 5000
		});
		expect(calls('shutdown_wsl')[0][1]).toEqual({});
	});
});

describe('WslMenu — busy guards every button, not only the one clicked', () => {
	// ⛔ there is no per-row busy flag — `busy` is one value for the whole
	// menu (WslMenu.tsx:25, "so two can never be at once"), and every Button
	// in the menu reads `disabled={busy !== null}`. so the double-fire guard
	// is not "this row is mid-request", it is "ANYTHING in this menu is
	// mid-request" — asserted here by confirming Ubuntu's stop and, while it
	// is still in flight, showing Debian's row and the shutdown row are both
	// disabled too, not just Ubuntu's own button
	it('disables every row while one command is in flight, and re-enables them all after', async () => {
		const user = userEvent.setup();
		// a plain `let` reassigned only inside the Promise executor narrows to
		// `never` under TS's control-flow analysis at the read site below; a
		// boxed mutable field sidesteps that without loosening the type
		const pending: { release: ((v: string) => void) | null } = { release: null };
		invoke.mockImplementation(
			() =>
				new Promise<string>(resolve => {
					pending.release = resolve;
				})
		);
		const onChanged = vi.fn();
		const onResult = vi.fn();
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu', 'Debian'] }}
				close={vi.fn()}
				onChanged={onChanged}
				onResult={onResult}
			/>
		);

		await user.click(screen.getAllByRole('button', { name: 'Stop' })[0]);
		await screen.findByText(stopOne('Ubuntu'));
		await user.click(within(dialog()).getByRole('button', { name: 'Stop' }));

		// in flight: Ubuntu's own button now reads "Stopping…" and is
		// disabled; Debian's "Stop" and "Shut down all WSL" are disabled too,
		// though neither of THEM was clicked
		const stopping = await screen.findByText('Stopping…');
		expect((stopping.closest('button') as HTMLButtonElement).disabled).toBe(true);
		expect(
			(screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled
		).toBe(true);
		expect(
			(screen.getByRole('button', { name: 'Shut down all WSL' }) as HTMLButtonElement)
				.disabled
		).toBe(true);

		// a click on Debian's disabled row reaches nothing: the disabled
		// attribute on the real <button> (Button.tsx) makes user-event's
		// click a no-op, so no second confirm opens and no second call lands
		await user.click(screen.getByRole('button', { name: 'Stop' }));
		expect(screen.queryByText(stopOne('Debian'))).toBeNull();
		expect(calls('terminate_distro').length).toBe(1);

		// resolve the in-flight command: busy clears, both onChanged and
		// onResult fired exactly once, and every row is usable again
		pending.release?.('stopped');
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1), {
			timeout: 5000
		});
		expect(onResult).toHaveBeenCalledWith('stopped', 'success');
		expect(screen.getAllByRole('button', { name: 'Stop' })[0].hasAttribute('disabled')).toBe(
			false
		);
	});
});

describe('WslMenu — the failure path', () => {
	// invoke rejects; the `.finally` in `run` (WslMenu.tsx:32-38) still runs
	// setBusy(null), close() and onChanged() unconditionally — nothing in the
	// component distinguishes success from failure except what onResult is
	// told to say. the failure is visible to the user ONLY through onResult
	// (the real app wires this straight to its toast, App.tsx:2039) — there
	// is no error text, icon or row state inside WslMenu itself
	it('an invoke rejection still closes the menu and refreshes, and is reported through onResult', async () => {
		const user = userEvent.setup();
		invoke.mockRejectedValue('wsl.exe exited with code 1');
		const close = vi.fn();
		const onChanged = vi.fn();
		const onResult = vi.fn();
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu'] }}
				close={close}
				onChanged={onChanged}
				onResult={onResult}
			/>
		);

		await user.click(rowStop());
		await screen.findByText(stopOne('Ubuntu'));
		await user.click(within(dialog()).getByRole('button', { name: 'Stop' }));

		await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1), { timeout: 5000 });
		expect(onResult).toHaveBeenCalledWith('wsl.exe exited with code 1', 'error');
		expect(close).toHaveBeenCalledTimes(1);
		expect(onChanged).toHaveBeenCalledTimes(1);
	});

	// the `.catch` does `typeof e === 'string' ? e : String(e)` — a rejection
	// that is not a string (an Error, say) is stringified rather than kept as
	// an object, so onResult always receives a string
	it('a non-string rejection is stringified before onResult sees it', async () => {
		const user = userEvent.setup();
		invoke.mockRejectedValue(new Error('backend exploded'));
		const onResult = vi.fn();
		render(
			<Harness
				wsl={{ up: true, distros: ['Ubuntu'] }}
				close={vi.fn()}
				onChanged={vi.fn()}
				onResult={onResult}
			/>
		);

		await user.click(rowStop());
		await screen.findByText(stopOne('Ubuntu'));
		await user.click(within(dialog()).getByRole('button', { name: 'Stop' }));

		await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1), { timeout: 5000 });
		expect(onResult).toHaveBeenCalledWith('Error: backend exploded', 'error');
	});
});
