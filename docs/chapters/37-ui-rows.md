# 37 — Tokens the Components Cannot Disobey (post-plan)

**Branch:** `37.ui-rows` — `git checkout 37.ui-rows` gives you this chapter's finished app; `git diff 36.ui-chrome 37.ui-rows` is exactly what this chapter adds.

**Starting from:** chapter 36 — the chrome is one strip fewer and each search sits over what it searches. The rows under them still use ten distinct text sizes, twenty-three tracked-out ALL-CAPS labels, six radii and two shadows, chosen file by file over thirty-six chapters.

**Goal:** one type scale, two radii, one shadow, sentence case, a visible keyboard focus, respect for reduced motion, quieter rows, one rail per group, the GitHub controls on the search line — and the app's single choreographed motion, on launch.

> **Hold on to:**
> 1. **The wrong size is impossible to type.** Five `--text-*` tokens in `@theme`; the pass that maps every old class onto them is a script, and a grep is the test.
> 2. **Caps are structure or nothing.** One survivor — the column header over the whole table. Where a label was legible only because of its caps, it went up a step instead.
> 3. **One motion, on launch.** A row washes with the accent, the footer button that answered pulses once, 240 ms and both are gone. Never on select, hover or mount.
>
> Rust: none — this chapter is frontend only. TypeScript: a regex pass over every source file with a lookbehind so `text-xs` never matches inside `text-xs-foo`; `:focus-visible` versus `:focus`; a timestamp as a sequence number where the compiler refuses a ref write; `group` / `group-hover:` for a control that appears on the row's hover.

> Ten sizes across twenty-four files — as few as that because thirty-six chapters of reuse already put most text through `Button` and the `col` grid — and the cure is five tokens, one pass, three greps. (The `@theme` comment in `index.css` that introduces the scale says *seventeen* sizes were in use: that overstates this tree; the range it names, `text-[9px]` to `text-4xl`, is right.)

---

## 37.1 — Five sizes, two radii, one shadow

`index.css`, in `@theme`:

```css
	/* one scale, five steps. seventeen sizes were in use (text-[9px] to
	   text-4xl); a component that can pick any pixel size will. 11 for a
	   hint or a tag, 13 for metadata and controls, 15 for a row, 18 for a
	   heading, 24 for the one title. line heights ride along, so text-15
	   alone sets both */
	--text-11: 11px;
	--text-11--line-height: 16px;
	--text-13: 13px;
	--text-13--line-height: 20px;
	--text-15: 15px;
	--text-15--line-height: 22px;
	--text-18: 18px;
	--text-18--line-height: 26px;
	--text-24: 24px;
	--text-24--line-height: 32px;
	/* two radii: a control (button, input, chip, menu row) and a panel (a
	   modal, a menu, a toast). one shadow, for panels only: rows and chips
	   never float */
	--radius-control: 6px;
	--radius-panel: 12px;
	--shadow-surface: 0 16px 40px -12px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(0 0 0 / 0.25);
```

Tailwind v4 turns `--text-13` into `text-13` and the `--line-height` twin rides along, so one class sets both; `--radius-control` mints `rounded-control` *and* `rounded-t-control`. The pass is a script over `src/**/*.ts{,x}` with a word-boundary lookbehind on each class: `text-[9px]` `text-[10px]` `text-[11px]` → `text-11`; `text-xs` `text-[13px]` → `text-13`; `text-sm` → `text-15`; `text-base` `text-lg` → `text-18`; `text-xl` `text-4xl` → `text-24`; bare `rounded`, `rounded-md`, `rounded-lg` → `rounded-control`; `rounded-xl` → `rounded-panel`; `rounded-t-md` → `rounded-t-control`; the pill Button's `rounded-[20px]` → `rounded-full` (a pill *is* full); `shadow-lg` `shadow-2xl` → `shadow-surface`. Twenty-five files changed; not one by hand. The one comment that named an old size (`Kbd`) was rewritten.

After: `grep -r 'text-\[' src` finds no class string — its one hit is that `@theme` comment naming the old range · `rounded-{control,t-control,panel,full,none}` only · `shadow-surface` only. Those three greps are the test. `col` was `text-sm`; rows are 15 px now.

> `✅UI: one type scale two radii one shadow`

## 37.2 — Sentence case, one exception

Twenty-three `uppercase tracking-wider`. One survives: the **column header** over the whole table — *Workspace · Location · File System · Count* — where caps are structural, the thing that makes the header read as a header over the workspace headings under it. Everything else is a sentence: the footer's *Edit* / *Terminal*, the WSL chip's *stopped*, the GitHub row's *local* / *added* / *gone* / *archived* marks, the badge and pill variants.

Where a caps label was only legible *because* of the caps, the size went up a step instead: the Settings and TargetManager `heading`s (12 px bold caps → `text-15 font-semibold` in the primary ink), the Settings sidebar's *Settings* (`text-13 font-semibold`), the palette's *Recent* / *All commands* dividers (`text-13`), the pickers' *Found N* (`text-13`, no bold), the *Pinned* label (`text-13`), the footer's group labels (`text-13`). And the counts on the headings — *6*, *13*, *382* — were inheriting the row's 15 px; they are `text-13`, with the rest of the metadata.

> `✅UI: sentence case, caps only on the column header`

## 37.3 — The eye and the hand

```css
/* keyboard focus is visible, in the accent: tab used to land on buttons
   invisibly. buttons, links and tab stops only; an input already says
   focused through its wrapper's accent border, and a ring on the input as
   well drew a square outline inside a rounded box in a second blue */
:where(button, a, [role='button'], [tabindex]):focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}
:where(input, textarea, select):focus-visible {
	outline: none;
}
:focus:not(:focus-visible) {
	outline: none;
}

/* someone who asked their os for less motion gets none */
@media (prefers-reduced-motion: reduce) {
	*,
	*::before,
	*::after {
		animation-duration: 0.01ms !important;
		animation-iteration-count: 1 !important;
		transition-duration: 0.01ms !important;
	}
```

Tab used to land on buttons invisibly. Now it draws the accent — on buttons, links and tab stops, and **not** on inputs: a first version that rings every element draws a squared outline inside a search box that has a border radius, in a second blue. The input already says *focused* through its wrapper's accent border; a second ring on the bare input inside a rounded box was a square in a second blue. The outline follows the element's own radius, which is why it belongs on the rounded controls and not on the field inside one. Reduced motion: someone who asked their OS for less gets none.

> `✅UI: focus ring on controls and reduced motion`

## 37.4 — Quieter rows

- **Stack badges are words.** `NODE` `BUN` in bordered boxes read as two buttons on every row — a column of chips down forty rows. `node bun` in mono, in the stack's hue, no border, reads as what it is; `TAG_TONE` loses its border halves. The `○` (no deps) and `●` (dirty) marks stay — they are the two facts that change what you do next.
- **The star only on hover, or when pinned.** The row is a `group`; the hollow `☆` is `opacity-0 group-hover:opacity-100 focus-visible:opacity-100`, the pinned `★` always. Forty-seven hollow stars down the table were a column of nothing.

> `✅UI: badges are words and stars on hover`

- **The hint words are off.** `recent` / `frequent` were the fourth item in a five-item cluster, and the frecency sort already puts those projects first. Off by default, on in **Settings › Appearance › Hint words** — an On/Off pair in the `target` variant, the third panel to use it — so the choice is a switch rather than a fork. App owns `showHints` (`devgo.hints` in `localStorage`) and threads it through `ProjectTree` → `ProjectRow` → `RowMeta`; `AppearancePanelProps` and two props on `SettingsProps`.

> `✅UI: hint words behind an appearance switch`

- **One rail per group.** A 2 px left rule the height of a workspace's rows, in the file system's hue — the accent for WSL, muted for Windows, amber for a network share, the same tones `FsCell` uses — and the strong border for the GitHub rows. It replaces the per-row `border-l` guide that flipped to accent on selection: the rail belongs to the group; selection is the row's ground and its name. `ProjectRow` loses `pinnedStrip` (the Pinned strip is a container with its own rail), `RepoRow` loses its guide and its `ml-12` (the container carries the indent), the group headings and the empty / error / footer lines lose their `ml-6`. The `quiet` state from chapter 36 is now the ground alone, `bg-bg-selected/40`.

> `✅UI: one rail per group`

## 37.5 — The one moment that moves

```css
	/* the one choreographed motion in the app: the row you just launched.
	   the accent washes across it from the rail and fades, 220ms, once. on
	   launch only, never on select, hover or mount: motion here answers an
	   action, and nothing moves on its own */
	--animate-launch: launch 220ms ease-out;
	@keyframes launch {
		from {
			background-color: color-mix(in oklab, var(--color-accent) 45%, transparent);
			box-shadow: inset 6px 0 0 var(--color-accent);
		}
		to {
			background-color: transparent;
			box-shadow: inset 0 0 0 transparent;
		}
	}
	/* the footer button that answered the key: one pulse of the accent */
	--animate-pulse-once: pulse-once 220ms ease-out;
	@keyframes pulse-once {
		from {
			background-color: var(--color-accent);
			color: var(--color-text-primary);
		}
		to {
			background-color: transparent;
		}
	}
```

DevGo's one job is the instant between *Enter* and *the editor is open*. That instant is the app's only choreographed motion: the launched row washes with the accent from its rail and fades, and the footer button that answered — *VS Code*, *Windows Terminal*, *Open Both* — pulses once. 240 ms and both are gone.

```ts
	const [launching, setLaunching] = useState<Launching | null>(null);
	const flash = (kind: LaunchKind, path = selected?.full_path) => {
		if (!path) return;
		const seq = performance.now();
		setLaunching({ path, kind, seq });
		window.setTimeout(
			() => setLaunching(l => (l?.seq === seq ? null : l)),
			240
		);
	};
```

A timestamp, not a ref counter, sequences it: `flash` is reachable from the palette's command list, which is built during render, and the compiler refuses a ref write on that path. Every launch path goes through one of four handlers — `handleLaunch` (Enter, double-click, *Open both*), `launchEditor` / `launchTerminal` (a row's menu, the palette's project commands), `handleOpenEditor` / `handleOpenTerminal` / `handleOpenBoth` (the footer, the shortcuts) — so every launch flashes. `ProjectTreeProps.launchingPath` → `ProjectRowProps.launching` → `animate-launch`; `StatusBarProps.pulse` → `TargetGroupProps.pulse` on the default button, or *Open Both*. `LaunchKind` and `Launching` in `types.d.ts`.

⛔ It plays on launch only. Never on select, hover, or mount. No entrance animations, no hover lifts, no card fades — motion here answers an action, and nothing moves on its own.

> `✅UI: the launch moment`

## 37.6 — The GitHub controls on the search line

The GitHub controls belong on the same line as the GitHub search, and the `+` should carry a label the way `+ Workspace ▾` does. `GithubControls` is the three controls — *recents*, `+ Add repo ▾`, ↻ — beside the GitHub box in the command row, in the row's form: the word at 13 px, the `+` with its label like `+ Workspace ▾`, the refresh glyph in a `w-7 h-7` ghost. The table has no width rule, so the controls live in one place and the header is a line of text again — the collapse handle, the login, the sentence, the count. `GithubControlsProps` in `types.d.ts`; `onAddMenu` leaves `GithubLaneProps` and `ProjectTreeProps` (`onGithubAddMenu`), and the `Refresh` glyph moves with its button.

> `✅UI: github controls on the search line` — `bun run build` clean.

## 37.7 — Verify

No Rust changed: `cargo test` is still **149**, `cargo check` 0 warnings. Back up the six files. Nothing here opens a browser.

**The greps.** `grep -r 'text-\[' src` → one line, the `index.css` comment; no class. `grep -rhoP '\brounded(-[a-z\[\]0-9]+)*' src | sort | uniq -c` → `rounded-control` 29, `rounded-panel` 5, `rounded-full` 3, `rounded-none` 2, `rounded-t-control` 1 (and the bare word once, in an `index.css` comment). `shadow-surface` on six components and no other shadow class. `uppercase` → one line, the column header.

**The tokens, live.** Over CDP, every element carrying a text node on the main screen: font sizes **11 px · 13 px · 15 px · 18 px** and nothing else; radii **6 px** and full; no shadow on the main screen. Settings open: one **12 px** radius and one `shadow-surface`. `getComputedStyle` of a probe with `animate-launch` reads `launch 0.22s`; with `animate-pulse-once`, `pulse-once 0.22s`. `text-transform: uppercase` on exactly five elements — the column header row and its four cells.

**The rows.** 53 project rows at 15 px; per-row left borders **0**; eight rails — seven workspace groups in the accent and the muted tone (`rows=6, 13, 6, 2, 17, 5, 4`), one for the GitHub rows in the strong border (`rows=31`). Hint words: 0 rows; **Settings › Appearance › Hint words › On** → 7 rows carry *recent* or *frequent* (`app · WSL · recent`), `devgo.hints` = `on`; *Off* → 0. The first row's `☆` sits at `opacity: 0`; click the row (the pointer stays on it) and it reads `1`.

**The eye.** `Ctrl+K` puts focus in the project box: `outline: none`. `Tab` → *Frecency* with `outline: solid 2px rgb(59, 130, 246)` on a 6 px radius; `Tab` → *Activity*, the same.

**The launch moment.** A `MutationObserver` on class changes; `docs` (a Windows project — a WSL one would start the distro) selected through the box; `Ctrl+Enter`. Within 120 ms the observer has `animate-launch on projects docs Windows main ☆` and `animate-pulse-once on VS Code Ctrl+⏎`. VS Code opened the folder (ten processes); its window was closed from the script, none left.

**The line.** The GitHub header has **0** buttons; the command row's buttons read *Frecency · Activity · A–Z · + Workspace ▾ · ↻ · recents · + Add repo ▾ · ↻*. `+ Add repo ▾` → *Clone repos… · Add repo by name… · Group repos…*; *recents* → 29 → 9 rows and the footer line gone, again → 29. Header count cell: `13px`.

Remove `devgo.hints` and `devgo.githubRecents`, `Ctrl+Q`, restore the six files (all six matched by hash).

> `✅STAGE: 37 ui-rows`; ff-merge; push.

---

## What you built

```
src/
  index.css                    --text-11…24 with line heights, --radius-control, --shadow-surface;
                               --animate-launch, --animate-pulse-once; focus-visible rules; reduced motion
  (25 files)                   the token pass: text-*, rounded-*, shadow-* mapped; uppercase removed
  components/ProjectTree.tsx   RAIL per file system; words for badges; ☆ on hover; showHints; launching
  components/GithubLane.tsx    the rail container; no per-row guide; the header is text; Refresh moved out
  components/GithubControls.tsx   recents · + Add repo ▾ · ↻ on the search line
  components/StatusBar.tsx     pulse on the default button and Open Both
  components/Settings.tsx      Appearance › Hint words; headings at 15
  App.tsx                      launching + flash; launchEditor / launchTerminal; showHints; GithubControls
  types.d.ts                   LaunchKind, Launching, AppearancePanelProps, GithubControlsProps;
                               ProjectRowProps (quiet, showHints, launching; pinnedStrip gone), RowMetaProps,
                               ProjectTreeProps, StatusBarProps, TargetGroupProps, SettingsProps grown
```

Tokens the components cannot disobey, and the rows rebuilt on them.

> **The thread running through this chapter.** Not one visual decision here was made in a component: the sizes, the radii, the shadow and the motion are tokens in `@theme`, the caps rule is one grep, and the rail is the group's, not the row's. What the components kept is what only they know — which row was launched, whether a star is pinned, whether the pointer is on the row.
