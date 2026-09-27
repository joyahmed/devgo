// per-test isolation for the whole suite, and it has to be written by hand.
//
// @testing-library/react registers its automatic cleanup() only when a GLOBAL
// afterEach already exists — the gate is `typeof afterEach === 'function'` in
// node_modules/@testing-library/react/dist/index.js. vitest.config.ts sets
// `globals: false` on purpose, so that gate is closed and cleanup NEVER ran.
// every render() and renderHook() in every file therefore stayed mounted for
// the whole run: their effects, subscriptions, timers and animation frames kept
// firing inside later tests, so a later test's invoke() call log could contain
// calls an earlier test's component made, and a hook still mounted after the
// next file's `beforeEach(() => invoke.mockReset())` gets undefined back from
// invoke and rejects on `.then` — an unhandled rejection with no owner.
//
// a setupFiles shim rather than the two alternatives:
//   - `globals: true` would work, but it forces "vitest/globals" into tsconfig's
//     `types`, and the moment that array exists it REPLACES the automatic
//     @types/* sweep — which is the documented reason globals is off (see
//     vitest.config.ts). it also changes how all 14 existing files resolve
//     describe/it/expect. largest blast radius for the same one hook.
//   - an explicit `afterEach(cleanup)` per file is 14 edits that every future
//     test file has to remember, with nothing enforcing it. a convention, not a
//     fix.
// this file adds one hook to every file and changes nothing else.
//
// ordering, because it is load-bearing and not obvious: vitest's default
// `sequence.hooks` is 'stack', so afterEach hooks run in REVERSE registration
// order. setupFiles run before the test file's own module body, so this hook is
// registered first and therefore runs LAST — after a file's own
// `afterEach(() => vi.useRealTimers())` or `vi.restoreAllMocks()`. the unmount
// happens in whatever timer/mock world those hooks leave behind. that is fine
// for everything in the suite today; a future unmount path that calls invoke()
// would see a restored mock, so keep unmount paths guarded.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// react only emits "An update to X inside a test was not wrapped in act(...)"
// when this global is truthy, and nothing in the tree ever set it.
// @testing-library/react v16 does NOT set it for you: act-compat.js flips it to
// true for the duration of one act() call and then restores whatever was there
// before — `undefined` — so the check was never armed outside an act(). every
// unwrapped state update in the suite passed silently.
// this is the one line that arms it. it belongs here and not in a test file
// because a per-file version is a convention with nothing enforcing it.
// react reads it as a BARE global (`typeof IS_REACT_ACT_ENVIRONMENT`), which is
// why it is declared rather than only assigned: without this tsc has no index
// signature for typeof globalThis and fails with TS7017.
declare global {
	// eslint-disable-next-line no-var
	var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	cleanup();
});
