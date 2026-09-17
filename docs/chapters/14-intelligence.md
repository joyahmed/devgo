# 14 — Project Intelligence (Slice 5)

**Branch:** `14.intelligence` — `git checkout 14.intelligence` gives you this chapter's finished app; `git diff 13.targets 14.intelligence` is exactly what this chapter adds.

**Starting from:** Slice 4 — any editor, any terminal, both described by templates the user owns. DevGo can open anything. It still cannot tell you anything about what it is opening: every row is a name, a folder and a branch.

**Goal:** stack badges beside every project, a package manager, and a marker when dependencies are not installed — all of it for **one directory listing per project**, and never a booted distro.

> **Hold on to:**
> 1. **One listing, not eleven stats.** Every fact is derived from the *names* in a single directory listing. `classify(full_path, names)` cannot probe, because it has nothing to probe with — push the I/O to the edge and the expensive mistake becomes unrepresentable.
> 2. **Cross the boundary once — even when the far-side work is cheap.** Chapter 10's batch script pays off a second time for `ls`. The cost was never the work; it was the crossing.
> 3. **Order by a table, not by the filesystem.** A launcher is navigated by muscle memory, and correct-but-unstable output destroys it. `tag_order_is_deterministic` pins that.
> 4. **A presentation lookup degrades to plain, never to absent.** An unknown tag renders muted, so a missing colour looks like a missing colour and not like a broken detector.
>
> **What this chapter does not carry.** The dev-script reader — `scripts.rs`, `get_project_scripts`, `run_script`, run templates on `LaunchTarget` — waits for chapter 20, the first UI that calls it. The rule of this book is that a chapter contains what the chapter uses, so that half waits for the chapter that gives it a door; this one is badges.

> This is the first slice where the plan contains its own refutation. It lists eleven things to detect — Next.js, Turborepo, Rust, Docker, Python, Go, Node, package managers — and then, immediately below the list, warns: *these are per-project filesystem probes; otherwise every scan pays 11 extra `stat` calls per project, and on a WSL workspace each one crosses the 9p boundary.*
>
> Eleven probes per project. Forty projects. Four hundred and forty round trips to a virtual machine to draw some coloured rectangles. That is not a feature with a performance problem; that is a feature that cannot ship in the shape it was specified. The whole chapter comes out of taking that note seriously.

---

## 14.1 — One listing, not eleven stats

Create `src-tauri/src/services/detect.rs`, and add `pub mod detect;` to `services/mod.rs`:

```rust
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

use super::platform::wsl;
use super::scanner::distro_of;
use crate::models::Project;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// What a project appears to be, derived entirely from the names of the files
/// in its top directory.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ProjectTech {
    pub full_path: String,
    /// Stack tags, in the order declared by `MARKERS` so badges never reshuffle.
    pub tags: Vec<&'static str>,
    pub package_manager: Option<&'static str>,
    /// A `.nvmrc` or `.node-version` is present. The contents are not read here
    /// — that would be a second round trip per project for a string almost
    /// nothing consumes yet.
    pub pins_node_version: bool,
    /// Dependencies appear to be installed (`node_modules`, `target`, `.venv`).
    pub has_deps: bool,
}
```

`tags: Vec<&'static str>` rather than `Vec<String>` is the first sign of the design. Every tag DevGo can produce is a literal in the source below; none is computed from user data. `&'static str` says exactly that, allocates nothing, and makes it a compile error to accidentally start returning a string that came off the filesystem.

Then the three tables that *are* the feature:

```rust
/// Filename → tag. Order here is the order badges render in.
const MARKERS: &[(&str, &str)] = &[
    ("turbo.json", "turbo"),
    ("next.config.js", "next"),
    ("next.config.mjs", "next"),
    ("next.config.ts", "next"),
    ("Cargo.toml", "rust"),
    ("go.mod", "go"),
    ("pyproject.toml", "python"),
    ("requirements.txt", "python"),
    ("Dockerfile", "docker"),
    ("docker-compose.yml", "docker"),
    ("docker-compose.yaml", "docker"),
    ("package.json", "node"),
];

/// Lockfile → package manager. Checked in this order, so a repo carrying more
/// than one lockfile reports the more specific tool rather than whichever the
/// filesystem happened to list first.
const LOCKFILES: &[(&str, &str)] = &[
    ("bun.lock", "bun"),
    ("bun.lockb", "bun"),
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("package-lock.json", "npm"),
];

const DEP_DIRS: &[&str] = &["node_modules", "target", ".venv", "vendor"];
const NODE_VERSION_FILES: &[&str] = &[".nvmrc", ".node-version"];
```

Twelve marker rows for seven tags, because a stack can announce itself several ways. Mapping *filename → tag* rather than *tag → filenames* keeps the table flat and keeps the render order in the same place as the matching rules, which §14.5's determinism argument depends on. And the whole of the detection:

```rust
/// Turn one directory listing into a verdict.
///
/// Everything is derived from names alone. That is the entire performance
/// story: one listing per project rather than eleven `stat` calls, which on a
/// WSL workspace would be eleven round trips across the 9p boundary.
fn classify(full_path: &str, names: &[String]) -> ProjectTech {
    let has = |n: &str| names.iter().any(|f| f == n);

    let mut tags: Vec<&'static str> = Vec::new();
    for (file, tag) in MARKERS {
        if has(file) && !tags.contains(tag) {
            tags.push(tag);
        }
    }

    // A Next.js or Turborepo project is also a Node project, but saying so adds
    // nothing — the specific tag is the useful one.
    if tags.iter().any(|t| *t == "next" || *t == "turbo") {
        tags.retain(|t| *t != "node");
    }

    ProjectTech {
        full_path: full_path.to_string(),
        tags,
        package_manager: LOCKFILES
            .iter()
            .find(|(file, _)| has(file))
            .map(|(_, pm)| *pm),
        pins_node_version: NODE_VERSION_FILES.iter().any(|f| has(f)),
        has_deps: DEP_DIRS.iter().any(|d| has(d)),
    }
}
```

### One listing, not eleven stats

The specified shape is a probe per fact: `Path::new(p).join("turbo.json").exists()`, then `next.config.js`, then `Cargo.toml` — eleven syscalls, each asking the filesystem a yes/no question about a name you already know. On NTFS that is microseconds. **The reason it does not ship is not the cost; it is the cost on the machine DevGo exists for.** A `\\wsl.localhost\` path goes through 9p, and every question over it is a round trip to a virtual machine.

`classify` asks **one** question — "what is in this directory?" — and answers all eleven from the reply. The signature is the tell: `fn classify(full_path: &str, names: &[String])`. It does not know what a filesystem is. It cannot accidentally grow a probe, because it has nothing to probe *with* — the only I/O in the module lives in `list_windows` and `list_wsl_batch`, each of which does exactly one thing once. That is also what makes §14.5's seven tests plain unit tests with no fixture directories.

Two things are deliberately *not* derived, and both are the same restraint. `pins_node_version` is a boolean, not a version — reading `.nvmrc`'s contents is a second round trip per project for a string nothing consumes yet. And nothing checks whether the tools are actually installed; that would need to run programs.

### Precedence, and a repo mid-migration

`LOCKFILES` is checked with `.find()`, which stops at the first hit — so the order of that table is a decision. A repository migrating from npm to pnpm carries both lockfiles for weeks. Take "whichever the listing yielded first" and the same repository reports `npm` on your desktop and `pnpm` on your laptop. The table fixes the answer, and the rule behind the order is **report the more specific tool**: `package-lock.json` is the one a stray `npm install` leaves behind by accident. If you have a `pnpm-lock.yaml`, someone chose pnpm.

### Dropping the redundant `node` tag

Every Next.js project has a `package.json`, so the table applied literally tags them `next node` — *true* and useless. A badge is a row of pixels you scan at speed; `turbo` tells you something and `node` beside it tells you nothing you had not inferred. Note the asymmetry: `rust` and `docker` coexist happily, and `reports_multiple_stacks` pins that. The `node` removal is not "collapse to one tag" — it is "drop a tag that is strictly implied by another one already shown." **A derived label that is always true given a label you are already showing is noise.**

---

## 14.2 — Windows: one `read_dir`

```rust
fn list_windows(path: &str) -> Vec<String> {
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}
```

Seven lines and no error type. A directory that vanished between the scan and the badge pass contributes an empty listing and therefore no badges — the same silent degradation chapter 10 chose for git, for the same reason: **a badge is decoration, and decoration is never worth an error dialog.**

---

## 14.3 — WSL: batching, again

```rust
/// One bash invocation lists every WSL project in a distro.
///
/// The alternative — a `read_dir` per project over `\\wsl.localhost\` — is one
/// 9p round trip per project *plus* one per entry returned. Doing it inside
/// Linux makes it a local `ls`.
fn list_wsl_batch(
    distro: &str,
    projects: &[&Project],
) -> HashMap<String, Vec<String>> {
    let mut linux_to_windows = HashMap::new();
    let mut script = String::from("set -f\n");
    for p in projects {
        let linux =
            super::platform::paths::windows_to_wsl_path(&p.full_path, distro);
        script.push_str(&format!(
            "printf '\\0P\\0{linux}\\0'\nls -A '{esc}' 2>/dev/null\n",
            esc = linux.replace('\'', "'\\''")
        ));
        linux_to_windows.insert(linux, p.full_path.clone());
    }

    let output = Command::new("wsl")
        .creation_flags(CREATE_NO_WINDOW)
        .env("WSL_UTF8", "1")
        .args(["-d", distro, "-e", "bash", "-c", &script])
        .output();

    let text = match output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).into_owned()
        }
        _ => return HashMap::new(),
    };

    let mut listings = HashMap::new();
    for record in text.split("\u{0}P\u{0}").skip(1) {
        let mut parts = record.splitn(2, '\u{0}');
        let linux = parts.next().unwrap_or("");
        let names = parts
            .next()
            .unwrap_or("")
            .lines()
            .map(|l| l.trim_end_matches('\r').to_string())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>();
        if let Some(win) = linux_to_windows.get(linux) {
            listings.insert(win.clone(), names);
        }
    }
    listings
}
```

### The second time the same technique paid off

Read that against chapter 10's `wsl_script` and you should feel like you have seen it before. `set -f`. A `printf` with NUL delimiters. `'\''` escaping on every interpolated path. `2>/dev/null`. One `wsl.exe` spawn per distro carrying a script that does N things inside Linux. `WSL_UTF8=1`.

**That is the point of this section.** Chapter 10 made the argument — crossing the Windows↔WSL boundary costs ~80 ms and everything on the far side is nearly free — and it was defensible there because git is expensive. Here the far-side work is `ls`, about the cheapest thing a filesystem does, and the technique is *still* worth it. An unbatched version would be worse here than for git: a `read_dir` over 9p is one round trip to open the directory **plus traffic proportional to the entries returned**, and a `node_modules`-bearing directory has plenty. Forty WSL projects across two distros cost **two** spawns.

**A technique that pays for itself twice, in two features that share nothing else, is a property of your platform rather than a trick.**

The wire format is smaller this time — one field per project, so one marker, `\0P\0`. `splitn(2, '\u{0}')` states the intent (exactly two fields). `trim_end_matches('\r')` is the small ugly one: output through a Windows pipe can arrive `\r\n`, and `Cargo.toml\r != Cargo.toml` silently loses the badge on someone else's machine. `ls -A` omits `.` and `..`. And every failure branch collapses to `HashMap::new()` — a distro that will not start, a missing `bash`, a non-zero exit all mean "no badges", which is what an empty result means.

---

## 14.4 — `collect`, and the distro that stays asleep

```rust
/// Classify every project.
///
/// `running` is the live-distro list. A WSL project whose distro is stopped is
/// skipped for the same reason git is: a stack badge is never worth booting a
/// virtual machine for.
pub fn collect(projects: &[Project], running: &[String]) -> Vec<ProjectTech> {
    let mut by_distro: HashMap<String, Vec<&Project>> = HashMap::new();
    let mut windows: Vec<&Project> = Vec::new();

    for p in projects {
        match distro_of(&p.full_path) {
            Some(distro) if wsl::is_running(&distro, running) => {
                by_distro.entry(distro).or_default().push(p)
            }
            Some(_) => {}
            None => windows.push(p),
        }
    }

    let mut out = Vec::new();

    for (distro, group) in &by_distro {
        for (full_path, names) in list_wsl_batch(distro, group) {
            out.push(classify(&full_path, &names));
        }
    }

    for p in windows {
        out.push(classify(&p.full_path, &list_windows(&p.full_path)));
    }

    out
}
```

The middle arm — `Some(_) => {}` — is the one that matters. A WSL project in a **stopped** distro is dropped on the floor: no entry, no placeholder, no "unknown" — exactly chapter 10's treatment of git, for chapter 06's reason. An empty arm is easy to read as an oversight, which is why the doc comment spends a sentence on it. **The most important line in this function is the one that does nothing.**

Note what is *not* here: chapter 10's `collect` capped parallelism with a thread scope, because git reads are slow enough to overlap. This one is sequential. Two `wsl.exe` spawns and a handful of `read_dir` calls do not need a scheduler. **Reach for the same technique as last time, but not automatically for the same *amount* of it.**

---

## 14.5 — Seven tests, none of which touch a disk

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tags_a_turborepo_without_also_saying_node() {
        let t = classify(
            "x",
            &names(&["turbo.json", "package.json", "pnpm-lock.yaml"]),
        );
        assert_eq!(t.tags, vec!["turbo"]);
        assert_eq!(t.package_manager, Some("pnpm"));
    }

    #[test]
    fn plain_node_projects_keep_the_node_tag() {
        let t = classify("x", &names(&["package.json", "package-lock.json"]));
        assert_eq!(t.tags, vec!["node"]);
        assert_eq!(t.package_manager, Some("npm"));
    }

    /// A polyglot repo should report every stack it actually contains.
    #[test]
    fn reports_multiple_stacks() {
        let t = classify("x", &names(&["Cargo.toml", "go.mod", "Dockerfile"]));
        assert_eq!(t.tags, vec!["rust", "go", "docker"]);
    }

    /// Badge order follows MARKERS, not the filesystem, so the UI is stable
    /// between scans.
    #[test]
    fn tag_order_is_deterministic() {
        let a =
            classify("x", &names(&["Dockerfile", "Cargo.toml", "turbo.json"]));
        let b =
            classify("x", &names(&["turbo.json", "Cargo.toml", "Dockerfile"]));
        assert_eq!(a.tags, b.tags);
        assert_eq!(a.tags, vec!["turbo", "rust", "docker"]);
    }

    #[test]
    fn detects_installed_dependencies_and_version_pins() {
        let t =
            classify("x", &names(&["package.json", "node_modules", ".nvmrc"]));
        assert!(t.has_deps);
        assert!(t.pins_node_version);

        let bare = classify("x", &names(&["package.json"]));
        assert!(!bare.has_deps);
        assert!(!bare.pins_node_version);
    }

    #[test]
    fn an_unrecognised_folder_gets_no_tags() {
        let t = classify("x", &names(&["notes.txt", "img.png"]));
        assert!(t.tags.is_empty());
        assert_eq!(t.package_manager, None);
    }

    /// Multiple lockfiles happen in migrations; report the more specific tool
    /// rather than whatever the listing happened to yield first.
    #[test]
    fn lockfile_precedence_is_stable() {
        let t = classify("x", &names(&["package-lock.json", "pnpm-lock.yaml"]));
        assert_eq!(t.package_manager, Some("pnpm"));
    }
}
```

Every one is a list of strings in, a struct out. No temp directory, no WSL, no cleanup — the payoff of §14.1's signature.

### Determinism in the UI, as a testable property

`tag_order_is_deterministic` does not check *what* the function returns so much as that it returns the same thing twice. The two calls pass the same names in different orders — which is what two machines, or one machine across two scans, will hand you: `read_dir` makes no ordering promise, and `ls -A` sorts by locale. The bug it prevents is not a wrong badge. It is a launcher where `devgo-app` shows `rust docker` today and `docker rust` tomorrow — still correct, no longer *memorisable*, and memorisable is the entire product. Chapter 09 made the same argument for ranking. The second assertion pins the concrete order too, so reordering `MARKERS` fails a test: that table's order is now a UI decision.

`an_unrecognised_folder_gets_no_tags` is the boring one that is not boring: it pins that a directory with no markers produces an *empty* `tags` vector, which is what §14.7's `TechBadges` relies on to render nothing rather than an empty bordered box.

---

## 14.6 — One command and a cache

`AppState` in `commands.rs` gains a field, beside `git_cache`:

```rust
    /// Stack detection, in memory only, for the same reason as git: `node` on
    /// a project whose package.json went last week looks current too.
    pub tech_cache: Mutex<HashMap<String, ProjectTech>>,
```

with `use crate::services::detect::{self, ProjectTech};` at the top. Chapter 10's `get_git_info` carried its own inline liveness check. Two commands need it now, so it becomes a helper, and `get_git_info` calls it:

```rust
/// The running-distro list, fetched only when some project actually needs it.
/// Same liveness gate the scanner uses: neither git state nor a stack badge is
/// ever worth booting a virtual machine for.
fn running_for(projects: &[Project]) -> Vec<String> {
    if projects
        .iter()
        .any(|p| crate::services::scanner::distro_of(&p.full_path).is_some())
    {
        wsl::running_distros()
    } else {
        Vec::new()
    }
}
```

`wsl::running_distros()` spawns `wsl.exe`, so a user with no WSL projects at all never pays for it — which is what the `any` guard buys.

```rust
/// Classify projects by stack. Same contract as `get_git_info`: a separate
/// command, off the scan's hot path, and never worth booting a distro for.
#[tauri::command]
pub fn get_project_tech(
    projects: Vec<Project>,
    state: State<AppState>,
) -> Result<Vec<ProjectTech>, AppError> {
    let running = running_for(&projects);
    let fresh = detect::collect(&projects, &running);
    let mut cache = state.tech_cache.lock().map_err(lock_err)?;
    for t in &fresh {
        cache.insert(t.full_path.clone(), t.clone());
    }
    Ok(fresh)
}
```

Line for line the shape of `get_git_info`, and the doc comment says so rather than re-arguing it. Three chapters in, "a per-project fact is its own command, fired after the list is on screen, gated on running distros, cached in memory" is a **house pattern** — and the value of a house pattern is that the fourth one needs no design discussion at all. The cache has no reader yet in this chapter; it is the store the script reader will consult when it arrives, so that asking for one project's scripts never re-lists its directory.

In `lib.rs`: `tech_cache: std::sync::Mutex::new(std::collections::HashMap::new())` in the state, and `commands::get_project_tech` after `get_git_info` in the handler list.

> **Commit checkpoint** — `cargo test` reports **43**: chapter 13's 36 plus 7 in `services::detect`.
>
> ```powershell
> git add -A && git commit -m "✅DETECT: classify project stacks from one directory listing — batched over WSL, gated on running distros, running_for shared with git"
> ```

---

## 14.7 — Badges

`src/types.d.ts`, above `LastProject`:

```ts
/// What a project appears to be, from the names in its top directory alone.
interface ProjectTech {
	full_path: string;
	tags: string[];
	package_manager: string | null;
	pins_node_version: boolean;
	has_deps: boolean;
}
```

`Vec<&'static str>` arrives as `string[]` — the lifetime does not survive the wire. `ProjectTreeProps` gains `techInfo?: Map<string, ProjectTech>`, `RowMetaProps` and `ProjectRowProps` gain `tech?: ProjectTech`, and there is a `TechBadgesProps { tech?: ProjectTech }`.

### Independent, not chained

`src/hooks/useProjects.ts` gains one piece of state — `const [tech, setTech] = useState<Map<string, ProjectTech>>(new Map());` — and chapter 10's `loadGit` becomes `loadDetails`:

```ts
	// Git and stack detection both spawn processes, so neither gates the list.
	// These fire after the payload is already on screen and merge in as they
	// arrive — independently, so a slow git pass does not hold up the badges.
	const loadDetails = (list: Project[]) => {
		if (list.length === 0) return;
		invoke<GitInfo[]>('get_git_info', { projects: list })
			.then(infos => {
				setGit(new Map(infos.map(i => [i.full_path, i])));
			})
			.catch(() => {});
		invoke<ProjectTech[]>('get_project_tech', { projects: list })
			.then(infos => {
				setTech(new Map(infos.map(i => [i.full_path, i])));
			})
			.catch(() => {});
	};
```

Two `invoke` calls, two `.then` handlers, no `Promise.all` and no `await` between them. The chained version makes the badges as slow as the slowest `git status` in the workspace; `Promise.all` is barely better. Fired independently, each pass renders the instant it returns — the detection pass usually wins, because two `ls` batches beat several `git status` invocations. `.catch(() => {})` on both, separately, so a failure in one cannot reject a promise the other is part of. **Two independent facts about the same rows should be two independent requests.** `tech` joins the returned object, `App.tsx` passes `techInfo: tech`, and `ProjectTree` threads it to each row through `rowProps` exactly as `gitInfo` has been since chapter 10.

### The colour table, and the tag with no colour

In `ProjectTree.tsx`, above `GitBadge`:

```tsx
/// Stack colours — the ecosystems' own, so a badge is recognised without being
/// read. Anything unlisted renders muted rather than being dropped: a new
/// marker should show up as a plain badge, not vanish.
const TAG_TONE: Record<string, string> = {
	turbo: 'text-fuchsia-300 border-fuchsia-400/30',
	next: 'text-slate-200 border-slate-400/30',
	rust: 'text-orange-300 border-orange-400/30',
	go: 'text-cyan-300 border-cyan-400/30',
	python: 'text-yellow-300 border-yellow-400/30',
	docker: 'text-blue-300 border-blue-400/30',
	node: 'text-green-300 border-green-400/30'
};
```

Someone will add a marker to `MARKERS` — `Gemfile`, `pom.xml` — and forget this table exists. Render-nothing is worse in a specific and nasty way: the feature *works* — `classify` returns the tag, React receives it — and the UI shows nothing, so the bug looks like a detection failure and you go debug `detect.rs`, which is correct. The muted fallback makes the same mistake self-describing. **A lookup table used for presentation should degrade to plain, never to absent.**

### `TechBadges`, and the marker that is judgement

```tsx
/// Stack badges, plus a marker when dependencies are not installed.
///
/// The missing-deps dot is the one piece of judgement here: a Node or Rust
/// project with no node_modules or target is one you cannot actually run yet,
/// and that is worth knowing before you open it. Docker-only projects are
/// exempt — their dependencies live in an image, and a warning that can never
/// be cleared is one you learn to ignore.
const TechBadges = ({ tech }: TechBadgesProps) => {
	if (!tech || tech.tags.length === 0) return null;
	const runnable = tech.tags.some(t => t !== 'docker');
	return (
		<span className='flex items-center gap-1 shrink-0'>
			{tech.tags.map(t => (
				<span
					key={t}
					className={`text-[9px] uppercase tracking-wider border rounded px-1 ${
						TAG_TONE[t] ?? 'text-text-muted border-border'
					}`}
				>
					{t}
				</span>
			))}
			{tech.package_manager && (
				<span className='text-[9px] uppercase tracking-wider text-text-muted'>
					{tech.package_manager}
				</span>
			)}
			{runnable && !tech.has_deps && (
				<span
					className='text-text-muted leading-none'
					title='Dependencies do not appear to be installed'
				>
					○
				</span>
			)}
		</span>
	);
};
```

The first line is chapter 10's `GitBadge` philosophy repeated: no tech, or no tags, renders nothing. A project DevGo cannot classify, and a WSL project whose distro is asleep, look identical to a plain folder, because that is what they are as far as the launcher knows. The package manager is bare muted text rather than a bordered chip — a small piece of visual grammar: bordered chips are *what the project is*, unbordered text is *a detail about it*.

`has_deps` came free from §14.1 — `node_modules`, `target`, `.venv` are directory *names*, so they were in the listing you already paid for. The judgement is what to do with it. A Node project without `node_modules` is one where `Ctrl+Enter` opens your editor into a wall of unresolved imports; a `○` on the row tells you before. The tooltip hedges — *do **not appear** to be* — because a name-based check can be wrong (a pnpm store, an out-of-tree `CARGO_TARGET_DIR`).

The Docker exemption is the part that took thought. A Docker-only project has no `node_modules` and never will. Marking it would be *permanently* wrong, and a warning you can never clear is a warning you learn to ignore — and then you are ignoring it on the Node projects too. `tags.some(t => t !== 'docker')` exempts `["docker"]` but not `["rust", "docker"]`, which has a `target` directory to be missing. **A warning that a correct project can never satisfy is worse than no warning.**

`RowMeta` renders `<TechBadges {...{ tech }} />` *before* `GitBadge`, so the reading order right-to-left is star, hint, branch, then stack — the volatile fact nearest the eye, the stable one further out.

### The column that was too narrow

A 52-pixel meta column overdraws: the badges spill left across the "File System" cell and draw on top of the word *Windows*. The fix ships with the feature that needs it, in the `col` string every row and header share:

```tsx
// The last column carries a workspace's count or a row's meta — badges, branch,
// hint, star — so it is sized for the meta and the count right-aligns in it.
const col =
	'grid grid-cols-[1fr_1fr_80px_minmax(150px,0.9fr)] items-center gap-x-3 text-sm';
```

`minmax(150px, 0.9fr)` gives the meta a floor and lets it grow with the window; `gap-x-3` stops the branch name from touching the file-system label. The workspace header's count still right-aligns in the same column. A feature that draws over another feature's text is not done, and the screenshot is the test.

> **Commit checkpoint** — the UI is its own commit. The Rust half is provable by `cargo test`; this half is provable only by looking at it.
>
> ```powershell
> git add -A
> git commit -m "✅UI: stack badges, package manager and the missing-dependency dot on every row — meta column widened to hold them"
> git commit --allow-empty -m "✅STAGE: 14 intelligence"
> git checkout main && git merge 14.intelligence && git push origin 14.intelligence main
> ```

---

## 14.8 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun tauri dev
```

`cargo test` reports **43**. Watch for the determinism test by name — it is the one guarding a property rather than a value:

```
test services::detect::tests::tag_order_is_deterministic ... ok
```

Then the checks only a running app can answer. Everything below was run against this chapter's build.

**Badges appear, and they appear early.** Launch DevGo and watch the list: names paint first, badges land a beat later, before or independently of the branch names. If badges and branches always arrive together, something has chained them.

**The listing, verified, with WSL stopped.** On a Windows workspace, for example:

```
api:    [node] bun
devgo:  [node] bun
docs:   []
shop:   [node] bun ○
blog:   [node] pnpm ○
```

Three package managers right, two projects correctly flagged as having nothing installed, and `wsl -l -q --running` empty before and after — no distro booted to draw any of it.

**Now the interesting line.** `devgo` is a Tauri app — the Rust you have been typing for fourteen chapters is in it — and it reads as `node`, not `rust`. That is not a miss. `Cargo.toml` lives in `src-tauri/`, one level below the root, and detection is deliberately **one level deep**: it classifies from the top directory's listing and nothing else. Descending would be a second listing per project, which over 9p is the exact cost §14.1 exists to avoid. **It sees what a project announces at its front door**, and a Tauri app's front door says `package.json`. Nested layouts — a Go service under `backend/`, a crate in a polyglot monorepo — are a *scan-depth* question for a later slice, not a detection hack.

**Badges do not overlap anything.** Look at a row with a badge, a package manager, a branch and a hint: `NODE BUN 14.intelligence RECENT ★`, all inside the last column, with *Windows* untouched beside it (§14.7).

**The stopped distro.** With WSL stopped, a WSL project shows a name and nothing else — no badges, no branch — and Task Manager shows no `Vmmem`. Then `wsl -d Ubuntu-26.04 echo ok`, F5, and the badges fill in for that distro's projects from one `wsl.exe` spawn. For example:

```
web:     [turbo] pnpm
cloud:   [turbo, docker] pnpm
portal:  [turbo, docker] pnpm ○
```

`turbo` without `node` (§14.1's retain), `docker` beside it (a polyglot repo reports every stack), and the `○` on the one whose `node_modules` is not there — the Docker tag did not exempt it, because there is a Turborepo to be uninstalled.

**Determinism, by hand.** Restart a few times and watch a two-tag row: same order every time. Then move the `Cargo.toml` row above `turbo.json` in `MARKERS`, rebuild, and watch every project's order change at once — that table *is* the render order.

**The unlisted tag.** Add `("Gemfile", "ruby")` to `MARKERS`, rebuild, look at a Ruby project: a muted grey badge with a plain border. It did not vanish. Revert.

---

## What you built

```
src-tauri/src/
├── services/
│   ├── detect.rs           ← NEW: ProjectTech, MARKERS / LOCKFILES / DEP_DIRS,
│   │                          classify(), list_windows, list_wsl_batch, collect(), 7 tests
│   └── mod.rs              ← pub mod detect
├── commands.rs             ← AppState.tech_cache, running_for (shared with git),
│                              get_project_tech
└── lib.rs                  ← tech_cache in state, one command
src/
├── types.d.ts              ← ProjectTech, TechBadgesProps, tech / techInfo props
├── hooks/useProjects.ts    ← tech state, get_project_tech fired beside git (loadDetails)
├── components/ProjectTree.tsx ← TAG_TONE, TechBadges, tech threaded to rows, wider meta column
└── App.tsx                 ← techInfo: tech
```

> **The thread running through Slice 5.** Every decision here comes from one number in the plan: **eleven probes per project.** Refusing to pay it produced the single-listing design; the single-listing design forced the WSL batch, which is chapter 10's technique paying off a second time in a feature that shares nothing else with git; the batch's cost model then drew the line between what a row can afford (a listing) and what it cannot (a file read per project) — which is why the script reader is not in this chapter at all. The two UI decisions — a fixed tag order and a muted fallback — are about the same thing from the other end: a launcher is navigated by memory, and output that is correct but unstable, or a feature that fails by rendering nothing, both cost more than they save. **Cost is a design input, not a thing you profile afterwards.**

> **What this chapter deliberately did not build.** The dev-script reader and runner — `scripts.rs`, `get_project_scripts`, `run_script`, and the run templates on `LaunchTarget` that keep a failing script's error on screen — wait for the chapter that gives them a menu; a command with no caller is a chapter with nothing to verify. No automatic runtime suggestion: a convention belongs in a menu, not in a decision. No broken-environment detection and no version-mismatch warning — both need to *run* something per project, which is the eleven-probes cost with process spawns instead of `stat` calls. And a `.nvmrc` is **detected**, never **read**.

---

→ Next: [15 — Quick Actions & Paths](./15-quick-actions.md) (Slice 6), where DevGo learns to do things *to* a project without opening it.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [13 — The Editor & Terminal Registry](./13-targets.md)
