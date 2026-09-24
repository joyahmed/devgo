use std::fs;
use std::path::PathBuf;

use crate::error::AppError;
use crate::models::target::{
    defaults, LaunchTarget, TargetKind, VSCODE_WSL_ARGS, VSCODE_WSL_ARGS_PRE,
    WT_ARGS, WT_ARGS_PRE_PSMUX, WT_RUN_ARGS, WT_RUN_ARGS_PRE, WT_WSL_RUN_ARGS,
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
        let targets: Vec<LaunchTarget> = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
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
        Ok(store)
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
        // zero agents is a valid machine; zero editors or terminals is a
        // launcher with a button that can never do anything
        if kind != TargetKind::Agent
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
