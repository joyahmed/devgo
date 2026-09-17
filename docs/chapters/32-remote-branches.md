# 32 — From a Row to the Repo (post-plan)

**Branch:** `32.remote-branches` — `git checkout 32.remote-branches` gives you this chapter's finished app; `git diff 31.workspace-order 32.remote-branches` is exactly what this chapter adds.

**Starting from:** chapter 31 — the list is in your order. Every row shows its branch, and clicking the branch opens the repo's front page in the browser; that has been true since chapter 10. The chip says `main` and opens `main`; it says `fix/zed-wsl` and opens… the front page.

**Goal:** the branch chip opens a popover — the repo on its host, then every branch the remote has — and each entry is a link to that branch's page. Read from the last `git fetch`, never from the network.

> **Hold on to:**
> 1. **Never in the pass, always on the click.** Chapter 27 made the badge pass cheap; a branch list per project would have undone it. On demand, cached on the entry, cleared by the next pass.
> 2. **No network, still.** `refs/remotes/` is what the last fetch left behind. The user fetches in the terminal DevGo opened for them; DevGo has made zero network calls since chapter 01 and this chapter keeps it that way.
> 3. **Full refnames.** `%(refname:short)` turns `origin/HEAD` into plain `origin`, and a popover with a branch called *origin* is what the short form produces.
> 4. **The URL is built where the host is known.** Rust knows the remote; the frontend passes a branch name and nothing else.
>
> Rust: `const ARGS: [&str; 3]` passed to two different `Command`s; `HashMap::entry(..).or_insert_with(..)` to cache on a row that may not exist yet; `Option<Vec<String>>` where `None` means *nobody asked*. TypeScript: a functional `setState` that checks *which* popover asked before filling it (`m.project.full_path === p.full_path`); a curried `open(branch)` handler; `disabled` menu entries as the loading and empty states.

> Three asks arrived together: *github branches*, *clickable branches*, *open repo on github*. The third already existed (`open_remote`, chapter 10, on the context menu). The second half-existed (the chip was clickable, to the wrong place). The first is the only new capability, and the design question is entirely about **when** the branch list is read.

---

## 32.1 — The cheapest branch list is the one you already fetched

`git for-each-ref refs/remotes/` prints what the last `git fetch` left behind. No network, no token, no timeout, and exactly as current as the user's last fetch. In `git.rs`, under the Windows reader:

```rust
pub fn remote_branches(project: &Project, running: &[String]) -> Vec<String> {
    const ARGS: [&str; 3] =
        ["for-each-ref", "--format=%(refname)", "refs/remotes/"];
    match distro_of(&project.full_path) {
        Some(distro) if wsl::is_running(&distro, running) => {
            // wsl -d <distro> -e git -C <linux path> …, WSL_UTF8=1, no window
            …
        }
        Some(_) => Vec::new(),
        None => git_windows(&project.full_path, &ARGS)
            .map(|t| parse_remote_refs(&t))
            .unwrap_or_default(),
    }
}
```

Same liveness gate as every other git call in this file: a WSL project whose distro is stopped reports nothing rather than booting it.

`%(refname)`, the full name, and not `%(refname:short)` — the short form has a trap that only shows on a real click. Short names look right: `origin/main`, `origin/feat/x`. But git shortens `refs/remotes/origin/HEAD` to plain **`origin`**, so a popover built from them lists a branch called *origin* between `main` and `fix/zed-wsl`. With the full name the pointer is unmistakable and dropped:

```rust
fn parse_remote_refs(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter_map(|l| l.strip_prefix("refs/remotes/"))
        .filter(|l| !l.is_empty() && !l.ends_with("/HEAD"))
        .map(|l| l.strip_prefix("origin/").unwrap_or(l).to_string())
        .collect()
}
```

`origin/` is stripped because it is the remote the app already means by "remote" — `GitInfo.remote` comes from `remote.origin.url`. Any other remote keeps its prefix, so `upstream/main` still says where it lives. `GitInfo` gains `remote_branches: Option<Vec<String>>` — `None` meaning *nobody has asked* — and the WSL batch parser sets it to `None`. (No `#[serde(default)]`: `GitInfo` derives `Serialize` only; nothing ever deserialises it.) The test pins the `HEAD` drop, the `origin/` strip, the kept `upstream/`, and the regression: a bare `origin` line parses to nothing.

> `✅GIT: remote branches from the last fetch` — **121** tests.

## 32.2 — The URL is the host's, not GitHub's

`tree/<branch>` is GitHub's path. Sent to GitLab it is a 404, and a launcher that opens 404s is one you stop clicking:

```rust
pub fn branch_url(remote: &str, branch: &str) -> String {
    let host = remote
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let segment = if host.contains("gitlab") {
        "/-/tree/"
    } else if host.contains("bitbucket") {
        "/branch/"
    } else if ["github", "gitea", "codeberg", "forgejo"]
        .iter()
        .any(|h| host.contains(h))
    {
        "/tree/"
    } else {
        return remote.to_string();
    };
    format!("{}{segment}{branch}", remote.trim_end_matches('/'))
}
```

An unknown host gets the repo root — a wrong guess is a 404 in the user's browser; the root is always right. A `/` in a branch name (`feat/x`) is left alone: every host here reads the rest of the path as the ref, so escaping it would be the bug. One test per host, one for a trailing slash on the root, one for the fallback.

> `✅GIT: a branch url per host` — **122** tests. (Three dead-code warnings across these two commits; the commands below consume them.)

## 32.3 — On demand, remembered

```rust
#[tauri::command]
pub fn get_remote_branches(
    project: Project,
    state: State<AppState>,
) -> Result<Vec<String>, AppError> {
    if let Some(cached) = state
        .git_cache
        .lock()
        .map_err(lock_err)?
        .get(&project.full_path)
        .and_then(|i| i.remote_branches.clone())
    {
        return Ok(cached);
    }
    let running = running_for(std::slice::from_ref(&project));
    let branches = git::remote_branches(&project, &running);
    let mut cache = state.git_cache.lock().map_err(lock_err)?;
    let entry = cache.entry(project.full_path.clone()).or_insert_with(|| {
        git::GitInfo {
            full_path: project.full_path.clone(),
            ..Default::default()
        }
    });
    entry.remote_branches = Some(branches.clone());
    Ok(branches)
}
```

Not part of `get_git_info`. The badge pass is one `git.exe` per Windows project already, and chapter 27 exists because that pass was too expensive to run on every focus. A branch list is a click away; it must never be a pass away. The first click spawns one `git`, the second is free, and the next badge pass replaces the entry and clears it, so a fetch you ran shows up after the next refresh. `running_for` goes through chapter 27's memo like every other automatic caller.

> `✅CMD: get_remote_branches`

`open_remote` takes an optional `branch` and builds the URL in Rust — the frontend never assembles a URL out of strings the user can see:

```rust
    let url = match branch.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
        Some(b) => git::branch_url(&root, b),
        None => root,
    };
```

> `✅CMD: open_remote takes a branch`

## 32.4 — The chip becomes a door

`GitBadge` used to call `onOpenRemote`. Now, with a remote, it reports where it is and asks for the popover there — `GitBadgeProps.onOpenBranches?: (x, y) => void`, and the three props above it (`RowMeta`, `ProjectRow`, `ProjectTree`) become `onOpenBranches?: (p: Project, x: number, y: number) => void`:

```tsx
				onClick={
					info.remote
						? e => {
								e.stopPropagation();
								const r = e.currentTarget.getBoundingClientRect();
								onOpenBranches?.(r.left, r.bottom + 4);
							}
						: undefined
				}
```

`App` opens it through the `ContextMenu` primitive — the fourth list to use it, and still no second menu component. `BranchMenu` (in `types.d.ts`: the project, the anchor, and `branches: string[] | null` with `null` as the loading state) is the popover's state; `openBranches` sets it and asks the backend, and the answer only lands on the popover that asked:

```tsx
	const openBranches = (p: Project, x: number, y: number) => {
		setBranchMenu({ project: p, x, y, branches: null });
		// only the popover that asked gets the answer
		const fill = (list: string[]) =>
			setBranchMenu(m =>
				m && m.project.full_path === p.full_path ? { ...m, branches: list } : m
			);
		invoke<string[]>('get_remote_branches', { project: p })
			.then(fill)
			.catch(e => {
				toast(showError(e));
				fill([]);
			});
	};
```

`buildBranchMenu` assembles the entries: *Open repo on GitHub* first — the same `open_remote` the context menu's *Open remote* has called since chapter 10; one command, two doors — then a separator, the current branch with the hint `current`, then the rest: *Loading branches…* while `null`, *No other branches on the remote* when the list minus the current one is empty, otherwise one entry per branch. The two placeholders are `disabled` entries (`MenuAction` has had `disabled` since chapter 15), so they neither highlight nor close the menu. The host name is the host's own spelling for the four that have one (`GitHub`, `GitLab`, `Bitbucket`, `Codeberg`) and the bare hostname otherwise, because *on github* reads as a typo and *on github.com* reads as a URL — `HOST_NAMES` and `hostOf` sit at module level beside `showError`. `handleOpenRemote(p, branch?)` passes `branch ?? null`; the context-menu and palette callers pass nothing and open the root as before.

> `✅UI: branch popover on the chip`

## 32.5 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **122** — chapter 31's 120 plus two for git. Then, with the config files backed up and the distro left stopped:

**The list.** `bun tauri dev`. Every row with a remote carries a chip whose title reads `<branch> — branches on <remote>`. Click `devgo`'s (real mouse events over CDP): 80 ms later the popover reads *Open repo on GitHub* and *Loading branches…*; a moment later, *Open repo on GitHub*, `<branch> · current`, then one entry per remote branch — `git for-each-ref refs/remotes/` in that repo prints the same names plus `origin/HEAD` and the current branch, so the popover has two fewer entries than there are refs. Nothing called *origin* is in the list.

**The cache.** `Escape`, click the chip again: *Loading branches…* never appears — the second open is the cached list.

**The link.** Click `01.scaffold`: the popover closes and the browser opens `https://github.com/joyahmed/devgo/tree/01.scaffold` — a new tab in your own browser, which is the one thing in this book's Verify sections that cannot be closed from a script: a browser exposes no tab tree to UIA, so the tab stays until a person closes it. Open one, not five.

Restore the files.

> `✅STAGE: 32 remote-branches`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/git.rs     GitInfo.remote_branches; parse_remote_refs; remote_branches; branch_url; 2 tests
  src/commands.rs, lib.rs get_remote_branches; open_remote(full_path, branch)
src/
  components/ProjectTree.tsx  GitBadge asks for the popover; onOpenBranches through RowMeta and ProjectRow
  App.tsx                     HOST_NAMES, hostOf; branchMenu, openBranches, buildBranchMenu; a fourth ContextMenu
  types.d.ts                  GitInfo.remote_branches; BranchMenu; onOpenBranches
```

The branch chip opens a popover: the repo on its host, the current branch, and every branch the last fetch knew about — each a link to that branch's page, on GitHub, GitLab, Bitbucket or a Gitea-family host.

> **The thread running through this chapter.** One new capability and two doors that already existed. The capability's only real question was *when* — and the answer that keeps chapter 27's work intact is **never in the pass, always on the click**, with the host's own URL shape decided where the host is known.
