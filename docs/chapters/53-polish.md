# 53 — A Day of Using It (post-plan)

**Branch:** `53.polish` — `git checkout 53.polish` gives you this chapter's finished app; `git diff 52.server-menus 53.polish` is exactly what this chapter adds.

**Starting from:** chapter 52 — the servers, their apps, the forms, the menus. Then a day of real use, and screenshots.

**Goal:** the things that only show up in use — a footer that wraps mid-group, a transparency that did nothing and then did the wrong thing, a *Run dev script* that opened two tabs, a Claude that thought it was somebody's child, an icon that vanished at 32 px. Each is small; together they are what a day of use buys.

> The asks, one screenshot at a time: *"this will look ugly"* · *"increasing opacity does this"* · *"enabled transparency effect on pc and what it shows is this"* · *"transparency makes it lose its color and the whole app doesn't become transparent"* · *"tried to open with claude ubuntu and it opened two tabs"* · *"we shouldn't have a slider for transparency but input and plus minus"* · *"i like the middle icon"*.

> **Hold on to:**
> 1. **Windows Terminal splits its own command line on a bare `;`** — even inside quotes. `wt … -e bash -lc "cmd; exec bash"` is two tabs. The escaped form `\;` is one. The seeded template had been wrong since chapter 14 and read as "the script finished".
> 2. **A launcher is nobody's child.** `Command::env_remove` on every `CLAUDE_CODE_*` / `CLAUDECODE` / `CLAUDE_PID` / `CLAUDE_EFFORT` / `AI_AGENT` key before `spawn()`: what DevGo opens is a fresh top-level thing, whatever started DevGo.
> 3. **One CSS variable, every surface.** `--color-bg-*` is derived in `index.css` with `color-mix(in srgb, var(--solid-bg-*) calc(var(--ground-alpha) * 100%), transparent)`; `applyTheme` sets the `--solid-bg-*` half. Text, borders and the accent stay solid, and the contrast gate keeps measuring the solid hexes.
>
> Rust: `env_remove` on a `Command`; a third adoption in the target store, same shape as the two before it. TypeScript: a number input in place of a range, `Math.max/min` clamping at both ends.

**Shape of the chapter.** The footer never had divider bars here (the ch. 36 table dropped them), so 53.1 is the wrap alone. There is no `bg-raised` token: five surfaces are derived, not six. The icon was already the tile, so 53.5 types nothing. No `os_transparency_effects_enabled` hint: with no acrylic, the Windows switch no longer matters.

---

## 53.1 — The footer wraps by whole groups

At widths where the launch groups no longer fit, the footer wrapped mid-group, with the key hints floating beside two half-lines. `StatusBar.tsx`: the `footer` is `flex flex-wrap items-center gap-x-6 gap-y-1.5 min-h-12 py-1.5` (no `h-12`, no `overflow-hidden`); every group, *Open Both* and *Manage…* are direct `shrink-0` children of the footer — the left-half wrapper is gone, because a wrapper that already spans the width would put the hints on a third line; the hints' wrapper carries `ml-auto`, so they share the last line, right-aligned. `TargetGroup`'s own div is `shrink-0` instead of `min-w-0`, so a group moves as a unit.

> `✅UI: footer wraps by whole groups`

## 53.2 — Transparency, three times

**It did nothing.** Stage 41's slider darkened the window instead of blurring it: Windows' own *Transparency effects* switch was off, and with it off DWM refuses every backdrop and composites the transparent ground over black.

**Then it did too little.** With the switch on, DWM drew the acrylic — but the cards drew `bg-secondary` at their own 50 % over the ground and cover 95 % of the window, so the setting reached the eye at ~15 %. The ask: *"except text and icons and borders everything follows the slider."* `index.css`: `--ground-alpha: 1` and the five `--solid-bg-*` on `:root`, and each `--color-bg-*` is a `color-mix` of its solid and the alpha; `applyTheme` in `themes.ts` writes `--solid-${key}` for the `bg-` keys and `--color-${key}` for the rest (setting `--color-bg-*` inline would override the derivation). Every `bg-bg-*` utility and every `/50` modifier on one follows the knob.

> `✅UI: every surface follows the knob`

**Then it did the wrong thing.** Side by side over a white window with a red word: acrylic blurred it into a haze and laid DWM's own gray tint over the theme — *"loses its color"*. With **no DWM effect at all** the word shows sharply through every surface, tinted by the theme — what Windows Terminal does, and what transparency means here. `apply_transparency` in `lib.rs` only clears effects now (`set_effects(None)`, kept as a function so an install that ran 41–52 with the backdrop set gets it cleared); the ground alpha is the whole setting. Not acrylic again.

> `✅WINDOW: no acrylic, the alpha is the setting`

**And the control.** A 5-step slider was *"too rigid"*. `TransparencyStep` in `Settings.tsx` (`TransparencyStepProps` in `types.d.ts`): **− [ 30 ] % see-through +** — one percent a click, any number typed into a `type='number'` input, *Opaque* shown only above 0 and resetting to it; the same shape as Text size. `−` disables at 0, `+` at `MAX_TRANSPARENCY` (60). The input's spinner is hidden in `index.css`.

> `✅UI: transparency one percent at a time`

## 53.3 — ⛔ `wt` splits on `;`

*Claude Code (Ubuntu-26.04)* on a project opened two Windows Terminal tabs: one running Claude, one failing with `error 0x80070002 when launching '" exec bash"'`. The seeded WSL run template was `wsl -d {distro} --cd "{linux_path}" -e bash -lc "{command}; exec bash"` — and Windows Terminal splits its own command line on a bare semicolon, even inside quotes, into a second tab. `WT_WSL_RUN_ARGS` in `models/target.rs` carries `{command}\; exec bash`; `WT_WSL_RUN_ARGS_PRE` is the old form; the `wt` candidate in `editors.rs` seeds from the constant; `adopt_wt_semicolon_escape` in `target_store.rs` rewrites an install's exact old default (backup `targets.json.pre-wt-semicolon`) and leaves a customised one alone — the third adoption, same shape as psmux and pwsh-run. `run_templates_substitute_the_command` asserts the escaped form; the old-install test asserts the adoption and its backup.

> `✅TARGET: wt splits on a bare semicolon` · `✅TEST: an old install gets the escaped semicolon`

## 53.4 — A launcher is nobody's child

A Claude opened from DevGo said *Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker*. DevGo had been restarted from inside a Claude Code session and inherited its environment, and every editor, terminal and agent it launched inherited it in turn. `spawn_raw` in `launcher.rs` walks `std::env::vars_os()` and `env_remove`s every `CLAUDE_CODE_*`, `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_EFFORT` and `AI_AGENT` before `spawn()`. The test sets `CLAUDE_CODE_PROOF` and `CLAUDECODE` in its own process, launches a `cmd` target whose template is `/c set > "marker"`, waits for `windir=` (set prints sorted) and asserts neither marker reached the child while a plain variable did. With the `env_remove` line commented out it fails.

> `✅LAUNCH: a launcher is nobody's child` · `✅TEST: a launched target carries no claude markers`

## 53.5 — The icon

Already true here: `src-tauri/icons/icon.png` is already the tile — the Neon ground as a rounded tile, a cyan `>_`. Nothing to type. If you regenerate: `bun tauri icon src-tauri/app-icon.png`; `scripts/reset-icon-cache.ps1` restarts Explorer, which strips the frame from every open window — run it when nothing else is open, or not at all.

## 53.6 — Verify

`cargo test` **186**, `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. Fourteen files backed up by hash. WSL was already running, left alone.

**The footer.** At the window's real 2560 px: one line, 48 px, every child at the same top, the hints at the right edge. Viewport emulated at **1200×700** over CDP: two lines — *Edit · Terminal · Agent · Open Both · Manage…* on the first (ending at 1125 of 1184), *Ctrl+Shift+P Commands · ? Help* alone on the second, right-aligned by `ml-auto`. At **1000 px**: *Edit · Terminal · Agent* on the first, *Open Both · Manage…* at the left of the second with the hints at its right; every button inside its group's box — no group split.

**The stepper.** Settings › Appearance: `0`, `−` disabled, no *Opaque*. `+` three times → `3`, `--ground-alpha` `0.97`; `−` → `2`; `30` typed → `--ground-alpha` `0.7`, `--color-bg-panel` computed as `color-mix(in srgb, #0c1322 calc(0.7 * 100%), transparent)`, a `bg-bg-secondary` card resolving to `color(srgb … / 0.7)` and a `bg-bg-panel` one likewise, `body` at alpha 0.7, `prefs.json` `"window_transparency": 30`; the list reads through the Settings drawer while its text stays solid. *Opaque* → `0`, `−` disabled again, *Opaque* gone, `prefs.json` `0`.

**The semicolon.** On an existing install whose `targets.json` already carries `{command}\; exec bash` on the `wt` row and a `targets.json.pre-wt-semicolon` beside it, the adoption finds nothing to do, and the dev run writes no new backup. A live *Run dev script* through `wt` was not launched: the tab it opens cannot be closed without touching a terminal in use. The two unit tests are the proof.

**The scrub.** The unit test above; it reproduces a DevGo launched from inside Claude Code, markers and all.

`Ctrl+Q`, all fourteen files restored and hash-matched (the transparency and the window state undone), the installed DevGo restarted.

> `✅STAGE: 53 polish`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/models/target.rs              WT_WSL_RUN_ARGS (\;) and _PRE; the test asserts the escape
  src/services/editors.rs           the wt candidate seeds from the constant
  src/services/target_store.rs      adopt_wt_semicolon_escape, .pre-wt-semicolon
  src/services/launcher.rs          spawn_raw scrubs the claude markers; its test
  src/lib.rs                        apply_transparency clears effects only
src/
  index.css                         --ground-alpha, --solid-bg-*, five derived --color-bg-*; no spinner
  themes.ts                         applyTheme writes --solid-bg-*
  components/Settings.tsx           TransparencyStep
  components/StatusBar.tsx          flex-wrap, direct children, ml-auto
  types.d.ts                        TransparencyStepProps
```

A footer that wraps like it was designed to; transparency that is what the word means — sharp, in the theme's colour, every surface, one percent at a time; one tab, and the day-one `wt` semicolon bug found and fixed; clean launches, proved by a test that fails without the scrub.

> **The thread running through this chapter.** None of these were visible from the code. A footer wraps only at a width nobody resized to; a semicolon splits only when a terminal is the one reading it; an environment leaks only when the launcher was itself launched from somewhere. A day of use is a test suite the repo cannot contain.
