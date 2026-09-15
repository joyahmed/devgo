use std::fs;
use std::path::PathBuf;

use crate::error::AppError;
use crate::models::target::{
    defaults, LaunchTarget, TargetKind, WT_ARGS, WT_ARGS_PRE_PSMUX,
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
        // everything that was not the one field stays what it was
        assert_eq!(
            wt.run_args_template.as_deref(),
            Some("-d \"{path}\" cmd /k {command}")
        );
        assert_eq!(
            wt.wsl_args_template.as_deref(),
            Some("wsl -d {distro} bash \"{script}\"")
        );
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
        assert!(!dir.join("targets.json.pre-psmux").exists());
        assert_eq!(
            fs::read_to_string(dir.join("targets.json")).unwrap(),
            original,
            "an untouched store is not rewritten"
        );
    }

    /// A .pre-psmux of a file seeded a millisecond ago would be noise that
    /// makes the real backups harder to trust.
    #[test]
    fn a_fresh_install_needs_no_migration_and_gets_no_backup() {
        let dir = std::env::temp_dir().join("devgo-targets-fresh-psmux");
        let _ = fs::remove_dir_all(&dir);
        let s = TargetStore::new(dir.clone()).unwrap();
        assert_eq!(s.get("wt").unwrap().args_template, WT_ARGS);
        assert!(!dir.join("targets.json.pre-psmux").exists());
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
