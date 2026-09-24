use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::models::target::{
    defaults, LaunchTarget, TargetKind, LINUX_ARGS_PRE_TMUX, MAC_TERMINAL_ARGS,
    MAC_TERMINAL_RUN_ARGS, VSCODE_WSL_ARGS, VSCODE_WSL_ARGS_PRE, WT_ARGS,
    WT_ARGS_PRE_PSMUX, WT_RUN_ARGS, WT_RUN_ARGS_PRE, WT_WSL_RUN_ARGS,
    WT_WSL_RUN_ARGS_PRE,
};

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
        // whether this file was written by a version that knows what a file
        // manager is: every row serialises reveal_args_template, so its
        // absence dates the whole file. see adopt_file_manager_row
        let mut knows_file_managers = true;
        let targets: Vec<LaunchTarget> = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            knows_file_managers = data.contains("\"reveal_args_template\"");
            // a corrupt file goes to .bak, not under the next save
            super::config_io::parse_or_backup(&file_path, &data)
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

        let mut store = Self { targets, file_path };
        store.adopt_psmux_template()?;
        store.adopt_run_template()?;
        store.adopt_wt_semicolon_escape()?;
        store.adopt_remote_uri_quotes()?;
        store.adopt_mac_ghostty_bundle()?;
        store.adopt_linux_session_script()?;
        store.adopt_linux_terminal_row()?;
        store.adopt_file_manager_row(knows_file_managers)?;
        Ok(store)
    }

    /// Reveal used to be a program name written into commands.rs; it is a
    /// registered target now, so a registry from before that carries no row
    /// of the kind and the reveal key would answer "no such target" on every
    /// machine that already has DevGo. This seeds the platform's own row
    /// into such a file, once.
    ///
    /// `knew` is how once is enforced, and it is read off the file rather
    /// than kept anywhere: every row this version writes carries
    /// `reveal_args_template`, so a file without the field predates the kind
    /// and a file with it has been here before. That matters because zero
    /// file managers is a legal registry - `remove` allows the last one to
    /// go - and a migration that could not tell the two apart would put
    /// Explorer back on the next launch, silently undoing the removal.
    fn adopt_file_manager_row(&mut self, knew: bool) -> Result<(), AppError> {
        if knew
            || self
                .targets
                .iter()
                .any(|t| t.kind == TargetKind::FileManager)
        {
            return Ok(());
        }
        // a linux box with no manager on PATH seeds none, and gets none
        let Some(seed) = defaults()
            .into_iter()
            .find(|t| t.kind == TargetKind::FileManager)
            .filter(|s| !self.targets.iter().any(|t| t.id == s.id))
        else {
            return Ok(());
        };
        if self.file_path.exists() {
            let backup =
                format!("{}.pre-file-manager", self.file_path.display());
            fs::copy(&self.file_path, backup)?;
        }
        self.targets.push(seed);
        self.save()
    }

    /// defaults() is read once, on first run, so a changed wt template
    /// reaches nobody who already has the app, and that is every machine
    /// this was built for. Only a wt still carrying the old default is
    /// touched: a template the user edited is theirs, the same rule the
    /// session script follows for a hand-made window. The file is copied
    /// aside first, not renamed, so a failure between the two writes leaves
    /// the file it found rather than no file.
    fn adopt_psmux_template(&mut self) -> Result<(), AppError> {
        let Some(pos) = self
            .targets
            .iter()
            .position(|t| t.id == "wt" && t.args_template == WT_ARGS_PRE_PSMUX)
        else {
            return Ok(());
        };
        if self.file_path.exists() {
            let backup = format!("{}.pre-psmux", self.file_path.display());
            fs::copy(&self.file_path, backup)?;
        }
        self.targets[pos].args_template = WT_ARGS.to_string();
        self.save()
    }

    /// wt ran commands under cmd /k; the command is the tab now. The same
    /// shape as the psmux adoption: only the exact old default is rewritten,
    /// a customised template is left alone, a backup is written first.
    fn adopt_run_template(&mut self) -> Result<(), AppError> {
        let Some(pos) = self.targets.iter().position(|t| {
            t.id == "wt"
                && t.run_args_template.as_deref() == Some(WT_RUN_ARGS_PRE)
        }) else {
            return Ok(());
        };
        if self.file_path.exists() {
            let backup = format!("{}.pre-pwsh-run", self.file_path.display());
            fs::copy(&self.file_path, backup)?;
        }
        self.targets[pos].run_args_template = Some(WT_RUN_ARGS.to_string());
        self.save()
    }

    /// wt splits its command line on a bare `;`, so the WSL run template's
    /// `; exec bash` opened a second tab that failed. Same shape as the two
    /// adoptions above: only the exact old default is rewritten.
    fn adopt_wt_semicolon_escape(&mut self) -> Result<(), AppError> {
        let Some(pos) = self.targets.iter().position(|t| {
            t.id == "wt"
                && t.wsl_run_args_template.as_deref()
                    == Some(WT_WSL_RUN_ARGS_PRE)
        }) else {
            return Ok(());
        };
        if self.file_path.exists() {
            let backup =
                format!("{}.pre-wt-semicolon", self.file_path.display());
            fs::copy(&self.file_path, backup)?;
        }
        self.targets[pos].wsl_run_args_template =
            Some(WT_WSL_RUN_ARGS.to_string());
        self.save()
    }

    /// The remote URI was bare, so a distro path with a space became three
    /// arguments and VS Code opened the part before it. Not keyed to an id:
    /// every VS Code fork detection offers carries the same bytes, so the
    /// old form is what identifies a row nobody edited.
    fn adopt_remote_uri_quotes(&mut self) -> Result<(), AppError> {
        let stale: Vec<usize> = self
            .targets
            .iter()
            .enumerate()
            .filter(|(_, t)| {
                t.wsl_args_template.as_deref() == Some(VSCODE_WSL_ARGS_PRE)
            })
            .map(|(i, _)| i)
            .collect();
        if stale.is_empty() {
            return Ok(());
        }
        if self.file_path.exists() {
            let backup = format!("{}.pre-uri-quote", self.file_path.display());
            fs::copy(&self.file_path, backup)?;
        }
        for pos in stale {
            self.targets[pos].wsl_args_template =
                Some(VSCODE_WSL_ARGS.to_string());
        }
        self.save()
    }

    /// A mac that added Ghostty before 5565a4e carries the binary inside
    /// the bundle, and that binary is the gui: handed a command it opens a
    /// window and throws it away. Detection writes `open -na` now, and
    /// nothing was written for the machines that already had the old row —
    /// worse, `adopt_linux_session_script` below recognises exactly that
    /// row and puts the {script} seam on its args, so the upgrade turns a
    /// window that at least opened into a key that does nothing at all.
    /// The regression is ours to make, so it is ours to repair.
    ///
    /// It runs before the session script so one migration touches the row
    /// and one backup is written, but the key accepts both arg lines, so
    /// either order finds it: those two are the only ones detection has
    /// ever written here.
    ///
    /// macOS-only, the other migration that has to ask: a path into
    /// `Ghostty.app` on any other machine came from someone else's, and
    /// on linux the same id is the cli on PATH, which takes the command
    /// perfectly well. The work stays in `replace_bundled_ghostty`, which
    /// every platform compiles and the tests drive directly.
    fn adopt_mac_ghostty_bundle(&mut self) -> Result<(), AppError> {
        if !cfg!(target_os = "macos") {
            return Ok(());
        }
        let bundle = self
            .targets
            .iter()
            .find(|t| bundled_ghostty(t))
            .and_then(|t| ghostty_bundle(&t.executable));
        self.replace_bundled_ghostty(bundle.and_then(|b| {
            crate::services::editors::bundle_target("ghostty", &b)
        }))
    }

    /// Swap the stale ghostty row for `replacement`, the row detection
    /// gives that same bundle now. No replacement is no repair rather than
    /// a removal: a bundle that has since been deleted leaves a dead row
    /// either way, and a migration that invents a line is worse than one
    /// that does nothing. Same shape as the adoptions above, a backup
    /// first.
    fn replace_bundled_ghostty(
        &mut self,
        replacement: Option<LaunchTarget>,
    ) -> Result<(), AppError> {
        let Some(replacement) = replacement else {
            return Ok(());
        };
        let Some(pos) = self.targets.iter().position(bundled_ghostty) else {
            return Ok(());
        };
        if self.file_path.exists() {
            let backup =
                format!("{}.pre-mac-ghostty", self.file_path.display());
            fs::copy(&self.file_path, backup)?;
        }
        // in place, so the terminal keeps the position it had
        self.targets[pos] = replacement;
        self.save()
    }

    /// The linux terminals shipped without the session seam, so an install
    /// from v1.1.0 or v1.1.1 opens a bare shell where a fresh one opens the
    /// tmux session. Keyed on the id AND the exact old bytes, not one of
    /// them: five emulators shipped the same old form and each takes a
    /// different flag, so the id says which line to write, and the bytes
    /// say nobody has edited this row. Same shape as the adoptions above -
    /// a backup first, and only the forms the app itself wrote.
    fn adopt_linux_session_script(&mut self) -> Result<(), AppError> {
        let stale: Vec<(usize, &str)> = self
            .targets
            .iter()
            .enumerate()
            .filter_map(|(i, t)| {
                LINUX_ARGS_PRE_TMUX
                    .iter()
                    .find(|(id, pre, _)| *id == t.id && *pre == t.args_template)
                    .map(|(_, _, seam)| (i, *seam))
            })
            .collect();
        if stale.is_empty() {
            return Ok(());
        }
        if self.file_path.exists() {
            let backup = format!("{}.pre-linux-tmux", self.file_path.display());
            fs::copy(&self.file_path, backup)?;
        }
        for (pos, seam) in stale {
            self.targets[pos].args_template = seam.to_string();
        }
        self.save()
    }

    /// v1.1.0 seeded a linux install with the mac registry — defaults() was
    /// cfg(not(windows)) until c5e279c — so such a machine carries the
    /// Terminal.app row, and on linux `open` is xdg-open, which answers
    /// `unexpected option '-a'` and exits 1. The terminal key has done
    /// nothing at all, silently, ever since. c5e279c fixed what a fresh
    /// install seeds and nothing for a machine already carrying the row.
    ///
    /// One of the two migrations here that have to ask what platform they
    /// are on: the rest are safe everywhere because their bytes cannot
    /// appear off their own platform, and these bytes are exactly what a
    /// mac is supposed to have. The work itself stays in
    /// `replace_mac_terminal`,
    /// which every platform can compile and the tests drive directly.
    fn adopt_linux_terminal_row(&mut self) -> Result<(), AppError> {
        if !cfg!(target_os = "linux") {
            return Ok(());
        }
        self.replace_mac_terminal(local_terminal())
    }

    /// Swap the mac terminal row for `replacement`, or drop it when there
    /// is none: a box with no emulator gets no terminal row, which is what
    /// defaults() already does on linux and is honest — a placeholder that
    /// cannot run is not. Keyed on the id, the executable AND both
    /// templates, all four: one row shipped these bytes, so anything else
    /// under that id is the user's. Same shape as the adoptions above, a
    /// backup first.
    fn replace_mac_terminal(
        &mut self,
        replacement: Option<LaunchTarget>,
    ) -> Result<(), AppError> {
        let Some(pos) = self.targets.iter().position(|t| {
            t.id == "terminal"
                && t.executable == "open"
                && t.args_template == MAC_TERMINAL_ARGS
                && t.run_args_template.as_deref() == Some(MAC_TERMINAL_RUN_ARGS)
        }) else {
            return Ok(());
        };
        if self.file_path.exists() {
            let backup =
                format!("{}.pre-linux-terminal", self.file_path.display());
            fs::copy(&self.file_path, backup)?;
        }
        // an emulator the registry already lists would only be a second row
        // under the same id
        let replacement =
            replacement.filter(|r| !self.targets.iter().any(|t| t.id == r.id));
        match replacement {
            // in place, so the terminal keeps the position it had
            Some(found) => self.targets[pos] = found,
            None => {
                self.targets.remove(pos);
            }
        }
        self.save()
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
    /// leaving a button that can never do anything — for the two kinds a
    /// machine must have.
    pub fn remove(&mut self, id: &str) -> Result<(), AppError> {
        let Some(pos) = self.targets.iter().position(|t| t.id == id) else {
            return Err(AppError::TargetNotFound(id.to_string()));
        };
        let kind = self.targets[pos].kind;
        // zero agents is a valid machine, and so is zero file managers: a
        // linux box with neither nautilus nor xdg-open seeds no row at all,
        // so the rule could only ever bind the platforms that happen to
        // seed one. zero editors or terminals is a different thing - a
        // launcher whose main button can never do anything
        let optional =
            matches!(kind, TargetKind::Agent | TargetKind::FileManager);
        if !optional
            && self.targets.iter().filter(|t| t.kind == kind).count() == 1
        {
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

/// Whichever emulator this box actually has, for the row the mac seed left
/// behind. Only linux ever reaches it; the other platforms answer with a
/// function that exists so the migration compiles everywhere it is called.
#[cfg(target_os = "linux")]
fn local_terminal() -> Option<LaunchTarget> {
    crate::services::editors::first_terminal()
}

#[cfg(not(target_os = "linux"))]
fn local_terminal() -> Option<LaunchTarget> {
    None
}

/// A ghostty row the app itself wrote against the binary inside the
/// bundle. Three parts: the id, an executable ending in the bundle's own
/// `Contents/MacOS/ghostty`, and one of the two arg lines detection has
/// ever written for this row — the pre-seam form and the seam.
///
/// The executable is what says nobody edited the row: it is a path the
/// app derived from the filesystem, not something a person types, and it
/// is also the half that is broken. The arg line is what says the whole
/// row can be replaced: flags are the field people do tune, and a user
/// who tuned theirs keeps it. That row still opens a bare window, which
/// is what they will report; rewriting their line to guess at what they
/// meant is the worse of the two.
fn bundled_ghostty(t: &LaunchTarget) -> bool {
    let Some((_, pre, seam)) = LINUX_ARGS_PRE_TMUX
        .iter()
        .find(|(id, _, _)| *id == "ghostty")
    else {
        return false;
    };
    t.id == "ghostty"
        && t.executable.ends_with("Contents/MacOS/ghostty")
        && (t.args_template == *pre || t.args_template == *seam)
}

/// The bundle a stored executable points into: `Ghostty.app` from
/// `Ghostty.app/Contents/MacOS/ghostty`.
fn ghostty_bundle(exe: &str) -> Option<PathBuf> {
    Path::new(exe).ancestors().nth(3).map(Path::to_path_buf)
}

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
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        }
    }

    fn count_of(s: &TargetStore, kind: TargetKind) -> usize {
        s.list().iter().filter(|t| t.kind == kind).count()
    }

    #[test]
    fn seeds_vscode_and_a_terminal() {
        let s = store("seed");
        assert_eq!(count_of(&s, TargetKind::Editor), 1);
        assert_eq!(s.get("vscode").unwrap().name, "VS Code");

        // windows and macos seed a constant (wt, Terminal.app), so the count
        // is exactly one. linux has no terminal every distro ships, so it
        // seeds whichever emulator the machine has - and a machine with none,
        // like a bare CI runner, correctly gets no terminal row. asserting 1
        // here passed on a workstation and failed in CI for that reason.
        #[cfg(not(target_os = "linux"))]
        assert_eq!(count_of(&s, TargetKind::Terminal), 1);
        #[cfg(target_os = "linux")]
        assert!(count_of(&s, TargetKind::Terminal) <= 1);
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

    /// An install from before file managers were a kind: its rows carry no
    /// reveal_args_template at all, which is what dates the file, and the
    /// platform's own manager is added once - without it the reveal key
    /// would answer "no such target" on every machine that already has
    /// DevGo. A registry this version wrote is left as it is, even when the
    /// user has removed every file manager from it: that is a choice, and a
    /// migration that could not tell it from a gap would undo it silently on
    /// the next launch.
    #[test]
    fn an_old_registry_gains_a_file_manager_and_keeps_a_removal() {
        let dir = std::env::temp_dir().join("devgo-targets-fm-adopt");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("targets.json"),
            r#"[{"id":"vscode","name":"VS Code","kind":"editor",
                 "executable":"code","args_template":"\"{path}\"",
                 "wsl_executable":null,"wsl_args_template":null,
                 "run_args_template":null,"wsl_run_args_template":null}]"#,
        )
        .unwrap();

        let seeds_one =
            defaults().iter().any(|t| t.kind == TargetKind::FileManager);
        let mut store = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(
            store.first_of(TargetKind::FileManager).is_some(),
            seeds_one,
            "the platform's own row, or none where none is seeded"
        );

        if let Some(fm) = store.first_of(TargetKind::FileManager) {
            store.remove(&fm.id).unwrap();
        }
        let again = TargetStore::new(dir).unwrap();
        assert!(
            again.first_of(TargetKind::FileManager).is_none(),
            "the file it wrote carries the field, so nothing is put back"
        );
    }

    /// Agents and file managers are the two optional kinds: a linux box
    /// with neither an emulator nor a manager on PATH seeds neither row, so
    /// the rule could only ever bind the platforms that happen to seed one.
    /// Nothing has a dead button either way - the reveal item says what is
    /// missing at the moment it is used.
    #[test]
    fn the_last_file_manager_can_be_removed() {
        let mut s = store("last-fm");
        let Some(fm) = s.first_of(TargetKind::FileManager) else {
            return; // a linux box with none seeded: nothing to remove
        };
        assert_eq!(count_of(&s, TargetKind::FileManager), 1);
        assert!(s.remove(&fm.id).is_ok(), "the last one is the user's call");
        assert_eq!(count_of(&s, TargetKind::FileManager), 0);
    }

    /// A targets.json as every install before psmux wrote it. The other
    /// fields are what a real file carries, so the test proves they survive.
    fn pre_psmux_json(wt_args: &str) -> String {
        format!(
            r#"[
  {{"id":"vscode","name":"VS Code","kind":"editor","executable":"code",
   "args_template":"\"{{path}}\"","wsl_executable":null,
   "wsl_args_template":"--folder-uri vscode-remote://wsl+{{distro}}{{linux_path}}",
   "run_args_template":null,"wsl_run_args_template":null}},
  {{"id":"wt","name":"Windows Terminal","kind":"terminal","executable":"wt",
   "args_template":"{}","wsl_executable":null,
   "wsl_args_template":"wsl -d {{distro}} bash \"{{script}}\"",
   "run_args_template":"-d \"{{path}}\" cmd /k {{command}}",
   "wsl_run_args_template":"wsl -d {{distro}} --cd \"{{linux_path}}\" -e bash -lc \"{{command}}; exec bash\""}}
]"#,
            wt_args.replace('"', "\\\"")
        )
    }

    #[test]
    fn an_install_from_before_psmux_gets_the_session_script_and_a_backup() {
        let dir = std::env::temp_dir().join("devgo-targets-pre-psmux");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let original = pre_psmux_json(WT_ARGS_PRE_PSMUX);
        fs::write(dir.join("targets.json"), &original).unwrap();

        let s = TargetStore::new(dir.clone()).unwrap();
        let wt = s.get("wt").unwrap();
        assert_eq!(wt.args_template, WT_ARGS);
        // the same load adopts the run template too (the tab is the
        // command); the wsl form stays what it was
        assert_eq!(wt.run_args_template.as_deref(), Some(WT_RUN_ARGS));
        assert_eq!(
            wt.wsl_args_template.as_deref(),
            Some("wsl -d {distro} bash \"{script}\"")
        );
        // and the bare semicolon in the wsl run form is escaped
        assert_eq!(wt.wsl_run_args_template.as_deref(), Some(WT_WSL_RUN_ARGS));
        assert!(dir.join("targets.json.pre-wt-semicolon").exists());
        assert_eq!(s.get("vscode").unwrap().name, "VS Code");

        // persisted, not patched in memory
        let reloaded = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(reloaded.get("wt").unwrap().args_template, WT_ARGS);

        // and the file it found is still there, byte for byte
        let backup =
            fs::read_to_string(dir.join("targets.json.pre-psmux")).unwrap();
        assert_eq!(backup, original);
        assert!(
            !dir.join("targets.json.bak").exists(),
            "a migration is not a parse failure"
        );
    }

    /// The bare remote URI is on every install that predates the quotes,
    /// and on every VS Code fork the user added from detection, so the
    /// rewrite goes by template rather than by id.
    #[test]
    fn an_install_with_a_bare_remote_uri_gets_the_quotes_and_a_backup() {
        let dir = std::env::temp_dir().join("devgo-targets-uri-quote");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let original = pre_psmux_json(WT_ARGS_PRE_PSMUX);
        fs::write(dir.join("targets.json"), &original).unwrap();

        let s = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(
            s.get("vscode").unwrap().wsl_args_template.as_deref(),
            Some(VSCODE_WSL_ARGS)
        );
        assert!(dir.join("targets.json.pre-uri-quote").exists());

        // persisted, and a second load has nothing left to adopt
        let reloaded = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(
            reloaded.get("vscode").unwrap().wsl_args_template.as_deref(),
            Some(VSCODE_WSL_ARGS)
        );

        // a fork the user added by hand is the same template, so it moves too
        let mut custom = editor("My Code");
        custom.wsl_args_template = Some(VSCODE_WSL_ARGS_PRE.into());
        let mut s = TargetStore::new(dir.clone()).unwrap();
        s.add(custom).unwrap();
        let s = TargetStore::new(dir).unwrap();
        assert_eq!(
            s.get("my-code").unwrap().wsl_args_template.as_deref(),
            Some(VSCODE_WSL_ARGS)
        );
    }

    /// Matching on the id alone would overwrite a template the user wrote
    /// to "fix" something they never asked about.
    #[test]
    fn a_customised_windows_terminal_template_is_left_alone() {
        let dir = std::env::temp_dir().join("devgo-targets-custom-wt");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let custom = "-d \"{path}\" -p \"Dev\"";
        let original = pre_psmux_json(custom);
        fs::write(dir.join("targets.json"), &original).unwrap();

        let s = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(s.get("wt").unwrap().args_template, custom);
        assert!(
            !dir.join("targets.json.pre-psmux").exists(),
            "the session template did not change, so no psmux backup"
        );
        // the fixture's run template is the exact old default, so that one
        // is adopted with its own backup while the customised session
        // template is left alone: two migrations, two questions
        assert_eq!(
            s.get("wt").unwrap().run_args_template.as_deref(),
            Some(WT_RUN_ARGS)
        );
        assert_eq!(
            fs::read_to_string(dir.join("targets.json.pre-pwsh-run")).unwrap(),
            original,
            "the pre-migration file is kept verbatim"
        );
    }

    /// A targets.json as a linux install from before the seam wrote it: the
    /// editor row, and whichever emulator the box happened to have.
    fn pre_tmux_json(id: &str, args: &str) -> String {
        format!(
            r#"[
  {{"id":"vscode","name":"VS Code","kind":"editor","executable":"code",
   "args_template":"\"{{path}}\"","wsl_executable":null,
   "wsl_args_template":null,"run_args_template":null,
   "wsl_run_args_template":null}},
  {{"id":"{id}","name":"{id}","kind":"terminal","executable":"{id}",
   "args_template":"{}","wsl_executable":null,"wsl_args_template":null,
   "run_args_template":"--working-directory \"{{path}}\" -- bash -lc {{command}}",
   "wsl_run_args_template":null}}
]"#,
            args.replace('"', "\\\"")
        )
    }

    /// The release was named for the tmux session and an upgrading linux
    /// user never saw it: the launcher writes a session script only for a
    /// template asking for one, so every pre-seam row opened a bare shell.
    /// Each emulator lands on the form a fresh install seeds.
    #[test]
    fn an_install_from_before_the_linux_seam_gets_the_session_script() {
        for (id, pre, seam) in LINUX_ARGS_PRE_TMUX {
            let dir = std::env::temp_dir()
                .join(format!("devgo-targets-pre-tmux-{id}"));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            let original = pre_tmux_json(id, pre);
            fs::write(dir.join("targets.json"), &original).unwrap();

            let s = TargetStore::new(dir.clone()).unwrap();
            assert_eq!(s.get(id).unwrap().args_template, *seam, "{id}");
            assert_eq!(s.get("vscode").unwrap().name, "VS Code", "{id}");

            // persisted, and a second load has nothing left to adopt, so
            // the backup is still the file the migration found
            let reloaded = TargetStore::new(dir.clone()).unwrap();
            assert_eq!(reloaded.get(id).unwrap().args_template, *seam, "{id}");
            assert_eq!(
                fs::read_to_string(dir.join("targets.json.pre-linux-tmux"))
                    .unwrap(),
                original,
                "{id}"
            );
            assert!(
                !dir.join("targets.json.bak").exists(),
                "a migration is not a parse failure: {id}"
            );
            let _ = fs::remove_dir_all(&dir);
        }
    }

    /// The other half of the key. A row whose bytes are not the ones the
    /// app wrote is the user's, and an emulator the table never heard of
    /// takes a flag nobody here knows.
    #[test]
    fn a_hand_edited_linux_template_is_left_alone() {
        let dir = std::env::temp_dir().join("devgo-targets-custom-linux");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let custom = "--working-directory \"{path}\" --hide-menubar";
        fs::write(
            dir.join("targets.json"),
            pre_tmux_json("gnome-terminal", custom),
        )
        .unwrap();

        let mut s = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(s.get("gnome-terminal").unwrap().args_template, custom);

        let mut unknown = editor("My Term");
        unknown.args_template = "--working-directory \"{path}\"".into();
        s.add(unknown).unwrap();

        let s = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(
            s.get("my-term").unwrap().args_template,
            "--working-directory \"{path}\"",
            "the same old bytes under an id nobody can write a flag for"
        );
        assert!(!dir.join("targets.json.pre-linux-tmux").exists());
    }

    /// v1.2.0 seeded the seam itself, and a reinstall must not rewrite what
    /// is already right.
    #[test]
    fn a_linux_row_that_already_has_the_seam_is_untouched() {
        let dir = std::env::temp_dir().join("devgo-targets-seam-linux");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let seam = "--workdir \"{path}\" -e bash \"{script}\"";
        fs::write(dir.join("targets.json"), pre_tmux_json("konsole", seam))
            .unwrap();

        let s = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(s.get("konsole").unwrap().args_template, seam);
        assert!(!dir.join("targets.json.pre-linux-tmux").exists());
    }

    /// A targets.json as a linux install from v1.1.0 carries it: the mac
    /// registry, because defaults() was cfg(not(windows)) then. The editor
    /// row is the one linux seeds today, byte for byte — `code "{path}"`,
    /// no wsl forms — so the terminal is the only row that was ever wrong.
    fn mac_seeded_json(args: &str) -> String {
        format!(
            r#"[
  {{"id":"vscode","name":"VS Code","kind":"editor","executable":"code",
   "args_template":"\"{{path}}\"","wsl_executable":null,
   "wsl_args_template":null,"run_args_template":null,
   "wsl_run_args_template":null}},
  {{"id":"terminal","name":"Terminal","kind":"terminal","executable":"open",
   "args_template":"{}","wsl_executable":null,"wsl_args_template":null,
   "run_args_template":"-a Terminal \"{{script}}\"",
   "wsl_run_args_template":null}}
]"#,
            args.replace('"', "\\\"")
        )
    }

    fn emulator(id: &str) -> LaunchTarget {
        LaunchTarget {
            id: id.into(),
            name: id.into(),
            kind: TargetKind::Terminal,
            executable: id.into(),
            args_template: "--workdir \"{path}\" -e bash \"{script}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        }
    }

    /// A store on a fresh directory, with the v1.1.0 mac rows dropped in
    /// behind it. The migration fires inside `new()` on linux only, so the
    /// fixture goes in afterwards and the repair is driven by hand: that
    /// way the seam is exercised on every platform it compiles on, not
    /// only the one it runs on.
    fn mac_seeded_store(name: &str, args: &str) -> (TargetStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("devgo-targets-{name}"));
        let _ = fs::remove_dir_all(&dir);
        let mut s = TargetStore::new(dir.clone()).unwrap();
        s.targets = serde_json::from_str(&mac_seeded_json(args)).unwrap();
        s.save().unwrap();
        (s, dir)
    }

    /// The whole repair: the row a linux box from v1.1.0 cannot launch
    /// becomes the emulator it does have, in the place it already held.
    #[test]
    fn a_mac_seeded_linux_install_gets_the_emulator_this_box_has() {
        let (mut s, dir) = mac_seeded_store("mac-row", MAC_TERMINAL_ARGS);
        let original = fs::read_to_string(dir.join("targets.json")).unwrap();
        let backup = dir.join("targets.json.pre-linux-terminal");

        s.replace_mac_terminal(Some(emulator("konsole"))).unwrap();
        assert!(s.get("terminal").is_none(), "the mac row is gone");
        assert_eq!(s.list()[1].id, "konsole", "and sits where it sat");
        assert_eq!(s.get("vscode").unwrap().name, "VS Code");
        assert_eq!(
            fs::read_to_string(&backup).unwrap(),
            original,
            "the pre-migration file is kept verbatim"
        );
        assert!(
            !dir.join("targets.json.bak").exists(),
            "a migration is not a parse failure"
        );

        // persisted, and a second load has nothing left to adopt, so the
        // backup is still the file the migration found
        let reloaded = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(reloaded.list()[1].id, "konsole");
        assert_eq!(fs::read_to_string(&backup).unwrap(), original);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A box with no emulator at all — a bare CI runner, a headless
    /// server. defaults() gives such a machine no terminal row rather than
    /// one that cannot run, and the repair says the same.
    #[test]
    fn a_box_with_no_emulator_drops_the_mac_row_rather_than_replacing_it() {
        let (mut s, dir) = mac_seeded_store("mac-row-none", MAC_TERMINAL_ARGS);
        s.replace_mac_terminal(None).unwrap();
        assert!(s.get("terminal").is_none());
        assert_eq!(s.list().len(), 1, "the editor row, and nothing invented");
        assert!(dir.join("targets.json.pre-linux-terminal").exists());
        assert_eq!(TargetStore::new(dir.clone()).unwrap().list().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// The emulator this box has can already be in the registry, added by
    /// detection or by hand. Two rows under one id is worse than one.
    #[test]
    fn an_emulator_the_registry_already_lists_is_not_added_twice() {
        let (mut s, dir) = mac_seeded_store("mac-row-dup", MAC_TERMINAL_ARGS);
        s.add(emulator("konsole")).unwrap();
        s.replace_mac_terminal(Some(emulator("konsole"))).unwrap();
        assert!(s.get("terminal").is_none());
        assert_eq!(s.list().iter().filter(|t| t.id == "konsole").count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A user who rewrote the row owns it — iTerm through `open` is a real
    /// thing to want, and it is not the bytes v1.1.0 shipped.
    #[test]
    fn a_hand_edited_mac_terminal_row_is_left_alone() {
        let custom = "-a iTerm \"{script}\"";
        let (mut s, dir) = mac_seeded_store("mac-row-custom", custom);
        s.replace_mac_terminal(Some(emulator("konsole"))).unwrap();
        assert_eq!(s.get("terminal").unwrap().args_template, custom);
        assert!(!dir.join("targets.json.pre-linux-terminal").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// The registration, on the platform that decides it. A mac is
    /// supposed to carry this row, and a windows file carrying it came
    /// from someone else's machine: neither is ours to rewrite.
    #[test]
    fn only_linux_repairs_the_mac_terminal_row_on_load() {
        let dir = std::env::temp_dir().join("devgo-targets-mac-row-load");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let original = mac_seeded_json(MAC_TERMINAL_ARGS);
        fs::write(dir.join("targets.json"), &original).unwrap();

        let s = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(s.get("vscode").unwrap().name, "VS Code");
        #[cfg(target_os = "linux")]
        {
            for t in s.list() {
                assert_ne!(t.executable, "open", "{}", t.id);
            }
            assert_eq!(
                fs::read_to_string(dir.join("targets.json.pre-linux-terminal"))
                    .unwrap(),
                original
            );
        }
        #[cfg(not(target_os = "linux"))]
        {
            assert_eq!(s.get("terminal").unwrap().executable, "open");
            assert!(!dir.join("targets.json.pre-linux-terminal").exists());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// A targets.json as a mac carries it once the user added Ghostty from
    /// detection: the binary inside the bundle, and the arg line of the
    /// day. The run form is the one every ghostty row has shipped with.
    fn mac_ghostty_json(args: &str) -> String {
        format!(
            r#"[
  {{"id":"vscode","name":"VS Code","kind":"editor","executable":"code",
   "args_template":"\"{{path}}\"","wsl_executable":null,
   "wsl_args_template":null,"run_args_template":null,
   "wsl_run_args_template":null}},
  {{"id":"ghostty","name":"Ghostty","kind":"terminal",
   "executable":"/Applications/Ghostty.app/Contents/MacOS/ghostty",
   "args_template":"{}","wsl_executable":null,"wsl_args_template":null,
   "run_args_template":"--working-directory=\"{{path}}\" -e {{command}}",
   "wsl_run_args_template":null}}
]"#,
            args.replace('"', "\\\"")
        )
    }

    // the two arg lines detection has written for a ghostty row: the form
    // v1.1.x shipped, and the one the session script leaves behind
    fn ghostty_args() -> (&'static str, &'static str) {
        let (_, pre, seam) = LINUX_ARGS_PRE_TMUX
            .iter()
            .find(|(id, _, _)| *id == "ghostty")
            .unwrap();
        (pre, seam)
    }

    // what detection gives a ghostty bundle now. spelled out because a
    // windows compiler has no such row to read; the test below holds
    // these bytes against editors' own, where the row exists
    fn open_ghostty() -> LaunchTarget {
        LaunchTarget {
            id: "ghostty".into(),
            name: "Ghostty".into(),
            kind: TargetKind::Terminal,
            executable: "open".into(),
            args_template: "-na \"Ghostty\" --args \
                 --working-directory=\"{path}\" -e bash \"{script}\""
                .into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: Some(
                "-na \"Ghostty\" --args --working-directory=\"{path}\" \
                 -e bash \"{script}\""
                    .into(),
            ),
            wsl_run_args_template: None,
        }
    }

    /// A store on a fresh directory with the mac ghostty rows dropped in
    /// behind it, the shape `mac_seeded_store` uses: the migration fires
    /// inside `new()` on a mac only, so the repair is driven by hand and
    /// the seam is exercised on every platform it compiles on.
    fn mac_ghostty_store(name: &str, args: &str) -> (TargetStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("devgo-targets-{name}"));
        let _ = fs::remove_dir_all(&dir);
        let mut s = TargetStore::new(dir.clone()).unwrap();
        s.targets = serde_json::from_str(&mac_ghostty_json(args)).unwrap();
        s.save().unwrap();
        (s, dir)
    }

    /// The whole repair. A mac that added Ghostty before 5565a4e points at
    /// the binary inside the bundle, which opens a window and drops the
    /// command; our own session-script migration then puts the {script}
    /// seam on it, and shift+enter goes from a bare window to nothing at
    /// all. It lands on the row detection writes today.
    #[test]
    fn a_mac_ghostty_row_written_before_the_open_form_is_repaired() {
        let (mut s, dir) = mac_ghostty_store("ghostty-pre", ghostty_args().0);
        let original = fs::read_to_string(dir.join("targets.json")).unwrap();
        let backup = dir.join("targets.json.pre-mac-ghostty");

        s.replace_bundled_ghostty(Some(open_ghostty())).unwrap();
        let row = s.get("ghostty").unwrap();
        assert_eq!(row.executable, "open");
        assert_eq!(row.args_template, open_ghostty().args_template);
        assert!(row.args_template.contains("{script}"), "or no script runs");
        assert_eq!(
            row.run_args_template.as_deref(),
            open_ghostty().run_args_template.as_deref()
        );
        assert_eq!(s.list()[1].id, "ghostty", "and sits where it sat");
        assert_eq!(s.get("vscode").unwrap().name, "VS Code");
        assert_eq!(
            fs::read_to_string(&backup).unwrap(),
            original,
            "the pre-migration file is kept verbatim"
        );
        assert!(
            !dir.join("targets.json.bak").exists(),
            "a migration is not a parse failure"
        );

        // persisted, and a second load leaves the backup alone
        let reloaded = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(reloaded.get("ghostty").unwrap().executable, "open");
        assert_eq!(fs::read_to_string(&backup).unwrap(), original);

        // the repaired bytes are editors', not a second spelling of them.
        // a windows table has no ghostty row to answer with
        if let Some(t) = crate::services::editors::bundle_target(
            "ghostty",
            Path::new("/Applications/Ghostty.app"),
        ) {
            assert_eq!(t.executable, open_ghostty().executable);
            assert_eq!(t.args_template, open_ghostty().args_template);
            assert_eq!(
                t.run_args_template.as_deref(),
                open_ghostty().run_args_template.as_deref()
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// The order question. `adopt_linux_session_script` recognises the
    /// same row and rewrites its args; run it first and the row carries
    /// the seam instead of the pre-seam bytes. The key takes both, so
    /// neither order can hide the row from the repair.
    #[test]
    fn a_ghostty_row_the_session_script_already_touched_is_still_repaired() {
        let (mut s, dir) = mac_ghostty_store("ghostty-seam", ghostty_args().1);
        s.replace_bundled_ghostty(Some(open_ghostty())).unwrap();
        assert_eq!(s.get("ghostty").unwrap().executable, "open");
        assert!(dir.join("targets.json.pre-mac-ghostty").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// On linux ghostty is the cli on PATH and takes the command exactly
    /// as the row spells it. The executable is half the key for this
    /// reason: nothing outside a mac bundle is ours to rewrite.
    #[test]
    fn a_ghostty_on_path_is_not_a_bundle_row() {
        let (mut s, dir) = mac_ghostty_store("ghostty-path", ghostty_args().1);
        s.targets[1].executable = "ghostty".into();
        s.save().unwrap();

        s.replace_bundled_ghostty(Some(open_ghostty())).unwrap();
        assert_eq!(s.get("ghostty").unwrap().executable, "ghostty");
        assert!(!dir.join("targets.json.pre-mac-ghostty").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// A user who tuned the flags owns the line. Their row still opens a
    /// bare window, which is a thing they can see and report; a migration
    /// guessing at what `--font-size=14` was for is not.
    #[test]
    fn a_hand_edited_ghostty_row_is_left_alone() {
        let custom = "--working-directory=\"{path}\" --font-size=14";
        let (mut s, dir) = mac_ghostty_store("ghostty-custom", custom);
        s.replace_bundled_ghostty(Some(open_ghostty())).unwrap();
        assert_eq!(s.get("ghostty").unwrap().args_template, custom);
        assert!(!dir.join("targets.json.pre-mac-ghostty").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// The registration, on the platform that decides it. Only a mac has
    /// an in-bundle ghostty to repair; the same file on linux or windows
    /// came from someone else's machine.
    #[test]
    fn only_macos_repairs_the_bundled_ghostty_row_on_load() {
        let dir = std::env::temp_dir().join("devgo-targets-ghostty-load");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let original = mac_ghostty_json(ghostty_args().0);
        fs::write(dir.join("targets.json"), &original).unwrap();

        let s = TargetStore::new(dir.clone()).unwrap();
        let row = s.get("ghostty").unwrap();
        assert_eq!(s.get("vscode").unwrap().name, "VS Code");
        let backup = dir.join("targets.json.pre-mac-ghostty");
        #[cfg(target_os = "macos")]
        {
            assert_eq!(row.executable, "open");
            assert_eq!(row.args_template, open_ghostty().args_template);
            assert_eq!(fs::read_to_string(&backup).unwrap(), original);
        }
        #[cfg(not(target_os = "macos"))]
        {
            assert!(row.executable.ends_with("Contents/MacOS/ghostty"));
            assert!(!backup.exists());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// A .pre-psmux of a file seeded a millisecond ago would be noise that
    /// makes the real backups harder to trust.
    #[test]
    fn a_fresh_install_needs_no_migration_and_gets_no_backup() {
        let dir = std::env::temp_dir().join("devgo-targets-fresh-psmux");
        let _ = fs::remove_dir_all(&dir);
        let s = TargetStore::new(dir.clone()).unwrap();
        // the seeded terminal is wt on windows and terminal.app on a mac;
        // the migration is a windows story, so only there is psmux checked
        #[cfg(windows)]
        assert_eq!(s.get("wt").unwrap().args_template, WT_ARGS);
        #[cfg(target_os = "macos")]
        assert_eq!(
            s.get("terminal").unwrap().args_template,
            crate::models::target::MAC_TERMINAL_ARGS
        );
        // linux seeds whichever emulator the box has, or none - but it must
        // never seed the mac one. it did until 2026-09-23: defaults() was
        // cfg(not(windows)), so a linux install got `open -a Terminal`, and
        // the terminal key failed silently because `open` on linux is
        // xdg-open and rejects -a. this is that regression, pinned.
        #[cfg(target_os = "linux")]
        for t in s.list() {
            assert_ne!(
                t.executable, "open",
                "linux seeded the mac terminal: {}",
                t.id
            );
        }
        assert!(!dir.join("targets.json.pre-psmux").exists());
        assert!(!dir.join("targets.json.pre-uri-quote").exists());
        assert!(!dir.join("targets.json.pre-linux-tmux").exists());
        assert!(!dir.join("targets.json.pre-linux-terminal").exists());
        assert!(!dir.join("targets.json.pre-mac-ghostty").exists());
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
