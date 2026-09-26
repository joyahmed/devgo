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
		// no `globals: true` on purpose. turning it on means adding
		// "vitest/globals" to tsconfig's `types`, and the moment that array
		// exists it REPLACES the automatic @types/* sweep — every ambient
		// package type in the tree would then have to be listed by hand. the
		// tests import describe/it/expect/vi from 'vitest' instead, which is
		// four words per file against a tsconfig that can silently lose types.
		globals: false,
		include: ['src/**/*.test.{ts,tsx}']
	}
});
