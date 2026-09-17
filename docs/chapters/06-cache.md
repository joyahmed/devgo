# 06 — The Cache, and the Rule the App Is Built Around (Phase 6)

**Branch:** `06.cache` — `git checkout 06.cache` gives you this chapter's finished app; `git diff 05.launcher 06.cache` is exactly what this chapter adds — plus one hunk that is not about the cache: the first commit also gives `.gitignore` three lines that keep a code assistant's per-machine state folder and notes file out of the repo. A chore that rode along; nothing in the chapter reads them.

**Starting from:** chapter 05 — a working launcher. Unplug the drive one workspace lives on and the whole list blanks; add a workspace inside WSL and every single launch of DevGo boots the virtual machine to draw it.

**Goal:** a scanner that *declines* instead of failing, a cache of the last good scan per workspace, a `get_projects` that never blanks the list and never starts WSL on its own initiative, a Refresh that is the one door through which it may — and a UI that says, honestly, which list you are looking at.

> **Hold on to:**
> 1. **An enum with two outcomes beats a `Result` when neither outcome is a failure.** `ScanOutcome::Scanned | Unavailable(reason)` — "declined" is a legitimate answer with a place in the type, and the caller can act on it. The error channel never allowed that.
> 2. **A `match` with a nested `match`** — the three-way verdict in `collect_projects` is the shape of "outcome × cache state". Read it as the three sentences the UI can say.
> 3. **A capability is a parameter, not a heuristic.** `get_projects` has no way to ask for a boot; `refresh_projects(force)` is the only door. You can answer "can this path start WSL?" by reading a signature.
> 4. **The method that is missing on purpose.** `ProjectCacheStore` has `store` but no `store_failure`, no `clear`. A cache that can be emptied by the failure it exists to survive is not a cache.

> This chapter comes before the tray icon and before DevGo remembers anything about you, and the order is the point. A tray launcher is started constantly and summoned constantly, so everything it does on its own initiative is done fifty times a day — and one of those things, as it stands, is cold-booting a Linux VM. The single-instance lock and the remembered project of chapters 07 and 08 are conveniences on top of a launcher that is cheap to launch and honest when it can't be complete. This chapter is where that rule gets written into the types, so that it can be checked by reading a signature rather than by remembering.
>
> Four separate pieces of work — the second scan outcome, the cache, the liveness gate, the bounded retry — are one idea seen from four sides: *refuse to let DevGo do expensive things on its own initiative, and refuse to let a temporary absence look like a permanent one.*

---

## 6.1 — Asking which distros are running

Chapter 04 listed distros and never asked which were *running*, because nothing then needed to know. The scanner is about to. Add to `src-tauri/src/services/platform/wsl.rs`, after `default_distro`:

```rust
/// Distros that are already running.
///
/// This is a management call: it does **not** start anything. That is what makes
/// it safe as a gate — reading a `\\wsl.localhost\...` path cold-boots the whole
/// VM, so we check liveness this way first and skip the path entirely when the
/// distro is stopped.
pub fn running_distros() -> Vec<String> {
    run(&["-l", "-q", "--running"])
        .as_deref()
        .map(parse_list)
        .unwrap_or_default()
}

pub fn is_running(distro: &str, running: &[String]) -> bool {
    running.iter().any(|d| d.eq_ignore_ascii_case(distro))
}
```

### `is_running` — the most important function in this file

`running_distros` asks `wsl -l -q --running` which distros are already up. It is a management call: **it starts nothing.**

That property is what the rest of DevGo is built on. Chapter 03's scanner reads workspaces, and some of them live at paths like `\\wsl.localhost\Ubuntu\home\user\projects`. Those paths are served by a 9p file server *inside the distro*, which means a plain `std::fs::read_dir` on one of them **cold-boots the entire WSL virtual machine**. Not "connects to" — boots, from stopped, taking seconds and spinning up a VM the user did not ask for.

So before we ever touch such a path, we should ask whether the distro is already running. If it isn't, decline, and serve what we cached earlier. `is_running` takes the list as a parameter rather than fetching it, so a scan across five workspaces spawns `wsl.exe` once rather than five times.

---

## 6.2 — The scanner learns to decline

Chapter 03's scanner returned `Result<Vec<Project>, AppError>`, and chapter 03 called that a hole. Here is why, precisely. A workspace can fail to read for two very different reasons:

- **Something is broken.** The folder was deleted, or you have no permission to it.
- **Something isn't here right now.** The workspace lives on an external drive you unplugged, or a virtual disk that hasn't finished attaching after a reboot.

`Result<Vec<Project>, AppError>` flattens both into "error", and an error is the one thing the caller must not do anything dramatic with. "This drive isn't here at the moment" should not blank your project list — the right response is to show what we knew a minute ago and try again later. That is a *legitimate outcome*, not a failure, so we give it a place in the type instead of smuggling it through the error channel.

And there is a third kind of "not here right now": the stopped distro from §6.1. DevGo is a tray app. It scans on startup, and again every time you summon the window. Left alone, it becomes a program that starts WSL for you, repeatedly, forever, without ever being asked.

The fix is to ask before touching. `running_distros()` starts nothing, so the check is free — and if the distro is stopped, we return before `read_dir` is ever reached. Not "we handle the error"; we never make the call.

Here is `src-tauri/src/services/scanner.rs` in full. The `filter_map` body is exactly chapter 03's; everything around it is new:

```rust
use serde::Serialize;

use super::platform::wsl;
use crate::models::Project;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    /// The workspace lives inside a WSL distro that is not currently running.
    /// Reading it would cold-boot the VM, so we decline.
    DistroStopped,
    /// The path does not resolve — an unplugged drive, or a virtual disk that
    /// has not finished attaching yet.
    NotMounted,
    AccessDenied,
}

pub enum ScanOutcome {
    Scanned(Vec<Project>),
    Unavailable(UnavailableReason),
}

fn detect_file_system(workspace: &str) -> &str {
    let normalized = workspace.replace('\\', "/");
    if normalized.starts_with("//wsl.localhost/")
        || normalized.starts_with("//wsl$/")
    {
        "WSL"
    } else {
        "Windows"
    }
}

/// The distro a workspace path belongs to, if it is a WSL-native path.
pub fn distro_of(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    for prefix in ["//wsl.localhost/", "//wsl$/"] {
        if let Some(rest) = normalized.strip_prefix(prefix) {
            return rest.split('/').find(|s| !s.is_empty()).map(String::from);
        }
    }
    None
}

/// Scan one workspace, one level deep.
///
/// `running` is the already-fetched list of live distros — passed in rather than
/// queried here so a multi-workspace scan spawns `wsl.exe` once, not once per
/// workspace.
///
/// `allow_boot` lifts the liveness gate. It must only ever be set from an
/// explicit user action (the Refresh control), never from startup or a timer.
pub fn scan_workspace(
    path: &str,
    running: &[String],
    allow_boot: bool,
) -> ScanOutcome {
    // A \\wsl.localhost\ path is served by the distro's 9p file server, so even
    // a bare read_dir cold-boots the entire VM. Checking liveness first costs
    // nothing — the check itself starts no distro — and lets us skip the path
    // entirely while it is stopped.
    if !allow_boot {
        if let Some(distro) = distro_of(path) {
            if !wsl::is_running(&distro, running) {
                return ScanOutcome::Unavailable(
                    UnavailableReason::DistroStopped,
                );
            }
        }
    }

    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) => {
            return ScanOutcome::Unavailable(match e.kind() {
                std::io::ErrorKind::PermissionDenied => {
                    UnavailableReason::AccessDenied
                }
                // NotFound covers a deleted folder; everything else here is a
                // drive that is absent or not ready, which reads the same to us.
                _ => UnavailableReason::NotMounted,
            });
        }
    };

    let fs_type = detect_file_system(path).to_string();

    let mut projects: Vec<Project> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let file_type = entry.file_type().ok()?;
            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden folders (.git, .vscode, .cache, ...) — they are
                // never projects and only clutter the list.
                if name.starts_with('.') {
                    return None;
                }
                let full_path = entry.path().to_string_lossy().to_string();
                Some(Project::new(
                    name,
                    full_path,
                    path.to_string(),
                    fs_type.clone(),
                ))
            } else {
                None
            }
        })
        .collect();

    projects.sort_by_key(|p| p.name.to_lowercase());
    ScanOutcome::Scanned(projects)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_distro_from_wsl_paths() {
        assert_eq!(
            distro_of(r"\\wsl.localhost\Ubuntu-26.04\home\joy").as_deref(),
            Some("Ubuntu-26.04")
        );
        assert_eq!(distro_of(r"\\wsl$\Debian\home").as_deref(), Some("Debian"));
        assert_eq!(distro_of(r"G:\01_tauri"), None);
    }

    /// The gate must refuse a stopped distro rather than touching the path.
    #[test]
    fn stopped_distro_is_unavailable_without_touching_the_path() {
        let outcome = scan_workspace(
            r"\\wsl.localhost\Ubuntu-26.04\home\joy",
            &[],
            false,
        );
        assert!(matches!(
            outcome,
            ScanOutcome::Unavailable(UnavailableReason::DistroStopped)
        ));
    }

    #[test]
    fn missing_local_path_is_not_mounted() {
        let outcome = scan_workspace(r"Q:\definitely\not\here", &[], false);
        assert!(matches!(
            outcome,
            ScanOutcome::Unavailable(UnavailableReason::NotMounted)
        ));
    }
}
```

### Classifying the `read_dir` failure

`read_dir` fails with a raw `io::Error`, and `e.kind()` is how we sort it into a bucket. `PermissionDenied` is its own reason because it is the one case a retry will never fix. Everything else — `NotFound`, "the device is not ready", a UNC path that won't resolve — we call `NotMounted`, because from DevGo's position they are indistinguishable and the response is identical: keep the workspace, show what we last saw, look again shortly.

Note what we *don't* do any more: no `?`, no `map_err`, no `AppError`. The function cannot fail. It either scanned, or it declined to.

### `DirAccess` leaves the enum

The scanner was the only thing that ever built `AppError::DirAccess`, and it no longer does — the same situation is now `UnavailableReason::NotMounted` / `AccessDenied`, an outcome rather than an error. Nothing in the rest of the book constructs it either, so it is deleted from `src-tauri/src/error.rs`: remove the two lines

```rust
    #[error("Cannot access directory: {0}")]
    DirAccess(String),
```

The book's rule is that nothing is written and then thrown away; this is the one exception it makes knowingly, because keeping a variant nothing can produce would be a lie in the type. Chapter 03 needed it to say *why* a scan failed; chapter 06 says why in a better place.

### `UnavailableReason` derives `Serialize` *(skip on first pass)*

This enum is going to reach the frontend — §6.6 renders it as a small badge on the workspace row ("not mounted", "WSL stopped"). `#[serde(rename_all = "snake_case")]` puts `"not_mounted"` on the wire, matching the TypeScript union we write there. Same lesson as every other serde rename in this project: pick the JS casing once and make Rust conform.

### Why `allow_boot` exists at all

Because sometimes booting *is* what the user wants. They started the distro, they hit Refresh, they expect their projects. The gate is not "never touch WSL" — it's "never touch WSL **on DevGo's initiative**." Encoding that as a parameter means every caller has to state which of the two it is, in writing, at the call site. §6.5 wires it: `get_projects` passes `false`, and exactly one command passes `true`.

### The tests cannot boot anything either *(skip on first pass)*

`stopped_distro_is_unavailable_without_touching_the_path` passes an empty `running` slice and asserts `DistroStopped` — on a machine where that distro *is* running, the test still passes, because the gate reads the slice, not the machine. That is the property under test: the decision is made from data the caller handed over, never from a call the scanner made itself.

> **Commit checkpoint** — the scan learns to decline. This is the single most important behavioural commit in the project.
>
> ```powershell
> git add -A
> git commit -m "✅RUST: ScanOutcome + skip stopped distros in scanner (never cold-boot WSL)"
> git push
> ```

---

## 6.3 — ProjectCacheStore

`WorkspaceStore` gets a sibling. Same shape — load a JSON file at startup, hold it in memory, write on mutation — different job: remember the last successful scan of every workspace, so an absent drive costs you a *stale* list instead of an *empty* one. The body differs from `WorkspaceStore` because the value is a map, not a list.

Create `src-tauri/src/services/project_cache.rs`:

```rust
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::Project;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedWorkspace {
    pub projects: Vec<Project>,
    pub scanned_at: u64,
}

#[derive(Debug)]
pub struct ProjectCacheStore {
    entries: HashMap<String, CachedWorkspace>,
    file_path: PathBuf,
}

impl ProjectCacheStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;

        let file_path = app_data_dir.join("projects-cache.json");
        let entries = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            HashMap::new()
        };

        Ok(Self { entries, file_path })
    }

    pub fn get(&self, workspace: &str) -> Option<&CachedWorkspace> {
        self.entries.get(workspace)
    }

    /// Record a successful scan.
    ///
    /// There is deliberately no counterpart for a failed one. An unavailable
    /// workspace must never overwrite what we already know about it — otherwise
    /// a single boot with the drive still attaching would erase the cache and
    /// turn a transient glitch into permanent data loss.
    pub fn store(
        &mut self,
        workspace: &str,
        projects: Vec<Project>,
    ) -> Result<(), AppError> {
        self.entries.insert(
            workspace.to_string(),
            CachedWorkspace {
                projects,
                scanned_at: now(),
            },
        );
        self.save()
    }

    /// Forget workspaces that are no longer configured, so removing one does not
    /// leave its projects cached forever.
    pub fn retain(&mut self, workspaces: &[String]) -> Result<(), AppError> {
        let before = self.entries.len();
        self.entries
            .retain(|key, _| workspaces.iter().any(|w| w == key));
        if self.entries.len() != before {
            self.save()?;
        }
        Ok(())
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.entries)?;
        fs::write(&self.file_path, data)?;
        Ok(())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
```

Register it alongside the other stores — `src-tauri/src/services/mod.rs` in full:

```rust
pub mod launcher;
pub mod platform;
pub mod project_cache;
pub mod scanner;
pub mod workspace;

pub use project_cache::ProjectCacheStore;
pub use scanner::scan_workspace;
pub use workspace::WorkspaceStore;
```

### The method that is missing on purpose

Look at the API surface: `get`, `store`, `retain`. There is **no `store_failure`, no `clear`, no `invalidate`.** That absence is the entire design, and it is the one thing to take from this section.

The tempting symmetry is to keep the cache "accurate" — the scan failed, so record that the workspace is empty. Play it forward on a real morning. You reboot; DevGo starts from the tray before the external drive has finished attaching; the scan reports `NotMounted`; the cache dutifully overwrites four hundred remembered projects with zero. The drive comes up ten seconds later. Your projects are gone until the next successful scan — and if that workspace is a WSL distro you don't happen to start today, they are gone indefinitely. **A cache that can be emptied by the failure it exists to survive is not a cache.**

So the only way into this store is through a successful scan. A failure leaves the previous entry exactly as it was. The worst case becomes "these projects are from yesterday," which the UI labels honestly with a `cached · …` pill, and which the user can act on. The alternative worst case is silent data loss.

`retain` is the one deletion path, and note what it keys on: the *configured workspace list*, not a scan result. An entry disappears when the user removes the workspace — a deliberate act — never because a read went wrong.

`scanned_at` is a Unix timestamp so the frontend can say how stale the list is. `now()` uses `unwrap_or(0)` rather than unwrapping: a system clock set before 1970 is not a reason to refuse to launch.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅RUST: ProjectCacheStore (last good scan per workspace)"
> git push
> ```

---

## 6.4 — `collect_projects`: one scan pass, per-workspace verdicts

Chapter 03 left `get_projects` as a loop with a `?` in it. Now it has somewhere to put a reason and something to serve instead.

The frontend needs two things back: the flat project list it already renders, and a per-workspace verdict so it can label a stale group. The imports at the top of `src-tauri/src/commands.rs` become:

```rust
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

use crate::error::AppError;
use crate::models::Project;
use crate::services::launcher;
use crate::services::platform::{wsl, RuntimeInfo};
use crate::services::scanner::{ScanOutcome, UnavailableReason};
use crate::services::ProjectCacheStore;
use crate::services::WorkspaceStore;
```

Then a helper the whole file will lean on, and the payload types — put them right after the imports, above `AppState`:

```rust
fn lock_err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Lock(e.to_string())
}

/// How a workspace's projects were obtained on this pass.
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceStatus {
    /// Freshly read from disk.
    Live,
    /// Served from cache because the source could not be read cheaply.
    Cached,
    /// Unreadable, and nothing cached to fall back on.
    Unavailable,
}

#[derive(Serialize)]
pub struct WorkspaceState {
    pub workspace: String,
    pub status: WorkspaceStatus,
    pub reason: Option<UnavailableReason>,
    pub scanned_at: Option<u64>,
    pub count: usize,
}

#[derive(Serialize)]
pub struct ProjectsPayload {
    pub projects: Vec<Project>,
    pub workspaces: Vec<WorkspaceState>,
}
```

`lock_err` is the helper chapter 03 promised. `lock()` fails only if another thread panicked while holding the lock — "poisoning" — and chapter 03 gave that its own `AppError::Lock` variant. The helper is generic over `Display` because different `lock()` guards produce different `PoisonError<…>` types — one function handles all of them, and every command below uses it. `get_projects`' hand-written `.map_err(|e| AppError::Lock(e.to_string()))` from chapter 03 becomes `.map_err(lock_err)`.

Then the scan pass itself, replacing chapter 03's `get_projects` body:

```rust
/// Collect projects across every configured workspace.
///
/// Two rules govern this:
///
/// 1. One unreadable workspace must never blank the list. Each is scanned
///    independently and falls back to its cached entry, so an unplugged drive
///    costs you that drive's projects and nothing else.
/// 2. Nothing here may start a WSL distro unless `allow_boot` is set, which only
///    an explicit user refresh does. Reading a \\wsl.localhost\ path cold-boots
///    the VM, so a stopped distro is served from cache instead.
fn collect_projects(
    state: &AppState,
    allow_boot: bool,
) -> Result<ProjectsPayload, AppError> {
    let workspaces = state.workspace_store.lock().map_err(lock_err)?.list();

    let mut cache = state.cache_store.lock().map_err(lock_err)?;
    cache.retain(&workspaces)?;

    // One wsl.exe call for the whole pass, not one per workspace. Skipped
    // entirely when no workspace is WSL-native.
    let running = if allow_boot
        || !workspaces
            .iter()
            .any(|w| crate::services::scanner::distro_of(w).is_some())
    {
        Vec::new()
    } else {
        wsl::running_distros()
    };

    let mut projects = Vec::new();
    let mut states = Vec::new();

    for ws in &workspaces {
        match crate::services::scan_workspace(ws, &running, allow_boot) {
            ScanOutcome::Scanned(found) => {
                cache.store(ws, found.clone())?;
                states.push(WorkspaceState {
                    workspace: ws.clone(),
                    status: WorkspaceStatus::Live,
                    reason: None,
                    scanned_at: cache.get(ws).map(|c| c.scanned_at),
                    count: found.len(),
                });
                projects.extend(found);
            }
            // Deliberately does not write to the cache — see ProjectCacheStore::store.
            ScanOutcome::Unavailable(reason) => match cache.get(ws) {
                Some(cached) => {
                    states.push(WorkspaceState {
                        workspace: ws.clone(),
                        status: WorkspaceStatus::Cached,
                        reason: Some(reason),
                        scanned_at: Some(cached.scanned_at),
                        count: cached.projects.len(),
                    });
                    projects.extend(cached.projects.clone());
                }
                None => states.push(WorkspaceState {
                    workspace: ws.clone(),
                    status: WorkspaceStatus::Unavailable,
                    reason: Some(reason),
                    scanned_at: None,
                    count: 0,
                }),
            },
        }
    }

    projects.sort_by_key(|p| p.name.to_lowercase());
    Ok(ProjectsPayload {
        projects,
        workspaces: states,
    })
}
```

### One unreadable workspace must not blank the list

Look at what the loop deliberately does **not** do: there is no `?` on the scan. Nothing inside the loop can end the loop.

This matters more than it looks. Say you have three workspaces and the external drive holding the second one is unplugged. With chapter 03's `?` in there, `get_projects` returned `Err` and the frontend rendered *nothing at all* — two perfectly healthy workspaces vanished because a third was temporarily absent. That is the difference between "this list is slightly incomplete" and "DevGo is broken." The user reads the second one, and they aren't wrong to.

So each workspace is scanned independently, and the shape of the loop is the shape chapter 03 wrote — it gained a `match` on the second outcome, and a cache lookup in the `Unavailable` arm.

### The three-way match is the whole feature

Read the `match` as the three sentences the UI can say:

| Outcome | Cache | Status | What the user sees |
|---|---|---|---|
| `Scanned` | overwritten | `Live` | the list, no badge |
| `Unavailable` | **untouched** | `Cached` | the list, dimmed, `cached · WSL stopped` |
| `Unavailable` | empty | `Unavailable` | the honest empty state from §6.6 |

The comment on the `Unavailable` arm earns its place. "This arm doesn't write to the cache" is the kind of fact that looks like an oversight to the next reader, who helpfully adds the missing `cache.store(ws, vec![])` and reintroduces the data loss from §6.3. Say why, in the file.

### Fetching `running` once, or not at all *(skip on first pass)*

The `running` list is computed before the loop and handed to every `scan_workspace` call, so five WSL workspaces cost one `wsl.exe` invocation. Two short-circuits make it cheaper still:

- **`allow_boot`** — if we're allowed to boot distros anyway, liveness is irrelevant. Empty vec, no call.
- **no WSL workspaces** — `distro_of` is a string check over paths we already have. If nobody's workspace is WSL-native, we never invoke `wsl.exe` at all. A pure-Windows user's DevGo never touches WSL once, ever.

Note the ordering subtlety in the second case: with `allow_boot == false` and an empty `running`, `is_running` returns false for every distro — which is exactly why we must only take that branch when there are no WSL workspaces to wrongly declare stopped.

`cache.retain(&workspaces)` runs first so a workspace the user removed drops out of `projects-cache.json` in the same pass. Otherwise removing a workspace would leave its projects cached forever — invisible, but growing.

---

## 6.5 — Commands + state

`AppState` gains the cache, and `runtime_info` goes behind a `Mutex`:

```rust
pub struct AppState {
    pub workspace_store: Mutex<WorkspaceStore>,
    pub cache_store: Mutex<ProjectCacheStore>,
    pub runtime_info: Mutex<RuntimeInfo>,
}
```

### Why is a value that never changes behind a `Mutex`?

Because it does change — once, rarely, and only when the user asks.

Chapter 04 detected `RuntimeInfo` once at startup, and "once at startup" is still one `wsl.exe` round trip on *every single launch* of a tray app that is launched constantly. Chapter 08 takes the last step and moves this value into `prefs.json`, so a normal launch reads it off disk and shells out to nothing at all. Detection then runs on exactly two occasions: the first time DevGo is ever started, and when you hit **Refresh**.

That second case is the reason for the `Mutex`, and it arrives in this chapter. Refresh re-probes and writes the fresh `RuntimeInfo` back into state, and `State<AppState>` only ever hands you a shared `&AppState` — so replacing the value needs the same interior mutability the workspace store needs.

Now the two project commands. `get_projects` is rewritten to one line — `collect_projects` does the work — and `refresh_projects` joins it; the only thing they disagree about is that boolean:

```rust
#[tauri::command]
pub fn get_projects(
    state: State<AppState>,
) -> Result<ProjectsPayload, AppError> {
    collect_projects(&state, false)
}

/// Explicit user refresh. `force` is the only path allowed to start a stopped
/// distro, and it also re-probes runtime info.
#[tauri::command]
pub fn refresh_projects(
    force: bool,
    state: State<AppState>,
) -> Result<ProjectsPayload, AppError> {
    if force {
        let fresh = crate::services::platform::detection::detect_runtime();
        *state.runtime_info.lock().map_err(lock_err)? = fresh;
    }
    collect_projects(&state, force)
}
```

### One capability, one door

`get_projects` cannot boot a distro. Not "doesn't currently" — *cannot*: it has no parameter with which to ask. Every automatic scan in DevGo goes through it — startup, window focus, the retry timer in §6.6 — and all of them are structurally incapable of starting a virtual machine.

`refresh_projects(force)` is the single door where that becomes possible, and it is reachable only from the Refresh button and F5. That is what "the user asked" is encoded as. Compare it to the alternative — one `get_projects` with an internal heuristic about when booting is acceptable — and notice you could no longer answer "can this code path start WSL?" by reading a signature.

The same call is where detection re-runs. Refresh means *"my situation changed, look again"*, and the situation includes which distros exist. So a forced refresh probes `wsl.exe` and replaces the value in `AppState`.

### The rest of the commands, through the lock

`get_runtime_info` and the three launch commands read the value through the `Mutex` now — replace all four:

```rust
#[tauri::command]
pub fn get_runtime_info(
    state: State<AppState>,
) -> Result<RuntimeInfo, AppError> {
    Ok(state.runtime_info.lock().map_err(lock_err)?.clone())
}

#[tauri::command]
pub fn open_vscode(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    launcher::launch_vscode(&project, &info)
}

#[tauri::command]
pub fn open_terminal(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    launcher::launch_terminal(&project, &info)
}

#[tauri::command]
pub fn open_both(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    launcher::launch_both(&project, &info)
}
```

#### Clone out of the lock, then launch *(skip on first pass)*

Each command takes the `runtime_info` lock, clones the value, and drops the guard on the same line — `lock().map_err(lock_err)?.clone()` produces a temporary guard that dies at the semicolon. `launch_both` sleeps for a second in the middle of its work, and holding a lock across a `sleep` is how you turn a one-second pause into a one-second freeze for every other command. `RuntimeInfo` is four small fields; cloning it is far cheaper than the contention. `get_runtime_info` grows a `Result` for the same reason every other locking command has one: a poisoned lock is now something it can meet.

### A way out from the keyboard

One more command, small now and load-bearing in the next chapter:

```rust
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}
```

`tauri::AppHandle` is injected the same way `State` is: declare the parameter and Tauri fills it in. Today this is Ctrl+Q — a keyboard exit for an app you drive from the keyboard. Chapter 07 makes the ✕ button *hide* the window instead of quitting, and at that moment this command stops being a convenience and becomes the only way out that isn't a tray menu.

### Wire into `lib.rs`

Two edits inside the file chapter 04 left. In `setup`, the cache store is built next to the workspace store and `runtime_info` is wrapped as it goes into state — replace from `let store = …` through the `manage` call:

```rust
            let cache_store =
                services::ProjectCacheStore::new(app_data_dir.clone())
                    .expect("failed to initialize project cache store");

            let store = WorkspaceStore::new(app_data_dir)
                .expect("failed to initialize workspace store");

            app.manage(AppState {
                workspace_store: std::sync::Mutex::new(store),
                cache_store: std::sync::Mutex::new(cache_store),
                runtime_info: std::sync::Mutex::new(runtime_info),
            });
```

And the two new commands join the handler list — replace the `invoke_handler` block:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::get_projects,
            commands::refresh_projects,
            commands::quit_app,
            commands::get_runtime_info,
            commands::open_vscode,
            commands::open_terminal,
            commands::open_both,
        ])
```

`app_data_dir` is cloned for the cache store and consumed by the last — `WorkspaceStore::new` takes it by value, so it goes at the end. `let runtime_info = detection::detect_runtime();` stays at the top of `run` where chapter 04 put it, for two more chapters.

Ten commands. A command that isn't in this list fails at runtime with "command not found" and *compiles fine* — so when you add one, add it here in the same edit.

> **Commit checkpoint** — the commands, the state and the registration, one commit.
>
> ```powershell
> git add -A
> git commit -m "✅RUST: cache-backed get_projects + refresh_projects(force), quit_app; DirAccess retired"
> git push
> ```
>
> The subject's last clause is a step behind the branch: `DirAccess` left `error.rs` in §6.2's commit, not this one. The subject is quoted as the branch has it.

---

## 6.6 — The frontend: say which list you're looking at

### The types about *how* the list was obtained

Add the mirrors to `src/types.d.ts`, under `RuntimeInfo`:

```ts
type WorkspaceStatus = 'live' | 'cached' | 'unavailable';

/// Why a workspace could not be read. "distro_stopped" is not a failure — it
/// means we declined to boot WSL just to render a list.
type UnavailableReason = 'distro_stopped' | 'not_mounted' | 'access_denied';

interface WorkspaceState {
	workspace: string;
	status: WorkspaceStatus;
	reason: UnavailableReason | null;
	scanned_at: number | null;
	count: number;
}

interface ProjectsPayload {
	projects: Project[];
	workspaces: WorkspaceState[];
}
```

And in the component-props section, the tree gains a prop, the status pill gets its own, and the action row gains a callback:

```ts
interface ProjectTreeProps {
	projects: Project[];
	selected: Project | null;
	onSelect: (p: Project) => void;
	onDoubleClick: (p: Project) => void;
	onLaunch: (p: Project) => void;
	loading?: boolean;
	workspaceStates?: WorkspaceState[];
	ref?: React.Ref<ProjectTreeHandle>;
}

interface StatusPillProps {
	state: WorkspaceState | undefined;
}

interface ActionButtonsProps {
	hasSelection: boolean;
	onAddWorkspace: () => void;
	onRemoveWorkspace: () => void;
	onVSCode: () => void;
	onTerminal: () => void;
	onBoth: () => void;
	onRefresh: () => void;
}
```

`Project` describes a project. The four wire types describe the scan that produced it, and they exist because DevGo has to be honest about a list it could not fully refresh — an unplugged drive, or a WSL distro it declined to boot. `WorkspaceState` is the per-workspace verdict; `ProjectsPayload` is what `get_projects` returns now — the flat project list *plus* one verdict per workspace. The string unions are lowercase snake_case to match `#[serde(rename_all = "snake_case")]` on the Rust enums — same discipline as `runtime`, same silent bug if you get it wrong.

### `useProjects`: the payload, and healing a workspace that shows up late

Here is `src/hooks/useProjects.ts` after this chapter, in full. Chapter 03's `filtered` and the mount effect are unchanged; the rest is new:

```ts
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';

/// A workspace on a virtual disk can be missing for a few seconds after boot
/// while the disk attaches. Retry a bounded number of times so the list heals
/// itself instead of needing a restart.
const RETRY_DELAYS = [2000, 5000, 15000];

/// Only local workspaces are retried. A stopped distro is a deliberate decision,
/// not a transient failure — auto-retrying it would make DevGo boot WSL in the
/// background, which is the exact behaviour this all exists to prevent.
const isRetryable = (w: WorkspaceState) =>
	w.status !== 'live' && w.reason !== 'distro_stopped';

export const useProjects = () => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [workspaceStates, setWorkspaceStates] = useState<WorkspaceState[]>(
		[]
	);
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<Project | null>(null);
	const [loading, setLoading] = useState(true);
	const retryTimer = useRef<number | null>(null);
	const retryStep = useRef(0);

	const apply = (payload: ProjectsPayload) => {
		setProjects(payload.projects);
		setWorkspaceStates(payload.workspaces);
		return payload;
	};

	const refresh = async (force = false) => {
		setLoading(true);
		try {
			const payload = force
				? await invoke<ProjectsPayload>('refresh_projects', { force: true })
				: await invoke<ProjectsPayload>('get_projects');
			return apply(payload);
		} finally {
			setLoading(false);
		}
	};

	// Schedule a retry whenever something is recoverably missing. Cleared as soon
	// as a pass comes back with nothing left to retry.
	useEffect(() => {
		if (retryTimer.current !== null) {
			window.clearTimeout(retryTimer.current);
			retryTimer.current = null;
		}

		if (!workspaceStates.some(isRetryable)) {
			retryStep.current = 0;
			return;
		}

		const delay = RETRY_DELAYS[retryStep.current];
		if (delay === undefined) return;
		retryStep.current += 1;

		retryTimer.current = window.setTimeout(() => {
			refresh().catch(() => {});
		}, delay);

		return () => {
			if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
		};
	}, [workspaceStates]);

	// Summoning the window should show a current list. Resets the retry budget so
	// a workspace that came back is picked up promptly.
	useEffect(() => {
		const unlisten = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (!focused) return;
				retryStep.current = 0;
				refresh().catch(() => {});
			}
		);
		return () => {
			unlisten.then(f => f()).catch(() => {});
		};
	}, []);

	useEffect(() => {
		refresh();
	}, []);

	const q = query.trim().toLowerCase();
	const filtered = q
		? projects.filter(p => p.name.toLowerCase().includes(q))
		: projects;

	return {
		projects,
		workspaceStates,
		filtered,
		query,
		setQuery,
		selected,
		setSelected,
		refresh,
		loading
	};
};
```

#### `refresh(force = false)` defaults to the safe command

Callers that pass nothing — the mount effect, the retry and focus effects — get `get_projects`, which structurally cannot boot a distro. Only an explicit `refresh(true)` reaches `refresh_projects`. `apply` splits the payload into the two pieces of state and hands it back, so a caller that wants the list it just fetched still gets it — chapter 08 is that caller.

#### `useRef` is not memoization

`retryTimer` and `retryStep` are refs because they are *mutable values that must survive renders without causing one* — a timer id, a counter. That is what `useRef` is for, compiler or no compiler; the rule against `useMemo`/`useCallback` is about caching, and a ref caches nothing. The effects list only the state they react to (`workspaceStates`); `refresh` is a plain function the compiler keeps stable.

#### The retry is bounded, and that is the point

`RETRY_DELAYS` is an array, not an interval. Three attempts at 2s, 5s and 15s, and then it stops — `RETRY_DELAYS[3]` is `undefined` and the effect returns without scheduling anything.

A plain `setInterval` would be easier to write and wrong. The failure it is trying to survive lasts seconds: a virtual disk attaching after a cold boot, a network share reconnecting. If the workspace is still missing after twenty-two seconds, it is not attaching — the drive is unplugged, or the folder is gone — and polling it every five seconds until you quit is a background process burning I/O forever on a situation that will never resolve on its own. **Retry for as long as the thing you're waiting for could plausibly still happen, then stop and let the user decide.** After the budget is spent, the pill and the Refresh button are the answer.

`retryStep` resets to `0` in two places: when a pass comes back clean, and on window focus. The second is what makes it feel alive — you plug the drive back in an hour later, bring the window up, and you get a fresh scan *plus* a fresh three-attempt budget, rather than a hook that gave up long ago.

#### The `distro_stopped` exclusion is the whole design in one line

`isRetryable` returns false for `distro_stopped`, and this is not an optimization.

Follow the other version through. A retry calls `refresh()` → `get_projects` → `collect_projects(allow_boot: false)` → the workspace is still stopped → still retryable → schedule another. It never boots anything, so it is *safe* — but it is also pointless, and pointless in a specific way: it treats a decision as a fault. §6.2's gate did not fail to read that workspace. It **declined** to, on purpose, and nothing about that will change on its own in five seconds.

Then imagine the version where someone, reasonably, decides the retry should actually fix things and passes `force: true`. Now DevGo cold-boots a WSL virtual machine 2 seconds after startup, on a timer, without the user touching anything — the exact behaviour the entire chain of decisions in this chapter exists to prevent, reintroduced by a one-word change in a file three layers away from the scanner.

That is why the constant carries a comment naming the consequence rather than describing the code. `NotMounted` heals itself and is worth waiting for. `DistroStopped` heals when the user starts their distro and hits Refresh, and waiting for it is DevGo's business exactly never.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅REACT: cached payload, bounded retry, rescan on focus"
> git push
> ```

### The status pill — say which list you're looking at

`ProjectTree` learns to render the verdict. Above the component, next to `COLUMNS` and `lastSegment`, the pill and its labels:

```tsx
const pill =
	'inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-bg-panel border border-border shrink-0';

const REASON_LABEL: Record<UnavailableReason, string> = {
	distro_stopped: 'WSL stopped',
	not_mounted: 'not mounted',
	access_denied: 'no access'
};

const StatusPill = ({ state }: StatusPillProps) => {
	if (!state || state.status === 'live') return null;
	const label = state.reason ? REASON_LABEL[state.reason] : 'unavailable';
	const cached = state.status === 'cached';
	return (
		<span
			className={`${pill} ${cached ? 'text-text-muted' : 'text-danger'}`}
			title={
				cached ? `Showing cached projects — ${label}` : `Unavailable — ${label}`
			}
		>
			{cached ? `cached · ${label}` : label}
		</span>
	);
};
```

Destructure `workspaceStates` with the other props, and add the lookup as a plain function in the component body, next to `toggle`:

```tsx
	const stateFor = (ws: string) =>
		workspaceStates?.find(s => s.workspace === ws);
```

In the render, each workspace header looks up its verdict and its rows dim when the verdict is `cached`:

```tsx
					const fs = wsProjects[0]?.file_system ?? 'Windows';
					const wsState = stateFor(ws);
					const isStale = wsState?.status === 'cached';
```

```tsx
									<span className='truncate font-semibold text-text-primary'>
										{lastSegment(ws)}
									</span>
									<StatusPill state={wsState} />
```

```tsx
											className={`${col} ml-6 px-3 py-1.5 cursor-pointer select-none transition-colors border-l border-border ${
												isStale ? 'opacity-60' : ''
											} ${
												isSelected
```

Three states, three different things to say:

- **`live`** — no pill at all. The common case earns no chrome.
- **`cached`** — a muted `cached · WSL stopped` pill, and the rows below it drop to `opacity-60`. These projects are real, they were there last time we looked, and you can still launch them. They are just not a fresh reading. Muted, not red: nothing is wrong.
- **`unavailable`** — the bare reason in `text-danger`. We have nothing to show for this workspace and you should know that.

`REASON_LABEL` translates the wire values into human ones — `distro_stopped` becomes **WSL stopped**, not "error". It isn't an error. §6.2 taught the scanner to *decline* to boot a distro; the pill is that decision made visible, so the missing rows read as a deliberate choice rather than a malfunction.

`StatusPill` is a second component in `ProjectTree.tsx` rather than its own file: it renders nothing the tree does not own, and nothing else will ever render it. Its props still live in `types.d.ts` like every other component's.

### The empty state that must not lie

The `projects.length === 0` branch now forks, and this is the part worth being fussy about:

```tsx
	if (projects.length === 0) {
		// "Nothing configured" and "everything is offline right now" are very
		// different situations and must never look the same.
		const blocked =
			workspaceStates?.filter(s => s.status === 'unavailable') ?? [];
		if (blocked.length > 0) {
			return (
				<div className='flex-1 flex flex-col items-center justify-center gap-2 text-sm text-text-muted px-6 text-center'>
					<span className='text-danger font-semibold'>
						{blocked.length === 1
							? '1 workspace is unavailable'
							: `All ${blocked.length} workspaces are unavailable`}
					</span>
					{blocked.map(s => (
						<span
							key={s.workspace}
							className='font-mono text-xs truncate max-w-full'
						>
							{s.workspace} —{' '}
							{s.reason ? REASON_LABEL[s.reason] : 'unavailable'}
						</span>
					))}
					<span className='text-xs'>
						Nothing was cached for these yet. Refresh once they are back.
					</span>
				</div>
			);
		}
		return (
			<div className='flex-1 flex items-center justify-center text-sm text-text-muted'>
				No projects found. Add a workspace to begin.
			</div>
		);
	}
```

"No projects found. Add a workspace to begin." is correct advice for a fresh install. It is **actively wrong** advice when the user has four workspaces configured and their laptop simply hasn't reattached the drive yet. Following it — adding a workspace they already have — makes their situation worse, and it tells them DevGo forgot their setup. That is the exact moment a small utility loses someone's trust.

So when the list is empty *and* some workspace reported `unavailable`, we say so: how many, which ones, why, and what to do about it ("Refresh once they are back"). Same empty screen, opposite meaning. **An empty state is a sentence about why the screen is empty — if it can be wrong about that, it is worth two branches.**

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅REACT: workspace status pills + unavailable empty state"
> git push
> ```

### The sixth button

`ActionButtons` gains **Refresh** — a row entry, a handler, and a comment that is doing real work:

```tsx
const BUTTONS = [
	{ key: 'remove', label: 'Remove' },
	{ key: 'add', label: 'Add' },
	{ key: 'refresh', label: 'Refresh' },
	{ key: 'code', label: 'VS Code' },
	{ key: 'terminal', label: 'Terminal' },
	{ key: 'both', label: 'Open Both' }
] as const;

// Refresh is deliberately absent: it is the way out of an empty list, so it must
// stay enabled when nothing is selected.
const NEEDS_SELECTION = new Set(['code', 'terminal', 'both']);
```

with `onRefresh` destructured and `refresh: onRefresh,` in the `handlers` map — which the `Record<…>` type now *requires*, since `BUTTONS` has a sixth key.

#### Why `refresh` is not in `NEEDS_SELECTION`

It looks like it belongs there. Every other non-workspace button acts on the selected project, and gating them all behind `hasSelection` is the tidy rule.

Follow that rule and you build a dead end. The state where the user most needs Refresh is the state where **the list is empty** — the drive wasn't mounted at startup, or the WSL distro was stopped and §6.2's gate skipped it. Empty list, nothing to select, `hasSelection` false, Refresh greyed out. The one control that fixes the situation is disabled *because* of the situation, and the only remaining move is to restart the app.

So Refresh is the button that stays live when nothing else does, and the comment above `NEEDS_SELECTION` says why — the next person to tidy this file will otherwise "fix" it.

### Wire the last pieces into App

`src/App.tsx` — `useEffect` joins the React import and `invoke` arrives for the first time; this is the only place the top-level component calls a command directly:

```tsx
import { invoke } from '@tauri-apps/api/core';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
```

`AppInner` gets `workspaceStates` from the hook, a forced-refresh handler, and the keyboard shortcuts — after `handleRemove`:

```tsx
	const {
		filtered,
		query,
		setQuery,
		selected,
		setSelected,
		refresh,
		loading,
		workspaceStates
	} = useProjects();
```

```tsx
	// A forced refresh is the one path allowed to start a stopped WSL distro.
	const handleRefresh = () => {
		refresh(true).catch(e => toast(showError(e)));
	};

	// Report workspaces we could not read, but stay quiet about a stopped distro
	// — that is DevGo working as intended, not a failure worth interrupting for.
	const reported = useRef<string>('');
	useEffect(() => {
		const degraded = workspaceStates.filter(
			s => s.status !== 'live' && s.reason !== 'distro_stopped'
		);
		const key = degraded.map(s => `${s.workspace}:${s.status}`).join('|');
		if (!key || key === reported.current) {
			reported.current = key;
			return;
		}
		reported.current = key;
		const names = degraded.map(s => s.workspace).join(', ');
		const allCached = degraded.every(s => s.status === 'cached');
		toast(
			allCached
				? `Showing cached projects for ${names}`
				: `Could not read ${names}`,
			allCached ? 'info' : 'error'
		);
	}, [workspaceStates]);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			if (e.key === 'F5' || (mod && e.key === 'r')) {
				e.preventDefault();
				handleRefresh();
			} else if (mod && e.key === 'q') {
				e.preventDefault();
				invoke('quit_app').catch(() => {});
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, []);
```

Pass `workspaceStates` down to the tree, and point the new button at the forced handler:

```tsx
						onLaunch: handleLaunch,
						loading,
						workspaceStates
```

```tsx
						onBoth: handleOpenBoth,
						onRefresh: handleRefresh
```

`handleRefresh` is a wrapper on purpose. `handlers[key]` is passed straight to `onClick`, so handing the button `refresh` itself would have React call `refresh(mouseEvent)` — and `refresh` now takes a `force` flag as its first argument, which a `MouseEvent` would satisfy as truthy. Here that happens to be the intent, but never hand a DOM handler a function whose first parameter means something; say `refresh(true)` in writing, and catch the error while you are at it.

`e.preventDefault()` on F5 and Ctrl+R matters — this is a WebView, and without it the browser reloads the whole frontend instead of rescanning. Ctrl+Q calls `quit_app` and needs no handling on the JS side; if the process is exiting, nothing is left to catch.

#### Say something, but not about a stopped distro

The `reported` effect: when a workspace degrades, tell the user — with one loud exception. Same filter as `isRetryable`, same reason. A toast that says "could not read \\wsl.localhost\Ubuntu" every single launch would train the user to read a deliberate, correct decision as a recurring error — and the retry effect means several passes per minute. The `reported` ref holds a key of what was last announced so an unchanged situation is announced once, not once per scan. The status pill on the row is the persistent, quiet channel; the toast is for the thing that just changed.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅REACT: Refresh button, F5/Ctrl+R, Ctrl+Q, degraded-workspace toast"
> git push
> ```

---

## 6.7 — Verify

```powershell
cd src-tauri
cargo test
```

Seven tests now — chapter 04's four and §6.2's three — and none of them touch `wsl.exe`. `cargo check` is clean: `DirAccess` is gone, `Lock` is constructed by every `AppError` command (the three workspace commands still return `Result<_, String>`, as chapter 02 left them). Then:

```powershell
bun tauri dev
```

- ✅ Unplug a workspace's drive and relaunch → its projects still listed, dimmed, `cached · not mounted`, and an `info` toast; plug it back in and the list heals itself within seconds
- ✅ `wsl --shutdown`, then launch DevGo → the WSL workspace shows `cached · WSL stopped`, and `wsl -l -v` still says **Stopped**. DevGo did not boot it. Hit **Refresh** (or F5) and it does.
- ✅ Remove every workspace's drive with an empty `projects-cache.json` → "All N workspaces are unavailable", not "No projects found"
- ✅ Ctrl+Q exits

> **Commit checkpoint** — the rule is in the types. Stage commit, then merge the chapter into `main`:
>
> ```powershell
> git add -A
> git commit -m "✅STAGE: 06 cache"
> git push
> git checkout main
> git merge 06.cache
> git push
> ```

---

## What you built

```
src-tauri/src/
├── error.rs                  ← − DirAccess
├── commands.rs               ← lock_err, WorkspaceState/ProjectsPayload, collect_projects,
│                                get_projects / refresh_projects(force) / quit_app
└── services/
    ├── platform/wsl.rs       ← + running_distros, is_running
    ├── scanner.rs            ← ScanOutcome, UnavailableReason, distro_of, the liveness gate
    └── project_cache.rs      ← ProjectCacheStore: get / store / retain — and no clear
src/
├── types.d.ts                ← + WorkspaceStatus, UnavailableReason, WorkspaceState, ProjectsPayload, StatusPillProps
├── App.tsx                   ← handleRefresh, F5 / Ctrl+R / Ctrl+Q, the degraded toast
├── hooks/useProjects.ts      ← payload, bounded retry, rescan on focus
└── components/
    ├── ProjectTree.tsx       ← StatusPill, dimmed cached rows, the honest empty state
    └── ActionButtons.tsx     ← + Refresh, deliberately always enabled
```

- **A scanner that declines is not a scanner that failed.** `ScanOutcome::Unavailable` is a legitimate answer with a place in the type, and the caller can do the right thing with it — which the error channel never allowed.
- **A cache that can be emptied by the failure it exists to survive is not a cache.** The missing `store_failure` is the design.
- **One capability, one door.** `get_projects` has no parameter with which to ask for a boot; `refresh_projects(force)` is the only way, and it is a signature, not a comment.
- **Retry for as long as the thing could still happen, then stop.** Three attempts, then the pill and the button.
- **An empty state is a sentence about why the screen is empty.** If it can be wrong, it is worth two branches.

→ Next: [07 — One Instance, in the Tray](./07-single-instance.md)

→ Appendix: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)
