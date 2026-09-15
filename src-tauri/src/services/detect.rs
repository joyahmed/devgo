use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

use super::platform::wsl;
use super::scanner::distro_of;
use crate::models::Project;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// What a project appears to be, derived entirely from the names of the files
/// in its top directory.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ProjectTech {
    pub full_path: String,
    /// Stack tags, in the order declared by `MARKERS` so badges never reshuffle.
    pub tags: Vec<&'static str>,
    pub package_manager: Option<&'static str>,
    /// A `.nvmrc` or `.node-version` is present. The contents are not read here
    /// — that would be a second round trip per project for a string almost
    /// nothing consumes yet.
    pub pins_node_version: bool,
    /// Dependencies appear to be installed (`node_modules`, `target`, `.venv`).
    pub has_deps: bool,
}

/// Filename → tag. Order here is the order badges render in.
const MARKERS: &[(&str, &str)] = &[
    ("turbo.json", "turbo"),
    ("next.config.js", "next"),
    ("next.config.mjs", "next"),
    ("next.config.ts", "next"),
    ("Cargo.toml", "rust"),
    ("go.mod", "go"),
    ("pyproject.toml", "python"),
    ("requirements.txt", "python"),
    ("Dockerfile", "docker"),
    ("docker-compose.yml", "docker"),
    ("docker-compose.yaml", "docker"),
    ("package.json", "node"),
];

/// Lockfile → package manager. Checked in this order, so a repo carrying more
/// than one lockfile reports the more specific tool rather than whichever the
/// filesystem happened to list first.
const LOCKFILES: &[(&str, &str)] = &[
    ("bun.lock", "bun"),
    ("bun.lockb", "bun"),
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("package-lock.json", "npm"),
];

const DEP_DIRS: &[&str] = &["node_modules", "target", ".venv", "vendor"];
const NODE_VERSION_FILES: &[&str] = &[".nvmrc", ".node-version"];

/// Turn one directory listing into a verdict.
///
/// Everything is derived from names alone. That is the entire performance
/// story: one listing per project rather than eleven `stat` calls, which on a
/// WSL workspace would be eleven round trips across the 9p boundary.
fn classify(full_path: &str, names: &[String]) -> ProjectTech {
    let has = |n: &str| names.iter().any(|f| f == n);

    let mut tags: Vec<&'static str> = Vec::new();
    for (file, tag) in MARKERS {
        if has(file) && !tags.contains(tag) {
            tags.push(tag);
        }
    }

    // A Next.js or Turborepo project is also a Node project, but saying so adds
    // nothing — the specific tag is the useful one.
    if tags.iter().any(|t| *t == "next" || *t == "turbo") {
        tags.retain(|t| *t != "node");
    }

    ProjectTech {
        full_path: full_path.to_string(),
        tags,
        package_manager: LOCKFILES
            .iter()
            .find(|(file, _)| has(file))
            .map(|(_, pm)| *pm),
        pins_node_version: NODE_VERSION_FILES.iter().any(|f| has(f)),
        has_deps: DEP_DIRS.iter().any(|d| has(d)),
    }
}

fn list_windows(path: &str) -> Vec<String> {
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// One bash invocation lists every WSL project in a distro.
///
/// The alternative — a `read_dir` per project over `\\wsl.localhost\` — is one
/// 9p round trip per project *plus* one per entry returned. Doing it inside
/// Linux makes it a local `ls`.
fn list_wsl_batch(
    distro: &str,
    projects: &[&Project],
) -> HashMap<String, Vec<String>> {
    let mut linux_to_windows = HashMap::new();
    let mut script = String::from("set -f\n");
    for p in projects {
        let linux =
            super::platform::paths::windows_to_wsl_path(&p.full_path, distro);
        script.push_str(&format!(
            "printf '\\0P\\0{linux}\\0'\nls -A '{esc}' 2>/dev/null\n",
            esc = linux.replace('\'', "'\\''")
        ));
        linux_to_windows.insert(linux, p.full_path.clone());
    }

    let output = Command::new("wsl")
        .creation_flags(CREATE_NO_WINDOW)
        .env("WSL_UTF8", "1")
        .args(["-d", distro, "-e", "bash", "-c", &script])
        .output();

    let text = match output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).into_owned()
        }
        _ => return HashMap::new(),
    };

    let mut listings = HashMap::new();
    for record in text.split("\u{0}P\u{0}").skip(1) {
        let mut parts = record.splitn(2, '\u{0}');
        let linux = parts.next().unwrap_or("");
        let names = parts
            .next()
            .unwrap_or("")
            .lines()
            .map(|l| l.trim_end_matches('\r').to_string())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>();
        if let Some(win) = linux_to_windows.get(linux) {
            listings.insert(win.clone(), names);
        }
    }
    listings
}

/// Classify every project.
///
/// `running` is the live-distro list. A WSL project whose distro is stopped is
/// skipped for the same reason git is: a stack badge is never worth booting a
/// virtual machine for.
pub fn collect(projects: &[Project], running: &[String]) -> Vec<ProjectTech> {
    let mut by_distro: HashMap<String, Vec<&Project>> = HashMap::new();
    let mut windows: Vec<&Project> = Vec::new();

    for p in projects {
        match distro_of(&p.full_path) {
            Some(distro) if wsl::is_running(&distro, running) => {
                by_distro.entry(distro).or_default().push(p)
            }
            Some(_) => {}
            None => windows.push(p),
        }
    }

    let mut out = Vec::new();

    for (distro, group) in &by_distro {
        for (full_path, names) in list_wsl_batch(distro, group) {
            out.push(classify(&full_path, &names));
        }
    }

    for p in windows {
        out.push(classify(&p.full_path, &list_windows(&p.full_path)));
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tags_a_turborepo_without_also_saying_node() {
        let t = classify(
            "x",
            &names(&["turbo.json", "package.json", "pnpm-lock.yaml"]),
        );
        assert_eq!(t.tags, vec!["turbo"]);
        assert_eq!(t.package_manager, Some("pnpm"));
    }

    #[test]
    fn plain_node_projects_keep_the_node_tag() {
        let t = classify("x", &names(&["package.json", "package-lock.json"]));
        assert_eq!(t.tags, vec!["node"]);
        assert_eq!(t.package_manager, Some("npm"));
    }

    /// A polyglot repo should report every stack it actually contains.
    #[test]
    fn reports_multiple_stacks() {
        let t = classify("x", &names(&["Cargo.toml", "go.mod", "Dockerfile"]));
        assert_eq!(t.tags, vec!["rust", "go", "docker"]);
    }

    /// Badge order follows MARKERS, not the filesystem, so the UI is stable
    /// between scans.
    #[test]
    fn tag_order_is_deterministic() {
        let a =
            classify("x", &names(&["Dockerfile", "Cargo.toml", "turbo.json"]));
        let b =
            classify("x", &names(&["turbo.json", "Cargo.toml", "Dockerfile"]));
        assert_eq!(a.tags, b.tags);
        assert_eq!(a.tags, vec!["turbo", "rust", "docker"]);
    }

    #[test]
    fn detects_installed_dependencies_and_version_pins() {
        let t =
            classify("x", &names(&["package.json", "node_modules", ".nvmrc"]));
        assert!(t.has_deps);
        assert!(t.pins_node_version);

        let bare = classify("x", &names(&["package.json"]));
        assert!(!bare.has_deps);
        assert!(!bare.pins_node_version);
    }

    #[test]
    fn an_unrecognised_folder_gets_no_tags() {
        let t = classify("x", &names(&["notes.txt", "img.png"]));
        assert!(t.tags.is_empty());
        assert_eq!(t.package_manager, None);
    }

    /// Multiple lockfiles happen in migrations; report the more specific tool
    /// rather than whatever the listing happened to yield first.
    #[test]
    fn lockfile_precedence_is_stable() {
        let t = classify("x", &names(&["package-lock.json", "pnpm-lock.yaml"]));
        assert_eq!(t.package_manager, Some("pnpm"));
    }
}
