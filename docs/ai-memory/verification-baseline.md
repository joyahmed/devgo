# DevGo — what this repo can verify, measured

Measured **2026-09-26** on JoyR9 (Windows 11), branch `78.file-manager` at `fc3f532`.
⚠️ A baseline is a measurement, and measurements go stale. Re-run `/auto-mode-setup baseline`
when the toolchain or the scripts move.

Toolchain as measured: cargo/rustc **1.96.1**, bun **1.3.14**, vite **8.3.0**, TypeScript **~6.0.3**.
Package manager is **bun** — the lockfile is `bun.lock` (bun's newer text format) and `package.json`
has no `packageManager` field, so nothing but the lockfile and CI says so.

---

## The tiers

### Tier 1 + 2 — before every commit, ~10s warm

```bash
bunx tsc --noEmit
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings
```

| check | command | result |
|---|---|---|
| Frontend typecheck | `bunx tsc --noEmit` | **green**, 2s |
| Rust format | `cargo fmt --check` | **green**, <1s |
| Rust lint, strict | `cargo clippy --all-targets -- -D warnings` | **green**, 6s — **zero findings** |

⭐ **`-D warnings` is green as of `fc3f532` and was not before.** It failed on exactly one finding,
`wsl.rs:202 items_after_test_module`, which is why it is safe to gate on the strict form now. Gate on
the strict form or the gate is decorative: plain `cargo clippy` exits **0 even with findings**.

### Tier 3 — before a `main` push, adds ~10s

```bash
bun run build
cd src-tauri && cargo test
```

| check | command | result |
|---|---|---|
| Frontend build | `bun run build` = `check:contrast && tsc && vite build` | **green**, 94 modules, 3.8s |
| Contrast check | `bun run check:contrast` (inside `build`) | **green** — 6 palettes × 8 rules, 5 lane hues |
| Rust tests | `cargo test` | **green** — **299 passed / 0 failed / 1 ignored** (283 when this baseline was first measured; +1 PATH agreement, +3 raise diagnostic, +12 runtime log) |

⭐ **No output-directory trap here, unlike a Next repo.** `vite build` writes `dist/`, which is
**gitignored** and is read only by `tauri build`; `bun run dev` serves from vite on **:1420** and
never reads `dist/`. So the build tier cannot disturb a dev server and needs no scratch directory.
Verified by building to a scratch dir anyway and comparing mtimes: `dist/` did not move, to the
nanosecond.

⚠️ **The Tauri lock, shared with trove's caveat.** `cargo` holds an exclusive lock on
`src-tauri/target`, so a live `tauri dev` makes `cargo clippy` / `cargo test` **block rather than
fail** — it reads as a hang. Check for the **process** (`Get-Process cargo,rustc`), never for
`src-tauri/target/debug/.cargo-lock`, which exists while idle and would make you skip the Rust tier
every time. If one is live: run the frontend tier only and **say** the Rust tier was skipped.

### Tier 4 — on request only

`scripts/cdp.mjs` and `scripts/shoot.ps1` are manual screenshot/CDP helpers. There is no suite.

---

## ⛔ What this repo CANNOT verify — name it rather than letting a thin check sound broad

- **No JS/TS test runner at all.** No vitest, no jest, no `node:test`, no testing-library, in neither
  `package.json` nor `bun.lock`. Zero `*.test.*` / `*.spec.*` files under `src`, `server`, `scripts`.
  ⭐ **Every line of React/TS in `src/` is verified only by `tsc` types and by the fact that it
  bundles.** A green gate here says nothing about whether a button does what it says.
- **No E2E.** No `playwright.config.*`, no `e2e/` or `tests/` directory.
- **No frontend linter.** No eslint, biome, oxlint or prettier config anywhere; no `lint` script.
- **Nothing about the launch lanes.** ⚠️ The v1.2.1 PATH bug was invisible to `cargo test` on every
  platform — see `release-v1.2.2-plan.md` §0. **A green suite is not evidence for a launch lane.**
  Only an installed build, clicked, with what appeared on screen, is.

## ⭐ CI is NARROWER than this local gate — the open question, settled

`.github/workflows/ci.yml` (windows-latest, on push to `main` and every PR) runs: `bash -n` on the
two server scripts, `jq empty` on the actions example, `bun install --frozen-lockfile`,
`bun run build`, then `cargo test` with a single-threaded retry. `release.yml` runs the same on
win/mac/linux for `v*` tags.

⛔ **Neither workflow runs `cargo clippy` or `cargo fmt --check`** — a grep for
`clippy|fmt|lint|vitest|playwright` across `.github/workflows/` returns nothing. **So `-D warnings`
is a LOCAL gate only**, which is exactly how `items_after_test_module` was able to sit in the tree.
Frontend typecheck is covered in CI, but only transitively, inside `bun run build`.

**This answers a question that was queued for Joy** — "is `clippy -D warnings` really the release
gate?" Measured answer: **no, nothing enforces it but this file.**
