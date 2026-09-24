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
    /// Arguments for showing a path with the item itself selected inside
    /// its parent: Explorer's folder, Finder's -R. The reveal mode is to a
    /// file manager what the run mode is to a terminal — one target, two
    /// invocations — so it gets its own template rather than a second
    /// target. `None` means this target has no way to select an item, which
    /// is every Linux file manager, and the caller opens the parent folder.
    #[serde(default)]
    pub reveal_args_template: Option<String>,
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
    /// A file manager, opened at a folder. `args_template` opens the folder
    /// itself and `reveal_args_template` selects it inside its parent; the
    /// second is what "reveal" means, the first is what the app-data door
    /// wants.
    FileManager,
}

impl TargetKind {
    /// Every kind, so the places that must cover all of them — the default
    /// map, a portable config — cannot quietly miss one.
    pub const ALL: [Self; 4] =
        [Self::Editor, Self::Terminal, Self::Agent, Self::FileManager];

    /// The name this kind travels under: the frontend's union, the key in
    /// the default-target map, the field in a portable config. Not
    /// `format!("{self:?}").to_lowercase()`, which the default map used to
    /// build: serde renames to snake_case, so that spells FileManager
    /// "filemanager" while the frontend says "file_manager", the lookup
    /// misses, the "default" badge never appears and nothing errors. It was
    /// right only while every variant was one word.
    pub fn wire(self) -> &'static str {
        match self {
            Self::Editor => "editor",
            Self::Terminal => "terminal",
            Self::Agent => "agent",
            Self::FileManager => "file_manager",
        }
    }
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

    /// Resolve the reveal form: the item selected inside its parent.
    ///
    /// No WSL pair, unlike the two above: a WSL project is revealed through
    /// its UNC path, which is already the Windows path the template takes.
    /// `None` when the target has no selecting verb, and the caller opens
    /// the parent folder instead of pretending it selected something.
    pub fn resolve_reveal(&self, path: &str) -> Option<(String, String)> {
        let template = self
            .reveal_args_template
            .as_deref()
            .filter(|t| !t.is_empty())?;
        Some((self.executable.clone(), template.replace("{path}", path)))
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

/// VS Code's WSL form: the remote URI, in quotes. Unquoted it was three
/// arguments for `/home/joy/my project` — the shell that splits the line
/// cut the URI at the space, VS Code opened `/home/joy/my` and treated
/// `project` as a file, and nothing said so. VSCODE_WSL_ARGS_PRE is the
/// bare form every earlier install carries; the store rewrites it once,
/// with a backup. A const because editors::detect offers the same bytes to
/// every VS Code fork.
pub const VSCODE_WSL_ARGS: &str =
    "--folder-uri \"vscode-remote://wsl+{distro}{linux_path}\"";
pub const VSCODE_WSL_ARGS_PRE: &str =
    "--folder-uri vscode-remote://wsl+{distro}{linux_path}";

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
/// goes into a second file. A const because editors must offer the same
/// bytes — and because the store reads them on every platform to spot the
/// row a linux install from v1.1.0 was wrongly seeded with.
pub const MAC_TERMINAL_ARGS: &str = "-a Terminal \"{script}\"";
pub const MAC_TERMINAL_RUN_ARGS: &str = "-a Terminal \"{script}\"";

/// Every terminal row as v1.1.0 and v1.1.1 shipped it, next to the form
/// that carries the session script. The launcher only writes a script for
/// a template asking for one, so an install from before the seam opened a
/// bare shell in the right directory and said nothing — the upgrade, not
/// the install, is what withheld the tmux session. The id is half the key
/// because five of these shipped the same old bytes and each takes its own
/// flag for the command; the other half is the old bytes themselves, so a
/// template the user wrote is left alone. Ghostty, WezTerm, Kitty and
/// Alacritty are a mac's rows too, and reach the same seam here.
pub const LINUX_ARGS_PRE_TMUX: &[(&str, &str, &str)] = &[
    (
        "ghostty",
        "--working-directory=\"{path}\"",
        "--working-directory=\"{path}\" -e bash \"{script}\"",
    ),
    (
        "wezterm",
        "start --cwd \"{path}\"",
        "start --cwd \"{path}\" -- bash \"{script}\"",
    ),
    (
        "kitty",
        "--directory \"{path}\"",
        "--directory \"{path}\" bash \"{script}\"",
    ),
    (
        "alacritty",
        "--working-directory \"{path}\"",
        "--working-directory \"{path}\" -e bash \"{script}\"",
    ),
    (
        "gnome-terminal",
        "--working-directory \"{path}\"",
        "--working-directory \"{path}\" -- bash \"{script}\"",
    ),
    (
        "konsole",
        "--workdir \"{path}\"",
        "--workdir \"{path}\" -e bash \"{script}\"",
    ),
    (
        "xfce4-terminal",
        "--working-directory=\"{path}\"",
        "--working-directory=\"{path}\" -x bash \"{script}\"",
    ),
    (
        "tilix",
        "--working-directory=\"{path}\"",
        "--working-directory=\"{path}\" -e bash \"{script}\"",
    ),
    (
        "foot",
        "--working-directory=\"{path}\"",
        "--working-directory=\"{path}\" bash \"{script}\"",
    ),
    (
        "terminator",
        "--working-directory=\"{path}\"",
        "--working-directory=\"{path}\" -x bash \"{script}\"",
    ),
    (
        "xterm",
        "-e bash -lc 'cd \"{path}\" && exec bash -l'",
        "-e bash \"{script}\"",
    ),
];

/// The registry every install starts with.
///
/// VS Code, Windows Terminal and Explorer, because those three are the ones
/// DevGo already hardcoded — seeding more would be guessing at what is
/// installed, and an entry that fails to launch is worse than one the user
/// added deliberately.
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
            wsl_args_template: Some(VSCODE_WSL_ARGS.into()),
            // an editor is not a place to run a dev command
            run_args_template: None,
            reveal_args_template: None,
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
            reveal_args_template: None,
            wsl_run_args_template: Some(WT_WSL_RUN_ARGS.into()),
        },
        LaunchTarget {
            id: "explorer".into(),
            name: "File Explorer".into(),
            kind: TargetKind::FileManager,
            executable: "explorer".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: None,
            // a WSL project is revealed through its UNC path, which is
            // already {path}
            wsl_args_template: None,
            run_args_template: None,
            // the folder itself, not /select: the switch exists, but the
            // UNC path of a WSL project does not survive it, and those are
            // half of what DevGo reveals
            reveal_args_template: Some("\"{path}\"".into()),
            wsl_run_args_template: None,
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
            reveal_args_template: None,
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
            reveal_args_template: None,
            wsl_run_args_template: None,
        },
        LaunchTarget {
            id: "finder".into(),
            name: "Finder".into(),
            kind: TargetKind::FileManager,
            // no cli of its own, like Terminal.app: the door is open, and
            // -a names the app so the row does what it says rather than
            // whatever the desktop has registered for a folder
            executable: "open".into(),
            args_template: "-a Finder \"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            // -R: the parent window with the folder highlighted, the one
            // reveal verb a file manager on any platform here really has
            reveal_args_template: Some("-R \"{path}\"".into()),
            wsl_run_args_template: None,
        },
    ]
}

/// Linux: the editor row is the same, and the terminal and the file
/// manager are whichever ones this box actually has - see
/// editors::first_terminal and editors::first_file_manager. A machine with
/// none gets no row rather than one that cannot run.
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
        reveal_args_template: None,
        wsl_run_args_template: None,
    }];
    if let Some(t) = crate::services::editors::first_terminal() {
        out.push(t);
    }
    if let Some(f) = crate::services::editors::first_file_manager() {
        out.push(f);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vscode() -> LaunchTarget {
        defaults().into_iter().next().unwrap()
    }

    /// The key the default-target map is built with, and the string the
    /// frontend's own union carries. `format!("{k:?}").to_lowercase()` built
    /// that key and agreed with serde only while every variant was one word:
    /// it spells FileManager "filemanager", the frontend says
    /// "file_manager", the lookup misses, the "default" badge never appears
    /// and nothing anywhere errors. Pinned in both directions so the next
    /// two-word kind cannot repeat it.
    #[test]
    fn every_kinds_wire_name_is_the_one_serde_writes() {
        for kind in TargetKind::ALL {
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, format!("\"{}\"", kind.wire()), "{kind:?}");
            let back: TargetKind = serde_json::from_str(&json).unwrap();
            assert_eq!(back, kind, "{kind:?}");
        }
        assert_eq!(TargetKind::FileManager.wire(), "file_manager");
        assert_ne!(
            TargetKind::FileManager.wire(),
            format!("{:?}", TargetKind::FileManager).to_lowercase(),
            "the debug spelling is the trap, not the wire name"
        );
    }

    /// Reveal has no hardcoded program left, so the kind has to be seeded or
    /// the menu item does nothing: one row on windows and a mac, and on
    /// linux whichever manager the box has - none is honest there, the same
    /// as its terminal row. That row must never be `open`: on linux `open`
    /// is xdg-open, which rejects the mac's -R, and seeding the mac registry
    /// on linux is exactly how the terminal key was silently dead once.
    #[test]
    fn a_file_manager_is_seeded_and_is_never_the_mac_door_on_linux() {
        let seeded = defaults();
        let managers: Vec<&LaunchTarget> = seeded
            .iter()
            .filter(|t| t.kind == TargetKind::FileManager)
            .collect();
        #[cfg(not(target_os = "linux"))]
        assert_eq!(managers.len(), 1, "one manager, not a guess at more");
        #[cfg(target_os = "linux")]
        assert!(managers.len() <= 1, "a box with none gets none");

        for m in &managers {
            // the folder form is what the app-data door uses and it always
            // exists; a file manager has no wsl half of its own - a wsl
            // project is revealed through its UNC path
            let (exe, args) = m.resolve("/srv/work/app", None).unwrap();
            assert!(!exe.is_empty(), "{}", m.id);
            assert!(args.contains("\"/srv/work/app\""), "quoted: {args}");
            assert!(!args.contains("{path}"), "filled: {args}");
            assert!(m.wsl_args_template.is_none(), "{}", m.id);
            assert!(m.run_args_template.is_none(), "not a terminal: {}", m.id);

            #[cfg(target_os = "linux")]
            {
                assert_ne!(m.executable, "open", "the mac door: {}", m.id);
                assert!(
                    m.resolve_reveal("/srv/work/app").is_none(),
                    "nothing on linux selects an item: {}",
                    m.id
                );
            }
            #[cfg(not(target_os = "linux"))]
            {
                let (_, args) = m.resolve_reveal("/srv/work/app").unwrap();
                assert!(args.contains("/srv/work/app"), "{args}");
                assert!(!args.contains("{path}"), "the path is filled: {args}");
            }
        }
    }

    /// The reveal form is the file manager's second invocation, the way the
    /// run form is a terminal's: same target, same executable, other
    /// template. A row without one refuses, and the caller opens the parent
    /// rather than pretending it selected something.
    #[test]
    fn the_reveal_template_is_a_second_form_of_the_same_target() {
        let mut trove = LaunchTarget {
            id: "trove".into(),
            name: "Trove".into(),
            kind: TargetKind::FileManager,
            executable: r"C:\Program Files\Trove\trove.exe".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: Some("--select \"{path}\"".into()),
            wsl_run_args_template: None,
        };
        let (exe, args) = trove.resolve_reveal(r"G:\01_tauri\my app").unwrap();
        assert_eq!(exe, r"C:\Program Files\Trove\trove.exe");
        assert_eq!(args, "--select \"G:\\01_tauri\\my app\"");
        // and the folder form is untouched by it
        assert_eq!(
            trove.resolve(r"G:\01_tauri\my app", None).unwrap().1,
            "\"G:\\01_tauri\\my app\""
        );

        trove.reveal_args_template = None;
        assert!(trove.resolve_reveal("x").is_none());
        // an empty string is what the Add form sends for a blank field, and
        // it means the same as None rather than `trove ` with no path
        trove.reveal_args_template = Some(String::new());
        assert!(trove.resolve_reveal("x").is_none());
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
            "--folder-uri \"vscode-remote://wsl+Ubuntu/home/user/app\""
        );
    }

    /// `G:\01_tauri\my project\app` is an ordinary directory, and the line a
    /// template resolves to is split by a real shell. The space survives
    /// only because the quotes round {path} do.
    #[test]
    fn a_project_path_with_a_space_stays_one_quoted_argument() {
        let (_, args) = vscode().resolve("/home/joy/my project", None).unwrap();
        assert_eq!(args, "\"/home/joy/my project\"");
        let (_, args) = vscode()
            .resolve(r"G:\01_tauri\my project\app", None)
            .unwrap();
        assert_eq!(args, "\"G:\\01_tauri\\my project\\app\"");
    }

    /// The same on the WSL side, where the remote URI carries the path with
    /// no separator in front of it: bare, `/home/joy/my project` made
    /// `--folder-uri`, `…wsl+Ubuntu/home/joy/my` and `project` — three
    /// arguments, the wrong directory, and no error anywhere.
    #[cfg(windows)]
    #[test]
    fn a_wsl_path_with_a_space_stays_one_quoted_argument() {
        let (_, args) = vscode()
            .resolve("x", Some(("Ubuntu", "/home/joy/my project")))
            .unwrap();
        assert_eq!(
            args,
            "--folder-uri \"vscode-remote://wsl+Ubuntu/home/joy/my project\""
        );

        let wt = defaults().into_iter().find(|t| t.id == "wt").unwrap();
        let (_, run) = wt
            .resolve_run(
                "x",
                Some(("Ubuntu", "/home/joy/my project")),
                "bun dev",
            )
            .unwrap();
        assert!(run.contains("--cd \"/home/joy/my project\""), "{run}");
    }

    /// `&`, an apostrophe and a parenthesis are legal in a directory name on
    /// every platform, and each of them ends a word for one shell or
    /// another. Inside the template's quotes none of them does.
    #[test]
    fn a_path_with_shell_punctuation_stays_inside_the_quotes() {
        let hostile = "/home/joy/rnd (a & b)'s";
        let (_, args) = vscode().resolve(hostile, None).unwrap();
        assert_eq!(args, format!("\"{hostile}\""));
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
            reveal_args_template: None,
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
            reveal_args_template: None,
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
            reveal_args_template: None,
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

    /// The linux twin: the seed is whichever emulator the box has, and it
    /// has to carry the session seam. Without it launch_target writes no
    /// script, and a fresh install gets the bare shell this work removed -
    /// on the one platform where tmux is a package away.
    #[cfg(target_os = "linux")]
    #[test]
    fn the_seeded_linux_terminal_asks_for_a_session_script() {
        let seeded = defaults();
        assert_eq!(seeded[0].id, "vscode", "the editor is seeded first");
        for t in seeded.iter().filter(|t| t.kind == TargetKind::Terminal) {
            assert!(t.args_template.contains("{script}"), "{}", t.id);
            assert!(t.wsl_args_template.is_none(), "no wsl here: {}", t.id);
            assert_ne!(t.executable, "open", "the mac door: {}", t.id);
            // xterm is the one row with no directory flag; the script cds
            let (_, args) = t.resolve("/home/user/app", None).unwrap();
            assert!(!args.contains("{path}"), "the path is filled: {args}");
            assert!(args.contains("{script}"), "the launcher fills: {args}");
        }
    }

    // the mac twin of the seeded-terminal test. terminal.app has no -d and
    // no way to take a command, so both forms go through {script} and
    // neither mentions {path} or {command}; the launcher's files carry those
    #[cfg(not(windows))]
    #[cfg(target_os = "macos")]
    #[test]
    fn the_mac_defaults_open_terminal_through_a_script() {
        let seeded = defaults();
        assert_eq!(
            seeded.len(),
            3,
            "vs code, terminal and finder, nothing guessed"
        );
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
