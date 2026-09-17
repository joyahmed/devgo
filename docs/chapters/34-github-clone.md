# 34 — Get It on Disk (post-plan)

**Branch:** `34.github-clone` — `git checkout 34.github-clone` gives you this chapter's finished app; `git diff 33.github-catalog 34.github-clone` is exactly what this chapter adds.

**Starting from:** chapter 33 — a GitHub group that finds any of your repositories in three keystrokes and opens its page. Finding is half of the problem. The other half is that the repo is *there* and the work is *here*.

**Goal:** a repo row can be cloned into a workspace; several can be ticked and cloned in one go; a repo you do not own can be added to the group by name. One `git clone` — the only git *operation* DevGo performs — off-thread, with progress in the row.

> **Hold on to:**
> 1. **A plan before a process.** Destination, transport and distro are decided as data (`Plan`) and tested as data; the process comes after, and only after every refusal has had its say.
> 2. **The host-level protocol.** `gh auth login` writes `git_protocol` per host; the global setting can disagree with it (`ssh` at the host, `https` globally, after a login that chose SSH).
> 3. **Inside the distro.** A WSL workspace clones at the Linux path with the distro's own `git` — native speed, native line endings, and the same liveness gate as everything since chapter 06.
> 4. **One at a time.** Rust runs one clone and reports by event; the queue is the frontend's.
>
> Rust: `let Some(..) = .. else { return .. }`; `impl FnMut(&str)` as a progress callback; `BufRead::fill_buf` / `consume` to split on two delimiters; `Stdio::piped()` on stderr only; an `async` command with `tauri::async_runtime::spawn_blocking` and `??`. TypeScript: `useRef` for a queue the event listeners read without resubscribing; a hook whose callback is kept in a ref so the listener is subscribed once; a `<select>` remembered in `localStorage`.

> Two needs sit behind this chapter, and *add* covers both: get a row onto this disk, and put a stranger's repo into the group without cloning it. The bulk form of the first is the chapter-30 picker pointed the other way — tick the repositories you want, choose where they land.

---

## 34.1 — Protocol and URL, from `gh`

`services/clone.rs` opens with the two decisions that need no filesystem:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Ssh,
    Https,
}

impl Protocol {
    pub fn parse(text: &str) -> Option<Self> {
        match text.trim() {
            "ssh" => Some(Self::Ssh),
            "https" => Some(Self::Https),
            _ => None,
        }
    }

    pub fn detect() -> Self {
        let read = |args: &[&str]| {
            Command::new("gh")
                .creation_flags(CREATE_NO_WINDOW)
                .args(args)
                .output()
                .ok()
                .filter(|o| o.status.success())
                .and_then(|o| {
                    Protocol::parse(&String::from_utf8_lossy(&o.stdout))
                })
        };
        read(&["config", "get", "-h", "github.com", "git_protocol"])
            .or_else(|| read(&["config", "get", "git_protocol"]))
            .unwrap_or(Self::Https)
    }
}
```

Host-level first, then global, then `https`. ⚠️ Not pedantry: after a `gh auth login` that chose SSH, `gh config get -h github.com git_protocol` says `ssh` while `gh config get git_protocol` still says `https`, and only the host one has a key behind it — reading the wrong level would have produced a clone that asks for a password. The user chose once, at `gh auth login`; DevGo reads the choice. `clone_url(full_name, protocol)` builds `git@github.com:{full_name}.git` or `https://github.com/{full_name}.git`; `folder_name(repo_name, wanted)` is the repo's own name unless the caller gave one, and refuses a slash, `..` or `.` with `AppError::CloneRefused` — a name is a name, not a path. Two tests. `pub mod clone;` in `services/mod.rs`.

> `✅CLONE: protocol and url from gh` — **134** tests.

## 34.2 — A plan before a process

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    /// the path DevGo will show and scan: <workspace>\<name> in the
    /// workspace's own form (UNC for WSL, drive for Windows)
    pub dest: String,
    /// Some(distro) when the clone runs inside WSL
    pub distro: Option<String>,
    /// the path handed to git: Linux inside a distro, Windows otherwise
    pub git_dest: String,
    pub url: String,
}

pub fn plan(
    workspace: &str,
    repo_full_name: &str,
    name: &str,
    protocol: Protocol,
) -> Plan {
    let ws = workspace.trim_end_matches(['\\', '/']);
    let dest = format!("{ws}\\{name}");
    let distro = distro_of(workspace);
    let git_dest = match &distro {
        Some(d) => windows_to_wsl_path(&dest, d),
        None => dest.clone(),
    };
    Plan {
        dest,
        distro,
        git_dest,
        url: clone_url(repo_full_name, protocol),
    }
}
```

**A WSL workspace clones inside the distro.** `\\wsl.localhost\Ubuntu-26.04\home\user\projects\app` becomes `/home/user/projects/app` (chapter 05's `windows_to_wsl_path`) and the command will be `wsl -d Ubuntu-26.04 -e git clone --progress <url> <linux path>`. A clone *through* the UNC path goes over 9p — slow — and leaves CRLF behind; a clone *inside* is native speed and native line endings.

```rust
pub fn refuse_if_needed(
    plan: &Plan,
    running: &[String],
) -> Result<(), AppError> {
    if let Some(d) = &plan.distro {
        // the liveness gate, as everywhere: a clone into a stopped distro
        // would boot it, and the user asked for a clone, not a boot
        if !wsl::is_running(d, running) {
            return Err(AppError::CloneRefused(format!(
                "{d} is not running. Start it (open any project in it) and clone again"
            )));
        }
    }
    if std::path::Path::new(&plan.dest).exists() {
        return Err(AppError::CloneRefused(format!(
            "{} already exists. Remove it or pick another name",
            plan.dest
        )));
    }
    Ok(())
}
```

Every reason not to start, before starting. Four tests: a Windows workspace plans a Windows path and no distro; a WSL one plans the UNC `dest`, the distro, and the Linux `git_dest`; a stopped distro is refused with *not running* and a running one is accepted (the made-up UNC path does not exist); an existing destination in `temp_dir` is refused with *already exists*.

> `✅CLONE: a plan before a process` — **138** tests.

## 34.3 — Run, with progress

`--progress` makes git print its percentages even without a terminal, and it rewrites them in place with `\r` — so `run` reads stderr up to *either* `\r` or `\n`, which is a `read_until_either` of a dozen lines over `fill_buf`/`consume`, because `BufRead::read_until` takes one byte. Each line goes to the caller through `on_line: impl FnMut(&str)`; the last `fatal:`/`error:` line is kept as the failure message. `parse_progress` reduces `Receiving objects:  42% (1234/2938), 1.20 MiB | 2.40 MiB/s` to `("Receiving objects", Some(42))`, which is all a row has room to say; a line with no percentage comes back with `None`. stdout is `Stdio::null()`, stdin too, `CREATE_NO_WINDOW` as always, `WSL_UTF8=1` on the WSL form. Two tests: the four progress shapes, and `a\rbb\nccc` splitting into three.

> `✅CLONE: run git with progress` — **140** tests.

## 34.4 — Added rows survive a refresh

`Repo` gains `added: bool` under `#[serde(default)]` — put there by hand, not by `gh repo list`. `GithubStore::store` — the refresh — becomes a merge: every `added` row the fetch did not return is kept, then the list is re-sorted newest-first; `add(repo)` sets the flag, replaces a previous copy of the same `full_name`, and saves. They are not your repositories; the list would never bring them back on its own. The test adds a stranger, refreshes with a list that does not contain it, and checks the stranger stayed while an ordinary old row would not; adding twice is one row.

> `✅GITHUB: added rows survive a refresh` — **141** tests.

`parse_spec` turns whatever a person pastes into `owner/name` — the bare form, `https://github.com/…` with or without `.git`, a trailing slash or a `/tree/main/src` tail, `github.com/…`, `git@github.com:…`, `ssh://git@github.com/…` — nine forms in the test, and `None` for no owner, another host, or a space in a name: a guess here would send `gh` a stranger. `view_repo(full_name)` is `gh repo view … --json <the same fields>`, which prints one element of what `gh repo list` prints a list of, so the parser is shared by wrapping the object in `[…]`.

> `✅GITHUB: parse_spec and view_repo` — **142** tests.

## 34.5 — Two commands

```rust
#[tauri::command]
pub fn clone_repo(
    full_name: String,
    workspace: String,
    name: Option<String>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<CloneStarted, AppError> {
    // not because a stranger could call it: because a stale picker could,
    // after a workspace was removed underneath it
    if !state
        .workspace_store
        .lock()
        .map_err(lock_err)?
        .list()
        .contains(&workspace)
    {
        return Err(AppError::CloneRefused(format!(
            "{workspace} is not one of your workspaces"
        )));
    }
    let repo_name = full_name
        .rsplit('/')
        .next()
        .unwrap_or(&full_name)
        .to_string();
    let folder = clone::folder_name(&repo_name, name.as_deref())?;
    let protocol = clone::Protocol::detect();
    let plan = clone::plan(&workspace, &full_name, &folder, protocol);
    // the liveness list only matters for a WSL workspace; a Windows one
    // skips the wsl.exe spawn entirely, same as the scanner
    let running = if plan.distro.is_some() {
        wsl::running_distros_memo()
    } else {
        Vec::new()
    };
    clone::refuse_if_needed(&plan, &running)?;

    let started = CloneStarted {
        full_name: full_name.clone(),
        dest: plan.dest.clone(),
        protocol,
    };
    std::thread::spawn(move || {
        let result = clone::run(&plan, |line| {
            let (phase, percent) = clone::parse_progress(line);
            let _ = tauri::Emitter::emit(
                &app,
                "devgo://clone-progress",
                serde_json::json!({
                    "full_name": full_name,
                    "phase": phase,
                    "percent": percent
                }),
            );
        });
        let error = result.as_ref().err().map(|e| e.to_string());
        let _ = tauri::Emitter::emit(
            &app,
            "devgo://clone-done",
            serde_json::json!({
                "full_name": full_name,
                "ok": result.is_ok(),
                "dest": plan.dest,
                "error": error
            }),
        );
    });
    Ok(started)
}
```

Returns as soon as the refusals have been checked and the thread started — a refusal is the command's own error, so the row shows *clone failed* with the reason rather than a job that died. The liveness list is read through chapter 27's memo, and only for a WSL workspace; a Windows one skips the `wsl.exe` spawn entirely, same as the scanner. `CloneStarted { full_name, dest, protocol }` is the answer.

> `✅CMD: clone_repo on a thread`

`add_github_repo(spec)` is the first `async` command in the book: `gh repo view` is one network call, about 0.6 s, and `tauri::async_runtime::spawn_blocking` keeps it off the async runtime's workers too; the store is locked only after `gh` has answered (`State<'_, AppState>` for the lifetime, `??` to unwrap the join and then the result). Both registered.

> `✅CMD: add_github_repo` — `cargo check` 0 warnings.

## 34.6 — The row says what is happening

`GithubRepo.added` in `types.d.ts`; the row shows `added` in the meta cell when the flag is on and no `local` mark is.

> `✅UI: rows carry the added mark`

`hooks/useClone.ts` is the queue. The Rust command knows nothing of queues; the hook starts the next job when `devgo://clone-done` arrives for the current one — parallel clones of a ticked list of thirty repositories are a way to get rate-limited and a way to fill a disk; one at a time, with the row saying which, is what a person would do by hand. `jobs: Map<string, CloneJob>` is state; the queue and the running name are refs so the two listeners, subscribed once, see the live values; `onCloned` is kept in a ref for the same reason. A refusal fails that job at once and the queue moves on; nothing is retried on its own. `CloneJob`, `CloneStarted`, `CloneProgress`, `CloneDone`, `CloneState` in `types.d.ts`.

> `✅HOOK: useClone runs one at a time`

A clone in flight takes the time's slot in the row — it is the one moment the row has something more current to say: *queued*, *Cloning into 'C…*, *Receiving objects 42%*, *Resolving deltas 100%*, or *clone failed* in `text-danger` with the reason as the title. `jobs` threads through `ProjectTreeProps.cloneJobs` → `GithubLaneProps.jobs` → `RepoRowProps.job`.

> `✅UI: clone progress in the row`

A `+` ghost `Button` joins the ↻ in the header's third column, reporting its rectangle so App can open a two-entry menu under it (`onGithubAddMenu` → `onAddMenu`).

> `✅UI: a plus on the github header`

## 34.7 — The picker, pointed the other way

`ClonePicker` is chapter 30's `ScanPicker` shape: a search box over `full_name` with the palette's `fuzzyScore`, one checkbox per row, *Tick shown* / *Untick shown*, a *Clone N repos* button. Rows already on this disk are listed **ticked and disabled** with `local` in place of the time — the answer to *"is it here?"* sits on the same screen as the button. The destination is a `<select>` of workspaces (`lastSegment · path`) that remembers your last choice in `devgo.cloneWorkspace`, because a second batch usually goes where the first one went. `ScanPicker`'s row-tone helper moves to `rowStyles.ts` as `pickTone` so both pickers share it.

> `✅UI: clone picker`

`AddRepo` is one box and one button: `owner/name` or a URL, `Enter` or *Add to the list*, the error under the box (`"nonsense" is not owner/name or a GitHub url`), the parsing and the `gh repo view` in Rust.

> `✅UI: add a repo by name`

**App.** `useClone` with a callback that toasts *Cloned into …*, rescans (`refresh()`) so the new project row appears, and re-reads the GitHub payload (`github.reload()`) so the repo row gains its `local` mark. Two `Modal`s — *Clone from GitHub* (`ClonePicker`, `w-[min(680px,92vw)]`) and *Add a repo by name*. Two doors into the picker: the `+` menu (*Clone repos…*, disabled with the hint *add a workspace first* when there is nowhere to land; *Add repo by name…*, disabled when logged out) and *Clone into…* on a row's menu — present only while the row is not local, disabled while that row is cloning — which opens the picker with that row pre-ticked. Two palette commands: *GitHub: clone repos…* and *GitHub: add repo by name…*.

> `✅UI: clone and add wired into app` — `bun run build` clean.

## 34.8 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **142** — chapter 33's 132 plus eight for clone and two for github. Compare `gh config get -h github.com git_protocol` with `gh config get git_protocol`; after a login that chose SSH they disagree, and the host one is the one that counts. Back up the six files. Nothing in this section opens a browser.

**Setup.** `bun tauri dev` with the distro stopped. Add a scratch Windows workspace (`add_workspace_folders` over CDP, then reload) — clones land there and are deleted after. The header reads `▼ GitHub · user · updated 57 min ago · + ↻ · 382`.

**Refused, not booted.** `+` → *Clone repos…*: the picker lists 382 rows and eight workspaces. `tools` ticked into `01_turbo` (a WSL workspace, distro stopped) → *Clone 1 repo*: toast *Cloning tools into 01_turbo…*, and the row reads *clone failed* with the title `Ubuntu-26.04 is not running. Start it (open any project in it) and clone again`. `wsl -l -v`: still *Stopped*.

**Two at a time, one at a time.** Palette → *GitHub: clone repos…*; tick `notes` and `tools`, select the scratch workspace, *Clone 2 repos*: toast *Cloning 2 repos into ws34, one at a time…*, `devgo.cloneWorkspace` remembered. Both are 1 KB and finish inside the first poll; both rows carry `local`, both folders exist, and a `ws34` header with `notes` and `tools` rows has appeared above. Through the command directly: `notes` again → `…\ws34\notes already exists. Remove it or pick another name`; `name: "a/b"` → `a/b is not a folder name`; a workspace not in the store → `… is not one of your workspaces`.

**Progress, from the row's menu.** Right-click `shop` (2 MB): *Open on GitHub*, **Clone into…**, the two clone URLs. *Clone into…* opens the picker with eighteen `local` rows ticked-and-disabled and `shop` pre-ticked (*1 ticked*). *Clone 1 repo*, polling the row every 700 ms: *Cloning into 'C…* → *Receiving objects 12%* → *48%* → `3 y ago` → `local` once the reload lands.

**Inside the distro.** `wsl -d Ubuntu-26.04 -e sh -c 'mkdir -p /tmp/devgo34'` (the one thing that starts the distro), add `\\wsl.localhost\Ubuntu-26.04\tmp\devgo34` as a workspace, reload. In the picker `shop` is now ticked-and-disabled with the title `Already here: …\ws34\shop`. Tick `api`, select `devgo34`: *Cloning into '/tmp/devgo34/api'…* → *Receiving objects 34%* → *Resolving deltas 100%* → `local`. From WSL: `file README.md` → `ASCII text` (no CRLF), `git remote get-url origin` → `git@github.com:user/api.git` — the host-level protocol.

**By name.** Palette → *GitHub: add repo by name…*, paste `https://github.com/tauri-apps/tauri/tree/dev/crates`, `Enter`: toast *Added tauri-apps/tauri to the GitHub list*, the row `tauri-apps | tauri | GitHub | added · dev · 2 h ago`, `added: true` in the cache. `nonsense` → `"nonsense" is not owner/name or a GitHub url` under the box. Header ↻: *refreshing…* → *updated just now · 382* and the `tauri-apps/tauri` row is still there, the only `added` one.

Remove `devgo.cloneWorkspace` from `localStorage`, `Ctrl+Q`, restore the six files, delete the scratch clones, `rm -rf /tmp/devgo34`, `wsl --shutdown`.

> `✅STAGE: 34 github-clone`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/clone.rs   Protocol, clone_url, folder_name, Plan, plan, refuse_if_needed,
                          parse_progress, run, read_until_either; 8 tests
  src/services/github.rs  Repo.added; store merges, add, save; parse_spec, view_repo; 2 tests
  src/commands.rs, lib.rs clone_repo (thread + two events), add_github_repo (async), CloneStarted
  src/error.rs            CloneRefused
src/
  hooks/useClone.ts       the queue: one at a time, off devgo://clone-done
  components/ClonePicker.tsx  tick, choose a workspace, Clone N repos
  components/AddRepo.tsx  owner/name or a URL
  components/GithubLane.tsx   added mark, job line in the time's slot, + on the header
  components/rowStyles.ts pickTone (from ScanPicker)
  components/ProjectTree.tsx  cloneJobs, onGithubAddMenu passed through
  App.tsx                 useClone, two Modals, the + menu, Clone into…, two palette commands
  types.d.ts              GithubRepo.added; CloneJob, CloneStarted, CloneProgress, CloneDone,
                          CloneState, ClonePickerProps, AddRepoProps, ClonePickerRequest
```

A repo row can be cloned into a workspace — inside the distro for a WSL one — several at a time from a picker, with progress in the row; and a repository you do not own can join the group by name.

> **The thread running through this chapter.** The one git *operation* in the app, and it is built like everything before it: decided as data, refused before it starts, run off the UI thread, reported by event, one at a time. The disk is either exactly as it was or has one more clone in it — never something in between.
