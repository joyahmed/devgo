use std::os::windows::process::CommandExt;
use std::process::Command;

use super::platform::RuntimeInfo;
use crate::error::AppError;
use crate::models::target::{LaunchTarget, TargetKind};
use crate::models::Project;

const CREATE_NO_WINDOW: u32 = 0x08000000;

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
/// it. `raw_arg` hands the string to Windows verbatim, so the target's own
/// `args_template` is the only thing deciding how it is split.
fn spawn_raw(exe: &str, args: &str) -> Result<(), AppError> {
    // the process spawned below is cmd.exe, which always exists, so a
    // missing editor "launched" fine: a console flashed, Ok came back, and a
    // frecency launch was recorded. wsl is exempt: the program it runs lives
    // inside the distro, where a windows PATH lookup means nothing
    if exe != "wsl" && !super::editors::is_on_path(exe) {
        return Err(AppError::TargetNotInstalled(exe.to_string()));
    }

    Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .raw_arg(format!("/c {exe} {args}"))
        .spawn()
        .map_err(|e| AppError::LaunchFailed(format!("{exe}: {e}")))?;
    Ok(())
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

fn build_tmux_script(session: &str, linux_path: &str) -> String {
    format!(
        r#"#!/usr/bin/env bash
        if ! tmux has-session -t "{session}" 2>/dev/null; then
            tmux new-session -d -s "{session}" -n code -c "{linux_path}"
            tmux new-window -t "{session}:" -n agents -c "{linux_path}"
            tmux new-window -t "{session}:" -n git -c "{linux_path}"
        fi
        tmux attach -t "{session}"
        "#
    )
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
) -> Result<(), AppError> {
    launch_target(editor, project, info)?;
    // The editor needs a moment to claim the foreground, or the terminal opens
    // behind it.
    std::thread::sleep(std::time::Duration::from_millis(1000));
    launch_target(terminal, project, info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::target::TargetKind;

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
        };

        let err = launch_target(&ghost, &project, &info).unwrap_err();
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
