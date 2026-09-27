import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { escapeCleared } from './searchKeys';

// the whole file is one rule, and it exists because the rule was once
// answered two different ways in two different boxes: SearchBox cleared its
// text on Escape, the clone drawer's bare "Find a repo…" <input> did not, so
// the same key on the same screen either kept the drawer open or took it away
// with a typed filter still in it.
//
// nothing here is mocked and nothing platform-sensitive is touched: the
// function reads three things off the event — `key`, `preventDefault`,
// `stopPropagation` — so a plain object carries it, and the second half of
// the file uses a REAL input in the real document to prove that the
// stopPropagation call is what actually keeps the key off `window`, which is
// where Drawer listens and therefore the only place the bug could show.
//
// assertions on the return value are exact booleans: it is the "I consumed
// it, stop here" signal a caller with more keys of its own reads, so true and
// false are the contract, not truthiness.

// one press, with the order of the three side effects recorded. the order
// matters on its own: the key has to be taken off the wire BEFORE the box is
// cleared, or a clear that throws would leave the key travelling
const press = (key: string, value: string) => {
	const calls: string[] = [];
	const clear = vi.fn(() => {
		calls.push('clear');
	});
	const e = {
		key,
		preventDefault: vi.fn(() => {
			calls.push('preventDefault');
		}),
		stopPropagation: vi.fn(() => {
			calls.push('stopPropagation');
		})
	};
	const consumed = escapeCleared(
		e as unknown as ReactKeyboardEvent<HTMLInputElement>,
		value,
		clear
	);
	return { consumed, calls, clear, ...e };
};

describe('escapeCleared — Escape with text in the box', () => {
	it('reports the key consumed and clears the box', () => {
		const { consumed, clear } = press('Escape', 'repo');
		expect(consumed).toBe(true);
		expect(clear).toHaveBeenCalledTimes(1);
	});

	// ⭐ the regression this file exists for. stopPropagation is the half that
	// keeps the drawer open; preventDefault is the half that stops the
	// browser's own behaviour on the same key
	it('takes the key off the wire with both halves of the stop', () => {
		const { preventDefault, stopPropagation } = press('Escape', 'repo');
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('stops the key first and clears second', () => {
		const { calls } = press('Escape', 'repo');
		expect(calls).toEqual(['preventDefault', 'stopPropagation', 'clear']);
	});

	// the consequence of that order, spelled out: a clear that blows up has
	// already cost the drawer the key, so the drawer stays open rather than
	// closing on a half-done clear
	it('has already stopped the key when clear throws', () => {
		const e = {
			key: 'Escape',
			preventDefault: vi.fn(),
			stopPropagation: vi.fn()
		};
		const boom = () => {
			throw new Error('clear blew up');
		};
		expect(() =>
			escapeCleared(
				e as unknown as ReactKeyboardEvent<HTMLInputElement>,
				'repo',
				boom
			)
		).toThrow('clear blew up');
		expect(e.stopPropagation).toHaveBeenCalledTimes(1);
	});

	// '' is the only empty. a box holding a space has something to clear, and
	// the user pressing Escape means clear it
	it('counts a single space as text', () => {
		const { consumed, clear, stopPropagation } = press('Escape', ' ');
		expect(consumed).toBe(true);
		expect(clear).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
	});
});

describe('escapeCleared — Escape with an empty box', () => {
	// the bug in one test: nothing to clear is no claim on the key
	it('reports the key not consumed and leaves it to bubble', () => {
		const { consumed, clear, preventDefault, stopPropagation } = press(
			'Escape',
			''
		);
		expect(consumed).toBe(false);
		expect(clear).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
	});
});

describe('escapeCleared — every other key', () => {
	// the box claims exactly one key. a filled box must not swallow Enter,
	// which submits, Tab, which leaves, or a letter, which types
	it.each(['Enter', 'Tab', 'a', ' ', 'Backspace', 'ArrowDown', 'Delete'])(
		'leaves %s alone even with text in the box',
		key => {
			const { consumed, clear, preventDefault, stopPropagation } = press(
				key,
				'repo'
			);
			expect(consumed).toBe(false);
			expect(clear).not.toHaveBeenCalled();
			expect(preventDefault).not.toHaveBeenCalled();
			expect(stopPropagation).not.toHaveBeenCalled();
		}
	);

	// KeyboardEvent.key for the Escape key is the exact string 'Escape'; the
	// comparison is case-sensitive and nothing normalises it, so a caller
	// hand-building an event has to spell it the way the browser does
	it('does not recognise a lowercase "escape"', () => {
		const { consumed, clear } = press('escape', 'repo');
		expect(consumed).toBe(false);
		expect(clear).not.toHaveBeenCalled();
	});

	it('leaves other keys alone on an empty box too', () => {
		const { consumed, clear } = press('Enter', '');
		expect(consumed).toBe(false);
		expect(clear).not.toHaveBeenCalled();
	});
});

// the same contract asked of the DOM rather than of a stub, because
// "stopPropagation was called" is not the thing that was broken — "the drawer
// closed" was. window is where Drawer's Escape-to-close listener sits, so a
// counter on window answers exactly the user-visible question
describe('escapeCleared — the drawer above never sees a consumed key', () => {
	const onWindow = vi.fn();
	const listener = (e: Event) => {
		if ((e as KeyboardEvent).key === 'Escape') onWindow();
	};
	let input: HTMLInputElement;
	let value: string;

	beforeEach(() => {
		onWindow.mockClear();
		window.addEventListener('keydown', listener);
		input = document.createElement('input');
		document.body.appendChild(input);
		// the box's own handler, sitting where SearchBox's onKeyDown sits. the
		// native event carries the same three members the function reads
		input.addEventListener('keydown', e => {
			escapeCleared(
				e as unknown as ReactKeyboardEvent<HTMLInputElement>,
				value,
				() => {
					value = '';
					input.value = '';
				}
			);
		});
	});
	afterEach(() => {
		window.removeEventListener('keydown', listener);
		input.remove();
	});

	const escape = () =>
		input.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Escape',
				bubbles: true,
				cancelable: true
			})
		);

	it('clears the text and the key stops at the box', () => {
		value = 'repo';
		input.value = 'repo';
		escape();
		expect(input.value).toBe('');
		// the drawer is still open: it never got the key
		expect(onWindow).not.toHaveBeenCalled();
	});

	it('lets the key reach the window when the box is already empty', () => {
		value = '';
		input.value = '';
		escape();
		expect(onWindow).toHaveBeenCalledTimes(1);
	});

	// two presses, which is how a user actually leaves: the first empties the
	// box, the second closes the drawer around it
	it('takes two presses to clear a filled box and then close the drawer', () => {
		value = 'repo';
		input.value = 'repo';
		escape();
		expect(onWindow).not.toHaveBeenCalled();
		escape();
		expect(onWindow).toHaveBeenCalledTimes(1);
	});

	it('never stops a key it does not claim', () => {
		value = 'repo';
		input.value = 'repo';
		input.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Enter',
				bubbles: true,
				cancelable: true
			})
		);
		expect(input.value).toBe('repo');
		expect(onWindow).not.toHaveBeenCalled();
	});
});
