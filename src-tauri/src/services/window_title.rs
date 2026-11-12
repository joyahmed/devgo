//! A title for a Claude Code window opened from DevGo on Windows.
//!
//! Claude Code names its window from `--name`; without it the title is a
//! topic it picks itself, and a row of terminals all called after their
//! first prompt cannot be told apart. The WSL side gets `--name` from the
//! user's own shell wrapper (DevGo starts a login shell there). The Windows
//! side spawns `claude` straight from the terminal, no shell runs, so DevGo
//! adds the flag itself: `<box>/<repo>`, where box is the one line in
//! `%USERPROFILE%\.claude\hooks\claude-name.txt` and repo is the project's
//! git root folder name, or the project folder name outside a repo.
//!
//! Everything here is pure except `read_name_file` and `git_root`, which
//! the launch calls at launch time so an edited name file counts at once.

use std::path::{Path, PathBuf};

/// The name file, relative to the user's home.
pub const NAME_FILE: &[&str] = &[".claude", "hooks", "claude-name.txt"];

/// `<box>/<repo>`, or `<repo>` alone when the name file is missing or
/// blank. Repo is the git root's folder name, else the project folder's.
pub fn claude_title(
    name_file: Option<String>,
    project_path: &str,
    git_root: Option<PathBuf>,
) -> String {
    let repo = git_root
        .as_ref()
        .map(|r| basename(&r.to_string_lossy()).to_string())
        .filter(|r| !r.is_empty())
        .unwrap_or_else(|| basename(project_path).to_string());
    let host = name_file
        .as_deref()
        .and_then(|s| s.lines().map(str::trim).find(|l| !l.is_empty()))
        .unwrap_or("");
    let title = if host.is_empty() {
        repo
    } else {
        format!("{host}/{repo}")
    };
    // the title goes inside double quotes on a command line: a quote in
    // it would end the argument early
    title.replace('"', "")
}

/// Is this agent command Claude Code? The program's own name decides, so
/// `claude`, `claude.exe` and a full path all count and other agents never do.
pub fn is_claude(command: &str) -> bool {
    let command = command.trim_start();
    // a quoted program path may hold spaces: it runs to the closing quote
    let program = match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next().unwrap_or(""),
        None => command.split_whitespace().next().unwrap_or(""),
    };
    let file = basename(program).to_ascii_lowercase();
    let stem = file.rsplit_once('.').map_or(file.as_str(), |(s, _)| s);
    stem == "claude"
}

/// Did the user already name the window in their configured command?
pub fn has_name_flag(command: &str) -> bool {
    command
        .split_whitespace()
        .any(|t| t == "-n" || t == "--name" || t.starts_with("--name="))
}

/// The command with `--name "<title>"` appended, unless it already names
/// the window. `for_wt`: Windows Terminal reads `;` as "next command" even
/// inside quotes, so there it goes out as `\;`.
pub fn with_window_name(command: &str, title: &str, for_wt: bool) -> String {
    if has_name_flag(command) || title.is_empty() {
        return command.to_string();
    }
    let title = if for_wt {
        title.replace(';', "\\;")
    } else {
        title.to_string()
    };
    format!("{command} --name \"{title}\"")
}

/// The agent command a Windows launch hands the terminal: Claude Code gets
/// its window name, every other agent goes out exactly as configured.
pub fn agent_command(
    command: &str,
    terminal_exe: &str,
    name_file: Option<String>,
    project_path: &str,
    git_root: Option<PathBuf>,
) -> String {
    if !is_claude(command) {
        return command.to_string();
    }
    let title = claude_title(name_file, project_path, git_root);
    with_window_name(command, &title, is_wt(terminal_exe))
}

/// Is this terminal Windows Terminal? Its executable, not its label, says.
pub fn is_wt(executable: &str) -> bool {
    let file = basename(executable.trim_matches('"')).to_ascii_lowercase();
    file == "wt" || file == "wt.exe"
}

/// The name file's contents, read now. `None` when it is not there.
pub fn read_name_file(home: &Path) -> Option<String> {
    let path = NAME_FILE.iter().fold(home.to_path_buf(), |p, s| p.join(s));
    std::fs::read_to_string(path).ok()
}

/// The nearest folder at or above `path` that holds `.git` (a folder, or
/// the file a worktree has). No git process: a launch should not wait on one.
pub fn git_root(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|p| p.join(".git").exists())
        .map(Path::to_path_buf)
}

// the last path segment, for either separator: a Windows path is a plain
// string on every OS the tests run on
fn basename(path: &str) -> &str {
    path.trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_and_repo_from_the_git_root() {
        let t = claude_title(
            Some("Box".into()),
            r"D:\code\devgo\src-tauri",
            Some(PathBuf::from(r"D:\code\devgo")),
        );
        assert_eq!(t, "Box/devgo");
    }

    #[test]
    fn outside_a_repo_the_folder_name_is_the_repo() {
        let t = claude_title(Some("Box".into()), r"D:\notes\scratch\", None);
        assert_eq!(t, "Box/scratch");
    }

    #[test]
    fn no_name_file_means_the_repo_alone() {
        let t = claude_title(None, r"D:\code\devgo", None);
        assert_eq!(t, "devgo");
    }

    #[test]
    fn a_blank_name_file_means_the_repo_alone() {
        let t = claude_title(Some(" \r\n\t\n".into()), r"D:\x\devgo", None);
        assert_eq!(t, "devgo");
    }

    #[test]
    fn whitespace_and_newlines_around_the_box_are_trimmed() {
        let t = claude_title(Some("\r\n  Box \r\n".into()), r"D:\x\app", None);
        assert_eq!(t, "Box/app");
    }

    #[test]
    fn a_quote_never_reaches_the_command_line() {
        let t = claude_title(Some("B\"ox".into()), r"D:\x\app", None);
        assert_eq!(t, "Box/app");
    }

    #[test]
    fn claude_gets_the_name_appended_and_quoted() {
        assert_eq!(
            with_window_name("claude", "My Box/my repo", true),
            "claude --name \"My Box/my repo\""
        );
    }

    #[test]
    fn a_semicolon_is_escaped_for_windows_terminal_only() {
        assert_eq!(
            with_window_name("claude", "a;b/c", true),
            "claude --name \"a\\;b/c\""
        );
        assert_eq!(
            with_window_name("claude", "a;b/c", false),
            "claude --name \"a;b/c\""
        );
    }

    #[test]
    fn an_explicit_name_in_the_command_is_kept() {
        for c in [
            "claude -n mine",
            "claude --name mine",
            "claude --name=mine",
            "claude --verbose -n \"two words\"",
        ] {
            assert_eq!(with_window_name(c, "Box/devgo", true), c);
        }
    }

    #[test]
    fn user_flags_stay_in_front_of_the_name() {
        assert_eq!(
            with_window_name("claude --verbose", "Box/devgo", true),
            "claude --verbose --name \"Box/devgo\""
        );
    }

    #[test]
    fn only_claude_counts_as_claude() {
        assert!(is_claude("claude"));
        assert!(is_claude("claude --verbose"));
        assert!(is_claude("Claude.exe"));
        assert!(is_claude(r"C:\Users\u\.local\bin\claude.exe"));
        assert!(is_claude(r#""C:\Program Files\x\claude.cmd" -c"#));
        for other in [
            "codex",
            "gemini",
            "aider --model x",
            "opencode",
            "claude-x",
            "",
        ] {
            assert!(!is_claude(other), "{other} is not claude");
        }
    }

    #[test]
    fn other_agents_go_out_untouched() {
        for c in ["codex", "gemini --yolo", "aider"] {
            let out =
                agent_command(c, "wt", Some("Box".into()), r"D:\x\app", None);
            assert_eq!(out, c);
        }
    }

    #[test]
    fn claude_in_windows_terminal_end_to_end() {
        let out = agent_command(
            "claude",
            "wt",
            Some("Box\n".into()),
            r"D:\code\devgo",
            Some(PathBuf::from(r"D:\code\devgo")),
        );
        assert_eq!(out, "claude --name \"Box/devgo\"");
    }

    #[test]
    fn only_wt_is_windows_terminal() {
        assert!(is_wt("wt"));
        assert!(is_wt("wt.exe"));
        assert!(is_wt(
            r"C:\Users\u\AppData\Local\Microsoft\WindowsApps\wt.exe"
        ));
        assert!(!is_wt("alacritty"));
        assert!(!is_wt("cmd"));
    }

    #[test]
    fn the_git_root_is_found_from_a_subfolder() {
        let base = std::env::temp_dir().join(format!(
            "devgo-title-{}-{}",
            std::process::id(),
            line!()
        ));
        let sub = base.join("repo").join("src");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::create_dir_all(base.join("repo").join(".git")).unwrap();
        assert_eq!(git_root(&sub), Some(base.join("repo")));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_name_file_is_read_from_under_home() {
        let home = std::env::temp_dir().join(format!(
            "devgo-title-{}-{}",
            std::process::id(),
            line!()
        ));
        assert_eq!(read_name_file(&home), None);
        let dir = home.join(".claude").join("hooks");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("claude-name.txt"), "Box\n").unwrap();
        assert_eq!(read_name_file(&home).as_deref(), Some("Box\n"));
        let _ = std::fs::remove_dir_all(&home);
    }
}
