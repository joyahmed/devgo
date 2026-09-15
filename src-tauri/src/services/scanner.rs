use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

use super::platform::wsl;
use crate::models::Project;

const CREATE_NO_WINDOW: u32 = 0x08000000;

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

fn scan_windows_nested(
    root: &str,
    depth: usize,
    ignore: &[String],
) -> ScanOutcome {
    let root_path = std::path::Path::new(root);
    let entries = match std::fs::read_dir(root_path) {
        Ok(e) => e,
        Err(e) => {
            return ScanOutcome::Unavailable(match e.kind() {
                std::io::ErrorKind::PermissionDenied => {
                    UnavailableReason::AccessDenied
                }
                _ => UnavailableReason::NotMounted,
            })
        }
    };
    let fs_type = detect_file_system(root).to_string();
    let mut out = Vec::new();
    walk_windows(entries, root_path, 1, depth, ignore, &fs_type, &mut out);
    out.sort_by_key(|p| p.name.to_lowercase());
    ScanOutcome::Scanned(out)
}

// a sub-read that fails is a missing branch, not an unavailable workspace;
// only the root read decides that
fn walk_windows(
    entries: std::fs::ReadDir,
    root: &std::path::Path,
    level: usize,
    max: usize,
    ignore: &[String],
    fs_type: &str,
    out: &mut Vec<Project>,
) {
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_pruned(&name, ignore) {
            continue;
        }
        let path = entry.path();
        // every immediate child is a project; deeper only if marked
        if level == 1 || has_marker(&path) {
            out.push(Project::new(
                relative_name(root, &path),
                path.to_string_lossy().into_owned(),
                root.to_string_lossy().into_owned(),
                fs_type.to_string(),
            ));
        }
        if level < max {
            if let Ok(sub) = std::fs::read_dir(&path) {
                walk_windows(sub, root, level + 1, max, ignore, fs_type, out);
            }
        }
    }
}

// the distro walks, in one spawn: five levels of reads on ext4 instead of
// one 9p round trip per folder
fn scan_wsl_nested(
    path: &str,
    distro: &str,
    depth: usize,
    ignore: &[String],
) -> ScanOutcome {
    let linux_root = super::platform::paths::windows_to_wsl_path(path, distro);
    let script = wsl_find_script(&linux_root, depth, ignore);

    let output = Command::new("wsl")
        .creation_flags(CREATE_NO_WINDOW)
        .env("WSL_UTF8", "1")
        .args(["-d", distro, "-e", "bash", "-lc", &script])
        .output();

    let text = match output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).into_owned()
        }
        // ran and found nothing: an empty scan. only a failed spawn is
        // unavailable
        Ok(_) => String::new(),
        Err(_) => {
            return ScanOutcome::Unavailable(UnavailableReason::NotMounted)
        }
    };

    let prefix = format!("{linux_root}/");
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for line in text
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.is_empty())
    {
        // the root's own .git names the workspace, not a project; a folder
        // with two markers prints twice
        if line == linux_root || !seen.insert(line.to_string()) {
            continue;
        }
        let rel = line.strip_prefix(&prefix).unwrap_or(line);
        if rel.is_empty() {
            continue;
        }
        out.push(Project::new(
            rel.to_string(),
            super::platform::paths::wsl_to_windows_path(line, distro),
            path.to_string(),
            "WSL".to_string(),
        ));
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    ScanOutcome::Scanned(out)
}

// two finds: every immediate child, then every deeper folder with a marker.
// %h prints the folder that holds the match, so depth N needs find at N+1
fn wsl_find_script(root: &str, depth: usize, ignore: &[String]) -> String {
    let q = |s: &str| s.replace('\'', "'\\''");
    let root_q = q(root);

    let mut prune: Vec<String> =
        PRUNE_DIRS.iter().map(|s| s.to_string()).collect();
    prune.extend(ignore.iter().cloned());
    let not_names = prune
        .iter()
        .map(|n| format!("! -name '{}'", q(n)))
        .collect::<Vec<_>>()
        .join(" ");
    let prune_or = prune
        .iter()
        .map(|n| format!("-name '{}'", q(n)))
        .collect::<Vec<_>>()
        .join(" -o ");
    let file_markers = FILE_MARKERS
        .iter()
        .map(|m| format!("-name '{m}'"))
        .collect::<Vec<_>>()
        .join(" -o ");
    let marker_depth = depth + 1;

    format!(
        "find '{root_q}' -mindepth 1 -maxdepth 1 -type d ! -name '.*' {not_names} -print 2>/dev/null; \
         find '{root_q}' -mindepth 1 -maxdepth {marker_depth} \
           \\( -type d -name '.git' -printf '%h\\n' -prune \\) -o \
           \\( {prune_or} -o -name '.*' \\) -prune -o \
           -type f \\( {file_markers} \\) -printf '%h\\n' 2>/dev/null"
    )
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
