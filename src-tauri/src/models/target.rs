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
    /// A coding agent CLI, run in the default terminal in the project
    /// directory. An agent is a command, not a program with a directory
    /// flag: `executable` is the Windows command (empty when the agent
    /// lives only in a distro), `wsl_executable` the in-distro one (None
    /// when Windows only); the terminal's run template does the launching
    /// and the args templates stay empty.
    Agent,
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
            // empty means no windows form at all: a linux-only editor
            (false, None) => {
                Some(&self.args_template).filter(|t| !t.is_empty())?
            }
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

/// Windows Terminal's arguments for a Windows project. {script} is the
/// seam the WSL form already uses: the launcher writes a PowerShell script
/// that brings the project's psmux session up. -NoExit because the script
/// ends in attach, and when that returns the tab has to stay open in the
/// project rather than vanish. -ExecutionPolicy Bypass because a script in
/// %TEMP% is exactly what a RemoteSigned machine refuses to run. pwsh, not
/// powershell: 5.1 reads a file without a BOM as ANSI, so a window name
/// outside ASCII arrives garbled and is created again on every launch.
/// A const because editors::detect has to offer the same bytes.
pub const WT_ARGS: &str =
    "-d \"{path}\" pwsh -NoExit -ExecutionPolicy Bypass -File \"{script}\"";

/// What wt opened a Windows project with before psmux: the directory and
/// nothing else. Kept so the store can tell the default nobody touched
/// from a template the user wrote, and migrate only the first.
pub const WT_ARGS_PRE_PSMUX: &str = "-d \"{path}\"";

/// The run template wt opens a command with: a dev script, an agent, a
/// server. The command IS the tab, no cmd /k around it, so it runs in the
/// default profile's own appearance and follows wt's closeOnExit when it
/// ends. WT_RUN_ARGS_PRE is the cmd /k form every earlier install carries;
/// the store rewrites it once, with a backup.
pub const WT_RUN_ARGS: &str = "-d \"{path}\" {command}";
pub const WT_RUN_ARGS_PRE: &str = "-d \"{path}\" cmd /k {command}";
/// The WSL run line under wt. A backslash before the semicolon, not a bare
/// one: Windows Terminal splits its own command line on `;`, even inside
/// quotes, into a second tab, so `"{command}; exec bash"` opened one tab
/// running the command and one failing on `" exec bash"`. wt turns the
/// escaped form back into `;` before the line reaches wsl, so bash sees the
/// two commands as before. Other terminals do no such splitting.
pub const WT_WSL_RUN_ARGS: &str =
    "wsl -d {distro} --cd \"{linux_path}\" -e bash -lc \"{command}\\; exec bash\"";
pub const WT_WSL_RUN_ARGS_PRE: &str =
    "wsl -d {distro} --cd \"{linux_path}\" -e bash -lc \"{command}; exec bash\"";

/// Terminal.app's arguments for a local project on a Mac. `open -a Terminal
/// <file>` is the only way to hand Terminal.app a command from outside: it
/// opens a window and runs the file, so the file is the command and
/// {script} is the same seam the two other forms use. No {path} in the
/// line: the script cds itself. The run form is the same bytes because
/// Terminal.app cannot take a command on its command line at all; {command}
/// goes into a second file. Every reader is cfg(not(windows)); on Windows
/// the constants compile and are never read. A const because editors must
/// offer the same bytes.
#[cfg_attr(windows, allow(dead_code))]
pub const MAC_TERMINAL_ARGS: &str = "-a Terminal \"{script}\"";
#[cfg_attr(windows, allow(dead_code))]
pub const MAC_TERMINAL_RUN_ARGS: &str = "-a Terminal \"{script}\"";

/// The registry every install starts with.
///
/// VS Code and Windows Terminal only, because those are the two DevGo already
/// hardcoded — seeding more would be guessing at what is installed, and an
/// entry that fails to launch is worse than one the user added deliberately.
#[cfg(windows)]
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
            args_template: WT_ARGS.into(),
            wsl_executable: None,
            wsl_args_template: Some("wsl -d {distro} bash \"{script}\"".into()),
            run_args_template: Some(WT_RUN_ARGS.into()),
            wsl_run_args_template: Some(WT_WSL_RUN_ARGS.into()),
        },
    ]
}

/// The registry a Mac install starts with: VS Code and Terminal.app, the
/// two every Mac with a developer on it has. Same policy as Windows: seed
/// what is certainly there, detect the rest. No WSL forms, and the ids are
/// the platform's own (`terminal`, not `wt`), so a prefs file carried
/// across machines names a target that exists.
/// ⚠️ macOS only. Its terminal row is `open -a Terminal`, a mac command -
/// this used to be `cfg(not(windows))`, so a LINUX install was seeded with
/// the mac registry and its terminal key silently ran `open -a Terminal`
/// (on Ubuntu `open` is xdg-open via alternatives, which rejects `-a`).
/// Detection was never the problem: Terminal.app has no `exe` and is found
/// through app_bundle(), which looks under /Applications and correctly
/// finds nothing on Linux. The registry seed was the whole bug.
#[cfg(target_os = "macos")]
pub fn defaults() -> Vec<LaunchTarget> {
    vec![
        LaunchTarget {
            id: "vscode".into(),
            name: "VS Code".into(),
            kind: TargetKind::Editor,
            executable: "code".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
            // an editor is not a place to run a dev command
            run_args_template: None,
            wsl_run_args_template: None,
        },
        LaunchTarget {
            id: "terminal".into(),
            name: "Terminal".into(),
            kind: TargetKind::Terminal,
            executable: "open".into(),
            args_template: MAC_TERMINAL_ARGS.into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: Some(MAC_TERMINAL_RUN_ARGS.into()),
            wsl_run_args_template: None,
        },
    ]
}

/// Linux: the editor row is the same, and the terminal is whichever
/// emulator this box actually has - see editors::first_terminal. A machine
/// with none gets no terminal row rather than one that cannot run.
#[cfg(target_os = "linux")]
pub fn defaults() -> Vec<LaunchTarget> {
	let mut out = vec![LaunchTarget {
		id: "vscode".into(),
		name: "VS Code".into(),
		kind: TargetKind::Editor,
		executable: "code".into(),
		args_template: "\"{path}\"".into(),
		wsl_executable: None,
		wsl_args_template: None,
		run_args_template: None,
		wsl_run_args_template: None,
	}];
	if let Some(t) = crate::services::editors::first_terminal() {
		out.push(t);
	}
	out
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

    // the seeded vs code on a mac has no wsl form at all
    #[cfg(windows)]
    #[test]
    fn wsl_projects_use_the_remote_uri() {
        let (exe, args) = vscode()
            .resolve(
                r"\\wsl.localhost\Ubuntu\home\user\app",
                Some(("Ubuntu", "/home/user/app")),
            )
            .unwrap();
        assert_eq!(exe, "code");
        assert_eq!(
            args,
            "--folder-uri vscode-remote://wsl+Ubuntu/home/user/app"
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

    /// A Windows project used to get a plain tab while the same launch on a
    /// WSL project got named windows; the seam only closes that gap if the
    /// Windows template asks for it too. resolve must leave the placeholder
    /// alone, because only the launcher can write the file.
    #[cfg(windows)]
    #[test]
    fn the_seeded_terminal_asks_for_a_session_script_on_both_filesystems() {
        let wt = defaults().into_iter().find(|t| t.id == "wt").unwrap();
        let (exe, args) = wt.resolve(r"G:\dev\app", None).unwrap();
        assert_eq!(exe, "wt");
        assert_eq!(
            args,
            r#"-d "G:\dev\app" pwsh -NoExit -ExecutionPolicy Bypass -File "{script}""#
        );
        let (_, wsl_args) = wt
            .resolve(
                r"\\wsl.localhost\Ubuntu\home\user\app",
                Some(("Ubuntu", "/home/user/app")),
            )
            .unwrap();
        assert!(wsl_args.contains("{script}"), "{wsl_args}");
        // the run form is a command in a tab and stays what it was
        let (_, run) = wt.resolve_run(r"G:\dev\app", None, "bun dev").unwrap();
        assert_eq!(run, r#"-d "G:\dev\app" bun dev"#);
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

    /// The other way round: a Linux binary cannot take a Windows path, and
    /// an empty Windows template says so.
    #[test]
    fn wsl_only_targets_refuse_windows_projects() {
        let nvim = LaunchTarget {
            id: "nvim".into(),
            name: "Neovim".into(),
            kind: TargetKind::Editor,
            executable: "wsl".into(),
            args_template: String::new(),
            wsl_executable: Some("wsl".into()),
            wsl_args_template: Some(
                "-d {distro} --cd \"{linux_path}\" -e nvim .".into(),
            ),
            run_args_template: None,
            wsl_run_args_template: None,
        };
        assert!(nvim.resolve(r"G:\dev", None).is_none());
        assert!(nvim.resolve("x", Some(("Ubuntu", "/home"))).is_some());
    }

    #[cfg(windows)]
    #[test]
    fn run_templates_substitute_the_command() {
        let wt = defaults().into_iter().nth(1).unwrap();
        let (exe, args) =
            wt.resolve_run(r"G:\dev\app", None, "bun run dev").unwrap();
        assert_eq!(exe, "wt");
        assert_eq!(args, r#"-d "G:\dev\app" bun run dev"#);

        let (_, args) = wt
            .resolve_run("x", Some(("Ubuntu", "/home/user/app")), "bun run dev")
            .unwrap();
        assert!(args.contains(r#"--cd "/home/user/app""#));
        assert!(args.ends_with("\"bun run dev\\; exec bash\""), "{args}");
    }

    /// An editor has no run form; asking is a refusal, not a plain open.
    #[test]
    fn a_target_without_a_run_template_refuses_commands() {
        assert!(vscode().resolve_run("x", None, "bun run dev").is_none());
        assert!(vscode().resolve("x", None).is_some());
    }

    // the mac twin of the seeded-terminal test. terminal.app has no -d and
    // no way to take a command, so both forms go through {script} and
    // neither mentions {path} or {command}; the launcher's files carry those
    #[cfg(not(windows))]
	#[cfg(target_os = "macos")]
    #[test]
    fn the_mac_defaults_open_terminal_through_a_script() {
        let seeded = defaults();
        assert_eq!(seeded.len(), 2, "vs code and terminal, nothing guessed");
        for t in &seeded {
            assert!(t.wsl_args_template.is_none(), "no wsl on a mac: {}", t.id);
            assert!(t.wsl_run_args_template.is_none(), "{}", t.id);
            assert!(
                t.resolve(
                    "/Users/user/app",
                    Some(("Ubuntu", "/home/user/app"))
                )
                .is_none(),
                "a mac target refuses a wsl project rather than guessing: {}",
                t.id
            );
        }

        let (exe, args) = vscode().resolve("/Users/user/app", None).unwrap();
        assert_eq!(exe, "code");
        assert_eq!(args, r#""/Users/user/app""#);

        let terminal = seeded.iter().find(|t| t.id == "terminal").unwrap();
        let (exe, args) = terminal.resolve("/Users/user/app", None).unwrap();
        assert_eq!(exe, "open");
        assert_eq!(args, r#"-a Terminal "{script}""#);
        assert_eq!(args, MAC_TERMINAL_ARGS);

        let (_, run) = terminal
            .resolve_run("/Users/user/app", None, "bun dev")
            .unwrap();
        assert_eq!(run, MAC_TERMINAL_RUN_ARGS);
        assert!(run.contains("{script}"), "the command rides in the file");
        assert!(!run.contains("bun dev"), "not on terminal's command line");
    }
}
