# 24 — Finding What Is Actually Installed (post-plan)

**Branch:** `24.editor-detection` — `git checkout 24.editor-detection` gives you this chapter's finished app; `git diff 23.window 24.editor-detection` is exactly what this chapter adds.

**Starting from:** chapter 23 — DevGo opens maximized, remembers where you left it, and reads well at any size. It still knows about exactly two programs: VS Code and Windows Terminal, hardcoded since chapter 05 and seeded once at first run.

**Goal:** find the editors and terminals that are really on the machine — on Windows *and* inside running distros — offer them with provenance, add only what you pick, and refuse to pretend a launch worked when the program is not there.

> **Hold on to:**
> 1. **A feature that only touches the seed path ships as a no-op to everyone who has already run the app once.** `defaults()` is read only when `targets.json` does not exist. Detection has to arrive through a command that acts on the store the user already has.
> 2. **A shell loop exits with the status of its last iteration.** Gating on `status.success()` throws away correct output — and the second call site making that mistake is how you learn it was a missing helper all along. Chapter 17's WSL root discovery had been finding nothing since it shipped.
> 3. **The process you spawn is not always the program you meant.** `spawn_raw` runs `cmd /c <exe>`, and `cmd` always exists, so a missing editor "launched" fine. One `where.exe` before the spawn is the difference between an error and a console window that flashes.
> 4. **Detection proposes; a human decides.** Chapter 13's policy was right that a silently added entry which fails to launch is worse than nothing. It was only wrong that checking was impossible.
>
> Rust: a `const` table of structs with `&'static str` fields and `Option<&'static str>` templates; `HashMap::entry().or_insert_with` for first-wins; `Iterator::filter_map` turning a lookup into a list; `let ... else` on a `Command::output()`. TypeScript: three UI states from one nullable array (`null` / `[]` / rows) as a derived `hint`.

> Chapter 13 built the target registry and wrote down a policy, in a comment that has aged interestingly: *"VS Code and Windows Terminal only, because those are the two DevGo already hardcoded — seeding more would be guessing at what is installed, and an entry that fails to launch is worse than one the user added deliberately."* Every clause of that is true. The conclusion is wrong. **The answer to guessing is not fewer entries; it is checking.** This chapter reverses the policy on purpose, and the shape of the reversal matters: detection *proposes*, and a human *decides*.
>
> Then two bugs. One is a trap that would have made the whole chapter ship as a no-op. The other had been quietly breaking chapter 17 since it shipped, and turned up only because this chapter happened to write the same line of shell. And a third: the design says a Linux-only editor refuses Windows projects, and nothing in the model enforced it.

---

## 24.1 — One helper, because two call sites made the same mistake

Start where the bug is, not where the feature is. Chapter 17's `discover` asks a running distro which of five folders exist:

```bash
for d in "$HOME/projects" "$HOME/dev" "$HOME/code" "$HOME/src" "$HOME/work"; do [ -d "$d" ] && echo "$d"; done
```

and reads the answer through `Ok(out) if out.status.success()`. Run that loop by hand on this machine:

```
/home/user/projects
EXIT=1
```

**A shell loop exits with the status of its last iteration.** `$HOME/work` does not exist, so the last `[ -d ]` fails, `&&` short-circuits, and the loop exits 1 — *after* printing the one root that does exist. Gating on success discarded it. WSL root discovery on an empty first run has been silently finding zero roots since chapter 17, and nobody noticed, because "no WSL roots found" looks exactly like "you have no WSL roots".

This chapter is about to write the same shape of loop for editors. Two call sites making the same mistake is a missing abstraction, not two mistakes — the conclusion chapter 23 reached about five palettes. So the helper comes first. In `src-tauri/src/services/platform/wsl.rs`, above `is_running`:

```rust
/// Run a "print what exists" script in a distro and return its lines.
///
/// The exit status is ignored on purpose. These scripts are all
/// `for x in ...; do test && echo; done`, and a shell loop exits with the
/// status of its last iteration: a missing last candidate makes the whole
/// probe "fail" after printing perfectly good output. A spawn failure is an
/// empty vec too, which is the honest answer for optional discovery.
pub fn probe_lines(distro: &str, script: &str) -> Vec<String> {
    let Ok(out) = wsl_command()
        .args(["-d", distro, "-e", "bash", "-lc", script])
        .output()
    else {
        return Vec::new();
    };
    parse_list(&decode(&out.stdout))
}
```

It rides the module's existing `wsl_command` (`WSL_UTF8`, no console window), `decode` (the UTF-16 sniff from chapter 04) and `parse_list` (NUL-safe trim) — `discover` had its own `Command::new("wsl")` and `from_utf8_lossy`, which is three things it did not need to know.

> `✅WSL: probe_lines ignores the exit status`

Then `discover.rs` loses its `Command` import, its `CREATE_NO_WINDOW`, and the whole `match output`:

```rust
    // this gated on status.success() and so found nothing whenever the last
    // candidate ($HOME/work) was missing: the loop had printed the roots that
    // exist, then exited 1
    wsl::probe_lines(distro, &script)
```

> `✅FIX: wsl root discovery kept nothing`

## 24.2 — One spawn, not fifteen

`src-tauri/src/services/editors.rs`, and `pub mod editors;` in `services/mod.rs`. The candidate table (§24.3) has fifteen Windows programs. The naive probe is fifteen `where.exe` processes; `where.exe` takes several names at once:

```rust
/// Resolve names against PATH in one spawn. `where` exits non-zero when any
/// name is missing, which is the normal case here, so the status is ignored
/// and stdout parsed: each line is a full path, mapped back to the name that
/// asked for it by file stem.
fn where_lookup(names: &[&str]) -> HashMap<String, String> {
    let mut found = HashMap::new();
    if names.is_empty() {
        return found;
    }
    let Ok(out) = Command::new("where.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(names)
        .output()
    else {
        return found;
    };
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let path = line.trim();
        if path.is_empty() {
            continue;
        }
        // where prints several hits per name (code, code.cmd); the first wins
        if let Some(stem) = std::path::Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
        {
            found.entry(stem).or_insert_with(|| path.to_string());
        }
    }
    found
}
```

Two details make it work. **Ignore the exit status** — the same lesson as §24.1 from a different program: `where` exits 1 when *any* name is missing, and finding the subset that exists is the entire point. **Map results back by filename stem** — `where` does not label its output; `C:\Program Files\Microsoft VS Code\bin\code` → stem `code` → the candidate that asked for it. Unambiguous because the names in the table are distinct; first-wins because `where` prints `code` and `code.cmd` for the same install.

The same lookup answers a question chapter 05 never asked:

```rust
/// Is this executable resolvable? A full path the user typed is checked
/// directly: `where` only searches PATH and would call it missing.
pub fn is_on_path(exe: &str) -> bool {
    let direct = std::path::Path::new(exe);
    if direct.is_absolute() {
        return direct.is_file();
    }
    !where_lookup(&[exe]).is_empty()
}
```

with one test that exercises the real program rather than a stub — `cmd` resolves, `devgo-definitely-not-a-real-program` does not.

> `✅TARGET: where lookup in one spawn`

## 24.3 — The model was not saying what the design claimed

Before the table, a detour. The stated design for a Linux-only editor is that `args_template` is empty on purpose and `launch_target` refuses a Windows project for it. Read `resolve_inner` in `models/target.rs`: for a Windows project it returns `&self.args_template` unconditionally. An empty template resolves to `("wsl", "")`, `spawn_raw` runs `cmd /c wsl` with no arguments, and a hidden shell sits in the background forever. Nothing refused anything.

The model says it now:

```rust
            // empty means no windows form at all: a linux-only editor
            (false, None) => {
                Some(&self.args_template).filter(|t| !t.is_empty())?
            }
```

a mirror of chapter 13's `windows_only_targets_refuse_wsl_projects` test — `wsl_only_targets_refuse_windows_projects`, a Neovim with `args_template: String::new()` that resolves for a WSL project and not for `G:\dev` — and an error that names the situation, because `TargetCannotOpenWsl` would be a lie in this direction:

```rust
    #[error("{0} runs inside WSL, so it cannot open the Windows project {1}")]
    TargetWslOnly(String, String),
```

`launch_target` picks by side:

```rust
    let (exe, args) = resolved.ok_or_else(|| {
        let (t, p) = (target.name.clone(), project.name.clone());
        if is_wsl(project) {
            AppError::TargetCannotOpenWsl(t, p)
        } else {
            AppError::TargetWslOnly(t, p)
        }
    })?;
```

> `✅TARGET: an empty windows template is a refusal`

### The tables

One `Option` distinguishes a VS Code fork from a Windows-only editor: how it opens a WSL project, or `None` — which is already what `LaunchTarget.wsl_args_template` means. A two-variant enum would say the same thing a second time.

```rust
struct WinCandidate {
    id: &'static str,
    name: &'static str,
    kind: TargetKind,
    /// the command as it appears on PATH
    exe: &'static str,
    args: &'static str,
    /// how it opens a WSL project; None means it cannot, and launch_target
    /// says so rather than opening the wrong directory
    wsl_args: Option<&'static str>,
    run_args: Option<&'static str>,
    wsl_run_args: Option<&'static str>,
}

// the VS Code family does the crossing itself
const REMOTE_URI: &str =
    "--folder-uri vscode-remote://wsl+{distro}{linux_path}";
```

`WINDOWS` is fifteen rows: `vscode`, `vscode-insiders`, `cursor`, `windsurf` (all `Some(REMOTE_URI)`); `zed`, `sublime`, `idea`, `webstorm`, `pycharm`, `rustrover`, `goland`, `fleet` (all `None`); and three terminals. The terminals carry a WSL form too. Chapter 13 decided that the tmux session is a DevGo behaviour reaching every terminal through `{script}`, and the seed says so — so the candidates say the same:

```rust
    // terminals open WSL projects through the tmux script, like the seed
    WinCandidate {
        id: "wt",
        name: "Windows Terminal",
        kind: TargetKind::Terminal,
        exe: "wt",
        args: "-d \"{path}\"",
        wsl_args: Some("wsl -d {distro} bash \"{script}\""),
        run_args: Some("-d \"{path}\" cmd /k {command}"),
        wsl_run_args: Some(
            "wsl -d {distro} --cd \"{linux_path}\" -e bash -lc \"{command}; exec bash\"",
        ),
    },
```

Alacritty is `--working-directory "{path}"` / `-e wsl -d {distro} bash "{script}"`; WezTerm is `start --cwd "{path}"` / `start -- wsl -d {distro} bash "{script}"`, with run forms of the same shape. Inside a distro, five command-line editors and no GUI terminal emulators — running one inside WSL needs an X server, and a target that opens nothing is worse than no target:

```rust
const IN_DISTRO: &[(&str, &str)] = &[
    ("nvim", "Neovim"),
    ("hx", "Helix"),
    ("vim", "Vim"),
    ("emacs", "Emacs"),
    ("micro", "Micro"),
];
```

`to_target` copies a `WinCandidate` into a `LaunchTarget` field for field (`wsl_executable: None` — a Windows program does its own crossing or none). A distro editor is a different shape:

```rust
/// The same editor in two distros is two targets opening two filesystems,
/// so the distro is in the name and, slugified, in the id.
fn distro_target(exe: &str, name: &str, distro: &str) -> LaunchTarget {
    LaunchTarget {
        id: format!("{exe}-{}", slugify(distro)),
        name: format!("{name} ({distro})"),
        kind: TargetKind::Editor,
        // a linux binary cannot take a windows path, so there is no windows
        // form; launch_target refuses windows projects for it
        executable: "wsl".to_string(),
        args_template: String::new(),
        wsl_executable: Some("wsl".to_string()),
        wsl_args_template: Some(format!(
            "-d {{distro}} --cd \"{{linux_path}}\" -e {exe} ."
        )),
        run_args_template: None,
        wsl_run_args_template: None,
    }
}
```

`Neovim (Ubuntu-26.04)`, id `nvim-ubuntu-26-04`. The distro is in the **name** because the same editor in two distros opens two different filesystems and a list with "Neovim" twice would be a puzzle; in the **id** because two targets cannot share one. `slugify` lowercases and replaces everything non-alphanumeric with `-`.

Four tests. `every_candidate_id_is_unique`. `wsl_form_decides_whether_a_target_can_open_wsl` (Cursor resolves for a WSL project; Sublime does not, and still opens Windows ones). `a_distro_editor_gets_a_distinct_id_per_distro` — Ubuntu and Debian get different ids, the Windows form is `None` (§24.3's refusal, exercised), and the WSL form resolves to `-d Ubuntu-26.04 --cd "/srv/app" -e nvim .`. And the one that matters most:

```rust
    /// A detected VS Code or Windows Terminal is the seeded one: same id, so
    /// it is never offered as new, and the same templates, so a fresh install
    /// and a detected add behave alike.
    #[test]
    fn detected_seeds_match_the_seeded_defaults() {
        for seed in crate::models::target::defaults() {
            let c = WINDOWS
                .iter()
                .find(|c| c.id == seed.id)
                .unwrap_or_else(|| panic!("{} has no candidate", seed.id));
            let t = to_target(c);
            assert_eq!(t.executable, seed.executable);
            assert_eq!(t.args_template, seed.args_template);
            assert_eq!(t.wsl_args_template, seed.wsl_args_template);
            assert_eq!(t.run_args_template, seed.run_args_template);
            assert_eq!(t.wsl_run_args_template, seed.wsl_run_args_template);
        }
    }
```

Pinning the templates, not only the ids, is what keeps the `wt` candidate's `{script}` form honest: if the seed and the candidate ever disagree, the test says which field.

> `✅TARGET: candidate tables`

### Detection

```rust
/// A target found installed but not yet registered, with where it came
/// from so the UI can say why it is offered.
#[derive(Debug, Clone, Serialize)]
pub struct DetectedTarget {
    pub target: LaunchTarget,
    /// "path" for a Windows program, or the distro name
    pub source: String,
    /// the resolved exe path, or "Ubuntu-26.04 · nvim"
    pub detail: String,
}

/// Everything installed, as targets ready to be added. `running` is passed
/// in so a caller that already paid for `wsl -l --running` does not pay
/// twice; only those distros are asked.
pub fn detect(running: &[String]) -> Vec<DetectedTarget> {
    let names: Vec<&str> = WINDOWS.iter().map(|c| c.exe).collect();
    let found = where_lookup(&names);

    let mut out: Vec<DetectedTarget> = WINDOWS
        .iter()
        .filter_map(|c| {
            found.get(&c.exe.to_lowercase()).map(|path| DetectedTarget {
                target: to_target(c),
                source: "path".to_string(),
                detail: path.clone(),
            })
        })
        .collect();

    for distro in running {
        for (exe, name) in in_distro(distro) {
            out.push(DetectedTarget {
                target: distro_target(exe, name, distro),
                source: distro.clone(),
                detail: format!("{distro} · {exe}"),
            });
        }
    }
    out
}

/// Which of the in-distro editors exist, in one bash -lc per distro.
fn in_distro(distro: &str) -> Vec<(&'static str, &'static str)> {
    let list = IN_DISTRO
        .iter()
        .map(|(exe, _)| *exe)
        .collect::<Vec<_>>()
        .join(" ");
    let script = format!(
        "for c in {list}; do command -v \"$c\" >/dev/null 2>&1 && echo \"$c\"; done"
    );
    let present = wsl::probe_lines(distro, &script);
    IN_DISTRO
        .iter()
        .filter(|(exe, _)| present.iter().any(|p| p == exe))
        .copied()
        .collect()
}
```

Only **running** distros are asked — `detect` iterates the list it is handed and never calls `wsl` to make one. A stopped distro contributes nothing and is not an error. And `in_distro` is the loop from §24.1 again — `micro` is rarely installed, so the loop exits 1 after printing `nvim` and `vim`; through `probe_lines` that is a correct answer, and through the old gate it was nothing. There is no second `is_running` check inside `in_distro`: the caller already only passes running distros, so nothing pays for `wsl -l --running` twice.

> `✅TARGET: detect installed editors`

## 24.4 — A launch that fails should say so

Chapter 13's `spawn_raw` (05's `spawn_cmd` before it) has always run the target through `cmd`, and `raw_arg` is load-bearing (`Command::args` re-quotes anything with spaces and breaks `--folder-uri vscode-remote://…`; the test at the bottom of `launcher.rs` exists solely to pin that). But it means the process actually spawned is **cmd.exe**, which always exists. So `spawn()` succeeded whether or not the editor did: a missing `code` produced a console window that flashed and vanished, an `Ok`, and a recorded frecency launch for a project that never opened. Now that detection can resolve PATH, the check is one `if`:

```rust
fn spawn_raw(exe: &str, args: &str) -> Result<(), AppError> {
    // the process spawned below is cmd.exe, which always exists, so a
    // missing editor "launched" fine: a console flashed, Ok came back, and a
    // frecency launch was recorded. wsl is exempt: the program it runs lives
    // inside the distro, where a windows PATH lookup means nothing
    if exe != "wsl" && !super::editors::is_on_path(exe) {
        return Err(AppError::TargetNotInstalled(exe.to_string()));
    }
```

```rust
    #[error("{0} is not installed, or not on PATH. Detect editors in Settings, or fix the executable")]
    TargetNotInstalled(String),
```

The test builds a `Ghost Editor` whose executable is `devgo-no-such-editor` and asserts `TargetNotInstalled` names it — the assertion that used to be impossible to write, because the launch returned `Ok`.

> `✅LAUNCH: refuse a missing executable`

## 24.5 — The trap: a feature that ships as a no-op

The obvious way to add editors is to put them in `defaults()`. Read `TargetStore::new` first: `defaults()` is consulted **only when `targets.json` does not exist.** No merge, no schema version, no migration. Once that file exists, the seed is never read again. So on every machine that has ever launched DevGo — which is every machine that would want this feature — adding candidates to `defaults()` does nothing at all. You would ship it, run it, see no change, and start debugging detection code that works perfectly.

**Detection has to arrive through a command that acts on the store the user already has.** In `commands.rs`, above `get_targets`:

```rust
/// Editors and terminals installed but not yet registered. This is the
/// command that makes detection mean anything on a machine that has run
/// DevGo before: `defaults()` is written only when targets.json does not
/// exist, so candidates added there would ship as a no-op. It proposes; it
/// never writes.
#[tauri::command]
pub fn detect_targets(
    state: State<AppState>,
) -> Result<Vec<DetectedTarget>, AppError> {
    // only distros already running are asked; detection never boots a vm
    let running = wsl::running_distros();
    let existing: Vec<String> = state
        .target_store
        .lock()
        .map_err(lock_err)?
        .list()
        .into_iter()
        .map(|t| t.id)
        .collect();

    Ok(editors::detect(&running)
        .into_iter()
        .filter(|d| !existing.contains(&d.target.id))
        .collect())
}
```

Filtering by id is why the table reuses the exact ids `defaults()` seeds — and why `detected_seeds_match_the_seeded_defaults` exists.

> `✅CMD: detect_targets`

The button sends an **id**, not the target:

```rust
/// Register one detected target by id. Not by posting the target back: the
/// TS LaunchTarget has no run templates, so a detected terminal would come
/// back with them stripped and fail its first run_script. Re-deriving costs
/// one where.exe spawn and cannot lose a field.
#[tauri::command]
pub fn add_detected_target(
    id: String,
    state: State<AppState>,
) -> Result<LaunchTarget, AppError> {
    let running = wsl::running_distros();
    let found = editors::detect(&running)
        .into_iter()
        .find(|d| d.target.id == id)
        .ok_or_else(|| AppError::TargetNotFound(id))?;

    state
        .target_store
        .lock()
        .map_err(lock_err)?
        .add(found.target)
}
```

The TypeScript `LaunchTarget` (chapter 13) is missing `run_args_template` and `wsl_run_args_template` — chapter 20 added them on the Rust side with `#[serde(default)]` and the form never needed them. A detected terminal handed to the frontend and posted back through `add_target` would arrive with its run templates silently stripped, then fail with `TargetCannotRun` the first time someone ran a dev script on it. **When a type is known to be lossy, do not route data through it.** One consequence to know about: a distro editor can only be re-derived while its distro is running. Add it in the same sitting as the scan, or the toast says *No such editor or terminal: nvim-ubuntu-26-04* and the row stays (§24.7).

> `✅CMD: add_detected_target` · `✅CMD: register detection commands` (both in `generate_handler!`, before `get_targets`)

## 24.6 — Proposing is not adding

`types.d.ts`, beside `LaunchTarget`:

```ts
/// A target DevGo found installed but has not registered. It is added back
/// by id, never by posting this object to add_target: LaunchTarget above has
/// no run templates, so a round trip would strip them from a terminal.
interface DetectedTarget {
	target: LaunchTarget;
	/// "path" for a Windows program, or the distro name
	source: string;
	/// a resolved exe path, or "Ubuntu-26.04 · nvim"
	detail: string;
}
```

`useTargets` gains two members, in the shape every other write there already has (no `useCallback` — the React Compiler):

```ts
	// proposes only: nothing is written until addDetected is called for an id
	const detect = () => invoke<DetectedTarget[]>('detect_targets');

	const addDetected = async (id: string) => {
		await invoke<LaunchTarget>('add_detected_target', { id });
		await reload();
	};
```

> `✅HOOK: detect and addDetected`

`TargetManagerProps` gains `onDetect: () => Promise<DetectedTarget[]>` and `onAddDetected: (id: string) => Promise<void>`; Settings passes `targets.detect` and `targets.addDetected`. In `TargetManager`, the panel scans on a button, lists what it found with where it found it, and adds one at a time. Three decisions inside that sentence:

**Scanning is a thing you ask for.** It shells out to `where.exe` and `wsl.exe`; running it at startup would put two process spawns on the launch path of an app whose entire discipline is not doing that.

**Every row says where it came from** — a resolved path for a Windows program, `in Ubuntu-26.04` for a distro one. An entry appearing with no provenance is precisely the "guessing" the original policy refused.

**Nothing is written until a specific Add is clicked.**

```tsx
	// null is never scanned; [] is scanned and everything is already
	// registered. They say different things and must read differently.
	const [found, setFound] = useState<DetectedTarget[] | null>(null);
	const [scanning, setScanning] = useState(false);
```

```tsx
	// a probe is a thing you ask for: it shells out to where.exe and wsl.exe,
	// which has no place on the launch path
	const scan = () => {
		setScanning(true);
		onDetect()
			.then(setFound)
			.catch(e => onError(String(e)))
			.finally(() => setScanning(false));
	};

	const scanLabel = scanning ? 'Scanning…' : found ? 'Scan again' : 'Scan';
	const scanHint =
		found === null
			? 'Looks for installed editors and terminals on PATH, and for command-line editors inside distros that are already running. It never starts a distro.'
			: found.length === 0
				? 'Nothing new: everything found is already registered.'
				: null;
```

The three states are not nested ternaries in JSX: the text is derived first and the markup is `{scanHint ? <p>…</p> : <ul>…</ul>}`. The section sits between the two lists and the add form: a heading with a `ghost` Scan button, then either the hint or a `<ul>` of rows — name, provenance (`d.source === 'path' ? d.detail : \`in ${d.source}\``), the `badge` const for the kind, and a `ghost` Add. Every button is a `Button`.

The list rows learn one more badge, reading §24.3 straight off the model, as the *windows only* badge has since chapter 13:

```ts
				{
					show: !t.args_template,
					label: 'wsl only',
					className: 'text-text-muted border-border-strong',
					title: 'Runs inside a distro — this target cannot open Windows projects'
				}
```

> `✅UI: detected targets panel`

## 24.7 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **72** — chapter 23's 65 plus one for the model, five for `editors`, one for the launcher. Then, with the four config files backed up:

**Scan.** `bun tauri dev`, Settings → Editors & Terminals, *Scan*. What appears is what `where.exe code cursor zed subl … wt alacritty wezterm` finds minus what `targets.json` already has — on this machine *VS Code Insiders* and *Zed*, each with its resolved path under the name. (If your `targets.json` came from a build with target kinds this tree does not know, chapter 22's guard has just moved it to `.bak` and reseeded; that is the guard working.) *Add* on Zed: it moves to the Editors list wearing *windows only*, `targets.json` has `"id": "zed"` with `wsl_args_template: null`, and the detected list no longer offers it.

**A missing editor.** From devtools, `add_target` a `Ghost` whose executable is `devgo-ghost`, then `open_editor` a Windows project with `targetId: 'ghost'`: *devgo-ghost is not installed, or not on PATH. Detect editors in Settings, or fix the executable* — and no console window, no frecency bump. `remove_target` it.

**The loop.** In a terminal:

```powershell
wsl -d Ubuntu-26.04 -e bash -lc 'for c in nvim hx vim emacs micro; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done; echo EXIT=$?'
```

prints `nvim`, `vim`, `EXIT=1`. That is the bug, reproduced by hand. The distro is now running, so `discover_roots` from devtools lists `\\wsl.localhost\Ubuntu-26.04\home\user\projects` alongside the Windows roots — a line chapter 17 has never actually produced — and *Scan again* adds *Neovim (Ubuntu-26.04)* and *Vim (Ubuntu-26.04)*, each *in Ubuntu-26.04*. *Add* Neovim while the distro is still up: it lands in Editors wearing *wsl only*, and `targets.json` has `nvim-ubuntu-26-04` with `"executable": "wsl"` and `"args_template": ""`. `open_editor` a Windows project with that id: *Neovim (Ubuntu-26.04) runs inside WSL, so it cannot open the Windows project devgo*.

**A failed add keeps its row.** `wsl --shutdown`, then *Add* on Vim: the toast says *No such editor or terminal: vim-ubuntu-26-04* and Vim is still in the list. (The first cut of the panel dropped the row through `guard(...).then(...)` — `guard` swallows the rejection, so `.then` ran on failure. Found here, fixed as its own commit.)

Restore the four files when done; the distro is stopped again.

> `✅FIX: a failed add keeps the detected row` · `✅STAGE: 24 editor-detection`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/platform/wsl.rs   probe_lines (exit status ignored on purpose)
  src/services/discover.rs       uses it; the ch. 17 fix
  src/services/editors.rs        where_lookup, is_on_path, WINDOWS + IN_DISTRO, detect; 5 tests
  src/models/target.rs           an empty Windows template is a refusal; 1 test
  src/services/launcher.rs       PATH check before cmd /c; TargetWslOnly by side; 1 test
  src/error.rs                   TargetNotInstalled, TargetWslOnly
  src/commands.rs                detect_targets, add_detected_target (by id)
src/
  types.d.ts                     DetectedTarget; two props
  hooks/useTargets.ts            detect, addDetected
  components/TargetManager.tsx   Detected on this machine; wsl only badge
  components/Settings.tsx        two lines of wiring
```

DevGo now finds VS Code and its forks, the JetBrains launchers, Zed, Sublime, three terminals, and the command-line editors inside every running distro — offers them with provenance, adds only what you pick, and refuses to pretend a launch worked when the program is not there.

> **The thread running through this chapter.** Every gate was green while `discover` was silently discarding half its answer, while a missing editor "launched" successfully, and while the model let a Linux binary be handed a Windows path. **The code that looks like it works is not the code you have run.** One helper for the loop, one `where.exe` before the spawn, one `filter` on an empty template — and a panel that proposes instead of deciding.
