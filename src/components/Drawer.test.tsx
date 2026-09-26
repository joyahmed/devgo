import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Drawer from './Drawer';

// every component that talks to rust does it through this one import, with
// no wrapper layer to stub. the drawer reaches it through uiLog, which
// writes the open/close lines into devgo.log
const invoke = vi.fn(() => Promise.resolve());
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }));

afterEach(cleanup);
beforeEach(() => invoke.mockClear());

// the lines uiLog sent to rust, in order, so a test can ask what the log
// will actually say rather than what the component meant to say
const logged = () =>
	invoke.mock.calls
		.filter(c => (c as unknown[])[0] === 'log_ui_line')
		.map(c => ((c as unknown[])[1] as { line: string }).line);

// open state lives in the caller in the real app, and the close paths are
// only real if pressing them actually takes the drawer away
const Harness = ({ onClose }: { onClose?: () => void }) => {
	const [open, setOpen] = useState(true);
	return (
		<>
			<button>outside</button>
			<Drawer
				open={open}
				side='right'
				title='Clone'
				logAs='clone'
				onClose={() => {
					onClose?.();
					setOpen(false);
				}}
			>
				<input aria-label='repo url' />
				<button>Clone it</button>
			</Drawer>
		</>
	);
};

describe('Drawer — the ways out', () => {
	it('closes on Escape', async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(<Harness onClose={onClose} />);

		await user.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('closes on a backdrop click but not on a click inside the panel', async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(<Harness onClose={onClose} />);

		// the panel stops the click; the backdrop is its parent, and this is
		// the only way the dimmed area can be addressed — it has no role and
		// deliberately no label
		const panel = screen.getByRole('dialog');
		await user.click(panel);
		expect(onClose).not.toHaveBeenCalled();

		await user.click(panel.parentElement as HTMLElement);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	// `if (!open) return null` — not hidden, not display:none. a closed
	// drawer's form must not keep its state, keep listening, or keep its
	// inputs in the tab order behind the list
	it('unmounts its body when closed rather than hiding it', async () => {
		const user = userEvent.setup();
		render(<Harness />);

		expect(screen.getByLabelText('repo url')).not.toBeNull();
		await user.keyboard('{Escape}');
		expect(screen.queryByLabelText('repo url')).toBeNull();
		expect(document.querySelector('[data-drawer-body]')).toBeNull();
	});
});

describe('Drawer — focus', () => {
	// the first control in the BODY, not the header's ✕, which is first in
	// dom order and is the thing you least want to press
	it('moves focus to the first control in the body, not the ✕', () => {
		render(<Harness />);
		expect(document.activeElement).toBe(screen.getByLabelText('repo url'));
	});

	it('gives focus back to whatever had it when it closes', async () => {
		const user = userEvent.setup();
		render(<Harness />);

		const outside = screen.getByRole('button', { name: 'outside' });
		outside.focus();
		// re-open is not a thing this harness does; instead assert the drawer
		// hands focus back to the element that held it at close time
		await user.keyboard('{Escape}');
		expect(document.activeElement).toBe(outside);
	});
});

// the palette is itself a Drawer and is summoned from anywhere, so two
// of these can be up at once. jsdom cannot judge which one is PAINTED on
// top - that is z-index and compositing, and the z prop is asserted in
// App, not here - but it can judge every other half of that bug: who has
// focus, who gets the keys, and who closes
describe('Drawer — two of them at once', () => {
	// a picker with a search box, then the palette over it: the shape of
	// the real defect, where Ctrl+Shift+P left the caret in the picker
	const Stacked = ({ onTop, onUnder }: { onTop: () => void; onUnder: () => void }) => {
		const [top, setTop] = useState(false);
		return (
			<>
				<Drawer open={true} side='right' title='Clone' onClose={onUnder}>
					<input aria-label='find a repo' />
				</Drawer>
				<Drawer open={top} side='top' onClose={() => { onTop(); setTop(false); }}>
					<input aria-label='type a command' />
				</Drawer>
				<button onClick={() => setTop(true)}>summon</button>
			</>
		);
	};

	it('gives the keyboard to the one that opened last', async () => {
		const user = userEvent.setup();
		render(<Stacked onTop={() => {}} onUnder={() => {}} />);

		expect(document.activeElement).toBe(screen.getByLabelText('find a repo'));
		await user.click(screen.getByRole('button', { name: 'summon' }));
		// the defect: the drawer underneath re-ran its focus effect on the
		// re-render that opened this one and took the caret straight back
		expect(document.activeElement).toBe(screen.getByLabelText('type a command'));
	});

	it('closes only the top one on Escape', async () => {
		const user = userEvent.setup();
		const onTop = vi.fn();
		const onUnder = vi.fn();
		render(<Stacked onTop={onTop} onUnder={onUnder} />);

		await user.click(screen.getByRole('button', { name: 'summon' }));
		await user.keyboard('{Escape}');

		expect(onTop).toHaveBeenCalledTimes(1);
		expect(onUnder).not.toHaveBeenCalled();
		// and the one underneath is still there
		expect(screen.getByLabelText('find a repo')).not.toBeNull();
	});

	it('hands Escape back to the one underneath once the top one goes', async () => {
		const user = userEvent.setup();
		const onTop = vi.fn();
		const onUnder = vi.fn();
		render(<Stacked onTop={onTop} onUnder={onUnder} />);

		await user.click(screen.getByRole('button', { name: 'summon' }));
		await user.keyboard('{Escape}');
		await user.keyboard('{Escape}');
		expect(onUnder).toHaveBeenCalledTimes(1);
	});
});

// the caret belongs to whoever the user last put it on. the focus effect
// used to name onClose in its deps, and every call site passes a fresh
// arrow, so a render of App anywhere - a toast, a clone tick, a poll -
// re-ran it and dragged focus back to the first control in the body
describe('Drawer — focus is taken once, not on every render', () => {
	// a FRESH onClose arrow each time, which is what every call site in App
	// passes: that identity change was in the focus effect's deps, so the
	// effect tore down and re-ran and put the caret back on the first
	// control. nothing else about the render differs
	const body = (
		<>
			<input aria-label='first' />
			<input aria-label='second' />
		</>
	);
	const at = (n: number) => (
		<Drawer open={true} side='right' title={`Clone ${n}`} onClose={() => {}}>
			{body}
		</Drawer>
	);

	it('leaves the caret where the user put it when the parent re-renders', () => {
		const { rerender } = render(at(1));

		const second = screen.getByLabelText('second');
		second.focus();
		rerender(at(2));
		rerender(at(3));

		expect(document.activeElement).toBe(second);
		expect(document.activeElement).not.toBe(screen.getByLabelText('first'));
	});
});

describe('Drawer — the close reason in devgo.log', () => {
	// the word UNEXPLAINED is only worth anything if it is rare, so every
	// exit this file owns has to name itself on the way out
	it('names Escape', async () => {
		const user = userEvent.setup();
		render(<Harness />);

		expect(logged()).toContain('drawer "clone" opened');
		await user.keyboard('{Escape}');
		expect(logged().some(l => l.includes('closed: Escape'))).toBe(true);
	});

	it('names the backdrop', async () => {
		const user = userEvent.setup();
		render(<Harness />);

		await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
		expect(logged().some(l => l.includes('closed: backdrop click'))).toBe(true);
	});

	it('names the ✕', async () => {
		const user = userEvent.setup();
		render(<Harness />);

		await user.click(screen.getByRole('button', { name: 'Close' }));
		expect(logged().some(l => l.includes('closed: the ✕ button'))).toBe(true);
	});

	// a close nobody in this file caused, and no caller explained, must read
	// as UNEXPLAINED — that line is the whole point of the log
	it('says UNEXPLAINED when the drawer goes away on its own', () => {
		const { rerender } = render(
			<Drawer open={true} side='right' title='Clone' logAs='clone' onClose={() => {}}>
				<input aria-label='repo url' />
			</Drawer>
		);
		rerender(
			<Drawer open={false} side='right' title='Clone' logAs='clone' onClose={() => {}}>
				<input aria-label='repo url' />
			</Drawer>
		);
		expect(logged().some(l => l.includes('UNEXPLAINED'))).toBe(true);
	});

	// jsdom cannot composite, so it cannot see a lane through a panel — but
	// the class is the whole difference. bg-secondary follows the
	// transparency knob and with that knob at 10 the settings panels were read
	// with /var/www, twenty repo names, client hostnames and ports legible
	// behind the prose; bg-popover is the same hex with the knob taken off
	// it. the bg-black/40 backdrop is not a substitute and was the reason
	// 71fc000 left the drawer out: it dims what is behind, it does not hide
	// it
	it('sits on the ground the transparency knob cannot reach', () => {
		render(<Harness />);

		const panel = screen.getByRole('dialog');
		expect(panel.className).toContain('bg-bg-popover');
		expect(panel.className).not.toContain('bg-bg-secondary');
	});
});
