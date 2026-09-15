use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

use super::platform::{paths, wsl};
use super::scanner::distro_of;
use crate::error::AppError;
use crate::models::Project;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize)]
pub struct DevScript {
    pub name: String,
    pub command: String,
}

// tolerant on purpose: a package.json we half understand still yields its
// scripts
fn parse_scripts(json: &str, runner: &str) -> Vec<DevScript> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let Some(scripts) = value.get("scripts").and_then(|s| s.as_object()) else {
        return Vec::new();
    };
    scripts
        .keys()
        .map(|name| DevScript {
            command: format!("{runner} run {name}"),
            name: name.clone(),
        })
        .collect()
}

// conventions, not declarations: offered, not asserted
fn conventional(tags: &[String]) -> Vec<DevScript> {
    let mut out = Vec::new();
    if tags.iter().any(|t| t == "rust") {
        out.push(DevScript {
            name: "cargo run".into(),
            command: "cargo run".into(),
        });
        out.push(DevScript {
            name: "cargo test".into(),
            command: "cargo test".into(),
        });
    }
    if tags.iter().any(|t| t == "go") {
        out.push(DevScript {
            name: "go run".into(),
            command: "go run .".into(),
        });
    }
    if tags.iter().any(|t| t == "docker") {
        out.push(DevScript {
            name: "compose up".into(),
            command: "docker compose up".into(),
        });
    }
    out
}

fn read_windows(path: &str) -> Option<String> {
    std::fs::read_to_string(std::path::Path::new(path).join("package.json"))
        .ok()
}

fn read_wsl(distro: &str, linux_path: &str) -> Option<String> {
    let output = Command::new("wsl")
        .creation_flags(CREATE_NO_WINDOW)
        .env("WSL_UTF8", "1")
        .args([
            "-d",
            distro,
            "-e",
            "cat",
            &format!("{linux_path}/package.json"),
        ])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

// on demand only, never in the scan or the badge pass: one package.json per
// node project over 9p is the cost the badges were designed to avoid
pub fn for_project(
    project: &Project,
    tags: &[String],
    package_manager: Option<&str>,
    running: &[String],
) -> Vec<DevScript> {
    let runner = package_manager.unwrap_or("npm");

    let json = match distro_of(&project.full_path) {
        Some(distro) if wsl::is_running(&distro, running) => {
            let linux = paths::windows_to_wsl_path(&project.full_path, &distro);
            read_wsl(&distro, &linux)
        }
        // stopped distro: no scripts, same rule as everywhere else
        Some(_) => None,
        None => read_windows(&project.full_path),
    };

    let mut scripts =
        json.map(|j| parse_scripts(&j, runner)).unwrap_or_default();
    scripts.extend(conventional(tags));
    scripts
}

pub fn run(
    project: &Project,
    command: &str,
    terminal: &crate::models::target::LaunchTarget,
    info: &super::platform::RuntimeInfo,
) -> Result<(), AppError> {
    super::launcher::launch_with_command(terminal, project, info, command)
}
