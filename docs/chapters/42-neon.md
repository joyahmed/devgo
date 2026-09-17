# 42 — Neon Is Neon (post-plan)

**Branch:** `42.neon` — `git checkout 42.neon` gives you this chapter's finished app; `git diff 41.transparency 42.neon` is exactly what this chapter adds.

**Starting from:** chapter 41 — the window can be see-through. Its default palette, *DevGo Neon*, is Tailwind `blue-500` on slate: the accent the UI plan had flagged as *"the one colour that says unstyled"*, and greys doing the work of secondary and muted ink.

**Goal:** a Neon that earns the name, without breaking the contrast contract — and a fix the redo exposed in every palette.

> **Hold on to:**
> 1. **Raise the token, don't lower the bar.** The gate is the contract; a palette that fails it changes its colours, never its rules.
> 2. **A glow is a token.** `--color-glow` is a box-shadow, `none` in four palettes; no component knows which theme is on (chapter 16's rule).
> 3. **The accent's ink is the ground.** A filled accent button carries `text-bg-primary`, and the gate now checks that pair — the day a brighter accent made an old failure visible.
>
> TypeScript only: `ThemeKey` gains a member, so `Record<ThemeKey, string>` makes a palette without `glow` a type error; the gate's parser reads hex values only, so a non-colour key is invisible to it by construction.

> The old Neon was the palette that shipped before anyone chose one. This chapter chooses one.

---

## 42.1 — The palette

Near-black blue ground (`#05070d` → panel `#0c1322`), a selected row that is actually blue (`#0f2f57`), ink with a cold cast (`#f4f8ff` / `#b9c6de` / `#8f9dba` — three steps you can tell apart), **electric cyan** (`#22d3ee`, hover `#67e8f9`) as the accent, danger warmed to `#fb7185`, borders `#161f33` / `#5f7fb5`. Both places: the `neon` entry in `themes.ts` and the `@theme` block in `index.css` — the sixth palette, the one that paints before a theme is chosen, so a fresh install is Neon from the first frame. There is no `bg-raised` token to lift: the kbd chips sit on `bg-panel` with a `border-strong` edge since chapter 23. `border-strong` at `#5f7fb5` is 3.3:1 on the selected row, `text-muted` 7.4:1 on the ground.

> `✅THEME: neon is cyan on a colder ground` — `bun run build` (the gate runs first): 6 palettes × 5 rules.

## 42.2 — A glow the others leave empty

`ThemeKey` gains `'glow'` (`types.d.ts`, "not a colour: a box-shadow, or none"); `KEYS` in `themes.ts` lists it so `applyTheme` sets `--color-glow` like any other; Neon's is `0 0 0 1px rgb(34 211 238 / 0.45), 0 0 18px rgb(34 211 238 / 0.25)`, Matrix, Nord, Dracula and Pure Black say `none`; `index.css` carries Neon's. `Record<ThemeKey, string>` is what makes a palette without it a type error.

> `✅THEME: glow token`

## 42.3 — Where it shows

Two places: the selected project row — the strong state only, `bg-bg-selected text-text-primary shadow-[var(--color-glow)]`; the quiet `/40` state while a workspace header or GitHub row has the cursor stays bare — and the search box on focus, `focus-within:shadow-[var(--color-glow)]` beside its accent border. The other four palettes look exactly as they did.

> `✅UI: halo on the selected row and the box`

## 42.4 — Found while doing it: white on cyan

The `primary` Button variant was `bg-accent text-text-primary`: white ink on the accent. On `blue-500` that was **3.7:1**, under the bar and never checked; on cyan it is **1.8:1**. One line in `Button.tsx` — `text-bg-primary`, the ground as ink — fixes every filled button at once (with a hand-styled button in each of eight components this would be eight edits; there is one `Button`). The gate gains the rule it was missing: `bg-primary` on `accent` ≥ 4.5 — Neon 11.1, Matrix 9.2, Nord 6.2, Pure Black 5.7.

> `✅THEME: ground as ink on accent buttons` — `bun run build`: 6 palettes × **6** rules.

## 42.5 — Verify

`tsc -b` and `bun run build` clean; Rust untouched (152). Back up the six files. Headless over CDP. `devgo.theme` was absent in `localStorage` (this machine runs the default) — it is removed again at the end.

**The palette paints first.** No theme key saved, and `--color-accent` on `:root` is `#22d3ee`, `--color-bg-primary` `#05070d`, `--color-bg-selected` `#0f2f57`, `--color-text-muted` `#8f9dba`, `--color-glow` the two-shadow string; `body` computes to `color(srgb 0.0196 0.0275 0.0510)` = `#05070d`, the header the secondary token. **The halo.** `↓` selects the first row: its classes carry `bg-bg-selected shadow-[var(--color-glow)]` and its computed `box-shadow` ends `rgba(34, 211, 238, 0.45) 0px 0px 0px 1px, rgba(34, 211, 238, 0.25) 0px 0px 18px 0px`. The search box blurred: `box-shadow: none`, border still cyan (chapter 36's colour); focused: the same two shadows. **The ink.** Settings › Workspaces › *Add Folder*: `color rgb(5, 7, 13)` on `background rgb(34, 211, 238)` — the ground on the accent. **Nord.** Appearance › Nord card `aria-pressed=true`, key `nord`, accent `#88c0d0`, glow `none`; *Add Folder* now `rgb(46, 52, 64)` on `rgb(136, 192, 208)` — the ink followed the palette; the selected row and the focused box read `box-shadow: none`. Back to *DevGo Neon* (cyan, the glow string), `devgo.theme` removed → `null`, accent still `#22d3ee`.

`Ctrl+Q`, restore the six files (all matched), the installed DevGo restarted.

> `✅STAGE: 42 neon`; ff-merge; push.

---

## What you built

```
src/
  themes.ts                   Neon redone; KEYS + glow on every palette
  index.css                   the @theme block redone; --color-glow
  types.d.ts                  ThemeKey | 'glow'
  components/ProjectTree.tsx  shadow-[var(--color-glow)] on the strong selected row
  components/SearchBox.tsx    focus-within:shadow-[var(--color-glow)]
  components/Button.tsx       primary: text-bg-primary
scripts/check-contrast.mjs    bg-primary on accent >= 4.5
```

A default palette somebody chose; a glow that is a token, so one theme can have it and four can decline; one more rule in the gate.

> **The thread running through this chapter.** The gate found nothing until the accent got bright enough to show a pair it had never measured. A contract is only as good as its list of pairs — when a redesign breaks something, add the pair, then fix the colour.
