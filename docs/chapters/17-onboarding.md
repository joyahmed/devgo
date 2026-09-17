# 17 — Onboarding & Scan Config (Slice 8)

**Branch:** `17.onboarding` — `git checkout 17.onboarding` gives you this chapter's finished app; `git diff 16.palette 17.onboarding` is exactly what this chapter adds.

**Starting from:** Slice 7 — DevGo can find and run anything, once it has a workspace. Open it with none and it says "No projects found. Add a workspace to begin.", which is true and useless. And its scan is fixed: one level deep, skipping dotfolders, no way to tell it what to ignore.

**Goal:** an empty DevGo that *helps you fill it* — pick a folder, scan the common roots, or drop a folder on the window — and one scan knob worth having: a list of folder names to ignore.

> **Hold on to:**
> 1. **Discovery only asks running distros, from the inside, behind a button.** `wsl -l --running` boots nothing; one `bash -lc` per running distro does the `[ -d ]` tests over there; a stopped distro's projects are simply not discovered, and the empty-scan message says so.
> 2. **The validation you want on a local disk is a boot on a 9p path.** A dropped `\\wsl.localhost\` folder is added without an `is_dir` probe; a dropped local file is filtered by one.
> 3. **A scan feature is free only if it adds no I/O.** The ignore list is `eq_ignore_ascii_case` against names the scan already listed — which is why it ships and depth, monorepo expansion and a watcher do not.
> 4. **Two hooks, two views of one state: every mutation touches both.** Adding a workspace refreshed projects but not the workspace list, and onboarding keys off that list.
>
> Rust: `#[serde(default = "fn")]` for a field whose default is not `Default::default()`; a `let … else` in a test.

> This chapter is mostly about a line you do not cross. Every earlier slice obeys one law: **DevGo touches WSL only when you open a project or explicitly refresh; never on startup, never on a timer, never to render a list it has cached.** Slice 8 is the slice most tempted to break it, because "scan the machine for projects" and "watch the filesystem" and "recurse into subfolders" all sound like features and all mean *touching WSL paths you were not asked to touch*. So the interesting content is not the onboarding card, which is three buttons. It is the four places this slice could have booted a stopped distro or slowed the list, and did not.

---

## 17.1 — Discovery that never boots a distro

Chapter 05 wrote `windows_to_wsl_path` and promised its inverse for its first caller. This is the chapter that uses it, so this is the chapter that types it, at the bottom of `src-tauri/src/services/platform/paths.rs`:

```rust
pub fn wsl_to_windows_path(wsl_path: &str, distro: &str) -> String {
    if let Some(rest) = wsl_path.strip_prefix("/mnt/") {
        if !rest.is_empty() {
            let drive = rest.chars().next().unwrap().to_uppercase().to_string();
            let remainder = &rest[1..];
            return format!("{}:{}", drive, remainder.replace('/', "\\"));
        }
    }

    if wsl_path.starts_with('/') {
        return format!(
            "\\\\wsl.localhost\\{}{}",
            distro,
            wsl_path.replace('/', "\\")
        );
    }

    wsl_path.replace('/', "\\")
}
```

Then `src-tauri/src/services/discover.rs` (and `pub mod discover;` in `services/mod.rs`):

```rust
use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

use super::platform::{paths, wsl};

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// A candidate workspace root to suggest on an empty first run.
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredRoot {
    pub path: String,
    pub label: String,
    pub kind: &'static str,
}

const SUBDIRS: &[&str] = &["projects", "dev", "code", "src", "work"];

/// Windows roots are cheap is_dir checks. WSL roots come from running distros
/// only, so this never boots one. Fired from a button, never on launch.
pub fn discover() -> Vec<DiscoveredRoot> {
    let mut out: Vec<DiscoveredRoot> = Vec::new();

    if let Ok(home) = std::env::var("USERPROFILE") {
        for sub in SUBDIRS {
            let path = format!("{home}\\{sub}");
            if std::path::Path::new(&path).is_dir() {
                out.push(DiscoveredRoot {
                    label: format!("~\\{sub}"),
                    path,
                    kind: "windows",
                });
            }
        }
        // where visual studio puts things
        let vs = format!("{home}\\source\\repos");
        if std::path::Path::new(&vs).is_dir() {
            out.push(DiscoveredRoot {
                label: "~\\source\\repos".into(),
                path: vs,
                kind: "windows",
            });
        }
    }

    for root in ["C:\\dev", "C:\\projects", "C:\\src"] {
        if std::path::Path::new(root).is_dir() {
            out.push(DiscoveredRoot {
                path: root.to_string(),
                label: root.to_string(),
                kind: "windows",
            });
        }
    }

    for distro in wsl::running_distros() {
        for linux in wsl_project_dirs(&distro) {
            out.push(DiscoveredRoot {
                path: paths::wsl_to_windows_path(&linux, &distro),
                label: format!(
                    "{distro} · {}",
                    linux.replacen("/home/", "~/", 1)
                ),
                kind: "wsl",
            });
        }
    }

    out
}

// one spawn per running distro, the tests run inside it
fn wsl_project_dirs(distro: &str) -> Vec<String> {
    let list = SUBDIRS
        .iter()
        .map(|s| format!("\"$HOME/{s}\""))
        .collect::<Vec<_>>()
        .join(" ");
    let script =
        format!("for d in {list}; do [ -d \"$d\" ] && echo \"$d\"; done");

    let output = Command::new("wsl")
        .creation_flags(CREATE_NO_WINDOW)
        .env("WSL_UTF8", "1")
        .args(["-d", distro, "-e", "bash", "-lc", &script])
        .output();

    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim_end_matches('\r').to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}
```

The Windows half is `is_dir` on a handful of well-known folders — cheap syscalls on a local disk. The WSL half is where the constraint bites: `wsl::running_distros()` is the gate, the same call the scanner, git and badges use. The loop runs only over distros that are already up, so `discover` never reads a `\\wsl.localhost\` path for a VM that would have to start to answer. The plan's own suggestion — glob `\\wsl.localhost\*\home\*` — is exactly the violation: globbing it stats every installed distro, booting each. Asking each *running* distro from the inside answers the intent without the mechanism, in one spawn per distro — chapter 14's boundary lesson a third time.

And the last sentence of the doc comment outranks all of it: **even running-only, discovery fires from a button, not on launch.** A running distro is still a spawn, and startup spawning `wsl.exe` is the thing chapter 06 removed. The command is a one-liner in `commands.rs`, registered in `lib.rs`:

```rust
/// Suggest roots for an empty first run. Never boots a distro; fired from the
/// onboarding Scan button, never on launch.
#[tauri::command]
pub fn discover_roots() -> Vec<crate::services::discover::DiscoveredRoot> {
    crate::services::discover::discover()
}
```

> `✅SCAN: discover roots`

---

## 17.2 — Drag-and-drop, without a probe

The drop calls a second command, and the Core Rule is in its one `if`:

```rust
/// The drag-and-drop path. A local file is skipped; a wsl path is added
/// without an is_dir probe, because the probe would boot a stopped distro.
#[tauri::command]
pub fn add_workspace_folders(
    paths: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.workspace_store.lock().map_err(|e| e.to_string())?;
    for p in &paths {
        let is_wsl = p.replace('\\', "/").starts_with("//wsl");
        if is_wsl || std::path::Path::new(p).is_dir() {
            store.add(p).map_err(|e| e.to_string())?;
        }
    }
    Ok(store.list())
}
```

The obvious version validates every dropped path with `is_dir` — reject files, keep folders. For a Windows path that is right. But `Path::new(r"\\wsl.localhost\Ubuntu\home\user\api").is_dir()` **reads the 9p path**, which boots Ubuntu if it is stopped — the drop would cold-start a VM to check whether the thing you dropped was a folder. So the check is split: a local path is validated, a WSL path is added **unvalidated**. If a stopped-distro folder was dropped, it goes in and shows as unavailable until the distro is up — the same degradation the scanner already does, and strictly better than booting the VM to find out. **The validation you want on a local disk is a Core Rule violation on a 9p path.**

> `✅SCAN: add_workspace_folders`

---

## 17.3 — One scan knob, and three that didn't make it

In `preferences.rs`, above `now_secs`:

```rust
// bare names, not globs: a cheap comparison on the listing the scan already has
fn default_ignore() -> Vec<String> {
    ["node_modules", "archive", "vendor"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    #[serde(default = "default_ignore")]
    pub ignore: Vec<String>,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            ignore: default_ignore(),
        }
    }
}
```

`#[serde(default = "default_ignore")]` names a function because the default is not the type's `Default` — an empty `Vec` would be a worse default than three names. `Preferences` gains `#[serde(default)] pub scan_config: ScanConfig` (every field added to a persisted struct is a migration; chapter 13 said why), and `PreferencesStore` gains the pair, above `save`:

```rust
    pub fn scan_config(&self) -> ScanConfig {
        self.prefs.scan_config.clone()
    }

    pub fn set_scan_config(
        &mut self,
        config: ScanConfig,
    ) -> Result<(), String> {
        self.prefs.scan_config = config;
        self.save()
    }
```

with two thin commands, `get_scan_config` / `set_scan_config`, in `commands.rs` and `lib.rs`. Then the feature itself — four lines in `scan_workspace`, which gains an `ignore: &[String]` parameter:

```rust
                if name.starts_with('.') {
                    return None;
                }
                // user-configured junk, matched by name on the listing we already have
                if ignore.iter().any(|ig| ig.eq_ignore_ascii_case(&name)) {
                    return None;
                }
```

and in `collect_projects`, read once per pass, before the loop:

```rust
    // read once per pass, keeps the lock out of the scan loop
    let ignore = state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .scan_config()
        .ignore;
```

That is the entire feature, and its whole virtue is what it is *not*: it adds **no I/O**. The scan already listed the directory; the names are already in memory; the ignore list is a comparison against strings it already holds. Bare names rather than globs because a projects root's junk is a set of known names, and a name comparison cannot be tempted into reading anything to evaluate a `**`.

Now the three that did not ship. **Configurable depth**: recursing N levels means N reads per branch, and on a `\\wsl.localhost\` workspace each read is a 9p round trip. **Monorepo awareness**: genuinely wanted, but in `scan_workspace` it is a second read per project *on the blocking scan* — chapters 10 and 14 spent their whole length moving work *off* that path; done right it is a separate batched pass like `detect.rs`, and that is its own slice. **A filesystem watcher**: DevGo already rescans on focus and summon, which is *when you look at it*; a watcher costs a dependency, a thread, and a footgun — a watch on `\\wsl.localhost\` holds the 9p connection open and keeps the VM alive **indefinitely**.

### The test

```rust
    #[test]
    fn ignore_list_skips_matching_folders() {
        let dir = std::env::temp_dir().join("devgo-scan-ignore-test");
        let _ = std::fs::remove_dir_all(&dir);
        for name in ["web", "api", "node_modules", "Archive"] {
            std::fs::create_dir_all(dir.join(name)).unwrap();
        }
        let path = dir.to_string_lossy().to_string();

        let ignore = vec!["node_modules".to_string(), "archive".to_string()];
        let ScanOutcome::Scanned(projects) =
            scan_workspace(&path, &[], false, &ignore)
        else {
            panic!("local temp dir should scan");
        };
        let mut names: Vec<_> =
            projects.iter().map(|p| p.name.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["api", "web"]);

        let _ = std::fs::remove_dir_all(&dir);
    }
```

`Archive` with a capital A against `archive` in the list pins the case-insensitivity; the existing scanner tests gain a trailing `&[]`.

> `✅SCAN: scan config in prefs` → `✅SCAN: scan config commands` → `✅SCAN: ignore list` → `✅TEST: ignore list`. `cargo test` reports **45**.

---

## 17.4 — The empty state, and when it shows

Wire types and props in `types.d.ts`: `DiscoveredRoot { path; label; kind: 'windows' | 'wsl' }`, `ScanConfig { ignore: string[] }`, `OnboardingProps { onAdd; onAddMany; onError }`, `ScanningPanelProps { onSaved; onError }`, and later `SettingsProps.onScanChanged`. Then `src/components/Onboarding.tsx` — the card, `Button`s throughout, the kind badge from a tone table, the found roots mapped:

```tsx
const KIND_TONE: Record<DiscoveredRoot['kind'], string> = {
	wsl: 'text-accent border-accent/30',
	windows: 'text-text-muted border-border'
};

// scanning is behind a button on purpose: it never touches a stopped distro,
// but it is still a thing the user asks for, not something an empty window does
const Onboarding = ({ onAdd, onAddMany, onError }: OnboardingProps) => {
	// null is "not scanned yet", [] is "scanned, found nothing"
	const [roots, setRoots] = useState<DiscoveredRoot[] | null>(null);
	const [scanning, setScanning] = useState(false);

	const pickFolder = async () => {
		try {
			const picked = await open({ directory: true });
			if (typeof picked === 'string') onAdd(picked);
		} catch (e) {
			onError(String(e));
		}
	};

	const scan = async () => {
		setScanning(true);
		try {
			setRoots(await invoke<DiscoveredRoot[]>('discover_roots'));
		} catch (e) {
			onError(String(e));
		} finally {
			setScanning(false);
		}
	};
```

The full markup is in the repo: a title, the two buttons, and — once `roots` is not `null` — either the honest empty message (*No common project folders found. Choose one manually, or start a WSL distro and scan again.*) or a *Found N* list with an *Add all* ghost button and one *Add* per row. `null` versus `[]` is chapter 16's `null` versus `0` again: the list renders only once a scan has run.

What matters about the card is the condition that decides it exists, in `App`:

```tsx
				{workspaces.length === 0 && !loading ? (
					<Onboarding
						{...{
							onAdd: handleAddWorkspace,
							onAddMany: handleAddMany,
							onError: (m: string) => toast(m, 'error')
						}}
					/>
				) : (
					<>
						<SearchBox … />
						<ProjectTree … />
						<ActionButtons … />
					</>
				)}
```

`workspaces.length === 0` is "you have configured no workspaces", not "your workspaces are empty" — the difference chapter 06's empty states already drew. A workspace that scanned to zero (an offline drive, a stopped distro) gets the tree's own empty state, which explains *why*; only a user with nothing configured gets onboarding. `&& !loading` keeps the card from flashing during the first scan.

### Two lists, kept in sync

Adding a workspace surfaced a latent bug. DevGo has *two* pieces of workspace state: `useProjects` (the scanned projects) and `useWorkspaces` (the configured folder list). `useLaunchActions.addWorkspace` refreshed only the first — and onboarding's exit condition is the second. You would add your projects folder, watch the projects appear behind the card, and still be looking at the card. So `App` grows three handlers that touch both:

```tsx
	// useLaunchActions refreshes projects only; the workspace list is a second
	// view of the same state and goes stale without this
	const handleAddWorkspace = async (path: string) => {
		try {
			await addWorkspace(path);
		} catch (e) {
			toast(showError(e));
		}
		refreshWorkspaces();
	};

	const handleAddMany = async (paths: string[]) => {
		try {
			await invoke('add_workspace_folders', { paths });
		} catch (e) {
			toast(showError(e));
		}
		refreshWorkspaces();
		refresh();
	};
```

and `handleRemove` gains the same `refreshWorkspaces()`. This also fixes the quieter, pre-existing version — the Settings workspace list going stale after an add — because both symptoms are one cause. **When two hooks hold two views of the same state, every mutation has to touch both.**

### Drag-and-drop

Tauri owns file drag-drop (`dragDropEnabled` defaults on), so the OS drop is intercepted and the webview's HTML5 `ondrop` never fires — the paths come from `onDragDropEvent`'s payload:

```tsx
	// tauri owns file drag-drop, so this is the webview event, not html5
	const [dragOver, setDragOver] = useState(false);
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		getCurrentWebview()
			.onDragDropEvent(event => {
				const p = event.payload;
				if (p.type === 'enter' || p.type === 'over') setDragOver(true);
				else if (p.type === 'leave') setDragOver(false);
				else if (p.type === 'drop') {
					setDragOver(false);
					if (p.paths.length) handleAddMany(p.paths);
				}
			})
			.then(f => {
				unlisten = f;
			})
			.catch(() => {});
		return () => unlisten?.();
	}, []);
```

Narrowing on `p.type` directly is what lets TypeScript see `p.paths` on the `drop` branch. `dragOver` raises a dashed overlay — *Drop a folder to add a workspace* — with `pointer-events-none` so it never swallows the drop itself.

### The Scanning panel

`Settings.tsx` gains `ScanningPanel` — a textarea of names, one per line, loaded from `get_scan_config` on mount, saved with `set_scan_config` and followed by `onSaved`, which `App` wires as `onScanChanged: () => refresh()` so the list re-scans with the new list immediately. The panel object is one more entry in the registry, between Editors & Terminals and Shortcuts — the third panel to cost nothing structural. Its one comment records the three knobs that were left out and why, so the reader in the panel sees the reasoning.

> `✅UI: onboarding types` → `✅UI: onboarding card` → `✅UI: workspace lists stay in sync` → `✅UI: onboarding when no workspaces` → `✅UI: drop a folder to add it` → `✅UI: scanning panel` → `✅STAGE: 17 onboarding`; ff-merge; push.

---

## 17.5 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun tauri dev
```

`cargo test` reports **45**. Then, with WSL stopped throughout — `wsl -l -q --running` empty before and after every step:

**The card.** Move your `workspaces.json` aside (or empty it to `[]`) and launch. The tree is gone; *Welcome to DevGo*, *Choose a folder…*, *Scan for projects*, and the drag hint. The pill still reads `WSL · stopped`.

**Scan.** Click it. For example: **Found 2** — `~\projects` and `C:\dev`, both badged `WIN` — and no WSL rows, because no distro is running; `wsl -l -q --running` is still empty. Start a distro and scan again: its `~/projects`-style folders appear badged `WSL`, converted to `\\wsl.localhost\…` by the function chapter 05 promised and this chapter typed.

**Add.** *Add* on `~\projects`: the card is replaced by the tree in one step — the workspace header with its count (4 here) — because `handleAddWorkspace` refreshed both lists. Nothing selected, so the workspace is collapsed; `→` opens it.

**Ignore.** `Ctrl+,` → Scanning: the textarea reads `node_modules`, `archive`, `vendor`. Add the name of one of the four subfolders on its own line, *Save & rescan*, `Escape`: the count reads **3**. `prefs.json` holds the four names under `scan_config`. Put the textarea back and save again: 4.

**Drop.** Drag a folder from Explorer onto the window: the dashed overlay appears while it hovers, and the folder is a workspace on release. Drag a *file*: nothing is added. (This one cannot be driven from the debug port — Tauri intercepts the OS drop before the page sees it — so it is a hand check.)

Restore `workspaces.json` when done.

---

## What you built

```
src-tauri/src/
├── services/
│   ├── discover.rs            ← NEW: DiscoveredRoot, discover (running distros only), wsl_project_dirs
│   ├── platform/paths.rs      ← wsl_to_windows_path, typed at last
│   ├── preferences.rs         ← ScanConfig, default_ignore, scan_config / set_scan_config
│   ├── scanner.rs             ← ignore parameter, the four-line filter, its test
│   └── mod.rs                 ← discover
├── commands.rs                ← discover_roots, add_workspace_folders, get/set_scan_config,
│                                 ignore read once per pass
└── lib.rs                     ← four commands
src/
├── types.d.ts                 ← DiscoveredRoot, ScanConfig, OnboardingProps, ScanningPanelProps,
│                                 SettingsProps.onScanChanged
├── components/
│   ├── Onboarding.tsx         ← NEW: pick / scan / drop
│   └── Settings.tsx           ← ScanningPanel, one more registry entry
└── App.tsx                    ← handleAddWorkspace / handleAddMany / handleRemove sync both lists,
                                  onboarding condition, drag-drop effect + overlay
```

> **The thread running through Slice 8.** An empty DevGo that offers three ways to fill it, and a scan that skips the folders you name — but the real product is four decisions that kept the scan sacred: discovery scans only running distros, from the inside, behind a button; a dropped WSL path is added without a probe; the ignore list adds no I/O; and depth, monorepo expansion and a watcher were left out on purpose, each because it would put cost onto the path three earlier chapters worked to keep fast. **The measure of this slice is the features it refused.**

---

→ Next: [18 — Tray Quick-Launch](./18-tray-launch.md) (Slice 9), where "restore my last session" runs straight into the same law.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [16 — Command Palette](./16-palette.md)
