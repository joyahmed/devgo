# 39 — Branches on GitHub Rows (post-plan)

**Branch:** `39.github-branches` — `git checkout 39.github-branches` gives you this chapter's finished app; `git diff 38.ui-surfaces 39.github-branches` is exactly what this chapter adds.

**Starting from:** chapter 38 — every secondary surface is a drawer. On a *project* row the branch chip has opened a popover since chapter 32: the repo on its host, then every branch the last `git fetch` left in `refs/remotes`, each a link. On a *GitHub* row the default branch is just text.

**Goal:** the same chip on a GitHub row — click it, get every branch on GitHub, each opening that branch's page — and, on a clone's own popover, one entry that swaps the remembered list for the live one.

> **Hold on to:**
> 1. **On the click, never in a pass.** One `gh api` per repo per session, when a chip is clicked; the second open of the same repo asks nobody.
> 2. **One shape, two sources.** The popover is the same list of entries whether it came from `refs/remotes` or from the API; where it came from is the app's concern, not the row's.
> 3. **Local wins by default.** A clone's list is instant and usually right; GitHub is one entry away when you doubt it.
>
> Rust: `gh api … --jq '.[].name'` and a three-line line parser; `Mutex<HashMap<String, Vec<String>>>` on `AppState` as a session cache; `get_mut` on the git cache to overwrite one field. TypeScript: a second popover state with the same four fields; a menu entry that re-opens the menu it lives in.

> The three verbs the zero-network rule gave way to in chapter 33: *open GitHub, find the repo, go to the branch.* Chapters 33–35 answered the first two. This is the third.

---

## 39.1 — One command, one page of names

`services/github.rs`:

```rust
pub fn branches(full_name: &str) -> Result<Vec<String>, AppError> {
    let text = gh(&[
        "api",
        &format!("repos/{full_name}/branches?per_page=100"),
        "--jq",
        ".[].name",
    ])?;
    Ok(parse_branch_lines(&text))
}
```

`--jq '.[].name'` prints one name per line; `parse_branch_lines` trims, drops blanks and CRs (gh's and Windows's, not branches), and is the unit under test. One page of a hundred — a repo with more has a problem this popover is not the tool for.

> `✅GITHUB: branches by gh api` — **150** tests.

`AppState.github_branches: Mutex<HashMap<String, Vec<String>>>` — in memory only, like `git_cache`, and for the same reason: a branch list from yesterday looks current. `get_github_branches(full_name)` is `async` + `spawn_blocking` like `search_github`, answers from the map when it can and fills it when it cannot. `refresh_remote_branches_github(project)` is the clone's door: the remote is read from `git_cache` (the badge pass filled it), `parse_spec` — chapter 34's paste parser — turns it into `owner/name` or says *… is not a GitHub repository*, the API answers, and the list lands on the same `GitInfo.remote_branches` slot `get_remote_branches` fills, so the next open shows the live list until the badge pass replaces the entry. Both registered.

> `✅CMD: github branches on the click`

## 39.2 — The chip, the popover

`RepoRow`'s default-branch text becomes the chip a project row has — muted mono, accent on hover, opens under itself, selects the row first so the menu and the keyboard agree. `onOpenBranches` threads `RepoRowProps` → `GithubLaneProps` → `ProjectTreeProps.onRepoBranches`. In App, `openUrl` gains a `branch` — it goes to `open_remote`'s URL door, where chapter 32's `branch_url` knows each host's spelling, so no URL is assembled in the frontend — and `handleOpenRepo(repo, branch?)` with it. `RepoBranchMenu` sits beside `BranchMenu` in `types.d.ts`; `openRepoBranches` opens the popover with `branches: null`, asks `get_github_branches`, and only the popover that asked gets the answer (a failure toasts and lands an empty list). `buildRepoBranchMenu` is the same shape as `buildBranchMenu`: *Open repo on GitHub* · separator · the default branch with a `default` hint · *Loading branches…* / *No other branches* / the list. The ninth `ContextMenu` in App.

> `✅UI: branch chip on github rows`

## 39.3 — Where the two sources meet

A clone's popover keeps the local list as its default. Its last entry is **Refresh from GitHub** (hint `gh api`), shown only when the remote's host is GitHub and enabled once the local list has loaded. It runs `refresh_remote_branches_github` and — because picking a menu entry closes the menu, which is `ContextMenu`'s contract — re-opens the popover at the same spot with the new list. A first cut that only fetched put the fresh list into a popover nobody could see.

> `✅UI: refresh from github on a clones popover` — `bun run build` clean.

## 39.4 — Verify

`cargo test` reports **150**. Back up the six files. **Nothing here opens a browser**: a popover entry ends in a URL launch, so no entry is clicked except *Refresh from GitHub*, which fetches and re-opens; the URL a branch entry would open is the string `branch_url` builds, pinned by chapter 32's `branch_urls_follow_the_host`.

**A GitHub row.** `shop`'s chip (scrolled into view first — a CDP click scrolls nothing): the popover reads *Open repo on GitHub · main DEFAULT · Loading branches…*; 1.5 s later the same head and **18** branches (`feat/checkout`, `backend`, `backup/…`, …), 20 entries, the row under the cursor; a `Get-Process gh` poll every 50 ms saw `gh` for about half a second. `Escape`; the chip again: 20 entries at once and **no `gh`** — the session cache answered.

**A clone.** `docs` (Windows, remote on GitHub, one branch): *Open repo on GitHub · main CURRENT · No other branches on the remote · Refresh from GitHub GH API*. *Refresh from GitHub* → `gh` ran, the popover re-opened with the API's answer — the same one line, this repo has one branch. `devgo` itself (40 refs in `refs/remotes`): 42 entries — *Open*, the current `39.github-branches`, 39 others, *Refresh*; *Refresh from GitHub* → `gh` ran, 42 entries again from the API (`01.scaffold` … `38.ui-surfaces`, `main`) — the local clone and GitHub agree after a push, as they should.

⚠️ **Deferred, not built:** a popover of 42 entries reaches 1520 px in a 1392 px window — `ContextMenu` clamps its top, not its height. Chapter 32 had the same with 63 branches; a `max-h` with a scroller is a chapter for the menu, not this one.

`Ctrl+Q`, restore the six files (all matched).

> `✅STAGE: 39 github-branches`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/github.rs  branches, parse_branch_lines; 1 test
  src/commands.rs, lib.rs AppState.github_branches; get_github_branches, refresh_remote_branches_github
src/
  components/GithubLane.tsx   the branch chip on a repo row; onOpenBranches through RepoRow
  components/ProjectTree.tsx  onRepoBranches passed through
  App.tsx                     openUrl(url, branch); RepoBranchMenu state, openRepoBranches, buildRepoBranchMenu;
                              Refresh from GitHub on a clone's popover
  types.d.ts                  RepoBranchMenu; RepoRowProps, GithubLaneProps, ProjectTreeProps grown
```

The third verb — *go to branch* — for a repo that is not on your disk.

> **The thread running through this chapter.** Every piece was already there: the chip (32), `open_remote`'s URL door and `branch_url` (32, 33), `parse_spec` (34), `async` + `spawn_blocking` (34, 36), the popover's shape (32). What the chapter adds is one `gh api` call and the rule it lives under — on the click, never in a pass.
