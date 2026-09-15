use serde::Serialize;

use super::platform::{paths, wsl};

/// A candidate workspace root to suggest on an empty first run.
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredRoot {
    pub path: String,
    pub label: String,
    pub kind: &'static str,
}

const SUBDIRS: &[&str] = &["projects", "dev", "code", "src", "work"];

/// Windows roots are cheap is_dir checks. WSL roots come from running distros
/// only, so this never boots one. Fired from a button, never on launch.
pub fn discover() -> Vec<DiscoveredRoot> {
    let mut out: Vec<DiscoveredRoot> = Vec::new();

    if let Ok(home) = std::env::var("USERPROFILE") {
        for sub in SUBDIRS {
            let path = format!("{home}\\{sub}");
            if std::path::Path::new(&path).is_dir() {
                out.push(DiscoveredRoot {
                    label: format!("~\\{sub}"),
                    path,
                    kind: "windows",
                });
            }
        }
        // where visual studio puts things
        let vs = format!("{home}\\source\\repos");
        if std::path::Path::new(&vs).is_dir() {
            out.push(DiscoveredRoot {
                label: "~\\source\\repos".into(),
                path: vs,
                kind: "windows",
            });
        }
    }

    for root in ["C:\\dev", "C:\\projects", "C:\\src"] {
        if std::path::Path::new(root).is_dir() {
            out.push(DiscoveredRoot {
                path: root.to_string(),
                label: root.to_string(),
                kind: "windows",
            });
        }
    }

    for distro in wsl::running_distros() {
        for linux in wsl_project_dirs(&distro) {
            out.push(DiscoveredRoot {
                path: paths::wsl_to_windows_path(&linux, &distro),
                label: format!(
                    "{distro} · {}",
                    linux.replacen("/home/", "~/", 1)
                ),
                kind: "wsl",
            });
        }
    }

    out
}

// one spawn per running distro, the tests run inside it
fn wsl_project_dirs(distro: &str) -> Vec<String> {
    let list = SUBDIRS
        .iter()
        .map(|s| format!("\"$HOME/{s}\""))
        .collect::<Vec<_>>()
        .join(" ");
    let script =
        format!("for d in {list}; do [ -d \"$d\" ] && echo \"$d\"; done");

    // this gated on status.success() and so found nothing whenever the last
    // candidate ($HOME/work) was missing: the loop had printed the roots that
    // exist, then exited 1
    wsl::probe_lines(distro, &script)
}
