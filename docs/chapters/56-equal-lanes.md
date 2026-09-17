# 56 — Equal Lanes

**Branch:** `56.equal-lanes` — `git checkout 56.equal-lanes` gives you this chapter's finished app; `git diff 54.portable-crate 56.equal-lanes` is exactly what this chapter adds (55 was typed later, on a Mac, and rebased onto 65 — so 56 starts from 54).

**Starting from:** chapter 54 — the crate with one Windows-only seam; the window born opaque unless the knob says so. Chapter 55 was typed later, on a Mac, and sits after 65 in the branch order.

**Goal:** a day on a Mac found three numbers in a lane-grid layout of this list (each filesystem its own column) that only Windows had made look right — an undeclared grid row that let 379 repos starve the lane above them, a GitHub lane that spanned two columns when there was one to sit under, a search row hard-wired to two filesystem lanes — and the fix for a grid is one rule: **N lanes → N equal columns**, the command row above mirroring the grid. This list has been one table since 36 and cards since 43, so most of that rule is *already true* here; this chapter says which part maps to what, types the two parts that are real in a single table, and measures the rest.

> The bug report, from a Mac: *"a serious ui bug … top column gets totally hidden … github searchbar takes exactly two columns when there was only one."* Then, once it was fixed: *"i should not let one column stretch to two columns space. that way things will be in symmetry."*

> **Hold on to:**
> 1. **Never leave a row implicit when a child of it can scroll.** An implicit grid row is `auto`, and `auto` asks a scroller how tall it *wants* to be — a scroller wants everything. This table has no grid rows to declare (the cards are `shrink-0` children of one scroller, ch. 47), which is the other way of never having this bug.
> 2. **A symmetry rule is a rule about what a box searches.** Each search box sits over what it searches and takes no more: the project box over the table, the GitHub box a fixed share beside it, the servers' box in its own card's heading. Nothing spans two of anything.
> 3. **`loading` is not "nothing to show".** A flag that is true for the whole of a refresh must not swap the list for a spinner; the list *is* the state. Guard on both (`loading && projects.length === 0`) and let the control that started the pass show that it is running.
>
> TypeScript: `flex-wrap` with a `min-w-[12rem]` child as the rule for *when* a line breaks; a `h-10` cell so buttons stay centred on a line their neighbour may wrap under; one icon component with `size` and `spinning` props instead of the same SVG in two files.

**Shape of the chapter.** The lane grid's six rules against the one table, one by one:

| Lane-grid rule | The one table | Typed? |
|---|---|---|
| 56.1 the undeclared row (`--rows-mid`, `minmax(0,1fr)` per open lane) | there is no grid: the table is one `overflow-y-auto flex-col` scroller and every card is `shrink-0` (47 FIX 2). Measured at 1200×700: first card 243 px tall, scroller 392 client / 3539 scroll. | no — already true |
| 56.2 no span (`laneGrid`, `githubSpan`, `serversSpan` gone; GitHub's inner groups\|ungrouped split gone) | never had `laneGrid` or a span (36: *"no `laneGrid`, no `useMediaQuery`"*); the GitHub card has been one column since 33 (*"a fourth group with a collapsing header, not a third lane"*), so the lane grid's one deliberate visual loss (a GitHub lane narrowed to its column) never existed here. Measured: nine cards, every one 2480 px at 2560, GitHub body one column of 2477. | no — already true |
| 56.3 the command row mirrors the grid (project search over the fs lanes only; GitHub/servers boxes in the row when each has a column, else in their headings; sort · + Workspace · ↻ on the box's line, wrapping under it below 12 rem) | the project box is `flex-1` over the table (the one thing it searches); the GitHub box is `w-[clamp(200px,24%,400px)]` (36 FIX 3: the project box the wider one at every width); the servers' box lives in its card's heading since 48 — the rule's *else* clause, always. **The wrap rule was not true**: at 1200 px the project box was a 127 px slot. | **yes — the wrap rule (56.1 below)** |
| 56.4 three cards of one shape | GitHub and servers were born as cards here: `card` from `rowStyles.ts` with the heading as the first row and the hue on the two leading edges (43, 47). Measured: 12 px radius, `2px` top/left in the hue, `1px` right, on the workspace, GitHub and servers cards alike. | no — already true |
| 56.5 ↻ keeps the tree on screen | **real**: `ProjectTree` swapped every card for *Scanning workspaces…* on every refresh (`if (loading)`), and `useProjects` sets `loading` for the whole of a pass. | **yes (56.2 below)** |
| 56.6 the Mac's black screen on close (`HIDE_AFTER_FULLSCREEN`, `cfg(target_os = "macos")`) | Mac-only code that compiles to nothing on Windows. 55 was typed later on a Mac and carries this block (`✅WINDOW: full screen leaves before it hides`), proved in its 55.8. | no — typed with 55 |

`useMediaQuery`, `MID_QUERY`, `WIDE_QUERY`, `fsLanes`, `laneCount`, `lanesInRow` — none exist here and none are needed: a box that never moves between parents needs no query. Nothing from 55 was needed by 56 (checked against 56's diff), so the branch starts from `main` at 54 with no pulled-forward code.

---

## 56.1 — The box keeps its width; the controls go under it

The command row is `flex items-center gap-4`: the project cell (`flex-1`: box · sort · *+ Workspace ▾* · ↻), the GitHub box at its share, the GitHub rows' three controls, *+ Add server ▾*. Measured before typing, viewport emulated over CDP:

| width | project box | GitHub box | the row |
|---|---|---|---|
| 2560 | 1363 | 400 | one line, 40 px |
| 1890 | 693 | 400 | one line |
| 1200 | **127** | 276 | one line |

At 1200 the sort group (205), *+ Workspace* (111), ↻ (28) and three gaps took 376 of the cell's 506 px and left the box a 127 px slot — *Search local projects…* cut mid-word. That is the lane grid's 56.3 rule about the local cell, in a single table's terms: the box shares its line with the three controls and gives up width for them, and only when it would drop under **12 rem** do the controls go under it.

`App.tsx`, the row: `items-start` instead of `items-center` (the cells line up on their first line, not their middles — with `items-center` a wrapped project cell would push the GitHub box 23 px down). The project cell: `flex flex-wrap items-center gap-3`, the box `flex-1 min-w-[12rem]`, and the three controls in one `flex items-center gap-3 shrink-0` group — one group, so the break is the box on a line and the controls on the next, never sort beside the box with *+ Workspace* orphaned under it (wrapping them one by one does exactly that). ⛔ The GitHub box stays a **direct child of the row**: its `24%` is a share of the row, and the first cut put it inside a shrink-wrapped right-hand cell, where the percentage resolved against the cell and the box was 200 px at every width. The four buttons after it get the cell instead — `h-10 flex items-center gap-4 shrink-0`, `h-10` being a box's height, so they stay centred on the boxes' line when the project cell is two lines tall.

After:

| width | project cell | project box | controls | GitHub box | buttons cell | the row |
|---|---|---|---|---|---|---|
| 2560 | 1742 | 1363 | beside, 367 | 400 | 338 | one line, 40 px |
| 1890 | 1072 | 693 | beside, 367 | 400 | 338 | one line, 40 px |
| 1200 | 506 × 86 | **506** | under, at y 120 | 276, top 68 | 338, top 68 | two lines, 86 px |

Nothing moved at 2560 or 1890 (same numbers as before); at 1200 the box has the cell's whole width, the GitHub box's top is the project box's top, the buttons' centres are on the boxes' line (74–75 in a 68–108 line).

> `✅UI: controls wrap under a narrow box`

## 56.2 — ↻ keeps the rows on screen

> The report: *"refreshing workspace refreshes the whole window."*

`useProjects` sets `loading` at the top of every pass and clears it in `finally` — right for the first paint, and since 46 the cache paints first so a refresh always has a list on screen. `ProjectTree` did not know: `if (loading) return <Scanning workspaces…>` swapped the nine cards for one line on every ↻, for a scan that changes a row or two. Sampled every 80 ms through a click on ↻ (2560, 53 rows): **53 → 0 → 53**, *Scanning* on screen for two samples.

The glyph first. App's ↻ and `GithubControls`' `Refresh` were the same SVG in two files; `components/RefreshIcon.tsx` is the one (`RefreshIconProps { spinning?, size? }` in `types.d.ts`, `size` 15 on the row and 13 in the GitHub controls, `animate-spin` while `spinning`). `GithubControls` loses its private copy.

> `✅UI: one refresh glyph`

Then the guard: `if (loading && projects.length === 0)` — the spinner only while there is nothing to show — and the row's ↻ gets `spinning={loading}`, so the control that started the pass is the one that says it is running. The same sampler after: **53 rows in all 77 samples**, *Scanning* never, the glyph's `animation-name` `spin` for two samples (≈160 ms — the scan itself; the git badges that follow are not under `loading`, and the rows repaint in place as they land).

> `✅UI: refresh keeps the rows on screen`

## 56.3 — Verify

`cargo test` **186** (unchanged, no Rust in this chapter), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. Fourteen files backed up by hash; the installed DevGo stopped for the run. WSL running (not by us), left alone. Every number in 56.1 and 56.2 was read live over CDP (`Emulation.setDeviceMetricsOverride` at 2560×1360 / 1890×1000 / 1200×700, `getBoundingClientRect` on the row's children, an 80 ms `setInterval` in the page around the ↻ click), and the before-numbers on the previous commit's code with the same script.

**Already true, measured so it is not taken on faith.** At 2560: nine cards, widths `{2480}`; the scroller `display: flex`, `grid-template-columns: none`; every card `flex-shrink: 0`, `border-radius: 12px`, `2px` top and left in its hue (workspace `oklab(0.797 … / 0.5)` = accent/50, GitHub the same, servers `oklab(0.765 … / 0.5)` = emerald/50), `1px` right; the GitHub card 1235 px tall with a one-column body of 2477; the servers card 109. At 1200×700: first card still 243 px tall, scroller 392 client / 3539 scroll — the row above the GitHub card is not starved, it scrolls.

The dev build stopped (`Ctrl+Q` over CDP), all fourteen files restored and hash-matched (0 mismatches of 14, verified before the installed DevGo was relaunched), the installed DevGo running.

> `✅STAGE: 56 equal-lanes`; ff-merge; push.

---

## What you built

```
src/
  App.tsx                       the row items-start; the project cell wraps under 12rem; the buttons' h-10 cell
  components/RefreshIcon.tsx    one glyph, size + spinning
  components/GithubControls.tsx uses it
  components/ProjectTree.tsx    the spinner only with nothing to show
  types.d.ts                    RefreshIconProps
```

- **The command row's one real rule for a single table**: the box keeps 12 rem and the controls go under it; the GitHub box keeps its share of the *row*.
- **A refresh that refreshes rows, not the window**, with the glyph that started it spinning.
- **Four of the lane grid's six rules declared already true**, each with the element it maps to and a number read live — and the Mac's full-screen close typed with 55.
