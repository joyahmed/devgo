import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Select from './Select';

afterEach(cleanup);

// jsdom has no layout, so it ships no scrollIntoView at all — and the open
// list calls it to keep the highlight in view on every move. without this
// the component throws inside an effect and the open-list case can't be
// tested at all
const noScroll = () => {};
let realScroll: typeof Element.prototype.scrollIntoView;
beforeAll(() => {
	realScroll = Element.prototype.scrollIntoView;
	Element.prototype.scrollIntoView = noScroll;
});
afterAll(() => {
	Element.prototype.scrollIntoView = realScroll;
});

// four workspaces, THREE of which begin with the same character. that is
// the whole point: a list with one match per letter cannot tell a jump
// that cycles from one that re-picks the row it is already on, and the
// bug Alina found on X11 was exactly that difference
const WORKSPACES: SelectOption[] = [
	{ value: '/g/01_tauri', label: '01_tauri' },
	{ value: '/g/02_next', label: '02_next' },
	{ value: '/g/03_ai', label: '03_ai' },
	{ value: '/g/work', label: 'work' }
];

// the control is controlled, so a test that presses a key has to supply
// the state the drawer supplies — a jump that "advances" is only visible
// across the re-render its onChange causes
const Harness = ({
	initial = '/g/01_tauri',
	options = WORKSPACES
}: {
	initial?: string;
	options?: SelectOption[];
}) => {
	const [value, setValue] = useState(initial);
	return (
		<Select
			value={value}
			options={options}
			onChange={setValue}
			label='Workspace'
		/>
	);
};

const combo = () => screen.getByRole('combobox');
const chosen = () => combo().textContent;
// while the list is open nothing is chosen yet; the highlight is the
// option aria-activedescendant points at
const highlighted = () => {
	const id = combo().getAttribute('aria-activedescendant');
	return id ? document.getElementById(id)?.textContent : null;
};

// a press that the type-ahead buffer has forgotten. the buffer expires by
// timestamp rather than by timer, so a lapse is a clock move, not a wait —
// and the defect only ever showed on a LAPSED press: pressing 0 quickly
// twice always cycled, pressing it once, pausing, and pressing it again
// restarted the search from the top and re-chose the row already selected
const lapse = (clock: { now: number }) => (clock.now += 2000);

const fakeClock = () => {
	const clock = { now: 1_000_000 };
	const real = Date.now;
	Date.now = () => clock.now;
	return { clock, restore: () => (Date.now = real) };
};

describe('Select — the first-letter jump cycles', () => {
	// THE REGRESSION. three presses of 0, each one after the buffer has
	// lapsed, must walk the three 0-rows and come back round. on the broken
	// code every one of these landed on 01_tauri, because a lapsed press
	// searched from index 0 and the row it found was the row already chosen
	it('advances on every lapsed press of the same key, then wraps', async () => {
		const { clock, restore } = fakeClock();
		try {
			const user = userEvent.setup();
			render(<Harness />);
			combo().focus();

			expect(chosen()).toBe('01_tauri');

			lapse(clock);
			await user.keyboard('0');
			expect(chosen()).toBe('02_next');

			lapse(clock);
			await user.keyboard('0');
			expect(chosen()).toBe('03_ai');

			// and round: the last 0-row hands back to the first
			lapse(clock);
			await user.keyboard('0');
			expect(chosen()).toBe('01_tauri');
		} finally {
			restore();
		}
	});

	// the same walk with the list open moves the highlight instead of
	// choosing, and it has its own cursor (`active`), so it can regress on
	// its own
	it('advances the highlight on every lapsed press while the list is open', async () => {
		const { clock, restore } = fakeClock();
		try {
			const user = userEvent.setup();
			render(<Harness />);

			await user.click(combo());
			expect(highlighted()).toBe('01_tauri');

			lapse(clock);
			await user.keyboard('0');
			expect(highlighted()).toBe('02_next');

			lapse(clock);
			await user.keyboard('0');
			expect(highlighted()).toBe('03_ai');

			lapse(clock);
			await user.keyboard('0');
			expect(highlighted()).toBe('01_tauri');
		} finally {
			restore();
		}
	});

	// pressed fast, within the 800ms the buffer lives, the same key is a
	// repeat rather than a longer prefix — the case that already worked, and
	// the one the fix must not have traded away
	it('cycles just the same when the presses are inside the buffer window', async () => {
		const user = userEvent.setup();
		render(<Harness />);
		combo().focus();

		await user.keyboard('000');
		expect(chosen()).toBe('01_tauri');
	});

	// two DIFFERENT letters are still a prefix, not two jumps: this is what
	// keeps "ws2" landing on ws2 rather than walking the w-rows
	it('still treats two different letters as one prefix', async () => {
		const user = userEvent.setup();
		render(
			<Harness
				initial='/w/ws1'
				options={[
					{ value: '/w/ws1', label: 'ws1' },
					{ value: '/w/ws2', label: 'ws2' },
					{ value: '/w/wx', label: 'wx' }
				]}
			/>
		);
		combo().focus();

		await user.keyboard('wx');
		expect(chosen()).toBe('wx');
	});

	// a letter no label starts with leaves the choice alone rather than
	// resetting it to the top of the list
	it('leaves the selection alone when nothing matches', async () => {
		const user = userEvent.setup();
		render(<Harness initial='/g/03_ai' />);
		combo().focus();

		await user.keyboard('q');
		expect(chosen()).toBe('03_ai');
	});
});
