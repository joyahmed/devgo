# 21 — Nested Projects, Any Layout (post-plan)

**Branch:** `21.nested-discovery` — `git checkout 21.nested-discovery` gives you this chapter's finished app; `git diff 20.settings-surface 21.nested-discovery` is exactly what this chapter adds.

**Starting from:** chapter 20 — every setting DevGo has is reachable from the gear. The scan behind the list is the one chapter 03 wrote: one level deep, every immediate child of a workspace is a project. A Turborepo is one row, and `apps/web` inside it is not a thing you can launch.

**Goal:** a scan depth of 1 to 5 in the Scanning panel, where anything below the first level is a project only if it carries a marker — and where a WSL workspace at depth 5 still crosses the boundary exactly once.

> **Hold on to:**
> 1. **The refusal was the specification.** Chapter 17 did not say "no depth"; it said "not as a `read_dir` per folder over 9p", and wrote down the batched shape it would need. This chapter is that shape: the distro walks, in one spawn.
> 2. **The default pays nothing.** Depth 1 is `scan_flat`, chapter 03's code moved into its own function, and the two walkers are unreachable until someone asks.
> 3. **A marker, not a depth, decides what is a project — and the prune list is what makes the marker list safe.** `package.json` proves a project and proves a dependency equally well; only never entering `node_modules` tells them apart.
> 4. **`%h`, not the match.** The marker is the evidence; the row is the folder that holds it, which is why depth N needs `find` at N + 1.
>
> Rust: a recursive function carrying `&mut Vec` as an accumulator; `entries.flatten()` to skip unreadable entries; `Path::strip_prefix`; building a shell script with `format!` and a quoting closure. TypeScript: a `Button` variant for a fixed set of numbers.

> Chapter 17 refused this feature twice, and the refusals are the specification. Configurable depth was "not built" because *depth > 1 multiplies 9p round-trips on WSL workspaces* — a `read_dir` per folder per level over a filesystem where each read is a round trip to a VM. Monorepo expansion was deferred with its shape written down: done right, it would batch per distro, the way chapter 14's `detect.rs` and chapter 17's discovery do. Both refusals say the same thing from two sides: **the cost was never the walking, it was the crossing.** So this chapter builds the general feature — nested discovery at any depth, of which a monorepo is one case — and the whole design is the answer to one question: how does the WSL side walk five levels in one spawn?

---

## 21.1 — A number with a ceiling

The knob is a field on chapter 17's `ScanConfig`, in `src-tauri/src/services/preferences.rs`:

```rust
fn default_depth() -> usize {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    #[serde(default = "default_ignore")]
    pub ignore: Vec<String>,
    /// 1 is the one-level scan: every immediate child is a project. Above
    /// 1, nested folders that carry a marker are projects too.
    #[serde(default = "default_depth")]
    pub depth: usize,
}
```

and `depth: default_depth()` in the `Default` impl. `#[serde(default = "default_depth")]`, for the reason every persisted field in this book has carried one: a `prefs.json` written before this field existed has no `depth` key, and without the default it would fail to parse and take the rest of the preferences with it. The default is `1`, which is not "shallow" — it is *the scan you already had*, byte for byte, as 21.5 shows.

> `✅PREFS: scan depth`

---

## 21.2 — A marker, not a depth

Recursing is easy; deciding what counts is the feature. At depth 3, a workspace's grandchildren are `apps/`, `packages/`, `src/`, `docs/`, `node_modules/` — almost none of them projects. So below the first level a folder is a project only if it says so. At the top of `src-tauri/src/services/scanner.rs`, after the imports:

```rust
// a nested folder is a project only if it says so. .git is a directory and
// is handled on its own in both walkers
const FILE_MARKERS: &[&str] = &[
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "requirements.txt",
];

// never entered: node_modules alone holds a thousand package.json files
const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "vendor",
    ".next",
    ".venv",
    ".svn",
];
```

The prune list is what makes the marker list safe. `package.json` is the best possible marker for a Node project and the worst possible one for a Node project's dependencies: at depth 3, `mono/node_modules/react` has a `package.json`, and so do a thousand siblings. A marker without a prune list turns "surface `apps/web`" into "surface every package you have ever installed". Three helpers, above the tests:

```rust
fn is_pruned(name: &str, ignore: &[String]) -> bool {
    name.starts_with('.')
        || PRUNE_DIRS.iter().any(|p| p.eq_ignore_ascii_case(name))
        || ignore.iter().any(|ig| ig.eq_ignore_ascii_case(name))
}

fn has_marker(dir: &std::path::Path) -> bool {
    FILE_MARKERS.iter().any(|m| dir.join(m).exists())
        || dir.join(".git").exists()
}

// the path from the workspace root, forward slashes: `mono/apps/web`
fn relative_name(root: &std::path::Path, path: &std::path::Path) -> String {
    path.strip_prefix(root)
        .ok()
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        })
}
```

The user's ignore list joins the prune set in `is_pruned`, so the folders chapter 17 taught the scan to skip at level one are skipped at every level — the same `eq_ignore_ascii_case` on a bare name. `relative_name` is what a nested project is called: two `web` folders in two monorepos would otherwise be two rows called `web`. The relative path is the shortest name that is unambiguous inside one workspace, and it happens to read as the thing you would type.

> `✅SCAN: markers and prune list` — five dead-code warnings until 21.5 wires them.

---

## 21.3 — Windows walks; a bad branch is not a bad tree

On NTFS a `read_dir` is a syscall, so Windows simply recurses:

```rust
fn scan_windows_nested(
    root: &str,
    depth: usize,
    ignore: &[String],
) -> ScanOutcome {
    let root_path = std::path::Path::new(root);
    let entries = match std::fs::read_dir(root_path) {
        Ok(e) => e,
        Err(e) => {
            return ScanOutcome::Unavailable(match e.kind() {
                std::io::ErrorKind::PermissionDenied => {
                    UnavailableReason::AccessDenied
                }
                _ => UnavailableReason::NotMounted,
            })
        }
    };
    let fs_type = detect_file_system(root).to_string();
    let mut out = Vec::new();
    walk_windows(entries, root_path, 1, depth, ignore, &fs_type, &mut out);
    out.sort_by_key(|p| p.name.to_lowercase());
    ScanOutcome::Scanned(out)
}

// a sub-read that fails is a missing branch, not an unavailable workspace;
// only the root read decides that
fn walk_windows(
    entries: std::fs::ReadDir,
    root: &std::path::Path,
    level: usize,
    max: usize,
    ignore: &[String],
    fs_type: &str,
    out: &mut Vec<Project>,
) {
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_pruned(&name, ignore) {
            continue;
        }
        let path = entry.path();
        // every immediate child is a project; deeper only if marked
        if level == 1 || has_marker(&path) {
            out.push(Project::new(
                relative_name(root, &path),
                path.to_string_lossy().into_owned(),
                root.to_string_lossy().into_owned(),
                fs_type.to_string(),
            ));
        }
        if level < max {
            if let Ok(sub) = std::fs::read_dir(&path) {
                walk_windows(sub, root, level + 1, max, ignore, fs_type, out);
            }
        }
    }
}
```

The rule is one line, and the `||` in it is the whole model. Level one is unconditional, because that is what a workspace *means* — chapter 03's contract, "your projects folder, one project per child", is unchanged. Below it, `has_marker`. So a monorepo root is a row (level 1), its `apps/web` is a row (marked), and `apps/` itself is not (a container with nothing in it but folders). You get the repo root **and** its sub-projects, which is what "open the monorepo" and "open just the web app" both need.

`if let Ok(sub)` is the decision in this function, and its comment states it. A workspace with one folder you cannot read is a workspace with one folder missing, not an unavailable workspace. Chapter 06's `Unavailable` states describe the *root* — a detached drive, a stopped distro — and a permissions error three levels down is not that. Promoting it would mark a whole workspace stale, and chapter 06's cache would then quietly serve yesterday's list for a tree that is fine.

`fs_type` is `detect_file_system(root)`, threaded through the walk, not a hardcoded `"Windows"`. A network share (chapter 15's `Network ⚠`) scanned at depth 2 keeps its warning on every row; a hardcoded value would have lost it the moment you turned depth up.

> `✅SCAN: windows walker`

---

## 21.4 — WSL crosses once

This is the section chapter 17's refusal was waiting for. The Windows walker above, pointed at `\\wsl.localhost\Ubuntu\home\user\projects` with depth 3, would issue one 9p `read_dir` per folder per level — dozens of round trips to the VM for a list that used to take one. So the WSL side does not walk. It asks the distro to walk, in one spawn. Two new imports at the top — `std::os::windows::process::CommandExt` and `std::process::Command` — and the `CREATE_NO_WINDOW` constant chapter 04 introduced, then:

```rust
// the distro walks, in one spawn: five levels of reads on ext4 instead of
// one 9p round trip per folder
fn scan_wsl_nested(
    path: &str,
    distro: &str,
    depth: usize,
    ignore: &[String],
) -> ScanOutcome {
    let linux_root = super::platform::paths::windows_to_wsl_path(path, distro);
    let script = wsl_find_script(&linux_root, depth, ignore);

    let output = Command::new("wsl")
        .creation_flags(CREATE_NO_WINDOW)
        .env("WSL_UTF8", "1")
        .args(["-d", distro, "-e", "bash", "-lc", &script])
        .output();

    let text = match output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).into_owned()
        }
        // ran and found nothing: an empty scan. only a failed spawn is
        // unavailable
        Ok(_) => String::new(),
        Err(_) => {
            return ScanOutcome::Unavailable(UnavailableReason::NotMounted)
        }
    };

    let prefix = format!("{linux_root}/");
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for line in text
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.is_empty())
    {
        // the root's own .git names the workspace, not a project; a folder
        // with two markers prints twice
        if line == linux_root || !seen.insert(line.to_string()) {
            continue;
        }
        let rel = line.strip_prefix(&prefix).unwrap_or(line);
        if rel.is_empty() {
            continue;
        }
        out.push(Project::new(
            rel.to_string(),
            super::platform::paths::wsl_to_windows_path(line, distro),
            path.to_string(),
            "WSL".to_string(),
        ));
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    ScanOutcome::Scanned(out)
}
```

The shape is chapter 14's `detect.rs` and chapter 17's `wsl_project_dirs`, a third time: convert the path with chapter 05's `windows_to_wsl_path`, build a script, run it inside the distro, parse lines. Everything expensive — five levels of directory reads, every marker check — happens on ext4, inside the VM, where a `stat` is a `stat`. One process boundary, whatever the depth. Each surviving line becomes a `Project` whose display name is the path after `{linux_root}/` and whose `full_path` is chapter 17's `wsl_to_windows_path` of the line — the `\\wsl.localhost\` form every launcher in DevGo expects.

The exit-status handling records a distinction chapter 06 first drew: only a failure to *spawn* is `Unavailable`. The distro answered; what it answered is the scan. The two skips in the loop matter: a workspace that is itself a git repository has a `.git` at level one, and `%h` of that is the workspace — which is not a project, it is the thing that contains them; and a folder with both a `.git` and a `package.json` prints twice, so `seen` keeps it to one row.

The script is two `find`s, and the second one carries the design:

```rust
// two finds: every immediate child, then every deeper folder with a marker.
// %h prints the folder that holds the match, so depth N needs find at N+1
fn wsl_find_script(root: &str, depth: usize, ignore: &[String]) -> String {
    let q = |s: &str| s.replace('\'', "'\\''");
    let root_q = q(root);

    let mut prune: Vec<String> =
        PRUNE_DIRS.iter().map(|s| s.to_string()).collect();
    prune.extend(ignore.iter().cloned());
    let not_names = prune
        .iter()
        .map(|n| format!("! -name '{}'", q(n)))
        .collect::<Vec<_>>()
        .join(" ");
    let prune_or = prune
        .iter()
        .map(|n| format!("-name '{}'", q(n)))
        .collect::<Vec<_>>()
        .join(" -o ");
    let file_markers = FILE_MARKERS
        .iter()
        .map(|m| format!("-name '{m}'"))
        .collect::<Vec<_>>()
        .join(" -o ");
    let marker_depth = depth + 1;

    format!(
        "find '{root_q}' -mindepth 1 -maxdepth 1 -type d ! -name '.*' {not_names} -print 2>/dev/null; \
         find '{root_q}' -mindepth 1 -maxdepth {marker_depth} \
           \\( -type d -name '.git' -printf '%h\\n' -prune \\) -o \
           \\( {prune_or} -o -name '.*' \\) -prune -o \
           -type f \\( {file_markers} \\) -printf '%h\\n' 2>/dev/null"
    )
}
```

The first `find` is level one — every immediate child that is a directory, not hidden, not pruned — which is `scan_flat` written in `find`. The second is the marker search, and it prints **`%h`**, the directory *containing* the match, not the match. A `package.json` at `mono/apps/web/package.json` yields `mono/apps/web`, which is the row. That is also why `marker_depth` is `depth + 1`: a project at depth 3 is proven by a file at depth 4.

`.git` gets its own clause before the prune group, because it is both a marker and a folder that must never be entered. `-type d -name '.git' -printf '%h\n' -prune` prints the parent and stops descending, in that order; put `.git` only in the prune list and no git repository without a `package.json` would ever surface. The `q` closure single-quotes every user-supplied name — the ignore list reaches this script from a textarea, and a name with a space in it must arrive as one argument.

> `✅SCAN: wsl finds in one spawn`

---

## 21.5 — Depth 1 is the old code, untouched

Now the caller. A cap first, beside `CREATE_NO_WINDOW`:

```rust
// whatever the config says: prefs.json is text and import reads foreign
// files, so the cap lives where every path meets
const MAX_DEPTH: usize = 5;
```

The panel offers 1 to 5 and nothing else, but the panel is not the only way a value reaches `prefs.json` — the file is text, and chapter 19's import reads a file somebody else wrote. So the cap lives in the scanner, where every path in meets it, not in the buttons.

`scan_workspace` takes a fifth argument and, after the liveness gate, decides whether this chapter applies at all:

```rust
    if depth <= 1 {
        return scan_flat(path, ignore);
    }

    // opt-in. wsl asks the distro to walk, once; windows walks itself
    let depth = depth.min(MAX_DEPTH);
    match distro_of(path) {
        Some(distro) => scan_wsl_nested(path, &distro, depth, ignore),
        None => scan_windows_nested(path, depth, ignore),
    }
}

// the original one-level scan: every immediate subdirectory is a project
fn scan_flat(path: &str, ignore: &[String]) -> ScanOutcome {
    let entries = match std::fs::read_dir(path) {
```

Everything from that `read_dir` down is chapter 03's body, unmoved — the function header slides in above it and the old `scan_workspace` ends at the dispatch. **The default pays nothing.** A user who never opens the Scanning panel runs the code they ran yesterday, and the two new walkers are unreachable until someone asks for them. That split is a decision, not tidiness: one walker with `max = 1` for the default would have put a marker check on every project in every scan, for everyone, to support a feature most of them never turn on.

Note that the liveness gate runs *before* the dispatch: a stopped distro is `DistroStopped` at any depth, and the batched `find` never spawns for it. The three existing scanner tests gain a `, 1` — and `collect_projects` in `commands.rs` reads both fields out of the preferences lock at once, the same once-per-pass discipline chapter 17 used for the ignore list:

```rust
    // read once per pass, keeps the lock out of the scan loop
    let (ignore, depth) = {
        let cfg = state.pref_store.lock().map_err(lock_err)?.scan_config();
        (cfg.ignore, cfg.depth)
    };
```

and passes `depth` as the fifth argument to `scan_workspace`.

> `✅SCAN: depth dispatch` — `cargo check` clean.

The test builds the layout the chapter has been describing and asserts the exact list:

```rust
    /// A monorepo root and its marked sub-projects surface; containers and
    /// node_modules do not.
    #[test]
    fn nested_scan_finds_root_and_marked_subprojects() {
        let dir = std::env::temp_dir().join("devgo-scan-nested-test");
        let _ = std::fs::remove_dir_all(&dir);

        let mono = dir.join("mono");
        std::fs::create_dir_all(mono.join("apps").join("web")).unwrap();
        std::fs::create_dir_all(mono.join("packages").join("ui")).unwrap();
        std::fs::create_dir_all(mono.join("node_modules").join("dep")).unwrap();
        std::fs::create_dir_all(dir.join("plain")).unwrap();
        std::fs::write(mono.join("package.json"), "{}").unwrap();
        std::fs::write(
            mono.join("apps").join("web").join("package.json"),
            "{}",
        )
        .unwrap();
        std::fs::write(mono.join("packages").join("ui").join("Cargo.toml"), "")
            .unwrap();
        std::fs::write(
            mono.join("node_modules").join("dep").join("package.json"),
            "{}",
        )
        .unwrap();

        let path = dir.to_string_lossy().to_string();
        let ScanOutcome::Scanned(projects) =
            scan_workspace(&path, &[], false, &[], 3)
        else {
            panic!("local temp dir should scan");
        };
        let mut names: Vec<_> =
            projects.iter().map(|p| p.name.as_str()).collect();
        names.sort();

        assert_eq!(
            names,
            vec!["mono", "mono/apps/web", "mono/packages/ui", "plain"]
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
```

A root with a `package.json`, `apps/web` with one, `packages/ui` with a `Cargo.toml`, a `node_modules/dep` with a `package.json` that must not appear, and a `plain` folder with no marker at all — at depth 3. Four rows, and the two containers and the dependency are absent. The Windows walker is what a unit test can exercise; the WSL script is the same rules expressed in `find`, and the `%h` and `.git` clauses above are the places to look if the two ever disagree.

> `✅TEST: nested scan`. `cargo test` reports **55**.

---

## 21.6 — Five buttons

Five hand-styled `<button>`s would break chapter 02's one-`Button` rule; instead `Button` gains a variant for a fixed set of small choices, in `Button.tsx` after `card`, with `'choice'` on `ButtonVariant`:

```typescript
	// One of a small fixed set, like a number; the chosen one is aria-pressed.
	choice:
		'w-9 h-9 text-sm rounded-md border border-border bg-bg-panel text-text-secondary hover:text-text-primary hover:border-text-muted aria-[pressed=true]:border-accent aria-[pressed=true]:bg-bg-hover/40 aria-[pressed=true]:text-text-primary'
```

`aria-pressed` again, as `card` used it in chapter 19 — the chosen one says so in the markup and the stylesheet reads it. The base has no padding of its own, so `w-9 h-9` is the whole box.

> `✅UI: button choice variant`

`ScanConfig` in `types.d.ts` gains `depth: number`, and the Scanning panel gains a section above the ignore list. Its header comment is rewritten, because the reason it gave for not having a depth control is no longer true:

```tsx
const DEPTHS = [1, 2, 3, 4, 5];

// the ignore list, and how deep to look. depth is safe on wsl because the
// distro walks in one spawn; a watcher is still out, it would never stop
const ScanningPanel = ({ onSaved, onError }: ScanningPanelProps) => {
	const [text, setText] = useState<string | null>(null);
	const [depth, setDepth] = useState(1);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		invoke<ScanConfig>('get_scan_config')
			.then(c => {
				setText(c.ignore.join('\n'));
				setDepth(c.depth);
			})
```

the save sends `{ ignore, depth }`, and the section:

```tsx
			<div>
				<h4 className={heading}>Scan depth</h4>
				<p className='text-xs text-text-muted mb-2'>
					How many folder levels deep to look for projects. 1 keeps the
					original scan (every immediate child). Higher also surfaces nested
					projects — a monorepo's{' '}
					<code className='text-text-secondary'>apps/web</code>, or any nested
					layout — as their own launchable rows. On WSL this is one batched
					lookup, so depth stays cheap.
				</p>
				<div className='flex items-center gap-2'>
					{DEPTHS.map(n => (
						<Button
							key={n}
							variant='choice'
							aria-pressed={depth === n}
							onClick={() => setDepth(n)}
							disabled={text === null}
						>
							{n}
						</Button>
					))}
				</div>
			</div>
```

Save calls `onSaved`, which is `refresh()` — so the list re-scans at the new depth immediately, the same round trip chapter 17 wired for the ignore list. The textarea shrinks from `h-40` to `h-32` to make room.

> `✅UI: scan depth`

---

## 21.7 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun tauri dev
```

`cargo test` reports **55** — chapter 20's 54 plus `nested_scan_finds_root_and_marked_subprojects`. Then, in the app:

**The panel.** `Ctrl+,` → Scanning: five buttons, **1** outlined, above the ignore list.

**Windows, depth 3.** Click **3**, *Save & rescan*, `Escape`. On a workspace of Tauri projects (`G:\projects` here) the count goes from **17** rows to **30**: every project's `src-tauri` is now a row of its own — `devgo/src-tauri`, badged **RUST** by chapter 14's pass, which needed no change to see it — and a `src-tauri/wsl-server` three levels down is a depth-3 row. `prefs.json` holds `"depth": 3`. The WSL workspaces are untouched: still *Cached · WSL stopped*, same counts as before, and `wsl -l -q --running` is empty — the gate runs before the dispatch.

**WSL, one spawn.** Start a distro (`wsl -d Ubuntu-26.04 echo ok`) and press `F5`. Its workspaces re-scan through the `find` script: a workspace of six Turborepos goes from **6** to **47** — `shop/apps/api`, `shop/apps/web`, `shop/packages/database`, … every app and package, none of their `node_modules` — and `projects-cache.json` records each with a `\\wsl.localhost\…\apps\api` path and `WSL` as its file system. `wsl --shutdown`; the rows stay, served from the cache. One of them is worth a look: `blog/generated/prisma` surfaced because a generated folder carries a `package.json`. That is the marker rule working as specified, and the ignore list — `generated`, one line — is the knob for it.

**Back to 1.** Set depth to **1**, save: the counts are the old counts. Restore `prefs.json` and `projects-cache.json` when done.

> `✅STAGE: 21 nested-discovery`; ff-merge; push.

---

## What you built

```
src-tauri/src/
├── services/
│   ├── preferences.rs         ← ScanConfig.depth, default_depth
│   └── scanner.rs             ← MAX_DEPTH, FILE_MARKERS, PRUNE_DIRS; is_pruned, has_marker, relative_name;
│                                 scan_flat (chapter 03, moved); scan_windows_nested + walk_windows;
│                                 scan_wsl_nested + wsl_find_script; depth dispatch; nested test
└── commands.rs                ← (ignore, depth) read once, depth passed down
src/
├── types.d.ts                 ← ScanConfig.depth, ButtonVariant 'choice'
├── components/Button.tsx      ← choice variant
└── components/Settings.tsx    ← DEPTHS, depth state, the picker, { ignore, depth } on save
```

> **The thread running through this chapter.** A scan depth from 1 to 5, where the first level is still every child and every level below it is a project only if it carries a marker — a Turborepo's `apps/web`, any nesting — with `node_modules` and its kind never entered, and a WSL workspace still crossing into the distro exactly once. The refusal in chapter 17 was never "no depth"; it was "not as a per-folder scan over 9p", and this is not one. **The default pays nothing, the cap lives where every path meets, and a bad branch is not a bad tree.**

→ Next: [22 — The Failures That Said Nothing](./22-config-guard.md) (post-plan), three stores that would have thrown your config away on a bad byte, and the guard that sends it to `.bak` instead.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [20 — The Settings That Were Already There](./20-settings-surface.md)
