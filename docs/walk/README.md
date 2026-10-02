derived from scripts/walk.mjs's own header and scripts/walk.routes.mjs's `NOT_COVERED` block — read those two files for the full rationale; this page is the operator's summary, not a second source of truth.

# The walk

`scripts/walk.mjs` drives the REAL DevGo — the installed build, over the Chrome DevTools Protocol — through the route map in `scripts/walk.routes.mjs`, and leaves a machine-checkable artefact behind: `docs/walk/<sha>/manifest.json` plus one PNG per step that shoots. It exits 0 only when every step that ran passed.

`<sha>` is not the checkout's HEAD. It is the short sha that `build.rs` compiled INTO the running binary, read back over IPC by the `get_git_sha` command and stamped on the manifest and every filename under it. A walk run against one commit while a different binary shipped is the failure this exists to catch — a manifest whose sha came from the binary's own mouth cannot make that mistake. The About panel prints the same value, and one step asserts the two agree.

## Why this exists

The per-change lifecycle rule has three stages that leave no artefact behind, and those are exactly the three every session skips: clicking every screen like a software tester with screenshots as the deliverable, exercising the change where it ships, and labelling every claim with the checkout it came from. Nobody watches you skip a stage that leaves nothing behind. This leaves something behind.

`scripts/walk.mjs` knows the verbs (click, type, wait, key, theme, reload...) and never the screens. `scripts/walk.routes.mjs` is the route map — 34 steps, 62 step-runs over 5 themes — and is data, not code: adding a screen next month means adding one object to `STEPS` there and nothing else.

⭐ **First real run: 2026-10-03, binary `6d2b16d` (v1.2.5), `tauri dev` on Windows 11 — GREEN, 61 passed, 0 failed, 1 skipped, 0 console errors.** The skip is `home-window`, which needs `--window-shots`. Details and what the run changed are under "First real run" at the bottom of this page.

## First run — do this in order

1. **Gate before you launch.** `verify.sh` skips the entire rust tier while `tauri dev` is up (cargo blocks on the `src-tauri/target` lock) and exits INCOMPLETE, so run the full gate first, while nothing is running:

   ```
   sh scripts/verify.sh --full
   ```

2. **Close the installed DevGo first.** It holds `instance.lock`. The installed build and the `tauri dev` build share one WebView2 user-data folder, and the debug port opens on the FIRST WebView2 instance only — if the installed app is still up, the driven build never gets the port.

3. **Start the driven build with the debug port on**, in the same shell:

   ```
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
   bun tauri dev
   ```

4. **See the plan without driving anything:**

   ```
   bun scripts/walk.mjs --list
   ```

5. **The smallest real run first** — one theme, one area:

   ```
   bun scripts/walk.mjs --themes=neon --only=settings
   ```

6. **The full walk:**

   ```
   bun scripts/walk.mjs
   ```

`node scripts/walk.mjs` works identically — the driver is Node built-ins only, no `Bun.*` API, so it runs under either.

## Flags

- `--only=settings,menu` / `--skip=...` — filter steps by id or tag
- `--themes=neon` — one palette instead of all five (`neon matrix nord dracula black` — five dark themes, no light one; see Limits)
- `--window-shots` — opt in to the real window screenshots. A step marked `shot: 'window'` shells out to `scripts/shoot.ps1`, which MINIMISES EVERY OTHER WINDOW ON THE DESKTOP and hides the desktop icons for about 2.5 seconds per shot, to photograph the real window over the wallpaper instead of just the document. It needs the owner's screen, so it is opt-in twice: the step must ask for it AND this flag must be on the command line. Without it those steps just note the shot was skipped.
- `--arm-ipc` — installs a shim over `window.__TAURI_INTERNALS__.invoke` so armed steps can click something and have the command recorded instead of actually fired. OFF by default, and DENY-BY-DEFAULT when on: only read-only commands (`get_*`, `list_*`, and a short explicit list) pass through to the real backend; everything else is recorded and answered with a stub, never forwarded. If the shim cannot be installed, armed steps are SKIPPED with that reason — they are never fired for real as a fallback.
- `--list` — print the plan and exit, drive nothing
- `--port=9223` / `DEVGO_CDP_PORT` — the CDP port, matching step 3 above
- `--out=<dir>` — where `docs/walk/<sha>/` is written (default: `docs/walk` under the repo)
- `--timeout=4000` — how long a `wait` waits before failing, in ms

## Port 1420 is strictPort

Vite's dev server is `strictPort` on 1420. A stray vite process already holding that port kills `tauri dev` outright rather than picking another port. If step 3 above fails to come up, check for one first.

## The green rule

The manifest's one field a gate should read is `green`, and it is computed by the walk, not left to the reader:

```
green = (failed === 0) && (consoleErrors === 0) && (passed > 0)
```

An empty or all-skipped run is never green — `passed > 0` is there specifically so a walk that filtered itself down to nothing cannot report OK.

Every step additionally fails on a console error or an uncaught exception raised while it ran, unless the message matches a short, explicit noise list in `walk.routes.mjs` (vite's own dev-server chatter, React DevTools nag, and CSP refusals WebView2 logs for any resource the CSP legitimately blocks). Nothing is added to that list to make a red step green without a reviewer reading why.

## The one-line gate check

```
grep -q "\"sha\": \"$SHA\"" "docs/walk/$SHA/manifest.json" && grep -q '"green": true' "docs/walk/$SHA/manifest.json"
```

Both greps have to hit: the sha check proves the manifest is about the build under test and not a stale one left over from an earlier run, and the green check is the pass/fail.

## What it cannot do

- **No hover.** Neither `scripts/cdp.mjs` nor this walk can hold a hover state — `Input.dispatchMouseEvent(mouseMoved)` is sent immediately before every click and nothing captures the frame in between. A hover-only contrast bug is unverifiable by this route.
- **Nothing native.** No tray, no OS menus, no native file dialogs, no window chrome in four of the five themes (only the `home-window` step, in `neon`, uses `shoot.ps1` to capture the real window; the rest is `Page.captureScreenshot`, the document only — no rounded corners, no transparency knob, no title-bar buttons as the OS composites them).
- **`key F5` does not reload a Tauri webview.** The route map's `{ reload: true }` action calls `eval "location.reload()"` instead — that is why it exists as its own verb rather than reusing the key event.
- **Not a CI instrument.** WebView2 needs a real interactive desktop session. `windows-latest` has no installed DevGo, and `shoot.ps1` would minimise a runner's windows to photograph nothing. This is a LOCAL gate; do not put it in a workflow file and do not report its absence there as a skip.
- **This app has no `data-testid` anywhere.** Every selector in `walk.routes.mjs` is a structural or text fact about production markup, so a refactor can turn the walk red without breaking the app. A red step is a claim about the walk OR the app — read the assertion before you read the code.

## Named gaps — not silently counted as passing

Lifted from `NOT_COVERED` in `walk.routes.mjs`:

- Hover states (see above)
- Native window chrome, in every theme but `neon`
- The attach pane and any live pty — opening one starts a real shell in the owner's session
- The servers lane beyond its rows — every server action reaches a real box over SSH
- GitHub clone, group edit and add-repo — they write to disk and to the GitHub account
- Loading and error states — timing- and network-dependent; reachable with `--arm-ipc` and a rejecting stub, but no step does it yet
- A light theme — there is not one; DevGo ships five dark palettes and no light ground to find a light-only bug on
- macOS and Linux — this harness needs WebView2 and `shoot.ps1` needs Win32; those builds are captured by hand (`docs/screenshots/README.md`)
- CI, for the reasons above

## settings-backdrop is a regression guard, not an expected failure

This step was written to be red: a click-through had seen the Settings sheet swallow an outside click while Close and Escape worked. 33a4f20 closed the title-bar-strip gap, and the first real run found the step GREEN. A negative control over CDP confirmed the check measures something: a click inside the panel left Settings open, a click on the backdrop closed it. A red here now means a regression.

## Screenshots are not committed

This repo is public. The walk photographs the owner's real app, so its PNGs show private repo names, client projects, SSH aliases and WSL paths. `.gitignore` keeps `docs/walk/*/*.png` out of git; only `manifest.json` is committed. Its `shot` fields name files that exist on the machine that ran the walk, not in the repo.

## First real run — 2026-10-03

- binary: `6d2b16d` (v1.2.5), read from the app over IPC; `tauri dev` build, CDP on 9223
- result: GREEN — 62 step-runs, 61 passed, 0 failed, 1 skipped (`home-window`, needs `--window-shots`), 0 console errors, 0 ignored console lines
- theme check: the five `home` shots have five different hashes, so the theme switch really repaints
- artefact: `docs/walk/6d2b16d/manifest.json` (51 PNGs, about 19 MB, kept local — see above)

What the first run found, all in the walk itself, none in the app:

- `settings-tmux` was red: on Windows the nav reads `tmux / psmux`, the route map said `tmux`. Fixed in the route map, with a stronger anchor.
- a rerun of the same sha left the earlier run's PNGs beside the new manifest. The walk now clears its own folder's PNGs first.
- the walk left the dev build on the last theme it walked (`black`). It now snapshots localStorage and puts it back at the end. The installed app was never affected: its storage origin is `http://tauri.localhost`, the dev build's is `http://localhost:1420`.
- `home-window` printed `ok` with its window shot skipped. It now counts as skipped.
- `settings-backdrop` passed although it was labelled "expected red" (see above).

## Static validation of the route map

- exports present: 11 of 11 expected (`CONSOLE_NOISE`, `IPC_READ_ONLY`, `IPC_STUBS`, `MENU_ALWAYS`, `MENU_CONDITIONAL`, `NEVER_CLICK`, `NOT_COVERED`, `SETTINGS_PANELS`, `STEPS`, `THEMES`, `THEME_STORAGE_KEY`), plus `MENU_HINTS` and `S`
- steps: 34
- step-runs over 5 themes: 62
- step ids: unique
- steps with an empty `assert` list: 0
- settings panels registered: 13
