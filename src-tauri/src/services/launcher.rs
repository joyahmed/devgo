use std::process::Command;

use super::platform::Quiet;
use super::platform::RuntimeInfo;
use super::preferences::TmuxConfig;
use crate::error::AppError;
use crate::models::target::LaunchTarget;
use crate::models::Project;

fn is_wsl(project: &Project) -> bool {
    let normalized = project.full_path.replace('\\', "/");
    normalized.starts_with("//wsl.localhost/")
        || normalized.starts_with("//wsl$/")
}

/// Resolve which distro a project belongs to.
///
/// A WSL-native path names its own distro, so prefer that. Otherwise fall back
/// to the detected default. There is deliberately no hardcoded distro name —
/// "Ubuntu" is not a safe guess, and silently launching into the wrong distro
/// is worse than a clear error.
fn distro_from_project(
    project: &Project,
    info: &RuntimeInfo,
) -> Result<String, AppError> {
    if is_wsl(project) {
        let path = project.full_path.replace('\\', "/");
        for prefix in ["//wsl.localhost/", "//wsl$/"] {
            if let Some(rest) = path.strip_prefix(prefix) {
                if let Some(distro) = rest.split('/').find(|s| !s.is_empty()) {
                    return Ok(distro.to_string());
                }
            }
        }
    }
    info.default_distro
        .clone()
        .ok_or_else(|| AppError::NoWslDistro(project.full_path.clone()))
}

/// Spawn a command line that is already quoted the way the target wants it.
///
/// `Command::args` re-quotes anything containing spaces, which turns
/// `--folder-uri vscode-remote://…` into a single quoted argument and breaks
/// it. `shell_line` (`raw_arg` on Windows, `platform::Quiet`) hands the
/// string to Windows verbatim, so the target's own `args_template` is the
/// only thing deciding how it is split.
fn spawn_raw(exe: &str, args: &str) -> Result<(), AppError> {
    // the process spawned below is cmd.exe, which always exists, so a
    // missing editor "launched" fine: a console flashed, Ok came back, and a
    // frecency launch was recorded. wsl is exempt: the program it runs lives
    // inside the distro, where a windows PATH lookup means nothing
    if exe != "wsl" && !super::editors::is_on_path(exe) {
        return Err(AppError::TargetNotInstalled(exe.to_string()));
    }

    let mut cmd = Command::new("cmd");
    cmd.quiet().shell_line(format!("/c {exe} {args}"));
    scrub_agent_env(&mut cmd);
    cmd.spawn()
        .map_err(|e| AppError::LaunchFailed(format!("{exe}: {e}")))?;
    Ok(())
}

// what an agent's tool shell sets so its own commands stay plain and
// never ask: no colours, no editor, no credential prompt. a terminal
// opened from a devgo started in that shell came up all white
const AGENT_SHELL_VARS: &[&str] = &[
    "NO_COLOR",
    "GIT_EDITOR",
    "GIT_ASKPASS",
    "GIT_TERMINAL_PROMPT",
    "GCM_INTERACTIVE",
    "PROMPT",
    "DISABLE_AUTOUPDATER",
    "NoDefaultCurrentDirectoryInExePath",
];

// a launcher is nobody's child. devgo started from inside a claude code
// session inherits that session's environment, and every editor, terminal
// and agent it opens inherits it too: a claude launched that way said
// its transcript saving was off, a terminal had no colours. scrub both so
// what devgo opens is a fresh top-level thing, whatever started devgo.
// the markers by prefix because their set grows; the list unconditionally,
// env_remove on a name that is not set is a no-op. never env_clear: that
// drops PATH and HOME with them
fn scrub_agent_env(cmd: &mut Command) {
    for (key, _) in std::env::vars_os() {
        let name = key.to_string_lossy();
        if name.starts_with("CLAUDE_CODE_")
            || ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "AI_AGENT"]
                .contains(&name.as_ref())
        {
            cmd.env_remove(&key);
        }
    }
    for name in AGENT_SHELL_VARS {
        cmd.env_remove(name);
    }
}

/// Launch a project into any registered target.
///
/// Replaces the hardcoded `code` and `wt` calls. Nothing here knows what an
/// editor is any more — it resolves a command line from the target's own
/// templates and spawns it.
pub fn launch_target(
    target: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    tmux: &TmuxConfig,
) -> Result<(), AppError> {
    let (resolved, wsl) = if is_wsl(project) {
        let distro = distro_from_project(project, info)?;
        let linux_path = super::platform::paths::windows_to_wsl_path(
            &project.full_path,
            &distro,
        );
        let resolved =
            target.resolve(&project.full_path, Some((&distro, &linux_path)));
        (resolved, Some((distro, linux_path)))
    } else {
        (target.resolve(&project.full_path, None), None)
    };

    // A target with no form for this side cannot open the project. Saying so
    // is the whole point — launching anyway would open the wrong directory
    // silently.
    let (exe, args) = resolved.ok_or_else(|| {
        let (t, p) = (target.name.clone(), project.name.clone());
        if is_wsl(project) {
            AppError::TargetCannotOpenWsl(t, p)
        } else {
            AppError::TargetWslOnly(t, p)
        }
    })?;

    // the template decides, not the kind: a terminal whose args ignore
    // {script} used to get a devgo-*.sh in %TEMP% that nothing ever read.
    // the filesystem decides which script: bash driving tmux in the distro,
    // or powershell driving psmux, same windows from the same config. until
    // psmux the windows side was the `_` arm, and a windows project opened
    // one bare tab while the same launch on a wsl project opened three
    let args = match (&wsl, args.contains("{script}")) {
        (Some((distro, linux_path)), true) => {
            let script = write_tmux_script(project, distro, linux_path, tmux)?;
            args.replace("{script}", &script)
        }
        (None, true) => {
            let script = write_psmux_script(project, tmux)?;
            args.replace("{script}", &script)
        }
        _ => args,
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
    tmux: &TmuxConfig,
) -> Result<String, AppError> {
    // the same name is the session and the filename: two projects called
    // api used to share one file, and the second write could land before
    // the first wsl had read it
    let session = tmux_session_name(project);
    let script = build_tmux_script(&session, linux_path, tmux);
    let temp_file = std::env::temp_dir().join(format!("devgo-{session}.sh"));
    std::fs::write(&temp_file, &script)?;
    Ok(super::platform::paths::windows_to_wsl_path(
        &temp_file.to_string_lossy(),
        distro,
    ))
}

/// The Windows twin of write_tmux_script: same session name, same filename
/// discipline, and no path conversion, because the shell reading it is the
/// one that wrote it. The template double-quotes the path it gets back.
fn write_psmux_script(
    project: &Project,
    tmux: &TmuxConfig,
) -> Result<String, AppError> {
    let session = tmux_session_name(project);
    let script = build_psmux_script(&session, &project.full_path, tmux);
    let temp_file = std::env::temp_dir().join(format!("devgo-{session}.ps1"));
    std::fs::write(&temp_file, &script)?;
    Ok(temp_file.to_string_lossy().into_owned())
}

/// A session name unique to this project. sanitize_file_stem already maps
/// `.` and `:` (tmux's target separators) to `-`; the suffix is what keeps two
/// projects called `api` from attaching to each other's shell.
pub(crate) fn tmux_session_name(project: &Project) -> String {
    format!(
        "{}-{}",
        sanitize_file_stem(&project.name),
        path_suffix(&project.full_path)
    )
}

// every project's session name to its path, for the live read: the same
// function the scripts use, so a session created on launch and a session
// found by tmux ls agree by construction
pub(crate) fn session_names(
    projects: &[Project],
) -> std::collections::HashMap<String, String> {
    projects
        .iter()
        .map(|p| (tmux_session_name(p), p.full_path.clone()))
        .collect()
}

/// FNV-1a over the normalised path, written out rather than DefaultHasher:
/// that one is not stable across Rust releases, and a session name that
/// changes under you is a session you can never reattach to. Lowercased and
/// slash-flipped because Windows spells the same directory several ways.
fn path_suffix(path: &str) -> String {
    let normalized = path.to_lowercase().replace('\\', "/");
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in normalized.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:08x}", (hash & 0xffff_ffff) as u32)
}

/// Reduce a project name to something safe to embed in a filename. Without this
/// a project containing a separator would escape the temp directory.
fn sanitize_file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Bring the project's session up to the requested layout, and nothing more.
///
/// The old script wrapped every window creation in the has-session guard,
/// so the layout was decided the first time you launched a project and
/// frozen: add a window, relaunch, still see three, with nothing to explain
/// it. Every window gets its own guard now, the first one included: on a
/// session that already exists new-session never runs, and a name you put at
/// the top of the list would otherwise be the one that never appears.
///
/// Nothing here kills, renames or prunes. A window someone made by hand is
/// theirs, and a launcher that tidies your session is one you stop trusting
/// with a long-running process.
fn build_tmux_script(
    session: &str,
    linux_path: &str,
    tmux: &TmuxConfig,
) -> String {
    // off is no tmux, not tmux with one window: an empty list still starts
    // a server and leaves a session behind. exec so exiting closes the tab,
    // -l so the profile is read; doubled braces because this is a format
    if !tmux.enabled {
        return format!(
            r#"#!/usr/bin/env bash
cd {} || exit 1
exec "${{SHELL:-bash}}" -l
"#,
            sh_quote(linux_path)
        );
    }

    let windows = &tmux.window_names;
    let session_q = sh_quote(session);
    // every -t carries `=`: tmux matches a target by prefix otherwise, and
    // has-session -t app is satisfied by a running app-api. new-session -s
    // is the exception, it names something that does not exist yet
    let exact_q = sh_quote(&format!("={session}"));
    let target_q = sh_quote(&format!("={session}:"));
    let path_q = sh_quote(linux_path);

    // an empty list is one plain window: new-session always makes one, and
    // the default is not quietly put back
    let create = match windows.first() {
        Some(first) => format!(
            "    tmux new-session -d -s {session_q} -n {} -c {path_q}\n",
            sh_quote(first)
        ),
        None => format!("    tmux new-session -d -s {session_q} -c {path_q}\n"),
    };

    // -F: a name is a literal, not a regex. -x: git must not match a
    // hand-made git-log. --: a name like -log is otherwise read as options,
    // grep exits 2, `if !` reads that as "not found", and the window is
    // created again on every launch
    let reconcile: String = windows
        .iter()
        .map(|name| {
            let name_q = sh_quote(name);
            format!(
                "if ! tmux list-windows -t {exact_q} -F '#W' 2>/dev/null | grep -Fxq -- {name_q}; then\n    tmux new-window -t {target_q} -n {name_q} -c {path_q}\nfi\n"
            )
        })
        .collect();

    format!(
        r#"#!/usr/bin/env bash
if ! tmux has-session -t {exact_q} 2>/dev/null; then
{create}fi
{reconcile}tmux attach -t {exact_q}
"#
    )
}

/// One single-quoted bash word. Names are typed by a person, or arrive from
/// an imported file: in double quotes, `a"; tmux kill-server; #` is a working
/// way to destroy every session, and one stray `"` is a syntax error that
/// stops every WSL launch. Single quotes are wholly literal; the one
/// character they cannot hold is `'`, which closes, escapes and reopens.
fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// The PowerShell twin of build_tmux_script, line for line where the
/// shells allow it. psmux speaks tmux's commands and returns tmux's exit
/// codes, so every rule above holds here for the same reasons: reconcile
/// per window, `=` on every target but the one being created, nothing
/// killed or renamed. The reasons are repeated beside each line rather
/// than pointed at, because whoever edits one script will not have the
/// other open.
fn build_psmux_script(
    session: &str,
    windows_path: &str,
    tmux: &TmuxConfig,
) -> String {
    // -LiteralPath, not -Path: -Path reads [ and ] as wildcards, and
    // api[v2] is a legal directory that then "cannot be found". first in
    // both branches, so a detach leaves the -NoExit shell in the project
    let path_q = ps_quote(windows_path);
    let cd = format!("Set-Location -LiteralPath {path_q}\n");

    // off is no psmux, not psmux with one window: an empty list still
    // starts a server and leaves a session behind. the template's -NoExit
    // is what keeps this shell open
    if !tmux.enabled {
        return cd;
    }

    let windows = &tmux.window_names;
    let session_q = ps_quote(session);
    let exact_q = ps_quote(&format!("={session}"));
    let target_q = ps_quote(&format!("={session}:"));

    let create = match windows.first() {
        Some(first) => format!(
            "    psmux.exe new-session -d -s {session_q} -n {} -c {path_q}\n",
            ps_quote(first)
        ),
        None => {
            format!("    psmux.exe new-session -d -s {session_q} -c {path_q}\n")
        }
    };

    // -cnotcontains: the plain -notcontains is case-insensitive, so a
    // hand-made Code satisfies the check for code and the window you
    // configured never appears. whole-element too, so git cannot match a
    // git-log. @( ) so one window is still an array and none is an empty
    // one, not $null, which -cnotcontains would read as a list of one
    let reconcile: String = windows
        .iter()
        .map(|name| {
            let name_q = ps_quote(name);
            format!(
                "if (@(psmux.exe list-windows -t {exact_q} -F '#W' 2>$null) -cnotcontains {name_q}) {{\n    psmux.exe new-window -t {target_q} -n {name_q} -c {path_q}\n}}\n"
            )
        })
        .collect();

    // not installed is not an error: the user keeps the plain tab they had
    // before psmux, in the project, plus one line saying how to get the
    // windows. return ends the script and nothing else; exit would end pwsh
    // regardless of -NoExit and close the tab on the one machine where the
    // message matters.
    // psmux.exe, and -CommandType Application: this runs in the user's own
    // shell, profile included, and a profile that aliases psmux to a
    // project picker made Get-Command say yes and every call below open a
    // folder dialog. ask for the program, call the program
    // has-session answers with its exit code, and 1 is the answer we are
    // asking for; a profile that turns the native preference on under
    // ErrorActionPreference Stop would abort the script on it
    format!(
        r#"{cd}if (-not (Get-Command psmux.exe -CommandType Application -ErrorAction SilentlyContinue)) {{
    Write-Host 'DevGo: psmux is not installed, so this is a plain shell. For named windows: winget install marlocarlo.psmux'
    return
}}
$PSNativeCommandUseErrorActionPreference = $false
psmux.exe has-session -t {exact_q} 2>$null
if ($LASTEXITCODE -ne 0) {{
{create}}}
{reconcile}psmux.exe attach -t {exact_q}
"#
    )
}

/// One single-quoted PowerShell string, for the same reason as sh_quote:
/// in double quotes $var and $( ) expand and a `"` ends the string. Single
/// quotes hold everything but `'`, which PowerShell escapes by doubling.
/// A backslash needs nothing done to it, the escape character is the
/// backtick, so G:\dev is G:\dev.
fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Open a terminal that runs a command in the project directory.
pub fn launch_with_command(
    target: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    command: &str,
) -> Result<(), AppError> {
    let resolved = if is_wsl(project) {
        let distro = distro_from_project(project, info)?;
        let linux_path = super::platform::paths::windows_to_wsl_path(
            &project.full_path,
            &distro,
        );
        target.resolve_run(
            &project.full_path,
            Some((&distro, &linux_path)),
            &escape(command),
        )
    } else {
        target.resolve_run(&project.full_path, None, command)
    };

    let (exe, args) = resolved
        .ok_or_else(|| AppError::TargetCannotRun(target.name.clone()))?;

    spawn_raw(&exe, &args)
}

// the command sits inside a double-quoted bash -lc argument
fn escape(command: &str) -> String {
    command.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn launch_both(
    editor: &LaunchTarget,
    terminal: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    tmux: &TmuxConfig,
) -> Result<(), AppError> {
    launch_target(editor, project, info, tmux)?;
    // The editor needs a moment to claim the foreground, or the terminal opens
    // behind it.
    std::thread::sleep(std::time::Duration::from_millis(1000));
    launch_target(terminal, project, info, tmux)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::target::TargetKind;

    fn tmux_with(names: &[&str]) -> TmuxConfig {
        TmuxConfig {
            enabled: true,
            window_names: names.iter().map(|n| n.to_string()).collect(),
        }
    }

    fn wsl_project(name: &str, workspace: &str) -> Project {
        Project::new(
            name.into(),
            format!(r"\\wsl.localhost\Ubuntu\home\joy\{workspace}\{name}"),
            format!(r"\\wsl.localhost\Ubuntu\home\joy\{workspace}"),
            "WSL".into(),
        )
    }

    fn windows_project(name: &str, workspace: &str) -> Project {
        Project::new(
            name.into(),
            format!(r"G:\{workspace}\{name}"),
            format!(r"G:\{workspace}"),
            "Windows".into(),
        )
    }

    fn no_distro() -> RuntimeInfo {
        RuntimeInfo {
            runtime: crate::services::platform::runtime::Runtime::Windows,
            wsl_available: false,
            distros: vec![],
            default_distro: None,
            local_fs: crate::services::scanner::LOCAL_FS,
        }
    }

    #[test]
    fn the_session_name_is_sanitised_and_unique_per_project_path() {
        let dotted = Project::new(
            "my.app:2".into(),
            r"\\wsl.localhost\Ubuntu\home\joy\work\my.app".into(),
            r"\\wsl.localhost\Ubuntu\home\joy\work".into(),
            "WSL".into(),
        );
        let session = tmux_session_name(&dotted);
        assert!(
            !session.contains('.') && !session.contains(':'),
            "{session}"
        );
        assert!(session.starts_with("my-app-2-"), "{session}");

        let work = wsl_project("api", "work");
        let play = wsl_project("api", "play");
        assert_ne!(tmux_session_name(&work), tmux_session_name(&play));

        // the same directory under another spelling is the same session
        let shouted = Project::new(
            "api".into(),
            r"//WSL.LOCALHOST/Ubuntu/home/joy/work/api".into(),
            r"//WSL.LOCALHOST/Ubuntu/home/joy/work".into(),
            "WSL".into(),
        );
        assert_eq!(tmux_session_name(&work), tmux_session_name(&shouted));
    }

    /// {script} is the one placeholder resolve knows nothing about; the
    /// launcher fills it afterwards, because only the launcher writes the file.
    #[test]
    fn the_script_placeholder_is_filled_by_the_launcher_not_by_resolve() {
        let every = LaunchTarget {
            id: "every".into(),
            name: "Every Placeholder".into(),
            kind: TargetKind::Terminal,
            executable: "wt".into(),
            args_template: "-d \"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: Some(
                "{distro} {linux_path} {path} {script}".into(),
            ),
            run_args_template: None,
            wsl_run_args_template: None,
        };
        let windows_path = r"\\wsl.localhost\Ubuntu\home\joy\api";
        let (_, args) = every
            .resolve(windows_path, Some(("Ubuntu", "/home/joy/api")))
            .unwrap();
        assert_eq!(
            args,
            format!("Ubuntu /home/joy/api {windows_path} {{script}}")
        );

        // the other half: the launcher fills it with a file it really wrote.
        // cmd, not wsl, so the suite does not depend on a distro
        let marker =
            std::env::temp_dir().join("devgo-script-placeholder-proof.txt");
        let _ = std::fs::remove_file(&marker);
        let echoes = LaunchTarget {
            id: "echo-script".into(),
            name: "Echo Script".into(),
            kind: TargetKind::Terminal,
            executable: "cmd".into(),
            args_template: "/c exit".into(),
            wsl_executable: None,
            wsl_args_template: Some(format!(
                "/c echo {{script}} > \"{}\"",
                marker.display()
            )),
            run_args_template: None,
            wsl_run_args_template: None,
        };
        let project = wsl_project("placeholder", "work");
        launch_target(&echoes, &project, &no_distro(), &tmux_with(&["code"]))
            .unwrap();
        let written_len = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written_len() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let written =
            std::fs::read_to_string(&marker).expect("target never ran");
        assert!(!written.contains("{script}"), "{written:?}");
        assert!(written.contains(".sh"), "{written:?}");
        let _ = std::fs::remove_file(&marker);
    }

    /// A terminal that opens the directory directly asks for no script and
    /// must not be left one in %TEMP%.
    #[test]
    fn a_terminal_template_without_the_placeholder_writes_no_script() {
        let project = wsl_project("orphan-check", "work");
        let script_path = std::env::temp_dir()
            .join(format!("devgo-{}.sh", tmux_session_name(&project)));
        let _ = std::fs::remove_file(&script_path);
        let plain = LaunchTarget {
            id: "plain".into(),
            name: "Plain".into(),
            kind: TargetKind::Terminal,
            executable: "cmd".into(),
            args_template: "/c exit".into(),
            wsl_executable: None,
            wsl_args_template: Some("/c exit".into()),
            run_args_template: None,
            wsl_run_args_template: None,
        };
        launch_target(&plain, &project, &no_distro(), &tmux_with(&["code"]))
            .unwrap();
        // the write is synchronous inside launch_target: it exists or never was
        assert!(!script_path.exists(), "{}", script_path.display());
    }

    #[test]
    fn a_custom_window_list_produces_exactly_those_windows_in_order() {
        let names = ["editor", "logs", "db", "shell"];
        let script =
            build_tmux_script("app-deadbeef", "/srv/app", &tmux_with(&names));
        assert_eq!(script.matches("tmux new-session").count(), 1);
        // names.len(), not names.len() - 1: the first name is reconciled too
        assert_eq!(script.matches("tmux new-window").count(), names.len());
        let mut cursor = 0;
        for name in names {
            let needle = format!("-n '{name}' -c '/srv/app'");
            let at = script[cursor..]
                .find(&needle)
                .unwrap_or_else(|| panic!("{name} missing or out of order"));
            cursor += at + needle.len();
        }
        for stale in ["code", "agents", "git"] {
            assert!(!script.contains(stale), "the default leaked: {script}");
        }
    }

    #[test]
    fn an_empty_window_list_opens_one_unnamed_window() {
        let script =
            build_tmux_script("app-deadbeef", "/srv/app", &tmux_with(&[]));
        assert!(script
            .contains("tmux new-session -d -s 'app-deadbeef' -c '/srv/app'"));
        assert!(!script.contains("-n "), "must not name a window: {script}");
        assert!(
            !script.contains("new-window"),
            "nothing to reconcile: {script}"
        );
        assert!(script.contains("tmux attach -t '=app-deadbeef'"));
    }

    /// has-session -t app is satisfied by a running app-api; `=` forces an
    /// exact match everywhere but on the name being created.
    #[test]
    fn every_tmux_target_is_matched_exactly_except_the_name_being_created() {
        let script = build_tmux_script(
            "app",
            "/srv/app",
            &tmux_with(&["code", "agents"]),
        );
        assert!(script.contains("tmux has-session -t '=app'"), "{script}");
        assert!(script.contains("tmux list-windows -t '=app'"), "{script}");
        assert!(script.contains("tmux new-window -t '=app:'"), "{script}");
        assert!(script.contains("tmux attach -t '=app'"), "{script}");
        assert!(!script.contains("-s '=app"), "{script}");
    }

    /// "Make the session match the list" is the most natural edit anyone
    /// will propose here, and it is the one that loses a running build.
    #[test]
    fn reconciliation_never_kills_or_renames_a_window() {
        let script = build_tmux_script(
            "app-deadbeef",
            "/srv/app",
            &tmux_with(&["code", "agents"]),
        );
        for destructive in [
            "kill-window",
            "kill-session",
            "kill-server",
            "rename-window",
            "rename-session",
            "move-window",
            "unlink-window",
        ] {
            assert!(!script.contains(destructive), "{destructive}: {script}");
        }
    }

    /// Every other test here is a contains over one flat string and would
    /// pass with the new-window blocks back inside the guard. What makes
    /// reconciliation work is where the blocks sit.
    #[test]
    fn the_reconcile_blocks_sit_outside_the_has_session_guard() {
        let script = build_tmux_script(
            "app-deadbeef",
            "/srv/app",
            &tmux_with(&["code", "git"]),
        );
        let fi = script.find("\nfi\n").expect("the guard closes");
        let first_reconcile =
            script.find("tmux list-windows").expect("reconciles");
        assert!(first_reconcile > fi, "back inside the guard: {script}");
        assert_eq!(
            script[..fi].matches("tmux new-window").count(),
            0,
            "{script}"
        );
    }

    #[test]
    fn a_window_name_that_looks_like_an_option_is_still_a_pattern() {
        let script = build_tmux_script(
            "app-deadbeef",
            "/srv/app",
            &tmux_with(&["code", "-log"]),
        );
        assert!(script.contains("grep -Fxq -- 'code'"), "{script}");
        assert!(script.contains("grep -Fxq -- '-log'"), "{script}");
        assert_eq!(
            script.matches("grep -Fxq -- ").count(),
            script.matches("grep ").count(),
            "a grep without -- crept back in: {script}"
        );
    }

    #[test]
    fn a_hostile_window_name_stays_one_inert_word() {
        let hostile = r#"a"; tmux kill-server; #"#;
        let names = tmux_with(&[hostile, "$(touch /tmp/pwned)", "it's"]);
        let script = build_tmux_script("app-deadbeef", "/srv/app", &names);
        // the script does say kill-server, harmlessly, inside the quoted name;
        // it must never say it anywhere else
        let quoted = format!("'{hostile}'");
        assert_eq!(
            script.matches("kill-server").count(),
            script.matches(&quoted).count(),
            "a name escaped its quotes: {script}"
        );
        assert_eq!(script.matches(&quoted).count(), 3, "{script}");
        assert!(script.contains("'$(touch /tmp/pwned)'"), "{script}");
        assert!(script.contains(r"'it'\''s'"), "{script}");
        // every double quote left is one the name contained
        assert_eq!(script.matches('"').count(), 3, "{script}");
    }

    /// back$up is a legal directory; unquoted, bash expands $up to nothing.
    #[test]
    fn a_project_path_with_shell_characters_is_not_expanded() {
        let script = build_tmux_script(
            "app-deadbeef",
            "/home/joy/back$up",
            &tmux_with(&["code"]),
        );
        assert!(script.contains("-c '/home/joy/back$up'"), "{script}");
    }

    #[test]
    fn the_temp_script_filename_carries_the_session_name() {
        let here = wsl_project("api", "work");
        let there = wsl_project("api", "other");
        let terminal = LaunchTarget {
            id: "tmux-term".into(),
            name: "tmux Terminal".into(),
            kind: TargetKind::Terminal,
            executable: "cmd".into(),
            args_template: "/c exit".into(),
            wsl_executable: None,
            wsl_args_template: Some("/c exit {script}".into()),
            run_args_template: None,
            wsl_run_args_template: None,
        };
        for project in [&here, &there] {
            let expected = std::env::temp_dir()
                .join(format!("devgo-{}.sh", tmux_session_name(project)));
            let _ = std::fs::remove_file(&expected);
            launch_target(
                &terminal,
                project,
                &no_distro(),
                &tmux_with(&["code"]),
            )
            .unwrap();
            assert!(expected.exists(), "{}", expected.display());
            let _ = std::fs::remove_file(&expected);
        }
    }

    #[test]
    fn tmux_switched_off_opens_a_plain_shell_and_no_session() {
        let off = TmuxConfig {
            enabled: false,
            window_names: vec!["code".into()],
        };
        let script = build_tmux_script("api", "/home/joy/api", &off);
        assert!(!script.contains("tmux"), "{script}");
        assert!(script.contains("cd '/home/joy/api'"), "{script}");
        assert!(script.contains(r#"exec "${SHELL:-bash}" -l"#), "{script}");
    }

    /// The list is ignored while off and still there when it comes back.
    #[test]
    fn the_window_list_survives_being_switched_off() {
        let names = ["editor", "logs", "db"];
        let off = TmuxConfig {
            enabled: false,
            ..tmux_with(&names)
        };
        let off_script = build_tmux_script("app", "/srv/app", &off);
        for name in names {
            assert!(!off_script.contains(name), "{off_script}");
        }
        let on = TmuxConfig {
            enabled: true,
            ..off
        };
        let on_script = build_tmux_script("app", "/srv/app", &on);
        for name in names {
            assert!(on_script.contains(&format!("-n '{name}'")), "{on_script}");
        }
    }

    /// bool::default() is false; a plain serde(default) on `enabled` would
    /// have switched tmux off for every existing install.
    #[test]
    fn tmux_is_on_for_a_config_that_predates_the_switch() {
        let parsed: TmuxConfig =
            serde_json::from_str(r#"{"window_names":["code","agents"]}"#)
                .unwrap();
        assert!(parsed.enabled);
        assert_eq!(
            parsed.window_names,
            vec!["code".to_string(), "agents".to_string()]
        );
    }

    /// The shipped default must still be byte-for-byte what the three
    /// hardcoded lines produced, or every existing session gets a new layout.
    #[test]
    fn the_default_list_still_opens_code_agents_and_git_in_that_order() {
        let shipped = TmuxConfig::default();
        assert!(shipped.enabled, "tmux on, or every install loses it");
        assert_eq!(shipped.window_names, ["code", "agents", "git"]);
        let script = build_tmux_script("api", "/home/joy/api", &shipped);
        let mut cursor = 0;
        for name in &shipped.window_names {
            let needle = format!("-n '{name}' -c '/home/joy/api'");
            let at = script[cursor..]
                .find(&needle)
                .unwrap_or_else(|| panic!("{name} missing or out of order"));
            cursor += at + needle.len();
        }
    }

    // psmux: each test below is the Windows twin of a tmux test above. A
    // rule that holds for one script and silently not the other is the
    // asymmetry this work exists to remove

    #[test]
    fn the_default_list_opens_code_agents_and_git_under_psmux_too() {
        let shipped = TmuxConfig::default();
        let script =
            build_psmux_script("api-1f2e3d4c", r"G:\dev\api", &shipped);
        assert!(
            script.contains(
                r"psmux.exe new-session -d -s 'api-1f2e3d4c' -n 'code' -c 'G:\dev\api'"
            ),
            "the first window belongs to new-session: {script}"
        );
        let mut cursor = 0;
        for name in &shipped.window_names {
            let needle = format!(r"-n '{name}' -c 'G:\dev\api'");
            let at = script[cursor..]
                .find(&needle)
                .unwrap_or_else(|| panic!("{name} missing or out of order"));
            cursor += at + needle.len();
        }
    }

    #[test]
    fn a_custom_window_list_produces_exactly_those_psmux_windows_in_order() {
        let names = ["editor", "logs", "db", "shell"];
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&names),
        );
        assert_eq!(script.matches("psmux.exe new-session").count(), 1);
        // the first name is reconciled too
        assert_eq!(script.matches("psmux.exe new-window").count(), names.len());
        let mut cursor = 0;
        for name in names {
            let needle = format!(r"-n '{name}' -c 'G:\srv\app'");
            let at = script[cursor..]
                .find(&needle)
                .unwrap_or_else(|| panic!("{name} missing or out of order"));
            cursor += at + needle.len();
        }
        for stale in ["code", "agents", "git"] {
            assert!(!script.contains(stale), "the default leaked: {script}");
        }
    }

    #[test]
    fn an_empty_window_list_opens_one_unnamed_psmux_window() {
        let script =
            build_psmux_script("app-deadbeef", r"G:\srv\app", &tmux_with(&[]));
        assert!(script.contains(
            r"psmux.exe new-session -d -s 'app-deadbeef' -c 'G:\srv\app'"
        ));
        assert!(!script.contains("-n "), "must not name a window: {script}");
        assert!(
            !script.contains("new-window"),
            "nothing to reconcile: {script}"
        );
        assert!(script.contains("psmux.exe attach -t '=app-deadbeef'"));
    }

    /// Probed on psmux 3.3.8: a bare name matches exactly and a prefix not
    /// at all, so the `=` is inert there today. It stays: tmux's own rule
    /// is prefix match, psmux tracks tmux, and a release that adopts the
    /// rule would attach you to somebody else's project without a word.
    #[test]
    fn every_psmux_target_is_matched_exactly_except_the_name_being_created() {
        let script = build_psmux_script(
            "app",
            r"G:\srv\app",
            &tmux_with(&["code", "agents"]),
        );
        assert!(
            script.contains("psmux.exe has-session -t '=app'"),
            "{script}"
        );
        assert!(
            script.contains("psmux.exe list-windows -t '=app'"),
            "{script}"
        );
        assert!(
            script.contains("psmux.exe new-window -t '=app:'"),
            "{script}"
        );
        assert!(script.contains("psmux.exe attach -t '=app'"), "{script}");
        assert!(!script.contains("-s '=app"), "{script}");
        assert_eq!(
            script.matches(" -t ").count(),
            script.matches(" -t '=").count(),
            "a target without = crept in: {script}"
        );
    }

    #[test]
    fn psmux_reconciliation_never_kills_or_renames_a_window() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code", "agents"]),
        );
        for destructive in [
            "kill-window",
            "kill-session",
            "kill-server",
            "rename-window",
            "rename-session",
            "move-window",
            "unlink-window",
        ] {
            assert!(!script.contains(destructive), "{destructive}: {script}");
        }
    }

    /// The contains checks above cannot see where a block sits; this can.
    #[test]
    fn the_psmux_reconcile_blocks_sit_outside_the_has_session_guard() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code", "git"]),
        );
        let guard = script
            .find("if ($LASTEXITCODE -ne 0) {")
            .expect("the guard opens");
        let guard_close =
            guard + script[guard..].find("\n}\n").expect("the guard closes");
        let first_reconcile =
            script.find("psmux.exe list-windows").expect("reconciles");
        assert!(
            first_reconcile > guard_close,
            "back inside the guard: {script}"
        );
        assert_eq!(
            script[..guard_close]
                .matches("psmux.exe new-window")
                .count(),
            0,
            "{script}"
        );
    }

    /// -notcontains is case-insensitive, so a hand-made Code satisfies the
    /// check for code; -cnotcontains is the grep -Fx of this script, and
    /// one easily deleted letter.
    #[test]
    fn a_psmux_window_name_is_compared_exactly_and_case_sensitively() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code", "-log"]),
        );
        assert!(script.contains("-cnotcontains 'code'"), "{script}");
        assert!(script.contains("-cnotcontains '-log'"), "{script}");
        assert_eq!(
            script.matches("-cnotcontains ").count(),
            script.matches("notcontains").count(),
            "a case-insensitive -notcontains crept back in: {script}"
        );
        // one window is a string and none is $null; @( ) makes both a list
        assert_eq!(
            script.matches("if (@(psmux.exe list-windows").count(),
            2,
            "{script}"
        );
    }

    #[test]
    fn a_hostile_window_name_stays_one_inert_powershell_string() {
        let hostile = r#"a"; psmux kill-server; #"#;
        let names =
            tmux_with(&[hostile, "$(Remove-Item -Recurse G:\\)", "it's"]);
        let script = build_psmux_script("app-deadbeef", r"G:\srv\app", &names);
        let quoted = format!("'{hostile}'");
        assert_eq!(
            script.matches("kill-server").count(),
            script.matches(&quoted).count(),
            "a name escaped its quotes: {script}"
        );
        assert_eq!(script.matches(&quoted).count(), 3, "{script}");
        assert!(
            script.contains("'$(Remove-Item -Recurse G:\\)'"),
            "{script}"
        );
        // powershell's own escape for a quote inside single quotes: double it
        assert!(script.contains("'it''s'"), "{script}");
        // the bash escape would end the string and leave a stray backslash
        assert!(!script.contains(r"'\''"), "{script}");
        // every double quote left is one the name contained
        assert_eq!(script.matches('"').count(), 3, "{script}");
    }

    /// Set-Location -Path 'G:\dev\api[v2]' reads the brackets as a wildcard
    /// and fails on a directory that is right there.
    #[test]
    fn a_project_path_with_wildcard_characters_is_taken_literally() {
        let on = build_psmux_script(
            "app-deadbeef",
            r"G:\dev\api[v2]",
            &tmux_with(&["code"]),
        );
        let off = build_psmux_script(
            "app-deadbeef",
            r"G:\dev\api[v2]",
            &TmuxConfig {
                enabled: false,
                window_names: vec![],
            },
        );
        for script in [&on, &off] {
            assert!(
                script.contains(r"Set-Location -LiteralPath 'G:\dev\api[v2]'"),
                "{script}"
            );
            assert!(!script.contains("Set-Location -Path"), "{script}");
        }
        assert!(on.contains(r"-c 'G:\dev\api[v2]'"), "{on}");
    }

    /// With -NoExit on the template a bare Set-Location is a shell that
    /// stays open in the project.
    #[test]
    fn psmux_switched_off_opens_a_plain_shell_and_no_session() {
        let off = TmuxConfig {
            enabled: false,
            window_names: vec!["code".into()],
        };
        let script = build_psmux_script("api-1f2e3d4c", r"G:\dev\api", &off);
        assert!(!script.contains("psmux"), "{script}");
        assert_eq!(script, "Set-Location -LiteralPath 'G:\\dev\\api'\n");
    }

    #[test]
    fn a_machine_without_psmux_gets_a_plain_shell_and_the_install_command() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code"]),
        );
        let check = script
            .find("if (-not (Get-Command psmux.exe -CommandType Application")
            .expect("asks whether psmux is installed");
        let cd = script.find("Set-Location").expect("enters the project");
        let first_call =
            script.find("psmux.exe has-session").expect("then talks");
        assert!(cd < check, "the directory comes before any bail: {script}");
        assert!(check < first_call, "the check comes first: {script}");
        assert!(
            script.contains("winget install marlocarlo.psmux"),
            "{script}"
        );
        let bail = &script[check..first_call];
        assert!(bail.contains("    return\n"), "{bail}");
        assert!(!bail.contains("exit"), "exit would close the tab: {bail}");
        assert!(
            !bail.contains("throw") && !bail.contains("Write-Error"),
            "not installed is not an error: {bail}"
        );
    }

    /// The other half of the {script} contract, on the Windows side: a .ps1,
    /// its Windows path, no conversion.
    #[test]
    fn the_script_placeholder_is_substituted_for_a_windows_project_too() {
        let marker =
            std::env::temp_dir().join("devgo-psmux-placeholder-proof.txt");
        let _ = std::fs::remove_file(&marker);
        let echoes = LaunchTarget {
            id: "echo-script".into(),
            name: "Echo Script".into(),
            kind: TargetKind::Terminal,
            executable: "cmd".into(),
            args_template: format!(
                "/c echo {{script}} > \"{}\"",
                marker.display()
            ),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            wsl_run_args_template: None,
        };
        let project = windows_project("placeholder", "work");
        let expected = std::env::temp_dir()
            .join(format!("devgo-{}.ps1", tmux_session_name(&project)));
        let _ = std::fs::remove_file(&expected);

        launch_target(
            &echoes,
            &project,
            &no_distro(),
            &tmux_with(&["code", "git"]),
        )
        .unwrap();

        // the write is synchronous inside launch_target; only the echo is not
        let on_disk = std::fs::read_to_string(&expected)
            .unwrap_or_else(|_| panic!("no script at {}", expected.display()));
        assert!(
            on_disk.contains("psmux.exe new-session -d -s "),
            "{on_disk}"
        );
        assert!(on_disk.contains("-n 'code'"), "{on_disk}");
        assert!(
            on_disk
                .contains(r"Set-Location -LiteralPath 'G:\work\placeholder'"),
            "the windows path, unconverted: {on_disk}"
        );

        let written_len = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written_len() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let written =
            std::fs::read_to_string(&marker).expect("target never ran");
        assert!(!written.contains("{script}"), "{written:?}");
        assert!(written.contains(".ps1"), "{written:?}");
        assert!(!written.contains("/mnt/"), "{written:?}");
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::remove_file(&expected);
    }

    /// devgo restarted from inside a claude code session carries its markers;
    /// nothing it launches may. the target dumps its environment to a file.
    #[test]
    fn a_launched_target_inherits_no_claude_code_markers() {
        std::env::set_var("CLAUDE_CODE_PROOF", "1");
        std::env::set_var("CLAUDECODE", "1");
        std::env::set_var("DEVGO_PROOF_KEPT", "1");
        let marker = std::env::temp_dir().join("devgo-env-scrub-proof.txt");
        let _ = std::fs::remove_file(&marker);
        let dumps = LaunchTarget {
            id: "dump-env".into(),
            name: "Dump Env".into(),
            kind: TargetKind::Terminal,
            executable: "cmd".into(),
            args_template: format!("/c set > \"{}\"", marker.display()),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            wsl_run_args_template: None,
        };
        let project = windows_project("env-scrub", "work");
        launch_target(&dumps, &project, &no_distro(), &tmux_with(&[])).unwrap();

        // set prints sorted; windir is one of the last lines
        let read = || std::fs::read_to_string(&marker).unwrap_or_default();
        for _ in 0..40 {
            if read().to_lowercase().contains("windir=") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let written = read();
        assert!(written.contains("DEVGO_PROOF_KEPT=1"), "{written}");
        assert!(!written.contains("CLAUDE_CODE_PROOF"), "{written}");
        assert!(!written.contains("CLAUDECODE="), "{written}");
        let _ = std::fs::remove_file(&marker);
    }

    // get_envs reports a removed variable as (name, None), so the scrub is
    // observable without spawning. the PATH line is the test's real job:
    // it fails the day someone reaches for env_clear
    #[test]
    fn the_scrub_removes_the_agent_shells_conveniences_and_its_markers() {
        let mut cmd = Command::new("cmd");
        scrub_agent_env(&mut cmd);
        let removed: Vec<String> = cmd
            .get_envs()
            .filter(|(_, v)| v.is_none())
            .map(|(k, _)| k.to_string_lossy().into_owned())
            .collect();
        for name in ["NO_COLOR", "GIT_EDITOR", "GIT_TERMINAL_PROMPT", "PROMPT"]
        {
            assert!(removed.iter().any(|r| r == name), "{name}: {removed:?}");
        }
        assert!(!removed.iter().any(|r| r == "PATH"), "{removed:?}");
    }

    /// The `_` arm was what made a plain windows terminal fine by accident;
    /// now that the arm is real, no placeholder still has to mean no file.
    #[test]
    fn a_windows_terminal_template_without_the_placeholder_writes_no_script() {
        let project = windows_project("orphan-check", "work");
        let script_path = std::env::temp_dir()
            .join(format!("devgo-{}.ps1", tmux_session_name(&project)));
        let _ = std::fs::remove_file(&script_path);
        let plain = LaunchTarget {
            id: "plain".into(),
            name: "Plain".into(),
            kind: TargetKind::Terminal,
            executable: "cmd".into(),
            args_template: "/c exit".into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            wsl_run_args_template: None,
        };
        launch_target(&plain, &project, &no_distro(), &tmux_with(&["code"]))
            .unwrap();
        assert!(!script_path.exists(), "{}", script_path.display());
    }

    /// Found in verify: a profile that aliased psmux to a project picker
    /// made Get-Command say yes, and every call opened a folder dialog in
    /// the tab. The script runs in the user's shell, profile included.
    #[test]
    fn the_script_calls_the_binary_not_whatever_psmux_means_in_the_profile() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code"]),
        );
        assert!(
            script.contains("Get-Command psmux.exe -CommandType Application"),
            "an alias or a function answers a bare Get-Command: {script}"
        );
        // every mention outside the bail message is a call, and a call
        // names the program
        let calls: Vec<&str> = script
            .lines()
            .filter(|l| !l.contains("Write-Host"))
            .flat_map(|l| l.match_indices("psmux").map(move |(i, _)| &l[i..]))
            .collect();
        assert!(!calls.is_empty());
        for call in calls {
            assert!(call.starts_with("psmux.exe "), "an alias answers: {call}");
        }
    }

    #[test]
    fn an_editor_that_is_not_installed_reports_instead_of_pretending() {
        let ghost = LaunchTarget {
            id: "ghost".into(),
            name: "Ghost Editor".into(),
            kind: TargetKind::Editor,
            executable: "devgo-no-such-editor".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            wsl_run_args_template: None,
        };
        let project = Project::new(
            "proj".into(),
            r"G:\some\project".into(),
            r"G:\some".into(),
            "Windows".into(),
        );
        let info = RuntimeInfo {
            runtime: crate::services::platform::runtime::Runtime::Windows,
            wsl_available: false,
            distros: vec![],
            default_distro: None,
            local_fs: crate::services::scanner::LOCAL_FS,
        };

        let err = launch_target(&ghost, &project, &info, &tmux_with(&[]))
            .unwrap_err();
        assert!(
            matches!(err, AppError::TargetNotInstalled(ref e) if e == "devgo-no-such-editor"),
            "expected TargetNotInstalled, got {err:?}"
        );
    }

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
            run_args_template: None,
            wsl_run_args_template: None,
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
            local_fs: crate::services::scanner::LOCAL_FS,
        };

        launch_target(&target, &project, &info, &tmux_with(&[])).unwrap();

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
