//! GitHub, through gh.
//!
//! The first module in DevGo that touches the network, and the rule that
//! lets it is narrow: only on an explicit ask, never on launch, on window
//! focus or inside the badge pass, and never on the UI thread. A fetch
//! that fails leaves the cache exactly as it was. DevGo never sees a
//! token: gh owns auth, so "not installed" and "not logged in" are typed
//! errors with the fix in them rather than an empty list that looks like
//! "you have no repos".
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

const CREATE_NO_WINDOW: u32 = 0x08000000;

// gh repo list caps at 1000 per call. the lane header shows the count, so
// a cap would be visible rather than silent
const LIST_LIMIT: &str = "1000";

const NOT_INSTALLED: &str = "GitHub CLI (gh) is not installed or not on PATH. Install it with: winget install GitHub.cli";

/// One repository, as the lane shows it. Flat on purpose: gh nests the
/// owner and the default branch, and neither nesting means anything to a
/// row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Repo {
    /// owner/name, the key the lane searches and the local mark matches on
    pub full_name: String,
    pub name: String,
    pub owner: String,
    /// https://github.com/owner/name, the same shape remote_to_url makes
    /// of a project's remote, which is what makes the local match a
    /// string compare
    pub url: String,
    /// RFC 3339 as gh prints it; the frontend renders it relative
    pub updated_at: String,
    pub private: bool,
    pub archived: bool,
    /// None for an empty repository: gh prints defaultBranchRef null for
    /// one with no commits, and one such repo must not fail the list
    pub default_branch: Option<String>,
}

/// The three states the auth answer can be in. login is the point: the
/// Settings line greets the user by it, and the lane compares an owner
/// against it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GhStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub login: Option<String>,
}

/// Run gh with args, or say why it could not run.
///
/// A missing executable is GhUnavailable with the install command; a
/// non-zero exit carries gh's own stderr, which for the not-logged-in
/// case already reads "To get started with GitHub CLI, please run: gh
/// auth login".
fn gh(args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("gh")
        .creation_flags(CREATE_NO_WINDOW)
        .args(args)
        .output()
        .map_err(|_| AppError::GhUnavailable(NOT_INSTALLED.into()))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(AppError::GhUnavailable(if err.is_empty() {
            format!("gh {} failed", args.join(" "))
        } else {
            err
        }))
    }
}

/// Installed? Logged in as whom? Answered without the network.
///
/// gh auth status validates the token against the API, a network call
/// and a slow one. gh config get -h github.com user reads the login
/// straight out of hosts.yml, which is what a status line that renders
/// on every Settings open can afford. An empty login is nobody logged in.
pub fn status() -> GhStatus {
    let version = match gh(&["--version"]) {
        Ok(text) => parse_version(&text),
        Err(_) => return GhStatus::default(),
    };
    let login = gh(&["config", "get", "-h", "github.com", "user"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    GhStatus {
        installed: true,
        version,
        login,
    }
}

// gh version 2.97.0 (2026-07-31) -> 2.97.0
fn parse_version(text: &str) -> Option<String> {
    text.lines()
        .next()?
        .split_whitespace()
        .nth(2)
        .map(str::to_string)
}

/// The login gh is authenticated as, or the typed not-logged-in error.
fn require_login() -> Result<String, AppError> {
    let s = status();
    if !s.installed {
        return Err(AppError::GhUnavailable(NOT_INSTALLED.into()));
    }
    s.login.ok_or_else(|| {
        AppError::GhUnavailable(
            "gh is installed but not logged in. Run: gh auth login".into(),
        )
    })
}

/// Every organisation the user belongs to. One gh api call; cached
/// beside the repos so Settings can draw its checkboxes offline.
pub fn list_orgs() -> Result<Vec<String>, AppError> {
    let text = gh(&["api", "user/orgs", "--paginate", "--jq", ".[].login"])?;
    Ok(text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect())
}

const REPO_FIELDS: &str =
    "name,owner,url,updatedAt,isPrivate,isArchived,defaultBranchRef";

/// The user's own repositories plus each listed org's, newest first.
///
/// One gh repo list per owner. About six seconds for a few hundred repos
/// on a good day and twenty on a slow one, which is why nothing calls
/// this on the UI thread.
pub fn list_repos(orgs: &[String]) -> Result<(String, Vec<Repo>), AppError> {
    let login = require_login()?;
    let mut repos = parse_repos(&gh(&[
        "repo",
        "list",
        "--json",
        REPO_FIELDS,
        "-L",
        LIST_LIMIT,
    ])?)?;
    for org in orgs {
        let text = gh(&[
            "repo",
            "list",
            org,
            "--json",
            REPO_FIELDS,
            "-L",
            LIST_LIMIT,
        ])?;
        repos.extend(parse_repos(&text)?);
    }
    // newest first across owners, so "the 20 most recently updated" on
    // the frontend is a slice, not a sort
    repos.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    repos.dedup_by(|a, b| a.full_name == b.full_name);
    Ok((login, repos))
}

// the shape gh repo list --json prints. private: the nested owner and
// default-branch objects are gh's business, Repo is ours
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhRepo {
    name: String,
    owner: GhOwner,
    url: String,
    updated_at: String,
    is_private: bool,
    is_archived: bool,
    default_branch_ref: Option<GhRef>,
}

#[derive(Deserialize)]
struct GhOwner {
    login: String,
}

#[derive(Deserialize)]
struct GhRef {
    name: String,
}

/// One gh repo list --json document, as rows.
pub fn parse_repos(text: &str) -> Result<Vec<Repo>, AppError> {
    let raw: Vec<GhRepo> = serde_json::from_str(text)?;
    Ok(raw
        .into_iter()
        .map(|r| Repo {
            full_name: format!("{}/{}", r.owner.login, r.name),
            name: r.name,
            owner: r.owner.login,
            url: r.url,
            updated_at: r.updated_at,
            private: r.is_private,
            archived: r.is_archived,
            default_branch: r.default_branch_ref.map(|b| b.name),
        })
        .collect())
}

/// The key two repo urls are compared on for the local mark.
///
/// GitInfo.remote has been through remote_to_url, so a GitHub remote is
/// already https://github.com/owner/repo, but it came from a human-typed
/// remote.origin.url: Owner/Repo and a trailing slash are both possible,
/// and GitHub treats neither as significant.
pub fn repo_key(url: &str) -> String {
    url.trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .to_ascii_lowercase()
}

/// Which rows are on this disk: full_name to the project's path.
///
/// remotes is every (project path, remote) the badge pass knows. A map
/// lookup per repo and no probe; chapter 10 already paid for the remote.
pub fn local_matches<'a>(
    repos: &[Repo],
    remotes: impl Iterator<Item = (&'a str, &'a str)>,
) -> HashMap<String, String> {
    let by_key: HashMap<String, &str> = remotes
        .map(|(path, remote)| (repo_key(remote), path))
        .collect();
    repos
        .iter()
        .filter_map(|r| {
            by_key
                .get(&repo_key(&r.url))
                .map(|p| (r.full_name.clone(), p.to_string()))
        })
        .collect()
}

/// The two clone urls a row offers, built from full_name rather than
/// parsed back out of url: the same fact, and this one is a format.
pub fn clone_urls(full_name: &str) -> (String, String) {
    (
        format!("git@github.com:{full_name}.git"),
        format!("https://github.com/{full_name}.git"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"[
      {"defaultBranchRef":{"name":"main"},"isArchived":false,"isPrivate":true,"name":"devgo-app-private","owner":{"id":"x","login":"joyahmed"},"updatedAt":"2026-09-11T18:48:35Z","url":"https://github.com/joyahmed/devgo-app-private"},
      {"defaultBranchRef":{"name":"master"},"isArchived":true,"isPrivate":false,"name":"old-thing","owner":{"id":"y","login":"joyahmed007"},"updatedAt":"2021-01-01T00:00:00Z","url":"https://github.com/joyahmed007/old-thing"},
      {"defaultBranchRef":null,"isArchived":false,"isPrivate":true,"name":"empty","owner":{"id":"x","login":"joyahmed"},"updatedAt":"2026-01-01T00:00:00Z","url":"https://github.com/joyahmed/empty"}
    ]"#;

    #[test]
    fn parses_user_and_org_repos() {
        let repos = parse_repos(SAMPLE).unwrap();
        assert_eq!(repos.len(), 3);
        assert_eq!(repos[0].full_name, "joyahmed/devgo-app-private");
        assert_eq!(repos[0].owner, "joyahmed");
        assert!(repos[0].private);
        assert!(!repos[0].archived);
        assert_eq!(repos[0].default_branch.as_deref(), Some("main"));

        assert_eq!(
            repos[1].full_name, "joyahmed007/old-thing",
            "an org repo keeps its org as owner"
        );
        assert!(repos[1].archived);
        assert!(!repos[1].private);
    }

    #[test]
    fn an_empty_repo_has_no_default_branch_and_does_not_fail_the_list() {
        let repos = parse_repos(SAMPLE).unwrap();
        assert_eq!(repos[2].default_branch, None);
    }

    #[test]
    fn malformed_json_is_an_error_not_an_empty_list() {
        assert!(parse_repos("{ nope").is_err());
    }

    #[test]
    fn local_match_ignores_case_suffix_and_trailing_slash() {
        let gh = repo_key("https://github.com/joyahmed/devgo-app-private");
        assert_eq!(
            gh,
            repo_key("https://github.com/JoyAhmed/DevGo-App-Private/")
        );
        assert_eq!(
            gh,
            repo_key("https://github.com/joyahmed/devgo-app-private.git")
        );
        assert_ne!(gh, repo_key("https://github.com/joyahmed/devgo-app"));
    }

    #[test]
    fn local_match_sees_through_remote_to_url() {
        use crate::services::git::remote_to_url;
        let from_ssh =
            remote_to_url("git@github.com:joyahmed/devgo-app-private.git")
                .unwrap();
        let from_https =
            remote_to_url("https://github.com/joyahmed/devgo-app-private.git")
                .unwrap();
        let gh = repo_key("https://github.com/joyahmed/devgo-app-private");
        assert_eq!(repo_key(&from_ssh), gh);
        assert_eq!(repo_key(&from_https), gh);
    }

    #[test]
    fn local_matches_pair_rows_with_disk_projects() {
        let repos = parse_repos(SAMPLE).unwrap();
        let remotes = [
            (
                r"G:\01_tauri\devgo-app-private",
                "https://github.com/JoyAhmed/devgo-app-private/",
            ),
            (r"G:\misc\unrelated", "https://gitlab.com/x/y"),
        ];
        let local =
            local_matches(&repos, remotes.iter().map(|(p, r)| (*p, *r)));
        assert_eq!(local.len(), 1);
        assert_eq!(
            local["joyahmed/devgo-app-private"],
            r"G:\01_tauri\devgo-app-private"
        );
    }

    #[test]
    fn version_line_parses() {
        assert_eq!(
            parse_version("gh version 2.97.0 (2026-07-31)\nhttps://…")
                .as_deref(),
            Some("2.97.0")
        );
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn clone_urls_come_from_the_full_name() {
        let (ssh, https) = clone_urls("joyahmed/devgo-app-private");
        assert_eq!(ssh, "git@github.com:joyahmed/devgo-app-private.git");
        assert_eq!(https, "https://github.com/joyahmed/devgo-app-private.git");
    }
}
