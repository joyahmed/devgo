# 13 — The Editor & Terminal Registry (Slice 4)

**Branch:** `13.targets` — `git checkout 13.targets` gives you this chapter's finished app; `git diff 12.wsl-control 13.targets` is exactly what this chapter adds.

**Starting from:** Slice 3 — every keybinding declared once, a Settings shell with a panel registry, and a way to stop a wedged distro without opening a terminal. And, still, an app that can launch exactly two programs, both named in the source: `code` and `wt`.

**Goal:** one model that describes any editor or terminal, a store that persists them, a launcher that knows nothing about VS Code, and Settings' second panel — added by adding one object to an array.

> **Hold on to:**
> 1. **One model when no operation separates the two.** Editors and terminals are both "a program plus how to hand it a directory"; `kind` is a field, not a type, and it does four small jobs.
> 2. **Two `None`s can mean opposite things.** `wsl_executable: None` falls back; `wsl_args_template: None` refuses. The type cannot tell them apart — the doc comment and the read site do.
> 3. **Fallback or refusal — decide per value.** A deleted default falls through to the first of its kind; a target with no WSL form refuses a WSL project; the last editor cannot be removed. The difference is whether the user is owed an explanation.
> 4. **Draw the boundary of what your tests cover.** Nine tests on `resolve` were green while the command line was being mangled one layer out. The tenth spawns a real process.
> 5. **`raw_arg`, not `args`.** On Windows a command line is one string; `Command::args` re-quotes anything with a space, which is exactly wrong for a user's template.

> DevGo's whole pitch is "your projects, one keystroke away." It has been quietly finishing that sentence with "…as long as you use VS Code and Windows Terminal." Anyone on Cursor, Zed, Helix, PowerShell or Git Bash was out of luck, and the VS Code remote-URI construction was welded into `launcher.rs` beside the spawn call.
>
> Replacing a hardcoded name with a registry is a well-worn move, and most of this chapter is not about the registry. It is about the four decisions that make the registry *safe*, and about a bug: making the command line come from a template exposed a defect in the spawn helper that had been sitting there, harmless, since chapter 05 — harmless only because nothing DevGo spawned had ever contained a space in the wrong place. **No test on the substitution could have caught it: the substitution was never wrong.**

---

## 13.1 — One model for two things

Create `src-tauri/src/models/target.rs`, and add `pub mod target;` to `models/mod.rs`:

```rust
use serde::{Deserialize, Serialize};

/// An editor or terminal DevGo can launch a project into.
///
/// Both are the same shape — a program, plus how to hand it a directory — so
/// they share one model rather than two that drift. `kind` only decides which
/// list a target appears in and which button launches it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchTarget {
    /// Stable across renames, so `default_editor` in prefs does not break when
    /// the user relabels "VS Code" to "Code".
    pub id: String,
    pub name: String,
    pub kind: TargetKind,
    /// What to run for a Windows-filesystem project.
    pub executable: String,
    /// Arguments for a Windows-filesystem project. `{path}` is substituted.
    pub args_template: String,
    /// What to run for a WSL project. `None` means "same as `executable`",
    /// which is right for tools that understand WSL themselves (VS Code) and
    /// wrong for ones that need `wsl` in front (a Linux-only editor).
    pub wsl_executable: Option<String>,
    /// Arguments for a WSL project. `{distro}` and `{linux_path}` are also
    /// available here. `None` means the target cannot open WSL projects.
    pub wsl_args_template: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetKind {
    Editor,
    Terminal,
}
```

### One model for two things

The plan asked for two of these — a `CodeEditor` model with an `EditorStore`, and *"same pattern"* for terminals. Read the two descriptions and ask what is actually different. An editor is a program you hand a directory to. A terminal is a program you hand a directory to. Everything downstream — which list it appears in, which button launches it, which prefs key stores the default — is one bit of information, and one bit is a field, not a type.

`kind` is that field, and it is worth naming exactly how little it does: `TargetStore::first_of(kind)` filters the list; `resolve_target` picks which prefs key to read; `launch_target` writes a tmux script only for `Terminal`; the UI renders two sections instead of one. Four call sites. Against that: two of every file, forever, each with its own `add`, `remove`, `save`, `slug`, error variants and tests, kept in step by nothing but the author remembering they exist.

**Two models diverge at the first feature that only one of them gets.** The test for "should these be one type?" is not "do they mean different things to the user" — they obviously do. It is **"is there any operation one supports and the other cannot?"** Here there is not.

`TargetKind` is `Copy` because it is two variants passed by value everywhere, `PartialEq` because `first_of` and `launch_target` compare it, and `#[serde(rename_all = "snake_case")]` so the wire form is `"editor"` / `"terminal"` — lowercase, which is what `types.d.ts` declares on the other side. That is the same casing trap chapter 04 hit with `Runtime`.

---

## 13.2 — Templates, and the two placeholders that are not one

The whole of the launch logic is one method:

```rust
impl LaunchTarget {
    /// Resolve this target's command line for a project.
    ///
    /// Returns `None` when the target has no WSL form and the project is a WSL
    /// project — the caller reports that rather than launching something that
    /// would silently open the wrong directory.
    pub fn resolve(
        &self,
        windows_path: &str,
        wsl: Option<(&str, &str)>,
    ) -> Option<(String, String)> {
        match wsl {
            Some((distro, linux_path)) => {
                let template = self.wsl_args_template.as_ref()?;
                let exe = self
                    .wsl_executable
                    .clone()
                    .unwrap_or_else(|| self.executable.clone());
                let args = template
                    .replace("{distro}", distro)
                    .replace("{linux_path}", linux_path)
                    .replace("{path}", windows_path);
                Some((exe, args))
            }
            None => Some((
                self.executable.clone(),
                self.args_template.replace("{path}", windows_path),
            )),
        }
    }
}
```

`resolve` returns a `(executable, args)` pair and nothing else. It does not spawn, does not touch the filesystem, does not know what a project is — it takes strings and returns strings, which is why it is the one part of this slice that is cheap to test exhaustively.

`wsl: Option<(&str, &str)>` carries "is this a WSL project, and if so which distro and what is the Linux path" in a single value. A `bool` plus two `&str`s would let a caller pass `true` with an empty distro; the `Option<tuple>` makes the illegal combination unrepresentable — chapter 06's reasoning for `ScanOutcome`.

| Placeholder | Available in | Value |
|---|---|---|
| `{path}` | both templates | the Windows path, `G:\dev\app` or `\\wsl.localhost\Ubuntu\home\user\app` |
| `{distro}` | WSL template only | `Ubuntu` |
| `{linux_path}` | WSL template only | `/home/user/app` |
| `{script}` | WSL template only | *substituted later, in `launch_target`* — §13.5 |

### `None` on `wsl_executable` and `None` on `wsl_args_template` mean opposite things

The two `Option` fields sit next to each other and read as a matched pair. They are not.

`wsl_executable: None` means **"same as `executable`."** That is right for VS Code, which speaks WSL natively: you still run `code`, you just hand it a remote URI. It is wrong for a Linux-only editor, which needs `wsl` in front — and that target sets `wsl_executable: Some("wsl")` and puts the rest in its args.

`wsl_args_template: None` means **"this target cannot open WSL projects at all,"** implemented by the `?` on the first line of the WSL branch. `?` on an `Option` inside a function returning `Option` is an early return of `None`; §13.5 turns that into an error the user reads.

**A `None` that means "fall back" and a `None` that means "refuse" cannot be told apart by the type.** They are told apart by the code that reads them and by the doc comment on each field, which is why those two comments are the longest in the struct. If this pattern grew a third `Option` with a third meaning it would be time for real types; at two, with the meanings written at the field and enforced at the read, it stays honest.

---

## 13.3 — Two seeded targets, and the argument for not seeding more

```rust
/// The registry every install starts with.
///
/// VS Code and Windows Terminal only, because those are the two DevGo already
/// hardcoded — seeding more would be guessing at what is installed, and an
/// entry that fails to launch is worse than one the user added deliberately.
pub fn defaults() -> Vec<LaunchTarget> {
    vec![
        LaunchTarget {
            id: "vscode".into(),
            name: "VS Code".into(),
            kind: TargetKind::Editor,
            executable: "code".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: None,
            // VS Code speaks WSL natively through a remote URI, so it does not
            // need `wsl` in front of it.
            wsl_args_template: Some(
                "--folder-uri vscode-remote://wsl+{distro}{linux_path}".into(),
            ),
        },
        LaunchTarget {
            id: "wt".into(),
            name: "Windows Terminal".into(),
            kind: TargetKind::Terminal,
            executable: "wt".into(),
            args_template: "-d \"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: Some("wsl -d {distro} bash \"{script}\"".into()),
        },
    ]
}
```

Read those four templates against what chapter 05 spawned and they are the same command lines, moved — with one deliberate improvement: the terminal template names the distro (`wsl -d {distro}`), where chapter 05's `wt wsl bash <script>` trusted the default distro to be the project's. Nothing else about *what* DevGo launches changed; only *where the knowledge lives*. That is what makes the refactor safe to verify — §13.11's manual check is "does everything still open exactly as it did".

The temptation is to seed more. PowerShell, CMD, Git Bash, Cursor, Zed. Don't. A seeded entry is a promise that the program is there. `cursor` is not on a machine without Cursor, and the failure mode is not a nice error — `cmd /c cursor "G:\dev\app"` with no `cursor` on `PATH` exits non-zero *after* `spawn` succeeded, so DevGo reports success and nothing opens. **Seed what you were already assuming, and let the user add what you would have had to guess.**

The `id` values are hand-written here rather than derived from the names, because they are the ids `prefs.json` will store and they must never move. §13.4's `slug` is for targets the user adds.

### Four tests on `resolve`, and what each one pins

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn vscode() -> LaunchTarget {
        defaults().into_iter().next().unwrap()
    }

    #[test]
    fn windows_projects_substitute_path() {
        let (exe, args) = vscode().resolve(r"G:\dev\app", None).unwrap();
        assert_eq!(exe, "code");
        assert_eq!(args, r#""G:\dev\app""#);
    }

    #[test]
    fn wsl_projects_use_the_remote_uri() {
        let (exe, args) = vscode()
            .resolve(
                r"\\wsl.localhost\Ubuntu\home\joy\app",
                Some(("Ubuntu", "/home/joy/app")),
            )
            .unwrap();
        assert_eq!(exe, "code");
        assert_eq!(
            args,
            "--folder-uri vscode-remote://wsl+Ubuntu/home/joy/app"
        );
    }

    /// A Linux-only editor needs `wsl` in front, which is what wsl_executable
    /// is for.
    #[test]
    fn passthrough_targets_swap_the_executable() {
        let helix = LaunchTarget {
            id: "helix".into(),
            name: "Helix".into(),
            kind: TargetKind::Editor,
            executable: "hx".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: Some("wsl".into()),
            wsl_args_template: Some(
                "-d {distro} --cd \"{linux_path}\" -e hx .".into(),
            ),
        };
        let (exe, args) = helix
            .resolve("ignored", Some(("Debian", "/srv/app")))
            .unwrap();
        assert_eq!(exe, "wsl");
        assert_eq!(args, "-d Debian --cd \"/srv/app\" -e hx .");
    }

    /// Refusing is the point: launching a Windows-only editor at a WSL project
    /// would open some other directory, or nothing, with no error.
    #[test]
    fn windows_only_targets_refuse_wsl_projects() {
        let notepad = LaunchTarget {
            id: "notepad".into(),
            name: "Notepad".into(),
            kind: TargetKind::Editor,
            executable: "notepad".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
        };
        assert!(notepad.resolve("x", Some(("Ubuntu", "/home"))).is_none());
        assert!(notepad.resolve("x", None).is_some());
    }
}
```

The first two run against `defaults()` rather than a fixture, so they double as a check that the seeded VS Code entry produces the command line chapter 05 hardcoded. If someone edits the seed's template, these fail — which is what you want, because that seed is a compatibility promise to every existing install.

The last test asserts **both** halves: `is_none()` for the WSL project, and `is_some()` for the Windows one. Only asserting the refusal would pass for a target that refuses everything. **A test for "X is rejected" needs its twin "and Y is still accepted", or it cannot distinguish a working guard from a broken function.**

---

## 13.4 — The store, and two ways to refuse

Create `src-tauri/src/services/target_store.rs`; add `pub mod target_store;` and `pub use target_store::TargetStore;` to `services/mod.rs`.

```rust
use std::fs;
use std::path::PathBuf;

use crate::error::AppError;
use crate::models::target::{defaults, LaunchTarget, TargetKind};

/// Editors and terminals, persisted together.
///
/// Mirrors `WorkspaceStore`: `AppError` returns, `create_dir_all` in `new()`,
/// a private `save()`, and `unwrap_or_default()` on parse.
#[derive(Debug)]
pub struct TargetStore {
    targets: Vec<LaunchTarget>,
    file_path: PathBuf,
}

impl TargetStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;

        let file_path = app_data_dir.join("targets.json");
        let targets: Vec<LaunchTarget> = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            let seeded = defaults();
            fs::write(&file_path, serde_json::to_string_pretty(&seeded)?)?;
            seeded
        };

        // An empty file would leave the user with no way to launch anything and
        // no obvious way back, so re-seed rather than respect it.
        let targets = if targets.is_empty() {
            defaults()
        } else {
            targets
        };

        Ok(Self { targets, file_path })
    }

    pub fn list(&self) -> Vec<LaunchTarget> {
        self.targets.clone()
    }

    pub fn get(&self, id: &str) -> Option<LaunchTarget> {
        self.targets.iter().find(|t| t.id == id).cloned()
    }

    /// First target of a kind, used when no default is set or the saved default
    /// has since been removed.
    pub fn first_of(&self, kind: TargetKind) -> Option<LaunchTarget> {
        self.targets.iter().find(|t| t.kind == kind).cloned()
    }

    pub fn add(
        &mut self,
        mut target: LaunchTarget,
    ) -> Result<LaunchTarget, AppError> {
        if target.id.trim().is_empty() {
            target.id = slug(&target.name, &self.targets);
        }
        if self.targets.iter().any(|t| t.id == target.id) {
            return Err(AppError::TargetExists(target.id));
        }
        self.targets.push(target.clone());
        self.save()?;
        Ok(target)
    }

    /// Removing the last target of a kind is refused rather than silently
    /// leaving a button that can never do anything.
    pub fn remove(&mut self, id: &str) -> Result<(), AppError> {
        let Some(pos) = self.targets.iter().position(|t| t.id == id) else {
            return Err(AppError::TargetNotFound(id.to_string()));
        };
        let kind = self.targets[pos].kind;
        if self.targets.iter().filter(|t| t.kind == kind).count() == 1 {
            return Err(AppError::LastTarget(self.targets[pos].name.clone()));
        }
        self.targets.remove(pos);
        self.save()
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.targets)?;
        fs::write(&self.file_path, data)?;
        Ok(())
    }
}
```

This is the fourth JSON-backed store in DevGo, and the fourth one is where a codebase either has a house style or has four dialects — hence the doc comment naming what it mirrors. Note the two-step in `new`: the file-missing branch seeds *and writes*, so a fresh install has a `targets.json` on disk to open and edit; then the emptiness check runs over the result of **either** branch, which is what catches a file that exists and parses to `[]`.

`add` returns the target it stored, not `()`. The caller passed an id of `""` and the store filled it in, so returning it is how the frontend learns the real id without a second round trip.

### Refusing to remove the last of a kind

Both `remove`'s guard and `new`'s re-seed protect one invariant from two directions: **there is always at least one editor and at least one terminal.**

The reason is not tidiness. `ActionButtons` renders an `Editor` button and a `Terminal` button unconditionally, and `Ctrl+Enter` / `Shift+Enter` are declared in `SHORTCUTS` unconditionally. Delete the only editor and none of that disappears — you get a button that is enabled, that you press, that does nothing except produce a `TargetNotFound` error naming a kind you did not know had a name. The alternative fixes are all worse: hiding the button means the launcher's layout changes based on a Settings panel three clicks away; auto-re-seeding on delete means the thing you just removed comes back, which reads as a bug.

Refusing costs one `if`, and the error names the target: *"VS Code is the only one of its kind — add another before removing it."* The user's next action is in the sentence.

**This is chapter 06's cache invariant with a different mechanism.** `ProjectCacheStore::store` refuses to overwrite a good scan with a bad one silently, because the caller is code. Here the invariant is enforced *by failing loudly*, because removing a target is something a human deliberately asked for and is owed an answer about. The `new` half is the same invariant against a different attacker — a truncated write, a hand-edited file — and nobody *chose* `[]`, so nothing is owed an explanation and re-seeding silently is right.

### Deriving an id from a name

```rust
/// Derive an id from a display name, disambiguating against what exists.
fn slug(name: &str, existing: &[LaunchTarget]) -> String {
    let base: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let base = base.trim_matches('-').to_string();
    let base = if base.is_empty() {
        "target".to_string()
    } else {
        base
    };

    if !existing.iter().any(|t| t.id == base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|c| !existing.iter().any(|t| &t.id == c))
        .unwrap()
}
```

Same shape as `sanitize_file_stem` in `launcher.rs` (chapter 05): map every character to something safe, trim the separators off the ends, and have a fallback for the string that reduces to nothing. `(2..)` is an unbounded range, `.find` stops at the first free candidate, and `.unwrap()` cannot panic because the range never ends and the existing list is finite. Starting at `2` is a small honesty: `sublime-text-2` reads as "the second one", where `sublime-text-1` beside `sublime-text` reads as if one is mislabelled. It appends rather than rejecting because the *name* is the user's; the id is DevGo's business.

### Five tests, and the empty-file one that is really a fixture

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> TargetStore {
        let dir = std::env::temp_dir().join(format!("devgo-targets-{name}"));
        let _ = fs::remove_dir_all(&dir);
        TargetStore::new(dir).unwrap()
    }

    fn editor(name: &str) -> LaunchTarget {
        LaunchTarget {
            id: String::new(),
            name: name.into(),
            kind: TargetKind::Editor,
            executable: "x".into(),
            args_template: "{path}".into(),
            wsl_executable: None,
            wsl_args_template: None,
        }
    }

    fn count_of(s: &TargetStore, kind: TargetKind) -> usize {
        s.list().iter().filter(|t| t.kind == kind).count()
    }

    #[test]
    fn seeds_vscode_and_windows_terminal() {
        let s = store("seed");
        assert_eq!(count_of(&s, TargetKind::Editor), 1);
        assert_eq!(count_of(&s, TargetKind::Terminal), 1);
        assert_eq!(s.get("vscode").unwrap().name, "VS Code");
    }

    /// A truncated or hand-edited empty file must not leave the user with no
    /// way to launch anything and no obvious way back.
    #[test]
    fn re_seeds_an_empty_registry() {
        let dir = std::env::temp_dir().join("devgo-targets-empty");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("targets.json"), "[]").unwrap();
        assert_eq!(
            TargetStore::new(dir).unwrap().list().len(),
            defaults().len()
        );
    }

    #[test]
    fn derives_and_disambiguates_ids() {
        let mut s = store("slug");
        assert_eq!(s.add(editor("Sublime Text")).unwrap().id, "sublime-text");
        assert_eq!(s.add(editor("Sublime Text")).unwrap().id, "sublime-text-2");
    }

    #[test]
    fn refuses_removing_the_last_of_a_kind() {
        let mut s = store("last");
        assert!(matches!(s.remove("vscode"), Err(AppError::LastTarget(_))));

        s.add(editor("Cursor")).unwrap();
        assert!(
            s.remove("vscode").is_ok(),
            "second editor makes the first removable"
        );
    }

    #[test]
    fn survives_a_reload() {
        let dir = std::env::temp_dir().join("devgo-targets-reload");
        let _ = fs::remove_dir_all(&dir);
        let mut s = TargetStore::new(dir.clone()).unwrap();
        s.add(editor("Zed")).unwrap();
        assert_eq!(
            TargetStore::new(dir).unwrap().get("zed").unwrap().name,
            "Zed"
        );
    }
}
```

Each test names its own temp directory and deletes it first — cargo runs tests in parallel, and a shared directory is the classic suite that is green on your machine and red in CI. `re_seeds_an_empty_registry` writes `"[]"` by hand because that is the only way to reach the branch: no API DevGo exposes can produce an empty registry, precisely because of the `remove` guard. **When an invariant makes a state unreachable through the API, the test for the recovery path has to fabricate the state on disk** — a feature of the design, not an awkwardness of the test.

---

## 13.5 — The launcher forgets what an editor is

`src-tauri/src/services/launcher.rs` gains one import, `use crate::models::target::{LaunchTarget, TargetKind};`, and `spawn_cmd` / `launch_vscode` / `launch_terminal` become `spawn_raw` (§13.6) and one launch function:

```rust
/// Launch a project into any registered target.
///
/// Replaces the hardcoded `code` and `wt` calls. Nothing here knows what an
/// editor is any more — it resolves a command line from the target's own
/// templates and spawns it.
pub fn launch_target(
    target: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
) -> Result<(), AppError> {
    let (resolved, script) = if is_wsl(project) {
        let distro = distro_from_project(project, info)?;
        let linux_path = super::platform::paths::windows_to_wsl_path(
            &project.full_path,
            &distro,
        );
        let script = if target.kind == TargetKind::Terminal {
            Some(write_tmux_script(project, &distro, &linux_path)?)
        } else {
            None
        };
        (
            target.resolve(&project.full_path, Some((&distro, &linux_path))),
            script,
        )
    } else {
        (target.resolve(&project.full_path, None), None)
    };

    // A target with no WSL form cannot open a WSL project. Saying so is the
    // whole point — launching anyway would open the wrong directory silently.
    let (exe, args) = resolved.ok_or_else(|| {
        AppError::TargetCannotOpenWsl(target.name.clone(), project.name.clone())
    })?;

    let args = match script {
        Some(path) => args.replace("{script}", &path),
        None => args,
    };

    spawn_raw(&exe, &args)
}

/// Write the tmux session script for a WSL project and return its Linux path.
///
/// This is a DevGo behaviour rather than a property of any terminal — the
/// three-window code/agents/git session is the thing worth keeping. Templates
/// reach it through `{script}`; a terminal whose template ignores the
/// placeholder simply opens a plain shell.
fn write_tmux_script(
    project: &Project,
    distro: &str,
    linux_path: &str,
) -> Result<String, AppError> {
    let script = build_tmux_script(&project.name, linux_path);
    let temp_file = std::env::temp_dir()
        .join(format!("devgo-{}.sh", sanitize_file_stem(&project.name)));
    std::fs::write(&temp_file, &script)?;
    Ok(super::platform::paths::windows_to_wsl_path(
        &temp_file.to_string_lossy(),
        distro,
    ))
}
```

`is_wsl`, `distro_from_project`, `sanitize_file_stem` and `build_tmux_script` are unchanged from chapters 04 and 05. The WSL detection, the distro resolution and the path translation were never editor-specific — they were only *sitting* in an editor-specific function.

### Refusal as a feature

A Windows-only target — Notepad, anything without a remote mode — pointed at `\\wsl.localhost\Ubuntu\home\user\app` does not error. Windows resolves the UNC path through the 9p server, and one of three things happens: the program opens the directory over 9p and is unusably slow; the program does not understand UNC paths, silently falls back to its working directory, and opens *some other project*; or it opens nothing and exits zero. The middle one is much the worst: you get a window with code in it, you start working, and it is the wrong repository.

So `wsl_args_template: None` is a **declaration that this target cannot do this job**, and `launch_target` reports it — naming the target and the project, because the user's question in that moment is "which of my things is wrong?" and the answer is "this pairing".

**A launcher's most dangerous failure is not refusing to open something — it is opening the wrong thing successfully.**

### `{script}`, and why the tmux session survived

Chapter 05's three-window `code` / `agents` / `git` session is one of the few opinions DevGo actually holds, and templating the terminal could easily have deleted it. The doc comment says why it did not: **the tmux session is a DevGo behaviour, not a property of Windows Terminal.** Making terminals pluggable is not a reason to stop writing the script — it is a reason to give templates a way to *reach* it. `launch_target` writes the script first (for `Terminal` kinds on WSL projects only), and substitutes its Linux path into the already-resolved args; a template without the placeholder gets a plain shell, no special case.

### `launch_both` takes two targets

```rust
pub fn launch_both(
    editor: &LaunchTarget,
    terminal: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
) -> Result<(), AppError> {
    launch_target(editor, project, info)?;
    // The editor needs a moment to claim the foreground, or the terminal opens
    // behind it.
    std::thread::sleep(std::time::Duration::from_millis(1000));
    launch_target(terminal, project, info)
}
```

It does not choose either target — choosing is `resolve_target`'s job (§13.7), and pushing it up one level is what makes "Open Both respects the chosen editor" true by construction rather than by a second lookup.

---

## 13.6 — `spawn_raw`, and the bug templating exposed

```rust
/// Spawn a command line that is already quoted the way the target wants it.
///
/// `Command::args` re-quotes anything containing spaces, which turns
/// `--folder-uri vscode-remote://…` into a single quoted argument and breaks
/// it. `raw_arg` hands the string to Windows verbatim, so the target's own
/// `args_template` is the only thing deciding how it is split.
fn spawn_raw(exe: &str, args: &str) -> Result<(), AppError> {
    Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .raw_arg(format!("/c {exe} {args}"))
        .spawn()
        .map_err(|e| AppError::LaunchFailed(format!("{exe}: {e}")))?;
    Ok(())
}
```

On Windows there is no argument vector. `CreateProcess` takes **one string**, and the process on the other end splits it back up itself. Rust's `Command::args` therefore has to *build* that string, and to make sure an argument containing a space arrives as one argument, it quotes it. Correct almost always; exactly wrong here.

Chapter 05 passed pre-split pieces — `["code", "--folder-uri", &uri]` — and none contained a space. A template is not pre-split. `--folder-uri vscode-remote://wsl+Ubuntu/home/user/app` is one string that must arrive as *two* arguments, and `Command::args` would wrap the whole thing in quotes. VS Code receives one argument beginning `--folder-uri ` — not a flag it knows — and opens your home directory, or an empty window, or nothing.

`raw_arg` appends the string **verbatim**. That puts the responsibility where the design already put it: the template is the user's, they wrote the quoting they wanted (`"{path}"` has its own quotes, right there in the seed), and `spawn_raw` respects it. The trade is real: a template can produce a broken command line and DevGo will spawn it. That is the same authority the template already had, and the alternative is a quoting layer that fights the templates for control of the same string.

### No test on `resolve` could have caught this

The bug lives strictly *between* `resolve` and the child process. `wsl_projects_use_the_remote_uri` asserts the resolved string character for character and passes, before and after the fix. **`resolve()` was never wrong.** The nine tests in §13.3 and §13.4 all stop at a string; the failure is one layer further out, in a layer with no return value to assert on, whose only observable output is *what the child process did.* So the test has to spawn a child and look — §13.10.

**Draw the boundary of what your tests actually cover, and check whether the bug you are worried about lives inside it.**

---

## 13.7 — Defaults by id, and the three-step fallback

`src-tauri/src/services/preferences.rs` gains `use crate::models::target::TargetKind;`, two fields:

```rust
    /// Chosen editor / terminal, by target id. Stored by id rather than name so
    /// renaming a target does not orphan the default.
    #[serde(default)]
    pub default_editor: Option<String>,
    #[serde(default)]
    pub default_terminal: Option<String>,
```

and two methods on `PreferencesStore`, above `save`:

```rust
    pub fn default_target(&self, kind: TargetKind) -> Option<String> {
        match kind {
            TargetKind::Editor => self.prefs.default_editor.clone(),
            TargetKind::Terminal => self.prefs.default_terminal.clone(),
        }
    }

    pub fn set_default_target(
        &mut self,
        kind: TargetKind,
        id: &str,
    ) -> Result<(), String> {
        match kind {
            TargetKind::Editor => {
                self.prefs.default_editor = Some(id.to_string())
            }
            TargetKind::Terminal => {
                self.prefs.default_terminal = Some(id.to_string())
            }
        }
        self.save()
    }
```

`#[serde(default)]` on both, same as `project_stats`, `pinned` and `summon_hotkey`: an existing `prefs.json` has neither key, and without the attribute it would fail to parse — which, thanks to `unwrap_or_default()` in `PreferencesStore::new`, would silently reset every preference the user has. That attribute is the difference between "a new field appeared" and "your pins are gone."

Storing `"vscode"` rather than `"VS Code"` buys one thing: renaming is display-only. Stored by name, a rename orphans the default and the fallback quietly starts launching whatever is first — the user changed a label and their editor changed. **The key you persist should be the thing that does not change, not the thing the user reads** — chapter 09's `full_path` argument again.

### The fallback chain

In `src-tauri/src/commands.rs`, `AppState` gains `pub target_store: Mutex<TargetStore>` (import `TargetStore` from `crate::services` and `{LaunchTarget, TargetKind}` from `crate::models::target`), and:

```rust
/// Pick the target to launch: the caller's explicit choice, else the saved
/// default, else the first of that kind. The last fallback matters — a default
/// pointing at a target the user has since deleted must not break launching.
fn resolve_target(
    state: &AppState,
    kind: TargetKind,
    explicit: Option<String>,
) -> Result<LaunchTarget, AppError> {
    let store = state.target_store.lock().map_err(lock_err)?;
    if let Some(id) = explicit {
        return store.get(&id).ok_or(AppError::TargetNotFound(id));
    }
    let saved = state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .default_target(kind);
    if let Some(target) = saved.and_then(|id| store.get(&id)) {
        return Ok(target);
    }
    store
        .first_of(kind)
        .ok_or_else(|| AppError::TargetNotFound(format!("{kind:?}")))
}
```

Three steps, and the asymmetry between them is the design:

1. **Explicit id** — if the caller named a target and it does not exist, that is an **error**. Substituting a different one would be answering a question nobody asked.
2. **Saved default** — `.and_then(|id| store.get(&id))` collapses "no default set" and "default points at a deleted target" into the same branch, and falls through rather than erroring. The user did not ask for this target *now*; they asked for it once, and the record has gone stale.
3. **First of kind** — and `remove`'s guard is what makes this reachable rather than theoretical.

Step 2 is the one that matters. Set Cursor as your default, remove Cursor from the registry: without the fallback, `Ctrl+Enter` errors for every project, forever, until you go into Settings — the app bricked by a stale pointer to something the user deleted on purpose. **This is chapter 06's cache chain again** — live → cached → unavailable; explicit → saved → first-of-kind — and in both the reason is that **stored state can outlive the thing it points at.**

The dangling default is not cleaned up. It stays in `prefs.json`, quietly overridden, and starts working again the instant a target with that id reappears. Repairing on read is cheaper and less destructive than pruning on write.

---

## 13.8 — Five commands, two rewritten ones, and one that resolves for the UI

`open_vscode` becomes `open_editor` — the rename is the point of the slice, and a command called `open_vscode` that can launch Helix would be a lie in the API:

```rust
#[tauri::command]
pub fn open_editor(
    project: Project,
    target_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let target = resolve_target(&state, TargetKind::Editor, target_id)?;
    launcher::launch_target(&target, &project, &info)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn open_terminal(
    project: Project,
    target_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let target = resolve_target(&state, TargetKind::Terminal, target_id)?;
    launcher::launch_target(&target, &project, &info)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn open_both(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    let editor = resolve_target(&state, TargetKind::Editor, None)?;
    let terminal = resolve_target(&state, TargetKind::Terminal, None)?;
    launcher::launch_both(&editor, &terminal, &project, &info)?;
    record_launch(&state, &project)
}
```

`record_launch` still runs last and only on success: a project that failed to open must not climb the ranking. The CRUD commands are thin:

```rust
#[tauri::command]
pub fn get_targets(
    state: State<AppState>,
) -> Result<Vec<LaunchTarget>, AppError> {
    Ok(state.target_store.lock().map_err(lock_err)?.list())
}

#[tauri::command]
pub fn add_target(
    target: LaunchTarget,
    state: State<AppState>,
) -> Result<LaunchTarget, AppError> {
    state.target_store.lock().map_err(lock_err)?.add(target)
}

#[tauri::command]
pub fn remove_target(
    id: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    state.target_store.lock().map_err(lock_err)?.remove(&id)
}

#[tauri::command]
pub fn set_default_target(
    kind: TargetKind,
    id: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    // Reject unknown ids here rather than storing a dangling default.
    if state
        .target_store
        .lock()
        .map_err(lock_err)?
        .get(&id)
        .is_none()
    {
        return Err(AppError::TargetNotFound(id));
    }
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .set_default_target(kind, &id)
        .map_err(AppError::Lock)
}
```

`set_default_target` validates before writing even though §13.7 tolerates a dangling default. Those are not redundant: the fallback exists for a default that *became* stale, which is unavoidable; a default that is stale the moment it is written is avoidable. **Tolerate the states you cannot prevent; refuse to create them.**

```rust
/// The id that would actually launch for each kind — the same fallback chain
/// as `resolve_target`, so the UI's "default" badge cannot disagree with the
/// button.
#[tauri::command]
pub fn get_default_targets(
    state: State<AppState>,
) -> Result<Vec<(String, String)>, AppError> {
    let prefs = state.pref_store.lock().map_err(lock_err)?;
    let store = state.target_store.lock().map_err(lock_err)?;
    Ok([TargetKind::Editor, TargetKind::Terminal]
        .into_iter()
        .filter_map(|k| {
            let id = prefs
                .default_target(k)
                .filter(|id| store.get(id).is_some())
                .or_else(|| store.first_of(k).map(|t| t.id))?;
            Some((format!("{k:?}").to_lowercase(), id))
        })
        .collect())
}
```

`resolve_target`'s steps 2 and 3 with no step 1, returning ids, so the UI can badge the row that *would actually launch*. `format!("{k:?}").to_lowercase()` turns `TargetKind::Editor` into `"editor"`, matching the serde wire form; it is a `Vec<(String, String)>` because Tauri serialises that to a JSON array of pairs, which `Object.fromEntries` takes directly.

Four error variants in `error.rs`, after `WslStopFailed`:

```rust
    #[error("A target with id {0} already exists")]
    TargetExists(String),

    #[error("No such editor or terminal: {0}")]
    TargetNotFound(String),

    #[error(
        "{0} is the only one of its kind — add another before removing it"
    )]
    LastTarget(String),

    #[error(
        "{0} has no WSL configuration, so it cannot open the WSL project {1}"
    )]
    TargetCannotOpenWsl(String, String),
```

Unlike chapter 12's pass-through, every one of these supplies its own wording: here the variant *knows* what happened. `LastTarget` carries the `name` rather than the id, because it is read by a person looking at a row labelled "VS Code".

In `lib.rs`, the store is built in `setup` **before** `WorkspaceStore::new(app_data_dir)` — that call moves `app_data_dir`, so everything that clones it has to come first:

```rust
            let target_store = services::TargetStore::new(app_data_dir.clone())
                .expect("failed to initialize target store");
```

managed as `target_store: std::sync::Mutex::new(target_store)`, and the `invoke_handler` swaps `open_vscode` for `open_editor` and adds the five: `get_targets`, `add_target`, `remove_target`, `set_default_target`, `get_default_targets`.

> **Commit checkpoint** — the registry lands as one commit. There is no intermediate state worth having: a `LaunchTarget` model nothing launches, or a `TargetStore` with no commands, are both "the app builds and nothing changed", and `launch_vscode` cannot coexist with `launch_target` because the second one replaces it. `cargo test` reports **35**.
>
> ```powershell
> git add -A && git commit -m "✅TARGETS: replace the hardcoded editor and terminal with a registry — LaunchTarget, TargetStore, resolve_target's three-step fallback, raw_arg spawn"
> ```

---

## 13.9 — The test that spawns a real process

Nine tests, all green, and §13.6's bug would have shipped. The tenth is different in kind. At the bottom of `launcher.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::target::TargetKind;

    /// End-to-end proof that a template survives into a real process.
    ///
    /// The failure this guards is subtle: `Command::args` re-quotes anything
    /// containing spaces, so a multi-word template arrives as one argument and
    /// the target sees garbage. Only actually spawning catches that.
    #[test]
    fn a_multi_word_template_reaches_the_process_intact() {
        let marker = std::env::temp_dir().join("devgo-launch-proof.txt");
        let _ = std::fs::remove_file(&marker);

        let target = LaunchTarget {
            id: "proof".into(),
            name: "Proof".into(),
            kind: TargetKind::Editor,
            executable: "cmd".into(),
            // Three separate arguments plus a redirect: exactly the shape that
            // breaks under re-quoting.
            args_template: format!(
                "/c echo {{path}} > \"{}\"",
                marker.display()
            ),
            wsl_executable: None,
            wsl_args_template: None,
        };

        let project = Project::new(
            "proof".into(),
            r"G:\some\project".into(),
            r"G:\some".into(),
            "Windows".into(),
        );
        let info = RuntimeInfo {
            runtime: crate::services::platform::runtime::Runtime::Windows,
            wsl_available: false,
            distros: vec![],
            default_distro: None,
        };

        launch_target(&target, &project, &info).unwrap();

        // The spawn is async; give the child a moment to finish writing. The
        // redirect creates the file before echo runs, so wait for bytes, not
        // for existence — polling on `exists()` read an empty file.
        let written_len = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written_len() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        let written =
            std::fs::read_to_string(&marker).expect("target never ran");
        assert!(
            written.contains(r"G:\some\project"),
            "template did not survive into the process: {written:?}"
        );
        let _ = std::fs::remove_file(&marker);
    }
}
```

### Designing a target whose output you can read

The problem with testing a launcher is that its output is *a program starting*, which is not a value. The trick is to register a target that is a real program, produces a file, and has the exact shape that breaks. `cmd` is the target; its template is `/c echo {path} > "<marker>"` — three whitespace-separated arguments and a shell redirect. Under `Command::args` the whole string is wrapped in quotes, the inner `cmd` receives a single blob it will not run as a redirect, no file appears, and the message is `"target never ran"`. Under `raw_arg` the redirect is a redirect and the file contains the substituted path.

`contains` rather than `assert_eq!`, because `echo` appends a newline and Windows may add whitespace before the `>`. **Assert the property, not the incidental formatting around it.**

### The wait that reads an empty file

A first draft of this loop polled `marker.exists()`, and the test failed on its first run with `template did not survive into the process: ""` — the file existed and was empty. `cmd` opens the redirect target *before* it runs `echo`, so "the file exists" is true a few milliseconds before "the file has content", and a fast test thread reads it in between. The loop here waits for a non-zero length instead.

That is the same lesson as the test's own subject, one level down: the thing you observe has to be the thing you mean. The property is "the path was written", and `exists()` is a proxy for it that is almost always right — which is the most dangerous kind of proxy, because a test that flakes one run in fifty gets marked flaky and ignored rather than fixed.

### What this test is actually for

It is a regression guard on **one line** of `spawn_raw`. If someone later "simplifies" `raw_arg(format!(…))` back to `.args(…)` — and it does look like the more idiomatic Rust, which is exactly why someone might — nine `resolve` tests stay green and this one goes red with a message that names the cause. **When the fix for a bug is a single line that looks less idiomatic than the bug, write the test that explains it.**

> **Commit checkpoint** — separately from the registry, because it is a different claim. The registry commit says "DevGo can launch any target." This one says "and the command line survives the trip". `cargo test` reports **36**.
>
> ```powershell
> git add -A && git commit -m "✅TARGETS: prove a multi-word template survives into a real process — waits for bytes, not for the file"
> ```

---

## 13.10 — The panel the shell did not have to change for

`src/types.d.ts` gains the mirror of the Rust model, after `LastProject`:

```ts
type TargetKind = 'editor' | 'terminal';

/// An editor or terminal DevGo can launch into. Both share one shape because
/// both are "a program plus how to hand it a directory". `string | null`, not
/// `?`: Rust's Option serialises to an explicit null, and one is built here to
/// send back.
interface LaunchTarget {
	id: string;
	name: string;
	kind: TargetKind;
	executable: string;
	args_template: string;
	wsl_executable: string | null;
	wsl_args_template: string | null;
}
```

and the props, after `ShortcutTableProps`:

```ts
/// The add form's fields — all strings, because an input cannot hold null.
type TargetDraft = Record<
	'name' | 'executable' | 'args_template' | 'wsl_executable' | 'wsl_args_template',
	string
>;

interface TargetListProps {
	kind: TargetKind;
	items: LaunchTarget[];
	defaultId?: string;
	onRemove: (id: string) => void;
	onSetDefault: (kind: TargetKind, id: string) => void;
}

interface TargetManagerProps {
	editors: LaunchTarget[];
	terminals: LaunchTarget[];
	/// Kind → id of the target that would actually launch, resolved in Rust.
	defaults: Record<string, string>;
	onAdd: (t: Omit<LaunchTarget, 'id'>) => Promise<void>;
	onRemove: (id: string) => Promise<void>;
	onSetDefault: (kind: TargetKind, id: string) => Promise<void>;
	onError: (message: string) => void;
}
```

`SettingsProps` gains `onError: (message: string) => void;`, and `ActionButtonsProps.onVSCode` becomes `onEditor`.

### The hook

Create `src/hooks/useTargets.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

/// The registry of editors and terminals, plus which of each is default.
///
/// Defaults are resolved on the Rust side and returned here rather than being
/// read straight from prefs, because a default can point at a target the user
/// has since deleted. One fallback chain, in one place.
export const useTargets = () => {
	const [targets, setTargets] = useState<LaunchTarget[]>([]);
	const [defaults, setDefaults] = useState<Record<string, string>>({});

	const reload = async () => {
		const [list, pairs] = await Promise.all([
			invoke<LaunchTarget[]>('get_targets'),
			invoke<[string, string][]>('get_default_targets')
		]);
		setTargets(list);
		setDefaults(Object.fromEntries(pairs));
	};

	useEffect(() => {
		reload().catch(() => {});
	}, []);

	const editors = targets.filter(t => t.kind === 'editor');
	const terminals = targets.filter(t => t.kind === 'terminal');

	// Every write ends in a reload rather than patching local state: the list
	// is short, the calls are local, and the store's rules (what the id
	// becomes, whether a removal is allowed) stay in one place.
	const addTarget = async (target: Omit<LaunchTarget, 'id'>) => {
		await invoke<LaunchTarget>('add_target', { target: { ...target, id: '' } });
		await reload();
	};

	const removeTarget = async (id: string) => {
		await invoke('remove_target', { id });
		await reload();
	};

	const setDefaultTarget = async (kind: TargetKind, id: string) => {
		await invoke('set_default_target', { kind, id });
		await reload();
	};

	return {
		editors,
		terminals,
		defaults,
		addTarget,
		removeTarget,
		setDefaultTarget
	};
};
```

There is an obvious cheaper version: read `default_editor` straight from prefs and compare it to each row. It would be wrong about a quarter of the time, always the same way — **no badge** on a fresh install (nothing chosen, while `Ctrl+Enter` cheerfully launches VS Code via `first_of`), and **no badge** after you delete the target you had set as default (while launching still works). In both cases something *is* the effective default and the UI says nothing is. Reimplementing the chain in TypeScript is worse than either: the fallback logic exists twice, and the day someone adds a fourth step to `resolve_target` the badge starts disagreeing with the button. That is chapter 11's thesis in a different costume — **one fact, one declaration, every reader derives** — and the fact here is a Rust fact because Rust is what launches.

`addTarget` takes `Omit<LaunchTarget, 'id'>` and sends `id: ''`, the wire signal §13.4's `add` looks for. The type makes it impossible for a caller to invent an id by hand.

### The panel

`src/components/TargetManager.tsx` is the biggest file in the slice and it is in the repo in full; the shape is four tables and two components. `KINDS` drives the kind toggle, `FIELDS` drives the five inputs, `PLACEHOLDERS` drives the help line, and inside `TargetList` each row builds its `badges` and `actions` as arrays and maps them — never a repeated element. Three details are load-bearing.

The "windows only" badge reads the refusal straight off the model:

```tsx
			const badges = [
				{
					show: t.id === defaultId,
					label: 'default',
					className: 'text-accent border-accent/40'
				},
				{
					show: !t.wsl_args_template,
					label: 'windows only',
					className: 'text-text-muted border-border',
					title: 'No WSL configuration — this target cannot open WSL projects'
				}
			];
```

`wsl_args_template: null` is §13.2's refusal, and the row says so *before* you try to launch a WSL project with it. The error in §13.5 is the safety net; this badge is the thing that means you rarely meet it.

The add form translates blank fields into `null`:

```tsx
				// Empty means "not configured", which is what None means on the
				// Rust side — a target with no WSL form refuses WSL projects
				// rather than opening the wrong directory.
				wsl_executable: draft.wsl_executable.trim() || null,
				wsl_args_template: draft.wsl_args_template.trim() || null
```

An HTML input cannot be `null`; it can only be `""`. Sending `""` would give the Rust side a `Some("")` — a target that claims to have a WSL form and spawns `cmd /c code` with no arguments. `|| null` is the whole translation, and `TargetDraft` (all strings) versus `LaunchTarget` (`string | null`) is the type system keeping the two shapes apart so that the translation has to be written.

And every action is guarded:

```tsx
	// Every action here can fail on purpose — removing the last editor is
	// refused with a sentence the user needs to read. The panel does not own
	// a toast; the failure travels up.
	const guard = (p: Promise<void>) => p.catch(e => onError(String(e)));
```

This is Settings' first panel whose actions can *fail on purpose*. Adding a workspace either works or the picker was cancelled; removing the last editor is refused by design. `App` owns the toast, so the failure travels up as `onError` — the same way `WslControl`'s confirmations do — and `App` wires it as `onError: (m: string) => toast(m, 'error')`.

### The shell that did not change

`src/components/Settings.tsx` gains two imports, the hook, one prop, and **one object in the panel array**:

```tsx
	const targets = useTargets();
```

```tsx
		{
			id: 'targets',
			label: 'Editors & Terminals',
			render: () => (
				<TargetManager
					{...{
						editors: targets.editors,
						terminals: targets.terminals,
						defaults: targets.defaults,
						onAdd: targets.addTarget,
						onRemove: targets.removeTarget,
						onSetDefault: targets.setDefaultTarget,
						onError
					}}
				/>
			)
		},
```

The nav, the panel persistence, the `Escape` handler, the layout, the `lazy()` boundary in `App.tsx` — none of it changed. This is the claim chapter 11 §11.8 made, cashed: the test of "build the container early" was never how the shell looked on the day it was written, it was what the **second** panel cost. **The value of an abstraction is measured on its second use, not its first.**

### The button stops saying VS Code

`useLaunchActions` follows the command rename:

```ts
	const openEditor = () => {
		if (!selected) return Promise.resolve();
		// targetId omitted means "use the default", resolved on the Rust side so
		// the fallback chain lives in one place.
		return invoke('open_editor', { project: selected, targetId: null });
	};
```

and the rename goes all the way to the surface: `openVSCode` → `openEditor`, `handleOpenVSCode` → `handleOpenEditor`, `onVSCode` → `onEditor`, and in `ActionButtons`' table the label `VS Code` becomes **`Editor`**. Keeping the label would be wrong: with Notepad set as the default, a button reading "VS Code" that opens Notepad is exactly the kind of claim chapter 11 spent a whole chapter refusing to make. A rename of frontend identifiers costs nothing and the label is the one the user reads.

> **Commit checkpoint**
>
> ```powershell
> git add -A
> git commit -m "✅UI: Editors & Terminals panel — useTargets with Rust-resolved defaults, TargetManager, the Editor button stops saying VS Code"
> git commit --allow-empty -m "✅STAGE: 13 targets"
> git checkout main && git merge 13.targets && git push origin 13.targets main
> ```

---

## 13.11 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun run build
bun tauri dev
```

`cargo test` reports **36** — chapter 12's 26 plus 4 in `models::target`, 5 in `services::target_store`, and 1 in `services::launcher`. Watch for the last one by name; it is the only test in the suite that asserts on something outside the program:

```
test services::launcher::tests::a_multi_word_template_reaches_the_process_intact ... ok
```

`bun run build`: the `Settings` chunk roughly doubles (about 12 kB) and the main bundle does not move — `TargetManager` and `useTargets` landed behind chapter 11's split.

Then the checks only a running app can answer. Everything below was run against this chapter's build.

**Nothing changed.** Select a Windows project, `Shift+Enter` — a terminal opens in the directory. Now a WSL project (start the distro, F5): `Shift+Enter` opens Windows Terminal running the three-window tmux session — `wsl -d Ubuntu-26.04 tmux ls` shows `<project>: 3 windows … (attached)`, and `%TEMP%\devgo-<project>.sh` is freshly written. That is §13.5's point that templating did not cost you the session.

**The remote URI, in full.** With a WSL project selected, `Ctrl+Enter`. VS Code's window title reads `<project> [WSL: Ubuntu-26.04]` and the explorer is rooted at your project — not at your Linux home, not an empty window. That is `--folder-uri vscode-remote://wsl+…` arriving as two arguments.

**Settings → Editors & Terminals.** `Ctrl+,`, then the new panel: **Editors** lists `VS Code` badged `default` with `code "{path}"` under it; **Terminals** lists `Windows Terminal` badged `default` with `wt -d "{path}"`. Neither shows `windows only`.

**Refusing the last of a kind.** `Remove` on VS Code. Nothing is removed and an error toast reads *"VS Code is the only one of its kind — add another before removing it."*

**Add one, and watch the id get derived.** `Add editor or terminal`, kind `editor`, Name `Notepad`, Executable `notepad`, leave the rest. `Notepad` appears with a **`windows only`** badge, and `targets.json` holds `"id": "notepad"` with both WSL fields `null`. `Make default` on it: the badge moves, and `prefs.json` says `"default_editor": "notepad"`.

**The refusal, live.** Close Settings, select a **WSL** project, `Ctrl+Enter`. Nothing opens and the toast reads *"Notepad has no WSL configuration, so it cannot open the WSL project `<name>`"*. Select a Windows project, `Ctrl+Enter`: Notepad opens it. The target is not broken; it is honest about its range.

**The fallback, live.** Still with Notepad as default, remove it in Settings (VS Code is there, so the guard allows it). `prefs.json` still says `"default_editor": "notepad"`. VS Code carries the `default` badge again — `get_default_targets` ran the same chain — and `Ctrl+Enter` on the WSL project opens VS Code Remote. Nothing errored, nothing needed resetting.

**The empty-registry recovery.** Quit DevGo, replace the contents of `targets.json` with `[]`, relaunch. The registry is back to VS Code and Windows Terminal.

---

## What you built

```
src-tauri/src/
├── models/
│   ├── target.rs           ← NEW: LaunchTarget, TargetKind, resolve(),
│   │                          defaults(), 4 tests
│   └── mod.rs              ← pub mod target
├── services/
│   ├── target_store.rs     ← NEW: TargetStore, slug(), 5 tests
│   ├── launcher.rs         ← spawn_raw (raw_arg), launch_target,
│   │                          write_tmux_script, launch_both(editor, terminal),
│   │                          the spawn test (waits for bytes)
│   ├── preferences.rs      ← default_editor / default_terminal,
│   │                          default_target(kind), set_default_target(kind, id)
│   └── mod.rs              ← TargetStore
├── commands.rs             ← AppState.target_store, resolve_target, open_editor /
│                              open_terminal take target_id, open_both resolves both,
│                              get_targets, add_target, remove_target,
│                              set_default_target, get_default_targets
├── error.rs                ← TargetExists, TargetNotFound, LastTarget,
│                              TargetCannotOpenWsl
└── lib.rs                  ← TargetStore built before app_data_dir moves; six commands
src/
├── types.d.ts              ← TargetKind, LaunchTarget, TargetDraft, TargetListProps,
│                              TargetManagerProps; SettingsProps.onError; onEditor
├── hooks/
│   ├── useTargets.ts       ← NEW: registry + Rust-resolved defaults
│   └── useLaunchActions.ts ← openEditor → open_editor with targetId: null
├── components/
│   ├── TargetManager.tsx   ← NEW: KINDS / FIELDS / PLACEHOLDERS tables, badges and
│   │                          actions mapped, blank → null
│   ├── Settings.tsx        ← one panel object, useTargets, onError
│   └── ActionButtons.tsx   ← the button says Editor
└── App.tsx                 ← onError → toast, handleOpenEditor
```

> **The thread running through Slice 4.** Every decision here is about **what the app does when the thing it was told to use is not there or not able.** A target with no WSL form refuses rather than opening the wrong directory. A default pointing at a deleted target falls through rather than bricking the launch button. An empty registry re-seeds. The last editor cannot be removed. And a command line built from a user's template is handed to the OS verbatim, because the alternative — helpfully re-quoting it — is the app deciding it knows better and being wrong. Configurability is easy; what makes it safe is deciding, for every value the user can now get wrong, whether the honest answer is a fallback or a refusal.

> **What Slice 4 deliberately did not build.** No editor dropdown in the launcher: `open_editor` takes an optional `target_id` and nothing in the UI passes one yet, so the plumbing is there and the picker is not. No `Ctrl+Shift+1-9` to launch editor N — an unbounded set of bindings for a registry that usually has two entries. No last-used-editor restore: DevGo has a *default*, which is a choice you made once, and a "last used" that quietly overrides it would mean the badge in Settings stops predicting what `Ctrl+Enter` does.

---

→ Next: [14 — Project Intelligence](./14-intelligence.md) (Slice 5), where DevGo starts reading what is *inside* a project rather than just its name — for one directory listing per project, not eleven `stat` calls.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [12 — WSL Control](./12-wsl-control.md)
