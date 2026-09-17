# 10 — Git at a Glance (Slice 2)

**Branch:** `10.git` — `git checkout 10.git` gives you this chapter's finished app; `git diff 09.summon-rank 10.git` is exactly what this chapter adds.

**Starting from:** Slice 1 — a launcher you summon with one keystroke, that puts the thing you were working on at the top. The list tells you a project's name, its workspace, and whether it lives on Windows or in WSL.

**Goal:** two more facts per row — what branch, and is it dirty — plus the remote behind a click and a "recently worked on" sort. Read without ever starting a stopped WSL distro.

> **Hold on to:**
> 1. **Every feature that could trigger the expensive behaviour opts into the same gate.** `git::collect` takes the `running` list the scanner takes; a stopped distro's projects are skipped — no process, no boot. A gate only one call site respects is not a gate.
> 2. **Cross the boundary once, do the work on the far side.** Twenty WSL repos = one `wsl.exe` carrying one script, not twenty spawns. NUL-delimited output because NUL cannot appear in a path.
> 3. **`std::thread::scope`** — threads that borrow from the stack, joined before the scope ends, so no `Arc`, no clone; capped at eight so parallelism does not thrash the machine.
> 4. **Isolate parsing from I/O.** `parse_status`, `remote_to_url`, `parse_wsl_output` take a `&str` and return a value; eight tests, none spawn a process.
> 5. **Absence over placeholders.** No branch → render nothing. "unknown", a dash, a spinner are all claims, and every available claim is false.

> Scanning a list of repositories tells you nothing about their state. You know you have forty projects. You do not know which one you left half-finished on a feature branch on Friday.
>
> This slice adds the two facts worth having at a glance and then stops. No diff viewer, no staging, no commit UI — DevGo is a launcher, and a launcher that grows a git client has stopped being a launcher.
>
> It is also the chapter with the largest regression risk in the whole plan sitting in the middle of it. Shelling `wsl git` **starts a stopped distro.** Implemented naively, this chapter would silently undo everything chapter 06 built — on every single launch, for the sake of decorating rows. Most of the design below exists to make that impossible.

---

## 10.1 — The rule that shapes everything else

Before a line of git code, the principle:

> **Git state is a nicety. It is never worth starting a virtual machine for.**

Chapter 06 taught DevGo to *decline* to boot WSL: `scan_workspace` takes a `running` list, and a workspace whose distro is down is reported as `Unavailable` rather than scanned. Git reads are the perfect vector for undoing it, because they look harmless. `wsl -d Ubuntu git -C /home/user/x status` is a two-second command that returns a branch name. It also cold-boots Ubuntu. Run it once per WSL project on every launch and DevGo now *always* starts WSL, for a decoration.

So `git::collect` takes the same `running` list the scanner takes, and skips WSL projects whose distro is down. Not "shows them as unknown" — skips them entirely. The dangerous property of the bug is that it is **invisible in code review and invisible in testing**: on a developer machine where WSL is already running all day, nothing looks wrong. The only way to see it is `wsl --shutdown`, start DevGo, and check `wsl -l -v` afterwards — the headline item in §10.5.

---

## 10.2 — The service

Create `src-tauri/src/services/git.rs`. It is one file — a type, three parsers, two readers, and `collect` — and eight tests:

```rust
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

use super::platform::wsl;
use super::scanner::distro_of;
use crate::models::Project;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// How many Windows projects to interrogate at once. Each is three short-lived
/// `git` processes; unbounded spawning on a large workspace is worse than the
/// wait it saves.
const MAX_PARALLEL: usize = 8;

#[derive(Debug, Clone, Default, Serialize)]
pub struct GitInfo {
    pub full_path: String,
    pub branch: Option<String>,
    pub dirty: bool,
    pub remote: Option<String>,
    /// Unix seconds of the last commit, for "recently worked on" sorting.
    pub last_commit: u64,
}

/// Parse `git status --porcelain=v2 --branch`.
///
/// One invocation yields both facts we want: `# branch.head <name>` carries the
/// branch, and any line that is not a `#` header is a changed file, so the
/// presence of one means dirty.
fn parse_status(text: &str) -> (Option<String>, bool) {
    let mut branch = None;
    let mut dirty = false;
    for line in text.lines() {
        let line = line.trim_end();
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            // A detached HEAD reports "(detached)", which is worth showing as-is.
            branch = Some(rest.trim().to_string());
        } else if !line.starts_with('#') && !line.is_empty() {
            dirty = true;
        }
    }
    (branch, dirty)
}

/// Normalize a git remote into something a browser can open.
///
/// `git@github.com:joyahmed/devgo.git` and
/// `https://github.com/joyahmed/devgo.git` should both land on the same page.
pub fn remote_to_url(remote: &str) -> Option<String> {
    let remote = remote.trim().trim_end_matches(".git");
    if remote.is_empty() {
        return None;
    }
    if let Some(rest) = remote.strip_prefix("git@") {
        // host:owner/repo -> https://host/owner/repo
        let (host, path) = rest.split_once(':')?;
        return Some(format!("https://{host}/{path}"));
    }
    if let Some(rest) = remote.strip_prefix("ssh://git@") {
        return Some(format!("https://{rest}"));
    }
    if remote.starts_with("http://") || remote.starts_with("https://") {
        return Some(remote.to_string());
    }
    None
}

fn git_windows(path: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .creation_flags(CREATE_NO_WINDOW)
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        // Not a repository, or git is absent. Either way: degrade silently.
        None
    }
}

fn read_windows(project: &Project) -> GitInfo {
    let mut info = GitInfo {
        full_path: project.full_path.clone(),
        ..Default::default()
    };

    // Cheap gate: skip the process spawns entirely for non-repositories.
    if !std::path::Path::new(&project.full_path)
        .join(".git")
        .exists()
    {
        return info;
    }

    if let Some(text) = git_windows(
        &project.full_path,
        &["status", "--porcelain=v2", "--branch"],
    ) {
        let (branch, dirty) = parse_status(&text);
        info.branch = branch;
        info.dirty = dirty;
    }
    info.remote = git_windows(
        &project.full_path,
        &["config", "--get", "remote.origin.url"],
    )
    .and_then(|s| remote_to_url(&s));
    info.last_commit =
        git_windows(&project.full_path, &["log", "-1", "--format=%ct"])
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);

    info
}

/// Build one shell script that walks every WSL project in a distro.
///
/// The alternative — one `wsl.exe` per project — costs ~80ms of process startup
/// each. Batching means a single spawn no matter how many projects, with the
/// git calls running natively inside Linux where they are cheap.
fn wsl_script(linux_paths: &[String]) -> String {
    let mut script = String::from("set -f\n");
    for path in linux_paths {
        let p = path.replace('\'', "'\\''");
        script.push_str(&format!(
            "printf '\\0PROJECT\\0{path}\\0'\n\
             git -C '{p}' status --porcelain=v2 --branch 2>/dev/null\n\
             printf '\\0REMOTE\\0'\n\
             git -C '{p}' config --get remote.origin.url 2>/dev/null\n\
             printf '\\0COMMIT\\0'\n\
             git -C '{p}' log -1 --format=%ct 2>/dev/null\n"
        ));
    }
    script
}

fn parse_wsl_output(
    text: &str,
    windows_paths: &HashMap<String, String>,
) -> Vec<GitInfo> {
    let mut out = Vec::new();

    // Records look like: \0PROJECT\0<linux path>\0<status>\0REMOTE\0<url>\0COMMIT\0<ts>
    for record in text.split("\u{0}PROJECT\u{0}").skip(1) {
        let mut parts = record.split('\u{0}');
        let linux_path = parts.next().unwrap_or("").to_string();
        let status = parts.next().unwrap_or("");
        let rest: Vec<&str> = parts.collect();
        let remote = rest
            .iter()
            .position(|p| *p == "REMOTE")
            .and_then(|i| rest.get(i + 1).copied())
            .unwrap_or("");
        let commit = rest
            .iter()
            .position(|p| *p == "COMMIT")
            .and_then(|i| rest.get(i + 1).copied())
            .unwrap_or("");

        let Some(full_path) = windows_paths.get(&linux_path) else {
            continue;
        };
        let (branch, dirty) = parse_status(status);
        out.push(GitInfo {
            full_path: full_path.clone(),
            branch,
            dirty,
            remote: remote_to_url(remote),
            last_commit: commit.trim().parse().unwrap_or(0),
        });
    }
    out
}

fn read_wsl_batch(distro: &str, projects: &[&Project]) -> Vec<GitInfo> {
    let mut windows_paths = HashMap::new();
    let mut linux_paths = Vec::new();
    for p in projects {
        let linux =
            super::platform::paths::windows_to_wsl_path(&p.full_path, distro);
        windows_paths.insert(linux.clone(), p.full_path.clone());
        linux_paths.push(linux);
    }

    let output = Command::new("wsl")
        .creation_flags(CREATE_NO_WINDOW)
        .env("WSL_UTF8", "1")
        .args(["-d", distro, "-e", "bash", "-c", &wsl_script(&linux_paths)])
        .output();

    match output {
        Ok(out) if out.status.success() => parse_wsl_output(
            &String::from_utf8_lossy(&out.stdout),
            &windows_paths,
        ),
        _ => Vec::new(),
    }
}

/// Read git state for every project.
///
/// `running` is the live-distro list. A WSL project whose distro is stopped is
/// skipped entirely — shelling `wsl git` would cold-boot the VM, which is the
/// exact behaviour the scan gate exists to prevent. Git state is a nicety; it
/// is never worth starting a virtual machine for.
pub fn collect(projects: &[Project], running: &[String]) -> Vec<GitInfo> {
    let mut by_distro: HashMap<String, Vec<&Project>> = HashMap::new();
    let mut windows: Vec<&Project> = Vec::new();

    for p in projects {
        match distro_of(&p.full_path) {
            Some(distro) if wsl::is_running(&distro, running) => {
                by_distro.entry(distro).or_default().push(p);
            }
            // Stopped distro: no git, no boot.
            Some(_) => {}
            None => windows.push(p),
        }
    }

    let mut results: Vec<GitInfo> = Vec::new();

    for (distro, group) in &by_distro {
        results.extend(read_wsl_batch(distro, group));
    }

    for group in windows.chunks(MAX_PARALLEL) {
        std::thread::scope(|s| {
            let handles: Vec<_> =
                group.iter().map(|p| s.spawn(|| read_windows(p))).collect();
            for h in handles {
                if let Ok(info) = h.join() {
                    results.push(info);
                }
            }
        });
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_clean_state() {
        let text = "# branch.oid abc123\n# branch.head main\n# branch.upstream origin/main\n";
        assert_eq!(parse_status(text), (Some("main".into()), false));
    }

    #[test]
    fn any_non_header_line_means_dirty() {
        let text = "# branch.head main\n1 .M N... 100644 100644 100644 aaa bbb src/lib.rs\n";
        assert_eq!(parse_status(text), (Some("main".into()), true));
    }

    #[test]
    fn detached_head_is_reported_as_is() {
        let text = "# branch.oid abc\n# branch.head (detached)\n";
        assert_eq!(parse_status(text).0, Some("(detached)".into()));
    }

    #[test]
    fn empty_output_is_not_a_repo() {
        assert_eq!(parse_status(""), (None, false));
    }

    #[test]
    fn normalizes_ssh_remotes_to_browsable_urls() {
        assert_eq!(
            remote_to_url("git@github.com:joyahmed/devgo-app-private.git")
                .as_deref(),
            Some("https://github.com/joyahmed/devgo-app-private")
        );
        assert_eq!(
            remote_to_url("ssh://git@gitlab.com/group/repo.git").as_deref(),
            Some("https://gitlab.com/group/repo")
        );
        assert_eq!(
            remote_to_url("https://github.com/joyahmed/devgo.git").as_deref(),
            Some("https://github.com/joyahmed/devgo")
        );
    }

    /// A local path or an unrecognised scheme must not produce a link we would
    /// then hand to the OS to open.
    #[test]
    fn refuses_unbrowsable_remotes() {
        assert_eq!(remote_to_url(""), None);
        assert_eq!(remote_to_url("/srv/git/repo.git"), None);
        assert_eq!(remote_to_url("file:///srv/git/repo"), None);
    }

    #[test]
    fn wsl_script_escapes_quotes_in_paths() {
        let script = wsl_script(&["/home/joy/it's".to_string()]);
        assert!(script.contains(r"'/home/joy/it'\''s'"), "got: {script}");
    }

    #[test]
    fn parses_batched_wsl_output() {
        let mut map = HashMap::new();
        map.insert(
            "/home/joy/a".to_string(),
            r"\\wsl.localhost\D\home\joy\a".to_string(),
        );
        let text = "\u{0}PROJECT\u{0}/home/joy/a\u{0}# branch.head main\n1 .M x\n\
                    \u{0}REMOTE\u{0}git@github.com:o/r.git\n\u{0}COMMIT\u{0}1700000000\n";
        let out = parse_wsl_output(text, &map);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].branch.as_deref(), Some("main"));
        assert!(out[0].dirty);
        assert_eq!(out[0].remote.as_deref(), Some("https://github.com/o/r"));
        assert_eq!(out[0].last_commit, 1_700_000_000);
    }
}
```

Register it in `src-tauri/src/services/mod.rs` — `pub mod git;` after `frecency`.

### One command, two facts

`git status --porcelain=v2 --branch` returns both the branch (`# branch.head <name>`) and, in any non-`#` line, a changed file. The whole parse is: pull the name off the header, set `dirty` the moment you see a line that isn't one. Halving the spawn count is the small win; the real one is **atomic consistency** — two commands mean two moments in time, and a branch read before a `git checkout` with a dirty flag read after it were never simultaneously true. **When one call can answer two questions, prefer it — not for the speed, but because two calls can disagree.** A detached HEAD reports `(detached)` and is passed through as-is: the literal truth git told us.

### Remotes we are willing to hand to the OS

`remote_to_url` recognises three shapes — `git@host:owner/repo`, `ssh://git@host/…`, `http(s)://` — and returns `None` for everything else. The tempting fourth branch is a fallback that prefixes `https://` and hopes. Follow what the value becomes: it is eventually passed to `cmd /c start` — **handed to the operating system to open**. `/srv/git/repo.git` would become `https:///srv/git/repo`; `file:///…` would open a path that has nothing to do with a project page. `refuses_unbrowsable_remotes` is the test whose entire job is asserting that certain inputs produce **no** link, and the frontend renders such a branch as plain text — the affordance disappears with the capability. **When a value will be handed to something outside your process, "I don't know" must be representable, and it must be the default for anything you don't explicitly recognise.**

### Windows: skip the spawn when you can *(skip on first pass)*

`read_windows` checks `.git` exists before spawning anything. A workspace is rarely all repos, a filesystem stat is microseconds, a process spawn is milliseconds, and the check is exactly as accurate for the question asked. **The cheapest question that can rule out the expensive one is worth asking first** — the same instinct as `distro_of` before `wsl.exe` in chapter 06. `CREATE_NO_WINDOW` on every spawn, or forty `git` invocations at once is a strobe light. Git absent, or not a repository, take the same silent path: there is nothing for the user to do about either.

### WSL: one script, not one process per project *(skip on first pass)*

Each `wsl.exe` invocation is a Windows process launch that crosses into the VM — roughly 80 ms before git does anything. `wsl_script` builds one bash script that walks every project in a distro, and `read_wsl_batch` runs it with a single spawn; the git calls run natively inside Linux where a spawn is a fork. The cost is a wire format: `\0PROJECT\0`, `\0REMOTE\0`, `\0COMMIT\0` delimiters, NUL because it is the one byte that cannot appear in a path, a branch or a URL. `parse_wsl_output` reverses it; every `unwrap_or` is deliberate — output from a script whose commands may fail must produce empty values, never a panic.

Paths are single-quoted, and single quotes cannot escape themselves — so a path ending in `it's` is written `'…/it'\''s'` (close, escaped literal, reopen). `wsl_script_escapes_quotes_in_paths` pins it. **Anything you interpolate into a shell needs the escaping for that target — including when today's inputs are all benign.** `set -f` stops bash expanding a `*` in a path; `2>/dev/null` makes a non-repo contribute empty output between its markers; `WSL_UTF8=1` is chapter 04's fix, doubly needed here because UTF-16 would interleave NULs with our delimiter.

### `collect`: the gate, and bounded parallelism

The three-arm `match` is §10.1 as code:

| Arm | Meaning | Action |
|---|---|---|
| `Some(distro) if is_running(…)` | WSL, distro up | group it for the batch |
| `Some(_)` | WSL, distro **down** | **nothing** — no git, no boot |
| `None` | a Windows path | read it directly |

The middle arm is an empty block, and empty blocks attract deletion. The comment on it names the consequence of removing it, not what the code does — the same reason chapter 06's `Unavailable` arm carries one. **The code most in need of a comment is the code whose absence would be invisible.**

Windows projects are read on scoped threads, `MAX_PARALLEL` at a time. The work is almost entirely waiting, so eight at once genuinely takes an eighth of the time — and the cap matters as much as the parallelism: unbounded, two hundred projects spawn six hundred `git` processes and Windows thrashes. **Past a certain width, more parallelism makes the whole machine slower, including the part you were trying to speed up.** `if let Ok(info) = h.join()` discards a panicked thread rather than propagating: one unreadable path must not cost the other thirty-nine.

The whole Rust side is one commit, at the end of §10.3: the parsers, the readers and `collect` have no independently useful state between them, and the command that calls them is four short edits away.

---

## 10.3 — The command, and the cache that is not persisted

In `src-tauri/src/commands.rs`, two imports at the top, one with the services:

```rust
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
```

```rust
use crate::services::git;
```

One field on `AppState`:

```rust
    /// Git state, in memory only. Deliberately not persisted: a branch name
    /// read yesterday is worse than no branch name, because it looks current.
    pub git_cache: Mutex<HashMap<String, git::GitInfo>>,
```

and two commands, above `toggle_pin`:

```rust
/// Read git state for the current project list.
///
/// Deliberately a separate command rather than part of `get_projects`: git
/// spawns processes, and the project list must render immediately from cache
/// without waiting on them. The frontend calls this after the list is on
/// screen, and again only on an explicit refresh.
#[tauri::command]
pub fn get_git_info(
    projects: Vec<Project>,
    state: State<AppState>,
) -> Result<Vec<git::GitInfo>, AppError> {
    // Same liveness gate the scanner uses. Git state is never worth booting a
    // virtual machine for.
    let running = if projects
        .iter()
        .any(|p| crate::services::scanner::distro_of(&p.full_path).is_some())
    {
        wsl::running_distros()
    } else {
        Vec::new()
    };

    let fresh = git::collect(&projects, &running);
    let mut cache = state.git_cache.lock().map_err(lock_err)?;
    for info in &fresh {
        cache.insert(info.full_path.clone(), info.clone());
    }
    Ok(fresh)
}

/// Open a project's remote in the browser.
#[tauri::command]
pub fn open_remote(
    full_path: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let url = state
        .git_cache
        .lock()
        .map_err(lock_err)?
        .get(&full_path)
        .and_then(|i| i.remote.clone())
        .ok_or_else(|| AppError::NoRemote(full_path))?;

    // `start` is a cmd builtin, so it needs a shell. The empty "" is the window
    // title argument, which start would otherwise steal the URL for.
    std::process::Command::new("cmd")
        .creation_flags(0x08000000)
        .args(["/c", "start", "", &url])
        .spawn()
        .map_err(|e| AppError::LaunchFailed(format!("{url}: {e}")))?;
    Ok(())
}
```

The failure case gets a variant in `src-tauri/src/error.rs`, after `LaunchFailed`:

```rust
    #[error("No browsable remote for {0}")]
    NoRemote(String),
```

In `src-tauri/src/lib.rs`, the field goes into `app.manage(AppState { … })` after `lock_path`, and both commands into the `invoke_handler` after `toggle_pin`:

```rust
                git_cache: std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                ),
```

```rust
            commands::get_git_info,
            commands::open_remote,
```

Fifteen commands.

### Off the hot path — and why this cache is *not* persisted

**Git is not part of `get_projects`.** The natural design is one command returning everything. It is wrong for a reason chapter 06 established: the list must render immediately. Fold git in and every launch waits on process spawns before a single row appears. Separated, the pipeline is: list renders from cache (fast, always) → git arrives and rows gain a branch (slow, best-effort). **When cheap data and expensive data are needed by the same screen, ship them on separate paths, or the cheap one inherits the expensive one's latency.**

**`git_cache` lives in memory and is never written to disk** — the opposite of chapter 06's `ProjectCacheStore`, on purpose. A cached project list a day old is very nearly correct, and chapter 06 labels it. A cached branch name a day old is a lie that looks like a fact: you were on `feature-x` yesterday, you merged and deleted it today, and a row confidently reading `feature-x ●` is *indistinguishable on screen* from a correct one. Non-persistence makes the failure safe by construction: restart, the map is empty, the distro is stopped, the column is blank. Blank is honest. **Cache staleness is only acceptable where it is visible or harmless.**

The URL `open_remote` opens comes from the cache, not the frontend: the WebView sends a path it already knows, the backend resolves it to a URL it computed itself. A command that accepted a URL string and handed it to `cmd /c start` would be a considerably more interesting piece of code to audit. The empty `""` is a real `start` quirk — a first *quoted* argument is the window title, and the URL would be swallowed into it.

> **Commit checkpoint** — the whole Rust side: `git.rs`, `services/mod.rs`, `error.rs`, `commands.rs`, `lib.rs`.
>
> ```powershell
> git add -A
> git commit -m "✅GIT: branch, dirty, remote and last-commit per project — batched over WSL, gated on running distros"
> git push
> ```

---

## 10.4 — The frontend: absence over placeholders

`src/types.d.ts` gains the mirror type, a third sort mode, and the props that change:

```ts
type SortMode = 'frecency' | 'name' | 'activity';

/// Git state, read off the scan's hot path and never persisted — a branch name
/// from yesterday is worse than none, because it looks current.
interface GitInfo {
	full_path: string;
	branch: string | null;
	dirty: boolean;
	remote: string | null;
	last_commit: number;
}
```

`ProjectTreeProps` gains `gitInfo?: Map<string, GitInfo>` and `onOpenRemote?: (p: Project) => void`; `RowMetaProps` and `ProjectRowProps` gain `git?: GitInfo` and `onOpenRemote?`; and one new shape:

```ts
interface GitBadgeProps {
	info?: GitInfo;
	onOpenRemote?: () => void;
}
```

### The hook: git never gates the list

`src/hooks/useProjects.ts` — a `git` map, a loader that `apply` calls *without awaiting*, a `SORT_CYCLE` in place of chapter 09's two-way flip, and three comparators:

```ts
const SORT_CYCLE: SortMode[] = ['frecency', 'activity', 'name'];
```

```ts
	const [git, setGit] = useState<Map<string, GitInfo>>(new Map());

	// …

	// Git reads spawn processes, so they never gate the list. This fires after
	// the payload is already on screen and merges results in as they arrive.
	const loadGit = (list: Project[]) => {
		if (list.length === 0) return;
		invoke<GitInfo[]>('get_git_info', { projects: list })
			.then(infos => {
				setGit(new Map(infos.map(i => [i.full_path, i])));
			})
			.catch(() => {});
	};
```

`apply` gains `loadGit(payload.projects);` before its `return`. `toggleSort` becomes a cycle:

```ts
	const toggleSort = () => {
		setSortMode(prev => {
			const next =
				SORT_CYCLE[(SORT_CYCLE.indexOf(prev) + 1) % SORT_CYCLE.length];
			localStorage.setItem(SORT_KEY, next);
			return next;
		});
	};
```

and the sort splits into named comparators, one per mode, sharing the name tie-break:

```ts
	const byName = (a: Project, b: Project) =>
		a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	const byActivity = (a: Project, b: Project) => {
		const ta = git.get(a.full_path)?.last_commit ?? 0;
		const tb = git.get(b.full_path)?.last_commit ?? 0;
		return tb !== ta ? tb - ta : byName(a, b);
	};
	const byFrecency = (a: Project, b: Project) => {
		const sa = ranks.get(a.full_path)?.score ?? 0;
		const sb = ranks.get(b.full_path)?.score ?? 0;
		return sb !== sa ? sb - sa : byName(a, b);
	};
	const filtered =
		sortMode === 'name'
			? matched
			: [...matched].sort(sortMode === 'activity' ? byActivity : byFrecency);
```

`git` joins the hook's return. `.catch(() => {})` in `loadGit` swallows failures entirely: there is no user action to take, the column stays empty and the launcher works exactly as it did. Because `apply` runs on every refresh — startup, focus, F5 — git is re-read on demand, never on render. **Frecency answers "what am I working on?" Activity answers "what changed?"** They diverge more than you would expect; both are real questions, so both are modes.

In `src/components/SearchBox.tsx`, the label becomes a lookup so a fourth mode is one entry:

```tsx
const SORT_LABEL: Record<SortMode, string> = {
	frecency: 'frecency',
	activity: 'activity',
	name: 'A–Z'
};
```

```tsx
						sort: {SORT_LABEL[sortMode ?? 'frecency']}
```

### `GitBadge`: nothing means nothing

In `src/components/ProjectTree.tsx`, above `RowMeta`:

```tsx
/// Branch name plus a dot when the tree is dirty. Absent entirely for anything
/// that is not a git repository, or whose distro is stopped — no placeholder,
/// no "unknown", nothing to read as a state that it isn't.
const GitBadge = ({ info, onOpenRemote }: GitBadgeProps) => {
	if (!info?.branch) return null;
	return (
		<span className='flex items-center gap-1 min-w-0'>
			{info.dirty && (
				<span className='text-amber-400 leading-none' title='Uncommitted changes'>
					●
				</span>
			)}
			<span
				className={`truncate font-mono text-[11px] text-text-muted ${
					info.remote ? 'hover:text-accent cursor-pointer' : ''
				}`}
				title={info.remote ? `${info.branch} — open ${info.remote}` : info.branch}
				onClick={
					info.remote
						? e => {
								e.stopPropagation();
								onOpenRemote?.();
							}
						: undefined
				}
			>
				{info.branch}
			</span>
		</span>
	);
};
```

`RowMeta` renders it first in its cell and takes `git` / `onOpenRemote`; `ProjectRow` and `rowProps` pass them through (`git: gitInfo?.get(project.full_path)`); the tree destructures `gitInfo` and `onOpenRemote`. The hint span gains `shrink-0` and the cell `min-w-0` — with a variable-width branch in the row, the badge is what truncates and the hint is what doesn't.

**The first line is the whole philosophy.** Three situations reach `if (!info?.branch) return null`: not a repository; distro stopped so we never looked; git not back yet. All three render nothing. "unknown" says *we tried and could not tell* — false for a folder with no `.git`. A dash says *empty branch name*, which is not a state git has. A spinner says *wait for it* — for a stopped distro a promise DevGo will never keep. **A placeholder should only exist when it is more informative than empty space.** The same reasoning runs to the click handler: `undefined`, not a no-op, when there is no remote — and the pointer cursor comes off with it.

### Wiring in `App.tsx`

`git` from the hook; a handler beside the pin one; both through to the tree:

```tsx
	const handleOpenRemote = (p: Project) => {
		invoke('open_remote', { fullPath: p.full_path }).catch(e =>
			toast(showError(e))
		);
	};
```

```tsx
						gitInfo: git,
```

```tsx
						onTogglePin: handleTogglePin,
						onOpenRemote: handleOpenRemote
```

> **Commit checkpoint**
>
> ```powershell
> git add -A && git commit -m "✅UI: GitBadge on every row — branch, dirty dot, clickable remote; activity sort" && git push
> ```

---

## 10.5 — Verify

```powershell
cd src-tauri
cargo test          # 26 passed — 8 in git
cd ..
```

**The regression test — the one this chapter exists for.** `wsl --shutdown`, confirm `wsl -l -v` reads Stopped, start DevGo, wait a few seconds for the git pass, then `wsl -l -v` again. **Still Stopped.** If anything reads Running, the middle arm of `collect`'s match is not doing its job. WSL projects show name, workspace, `WSL` — and nothing in the git column.

**Git actually resolves.** Windows repositories show a branch, a dirty dot where appropriate, and a link cursor where a remote exists; hover reads `branch — open https://…`. Edit a file, F5, the dot appears. A `git init` scratch folder with no remote renders its branch as plain text, no pointer. A plain folder shows nothing.

**The activity sort.** The header button cycles **frecency → activity → A–Z**; in activity the most recently committed repo is on top.

**Nothing slowed down.** Summon with Ctrl+Alt+Space: the list appears at chapter 09's speed, branches fill in a beat later.

> ```powershell
> git add -A
> git commit -m "✅STAGE: 10 git"
> git push
> git checkout main
> git merge 10.git
> git push
> ```

---

## What you built

```
src-tauri/src/
├── services/git.rs          ← NEW: GitInfo, parse_status, remote_to_url, read_windows,
│                               wsl_script / parse_wsl_output / read_wsl_batch, collect  (8 tests)
├── commands.rs              ← AppState.git_cache, get_git_info, open_remote  (15 commands)
├── error.rs                 ← NoRemote(path)
└── lib.rs                   ← git_cache in setup, two commands registered
src/
├── types.d.ts               ← GitInfo, SortMode gains "activity", GitBadgeProps
├── hooks/useProjects.ts     ← git map, loadGit off the hot path, SORT_CYCLE, three comparators
└── components/
    ├── SearchBox.tsx        ← SORT_LABEL lookup
    └── ProjectTree.tsx      ← GitBadge, RowMeta gains git + onOpenRemote
```

> **The thread running through Slice 2.** Every decision here is about **what a feature is allowed to cost.** Git state is worth a filesystem stat, a batched process spawn, and eight threads. It is not worth booting a virtual machine, not worth delaying the list by a second, and not worth a stale branch name that reads as current. A launcher earns its place by what it declines to do on your behalf.

→ Next: [11 — Keyboard-First & the Settings Shell](./11-keyboard.md)
