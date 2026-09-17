# 76 — Repo Traffic

**Branch:** `76.repo-traffic` — `git checkout 76.repo-traffic` gives you this chapter's finished tree; `git diff adc0d6e 76.repo-traffic` is exactly what this chapter adds.

**Starting from:** `main` after 75 (`adc0d6e`). Written from the public work itself.

**Goal:** The ask, 2026-09-17, from DevGo's own Insights page: *"in devgo"*. GitHub shows a repository's owner — and nobody else — fourteen days of views and clones, each with its unique count, and the sites that sent the visitors. This chapter puts that on the GitHub row: *Traffic (14 days)* on its menu opens a popover with the two headline pairs, two sparklines, and the referrers; the row's meta then carries the two totals until the app is closed. It runs when clicked and at no other time: not on launch, not on focus, not on a pass, not on the lane's own refresh.

## Also since 75

Nothing: `main` did not move between `adc0d6e` and this branch.

> **Hold on to:**
> 1. **Three gh calls, one command, pure parsers.** `…/traffic/views`, `…/traffic/clones` and `…/traffic/popular/referrers` are three documents; `traffic(full_name, now)` runs them in a row and hands back one `Traffic`. The two series share a parser because they share a shape — the same `count` and `uniques` over a day list that GitHub names `views` in one and `clones` in the other, which one `#[serde(alias)]` folds into `days`. Each parser is a function of a string, so the tests are fixture JSON and never the network.
> 2. **An in-memory cache that never runs on a pass.** `AppState.github_traffic` is a `HashMap<String, Traffic>` beside `github_branches`, in memory only, and the only writer is the command a click reaches. `fetched_at` rides in the answer, so the command can serve a second look inside the hour without a spawn and the popover can say *47 s ago*. A relaunch starts empty on both sides, which is the whole proof that nothing fetches on its own.
> 3. **One system for the sparklines.** Two series, one hue: the total is the accent at full, the uniques the same accent dashed at half — no third colour, no new token, so the contrast gate has nothing new to measure. No axis: the headline number says the scale and the last day's count sits at the line's end as text. A legend once for both tiles, and every day a hover band with the date and both counts.

---

## 76.1 — Repo traffic, one command

`src-tauri/src/services/github.rs`. The types: `TrafficDay { timestamp, count, uniques }`, `TrafficSeries { count, uniques, days }` (at most fourteen days; GitHub may leave a quiet day out rather than print a zero), `Referrer { referrer, count, uniques }`, and `Traffic { full_name, fetched_at, views, clones, referrers }`. `TRAFFIC_STALE_SECS` is an hour — GitHub's numbers move by the day, and a second look in the same sitting should not cost three more calls — with `traffic_is_stale(fetched_at, now)` as the same pure rule the repo list has at six.

The parsers: `parse_traffic_series(text)` over a crate-internal `GhTraffic` whose `days` field carries `#[serde(default, alias = "views", alias = "clones")]`, so both documents land in one shape and a document with no list at all is an empty fortnight; `parse_referrers(text)` is the list as gh prints it. `traffic_refusal(err, full_name)`: the API answers 403 to anyone without push access, and gh prints the body and then *gh: Must have push access to repository (HTTP 403)*; a person wants one line, so `HTTP 403` in gh's stderr becomes *Traffic for ‹owner/name› is only shown to the repository's owner* and anything else gh said passes through as it is. `traffic(full_name, now)` runs the three `gh api` calls through the existing `gh()` seam (`?per=day` on the two series), maps a refusal onto the new `AppError::TrafficRefused`, and stamps the answer with `now`.

`commands.rs`: `AppState.github_traffic: Mutex<HashMap<String, github::Traffic>>` (in memory only; nothing fills it but a click). `get_repo_traffic(full_name, force) -> Traffic`: unless forced, a cached answer younger than the hour is returned as it is; otherwise `spawn_blocking(github::traffic)` and the answer is stored and returned. Registered in `lib.rs`, the field initialised beside `github_branches`.

> `✅RUST: repo traffic, one command`

## 76.2 — The tests

Five, all on fixture JSON: views parse to their totals and days (three days, the last one `2026-09-15` with `23 / 3`); clones share the parser under their own key, a document with no list is an empty day list, and `{ nope` is an error; referrers parse and `[]` is no referrers; a 403 is the owner refusal and a 404 or nothing is not; traffic goes stale after an hour, exactly the hour is still fresh, and the hour is shorter than the list's six. 225 → **230**.

> `✅TEST: traffic parsers on fixture json`

## 76.3 — The hook and its popover

`types.d.ts`: `TrafficDay`, `TrafficSeries`, `Referrer`, `Traffic` (the wire types), `TrafficAnchor { repo, x, y }` (a null anchor means the palette asked), `TrafficState { byRepo, loading, popover, open, refresh, close }`, `TrafficPopoverProps`, `TrafficTileProps`.

`hooks/useTraffic.ts`. `byRepo` is a `Map<string, Traffic>` of every answer since launch, `loading` the set of repos with a fetch in flight, `popover` the anchor or null. `open(repo, x?, y?)` sets the anchor and **always** invokes `get_repo_traffic(full_name, false)` — inside the hour Rust answers from memory with no gh spawn, and the popover shows the last numbers meanwhile; `refresh()` asks again with `force: true` for the open popover's repo; `close()` drops the anchor. A failed fetch (the refusal, or gh's own words) goes to `onError` and closes the popover that asked, so a refusal is a toast and nothing else.

`components/TrafficPopover.tsx`. The same fixed surface the context menu is (`bg-bg-secondary border border-border rounded-panel shadow-surface`), 320 px wide, at the anchor or centred at the top when there is none, its top clamped with the measured height once it has mounted, closed by Escape or a click outside. The header: `owner/name`, *traffic*, *‹read› ago*, a ghost refresh button (`RefreshIcon`, spinning while loading, disabled meanwhile). Then two `TrafficTile`s mapped from `[Views, Clones]`: the label and *14 days*; the headline `35 · 3 unique` (18 semibold, 13 secondary); a 288 × 40 SVG with two `polyline`s over the day list — index across, count up, both on the one scale of the day maximum so unique never rises above total — the uniques dashed `3 3` at `opacity 0.5` under the total at full, both `currentColor` = `text-accent`; one transparent `rect` per day with a `<title>` (*15 Sept · 387 clones · 123 unique*) as the hover layer; the last day's count as mono text at the line's end. Under the tiles, one legend for both (*— total · ┄ unique*), and the referrers as a mapped list (`github.com · 31 · 1`, *None in 14 days* when empty). Loading with nothing yet says *Reading traffic…*.

> `✅REACT: the traffic hook and its popover`

## 76.4 — The doors

`App.tsx`: `const traffic = useTraffic(e => toast(showError(e), 'error'))`. The GitHub row's menu, right after *Open on GitHub*: *Traffic (14 days)* with the hint `gh api`, disabled with the hint *gh is not logged in* when `github.status.login` is null; the click opens the popover at the menu's own `x, y`. The palette: `GitHub: traffic for ‹owner/name›` for the repo under the cursor (*14 days of views and clones, the owner only*), which needs the cursor in App — `ProjectTree` gains `onRepoCursor`, told in `selectRepo` and cleared in `clearCursors` the way `onServerCursor` has been since 72, and App keeps the row as `repoCursor`. `<TrafficPopover {...{ traffic }} />` sits beside the attach pane.

The meta: `trafficByRepo` goes down `ProjectTree` → `GithubLane` (`traffic`) → `RepoRow`, which prints `35 views · 387 clones` in the muted 11 before the stars with the four numbers in its tooltip — while the app holds an answer, and only then.

> `✅REACT: traffic from the row menu and the palette`

## 76.5 — Verify

On the dev build over CDP (the installed DevGo closed first, 16 app-data files backed up by hash; a hidden PowerShell polled `Win32_Process` for `gh.exe` every 40 ms from before the launch to the end, logging every new pid with its command line — the proof of what spawned and when):

- **Launch.** The poller saw `gh config get -h github.com user` (the status read, local) and nothing else: **no `gh api`** in the 60 s after the window came up, the GitHub lane at its 30 rows.
- **The row.** Right-click on `devgo` → the menu reads `Open on GitHub · ENTER | Traffic (14 days) · GH API | Copy clone URL (ssh) | Copy clone URL (https) | Add to group… | Show local project`. Click → the popover at the menu's point (`top 891px, left 1349px`), *Reading traffic…*; the poller: `gh api repos/joyahmed/devgo/traffic/views?per=day` at 12:22:29.7, `…/clones?per=day` at 12:22:30.5, `…/popular/referrers` at 12:22:31.5 — three calls, one command. At 2.9 s the popover reads **`joyahmed/devgo · traffic · just now · Views · 14 days · 35 · 3 unique · 35 · Clones · 14 days · 387 · 123 unique · 387 · total · unique · Referrers · github.com · 31 · 1`**, 355 px tall, four `polyline`s of **14 points** (two dashed `3 3`), 28 hover bands, the last two titles *14 Sept · 0 clones · 0 unique* and *15 Sept · 387 clones · 123 unique*. **The truth, read in a shell beforehand:** `gh api repos/joyahmed/devgo/traffic/views` → `count 35, uniques 3`, fourteen days `2026-09-02 … 2026-09-15`, everything on the 15th; `…/clones` → `387 / 123`, the same shape; `…/popular/referrers` → `[{"referrer":"github.com","count":31,"uniques":1}]`. The popover matches to the number. A screenshot of the frame was read back: the dashed unique line under the solid total, the knob's rows bleeding through the surface the way they do through the menu.
- **Esc** → the popover gone; the row now reads **`devgo · local · main · 35 views · 387 clones · 12 h ago`**, tooltip *14 days: 35 views (3 unique) · 387 clones (123 unique)*.
- **Inside the hour.** The menu again → the popover at once with *47 s ago* and the same numbers; the poller logged **nothing**. The refresh glyph → spinning, the button disabled, then *just now* at 3 s; the poller: the three calls again at 12:23:26–28.
- **The palette.** The `devgo` name clicked (the cursor), `Ctrl+Shift+P`, `traffic` typed → one row, **`GitHub: traffic for joyahmed/devgo · 14 days of views and clones, the owner only`**; run → the palette closed and the popover centred at the top (`top 88px`, centre x 1280 of 2560), no spawn.
- **Not the owner.** `add_github_repo('rust-lang/rust')` (the lane's own add-by-name; `github-cache.json` restored by hash after), reload → the row `rust-lang/rust · added · main`; its *Traffic (14 days)* → *Reading traffic…* for a moment, then the popover **closed** and the toast **`Traffic for rust-lang/rust is only shown to the repository's owner`**; the poller: **one** call, `gh api repos/rust-lang/rust/traffic/views?per=day` — the refusal stops the run at the first document.
- **Relaunch.** The dev build stopped and started again with the poller still running: after the window came up, `gh --version` and the config read, **no `gh api …traffic`** in 45 s; the `devgo` row's meta back to `devgo · local · main · 12 h ago` (the React map lives as long as the window). Then `get_repo_traffic('joyahmed/devgo', false)` invoked by hand → the three calls spawned at 12:26:26–27 and the answer `35 / 3 / 14 days · 387 / 123 / 14 days · github.com 31 / 1` — the Rust map was empty too.
- **Not provable this run:** the disabled entry and the palette subtitle for a gh that is not logged in (this account is; the guard is the same `github.status.login` the refresh entry uses); the popover clamped at the bottom of a short window (the same `useLayoutEffect` the menu has).
- **After:** the dev build stopped (1420 and 9223 free), 16 app-data files restored by hash (`github-cache.json`, `instance.lock`, `projects-cache.json` had moved; **0 mismatches** after), the poller stopped (3535 polls), the installed DevGo relaunched via `explorer.exe` (pid 39496, 12:26). No gh, no psmux, no ssh, no devgo of ours left; the two `wsl.exe` on the machine predate the run, untouched.
- **Gates:** `cargo fmt --check` clean, `cargo check` 0 warnings, `cargo test` **230** (225 + 5), `tsc -b` clean, `bun run build` clean (`contrast ok: 6 palettes x 8 rules, 5 lane hues`; `index` 411 KB, `xterm` 331 KB). Hygiene grep (69's) over `src src-tauri/src README.md` → 0.

> `✅DOCS: traffic in the readme` — one line under the GitHub section: owner-only, read through `gh api` when you ask, kept while the app runs, the row carries the two totals. `✅STAGE: 76 repo-traffic`; fetch (nothing new), ff-merge; push `main` + branch.

## 76.6 — Deferred

- **The sparkline places days by index**, not by date. GitHub may leave a quiet day out, and then two neighbours on the line are more than a day apart; a fourteen-slot grid filled from the timestamps would draw the gap. The devgo answer had all fourteen.
- **The hour is fixed.** A `Refresh` inside it is the only way to a fresh number; a Settings knob for the age would be one line and a field in prefs.
- **Paths and popular content** (`…/traffic/popular/paths`) are the fourth Insights list, not fetched; the popover has room for one more mapped list.
- **The meta cell is per launch.** A persisted `traffic-cache.json` would let the totals show on launch, which is exactly the fetch-on-launch this chapter refuses; the cell is one launch's memory on purpose.
- **A refused repo is asked again on every click.** The refusal is not cached, so a repo that is not yours costs one `gh api` per click. A per-launch set of refused names would make the entry grey with the reason.

---

## What you built

```
src-tauri/src/services/github.rs        TrafficDay, TrafficSeries, Referrer, Traffic; parse_traffic_series, parse_referrers, traffic_refusal, traffic_is_stale, traffic(); 5 tests
src-tauri/src/error.rs                  TrafficRefused
src-tauri/src/commands.rs               github_traffic in AppState; get_repo_traffic(full_name, force)
src-tauri/src/lib.rs                    the field, the command
src/hooks/useTraffic.ts                 byRepo, loading, popover; open always through rust, refresh forces, a failure closes and says
src/components/TrafficPopover.tsx       the surface, two tiles, two strokes of one accent, the legend, the referrers
src/components/GithubLane.tsx           the row's `N views · M clones`
src/components/ProjectTree.tsx          onRepoCursor, trafficByRepo through
src/App.tsx                             the menu entry, the palette entry, the popover
src/types.d.ts                          the traffic types
README.md                               the Traffic line
```

- **The owner's numbers, in DevGo** — views, clones, uniques, referrers, on the row's menu and in the palette.
- **Three calls, one command, on the click** — and never on a launch, a focus, a pass or the lane's refresh; proved by a process poller.
- **An in-memory cache** — an hour without a spawn, a relaunch starts empty on both sides.
- **One system** — the accent solid and dashed, no new colour, the gate untouched.
