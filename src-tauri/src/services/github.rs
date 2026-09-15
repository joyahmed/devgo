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

use serde::{Deserialize, Serialize};

use crate::error::AppError;

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
    fn clone_urls_come_from_the_full_name() {
        let (ssh, https) = clone_urls("joyahmed/devgo-app-private");
        assert_eq!(ssh, "git@github.com:joyahmed/devgo-app-private.git");
        assert_eq!(https, "https://github.com/joyahmed/devgo-app-private.git");
    }
}
