import type { KeyboardEvent } from 'react';

// Escape over a search box is two keys in one, and every box in the app
// has to answer it the same way or the answer is a coin toss:
//
//   with text  the key belongs to the box. it clears the text and goes no
//              further — the drawer above must not close and take a typed
//              filter (and a set of ticks) with it.
//   empty      the box has nothing to clear and no claim on the key. it
//              is left alone to bubble, so whatever is around the box —
//              a Drawer, a menu — gets to close on it.
//
// this lives in its own file rather than inside SearchBox because the
// clone drawer's "Find a repo…" is a bare <input>, not that component,
// and the two boxes drifting apart is exactly the bug: pressing Escape
// on it closed the whole drawer whether there was text to clear or not.
//
// returns whether the box consumed the key, so a caller with more keys of
// its own can stop there
export const escapeCleared = (
	e: KeyboardEvent<HTMLInputElement>,
	value: string,
	clear: () => void
): boolean => {
	if (e.key !== 'Escape' || value === '') return false;
	e.preventDefault();
	// window is where Drawer listens, and a bubbling Escape reaches it
	// even from a React handler: without this the box clears AND the
	// drawer closes on one press
	e.stopPropagation();
	clear();
	return true;
};
