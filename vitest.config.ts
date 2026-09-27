import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// a config of its own, NOT a `test` key bolted onto vite.config.ts, for two
// reasons that are both about the real build staying the real build:
//
//   1. vite.config.ts carries the tauri contract — port 1420, strictPort,
//      the src-tauri watch exclusion, the TAURI_DEV_HOST hmr block. none of
//      it means anything to a headless run, and a test option added in the
//      middle of it is a line someone later reads as part of that contract.
//   2. it runs the react-compiler through @rolldown/plugin-babel and
//      tailwind's vite plugin. neither is needed to assert on behaviour, and
//      a component that only passes once the compiler has rewritten it is a
//      component whose test is testing the compiler.
//
// vitest prefers this file over vite.config.ts on its own, so `vitest run`
// needs no --config and the two never fight.
export default defineConfig({
	// jsx only. no react-compiler, no tailwind: nothing here asserts on a
	// class, and the tokens tailwind emits are checked by check-contrast.mjs
	plugins: [react()],
	test: {
		environment: 'jsdom',
		// false is ALREADY vitest's default (defaults.js:68) — this line is here
		// to be *provided*, not to change the value. the reporter default one
		// line above it is `[isAgent ? 'minimal' : 'default']`, and std-env sets
		// isAgent from CLAUDECODE / AI_AGENT, so an agent gets MinimalReporter —
		// whose onInit reads
		//
		//     if (this.silent == null && !ctx.config.providedOptions.silent)
		//         this.silent = 'passed-only'
		//
		// 'passed-only' suppresses the logs of every task that did not FAIL, so
		// a console.error from a PASSING test vanishes. that is every warning we
		// actually want: React's "not wrapped in act(...)" fires while the test
		// still goes green. writing `silent` here at all puts it in
		// providedOptions, the override stops, and the log comes through.
		//
		// ⛔ NOT `reporters: ['default']`, which was the obvious fix: that line
		// also drops the `github-actions` reporter vitest appends itself when
		// GITHUB_ACTIONS === 'true' (same defaults.js:67), and ci.yml runs
		// `bun run test` three times — we would trade inline PR annotations for
		// this. measured cost too: on a green 409-test run `reporters: ['default']`
		// prints 38 lines / 1804 bytes against minimal's 10 / 212, while this
		// line prints the same 10 until something actually logs.
		silent: false,
		// no `globals: true` on purpose. turning it on means adding
		// "vitest/globals" to tsconfig's `types`, and the moment that array
		// exists it REPLACES the automatic @types/* sweep — every ambient
		// package type in the tree would then have to be listed by hand. the
		// tests import describe/it/expect/vi from 'vitest' instead, which is
		// four words per file against a tsconfig that can silently lose types.
		globals: false,
		// and BECAUSE globals is off, @testing-library/react never gets to
		// register its own cleanup(): it gates that on a global afterEach
		// existing. without this file nothing in the suite ever unmounts, and
		// every render/renderHook stays live for the rest of the run.
		// src/test-setup.ts carries the full reasoning.
		setupFiles: ['./src/test-setup.ts'],
		include: ['src/**/*.test.{ts,tsx}']
	}
});
