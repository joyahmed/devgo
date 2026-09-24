# 70 — Release

**Branch:** `70.release` — `git checkout 70.release` gives you this chapter's finished repo; `git diff 69.server-privacy 70.release` is two workflow files and two lines of `README.md`.

**Starting from:** chapter 69 — server privacy. Written from the public work itself. Until now the installers were built by hand on each machine.

**Goal:** a tag builds the installers. `git tag v0.2.0 && git push origin v0.2.0` and GitHub Actions builds `DevGo_0.2.0_x64-setup.exe` on a Windows runner and `DevGo_0.2.0_aarch64.dmg` on a Mac runner, runs the same gate we run by hand first (`bun run build`, `cargo test`), and drafts a GitHub Release with both attached. The maintainer reads the draft and presses *Publish* — a human press, not a bot's. Unsigned on both platforms, the way the README's Install section already says. A second, cheaper workflow runs the gate alone on every push to `main` and every pull request.

> **Hold on to:**
> 1. **The gate runs inside each platform job.** There is no Linux bundle in the README and the crate has `#[cfg(windows)]` and `#[cfg(target_os = "macos")]` tables (62, 64, 55) that a Linux compile never sees. A `gate` job on `ubuntu-latest` would have gated nothing that ships. So each job installs, builds, tests, then bundles — the test that matters runs on the OS the installer is for.
> 2. **The draft is the hand-off.** `releaseDraft: true`: the action creates the release, attaches the bundles, and stops. Publishing is the one outward-facing action in the whole chain, and it stays a human click.
> 3. **Only what the README promises.** `--bundles nsis` on Windows (no `.msi` — 68 promised the `-setup.exe`, per user, no admin); `--target aarch64-apple-darwin --bundles dmg` on the Mac (no Intel build, no `.app.tar.gz` — there is no updater). `bundle.targets` in `tauri.conf.json` stays `"all"` for the local `bun tauri build`; the workflow narrows on the command line.
> 4. **No signing, said out loud.** No certificate on either platform; no `APPLE_*` or `TAURI_SIGNING_*` secret referenced. The comment at the top of the workflow says so, so nobody hunts for a missing secret when SmartScreen and Gatekeeper complain — the README already tells the user what to click. ⚠️ True of certificates at every stage, but imprecise about the Mac from `426e38c` on `main` (`✅MAC: the bundler signs the app, so the seal is whole`) onwards: there is still no certificate and still no secret, and now `bundle.macOS.signingIdentity: "-"` in `tauri.conf.json` runs the bundler's own ad-hoc signing pass, so the `.app` ships with `Contents/_CodeSignature/CodeResources`. Read this line as *no certificate*, not *no signature* — the difference is what the user sees: the bundle as this chapter shipped it carried the Rust linker's ad-hoc signature with no sealed resources, `spctl -a -vvv -t exec` failed verification on it (*code has no resources but signature indicates they must be present*), and macOS showed *is damaged and can't be opened*, a dialog with no override. With the seal whole the refusal should be the ordinary unidentified-developer one that *Open Anyway* clears; that has not been observed on a Mac yet, and the README as of that commit is what a user should follow.

> The version is not touched here. `tauri.conf.json`, `package.json` and `Cargo.toml` all say `0.1.0`. Which number the first public release wears is the maintainer's call; the procedure below is the same whichever it is.

## Also since 69

Nothing landed on `main` between `✅STAGE: 69 server-privacy` (`81771d8`) and this branch; `ce3b7ba ✅CLONE: hand the mac clone gh's credential` was already under 69's chain.

---

## 70.1 — The release workflow

`.github/workflows/release.yml`. Trigger, permission, one lock, the Windows job:

```yaml
# a v* tag builds the installers and drafts the github release; joy
# publishes the draft. run workflow from a tag does the same by hand.
# unsigned on both platforms on purpose: there is no certificate, and
# the readme tells the user what the os will say.
name: release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref }}

jobs:
  windows:
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: bun install --frozen-lockfile
      - run: bun run build
      # the launcher tests share temp names; a second pass on one thread
      # tells a race from a failure
      - run: cargo test --manifest-path src-tauri/Cargo.toml || cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
        shell: bash
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: DevGo ${{ github.ref_name }}
          releaseDraft: true
          prerelease: false
          args: --bundles nsis
```

Line by line, the choices:

- **`workflow_dispatch` with an `if` on the jobs.** GitHub's *Run workflow* button lets you pick a tag as the ref, which is the only useful way to run this by hand (a build failed for a runner reason; rerun it). Run from a branch, `github.ref` is `refs/heads/main` and both jobs skip — no draft release named *DevGo main*.
- **`contents: write`** is what `tauri-action` needs to create the release and upload assets with the job's own `GITHUB_TOKEN`. No PAT.
- **`concurrency.group: release-${{ github.ref }}`**: two pushes of the same tag queue, they do not race on one draft.
- **`--frozen-lockfile`**: the runner installs exactly `bun.lock` or fails. A lockfile the install would rewrite is a lockfile you forgot to commit.
- **`bun run build`** is `check:contrast` → `tsc` → `vite build` (67's gate). `tauri build` runs it again as `beforeBuildCommand` a minute later; the first run is the one with the step's name on it, so a red `tsc` is a red step called *bun run build*, not a wall of `tauri` output.
- **`cargo test` twice, `||`.** The launcher tests create and remove files under temp names and two of them can collide when the runner is slow; on one thread they cannot. If the second pass is also red, it is a failure. `shell: bash` so the same line runs on both runners.
- **`tauri-action@v1`** — the current line (1.0.0, June 2026; Tauri v2 only). It finds `bun.lock` and runs `bun tauri build …`, reads `productName`/`version` from `tauri.conf.json` for the asset names, creates the draft for `tagName` if none exists, and uploads what `--bundles` produced. `rust-cache` is keyed per runner OS and job by default, so the Windows and Mac caches never cross.

> `✅CI: release workflow on a tag`

## 70.2 — The Mac job

The same steps with two differences: the target is added to the toolchain, and the `args` name it.

```yaml
  mac:
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: cargo test --manifest-path src-tauri/Cargo.toml || cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
        shell: bash
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: DevGo ${{ github.ref_name }}
          releaseDraft: true
          prerelease: false
          args: --target aarch64-apple-darwin --bundles dmg
```

`macos-latest` is an Apple-silicon runner, so the target is the host's and there is no cross-compile; naming it keeps the asset `_aarch64.dmg` whichever image `latest` points at next year. `tauri.macos.conf.json` (55: overlay title bar, `minimumSystemVersion` 12.0) is picked up by the CLI on macOS with no flag. Two explicit jobs, not a matrix: the differences are three lines and a matrix would hide them behind `${{ matrix.args }}`.

Both jobs point at the same `tagName`; whichever finishes first creates the draft and the other uploads into it (the action looks the release up by tag before creating one).

> `✅CI: mac dmg job`

## 70.3 — The gate on main

`.github/workflows/ci.yml` — the first seven steps of the Windows job, alone:

```yaml
# the same gate the release runs, on every push to main and every pull
# request. windows only: the mac gate costs minutes and the tag build
# runs it there anyway.
name: ci

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  gate:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: cargo test --manifest-path src-tauri/Cargo.toml || cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
        shell: bash
```

Why a second file and not a shared job: a workflow job cannot hand its checkout to another job, and a composite action would be a third file to explain. Seven lines copied is cheaper than that. `cancel-in-progress: true` here (a newer push to `main` supersedes the run for the older one) and not on the release (a build of a tag is never superseded). Two machines push to `main` (the Windows box and the Mac); a red badge on `main` is now visible from either, which is the point — 55's lesson was a Mac push that broke the Windows compile while every Mac gate was green.

> `✅CI: the gate on main and pull requests`

## 70.4 — The README

68's Install section already linked Releases. Two lines now say where those come from:

> Builds are unsigned on both platforms. Download from [Releases](https://github.com/joyahmed/devgo/releases); each one is built by GitHub Actions from a `v*` tag (`.github/workflows/release.yml`), so the installer on the page is the tag's tree, nothing more.

and, under *From source*:

> `bun run build` runs the contrast gate, `tsc` and Vite; `cargo test` in `src-tauri` runs the Rust tests. CI runs both on every push and pull request, and the tag build runs them on each platform before it bundles.

> `✅DOCS: install names the tag build`

## 70.5 — Verify

No tag was pushed (the version is the maintainer's call, and a tag is a public act); what could be checked without one was.

- **The YAML parses:** `yaml-lint` on both files, clean.
- **Every action pinned exists,** read off the GitHub API: `tauri-apps/tauri-action` latest release `action-v1.0.0` (2026-06-29) with the floating `v1` tag (the `v0` line is the pre-1.0 one; 1.0 dropped Tauri v1, nothing else we use); `oven-sh/setup-bun` `v2.2.0`; `Swatinem/rust-cache` `v2.9.2`; `actions/checkout` `v7.0.1` (`v4` still resolves and is what `tauri-action`'s own README uses); `dtolnay/rust-toolchain@stable` is a branch, present.
- **The inputs exist in v1:** `tagName`, `releaseName`, `releaseDraft`, `prerelease`, `args` — read from the `v1` README. Bun is detected from `bun.lock`; nothing to configure.
- **Each step, locally, in the branch's own worktree (fresh `node_modules`):** `bun install --frozen-lockfile` — 91 packages, `bun.lock` sha256 identical before and after; `bun run build` — *contrast ok: 6 palettes x 8 rules, 5 lane hues*, `tsc` silent, Vite 84 modules in 2.4 s; `cargo test --manifest-path src-tauri/Cargo.toml` — **203 passed, 0 failed, 1 ignored** (62's `tasklist` probe), 0 warnings, first pass, no retry needed.
- **The gate workflow, for real:** the fast-forward of `main` to `73b5298` fired `ci.yml` — run [35116260427](https://github.com/joyahmed/devgo/actions/runs/35116260427), `push`, on the STAGE commit: **success in 4 m 32 s**, every step green, `cargo test` on its first pass (no retry). One annotation, not a failure: `actions/checkout@v4` targets Node 20, which the runners now force to Node 24 — `actions/checkout@v7` exists; a one-line `✅CI:` on `main` when it starts to matter.
- **Not provable without a tag:** the two `tauri-action` steps themselves — the NSIS bundle on the runner, the dmg step, the draft's creation, the asset names (`DevGo_<version>_x64-setup.exe` / `DevGo_<version>_aarch64.dmg` are Tauri's defaults and what 68 wrote). `bun tauri build` was not run here either: the installed DevGo on this machine is in daily use. The first tag is the test; if a job is red, *Run workflow* from the tag reruns it without a new tag.

> `✅STAGE: 70 release`; push; `70.release:main` fast-forward.

## 70.6 — Releasing

The whole procedure, for the person with the keyboard:

1. Pick the number. Bump `version` in `src-tauri/tauri.conf.json`, `package.json` and `src-tauri/Cargo.toml` (three files, one number; `cargo check` refreshes `Cargo.lock`, commit that too). One commit: `✅RELEASE: vX.Y.Z`. Push `main`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Actions › *release* — two jobs, ten to fifteen minutes. When both are green, Releases has a draft *DevGo vX.Y.Z* with the `.exe` and the `.dmg` attached.
4. Read it, write the notes if you want any, press *Publish release*. The README's link now points at it.

A red job: fix on `main`, then either move the tag (`git tag -f vX.Y.Z && git push -f origin vX.Y.Z` — the only force-push the rules allow, a tag nobody has pulled) or bump and tag again. A green build you want to redo: Actions › *release* › *Run workflow* › pick the tag.

---

## What you built

```
.github/workflows/release.yml   a v* tag → gate → nsis on windows, dmg on mac → draft release
.github/workflows/ci.yml        the gate alone, on main and pull requests, windows
README.md                       Install: where the builds come from; From source: CI runs the gate
```

- **A tag is a release** — one `git push origin vX.Y.Z` and the two installers the README promises are on a draft, built from that tag's tree on the OS they are for, after the same gate you ran by hand.
- **The draft is the maintainer's** — the workflow attaches and stops; publishing stays a human click.
- **`main` has a gate that is not on your machine** — every push from either box runs `bun run build` and `cargo test` on a Windows runner; the platform that broke silently in 55 is now the one that is always watched.
