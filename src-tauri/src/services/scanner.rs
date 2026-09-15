use serde::Serialize;

use super::platform::wsl;
use crate::models::Project;

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

#[cfg(test)]
mod tests {
    use super::*;

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
