//! GitHub, through gh.
//!
//! The first module in DevGo that touches the network, and the rule that
//! lets it is narrow: only on an explicit ask, never on launch, on window
//! focus or inside the badge pass, and never on the UI thread. A fetch
//! that fails leaves the cache exactly as it was. DevGo never sees a
//! token: gh owns auth, so "not installed" and "not logged in" are typed
//! errors with the fix in them rather than an empty list that looks like
//! "you have no repos".
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::platform::Quiet;
use crate::error::AppError;

// gh repo list caps at 1000 per call. the lane header shows the count, so
// a cap would be visible rather than silent
const LIST_LIMIT: &str = "1000";

const NOT_INSTALLED: &str = "GitHub CLI (gh) is not installed or not on PATH. Install it with: winget install GitHub.cli";

/// How old the cache may be before the lane's first open in a session
/// asks for a fresh one. Six hours: a repo pushed this morning is there
/// by lunch, and a machine that opens DevGo ten times a day fetches once
/// or twice.
pub const STALE_AFTER_SECS: u64 = 6 * 60 * 60;

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
    /// put here by hand (add repo by name), not by gh repo list. a refresh
    /// keeps these: they are not the user's repos, so the list would never
    /// bring them back on its own
    #[serde(default)]
    pub added: bool,
    /// only a live search hit carries this, the one field that helps
    /// rank strangers' repositories. None for the user's own list
    #[serde(default)]
    pub stars: Option<u64>,
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

/// What github-cache.json holds. orgs is every org the last refresh
/// found; the Settings panel draws its checkboxes from this list so it
/// never has to ask the network to render.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GithubCache {
    pub fetched_at: u64,
    #[serde(default)]
    pub login: Option<String>,
    #[serde(default)]
    pub orgs: Vec<String>,
    #[serde(default)]
    pub repos: Vec<Repo>,
}

/// The on-disk cache, the same shape as every store since chapter 22:
/// parse_or_backup on read, so a corrupt file becomes .bak rather than
/// being overwritten.
#[derive(Debug)]
pub struct GithubStore {
    cache: GithubCache,
    file_path: PathBuf,
}

impl GithubStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;
        let file_path = app_data_dir.join("github-cache.json");
        let cache = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            super::config_io::parse_or_backup(&file_path, &data)
        } else {
            GithubCache::default()
        };
        Ok(Self { cache, file_path })
    }

    pub fn get(&self) -> GithubCache {
        self.cache.clone()
    }

    /// Replace the fetched list, keeping every hand-added row the fetch
    /// did not return: the merge that makes add-by-name survive a refresh.
    pub fn store(&mut self, mut cache: GithubCache) -> Result<(), AppError> {
        let fetched: HashSet<String> =
            cache.repos.iter().map(|r| r.full_name.clone()).collect();
        let kept: Vec<Repo> = self
            .cache
            .repos
            .iter()
            .filter(|r| r.added && !fetched.contains(&r.full_name))
            .cloned()
            .collect();
        cache.repos.extend(kept);
        cache.repos.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        self.cache = cache;
        self.save()
    }

    /// Add one row by hand, replacing a previous copy of the same repo.
    pub fn add(&mut self, mut repo: Repo) -> Result<(), AppError> {
        repo.added = true;
        self.cache.repos.retain(|r| r.full_name != repo.full_name);
        self.cache.repos.push(repo);
        self.cache
            .repos
            .sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        self.save()
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.cache)?;
        fs::write(&self.file_path, data)?;
        Ok(())
    }
}

/// The staleness rule as a pure function of two timestamps, so it can be
/// tested without a clock. Never fetched (fetched_at 0) is stale.
pub fn is_stale(fetched_at: u64, now: u64) -> bool {
    fetched_at == 0 || now.saturating_sub(fetched_at) > STALE_AFTER_SECS
}

/// Run gh with args, or say why it could not run.
///
/// A missing executable is GhUnavailable with the install command; a
/// non-zero exit carries gh's own stderr, which for the not-logged-in
/// case already reads "To get started with GitHub CLI, please run: gh
/// auth login".
fn gh(args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("gh")
        .quiet()
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

/// gh search repos spells the branch flat and adds the star count.
const SEARCH_FIELDS: &str = "name,owner,url,updatedAt,isPrivate,isArchived,defaultBranch,stargazersCount";

/// owner/name out of whatever a person pastes: the bare form, a GitHub
/// url (with or without .git, a trailing slash, a /tree/… tail), or an
/// ssh remote. Anything else is None; a guess here would send gh a
/// stranger.
pub fn parse_spec(input: &str) -> Option<String> {
    let s = input.trim();
    let rest = s
        .strip_prefix("https://github.com/")
        .or_else(|| s.strip_prefix("http://github.com/"))
        .or_else(|| s.strip_prefix("github.com/"))
        .or_else(|| s.strip_prefix("git@github.com:"))
        .or_else(|| s.strip_prefix("ssh://git@github.com/"))
        .unwrap_or(s);
    let mut parts = rest.split('/').filter(|p| !p.is_empty());
    let owner = parts.next()?;
    let name = parts.next()?.trim_end_matches(".git");
    let ok = |p: &str| {
        !p.is_empty()
            && p.chars().all(|c| {
                c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'
            })
    };
    if !ok(owner) || !ok(name) {
        return None;
    }
    Some(format!("{owner}/{name}"))
}

/// How many live hits one search asks for. Thirty is a screen; the box
/// is the way to narrow, not a scrollbar.
const SEARCH_LIMIT: &str = "30";

/// All of GitHub, live: gh search repos, any owner, in GitHub's own
/// best-match order. Not --sort updated: tried first, and the top hit
/// for "tauri" was a stranger's repo pushed a minute earlier. One
/// network call per settled keystroke; the frontend debounces and
/// drops late answers. The query goes after "--" so one starting with
/// a dash is a query, not a flag.
pub fn search(query: &str) -> Result<Vec<Repo>, AppError> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let text = gh(&[
        "search",
        "repos",
        "--json",
        SEARCH_FIELDS,
        "-L",
        SEARCH_LIMIT,
        "--",
        q,
    ])?;
    parse_repos(&text)
}

/// The branches of one repository, on demand: gh api …/branches, one
/// page of a hundred, names only. Read when the chip is clicked, never in
/// a pass, the same rule as git::remote_branches for a clone on disk.
/// Cached for the session by the command: a branch list from yesterday
/// looks current.
pub fn branches(full_name: &str) -> Result<Vec<String>, AppError> {
    let text = gh(&[
        "api",
        &format!("repos/{full_name}/branches?per_page=100"),
        "--jq",
        ".[].name",
    ])?;
    Ok(parse_branch_lines(&text))
}

/// --jq '.[].name' prints one name per line; blank lines and CRs are gh's
/// and Windows's, not branches.
pub fn parse_branch_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// One repository by name, any owner. gh repo view prints the same shape
/// gh repo list prints one element of, so the parser is shared.
pub fn view_repo(full_name: &str) -> Result<Repo, AppError> {
    let text = gh(&["repo", "view", full_name, "--json", REPO_FIELDS])?;
    let mut repos = parse_repos(&format!("[{text}]"))?;
    repos.pop().ok_or_else(|| {
        AppError::GhUnavailable(format!("gh returned nothing for {full_name}"))
    })
}

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
    /// gh repo list nests the branch; gh search repos prints it flat
    /// as defaultBranch and has no defaultBranchRef at all, so both are
    /// optional and the row takes whichever came
    #[serde(default)]
    default_branch_ref: Option<GhRef>,
    #[serde(default)]
    default_branch: Option<String>,
    #[serde(default)]
    stargazers_count: Option<u64>,
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
            default_branch: r
                .default_branch_ref
                .map(|b| b.name)
                .or(r.default_branch),
            added: false,
            stars: r.stargazers_count,
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
    fn staleness_is_a_function_of_two_timestamps() {
        assert!(is_stale(0, 1_000), "never fetched is stale");
        assert!(
            !is_stale(1_000, 1_000 + STALE_AFTER_SECS),
            "exactly the limit is still fresh"
        );
        assert!(is_stale(1_000, 1_000 + STALE_AFTER_SECS + 1));
        assert!(
            !is_stale(2_000, 1_000),
            "a clock that went backwards is not stale"
        );
    }

    #[test]
    fn cache_round_trips_and_a_corrupt_file_is_backed_up() {
        let dir = std::env::temp_dir().join("devgo-github-store");
        let _ = fs::remove_dir_all(&dir);
        let mut store = GithubStore::new(dir.clone()).unwrap();
        assert_eq!(store.get().fetched_at, 0, "nothing fetched yet");
        store
            .store(GithubCache {
                fetched_at: 42,
                login: Some("joyahmed".into()),
                orgs: vec!["joyahmed007".into()],
                repos: parse_repos(SAMPLE).unwrap(),
            })
            .unwrap();
        let again = GithubStore::new(dir.clone()).unwrap();
        assert_eq!(again.get().fetched_at, 42);
        assert_eq!(again.get().repos.len(), 3);

        fs::write(dir.join("github-cache.json"), "{ broken").unwrap();
        let fresh = GithubStore::new(dir.clone()).unwrap();
        assert_eq!(fresh.get().fetched_at, 0, "a corrupt cache starts empty");
        assert!(
            dir.join("github-cache.json.bak").exists(),
            "and the original is kept"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn spec_accepts_the_forms_people_paste() {
        for input in [
            "joyahmed/devgo-app",
            "  joyahmed/devgo-app  ",
            "https://github.com/joyahmed/devgo-app",
            "https://github.com/joyahmed/devgo-app.git",
            "https://github.com/joyahmed/devgo-app/",
            "https://github.com/joyahmed/devgo-app/tree/main/src",
            "github.com/joyahmed/devgo-app",
            "git@github.com:joyahmed/devgo-app.git",
            "ssh://git@github.com/joyahmed/devgo-app.git",
        ] {
            assert_eq!(
                parse_spec(input).as_deref(),
                Some("joyahmed/devgo-app"),
                "{input}"
            );
        }
        assert_eq!(parse_spec("devgo-app"), None, "no owner");
        assert_eq!(parse_spec("https://gitlab.com/a/b"), None, "not GitHub");
        assert_eq!(parse_spec("a/b c"), None, "a space is not a name");
        assert_eq!(parse_spec(""), None);
    }

    #[test]
    fn a_refresh_keeps_hand_added_rows_and_drops_nothing_else() {
        let dir = std::env::temp_dir().join("devgo-github-added");
        let _ = fs::remove_dir_all(&dir);
        let mut store = GithubStore::new(dir.clone()).unwrap();
        let mut stranger = parse_repos(SAMPLE).unwrap().remove(1);
        stranger.full_name = "someone/else".into();
        store.add(stranger.clone()).unwrap();
        assert!(store.get().repos[0].added);

        // a refresh that does not include the stranger keeps it; one that
        // does not include an ordinary old row drops that row
        store
            .store(GithubCache {
                fetched_at: 9,
                login: None,
                orgs: vec![],
                repos: parse_repos(SAMPLE).unwrap(),
            })
            .unwrap();
        let names: Vec<String> = store
            .get()
            .repos
            .iter()
            .map(|r| r.full_name.clone())
            .collect();
        assert!(names.contains(&"someone/else".to_string()), "{names:?}");
        assert_eq!(names.len(), 4);

        // adding the same repo twice is one row
        store.add(stranger).unwrap();
        assert_eq!(
            store
                .get()
                .repos
                .iter()
                .filter(|r| r.full_name == "someone/else")
                .count(),
            1
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_search_hit_has_stars_and_a_flat_branch() {
        let text = r#"[{"name":"tauri","owner":{"login":"tauri-apps"},"url":"https://github.com/tauri-apps/tauri","updatedAt":"2026-09-12T00:00:00Z","isPrivate":false,"isArchived":false,"defaultBranch":"dev","stargazersCount":95000}]"#;
        let repos = parse_repos(text).unwrap();
        assert_eq!(repos[0].full_name, "tauri-apps/tauri");
        assert_eq!(repos[0].stars, Some(95000));
        assert_eq!(repos[0].default_branch.as_deref(), Some("dev"));
        // and a listed row, which has neither, still parses
        assert_eq!(parse_repos(SAMPLE).unwrap()[0].stars, None);
    }

    #[test]
    fn branch_lines_are_trimmed_and_blank_free() {
        let out = parse_branch_lines("main\r\nfeat/x\n\n  release/1.2  \n");
        assert_eq!(out, ["main", "feat/x", "release/1.2"]);
        assert!(parse_branch_lines("").is_empty());
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
