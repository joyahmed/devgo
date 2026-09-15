use serde::Serialize;

use super::platform::wsl;
use crate::models::Project;

// a nested folder is a project only if it says so. .git is a directory and
// is handled on its own in both walkers
const FILE_MARKERS: &[&str] = &[
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "requirements.txt",
];

// never entered: node_modules alone holds a thousand package.json files
const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "vendor",
    ".next",
    ".venv",
    ".svn",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    /// The workspace lives inside a WSL distro that is not currently running.
    /// Reading it would cold-boot the VM, so we decline.
    DistroStopped,
    /// The path does not resolve — an unplugged drive, or a virtual disk that
    /// has not finished attaching yet.
    NotMounted,
    AccessDenied,
}

pub enum ScanOutcome {
    Scanned(Vec<Project>),
    Unavailable(UnavailableReason),
}

fn detect_file_system(workspace: &str) -> &str {
    let normalized = super::platform::paths::normalize(workspace);
    if normalized.starts_with("//wsl.localhost/")
        || normalized.starts_with("//wsl$/")
    {
        "WSL"
    } else if normalized.starts_with("//") {
        // a UNC path that isn't WSL is a network share, slow for dev tooling
        "Network"
    } else {
        "Windows"
    }
}

/// The distro a workspace path belongs to, if it is a WSL-native path.
pub fn distro_of(path: &str) -> Option<String> {
    let normalized = super::platform::paths::normalize(path);
    for prefix in ["//wsl.localhost/", "//wsl$/"] {
        if let Some(rest) = normalized.strip_prefix(prefix) {
            return rest.split('/').find(|s| !s.is_empty()).map(String::from);
        }
    }
    None
}

/// Scan one workspace, one level deep.
///
/// `running` is the already-fetched list of live distros — passed in rather than
/// queried here so a multi-workspace scan spawns `wsl.exe` once, not once per
/// workspace.
///
/// `allow_boot` lifts the liveness gate. It must only ever be set from an
/// explicit user action (the Refresh control), never from startup or a timer.
pub fn scan_workspace(
    path: &str,
    running: &[String],
    allow_boot: bool,
    ignore: &[String],
) -> ScanOutcome {
    // A \\wsl.localhost\ path is served by the distro's 9p file server, so even
    // a bare read_dir cold-boots the entire VM. Checking liveness first costs
    // nothing — the check itself starts no distro — and lets us skip the path
    // entirely while it is stopped.
    if !allow_boot {
        if let Some(distro) = distro_of(path) {
            if !wsl::is_running(&distro, running) {
                return ScanOutcome::Unavailable(
                    UnavailableReason::DistroStopped,
                );
            }
        }
    }

    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) => {
            return ScanOutcome::Unavailable(match e.kind() {
                std::io::ErrorKind::PermissionDenied => {
                    UnavailableReason::AccessDenied
                }
                // NotFound covers a deleted folder; everything else here is a
                // drive that is absent or not ready, which reads the same to us.
                _ => UnavailableReason::NotMounted,
            });
        }
    };

    let fs_type = detect_file_system(path).to_string();

    let mut projects: Vec<Project> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let file_type = entry.file_type().ok()?;
            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden folders (.git, .vscode, .cache, ...) — they are
                // never projects and only clutter the list.
                if name.starts_with('.') {
                    return None;
                }
                // user-configured junk, matched by name on the listing we already have
                if ignore.iter().any(|ig| ig.eq_ignore_ascii_case(&name)) {
                    return None;
                }
                let full_path = entry.path().to_string_lossy().to_string();
                Some(Project::new(
                    name,
                    full_path,
                    path.to_string(),
                    fs_type.clone(),
                ))
            } else {
                None
            }
        })
        .collect();

    projects.sort_by_key(|p| p.name.to_lowercase());
    ScanOutcome::Scanned(projects)
}

fn is_pruned(name: &str, ignore: &[String]) -> bool {
    name.starts_with('.')
        || PRUNE_DIRS.iter().any(|p| p.eq_ignore_ascii_case(name))
        || ignore.iter().any(|ig| ig.eq_ignore_ascii_case(name))
}

fn has_marker(dir: &std::path::Path) -> bool {
    FILE_MARKERS.iter().any(|m| dir.join(m).exists())
        || dir.join(".git").exists()
}

// the path from the workspace root, forward slashes: `mono/apps/web`
fn relative_name(root: &std::path::Path, path: &std::path::Path) -> String {
    path.strip_prefix(root)
        .ok()
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignore_list_skips_matching_folders() {
        let dir = std::env::temp_dir().join("devgo-scan-ignore-test");
        let _ = std::fs::remove_dir_all(&dir);
        for name in ["web", "api", "node_modules", "Archive"] {
            std::fs::create_dir_all(dir.join(name)).unwrap();
        }
        let path = dir.to_string_lossy().to_string();

        let ignore = vec!["node_modules".to_string(), "archive".to_string()];
        let ScanOutcome::Scanned(projects) =
            scan_workspace(&path, &[], false, &ignore)
        else {
            panic!("local temp dir should scan");
        };
        let mut names: Vec<_> =
            projects.iter().map(|p| p.name.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["api", "web"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classifies_filesystem_kinds() {
        assert_eq!(detect_file_system(r"G:\01_tauri"), "Windows");
        assert_eq!(
            detect_file_system(r"\\wsl.localhost\Ubuntu-26.04\home"),
            "WSL"
        );
        assert_eq!(detect_file_system(r"\\wsl$\Debian\home"), "WSL");
        assert_eq!(detect_file_system(r"\\nas\share\projects"), "Network");
    }

    #[test]
    fn extracts_distro_from_wsl_paths() {
        assert_eq!(
            distro_of(r"\\wsl.localhost\Ubuntu-26.04\home\joy").as_deref(),
            Some("Ubuntu-26.04")
        );
        assert_eq!(distro_of(r"\\wsl$\Debian\home").as_deref(), Some("Debian"));
        assert_eq!(distro_of(r"G:\01_tauri"), None);
    }

    /// The gate must refuse a stopped distro rather than touching the path.
    #[test]
    fn stopped_distro_is_unavailable_without_touching_the_path() {
        let outcome = scan_workspace(
            r"\\wsl.localhost\Ubuntu-26.04\home\joy",
            &[],
            false,
            &[],
        );
        assert!(matches!(
            outcome,
            ScanOutcome::Unavailable(UnavailableReason::DistroStopped)
        ));
    }

    #[test]
    fn missing_local_path_is_not_mounted() {
        let outcome =
            scan_workspace(r"Q:\definitely\not\here", &[], false, &[]);
        assert!(matches!(
            outcome,
            ScanOutcome::Unavailable(UnavailableReason::NotMounted)
        ));
    }
}
