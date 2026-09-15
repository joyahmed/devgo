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

pub fn rename(
    mut groups: Vec<GithubGroup>,
    from: &str,
    to: &str,
) -> Result<Vec<GithubGroup>, AppError> {
    let name = valid_name(&groups, to, Some(from))?;
    match groups.iter_mut().find(|g| g.name == from) {
        Some(g) => {
            g.name = name;
            Ok(groups)
        }
        None => Err(AppError::GroupRefused(format!("No group called {from}"))),
    }
}

/// Delete the group. Its repos are labels, not files: nothing else changes.
pub fn delete(mut groups: Vec<GithubGroup>, name: &str) -> Vec<GithubGroup> {
    groups.retain(|g| g.name != name);
    groups
}

/// Reorder by name list. The workspace reorder's rule (chapter 31): the
/// order must be a permutation of what is stored, or it would drop
/// whatever the client did not know about.
pub fn reorder(
    groups: Vec<GithubGroup>,
    order: &[String],
) -> Result<Vec<GithubGroup>, AppError> {
    if order.len() != groups.len()
        || !groups.iter().all(|g| order.contains(&g.name))
    {
        return Err(AppError::GroupRefused(format!(
            "The order names {} groups but {} are stored. The list changed; refresh and try again",
            order.len(),
            groups.len()
        )));
    }
    let mut out = Vec::with_capacity(groups.len());
    for name in order {
        if let Some(g) = groups.iter().find(|g| &g.name == name) {
            out.push(g.clone());
        }
    }
    Ok(out)
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
    fn names_are_trimmed_unique_and_never_empty() {
        assert!(assign(vec![], "  ", "o/r").is_err());
        let groups = vec![g("zetta", &[]), g("clients", &[])];
        assert!(
            rename(groups.clone(), "clients", "Zetta").is_err(),
            "case-insensitive clash"
        );
        assert!(
            rename(groups.clone(), "clients", "clients").is_ok(),
            "renaming to itself is fine"
        );
        let renamed = rename(groups.clone(), "clients", "  old  ").unwrap();
        assert_eq!(renamed[1].name, "old");
        assert!(rename(groups, "nope", "x").is_err());
    }

    #[test]
    fn delete_removes_the_label_only() {
        let groups = vec![g("a", &["o/r"]), g("b", &["o/r"])];
        let left = delete(groups, "a");
        assert_eq!(left, vec![g("b", &["o/r"])]);
    }

    #[test]
    fn reorder_must_be_a_permutation() {
        let groups = vec![g("a", &[]), g("b", &[]), g("c", &[])];
        let ok = reorder(groups.clone(), &["c".into(), "a".into(), "b".into()])
            .unwrap();
        assert_eq!(
            ok.iter().map(|g| g.name.as_str()).collect::<Vec<_>>(),
            ["c", "a", "b"]
        );
        assert!(
            reorder(groups.clone(), &["c".into(), "a".into()]).is_err(),
            "one missing"
        );
        assert!(
            reorder(groups, &["c".into(), "a".into(), "x".into()]).is_err(),
            "one unknown"
        );
    }

    #[test]
    fn a_group_round_trips_through_json_without_repos() {
        let g: GithubGroup = serde_json::from_str(r#"{"name":"old"}"#).unwrap();
        assert!(g.repos.is_empty());
    }
}
