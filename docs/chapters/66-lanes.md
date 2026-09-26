# 66 — Equal Lanes

**Branch:** `66.lanes` — `git checkout 66.lanes` gives you this chapter's finished app; `git diff 22d14a6 66.lanes` is exactly what this chapter adds (the branch sits on the brand commit that followed the Mac's 55 on `main`; see *Also since 65* and 66.10).

**Starting from:** chapter 65 — the `local` mark follows the disk.

**Goal:** the main area stops being one table. Every group DevGo lists — the WSL workspaces, the machine's own disk, GitHub, Servers — is an equal-width lane card in a CSS grid: four across from 1900 px, two rows of two from 1400, stacked below, each lane its own scroller under a sticky caps heading with its counts. The command row is the same grid, so every search box sits over the lane it searches. One column must never stretch across two columns' space — N lanes, N equal columns, nothing spans, and the page is symmetric.

> **Why the layout drifted.** A read-only audit of the UI (2026-09-16) traced it to chapter 30: the lanes arrived there without a line in the text, and every lane chapter after it — 31, 33, 35, 36, 37, 43, 47, 48, 50, 63 — was *adapted to the single table* with a stacked card per group, so the build read as an older UI beside the layout it was meant to have. The audit's A1 (the lane grid), A2 (sticky headings), A3 (name cell + right-anchored meta), A4 (per-lane scrollers), A5 (the command row), A7 (the header cursor), A8/A9 (GitHub and Servers as lanes) and A10 (the pinned strip) are this chapter; the eleventh, A6 (the footer), is chapter 67's. Every class-C fix the audit lists — this build's own — stays.

> **Hold on to:**
> 1. **A grid, and the row above it is the same grid.** `laneGrid(n)` is one function in `rowStyles.ts` and both the command row and the lanes call it, so the boxes cannot drift off their lanes: the same `gap-3 px-3`, the project cell `col-span-2` exactly where the two filesystem lanes are.
> 2. **A mounted input cannot be moved by CSS.** The GitHub and Servers boxes live in the command row on a wide window and in their lane headings on a narrow one; a `hidden` toggle would keep two inputs and lose the focused one. `useMediaQuery` decides which parent mounts it.
> 3. **Spell the grid rows out.** Four lanes between 1400 and 1899 px fold to two rows; an implicit `auto` row holding a scroller sizes itself to its content, and the row above collapses to its border. `--rows-mid` is `minmax(0,1fr) minmax(0,1fr)` while a second-row lane is open and `minmax(0,1fr) auto` when both are collapsed.

## Also since 65

`main` moved twice between 65 and this branch's first commit. The Mac's 55 (`79b5ead … e3ff98f ✅STAGE: 55 macos`, 32 commits) ff-merged — chapter 55's, listed there. Then one commit straight on `main` with no number — the *branch = it gets a chapter* rule: a subtle change goes on `main` and the next chapter lists it:

- `22d14a6 ✅BRAND: the app is DevGo, capitalised` — `src-tauri/tauri.conf.json`, two lines: `productName` and the window `title` go from `devgo` to `DevGo`, so the Mac bundle is `DevGo.app` and the Windows Start menu and installer say DevGo — the brand's own case, as the in-app title bar already had it. The binary inside stays `devgo`, the cargo name (67's brand commit renames that too).

---

## 66.0 — Fixtures name public repos

First commit on the branch, before any UI: the Rust test fixtures in `services/git.rs` and `services/github.rs` named a repository that is not public, which a public build has no business naming. They read `joyahmed/devgo` (the `repo_key` / `remote_to_url` / `clone_urls` asserts) and `joyahmed/notes` (the `gh repo list` sample's `isPrivate: true` row and the `local_matches` pairs) now; the asserts are otherwise unchanged and `cargo test` is still 196.

> `✅TEST: fixtures name public repos`

## 66.1 — The lane row styles and the grid

`components/rowStyles.ts` loses `col` (the four-column table grid) at the end of the chapter and gains the lane vocabulary (an excerpt: the comment over the two queries is elided, and `pickTone`, `fsTone` and `fsEdge` follow unchanged at the end):

```ts
// the class strings every lane row shares. they lived inside ProjectTree
// until a second kind of lane needed them; one place, so the github and
// server rows can never drift from the project rows on height, text size
// or the name's share

// no padding and no margin here: the indent lives inside the box, as
// left padding against the guide rule. no cursor either: the name is the
// click target on a row, headers add their own
export const row = 'select-none transition-colors';
export const rowInner = 'w-full flex items-center gap-4 text-15';
export const rowFlat = `${rowInner} px-4`;
export const rowIndented = `${rowInner} pl-10 pr-4 border-l`;

// 34% of a lane, not of the window: a lane is about half as wide, and a
// name that still gets a third of it leaves the meta within an eye
// movement instead of a screen away
export const nameCell =
	'font-medium font-mono truncate basis-[34%] min-w-[12rem] shrink-0';

// zebra on the rows under a heading, at /30 so it reads as a texture and
// not as stripes
export const zebra = (i: number) => (i % 2 ? 'bg-bg-secondary/30' : '');

// the sticky lane heading: the one label that replaces a per-row cell
export const laneHeader =
	'sticky top-0 z-10 bg-bg-secondary flex items-baseline gap-3 px-4 py-2 border-b border-border';

// …
export const WIDE_QUERY = '(min-width: 1900px)';
export const MID_QUERY = '(min-width: 1400px)';

const GRID: Record<number, string> = {
	1: 'grid grid-cols-1',
	2: 'grid grid-cols-1 min-[1400px]:grid-cols-2',
	3: 'grid grid-cols-1 min-[1400px]:grid-cols-3',
	4: 'grid grid-cols-1 min-[1400px]:grid-cols-2 min-[1900px]:grid-cols-4'
};

export const laneGrid = (columns: number) =>
	GRID[Math.min(columns, 4)] ?? '';

// a lane is a card on the surface recipe every drawer and menu uses, at
// half alpha so the transparency knob still shows through it. its hue
// goes on the two leading edges, the way a folder tab shows its colour.
// from 1400 the card is bounded by its grid row and scrolls inside;
// below that the lanes stack in one scroller. shrink-0: a card in a flex
// column shrank and clipped its rows instead of scrolling
export const card =
	'shrink-0 min-w-0 min-[1400px]:min-h-0 flex flex-col rounded-panel border border-border border-t-2 border-l-2 bg-bg-secondary/50 overflow-hidden';

// the card's body: its own scroller from 1400, the window's below
export const laneBody =
	'min-[1400px]:flex-1 min-[1400px]:min-h-0 min-[1400px]:overflow-y-auto';

// …
```

`card` keeps 47's `shrink-0` (a card in a flex column shrank and clipped its rows) and gains `min-w-0 min-[1400px]:min-h-0 flex flex-col` so a grid row can bound it. The indent lives inside the box as left padding against the guide rule — no margin, since `ml-6` on a box that is also `mx-auto` silently wins. `rowIndented` carries `border-l` and no colour: the caller says `border-l-border` (a row under its heading) or `border-l-accent/60` (a pinned row).

> `✅UI: lane row styles and grid` (and, once nothing reads it, `✅UI: the table grid goes`; the colour split is `✅UI: the row rule colour is the caller's`)

## 66.2 — `useMediaQuery`

`hooks/useMediaQuery.ts`, nineteen lines: `matchMedia(query).matches` in state, a `change` listener in an effect. No `useCallback`; the compiler is on.

> `✅HOOKS: media query hook`

## 66.3 — Types

`types.d.ts`: `NavRow` gains `{ kind: 'ws'; ws: string }` — a workspace header is a keyboard row now. `GithubLaneProps` gains `onAddMenu?`, `searchInHeading?`, `searchRef?`, `onArrow?`, `onEnter?`; `GithubControlsProps` gains `labelled?`; `ServersLaneProps` gains `searchInHeading?`; `RepoRowProps` swaps `nested` for `login` (the owner prefix only when it is not the user) and `i` (the zebra); `ServerRowProps` gains `i`; `ProjectRowProps` gains `i?` and `pinned?`; `ProjectTreeProps` gains `localFs?`, `onGithubAddMenu?`, `githubSearchRef?`, `githubSearchInHeading?`, `serversSearchInHeading?`. New: `LaneHeadingProps`, `WorkspaceLaneProps`, `WorkspaceHeaderProps`.

> `✅TYPES: lane props and the header row`

## 66.4 — The controls in two forms, and the heading

`GithubControls` takes `labelled`: the row form is `+ Add repo ▾` as a button in the `+ Workspace` shape with a `w-7 h-7` refresh (67 grows it to `w-9 h-9`); the heading form keeps the bare glyphs (`-my-1.5`), a heading being a line of text. One component in two places, so the row and the heading can never offer different controls.

`components/LaneHeading.tsx` is the sticky heading every card wears — the caps label in the lane's hue, the count line, `flex-1`, then whatever the lane puts at the right end; a collapsing lane passes `open`/`onToggle` and gets the arrow first and the click on the whole line:

```tsx
const LaneHeading = ({
	label,
	tone,
	line,
	open,
	onToggle,
	children
}: LaneHeadingProps) => (
	<div
		className={`${laneHeader} shrink-0 ${onToggle ? 'cursor-pointer hover:bg-bg-hover/30' : ''}`}
		onClick={onToggle}
		title={onToggle ? (open ? 'Collapse' : 'Expand') : undefined}
	>
		{/* leading-none: the glyph's line box is taller than the label's,
		    and without it the heading sat 6px under its neighbours */}
		{onToggle && (
			<span
				className={`text-13 leading-none shrink-0 ${open ? 'text-accent' : 'text-text-muted'}`}
			>
				{open ? '▼' : '▶'}
			</span>
		)}
		<span className={`text-11 font-bold uppercase tracking-wider ${tone}`}>
			{label}
		</span>
		<span className='text-11 text-text-muted truncate'>{line}</span>
		<span className='flex-1' />
		{children}
	</div>
);
```

> `✅UI: github controls in two forms` · `✅UI: lane heading`

## 66.5 — The GitHub lane card

`GithubLane.tsx` is a `card` with the accent on its edges, a `LaneHeading` (`GITHUB · 382 repos · updated 1 h ago`, the login in mono, then — only when `searchInHeading` — the box in a `searchBoxHeadingSlot` wrapper that stops the click from toggling the lane, and the glyph controls), and the body: the 0fr→1fr collapse the workspace groups use, with `laneBody` inside so the rows scroll under the heading from 1400 px. Rows are `rowIndented border-l-border`: the name grows (`flex-1`, not `nameCell` — a repo's meta is three short things, and a fixed share cut long names off), `owner/` only when the owner is not the user, then the meta cluster. Group headings are `rowFlat` with the count in a `w-8` cell; the divider over every group but the first stays by index (C13). The flat search view is one list — an earlier two-column layout put its two halves side by side, which made sense across two grid columns and not in one lane.

> `✅UI: github lane card`

## 66.6 — The Servers lane card

`ServersLane.tsx`, the same card in emerald: `SERVERS · 2 machines`, the box and `+ Add` in the heading only when `searchInHeading`. A server row is expander · dot · name (alias) · `user@host :port tunnel tmux ↻` right-anchored; a root heading `▼ /var/www … 5` at `pl-10`; folders indented `64 + depth × 16` px with the app's domain, dot and ports after the name; the *show all* row under `/etc`. The hook's `visible` still drives both the rows and the keyboard (C1): nothing here filters on its own.

> `✅UI: servers lane card`

## 66.7 — The tree: lanes, and a header the keyboard can land on

`ProjectTree.tsx`. The table's `COLUMNS` header and the four-cell rows go. Three in-file components:

- **`ProjectRow`** — `row group py-1.5`, `rowIndented`, the `nameCell` as the click target, `RowMeta` right-anchored; a pinned row adds its workspace name and `FsCell` as a suffix after the name (it floats above the lanes, so it has to say where it lives); `zebra(i)` under a heading, `stale → opacity-60` (C: M12) and `quiet` while another cursor is lit (C2).
- **`WorkspaceHeader`** — one flex line: `▼ name [state pill] path (Network ⚠ only) count`, the path in `text-text-primary` (the muted path was too dim to read), `data-ws-header` for the drop target, `bg-bg-selected/50` when it is the keyboard cursor.
- **`WorkspaceLane`** — the card, `LaneHeading` with `N workspaces · M projects`, `laneBody` around its workspaces.

Workspaces split into two lanes by `laneOf(fs)` — `'WSL'`, else `'local'` (a share is a local path with a warning: it keeps its `⚠` cell and sits on the local side). The local lane's label is what the machine calls its disk: `localFs` from `runtime.local_fs` (64), `Windows` until the first answer; its hue and edges come from `fsTone`/`fsEdge` of that name. `laneOrder = [...lanes.WSL, ...lanes.local]` is the order the eye reads and the keyboard walks.

`rows` now carries `{ kind: 'ws', ws }` before each workspace's projects, so a collapsed workspace is reachable by arrow; `wsCursor` sits beside the three cursors of 63 and `clearCursors()` drops all four. `navigate` lands on the first *project* (or the first header when every workspace is collapsed) from nothing, and `LANE_KINDS.projects` includes `'ws'`. The keys on a header: `→` opens a collapsed one and steps into an open one, `←` collapses, `Enter` toggles; on a project `←` collapses its workspace *and moves the cursor to the header*, the way a file tree steps out. `Alt+↑/↓` — `nudge` — moves the workspace among its lane's siblings and puts the cursor on it; the drag's `dropTargetAt` refuses a header from the other lane (a WSL path in the local lane is a category error). `cursorLit` counts the header.

The layout: one `grid(children, empty)` helper wraps the pinned strip (full-bleed, `Pinned` label, rows with the accent rule, a hairline under) above the lane grid — `${laneGrid(columns)} gap-3 px-3 pb-3 min-[1400px]:flex-1 min-[1400px]:min-h-0 min-[1400px]:[grid-template-rows:var(--rows-mid)] min-[1900px]:[grid-template-rows:minmax(0,1fr)]` with `--rows-mid` from `columns >= 4` and whether GitHub or Servers is open — inside a scroller that is `overflow-y-auto` below 1400 and `overflow-hidden` from it. `columns` is the filesystem lanes present plus GitHub plus Servers. The *no project matches* line renders above the GitHub and Servers lanes in the same grid (the audit's M14, kept: both lanes still have an answer).

> `✅UI: equal lanes with a header cursor`

## 66.8 — The command row is the lanes' grid

`App.tsx`: `wide`/`mid` from `useMediaQuery`; `fsLanes` counts the filesystem lanes the projects need (one on a Mac); `laneCount` adds GitHub and Servers; `lanesInRow = wide || (mid && laneCount <= 3)`; the GitHub and Servers boxes are in the row only then (`githubSearchInRow`, `serversSearchInRow`), else in their headings — the tree gets `githubSearchInHeading: !githubSearchInRow` and the same for servers, plus `localFs`, `onGithubAddMenu`, `githubSearchRef`.

The row is `w-full shrink-0 ${laneGrid(laneCount)} gap-3 px-3 items-start`; the project cell `flex flex-wrap items-center gap-3 min-w-0` with `min-[1400px]:col-span-2` when there are two filesystem lanes and at least three lanes (56.3's wrap of the three controls under the box stays); the GitHub cell is the box `flex-1 min-w-0` plus `GithubControls labelled`; the Servers cell its box plus `+ Add server ▾`. The main container drops `px-6 py-5 gap-4` for `pt-5 gap-3`: the lanes and the row carry their own `px-3`, and a pinned row's ground reaches both edges. `handleServersArrow`/`handleServersEnter` are the servers box's twins of the GitHub ones. The workspace menu's *Move up / down* and the palette's walk the lane's siblings (`wsLane` by the `//wsl` prefix, `laneSiblings`), not the store's flat list.

> `✅APP: the command row is the lanes grid`

## 66.9 — A Windows build fix on the way

The Mac's 55 ff-merged into `main` while this branch was open (see 66.10) and its editors reconcile dropped `WT_ARGS` from `editors.rs`'s imports: `cargo check` failed on Windows at `Candidate { args: WT_ARGS }`. One line — `args: crate::models::target::WT_ARGS` like the `run_args` beside it — and the dev build compiled.

> `✅FIX: the wt row finds its args on windows`

## 66.10 — Verify

`cargo test` **202** on Windows (196 + the six of 55's Mac tests that compile everywhere; 62's probe ignored), `cargo check` 0 warnings on both feature sets, `tsc -b` and `bun run build` clean. Shared `main` moved twice under the branch — `e3ff98f ✅STAGE: 55 macos` and `22d14a6 ✅BRAND: the app is DevGo, capitalised` — and the branch was rebased onto each and re-gated before the ff-merge. One dev launch over CDP on 9223 at `Emulation.setDeviceMetricsOverride`; the fourteen app-data files backed up by hash first, the installed DevGo stopped, WSL running (not by us) and left alone.

- **2560 × 1400:** one row of **4** lanes, `WSL` (4 workspaces · 28 projects), `Windows` (3 · 25), `GitHub` (382 repos), `Servers` (2 machines), each **625.00 px** wide at `left` 12 / 649 / 1286 / 1923; every heading `position: sticky`; the tall lanes scroll alone — GitHub `scrollHeight 1244 > clientHeight 1183`, Servers `2133 > 1184`; `scrollTop = 500` on the Servers body leaves the other three at 0 and the outer scroller at 0. The command row's boxes at `left` **12 / 1286 / 1923** — the pixel their lanes start on.
- **1890 × 1000:** **2 × 2**, each lane **927 px**, rows `404px 404px`; the GitHub box moved into its heading (`w 320`), the Servers box into its (`w 280`), `+ Add` beside it. Both second-row lanes collapsed → rows `769px 39px` (the `auto` row), both open again → `404 404`.
- **1400 × 1000:** **2 × 2** at **682 px** each, same moves. **1200** and **900:** stacked, one lane per row, **1168** / **868 px** wide, the outer scroller doing the scrolling (`overflow-y: visible` on the bodies), the WSL heading sticky in it.
- **The header cursor, driven by keys** (after `location.reload()`, the 58 rule): click `shop` → `←` collapses `01_turbo` and lights its header (`01_turbo:cursor▶`, the selection dimmed to `/40`) → `↓` lands on `02_next`'s header (`01_turbo` stays `▶`) → `↑` back → `→` opens it (`▼`) → `Enter` closes, `Enter` opens → `→` steps to `shop`, cursor off, selection bright again. `Alt+↓` on `01_turbo` put it after `02_next` in the WSL lane with the Windows lane untouched; `Alt+↑` restored the order.
- **The lane boxes' arrows:** focus the Servers box, `↓` → `lanbox` lit in the Servers lane; the GitHub box, `↓` → `devgo` lit in the GitHub lane. **Pinned strip:** `Ctrl+S` on a row → the strip above the grid with `shop · 01_turbo · WSL · badges · ★`; `Ctrl+S` again → gone.
- Screenshots at every width read as the lanes of the daily build: four equal cards, caps headings, the boxes over their lanes, the Servers box in the row at 2560 and in the heading at 1890.

The dev build stopped, `sha256sum -c`: **14 OK, 0 mismatches** (the run had changed `instance.lock`, `prefs.json` and `projects-cache.json`); the installed DevGo relaunched through `explorer.exe`.

> `✅STAGE: 66 lanes`; ff-merge; push. 13 commits + STAGE (1 test, 1 Rust fix, 11 React).

---

## What you built

```
src-tauri/src/services/git.rs, github.rs   fixtures name public repos
src-tauri/src/services/editors.rs          WT_ARGS on Windows again
src/components/rowStyles.ts                row, rowFlat, rowIndented, nameCell, zebra, laneHeader,
                                           WIDE_QUERY, MID_QUERY, laneGrid, card, laneBody; col gone
src/hooks/useMediaQuery.ts                 which parent mounts a box
src/types.d.ts                             the ws row, the lane props
src/components/GithubControls.tsx          labelled: the row form
src/components/LaneHeading.tsx             the sticky caps heading
src/components/GithubLane.tsx              a card with its box in the heading when the row has no column
src/components/ServersLane.tsx             the same in emerald
src/components/ProjectTree.tsx             two filesystem lanes, the header cursor, the pinned strip, the grid
src/App.tsx                                the command row on laneGrid; moves within the lane
```

- **Four equal lanes** that fold to two rows and then stack, each scrolling alone under a heading that says what it is and how much it holds.
- **Every box over its lane** — project search across the filesystem lanes, GitHub and Servers over theirs, and back into the heading when the row has no column for them.
- **A workspace header the keyboard can reach**: collapse from a project, walk the headers, open one, move it among its siblings — without a fake selection.
