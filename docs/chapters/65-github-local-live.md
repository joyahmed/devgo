# 65 — The Local Mark, Live

**Branch:** `65.github-local-live` — `git checkout 65.github-local-live` gives you this chapter's finished app; `git diff 64.filesystems 65.github-local-live` is exactly what this chapter adds.

**Starting from:** chapter 64 — every file system, named.

**Goal:** the GitHub row's *local* mark tracks the disk. It did not: after a repo was cloned and its folder deleted, the row kept the mark and offered no *Clone into…* until the app was closed and reopened. After this chapter a clone marks its row in the pass that shows the new project, and a folder deleted on disk loses its mark — and gets *Clone into…* back — on the next pass of any kind: ↻, `F5`, the header's own refresh, or the focus pass.

> **Hold on to:**
> 1. **Find the root cause in the code before touching it.** The mark was already re-read after every badge pass (34's `useEffect(reload, [git])`), so *not live* was not a missing trigger. It was what the trigger read: `state.git_cache` is insert-only (`get_git_info` inserts and never removes — *in memory only, for the same reason as git: a name read yesterday looks current*), and `get_github_repos` ran `local_matches` over `git.values()` — every remote the process ever badged, a deleted clone included, until the next launch emptied it.
> 2. **The list is the truth; the cache is where its remotes are kept.** The fix is not to prune the cache (a second invariant to keep) but to feed `local_matches` the *current* projects — the projects cache every pass writes — and look each one's remote up. One pure function, `current_remotes`, and the command reads it.
> 3. **A derived value's dependencies are the things it is made of.** The mark is made of the list and the badges, so the hook re-reads on both: `useEffect(reload, [projects, git])`. A pass that badged nothing still painted a new list.

> Rust: a function returning `impl Iterator<Item = (&'a str, &'a str)>` borrows from two arguments under one lifetime `'a`; `filter_map` with `?` inside the closure (`git.get(&p.full_path)?`) is `Option`'s `?`, and a `None` skips the row.

---

## 65.1 — Where the mark comes from

Read before typing: `GithubPayload.local` is a `HashMap<full_name, path>` the command computes on every `get_github_repos`; nothing about *local* is stored on the row (`Repo` has `added`, not `local`), so there is no cached field to remove. The frontend (`useGithub`) keeps the payload and the lane reads `payload.local[repo.full_name]`; the row shows the word *local* and its menu swaps *Clone into…* for *Show local project*. `reload()` ran on mount and on every change of `git`, the badge map — so after a clone the mark *did* appear (the new path is unseen, `apply` badges, `git` changes, reload) — and after a delete a full ↻ replaced the frontend's `git` map without the gone path, reloaded, and the command answered from Rust's `git_cache`, which still had it.

Two sentences: the mark was computed from every remote the process had ever seen, not from the projects it currently lists; and nothing ever removed a remote from that memory but a restart.

## 65.2 — The remotes of the projects listed

`github.rs`, imports `super::git::GitInfo` and `crate::models::Project`, and before `clone_urls`:

```rust
/// The remotes the local mark is allowed to see: one per project in the
/// list right now, looked up in the git cache. The cache is insert-only
/// and remembers every project the session ever badged, a deleted clone
/// included; the list is what is on disk this pass. So the list is the
/// truth and the cache is only where its remotes are kept.
pub fn current_remotes<'a>(
    projects: &'a [Project],
    git: &'a HashMap<String, GitInfo>,
) -> impl Iterator<Item = (&'a str, &'a str)> {
    projects.iter().filter_map(|p| {
        git.get(&p.full_path)?
            .remote
            .as_deref()
            .map(|r| (p.full_path.as_str(), r))
    })
}
```

`local_matches` is untouched: it already takes an iterator of `(path, remote)`. The test, `a_deleted_clone_leaves_the_local_mark_with_the_list`: a git cache holding two remotes, a list holding one project; `current_remotes` yields the one; through `local_matches` over `SAMPLE`, the first sample row is marked and the third — whose folder is gone — is not, *"clone is back"*.

`commands.rs`, `get_github_repos`:

```rust
    let local = {
        // the projects cache is what every pass just wrote, a deleted
        // folder gone from it; the git cache alone remembered that folder
        // until the next launch, and its row kept the mark
        let listed = state.cache_store.lock().map_err(lock_err)?.all_projects();
        let git = state.git_cache.lock().map_err(lock_err)?;
        github::local_matches(
            &cache.repos,
            github::current_remotes(&listed, &git),
        )
    };
```

`ProjectCacheStore::all_projects` (06) is every workspace's last scan — a live workspace's list from this pass, a stopped distro's from its last, exactly what the frontend shows. The `local` field's doc: *over the projects listed right now, with the remote the last badge pass read; the frontend re-reads after every pass, either kind*. Why Rust and not the hook: `repo_key` (34) already lives here with its three tests — the trailing slash, the `.git`, the case — and a mark derived in TypeScript would spell that rule a second time, untested.

> `✅GITHUB: local marks over the projects listed`

## 65.3 — The hook re-reads on both

`useGithub.ts` takes the list too:

```ts
export const useGithub = (
	projects: Project[],
	git: Map<string, GitInfo>
): GithubState => {
	…
	// the local map is rust's, over the projects listed and the remotes
	// the badge pass read: re-read when either lands. a pass paints a new
	// list whether or not it badged, so a deleted clone loses its mark on
	// the next pass of any kind; a clone that just landed gains it when
	// its badge arrives. the first run is the mount
	useEffect(reload, [projects, git]);
```

`App.tsx`: `useGithub(projects, git)`. Every pass ends in `setProjects` with a new array — `runPass` (↻, `F5`, the focus pass, the retry), `refreshWorkspace` (the header's own) — so every one of them reloads the payload.

> `✅HOOKS: github re-reads on every pass`

## 65.4 — A clone lands through the pass

`App.tsx`, the `useClone` callback: the `github.reload()` after `refresh()` goes. The pass it starts paints the list (reload), and the badge that pass reads is what marks the row (reload again, with the remote). One trigger, the same one every other change of the disk has.

```ts
	// clones: the queue lives in the hook. a finished one rescans so the new
	// project row appears, and that pass is what marks its github row local
	const clone = useClone((dest: string) => {
		toast(`Cloned into ${dest}`, 'success');
		refresh().catch(() => {});
	});
```

`AddRepo`'s `github.reload()` stays: a hand-added row is not a pass.

> `✅APP: a clone lands through the pass`

## 65.5 — Verify

`cargo test` **196** (195 + the one above; 62's probe ignored), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. One dev launch, fourteen files backed up by hash, the installed DevGo stopped first, WSL running (not by us) and left alone. Headless over CDP; nothing opened a browser.

- **The scratch workspace:** `G:\devgo-scratch-65` made on disk, added through the app's own `add_workspace` (⚠️ the first try from an inline shell string arrived as `G:devgo-scratch-65` — the backslash rule from 63; removed by index, re-added from a script file), a `location.reload()` so the picker's list has it. The repo: `joyahmed/windows-tools`, public, 1 KB on GitHub, already in the cache (382 rows).
- **The clone, through the lane:** the GitHub box set to `windows-tools`, the row right-clicked → **`Clone into…`** → the picker with **`Clone 1 repo`** preselected, the `<select>` set to `G:\devgo-scratch-65`, the button clicked, sampled every 50 ms. The tree row `devgo-scratch-65 · windows-tools · Windows · main` at **4172 ms**; the GitHub row's **`local`** — title *Cloned at G:\devgo-scratch-65\windows-tools. Click to show it* — at **5742 ms**: the pass painted the list, its badge pass (`git.exe` over every project, cold) took the 1.57 s between, and the mark came with the badge. The row's menu then reads *Open on GitHub · Enter*, **`Show local project`** — no *Clone into…*. No restart.
- **↻:** the folder `rm -rf`'d on disk, the title-bar Refresh clicked (`title="Refresh (F5)"`), sampled: tree row gone and **mark gone at 240 ms**, in the same sample; the menu reads **`Clone into…`** again.
- **The focus pass:** cloned again (row at 3980 ms, mark at **52 ms after it** — this time the remote was already in `git_cache` from the first clone, which is the whole point: the *list* decides), folder deleted, **62 s** waited (46's cooldown, still 60 s here since the clone's pass), the window minimised over `plugin:window|minimize`, then 62's restore (`ShowWindow(hwnd, 9)` + `SetForegroundWindow` on the process's one `IsIconic` window; the sampler already running): mark and tree row gone at **1742 ms** on the sampler's clock, ~0.7 s after the restore call, no click. *Clone into…* back.
- **`F5`:** cloned a third time (row 3980 ms, mark +52 ms), folder deleted, a `keydown F5` dispatched on `window` (the handler is 11's `window.addEventListener`; a synthetic event, not a CDP key — `fire('refresh', handleRefresh)` is the same `refresh(true)` ↻ calls): **gone at 309 ms**.
- The header's own refresh (`refreshWorkspace`, 63) not clicked: it ends in the same `setProjects`, and a per-workspace pass over `G:\devgo-scratch-65` alone would have been the same proof with fewer `git.exe`.
- **Cleanup:** the scratch workspace removed through `remove_workspace` (the list back to seven), `G:\devgo-scratch-65` deleted; `workspaces.json` hash-equal before the restore. The picker remembered `G:\devgo-scratch-65` in the WebView's `localStorage` (34's `WS_KEY`); harmless — it falls back to the first workspace when the saved one is not in the list.

The dev build stopped (1420 free), `sha256sum -c`: **14 OK, 0 mismatches** (`prefs.json`, `projects-cache.json`, `instance.lock` had changed — `retain_known` dropped the deleted clone's stats, as 09 says it should). The installed DevGo relaunched through `explorer.exe` (parent `explorer`, pid 175944 at 18:25).

> `✅STAGE: 65 github-local-live`; ff-merge; push.

---

## What you built

```
src-tauri/src/services/github.rs  current_remotes + 1 test
src-tauri/src/commands.rs         get_github_repos over the projects listed
src/hooks/useGithub.ts            useGithub(projects, git); reload on both
src/App.tsx                       the call; the clone lands through the pass
```

- **A local mark that is a function of the list** — what is on disk this pass, with the remote the badge pass read — and nothing the process merely remembers.
- **One trigger for every change of the disk:** a pass. A clone, a delete, ↻, `F5`, the header's refresh and the focus pass all end in a new list, and the list is what the hook watches.
- **A root cause named before the fix:** the insert-only `git_cache` behind a `values()` call. The cache still grows for the life of the process; it no longer decides anything.
