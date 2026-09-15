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
