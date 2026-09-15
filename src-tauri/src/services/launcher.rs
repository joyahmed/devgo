use std::os::windows::process::CommandExt;
use std::process::Command;

use super::platform::RuntimeInfo;
use crate::error::AppError;
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

fn spawn_cmd(args: &[&str]) -> Result<(), AppError> {
    Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .args(std::iter::once(&"/c").chain(args.iter()))
        .spawn()
        .map_err(|e| AppError::LaunchFailed(e.to_string()))?;
    Ok(())
}

pub fn launch_vscode(
    project: &Project,
    info: &RuntimeInfo,
) -> Result<(), AppError> {
    if is_wsl(project) {
        let distro = distro_from_project(project, info)?;
        let linux_path = super::platform::paths::windows_to_wsl_path(
            &project.full_path,
            &distro,
        );
        let uri = format!("vscode-remote://wsl+{}{}", distro, linux_path);
        spawn_cmd(&["code", "--folder-uri", &uri])
    } else {
        spawn_cmd(&["code", &project.full_path])
    }
}
