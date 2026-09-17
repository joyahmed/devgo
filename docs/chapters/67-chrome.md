# 67 — The Chrome

**Branch:** `67.chrome` — `git checkout 67.chrome` gives you this chapter's finished app; `git diff abf3d53 67.chrome` is exactly what this chapter adds (the branch sits on `abf3d53`, the brand commit the Mac put on `main` after 66; see *Also since 66*).

**Starting from:** chapter 66 — equal lanes.

**Goal:** the UI audit's last A item and its B table, row by row: the footer's right half (A6: the key chips, a divider, Commands, the Summon chip, Shortcuts, Help — and the `Manage…` door stays), JetBrains Mono bundled, the `bg-raised` surface with the four palettes' ink rework and a gate that reads every surface, the Kbd chip's fill, the lane hues by angle, bordered `+` buttons and one segmented sort, the Enter chip, row density and ink, and the smaller rows of the table (Settings order, the hints switch, the OS transparency note, Help wording, the project menu's sections).

> **Hold on to:**
> 1. **A missing colour is a type error.** `ThemeKey` gains `'bg-raised'`; `Record<ThemeKey, string>` makes every palette define it before `tsc` passes, and the transparency derivation in `index.css` has to carry the sixth `--solid-bg-*` or the chip goes opaque under the knob.
> 2. **The gate reads the code, not a copy.** `check-contrast.mjs` parses `FS_TONE` out of `rowStyles.ts`, every surface a row can wear, and the hue gap between lanes; a hue the app uses that the gate cannot resolve is a hard failure, never a skip.
> 3. **Disabled is a token, not an opacity.** `disabled:opacity-50` on the `Button` base fails the first-paint contrast the gate holds every ink to; each variant says what disabled looks like in `text-text-muted` and `border-border`.

## Also since 66

One commit straight on `main` between 66 and this branch's first, with no number — the *branch = it gets a chapter* rule; the next chapter lists it:

- `abf3d53 ✅BRAND: the binary is DevGo too` — `src-tauri/tauri.conf.json`, one line: `"mainBinaryName": "DevGo"` pins the executable to the brand's case, so it is `DevGo.app/Contents/MacOS/DevGo` on a Mac and `DevGo.exe` on Windows rather than the cargo name `devgo`; `CFBundleExecutable` follows. Nothing in the crate spawns itself by name, so the rename touches only the bundle.

---

## 67.1 — JetBrains Mono, bundled

`public/fonts/JetBrainsMono-{Regular,Medium,SemiBold,Bold}.woff2` (92–95 KB each, the SIL Open Font Licence) and four `@font-face` rules at the top of `index.css` with `font-display: swap`; `--font-mono` becomes `'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace`. Every mono string in the app — names, paths, branches, chips — renders in the same face on every machine, offline. `AboutPanel`'s third-party line names it.

> `✅UI: jetbrains mono bundled`

## 67.2 — `bg-raised` and the ink rework

`types.d.ts`: `'bg-raised'` in `ThemeKey`. `themes.ts`: the key in `KEYS` and in every palette — Neon `#243c66`, Matrix `#1a3f20`, Nord `#586174`, Dracula `#575a70`, Pure Black `#353535` — and the contract at the top grows two rules (the inks on *every* surface including hover and selected; `bg-raised` a visible step over `bg-panel` and `bg-hover`). Four palettes carry the ink rework the stricter rule needs: Matrix `text-secondary #7bea9e`, `text-muted #9ac4a4`, `border-strong #588c61`; Nord `bg-selected #2f4a66` (a saturated blue — the old `#4c566a` was lighter than the palette's own hover, so a selected row read as weaker than a hovered one), `text-secondary #dfe4ed`, `text-muted #d0d6e0`, `border-strong #9ca6b8`; Dracula `#d1d5da` / `#c4cad9` / `#8f93ab`; Pure Black `#cccccc` / `#aeaeae` / `#6d6d6d`. `index.css`: `--color-bg-raised` in `@theme`, `--solid-bg-raised` and its `color-mix` line beside the other five, so the knob reaches it.

> `✅THEMES: bg-raised and the ink rework`

## 67.3 — Lane hues by angle

`rowStyles.ts`'s `FS_TONE` and `EDGE`: WSL `orange-300`, the machine's own disk (`Windows`, `Mac`, `Linux` — three keys, one hex) `sky-300`, a share `fuchsia-300`. Chosen by hue angle, not by the accent: a lane in the accent beside a lane in grey read as one real file system and one greyed out; sky and orange are 169° apart, which is what survives being small (the 200 shades passed every ratio and still read as one near-white); fuchsia is 88° and 104° from both, so the warning is never mistaken for an ordinary case. The title bar's chips share the tables, so `Windows` and `WSL · 1 running` wear the same two hues as their lanes.

> `✅UI: lane hues by angle`

## 67.4 — The gate reads every surface and hue

`scripts/check-contrast.mjs`: `SURFACES` is the five a row can wear; `text-primary` is also held on `bg-raised`; `STEPS` holds `bg-raised` 1.6:1 over `bg-panel` and 1.35:1 over `bg-hover`; `parseFsTone` pulls the class names out of `rowStyles.ts`, resolves them through a small Tailwind hex table (unknown → exit 1), holds each at 4.5:1 on every surface of every palette, and holds every pair of *different* hexes 60° apart. Run over the chapter-66 palettes it reports 31 failing pairs (Matrix `text-muted` on `bg-selected` at 2.82:1, Nord `border-strong` on `bg-hover`, …); over 67.2's, `contrast ok: 6 palettes x 8 rules, 5 lane hues`.

> `✅BUILD: the gate reads every surface and hue`

## 67.5 — The Kbd chip, and disabled in tokens

`Kbd.tsx`: `font-semibold`, `bg-bg-raised`, the quiet `border-border` — a chip with a real fill and a bright edge is two separations doing one job.

`Button.tsx`: the base loses `disabled:opacity-50`; every variant says what disabled looks like (`disabled:text-text-muted`, and `disabled:border-border` on the bordered ones; a filled `primary`/`danger` falls back to the panel ground). Two variants join the table: `add` — `gap-1.5 h-9 pl-2.5 pr-3 border border-border-strong … hover:border-accent`, the door on the command row — and `segment`, one cell of a segmented control whose wrapper carries the border and whose chosen cell says so with `aria-current`.

> `✅UI: kbd chip on the raised surface` · `✅UI: disabled in tokens, add and segment variants`

## 67.6 — The command row's chrome

`SearchBox`: `enterHint` is a boolean and renders `<Kbd>Enter</Kbd>` — the same chip every other hint wears. `App.tsx`: the sort is one `inline-flex h-9 rounded-control border border-border-strong bg-bg-panel overflow-hidden` group of three `segment` buttons; `+ Workspace ▾` and `+ Add server ▾` are `add`; the refresh is `w-9 h-9` with the 15 px glyph. `GithubControls`'s row form: `+ Add repo ▾` is `add`, its refresh `w-9 h-9`.

> `✅UI: the enter hint is a kbd chip` · `✅APP: segmented sort and bordered adds`

## 67.7 — The footer's right half

`shortcuts.ts` gains three Navigation rows the tree already honours — `moveUp` (↑), `moveDown` (↓), `openSelected` (⏎) — so the chips and Settings › Shortcuts › Navigation can read them; `ShortcutId` grows the three names.

`StatusBar.tsx`: `hints` (`↑↓ Move · ⏎ Open · Ctrl+S Pin · Ctrl+K Search`, `hidden min-[1400px]:flex` — under 1400 the footer has no room and the palette still lists them), a `w-px h-5` rule, then `tail`: Commands (a door), **Summon** (a chip and a word, no click — the one shortcut shown nowhere else, and the door into the whole app; `summonHotkey` comes down from App as the panel's does), **Shortcuts** (`⌨`, opens Settings › Shortcuts), Help; one `map`, a `Button` where there is an `onClick` and a `span` where there is not. The group label reads `Editor`, the button `Open both`, the groups `gap-2`. `Manage…` stays where it was — this build's own door, and the audit's C16.

> `✅KEYS: the navigation rows` · `✅UI: footer key chips, summon and shortcuts`

## 67.8 — Row density and ink

Project, repo and server rows `py-2.5` (43 px at `text-15`), unselected ink `text-text-primary`, the workspace header `py-3`; the git badge `text-13`, the star `text-15`, the GitHub branch, star and time `text-13` with the time `w-20`; the `user@host` cell `text-13`; the meta clusters `gap-2`. A folder row keeps `py-1.5` — it is a child, one step under.

> `✅UI: row density and ink`

## 67.9 — The smaller rows

- **Settings:** Scanning moves after Shortcuts (Workspaces · Editors & Terminals · tmux · GitHub · Shortcuts · Scanning · Appearance · Config · Servers · Help · About); the hints switch reads `Show / Hide` — it is about the words, not a feature being on. — `✅UI: settings order and the hints switch`
- **Help says lane**, and the project menu's `Run dev script…` and `Open remote` share a section before Pin: the two that leave the row for somewhere else, together. — `✅UI: help says lane, menu sections`
- **The OS transparency switch.** `commands.rs`: `os_transparency_effects_enabled() -> Option<bool>` — one `reg query` of `HKCU\…\Themes\Personalize\EnableTransparency` through 54's `Quiet`, `Some(false)` when Windows draws no blur, `None` when the key cannot be read or on another OS; registered in `lib.rs`. Appearance reads it once on open and, on a window born see-through with the knob above 0, says *Windows' Transparency effects is off (Settings › Personalization › Colors). If the ground turns black instead of see-through, that switch is why.* Never at startup. — `✅WINDOW: the os transparency switch` · `✅UI: appearance names the os switch`

Rows of the B table left as they are, on purpose: the GitHub group wording (*Not in a group*, *Empty. Right-click a repo…* — the build's own voice, no em-dash clauses), the *show all* wording, the flat search list in one column (two halves in one lane would be two columns of nothing), the agent refusal tooltip (*is not installed on this project's side* is the true sentence beside the `wsl only` badge), the measured context menu (`04649d8`), and the About panel's links (no link to a repository that is not public). Already true before this chapter: the WSL chip only where WSL exists (64), the gear tooltip and the text-size copy reading the table (55).

## 67.10 — Verify

`cargo test` **202**, `cargo check` 0 warnings on both feature sets, `tsc -b` clean, `bun run build` → `contrast ok: 6 palettes x 8 rules, 5 lane hues`. `main` had moved to `abf3d53 ✅BRAND: the binary is DevGo too` under the branch; rebased, re-gated, ff-merged. One dev launch over CDP, the same fourteen-file backup, the installed DevGo stopped first.

- **The font:** `getComputedStyle` on a project name → `"JetBrains Mono", "Cascadia Code", Consolas, monospace`; `document.fonts` lists the family at **400 / 500 / 600 `loaded`** (700 `unloaded` — nothing bold is mono).
- **The six tokens on `:root`, per theme** (`--solid-bg-primary/secondary/panel/hover/selected/raised`, each theme set through `devgo.theme` + reload): Neon `#05070d #090e19 #0c1322 #131f38 #0f2f57 #243c66`; Matrix `#000000 #050805 #0a120a #0f2010 #14401a #1a3f20`, `text-muted #9ac4a4`; Nord `#2e3440 #2b303b #3b4252 #434c5e #2f4a66 #586174`, `#d0d6e0`; Dracula `#282a36 #21222c #343746 #44475a #44475a #575a70`, `#c4cad9`; Pure Black `#000000 #000000 #0a0a0a #1a1a1a #242424 #353535`, `#aeaeae`; every `--color-bg-*` a `color-mix(in srgb, <solid> calc(1 * 100%), transparent)`. The Kbd chip's computed background is the raised hex in each (`color(srgb 0.141 0.235 0.4)` on Neon), border `rgb(22, 31, 51)` (`--color-border`), weight **600**.
- **Rows:** project rows **43 px** (were 31), alternating `rgba(0,0,0,0)` / `oklab(… / 0.3)` — the zebra — ink `rgb(244, 248, 255)`; the workspace header **44 px**. The sort group **36 px**, `1px` border, three cells; `+ Workspace ▾`, `+ Add repo ▾`, `+ Add server ▾` each `1px rgb(95, 127, 181)` and **36 px** tall.
- **Footer:** at **2560** one line, the words in order `Editor · VS Code · Zed Ctrl+⏎ · Terminal · Windows Terminal Shift+⏎ · Agent · Claude Code Ctrl+Alt+⏎ · Claude Code (Ubuntu-26.04) · Open both Alt+⏎ · Manage… · ↑↓ Move · ⏎ Open · Ctrl+S Pin · Ctrl+K Search · Ctrl+Shift+P Commands · Ctrl+Alt+Space Summon · ⌨ Shortcuts · ? Help`; at **1400** the hints box is `display: flex` and the footer wraps to **83 px** with the chips on the second line; at **1200** the hints box is `display: none`, the four doors alone on the second line. The Shortcuts door opened Settings on the **Shortcuts** panel with the three new Navigation rows (`↑`, `↓`, `⏎`) above *Expand workspace*, and the panel list in the new order.
- Screenshots at 2560, 1400, 1200 and in each palette, looked at: orange WSL lane, sky Windows lane, the chips in the same hues, mono everywhere, bordered adds, one sort control, the chips in the footer.

The dev build stopped; the fourteen files restored by hash — **13 OK**, and `prefs.json` restored then set to the live value `"window_transparency": 7` (the knob had moved on the installed build during the run; everything else in the file is the backup byte for byte); the installed DevGo relaunched through `explorer.exe` so the window is born see-through at 7.

> `✅STAGE: 67 chrome`; ff-merge; push. 15 commits + STAGE (1 Rust, 1 build script, 13 React/CSS).

---

## What you built

```
public/fonts/JetBrainsMono-*.woff2       four weights, bundled
src/index.css                            @font-face ×4, --font-mono, --color-bg-raised, --solid-bg-raised
src/themes.ts                            bg-raised in every palette; the ink rework; the contract
src/types.d.ts                           ThemeKey, ButtonVariant, ShortcutId, StatusBarProps, SearchBoxProps
scripts/check-contrast.mjs               five surfaces, the raised step, the lane hues and their gaps
src/components/rowStyles.ts              FS_TONE / EDGE by hue angle
src/components/Kbd.tsx                   raised fill, quiet edge, semibold
src/components/Button.tsx                disabled in tokens; add, segment
src/components/SearchBox.tsx             the Enter chip
src/components/GithubControls.tsx        the row form's add is bordered
src/components/StatusBar.tsx             hints, rule, Commands, Summon, Shortcuts, Help
src/shortcuts.ts                         moveUp, moveDown, openSelected
src/components/ProjectTree.tsx, GithubLane.tsx, ServersLane.tsx   density and ink
src/components/Settings.tsx              panel order, Show / Hide, the OS switch note
src/components/HelpPanel.tsx             lane
src/components/AboutPanel.tsx            the font's licence
src-tauri/src/commands.rs, lib.rs        os_transparency_effects_enabled
src/App.tsx                              the sort, the adds, the footer's props, the menu's sections
```

- **The same face everywhere** — the coding font ships with the app.
- **A surface for controls to sit on**, in every palette, under the transparency knob, held by the gate.
- **A footer that teaches the keys** it cannot show as buttons, and a chip family that reads as keycaps.
