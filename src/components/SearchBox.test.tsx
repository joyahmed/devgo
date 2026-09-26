import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SearchBox from './SearchBox';

afterEach(cleanup);

// the box is controlled, so a test that types has to supply the state the
// app supplies. everything here goes through this harness for that reason:
// asserting on a `value` prop that never changes would test a render, and
// the bugs below were all about what happens across a keystroke
const Harness = ({
	lane = 'projects' as SearchLane,
	onEnter,
	initial = ''
}: {
	lane?: SearchLane;
	onEnter?: () => void;
	initial?: string;
}) => {
	const [value, setValue] = useState(initial);
	return (
		<SearchBox value={value} onChange={setValue} onEnter={onEnter} lane={lane} />
	);
};

describe('SearchBox — the ENTER chip', () => {
	// the regression, twice: the chip was a prop, and three of the five call
	// sites never passed it, so three boxes simply had no ENTER. the fix was
	// to derive it from `value` inside the component. this test renders with
	// NOTHING but the four props the type requires — no chip flag, because
	// there must not be one to pass — and still demands the chip
	it('appears on any input, from value alone and no prop', async () => {
		const user = userEvent.setup();
		render(<Harness />);

		expect(screen.queryByText('Enter')).toBeNull();
		await user.type(screen.getByRole('textbox'), 'a');
		expect(screen.getByText('Enter')).not.toBeNull();
	});

	// the second half of the same bug: the chip was once tied to whether the
	// search found anything, so typing a query that matches nothing left the
	// box looking like Enter would do nothing. the box does not know about
	// results and must not start to — junk input gets the chip
	it('appears for input that can match nothing', async () => {
		const user = userEvent.setup();
		render(<Harness />);

		await user.type(screen.getByRole('textbox'), 'zzzzzzzz-no-such-project');
		expect(screen.getByText('Enter')).not.toBeNull();
	});

	it('is gone again once the box is emptied', async () => {
		const user = userEvent.setup();
		render(<Harness initial='x' />);

		expect(screen.getByText('Enter')).not.toBeNull();
		await user.clear(screen.getByRole('textbox'));
		expect(screen.queryByText('Enter')).toBeNull();
	});
});

describe('SearchBox — the summon chip', () => {
	// derived from `lane`, for the same reason the ENTER chip is derived from
	// value: a call site that can hand over a key can hand over the wrong
	// one, and the chip would then advertise a binding the handler has not
	// bound. one case per lane, so a table edit that crosses two of them
	// cannot pass
	it.each([
		['projects' as SearchLane, 'Ctrl+K'],
		['github' as SearchLane, 'Ctrl+G'],
		['servers' as SearchLane, 'Ctrl+H']
	])('shows %s its own key, %s, while empty', (lane, keys) => {
		render(<Harness lane={lane} />);
		expect(screen.getByText(keys)).not.toBeNull();
	});

	it('swaps out for ENTER once there is text', async () => {
		const user = userEvent.setup();
		render(<Harness />);

		await user.type(screen.getByRole('textbox'), 'a');
		expect(screen.queryByText('Ctrl+K')).toBeNull();
		expect(screen.getByText('Enter')).not.toBeNull();
	});
});

describe('SearchBox — keys', () => {
	it('fires onEnter on a bare Enter', async () => {
		const user = userEvent.setup();
		const onEnter = vi.fn();
		render(<Harness onEnter={onEnter} initial='repo' />);

		await user.click(screen.getByRole('textbox'));
		await user.keyboard('{Enter}');
		expect(onEnter).toHaveBeenCalledTimes(1);
	});

	// Ctrl/Shift/Alt+Enter are project actions declared in the shortcut table
	// and owned by App's global handler. if the box forwarded them as a plain
	// Enter the chord would launch twice — so a modified Enter must die here
	it.each(['{Control>}{Enter}{/Control}', '{Shift>}{Enter}{/Shift}', '{Alt>}{Enter}{/Alt}'])(
		'leaves %s to the global handler',
		async chord => {
			const user = userEvent.setup();
			const onEnter = vi.fn();
			render(<Harness onEnter={onEnter} initial='repo' />);

			await user.click(screen.getByRole('textbox'));
			await user.keyboard(chord);
			expect(onEnter).not.toHaveBeenCalled();
		}
	);

	it('clears itself on Escape', async () => {
		const user = userEvent.setup();
		render(<Harness initial='repo' />);

		const input = screen.getByRole('textbox') as HTMLInputElement;
		expect(input.value).toBe('repo');
		await user.click(input);
		await user.keyboard('{Escape}');
		expect(input.value).toBe('');
	});
});
