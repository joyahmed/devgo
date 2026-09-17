# 43 — Cards, Not Rails (post-plan)

**Branch:** `43.lane-cards` — `git checkout 43.lane-cards` gives you this chapter's finished app; `git diff 42.neon 43.lane-cards` is exactly what this chapter adds.

**Starting from:** chapter 42 — Neon is neon. The list is one table, and its groups are separated by lines: since chapter 37 a 2 px rail per *group* in the file system's hue, since chapter 41 a short gradient divider between groups, and a `border-strong` rail on the GitHub group — three weights of line, all running up into the row above them.

**Goal:** **each group is a card**, on the surface recipe every drawer and menu already uses. And the four small things that showed up while the lines were being reweighed.

> **Hold on to:**
> 1. **A group is a surface, not a column between lines.** One recipe (`card` in `rowStyles.ts`), the hue on its two leading edges, and the gap between cards is the divider — a line ran into the header above it; a card closes on its own.
> 2. **Lines are the problem, not their weight.** The first two asks below were fixes for the lines; the third was the realisation.
> 3. **A dot is a box, not a glyph.** A character sits on the baseline and lands a pixel off the text's centre; a 7 px box is centred by flex.
>
> TypeScript only. `border` + `border-t-2 border-l-2` + a per-side colour map (`EDGE`); `bg-bg-secondary/50` so chapter 41's knob still shows through a card.

> The asks, in order: *the horizontal dividers between the columns mismatch* → *the WSL and Windows separator should be like the GitHub-groups and recent-projects one* → *or make cards instead of the middle separator — it looks bad on top, where the WSL, Windows and GitHub titles sit.*

---

## 43.1 — The card

```ts
export const card =
	'rounded-panel border border-border border-t-2 border-l-2 bg-bg-secondary/50 overflow-hidden';
```

`bg-secondary`, `border`, `radius-panel` — the recipe from chapter 38, at half alpha. Shared by both files from `rowStyles.ts`. The scroller becomes `flex flex-col gap-3 px-3 py-3`; every workspace wrapper is `${card} ${EDGE[fs]}` — `EDGE` replaces `RAIL`: `border-t-accent/50 border-l-accent/50` for WSL, amber for Network, `text-muted/40` for Windows, the same hues `FsCell` uses (no new pair for the edges). The rows' block loses its `border-l-2` and keeps `ml-6`. The pinned strip is a card too, with the accent edge, and its hairline underneath goes. **Chapter 41's gradient divider between workspaces goes with it** — it would earn its place only if several workspaces shared one card; here every workspace is its own card and there is nothing left to divide. It lasted one chapter, and it moves (43.3).

> `✅UI: workspace groups are cards`

## 43.2 — The GitHub group is a card

`GithubLane`'s root: `${card} border-t-accent/50 border-l-accent/50` — the accent, since GitHub rows have no file system hue; its `border-strong` rail goes. Two cards (*groups* | *ungrouped*) with the heading above them on the window ground was the other option; the one collapsing header stays as the card's first row — it is a group in the table like the others, and the 0fr → 1fr collapse now happens inside the card.

> `✅UI: the github group is a card`

## 43.3 — The divider moves to the GitHub groups

GitHub groups get a horizontal separator too — chapter 41's rule verbatim, in the accent, by index: `shown.map((section, i) => …)`, the section wrapper `i ? 'mt-2 pt-1' : ''`, and over every section but the first a `h-px ml-4 mb-1 w-[38%] bg-linear-to-r from-accent/70 to-transparent`. GitHub groups stack inside one card, which is exactly where a line is needed. The group heading's name steps to `text-13` like a workspace header's: it is the same kind of thing, one step under the rows.

> `✅UI: divider between github groups`

## 43.4 — Dots are dots

`●` (dirty tree) and `○` (dependencies not installed) become `size-[7px] rounded-full` spans — `bg-amber-400` filled, `border border-text-muted` hollow — with the `title` kept and no text content.

> `✅UI: dots are dots` — `bun run build` clean.

## 43.5 — Verify

`tsc -b` and `bun run build` clean; Rust untouched (152). Back up the six files. Headless over CDP at 2560 × 1392, seven workspaces and two GitHub groups.

**Cards.** The scroller is `flex column`, `gap 12px`, `padding 12px`; **eight** children — seven workspace cards and the GitHub card (no pinned rows on this machine) — each `border-radius 12px`, widths `2/1/1/2` (top/right/bottom/left), `overflow hidden`, ground `oklab(… / 0.5)`; the top and left edges are the accent at 0.5 on the five WSL groups and `text-muted` at 0.4 on the two Windows groups, the right edge the plain `border`. Zero `border-l-2` rails left in the scroller, zero chapter-41 dividers under workspace headers. **GitHub.** Edges accent / 0.5, `2px/2px/1px`; headings *GitHub* 15 px, *WORK · SERVERS · Not in a group* **13 px**; two dividers, each `935 / 2461 px` (38 %), `linear-gradient(to right, <accent> …)`. **Dots.** Six on screen after the badge pass (two dirty, four without deps): `7 × 7`, fully round, filled `oklch(0.828 0.189 84.429)` (amber-400) or a 1 px `text-muted` border on a transparent fill, no text content, and each dot's centre equals its row's centre and its branch chip's centre to the decimal (`654.8 / 654.8 / 654.8`).

`Ctrl+Q`, restore the six files (all matched), the installed DevGo restarted.

> `✅STAGE: 43 lane-cards`; ff-merge; push.

---

## What you built

```
src/
  components/rowStyles.ts     card
  components/ProjectTree.tsx  EDGE replaces RAIL and DIVIDER; the scroller is a column of cards; pinned is a card; drawn dots
  components/GithubLane.tsx   the card with the accent edge; the divider between groups; headings at 13
```

Eight cards, one recipe. The hue is an edge, not a rail. Dots that are dots.

> **The thread running through this chapter.** One table became a column of cards, one per group. One recipe, one reason — a surface closes itself, a line has to be stopped by something — and the divider that had nothing left to separate moved to the one place where things still stack.
