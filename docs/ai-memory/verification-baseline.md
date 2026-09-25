# DevGo — what this repo can verify, measured

Measured **2026-09-26** on JoyR9 (Windows 11), branch `78.file-manager` at `fc3f532`.
⚠️ A baseline is a measurement, and measurements go stale. Re-run `/auto-mode-setup baseline`
when the toolchain or the scripts move.

Toolchain as measured: cargo/rustc **1.98.1** — **pinned**, by `rust-toolchain.toml` at the repo
root (added 2026-09-26; it was 1.96.1 when this file was first written). bun **1.3.14**,
vite **8.3.0**, TypeScript **~6.0.3**.
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
| Rust lint, strict | `cargo clippy --all-targets -- -D warnings` | **green**, 6s — **zero findings under clippy 0.1.98 / rustc 1.98.1** (the pinned toolchain, the same one CI runs) |

⭐ **Local and CI now run the SAME clippy, and that is enforced by a file.** `rust-toolchain.toml` at
the repo root pins `channel = "1.98.1"` with `clippy` and `rustfmt`. rustup resolves it by walking up
from the working directory, and the root is the only place on **both** walks: `scripts/verify.sh` cds
into `src-tauri/` first, CI runs `cargo --manifest-path src-tauri/Cargo.toml` from the repo root. A
copy in `src-tauri/` would pin the local gate and leave CI floating — the exact skew below.

⚠️ **The skew this closed, kept because it is the reason the file exists.** Local stable was
**clippy 0.1.96 (rustc 1.96.1, 2026-06-26)**; CI's `dtolnay/rust-toolchain@stable` resolved to
**1.98.1 (2026-09-01)**, two minors newer, because rustup here had not been updated since June. Newer
clippy ships lints the older one does not have, so a green local clippy did **not** mean a green CI
clippy. It happened: CI run **36198910630** went red on all three platforms at
`cargo clippy --all-targets -- -D warnings` with `using \`chunks_exact\` with a constant chunk size`
(`src-tauri/src/services/platform/wsl.rs`, in `decode`) — a lint that **does not exist in 0.1.96**, so
`scripts/verify.sh` reported **green on the exact tree CI rejected**. A gate that disagrees with the
gate that blocks a release is not a gate.

⛔ **An earlier version of this file said a `rust-toolchain.toml` had been "considered and deliberately
NOT added" — that call was wrong and has been reversed.** The reasoning was that pinning would drag CI
back to the older clippy and lose the very lint that caught the bug. That only holds if you pin to the
**stale local** version. We pinned to **current stable, 1.98.1 — the exact version CI already resolved
to** — so not one lint CI had was lost. What the pin changes is *timing*: a new lint now arrives when
someone edits one line, instead of unannounced on the morning Rust ships a release.

**Bumping is a deliberate one-line change**: `rustup update stable`, put the new `x.y.z` in
`rust-toolchain.toml`, run `sh scripts/verify.sh --full`, fix what the newer clippy found. CI follows
automatically — it reads the same file. The version appears in **exactly one file**; `ci.yml` no longer
installs a toolchain of its own, precisely so it cannot drift from this one.

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
| Rust tests | `cargo test` | **green** — **304 passed / 0 failed / 1 ignored** under the pinned 1.98.1 (283 when this baseline was first measured; the row said 299 for a while after it was already 304 — re-measure the number, do not carry it forward) |

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

⚠️ **This section is out of date as written, and the correction matters.** When it was measured,
neither workflow ran `cargo clippy` or `cargo fmt --check`, so `-D warnings` was a LOCAL gate only —
which is how `items_after_test_module` was able to sit in the tree. **`ci.yml` now runs
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` on windows, mac and
linux**. CI is therefore no longer narrower on clippy — and since 2026-09-26 it is not *differently*
strict either: the `dtolnay/rust-toolchain@stable` step was removed from all three jobs, and the
runners' rustup installs whatever `rust-toolchain.toml` names on the first cargo call. Same toolchain,
same lints, both sides. ⚠️ `release.yml` still carries `dtolnay/rust-toolchain@stable` in its three
jobs; that is harmless — the pin file overrides the action either way — but it is a redundant
toolchain download and should be dropped next time that file is touched.
Frontend typecheck is still covered in CI only transitively, inside `bun run build`.

**This answers a question that was queued for Joy** — "is `clippy -D warnings` really the release
gate?" Measured answer: **no, nothing enforces it but this file.**
