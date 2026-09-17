# 36 — One Strip Fewer, Two Boxes (post-plan)

**Branch:** `36.ui-chrome` — `git checkout 36.ui-chrome` gives you this chapter's finished app; `git diff 35.github-groups 36.ui-chrome` is exactly what this chapter adds.

**Starting from:** chapter 35 — one table with the GitHub rows as a fourth group under the workspaces, one search box feeding all of it, a launch row above a footer that held only the palette's door, and a title bar carrying a tagline, a `WINDOWS` chip that said nothing, and two list controls.

**Goal:** the footer *is* the action bar; a command row over the table where the project box spans what it searches and the GitHub rows get a box of their own; and, behind a switch that is off until you turn it on, that second box also asks all of GitHub as you type.

> **Hold on to:**
> 1. **The buttons are the hints.** Two strips said one thing; one strip says it, pinned where muscle memory aims.
> 2. **Two boxes, one component, one keyboard.** `SearchBox` twice, each over its own rows; the arrows from the GitHub box walk the GitHub rows alone; `Ctrl+G` is one more row in the shortcut table.
> 3. **Three gates and a switch.** A keystroke becomes a network call only when the query has three characters, has been still for 400 ms, `gh` is logged in — and the switch is on. `generation` stamps each request so a late answer is dropped; *searching* is derived, not stored.
>
> Rust: `#[serde(default)]` on two spellings of one field, `Option::or` to take whichever came, `--` before a positional so a query is never a flag, the second `async` command with `spawn_blocking`. TypeScript: the same component mounted twice with a `lane` prop; a `useRef` counter as a generation stamp; a boolean derived from two states instead of a flag set in an effect.

> Three decisions meet here. The launch buttons belong on the footer, where the hand already aims. Projects and GitHub each get a search box of their own, because one box over two kinds of row answers neither well. And the project box should span what it searches, with the GitHub box level with it — the app has one table, so that is one row: the project box spanning it, the GitHub box level with it at a fixed share.

---

## 36.1 — All of GitHub, in Rust first

`services/github.rs`. `Repo` gains one field, under `#[serde(default)]` so every cached row reads as `None`:

```rust
    /// only a live search hit carries this, the one field that helps
    /// rank strangers' repositories. None for the user's own list
    #[serde(default)]
    pub stars: Option<u64>,
```

`gh search repos --json` does not print the fields `gh repo list` prints — probed before typing: there is no `defaultBranchRef`, the branch is a flat `defaultBranch` string, and `stargazersCount` is there. So `GhRepo` carries both spellings, both optional, and the row takes whichever came:

```rust
    #[serde(default)]
    default_branch_ref: Option<GhRef>,
    #[serde(default)]
    default_branch: Option<String>,
    #[serde(default)]
    stargazers_count: Option<u64>,
…
            default_branch: r
                .default_branch_ref
                .map(|b| b.name)
                .or(r.default_branch),
            added: false,
            stars: r.stargazers_count,
```

`search(query)` is `gh search repos --json <SEARCH_FIELDS> -L 30 -- <q>` through the same `gh()` and `parse_repos()` as the list — thirty hits is a screen, and the box is the way to narrow. **No `--sort updated`**: with it, the top hit for `tauri` is whichever stranger's repository was pushed a minute ago; GitHub's own best-match order is what a person typing a name means. The query goes after `--`, so one that starts with a dash is a query and not a flag (probed: `-- -tauri` searches, `-tauri` alone would not). An empty query returns an empty list without running anything. One test: a search hit parses with `stars: Some(95000)` and `default_branch: Some("dev")` from the flat spelling, and a listed row still parses with `stars: None`.

> `✅GITHUB: search all of github` — **149** tests.

`Preferences.github_live_search: bool` under `#[serde(default)]` — **off by default, never inherited by an upgrade** — with `github_live_search()` / `set_github_live_search()`.

> `✅PREFS: live search switch`

`GithubPayload` grows `live_search`, read under the same prefs lock as the orgs; `set_github_live_search(on)`; and the second `async` command of the book, in the shape of chapter 34's `add_github_repo`:

```rust
#[derive(Serialize)]
pub struct SearchAnswer {
    pub generation: u64,
    pub repos: Vec<github::Repo>,
}

/// Search all of GitHub for query. Off the main thread, like
/// add_github_repo; the debounce, the length floor and the switch are
/// the frontend's. This command only answers what it is asked.
#[tauri::command]
pub async fn search_github(
    query: String,
    generation: u64,
) -> Result<SearchAnswer, AppError> {
    let repos =
        tauri::async_runtime::spawn_blocking(move || github::search(&query))
            .await
            .map_err(|e| AppError::Lock(e.to_string()))??;
    Ok(SearchAnswer { generation, repos })
}
```

The debounce, the length floor and the switch are the frontend's; this command only answers what it is asked, and hands the generation back so the caller can tell a late answer from a current one. Both registered in `lib.rs`.

> `✅CMD: search_github behind the switch`

## 36.2 — The footer is the action bar

`ActionButtons.tsx` is gone. Its `TargetGroup` — every target of a kind, visible, the default carrying its key, disabled in tokens — moved into `StatusBar.tsx` verbatim. The footer is `h-12` now instead of `h-10`, so the buttons are the ones from the launch row at their own size: the two groups, *Open Both*, *Manage…* on the left; the palette's door on the right. The footer never had hint chips (chapter 25 skipped them), so there is nothing to delete — the buttons were always the hints, they were just forty pixels too high. `overflow-hidden` on the bar rather than the row's `flex-wrap`: a bar that grows a second line moves the table.

⚠️ Pinned to the bottom, and a bar rather than a floating group: you aim at these from muscle memory while your eyes are still on the list, and expanding a workspace must not move the one you are about to click. `StatusBarProps` takes over `ActionButtonsProps`, which is deleted.

> `✅UI: footer is the action bar`

## 36.3 — A command row over the table

`useProjects` gains `setSort(mode)` beside `toggleSort` — the segmented control picks a mode outright; the palette still cycles.

> `✅HOOK: set sort outright`

`SearchBox` is the input and nothing else. The `SEARCH PROJECTS` eyebrow and the 10 px `sort:` button are gone: the placeholder names the scope (`Search local projects…`), `lane: 'projects' | 'github'` decides which box takes focus on mount and marks the input with `data-lane-search`, and `className` lets the row size it. The ↑ ↓ ⏎ forwarding from chapter 11 stays exactly as it was. `SearchBoxProps` loses `sortMode` / `onToggleSort`, gains `placeholder`, `lane`, `className`; `SearchLane` in `types.d.ts`.

**The row.** There is one table under the row, so there is no lane for the GitHub box to sit over and nothing for it to drop under at a narrower width — no grid, no breakpoints. The row is a flex row: the project box first (`flex-1`), then the sort control, then `+ Workspace ▾` and ↻, and the GitHub box (36.4) level with it at the end. The 1100 px cap the box had since chapter 25 is gone — *a heading spans what it heads*, and this one heads the whole table. No `useMediaQuery`: a box that is always in the row never needs to move.

**The sort control** is three `Button variant='target'` with `aria-current` on the chosen one — *Frecency · Activity · A–Z* — the same reuse chapter 26's tmux panel made for its on/off pair. `SORT_MODES` is a module-level table in the palette's cycle order.

**`+ Workspace ▾` and ↻ came down from the title bar.** They are list controls, and this is the list's own row; the `+` gained its word on the way (a bare `+` in a title bar means "new tab" to everyone who has used a browser). The title bar keeps the mark, the name, the WSL chip, the gear.

> `✅UI: command row over the table`

**The `WINDOWS` chip is gone, with its whole chain.** `RuntimeIndicator.tsx`, `useRuntime.ts`, `RuntimeIndicatorProps` and the TypeScript `RuntimeInfo` are deleted — it said nothing a Windows user did not know and existed so the WSL chip had a sibling. The WSL chip stays in the title bar rather than moving into a row, because it must work when the table shows no WSL workspace — a wedged distro is exactly the moment the rows may be missing. The tagline under the name goes too: a title bar is not a place for a subtitle.

> `✅UI: windows chip retired`

With the chip gone, `get_runtime_info` has no caller. A chapter contains what the chapter uses, so the command and its `lib.rs` line go; the `RuntimeInfo` struct behind it stays — every launch reads it.

> `✅CMD: drop get_runtime_info`

## 36.4 — Two boxes, one component, one keyboard

`useGithub(git)` — the `query` parameter is gone; the hook owns `query` / `setQuery` itself and hands them out on `GithubState`. `GithubLane` reads `github.query` instead of a prop; `ProjectTree` stops passing one. The project query never reaches the GitHub rows again.

> `✅HOOK: github owns its query`

The second box: `SearchBox` again in the row with `lane: 'github'`, `placeholder: 'Search GitHub repos…'`, its own ref, and two handlers. `ProjectTree.navigate(dir, lane = 'projects')` narrows the walk:

```ts
	const navigate = (dir: 1 | -1, lane: SearchLane = 'projects') => {
		const walk = lane === 'github' ? rows.filter(r => r.kind === 'repo') : rows;
		…
```

From the GitHub box the arrows walk the GitHub rows and nothing else, the way the project box's arrows have always started at the projects; the cursor is the same `repoCursor`. Enter in the GitHub box opens the row under the cursor, or the first match when there is none yet — the same rule the project box has for launching. Escape clears it. The box forwards its keys explicitly (chapter 11), so the lane is an argument, not something `navigate` reads off `document.activeElement`.

> `✅UI: github box in the row`

`Ctrl+G` → `focusGithubSearch`, one row in `SHORTCUTS` and one id in the union, fired next to `focusSearch` in App's handler: `githubSearchRef.current?.select()`.

> `✅UI: ctrl+g focuses the github box`

## 36.5 — All of GitHub, as you type, behind a switch

```ts
const LIVE_DEBOUNCE_MS = 400;
const LIVE_MIN_CHARS = 3;
```

In the hook, after `sections`:

```ts
	// the cache's matches for the query: instant, no network
	const cacheMatches = sections
		? null
		: visibleRepos(payload?.cache.repos ?? [], query);

	// live hits from all of github for the same query, when the switch is
	// on. generation stamps each request and an answer to an older one is
	// dropped, so a fast typist never sees results for a query they left
	const [live, setLive] = useState<{ query: string; repos: GithubRepo[] }>({
		query: '',
		repos: []
	});
	const generation = useRef(0);
	const liveOn = Boolean(payload?.live_search);
	const q = query.trim();
	const liveEligible =
		liveOn && isOpen && q.length >= LIVE_MIN_CHARS && Boolean(status?.login);
	// searching is not state: it is eligible and not yet answered, which
	// falls out of the query and the last answer with no flag to clear
	const searching = liveEligible && live.query !== q;
	useEffect(() => {
		if (!searching) return;
		const gen = ++generation.current;
		const timer = window.setTimeout(() => {
			invoke<SearchAnswer>('search_github', { query: q, generation: gen })
				.then(answer => {
					if (answer.generation !== generation.current) return;
					setLive({ query: q, repos: answer.repos });
				})
				.catch(() => {
					// searching stays on for this query; the next keystroke retries
				});
		}, LIVE_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [q, searching]);
```

⛔ This is the one place a keystroke becomes a network call, which is why it is gated three ways and opted into. The effect keys on `searching`, so a query you come back to — the answer is still in `live` — costs nothing. `generation` stamps each request; an answer to an older generation is dropped, so a fast typist never sees results for a query they left. **`searching` is not state** — it is *eligible and not yet answered*, derived from the query and the last answer, which keeps the compiler's rule about `setState` in effects satisfied with no flag to forget to clear. `liveExtras` is the live rows the cache did not already answer with, for the current query only; `visible` becomes `[...cacheMatches, ...liveExtras]` in the flat view. `setLiveSearch(on)` saves and reloads the payload. `GithubState` grows `cacheMatches`, `liveExtras`, `searching`, `liveOn`, `setLiveSearch`; `GithubRepo.stars`, `GithubPayload.live_search`, `SearchAnswer` in `types.d.ts`; `goneRow` gains `stars: null`.

> `✅HOOK: live search behind three gates`

**The lane.** Two labelled sections while a live search is in play — *Your repos & bookmarks* over the cache's matches, *More from GitHub — N* (or *Searching GitHub…*) over the rest — so a stranger's hit never reads as one of yours; with the switch off there is one list and no label. The flat view is a two-entry table (`key`, `label`, `show`, `rows`) mapped once. A hit's ★ count sits in the meta cell after the branch, through `compactCount` in `github.ts` (`8078 → 8.1k`, `95000 → 95k`). *No repository matches* waits until the search has answered.

> `✅UI: live hits under their own label`

**Settings › GitHub › Search all of GitHub as you type**: the paragraph says what it costs and why it is off, and an *On / Off* pair in the `target` variant with `aria-current`, disabled until the payload has loaded.

> `✅UI: live search switch in settings`

## 36.6 — Two small things

- **A *recents* switch** in the GitHub header. Once the repos you care about are in groups, the twenty-newest tail under them is noise; `devgo.githubRecents` remembers. The hook's `hidden(section)` treats a hidden tail like a folded group — its rows leave `visible`, so the keyboard skips them — and the lane filters its `shown` sections and drops the footer line. A word that reads as a state, accent for on and muted for off, like the *local* mark.

> `✅UI: recents switch on the github header`

- **The inactive selection goes quiet.** Two cursors can be lit at once — the project you selected and the GitHub row you then arrowed to — and Enter acts on the second. `ProjectRowProps.quiet` drops the first to `bg-bg-selected/40` with a half-strength rail while the second is lit, so the strong blue is always the row Enter will act on. Chapter 33 kept both lit.

> `✅UI: selection goes quiet under a repo cursor` — `bun run build` clean.

**Three fixes, found live.**

- Turning the switch off with an answered query in the box left the live rows and their labels on screen — `liveExtras` never asked whether the switch was on. It does now.
- Clearing the GitHub box leaves `repoCursor` pointing at a row that is no longer in the list, and the selection stayed dim with nothing lit beside it. `quiet` is now *the cursor row is on screen*, derived from `rows`.
- At 1000 px the GitHub box was wider than the project box: a 2:1 flex split hands the left cell two thirds, but the sort control and the two buttons live in that cell and take theirs first. The GitHub box takes a fixed share instead — `w-[clamp(200px,24%,400px)]` — and the project box gets everything else, so it is the wider one at every width (257 vs 201 px at 900; 1718 vs 400 at 2560).

> `✅FIX: live rows leave with the switch` · `✅FIX: selection dims only while the cursor row is on screen` · `✅FIX: github box a fixed share so the project box stays wider`

## 36.7 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **149** — chapter 35's 148 plus the search-hit test. Back up the six files. Nothing here opens a browser: Enter in the GitHub box ends in a URL launch and is not pressed; the arrows and `openRepo()` are what it proves.

**First paint, 2560 px.** The title bar is the mark, the name, the WSL chip (`WSL · STOPPED`) and the gear — no tagline, no `WINDOWS` chip, no `+`, no ↻. The footer is 48 px: `EDIT VS Code Ctrl+⏎ · TERMINAL Windows Terminal Shift+⏎ · Open Both Alt+⏎ · Manage… · Ctrl+Shift+P Commands`, the launch buttons disabled until a row is selected. The row: the project box `Search local projects…` (24–1742 px, focused), *Frecency · Activity · A–Z*, `+ Workspace ▾`, ↻, then `Search GitHub repos…` (2120–2520). The GitHub header carries *recents* in the accent, `+`, ↻; `FREQUENT 8 · SERVER 1 · Not in a group 373` — 29 rows.

**One keyboard.** `↓` selects the first project (lit). `Ctrl+G` puts the caret in the GitHub box; `shop` → 61 flat rows, no headings and no *recents* (search is flat); `↓ ↓` → the cursor on the second repo row, `shop-admin`, and the selected project drops to `bg-bg-selected/40`. `Escape` clears the box and the selection is lit again — the cursor's row has left the list. `Ctrl+K` is back in the project box.

**The switch off makes zero calls.** With the switch off, `tauri` in the GitHub box → six cached rows, no label, and a poll of `Get-Process gh` every 50 ms for four seconds sees **nothing**.

**The switch on.** `Ctrl+,` → GitHub → *On* (`prefs.json` says `true`). `tauri` → six rows and *Searching GitHub…* at once; a second later *Your repos & bookmarks* over the six and *More from GitHub — 29* over twenty-nine rows with ★ — `tauri-apps/awesome-tauri ★ 8.1k` first, in GitHub's order, none of them a copy of a cached row. The same poll saw `gh` for about two seconds. `hono` → 26 fuzzy cache matches under *Searching GitHub…*, then *More from GitHub — 30*; `ho` → 212 rows and no label at all — under three characters, nothing is asked. Back to `tauri` → the answer is already there, no second call. *Off* in Settings → the labels and the thirty rows leave; `prefs.json` says `false`.

**Recents.** Empty box; click *recents*: 29 → 9 rows, the footer line gone, `devgo.githubRecents` = `off`; with focus out of the inputs `End` lands on `server`, SERVER's one row, never on the hidden tail. Click again: 29, `End` lands on the tail's last row.

**The row.** *A–Z* → `devgo.sortMode` = `name` and the mark moves; *Frecency* back. `+ Workspace ▾` → *Choose a folder… Ctrl+N · Scan for folders…*; `Escape`. At 1400 px the boxes are 637 and 321 px; at 900, 257 and 201.

Remove `devgo.githubRecents`, `Ctrl+Q`, restore the six files.

> `✅STAGE: 36 ui-chrome`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/github.rs   Repo.stars; SEARCH_FIELDS, SEARCH_LIMIT, search(); GhRepo takes both branch spellings; 1 test
  src/services/preferences.rs  github_live_search
  src/commands.rs, lib.rs  GithubPayload.live_search; set_github_live_search; SearchAnswer; search_github (async);
                           get_runtime_info dropped
src/
  components/StatusBar.tsx     TargetGroup, the launch groups, Open Both, Manage…, the palette door; h-12
  components/ActionButtons.tsx, RuntimeIndicator.tsx, hooks/useRuntime.ts   deleted
  components/SearchBox.tsx     the input alone; placeholder, lane, className
  components/TitleBar.tsx      no tagline
  components/ProjectTree.tsx   navigate(dir, lane); quiet while the cursor row is on screen
  components/GithubLane.tsx    query from the hook; two labels in the flat view; ★; recents; shown sections
  components/Settings.tsx      Search all of GitHub as you type: On / Off
  hooks/useGithub.ts           query/setQuery; live, generation, searching, liveExtras, setLiveSearch; showRecents
  hooks/useProjects.ts         setSort
  github.ts                    compactCount; goneRow.stars
  shortcuts.ts                 focusGithubSearch Ctrl+G
  App.tsx                      the command row; SORT_MODES; githubSearchRef, handleGithubArrow/Enter; StatusBar props
  types.d.ts                   SearchLane, SearchAnswer; StatusBarProps, SearchBoxProps, GithubState, GithubRepo,
                               GithubPayload, ProjectTreeHandle, ProjectRowProps grown; ActionButtonsProps,
                               RuntimeInfo, RuntimeIndicatorProps gone
```

One strip fewer, a command row over the table, two search boxes on one component, and — opted into — all of GitHub as you type.

> **The thread running through this chapter.** The row mirrors the one table under it — a flex row, no grid, no media query — and everything else is reuse: the same `TargetGroup`, the same `SearchBox` twice, the same three gates. A box that never moves between parents needs neither a breakpoint nor a hook to watch one.
