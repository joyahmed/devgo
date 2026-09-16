use serde::Serialize;

#[cfg(windows)]
use super::platform::{paths, wsl};

/// A candidate workspace root to suggest on an empty first run.
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredRoot {
    pub path: String,
    pub label: String,
    pub kind: &'static str,
}

#[cfg(windows)]
const SUBDIRS: &[&str] = &["projects", "dev", "code", "src", "work"];

/// Windows roots are cheap is_dir checks. WSL roots come from running distros
/// only, so this never boots one. Fired from a button, never on launch.
#[cfg(windows)]
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
#[cfg(windows)]
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

// where a mac keeps its code, most likely first: ~/Projects, ~/Developer
// (the folder finder gives a hammer icon), then the names the windows and
// wsl lists check
#[cfg(not(windows))]
const HOME_SUBDIRS: &[&str] = &[
    "Projects",
    "Developer",
    "code",
    "dev",
    "src",
    "work",
    "projects",
];

/// One filesystem, so one list: cheap is_dir checks under $HOME. No distro
/// loop to skip; a Mac should not even ask.
#[cfg(not(windows))]
pub fn discover() -> Vec<DiscoveredRoot> {
    match std::env::var("HOME") {
        Ok(home) => home_roots(std::path::Path::new(&home)),
        Err(_) => Vec::new(),
    }
}

// apfs is case-insensitive by default, so ~/Projects and ~/projects are
// the same folder and both pass is_dir. a root is kept only if its
// canonical path has not been seen; the list's spelling wins the label
#[cfg(not(windows))]
fn home_roots(home: &std::path::Path) -> Vec<DiscoveredRoot> {
    let mut seen: Vec<std::path::PathBuf> = Vec::new();
    let mut out: Vec<DiscoveredRoot> = Vec::new();
    for sub in HOME_SUBDIRS {
        let path = home.join(sub);
        if !path.is_dir() {
            continue;
        }
        let Ok(canonical) = std::fs::canonicalize(&path) else {
            continue;
        };
        if seen.contains(&canonical) {
            continue;
        }
        seen.push(canonical);
        out.push(DiscoveredRoot {
            path: path.to_string_lossy().into_owned(),
            label: format!("~/{sub}"),
            kind: "local",
        });
    }
    out
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn home_roots_keep_list_order_and_fold_case_twins() {
        let home = std::env::temp_dir().join("devgo-discover-home");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join("code")).unwrap();
        std::fs::create_dir_all(home.join("Projects")).unwrap();
        std::fs::write(home.join("dev"), "a file, not a folder").unwrap();

        let roots = home_roots(&home);
        let labels: Vec<_> = roots.iter().map(|r| r.label.as_str()).collect();
        // Projects first by list order, not creation order; dev is a file;
        // on a case-insensitive disk projects resolves to Projects and is
        // folded, on a case-sensitive one it does not exist
        assert_eq!(labels, ["~/Projects", "~/code"], "{roots:?}");
        assert!(roots.iter().all(|r| r.kind == "local"));
        assert_eq!(roots[0].path, home.join("Projects").to_string_lossy());

        let _ = std::fs::remove_dir_all(&home);
    }
}
