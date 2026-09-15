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
    /// Arguments for running a command in a Windows project. `{command}` is
    /// substituted alongside `{path}`. `None` means this target cannot run
    /// commands: the flags differ per terminal and guessing opens the wrong
    /// thing.
    #[serde(default)]
    pub run_args_template: Option<String>,
    /// The same for a WSL project.
    #[serde(default)]
    pub wsl_run_args_template: Option<String>,
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
    /// Returns `None` when the target has no template for the situation: no
    /// WSL form for a WSL project, or no run form when a command was asked
    /// for. The caller reports that rather than opening the wrong directory,
    /// or the right one with the command quietly dropped.
    pub fn resolve(
        &self,
        windows_path: &str,
        wsl: Option<(&str, &str)>,
    ) -> Option<(String, String)> {
        self.resolve_inner(windows_path, wsl, None)
    }

    pub fn resolve_run(
        &self,
        windows_path: &str,
        wsl: Option<(&str, &str)>,
        command: &str,
    ) -> Option<(String, String)> {
        self.resolve_inner(windows_path, wsl, Some(command))
    }

    fn resolve_inner(
        &self,
        windows_path: &str,
        wsl: Option<(&str, &str)>,
        command: Option<&str>,
    ) -> Option<(String, String)> {
        let template = match (wsl.is_some(), command) {
            (true, None) => self.wsl_args_template.as_ref()?,
            (true, Some(_)) => self.wsl_run_args_template.as_ref()?,
            (false, None) => &self.args_template,
            (false, Some(_)) => self.run_args_template.as_ref()?,
        };

        let exe = match wsl {
            Some(_) => self
                .wsl_executable
                .clone()
                .unwrap_or_else(|| self.executable.clone()),
            None => self.executable.clone(),
        };

        let mut args = template.replace("{path}", windows_path);
        if let Some((distro, linux_path)) = wsl {
            args = args
                .replace("{distro}", distro)
                .replace("{linux_path}", linux_path);
        }
        if let Some(cmd) = command {
            args = args.replace("{command}", cmd);
        }
        Some((exe, args))
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
            // an editor is not a place to run a dev command
            run_args_template: None,
            wsl_run_args_template: None,
        },
        LaunchTarget {
            id: "wt".into(),
            name: "Windows Terminal".into(),
            kind: TargetKind::Terminal,
            executable: "wt".into(),
            args_template: "-d \"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: Some("wsl -d {distro} bash \"{script}\"".into()),
            // cmd /k keeps the window open, so a failing script leaves its
            // error on screen
            run_args_template: Some("-d \"{path}\" cmd /k {command}".into()),
            wsl_run_args_template: Some(
                "wsl -d {distro} --cd \"{linux_path}\" -e bash -lc \"{command}; exec bash\"".into(),
            ),
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
            run_args_template: None,
            wsl_run_args_template: None,
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
            run_args_template: None,
            wsl_run_args_template: None,
        };
        assert!(notepad.resolve("x", Some(("Ubuntu", "/home"))).is_none());
        assert!(notepad.resolve("x", None).is_some());
    }

    #[test]
    fn run_templates_substitute_the_command() {
        let wt = defaults().into_iter().nth(1).unwrap();
        let (exe, args) =
            wt.resolve_run(r"G:\dev\app", None, "bun run dev").unwrap();
        assert_eq!(exe, "wt");
        assert_eq!(args, r#"-d "G:\dev\app" cmd /k bun run dev"#);

        let (_, args) = wt
            .resolve_run("x", Some(("Ubuntu", "/home/joy/app")), "bun run dev")
            .unwrap();
        assert!(args.contains(r#"--cd "/home/joy/app""#));
        assert!(args.ends_with(r#""bun run dev; exec bash""#));
    }

    /// An editor has no run form; asking is a refusal, not a plain open.
    #[test]
    fn a_target_without_a_run_template_refuses_commands() {
        assert!(vscode().resolve_run("x", None, "bun run dev").is_none());
        assert!(vscode().resolve("x", None).is_some());
    }
}
