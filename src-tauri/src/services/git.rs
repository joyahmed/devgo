use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

use super::platform::wsl;
use super::scanner::distro_of;
use crate::models::Project;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// How many Windows projects to interrogate at once. Each is three short-lived
/// `git` processes; unbounded spawning on a large workspace is worse than the
/// wait it saves.
const MAX_PARALLEL: usize = 8;

#[derive(Debug, Clone, Default, Serialize)]
pub struct GitInfo {
    pub full_path: String,
    pub branch: Option<String>,
    pub dirty: bool,
    pub remote: Option<String>,
    /// Unix seconds of the last commit, for "recently worked on" sorting.
    pub last_commit: u64,
}

/// Parse `git status --porcelain=v2 --branch`.
///
/// One invocation yields both facts we want: `# branch.head <name>` carries the
/// branch, and any line that is not a `#` header is a changed file, so the
/// presence of one means dirty.
fn parse_status(text: &str) -> (Option<String>, bool) {
    let mut branch = None;
    let mut dirty = false;
    for line in text.lines() {
        let line = line.trim_end();
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            // A detached HEAD reports "(detached)", which is worth showing as-is.
            branch = Some(rest.trim().to_string());
        } else if !line.starts_with('#') && !line.is_empty() {
            dirty = true;
        }
    }
    (branch, dirty)
}

/// Normalize a git remote into something a browser can open.
///
/// `git@github.com:joyahmed/devgo.git` and
/// `https://github.com/joyahmed/devgo.git` should both land on the same page.
pub fn remote_to_url(remote: &str) -> Option<String> {
    let remote = remote.trim().trim_end_matches(".git");
    if remote.is_empty() {
        return None;
    }
    if let Some(rest) = remote.strip_prefix("git@") {
        // host:owner/repo -> https://host/owner/repo
        let (host, path) = rest.split_once(':')?;
        return Some(format!("https://{host}/{path}"));
    }
    if let Some(rest) = remote.strip_prefix("ssh://git@") {
        return Some(format!("https://{rest}"));
    }
    if remote.starts_with("http://") || remote.starts_with("https://") {
        return Some(remote.to_string());
    }
    None
}

fn git_windows(path: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .creation_flags(CREATE_NO_WINDOW)
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        // Not a repository, or git is absent. Either way: degrade silently.
        None
    }
}

fn read_windows(project: &Project) -> GitInfo {
    let mut info = GitInfo {
        full_path: project.full_path.clone(),
        ..Default::default()
    };

    // Cheap gate: skip the process spawns entirely for non-repositories.
    if !std::path::Path::new(&project.full_path)
        .join(".git")
        .exists()
    {
        return info;
    }

    if let Some(text) = git_windows(
        &project.full_path,
        &["status", "--porcelain=v2", "--branch"],
    ) {
        let (branch, dirty) = parse_status(&text);
        info.branch = branch;
        info.dirty = dirty;
    }
    info.remote = git_windows(
        &project.full_path,
        &["config", "--get", "remote.origin.url"],
    )
    .and_then(|s| remote_to_url(&s));
    info.last_commit =
        git_windows(&project.full_path, &["log", "-1", "--format=%ct"])
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);

    info
}

/// Build one shell script that walks every WSL project in a distro.
///
/// The alternative — one `wsl.exe` per project — costs ~80ms of process startup
/// each. Batching means a single spawn no matter how many projects, with the
/// git calls running natively inside Linux where they are cheap.
fn wsl_script(linux_paths: &[String]) -> String {
    let mut script = String::from("set -f\n");
    for path in linux_paths {
        let p = path.replace('\'', "'\\''");
        script.push_str(&format!(
            "printf '\\0PROJECT\\0{path}\\0'\n\
             git -C '{p}' status --porcelain=v2 --branch 2>/dev/null\n\
             printf '\\0REMOTE\\0'\n\
             git -C '{p}' config --get remote.origin.url 2>/dev/null\n\
             printf '\\0COMMIT\\0'\n\
             git -C '{p}' log -1 --format=%ct 2>/dev/null\n"
        ));
    }
    script
}

fn parse_wsl_output(
    text: &str,
    windows_paths: &HashMap<String, String>,
) -> Vec<GitInfo> {
    let mut out = Vec::new();

    // Records look like: \0PROJECT\0<linux path>\0<status>\0REMOTE\0<url>\0COMMIT\0<ts>
    for record in text.split("\u{0}PROJECT\u{0}").skip(1) {
        let mut parts = record.split('\u{0}');
        let linux_path = parts.next().unwrap_or("").to_string();
        let status = parts.next().unwrap_or("");
        let rest: Vec<&str> = parts.collect();
        let remote = rest
            .iter()
            .position(|p| *p == "REMOTE")
            .and_then(|i| rest.get(i + 1).copied())
            .unwrap_or("");
        let commit = rest
            .iter()
            .position(|p| *p == "COMMIT")
            .and_then(|i| rest.get(i + 1).copied())
            .unwrap_or("");

        let Some(full_path) = windows_paths.get(&linux_path) else {
            continue;
        };
        let (branch, dirty) = parse_status(status);
        out.push(GitInfo {
            full_path: full_path.clone(),
            branch,
            dirty,
            remote: remote_to_url(remote),
            last_commit: commit.trim().parse().unwrap_or(0),
        });
    }
    out
}

fn read_wsl_batch(distro: &str, projects: &[&Project]) -> Vec<GitInfo> {
    let mut windows_paths = HashMap::new();
    let mut linux_paths = Vec::new();
    for p in projects {
        let linux =
            super::platform::paths::windows_to_wsl_path(&p.full_path, distro);
        windows_paths.insert(linux.clone(), p.full_path.clone());
        linux_paths.push(linux);
    }

    let output = Command::new("wsl")
        .creation_flags(CREATE_NO_WINDOW)
        .env("WSL_UTF8", "1")
        .args(["-d", distro, "-e", "bash", "-c", &wsl_script(&linux_paths)])
        .output();

    match output {
        Ok(out) if out.status.success() => parse_wsl_output(
            &String::from_utf8_lossy(&out.stdout),
            &windows_paths,
        ),
        _ => Vec::new(),
    }
}

/// Read git state for every project.
///
/// `running` is the live-distro list. A WSL project whose distro is stopped is
/// skipped entirely — shelling `wsl git` would cold-boot the VM, which is the
/// exact behaviour the scan gate exists to prevent. Git state is a nicety; it
/// is never worth starting a virtual machine for.
pub fn collect(projects: &[Project], running: &[String]) -> Vec<GitInfo> {
    let mut by_distro: HashMap<String, Vec<&Project>> = HashMap::new();
    let mut windows: Vec<&Project> = Vec::new();

    for p in projects {
        match distro_of(&p.full_path) {
            Some(distro) if wsl::is_running(&distro, running) => {
                by_distro.entry(distro).or_default().push(p);
            }
            // Stopped distro: no git, no boot.
            Some(_) => {}
            None => windows.push(p),
        }
    }

    let mut results: Vec<GitInfo> = Vec::new();

    for (distro, group) in &by_distro {
        results.extend(read_wsl_batch(distro, group));
    }

    for group in windows.chunks(MAX_PARALLEL) {
        std::thread::scope(|s| {
            let handles: Vec<_> =
                group.iter().map(|p| s.spawn(|| read_windows(p))).collect();
            for h in handles {
                if let Ok(info) = h.join() {
                    results.push(info);
                }
            }
        });
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_clean_state() {
        let text = "# branch.oid abc123\n# branch.head main\n# branch.upstream origin/main\n";
        assert_eq!(parse_status(text), (Some("main".into()), false));
    }

    #[test]
    fn any_non_header_line_means_dirty() {
        let text = "# branch.head main\n1 .M N... 100644 100644 100644 aaa bbb src/lib.rs\n";
        assert_eq!(parse_status(text), (Some("main".into()), true));
    }

    #[test]
    fn detached_head_is_reported_as_is() {
        let text = "# branch.oid abc\n# branch.head (detached)\n";
        assert_eq!(parse_status(text).0, Some("(detached)".into()));
    }

    #[test]
    fn empty_output_is_not_a_repo() {
        assert_eq!(parse_status(""), (None, false));
    }

    #[test]
    fn normalizes_ssh_remotes_to_browsable_urls() {
        assert_eq!(
            remote_to_url("git@github.com:joyahmed/devgo-app-private.git")
                .as_deref(),
            Some("https://github.com/joyahmed/devgo-app-private")
        );
        assert_eq!(
            remote_to_url("ssh://git@gitlab.com/group/repo.git").as_deref(),
            Some("https://gitlab.com/group/repo")
        );
        assert_eq!(
            remote_to_url("https://github.com/joyahmed/devgo.git").as_deref(),
            Some("https://github.com/joyahmed/devgo")
        );
    }

    /// A local path or an unrecognised scheme must not produce a link we would
    /// then hand to the OS to open.
    #[test]
    fn refuses_unbrowsable_remotes() {
        assert_eq!(remote_to_url(""), None);
        assert_eq!(remote_to_url("/srv/git/repo.git"), None);
        assert_eq!(remote_to_url("file:///srv/git/repo"), None);
    }

    #[test]
    fn wsl_script_escapes_quotes_in_paths() {
        let script = wsl_script(&["/home/joy/it's".to_string()]);
        assert!(script.contains(r"'/home/joy/it'\''s'"), "got: {script}");
    }

    #[test]
    fn parses_batched_wsl_output() {
        let mut map = HashMap::new();
        map.insert(
            "/home/joy/a".to_string(),
            r"\\wsl.localhost\D\home\joy\a".to_string(),
        );
        let text = "\u{0}PROJECT\u{0}/home/joy/a\u{0}# branch.head main\n1 .M x\n\
                    \u{0}REMOTE\u{0}git@github.com:o/r.git\n\u{0}COMMIT\u{0}1700000000\n";
        let out = parse_wsl_output(text, &map);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].branch.as_deref(), Some("main"));
        assert!(out[0].dirty);
        assert_eq!(out[0].remote.as_deref(), Some("https://github.com/o/r"));
        assert_eq!(out[0].last_commit, 1_700_000_000);
    }
}
