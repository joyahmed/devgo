use std::process::Command;

use serde::Serialize;

use super::platform::Quiet;
use super::platform::{paths, wsl};
use super::scanner::distro_of;
use crate::error::AppError;
use crate::models::Project;

#[derive(Debug, Clone, Serialize)]
pub struct DevScript {
    pub name: String,
    pub command: String,
}

/// The scripts, and the reason there are none when "none" is not this
/// project's own answer.
///
/// Two unrelated situations used to arrive as the same empty vec: a project
/// that declares no scripts, and a project whose package.json was never
/// opened because its distro is asleep. The caller could only say "No dev
/// scripts found for this project" — a claim about the project in the exact
/// case where nothing about the project was looked at. Same field, same
/// name and same rule as `wsl_doctor::wslconfig::ConfigReport::reason`:
/// `reason: None` is the only thing that licenses a claim about what was
/// found, and a reason is never also a health claim.
#[derive(Debug, Clone, Serialize)]
pub struct ScriptList {
    pub scripts: Vec<DevScript>,
    pub reason: Option<String>,
    /// `{runner} install`, present exactly when a package.json was read —
    /// the same condition that yields the project's own scripts, so the
    /// entry never shows for a rust/go-only project or a sleeping distro.
    /// It runs through `run`, the dev-script path, so it lands in the same
    /// terminal with the same login shell (and nvm) as `pnpm run dev`.
    pub install: Option<DevScript>,
}

/// The install line for a runner. npm is `npm install`, not `npm ci`: ci
/// deletes node_modules and refuses a lockfile that drifted from
/// package.json, and this entry is the everyday "get me the deps" click.
pub fn install_command(runner: &str) -> String {
    format!("{runner} install")
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
        .quiet()
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
) -> ScriptList {
    let runner = package_manager.unwrap_or("npm");

    let mut reason = None;
    let json = match distro_of(&project.full_path) {
        Some(distro) if wsl::is_running(&distro, running) => {
            let linux = paths::windows_to_wsl_path(&project.full_path, &distro);
            read_wsl(&distro, &linux)
        }
        // a stopped distro is still no scripts — booting a vm for a menu is
        // the one thing this whole module is written to avoid — but it is
        // not an ANSWER about the project, and it used to be reported as
        // one. the reason travels out so the caller can say which it is
        Some(distro) => {
            reason = Some(format!(
                "The WSL distro {distro} is not running, so this project's \
                 package.json was not read — this is not a claim that the \
                 project has no scripts. Start the distro and try again."
            ));
            None
        }
        None => read_windows(&project.full_path),
    };

    let install = json.as_ref().map(|_| DevScript {
        name: "Install".into(),
        command: install_command(runner),
    });
    let mut scripts =
        json.map(|j| parse_scripts(&j, runner)).unwrap_or_default();
    scripts.extend(conventional(tags));
    ScriptList {
        scripts,
        reason,
        install,
    }
}

pub fn run(
    project: &Project,
    command: &str,
    terminal: &crate::models::target::LaunchTarget,
    info: &super::platform::RuntimeInfo,
) -> Result<(), AppError> {
    super::launcher::launch_with_command(terminal, project, info, command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_scripts_with_the_right_runner() {
        let json =
            r#"{"name":"x","scripts":{"dev":"next dev","build":"next build"}}"#;
        let mut got = parse_scripts(json, "pnpm");
        got.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "build");
        assert_eq!(got[0].command, "pnpm run build");
    }

    #[test]
    fn a_package_json_without_scripts_yields_nothing() {
        assert!(parse_scripts(r#"{"name":"x"}"#, "npm").is_empty());
    }

    /// A malformed package.json must not take the feature down with it.
    #[test]
    fn malformed_json_degrades_quietly() {
        assert!(parse_scripts("{ not json", "npm").is_empty());
        assert!(parse_scripts("", "npm").is_empty());
    }

    fn wsl_project(distro: &str) -> Project {
        Project::new(
            "med-store-management".to_string(),
            format!(
                "\\\\wsl.localhost\\{distro}\\home\\dev\\med-store-management"
            ),
            format!("\\\\wsl.localhost\\{distro}\\home\\dev"),
            distro.to_string(),
        )
    }

    /// ⭐ The reported failure. A WSL project whose distro is not in
    /// `running` reads no package.json, and the empty list that came back
    /// was indistinguishable from "this project declares no scripts" — so
    /// the UI said exactly that, and the user retried and it worked because
    /// by then the 5s running-distro memo had refreshed.
    ///
    /// No `wsl.exe` runs here: the stopped arm returns before `read_wsl`.
    #[test]
    fn a_stopped_distro_is_a_reason_and_never_a_claim_about_the_project() {
        let got = for_project(&wsl_project("Ubuntu"), &[], Some("pnpm"), &[]);

        assert!(got.scripts.is_empty(), "a stopped distro reads nothing");
        assert!(got.install.is_none(), "no package.json read, no install");
        let reason = got
            .reason
            .expect("a distro that was never asked must state why");
        assert!(reason.contains("Ubuntu"), "name the distro: {reason}");
        assert!(
            reason.contains("not running"),
            "say what is wrong: {reason}"
        );
        assert!(
            reason.contains("not a claim"),
            "must disown the old verdict, not restate it: {reason}"
        );
        assert!(
            !reason.contains("No dev scripts found"),
            "the sentence this replaces must not survive inside it: {reason}"
        );
    }

    /// The other half of the distinction: a running distro that genuinely
    /// has nothing to offer carries NO reason, so the caller is free to say
    /// "this project has no dev scripts" and mean it.
    #[test]
    fn a_windows_project_with_no_package_json_carries_no_reason() {
        let dir = std::env::temp_dir().join("devgo-scripts-empty");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let project = Project::new(
            "empty".to_string(),
            dir.to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
            "Windows".to_string(),
        );

        let got = for_project(&project, &[], None, &[]);

        assert!(got.scripts.is_empty());
        assert!(got.install.is_none(), "no package.json, no install entry");
        assert_eq!(
            got.reason, None,
            "nothing stopped us looking; the empty list IS the answer"
        );
    }

    /// A stopped distro withholds package.json, not `cargo run` — that one
    /// needs no file read at all, so the conventional entries still render.
    /// The reason rides along regardless, because the npm scripts really
    /// are missing and the log is the only place that can say so.
    #[test]
    fn conventional_commands_survive_a_stopped_distro() {
        let got = for_project(
            &wsl_project("Debian"),
            &["rust".to_string()],
            None,
            &[],
        );

        assert!(got.scripts.iter().any(|s| s.command == "cargo run"));
        assert!(got.reason.is_some(), "the package.json was still not read");
    }

    #[test]
    fn install_is_the_runners_own_install_never_ci() {
        for (pm, want) in [
            ("pnpm", "pnpm install"),
            ("bun", "bun install"),
            ("yarn", "yarn install"),
            ("npm", "npm install"),
        ] {
            assert_eq!(install_command(pm), want);
        }
        assert!(!install_command("npm").contains("ci"));
    }

    /// A package.json on disk yields the install entry under the detected
    /// runner; no runner (no lockfile yet) is npm, same as the scripts.
    #[test]
    fn a_package_json_offers_install_under_the_detected_runner() {
        let dir = std::env::temp_dir().join("devgo-scripts-install");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"name":"x","scripts":{"dev":"vite"}}"#,
        )
        .unwrap();
        let project = Project::new(
            "x".to_string(),
            dir.to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
            "Windows".to_string(),
        );

        for (pm, want) in [
            (Some("pnpm"), "pnpm install"),
            (Some("bun"), "bun install"),
            (Some("yarn"), "yarn install"),
            (None, "npm install"),
        ] {
            let got = for_project(&project, &[], pm, &[]);
            let install = got.install.expect("package.json read");
            assert_eq!(install.name, "Install");
            assert_eq!(install.command, want);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_node_stacks_get_conventional_commands() {
        let rust = conventional(&["rust".to_string()]);
        assert!(rust.iter().any(|s| s.command == "cargo run"));
        assert!(conventional(&["node".to_string()]).is_empty());
    }
}
