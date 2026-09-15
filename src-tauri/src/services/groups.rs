//! Named groups inside the GitHub list.
//!
//! A group is a label, not a folder: a repo can be in several, and
//! deleting a group touches no repo. Groups are keyed by full_name, so a
//! repository that vanishes from GitHub stays in its group (the rows show
//! it dimmed as gone until someone removes it), never silently dropped by
//! a refresh. Every edit is a pure function on the list, tested as data;
//! the store and the command only persist what these return.
use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GithubGroup {
    pub name: String,
    #[serde(default)]
    pub repos: Vec<String>,
}

// the name as stored: trimmed. empty is refused; a duplicate (case-
// insensitive) is refused, two groups called zetta and Zetta are one mistake
fn valid_name(
    groups: &[GithubGroup],
    name: &str,
    except: Option<&str>,
) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::GroupRefused("A group needs a name".into()));
    }
    let clash = groups.iter().any(|g| {
        g.name.eq_ignore_ascii_case(name)
            && except.is_none_or(|e| !g.name.eq_ignore_ascii_case(e))
    });
    if clash {
        return Err(AppError::GroupRefused(format!(
            "There is already a group called {name}"
        )));
    }
    Ok(name.to_string())
}

/// Put repo in group, creating the group if it does not exist. Idempotent.
pub fn assign(
    mut groups: Vec<GithubGroup>,
    group: &str,
    repo: &str,
) -> Result<Vec<GithubGroup>, AppError> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err(AppError::GroupRefused("No repository named".into()));
    }
    match groups
        .iter_mut()
        .find(|g| g.name.eq_ignore_ascii_case(group.trim()))
    {
        Some(g) => {
            if !g.repos.iter().any(|r| r == repo) {
                g.repos.push(repo.to_string());
            }
        }
        None => {
            let name = valid_name(&groups, group, None)?;
            groups.push(GithubGroup {
                name,
                repos: vec![repo.to_string()],
            });
        }
    }
    Ok(groups)
}

/// Take repo out of group. A group left empty stays: it is the user's,
/// and an empty group is a place to put the next repo.
pub fn unassign(
    mut groups: Vec<GithubGroup>,
    group: &str,
    repo: &str,
) -> Vec<GithubGroup> {
    if let Some(g) = groups.iter_mut().find(|g| g.name == group) {
        g.repos.retain(|r| r != repo);
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(name: &str, repos: &[&str]) -> GithubGroup {
        GithubGroup {
            name: name.into(),
            repos: repos.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn assign_creates_then_is_idempotent() {
        let groups = assign(vec![], "zetta", "joyahmed/zetta-hrm").unwrap();
        assert_eq!(groups, vec![g("zetta", &["joyahmed/zetta-hrm"])]);
        let again =
            assign(groups.clone(), "zetta", "joyahmed/zetta-hrm").unwrap();
        assert_eq!(again, groups, "assigning twice is one membership");
        let more = assign(again, "ZETTA", "joyahmed/zetta-cloud").unwrap();
        assert_eq!(
            more[0].repos.len(),
            2,
            "the group name matches case-insensitively"
        );
    }

    #[test]
    fn a_repo_can_be_in_two_groups_and_leaves_one_at_a_time() {
        let groups =
            assign(assign(vec![], "a", "o/r").unwrap(), "b", "o/r").unwrap();
        assert_eq!(groups.len(), 2);
        let left = unassign(groups, "a", "o/r");
        assert!(left[0].repos.is_empty(), "the empty group stays");
        assert_eq!(left[1].repos, vec!["o/r"]);
    }

    #[test]
    fn a_group_round_trips_through_json_without_repos() {
        let g: GithubGroup = serde_json::from_str(r#"{"name":"old"}"#).unwrap();
        assert!(g.repos.is_empty());
    }
}
