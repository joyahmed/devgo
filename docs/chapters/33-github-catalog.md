# 33 — The Rule We Retired, and the One That Replaced It (post-plan)

**Branch:** `33.github-catalog` — `git checkout 33.github-catalog` gives you this chapter's finished app; `git diff 32.remote-branches 33.github-catalog` is exactly what this chapter adds.

**Starting from:** chapter 32 — one table of projects read off two filesystems, a branch popover read off the last `git fetch`, and a sentence that has been true since chapter 01: *DevGo has made zero network calls.*

**Goal:** a **GitHub** group at the bottom of the same table, listing every repository the user owns — fetched through `gh`, cached to disk, searched by the same box as the projects above it — with a `local` mark on the ones already cloned here.

> **Hold on to:**
> 1. **The rule changed, and the chapter says so.** *Zero network* became three clauses: **only on an explicit ask**, **never on launch / focus / the badge pass**, **never on the UI thread**. A rule that vanishes without a trace is how the next person re-adds it.
> 2. **`gh` owns auth.** DevGo stores no token. Not-installed and not-logged-in are typed errors with the fix in the message — never an empty list that looks like "you have no repos".
> 3. **Cache first, thread second, event third.** The command returns before `gh` starts; the thread writes the cache and emits one event; a failed fetch leaves the cache exactly as it was.
> 4. **The `local` match is a compare, not a probe.** Chapter 10 already paid for every project's remote; `gh` prints the same URL shape.
>
> Rust: `std::thread::spawn` with a `move` closure over an `AppHandle`; `AtomicBool::compare_exchange` as a one-at-a-time gate; `tauri::Emitter::emit` from a thread; `Option<Vec<String>>` where `None` means *all*. TypeScript: `listen` for a Rust event with cleanup; `useRef` as a once-per-session flag; a `Record<string, string>` map from Rust; a discriminated union (`NavRow`) for two kinds of row under one cursor.

> Chapter 32 said the zero-network rule was kept on purpose, and it was — right up to the point where it cost more than it saved: with hundreds of repositories on GitHub, *open GitHub, find the repo, go to the branch* is a launcher's job too, and a rule that forbids it is a rule the launcher's user works around by hand. The rule is retired here, and this chapter does not quietly edit chapter 32.

---

## 33.1 — The replacement rule

The old rule was one sentence. The new one is three clauses, and every line of this chapter sits under one of them:

1. **Only on an explicit ask.** The group's ↻, a palette command, *Refresh now* in Settings, and the group's first open in a session when its cache is stale. Nothing else.
2. **Never on launch, never on window focus, never inside the badge pass.** Chapter 27 made focus cheap and chapter 32 kept the branch list a click away; a `gh` call on either would undo both.
3. **Never on the UI thread.** The list renders from the cache first, the fetch runs on a spawned thread, and a fetch that fails leaves the cache as it was.

Measured on a real account: 381 repos across the user and one org, `gh repo list -L 1000` in 6 s on a good run and 20 s on a slow one — the second number is the whole argument for clause 3.

## 33.2 — One flat row, from one nested document

`services/github.rs` starts with the row and the pure functions around it — no `gh` yet, so every one of them has a test that runs without the network:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Repo {
    /// owner/name, the key the lane searches and the local mark matches on
    pub full_name: String,
    pub name: String,
    pub owner: String,
    /// https://github.com/owner/name, the same shape remote_to_url makes
    /// of a project's remote, which is what makes the local match a
    /// string compare
    pub url: String,
    /// RFC 3339 as gh prints it; the frontend renders it relative
    pub updated_at: String,
    pub private: bool,
    pub archived: bool,
    /// None for an empty repository: gh prints defaultBranchRef null for
    /// one with no commits, and one such repo must not fail the list
    pub default_branch: Option<String>,
}
```

`gh repo list --json name,owner,url,updatedAt,isPrivate,isArchived,defaultBranchRef` nests the owner and the default branch; a private `GhRepo`/`GhOwner`/`GhRef` trio (`#[serde(rename_all = "camelCase")]`) receives that, and `parse_repos` flattens it. `default_branch` is an `Option` for a reason found by reading the JSON: an empty repository has `"defaultBranchRef": null`, and one such repo in 381 would have failed the whole parse. Beside it:

- `repo_key(url)` — trim, drop a trailing `/` and `.git`, lowercase. `GitInfo.remote` has already been through `remote_to_url`, but it came from a human-typed `remote.origin.url`, and GitHub treats neither case nor a trailing slash as significant.
- `local_matches(repos, remotes)` — a `HashMap` from `repo_key(remote)` to the project path, then one lookup per repo: `full_name → path`.
- `clone_urls(full_name)` — `git@github.com:{full_name}.git` and `https://github.com/{full_name}.git`, built from the name rather than parsed back out of `url`.

Seven tests: the user/org sample parses with the org kept as owner; the empty repo has no default branch and does not fail the list; malformed JSON is an error, not an empty list; the key ignores case, suffix and slash; the key sees through `remote_to_url` for both an SSH and an HTTPS remote; `local_matches` pairs one of three rows with one of two disk projects; the clone URLs come from the name. `pub mod github;` in `services/mod.rs`.

> `✅GITHUB: repo rows parsed from gh json` — **129** tests.

## 33.3 — `gh` owns auth; DevGo owns nothing

```rust
fn gh(args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("gh")
        .creation_flags(CREATE_NO_WINDOW)
        .args(args)
        .output()
        .map_err(|_| AppError::GhUnavailable(NOT_INSTALLED.into()))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(AppError::GhUnavailable(if err.is_empty() {
            format!("gh {} failed", args.join(" "))
        } else {
            err
        }))
    }
}
```

DevGo never sees a token. `gh` keeps it in the keyring, `gh auth login` puts it there, `gh auth logout` takes it away — and that is the entire security story, which is the point of shelling out rather than linking an API client. `AppError::GhUnavailable(String)` (`#[error("{0}")]`) carries the fix: `NOT_INSTALLED` names `winget install GitHub.cli`, `require_login` names `gh auth login`, and a non-zero exit carries `gh`'s own stderr, which for the not-logged-in case already reads *To get started with GitHub CLI, please run: gh auth login*.

**Without the network:** `gh auth status` validates the token against the API — a network call, and a slow one. `gh config get -h github.com user` reads the login straight out of `hosts.yml`:

```rust
pub fn status() -> GhStatus {
    let version = match gh(&["--version"]) {
        Ok(text) => parse_version(&text),
        Err(_) => return GhStatus::default(),
    };
    let login = gh(&["config", "get", "-h", "github.com", "user"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    GhStatus {
        installed: true,
        version,
        login,
    }
}
```

Two process spawns, so the Settings line and the group header can render on every open. `GhStatus { installed, version, login }` is the three-state answer. `list_orgs` is `gh api user/orgs --paginate --jq .[].login`; `list_repos(orgs)` is one `gh repo list --json … -L 1000` for the user and one per listed org, sorted newest-first **in Rust, before it is written**, so "the 20 most recently updated" on the frontend is a slice and not a sort, then `dedup_by` on `full_name`. One test for `parse_version` (`gh version 2.97.0 (2026-07-31)` → `2.97.0`).

> `✅GITHUB: gh owns auth` — **130** tests. (Dead-code warnings until the commands land; the gate is `cargo test`.)

## 33.4 — The cache

`GithubCache { fetched_at, login, orgs, repos }` — every field but the timestamp `#[serde(default)]` — is `github-cache.json` in app data. `GithubStore` is the same shape as every store since chapter 22: `parse_or_backup` on read, so a corrupt file becomes `.bak` rather than being overwritten; `get()` clones, `store(cache)` writes pretty JSON. `orgs` is every org the last refresh found, so Settings can draw its checkboxes without asking the network. The staleness rule is a pure function of two timestamps:

```rust
pub const STALE_AFTER_SECS: u64 = 6 * 60 * 60;

pub fn is_stale(fetched_at: u64, now: u64) -> bool {
    fetched_at == 0 || now.saturating_sub(fetched_at) > STALE_AFTER_SECS
}
```

Six hours: a repo pushed this morning is there by lunch, and a machine that opens DevGo ten times a day fetches once or twice. Two tests — the four staleness cases (never fetched, exactly the limit, one past it, a clock that went backwards) and a round trip that ends by writing `{ broken` over the file and checking the next `new` starts empty with a `.bak` beside it. `pub use github::GithubStore;` in `mod.rs`.

> `✅GITHUB: cache on disk` — **132** tests.

`Preferences` gains `github_orgs: Option<Vec<String>>` under `#[serde(default)]` — `None`, the default and every `prefs.json` from before this field, means *every org `gh` finds*; `Some(list)` is a choice made in Settings, kept even when empty. `github_orgs()` / `set_github_orgs(orgs)` on the store.

> `✅PREFS: github org choice`

## 33.5 — Three commands that read, one that fetches

`AppState` gains `github_store: Mutex<GithubStore>` and `github_refreshing: AtomicBool`; `lib.rs` builds the store beside the others (before `app_data_dir` moves into `WorkspaceStore::new`). `GithubPayload { cache, stale, refreshing, orgs, local }` is what the group and the panel read — `stale` decided here so the frontend never knows the six-hour rule, `local` computed from the git cache:

```rust
#[tauri::command]
pub fn get_github_repos(
    state: State<AppState>,
) -> Result<GithubPayload, AppError> {
    let cache = state.github_store.lock().map_err(lock_err)?.get();
    let orgs = state.pref_store.lock().map_err(lock_err)?.github_orgs();
    let local = {
        let git = state.git_cache.lock().map_err(lock_err)?;
        github::local_matches(
            &cache.repos,
            git.values().filter_map(|i| {
                i.remote.as_deref().map(|r| (i.full_path.as_str(), r))
            }),
        )
    };
    Ok(GithubPayload {
        local,
        stale: github::is_stale(
            cache.fetched_at,
            crate::services::preferences::now_secs(),
        ),
        refreshing: state
            .github_refreshing
            .load(std::sync::atomic::Ordering::Relaxed),
        cache,
        orgs,
    })
}
```

No network in it, ever: this is what renders on mount and it must cost what reading a file costs. `get_github_status` is `github::status()`; `set_github_orgs` saves the choice and fetches nothing; `github_clone_urls(full_name)` returns the pair. All four registered.

> `✅CMD: github cache and status commands`

The one that fetches:

```rust
#[tauri::command]
pub fn refresh_github_repos(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), AppError> {
    use std::sync::atomic::Ordering;
    if state
        .github_refreshing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(());
    }
    let chosen = state.pref_store.lock().map_err(lock_err)?.github_orgs();

    std::thread::spawn(move || {
        let result = (|| -> Result<(), AppError> {
            // every org the user belongs to, always: the panel's
            // checkboxes come from this list. the chosen subset is listed
            let all_orgs = github::list_orgs()?;
            let listed: Vec<String> = match &chosen {
                Some(c) => {
                    all_orgs.iter().filter(|o| c.contains(o)).cloned().collect()
                }
                None => all_orgs.clone(),
            };
            let (login, repos) = github::list_repos(&listed)?;
            let st = app.state::<AppState>();
            let mut store = st.github_store.lock().map_err(lock_err)?;
            store.store(GithubCache {
                fetched_at: crate::services::preferences::now_secs(),
                login: Some(login),
                orgs: all_orgs,
                repos,
            })
        })();
        let st = app.state::<AppState>();
        st.github_refreshing.store(false, Ordering::Release);
        let payload = match &result {
            Ok(()) => serde_json::json!({ "ok": true, "error": null }),
            Err(e) => {
                serde_json::json!({ "ok": false, "error": e.to_string() })
            }
        };
        let _ = tauri::Emitter::emit(&app, "devgo://github-updated", payload);
    });
    Ok(())
}
```

The command returns before `gh` has started. The `AtomicBool` makes a second click during a fetch a no-op rather than a second `gh` — the running one's result serves both. Every org the user belongs to is listed always, because the panel's checkboxes come from that list; the *chosen* subset is what gets fetched. `use tauri::{Manager, State}` for `app.state()`.

One detail that matters: the guard is bound to a local (`let mut store = …; store.store(…)`) rather than chained into the closure's tail expression. As a tail, the `MutexGuard` temporary outlives `st`, and `rustc` refuses it with *`st` does not live long enough*. Same code, one `let`.

> `✅CMD: refresh_github_repos on a thread` — `cargo check` 0 warnings.

`open_remote` grows a second door. `full_path: Option<String>` resolves the root from the cached remote as before; `url: Option<String>` brings its own, straight from `gh`; both `None` is `NoRemote`. Either way the URL is built here with `branch_url`, and only `https://` ever reaches `start` — `open_in_browser(url)` refuses anything else with `AppError::BadUrl`. A missing argument deserialises to `None`, so the chapter-32 caller (`{ fullPath, branch }`) still compiles and still works; the frontend passes `url: null` explicitly from now on anyway.

> `✅CMD: open_remote takes a url` — **132** tests.

## 33.6 — Searched like the rest

`src/github.ts` is pure — no `invoke`, no React: `RECENT_LIMIT = 20`; `visibleRepos(repos, query)` runs the palette's `fuzzyScore` (chapter 16) over `full_name`, so `org/` is searchable and `acsh` finds `acme/shop`, and returns the newest twenty when the box is empty — a slice, because Rust already sorted; `relativeTime(iso | seconds)` → `just now`, `3 h ago`, `2 y ago`, coarse on purpose. `types.d.ts` gains `GithubRepo`, `GhStatus`, `GithubCache`, `GithubPayload`, `GithubUpdated` (the event's `{ ok, error }`) in the wire-types section.

> `✅UI: github rows searched like the rest`

`hooks/useGithub.ts` reads the cache on mount, listens for the thread, and owns the one automatic fetch. No `useCallback`, no `useMemo` — `reload` and `refresh` are plain functions, `visible` is a plain const:

```ts
	// the local map is computed from the git cache on the rust side, so it
	// is as current as the last badge pass: re-read after each one. the
	// map is a new one when a pass lands, and the first run is the mount
	useEffect(reload, [git]);

	const hasCache = (payload?.cache.fetched_at ?? 0) > 0;
	const isOpen = open ?? hasCache;
	…
	// the one automatic fetch, and its whole condition: lane open, cache
	// stale or absent, gh logged in, nothing in flight, not yet this session
	useEffect(() => {
		if (!isOpen || !payload || !status?.login) return;
		if (!payload.stale || refreshing || askedOnOpen.current) return;
		askedOnOpen.current = true;
		refresh();
	}, [isOpen, payload, status, refreshing]);
```

`open` is `devgo.githubLane` in `localStorage`, `null` when never set — and `null` means *open once there is something to show*: a first run with no cache starts closed, so the very first fetch is a click on the header, an explicit ask, never a surprise on launch. `askedOnOpen` is a `useRef`, so the stale-on-open rule fires once per session however often the group is toggled. The return shape is `GithubState` in `types.d.ts` (ambient types cannot import `ReturnType<typeof useGithub>`; chapter 25 did the same for `TargetRegistry`).

> `✅HOOK: useGithub reads the cache`

## 33.7 — A fourth kind of row in the same table

The tree is **one table** — *Workspace · Location · File System · Count* — and chapters 30 and 31 kept it that way, so the GitHub rows become **one more group** in it: a header that collapses like a workspace's, rows in the same four columns, and no second layout to keep in step. The column grid string moves out of `ProjectTree` into `components/rowStyles.ts` (`export const col`) so a second file can use it and the two can never drift.

> `✅UI: row grid moves out of the tree`

`GithubLane.tsx` maps the four columns: **owner** where the workspace goes, **name** (plus a monochrome lock for a private repo) where the location goes, the word **GitHub** in the File System column — muted, because it is not a filesystem, and that is the point — and the meta cell on the right: *archived*, the `local` mark, the default branch in mono, the relative time. The header row: `▼ GitHub`, the login in mono, one sentence driven by the three auth states (*updated 3 h ago* · *refreshing…* · *gh not found. Install: winget install GitHub.cli* · *not logged in. Run: gh auth login* · *not loaded. Open to fetch your repos with gh*), a ghost ↻ `Button` in the third column when logged in, the count right-aligned in the fourth. Under it the same `0fr → 1fr` reveal the workspace groups use, the error line, the three empty-state sentences, *No repository matches `q`.*, the rows, and a footer — *20 most recently updated of 381. Type to search all of them.* — so twenty rows out of hundreds never reads as "where are the rest".

The `local` mark is a word, not a pill (seven of the twenty newest rows are clones, and a chip on each turned the meta cell into a column of chips): a ghost `Button` with a `<span>` child carrying the size and colour, the chapter-12 answer to Tailwind's class-order rule. Props (`GithubLaneProps`, `RepoRowProps`) in `types.d.ts`.

> `✅UI: github group under the table`

**The keyboard.** `ProjectTree` gains `repoCursor: string | null` beside `selected` — a repo row is not a `Project`, so it is never *selected*, but it is reachable by arrow. The navigable sequence becomes `rows: NavRow[]` — `{ kind: 'project' }` for every visible project, then `{ kind: 'repo' }` for the group's visible rows when it is open — and `navigate`, `jump` and `Home`/`End` walk it; `land(row)` selects a project (clearing the cursor) or sets the cursor. With a repo under the cursor, `Enter` opens its page and `←`/`→` are off (there is nothing to collapse):

```ts
		const keys: Record<string, () => void> = repoCursor
			? { ...walk, Enter: () => openRepo() }
			: { ...walk, ArrowRight: …, ArrowLeft: …, Enter: launch };
```

Any change of `selected` drops the cursor (`useEffect(() => setRepoCursor(null), [selected])`), so the two are never lit at once after a `local` click. `ProjectTreeHandle` gains `openRepo(): boolean` so the search box's `Enter` can ask the tree first. When no project matches the query, the empty line is a line and not the whole screen when there is a group to show under it — a query no project matches may still have an answer in the GitHub rows, which is half of why they are there.

> `✅UI: arrows walk into the github rows`

**App.** `useGithub(query, git)` — `git` is the dependency, so the `local` marks track the disk. `openUrl(url)` is `open_remote` through its URL door; `handleOpenRepo`, `showLocal(path)` (find the project by path, `setSelected`, or a toast when the clone is outside every workspace), `handleSearchEnter` asks `treeRef.current?.openRepo()` first. The right-click menu is the fifth list on the `ContextMenu` primitive — *Open on GitHub* (hint `Enter`), the two clone URLs (built in Rust by `github_clone_urls`, copied by the same `copyText` the paths use), *Show local project* when the mark is on. No git operation, no pull request, no clone: that is what keeps this a menu and not a second app. Three palette commands: *Settings: GitHub*, *GitHub: refresh repos* (subtitle `runs gh as <login>`, disabled while refreshing or logged out), *GitHub: open profile*.

> `✅UI: repo menu and palette commands`

**Settings › GitHub.** `GithubPanel` in the registry after *tmux / psmux*: the status line (`gh 2.97.0 · logged in as user`, or the fix in `text-danger`), one checkbox per known org — ticking every box goes back to *all* (`null`), so a new org joins the list without a visit here — a `Save` that appears only once something changed (*Saved. Applies on the next refresh.*), the cache's age with *(stale)* when it is, and *Refresh now*, which is the same thread the header's ↻ starts. `github: GithubState` is passed in from `App` for the same reason `targets` is: the panel's button and the group's header must agree on *refreshing*.

> `✅UI: settings github panel` — `bun run build` clean.

## 33.8 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **132** — chapter 32's 122 plus ten for github. `gh auth status` must say *Logged in*. Back up the app-data files — **six** now: `github-cache.json` joins the five — and move `github-cache.json` aside so the run starts from nothing.

**First run.** `bun tauri dev`. At the bottom of the table a collapsed header: `▶ GitHub · user · not loaded. Open to fetch your repos with gh`. No spinner, no `gh repo list` — clause 2. Click the header: the group opens, `localStorage.devgo.githubLane` becomes `open`, and the stale-on-open rule fires — *fetching your repos…* with the ↻ spinning. Eleven seconds later: `updated just now · 381`, twenty rows, seven of them marked `local` (`devgo`, `api`, `shop`…), the footer line under them. `github-cache.json` exists.

**Search.** `acsh` in the search box: five rows, three of them not on this disk (`acme/shop`, `acme/shop-api`…). `blog`: one workspace header above, one repo row below. `xqzvw`: *No project matches.* as a line, then the group with *No repository matches xqzvw.* under it.

**Keys.** Clear the box, blur it. `End` puts the cursor on the twentieth row; `↑` `↑` walks up; `←` collapses nothing (seven headers still `▼`). The selected project stays lit — the cursor is beside the selection, not instead of it.

**Menu.** Right-click the cursor row: *Open on GitHub*, *Copy clone URL (ssh)*, *Copy clone URL (https)*. Click the ssh entry: toast *Copied SSH clone URL*, clipboard `git@github.com:user/shop.git`.

**The mark.** Click `local` on `docs`: the disk row `projects / docs` is selected and the repo cursor is gone.

**Open.** *Do not click it.* `Enter` on a repo row opens `https://github.com/<owner>/<name>` in your own browser, and a tab opened by a script cannot be closed by one. From here on a Verify section proves a URL by reading what Rust builds — `open_remote` refuses anything but `https://` (`BadUrl`), `branch_url` and `clone_urls` are unit-tested — and never by letting it open.

**Settings.** `Ctrl+,` → *GitHub*: `gh 2.97.0 · logged in as user`, one checkbox `acme`, *381 repositories, fetched 2 min ago.* Untick it, *Save* → `prefs.json` has `"github_orgs": []`. *Refresh now* → *Refreshing…* (disabled) → *375 repositories, fetched just now*, and the cache file has no `acme` row. Tick it back, *Save* → `null`; refresh → 381, six org rows.

**Header ↻.** Click it: *refreshing…* in the header, the icon spins; twenty seconds this time — the slow number — then *updated just now*.

**Relaunch.** `Ctrl+Q`, start again: the group opens where it was left, `updated 55 s ago`, no spinner within four seconds — a fresh cache is not refetched. Quit, set `fetched_at` to `1000` in the cache file, start again: *refreshing…* on its own, once, then `updated just now`.

Remove `devgo.githubLane` from `localStorage`, `Ctrl+Q`, restore the six files.

> `✅STAGE: 33 github-catalog`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/github.rs  Repo, GhStatus, GithubCache, GithubStore; gh, status, list_orgs, list_repos;
                          parse_repos, repo_key, local_matches, clone_urls, is_stale; 10 tests
  src/services/preferences.rs  github_orgs
  src/commands.rs, lib.rs get_github_repos, get_github_status, refresh_github_repos, set_github_orgs,
                          github_clone_urls; open_remote(full_path | url, branch); open_in_browser
  src/error.rs            GhUnavailable, BadUrl
src/
  github.ts               RECENT_LIMIT, visibleRepos, relativeTime
  hooks/useGithub.ts      the cache, the event, the one automatic fetch
  components/rowStyles.ts col
  components/GithubLane.tsx  the group: header, rows, empty states, footer
  components/ProjectTree.tsx repoCursor, NavRow rows, openRepo; the group under the table
  components/Settings.tsx GithubPanel
  App.tsx                 useGithub, openUrl, showLocal, buildRepoMenu, three palette commands
  types.d.ts              GithubRepo, GhStatus, GithubCache, GithubPayload, GithubUpdated, GithubState,
                          NavRow, RepoMenu, GithubLaneProps, RepoRowProps, GithubPanelProps
```

A GitHub group at the bottom of the table: every repository you own, fetched through `gh` on a background thread, cached to disk, searched by the box you already type into, with a `local` mark on the ones cloned here.

> **The thread running through this chapter.** The rule changed and the chapter says so. What replaced it is three clauses — *explicit ask · never launch/focus/badge pass · never the UI thread* — and nothing new to learn: the same search, the same arrows, the same menu primitive, the same Settings registry, the same palette. The only new thing on the machine is a process called `gh`, and it was already there.
