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
///
/// `wt_profile`: Windows Terminal's default profile GUID. A tab whose
/// command line is replaced shows the program's own icon (claude.exe has
/// none, so a bare console icon). Naming the profile with `-p` keeps the
/// profile's icon, so in wt Claude runs inside `shell` under that profile.
/// The text lands after `-d "{path}"` in WT_RUN_ARGS, where wt still reads
/// new-tab options.
pub fn agent_command(
    command: &str,
    terminal_exe: &str,
    name_file: Option<String>,
    project_path: &str,
    git_root: Option<PathBuf>,
    wt_profile: Option<&str>,
    shell: &str,
) -> String {
    if !is_claude(command) {
        return command.to_string();
    }
    let title = claude_title(name_file, project_path, git_root);
    if !is_wt(terminal_exe) {
        return with_window_name(command, &title, false);
    }
    match wt_profile.filter(|p| !p.is_empty() && !p.contains('"')) {
        // a quote in the user's command cannot nest inside -Command "..."
        Some(profile) if !command.contains('"') => {
            wt_profile_command(command, &title, profile, shell)
        }
        _ => with_window_name(command, &title, true),
    }
}

// `-p "<profile>" <shell> -NoLogo -NoExit -Command "<claude --name '<title>'>"`.
// the title is single-quoted for PowerShell (a literal, '' for a quote), and
// every `;` goes out as `\;` because wt splits commands on it before
// PowerShell ever sees the line
fn wt_profile_command(
    command: &str,
    title: &str,
    profile: &str,
    shell: &str,
) -> String {
    let inner = if has_name_flag(command) || title.is_empty() {
        command.to_string()
    } else {
        format!("{command} --name '{}'", title.replace('\'', "''"))
    };
    let inner = inner.replace(';', "\\;");
    format!("-p \"{profile}\" {shell} -NoLogo -NoExit -Command \"{inner}\"")
}

/// The `defaultProfile` GUID out of Windows Terminal's settings.json text.
/// The file is JSON with comments, so this looks for the key and takes the
/// string after it rather than parsing the whole thing.
pub fn default_profile(settings: &str) -> Option<String> {
    let after = settings.split("\"defaultProfile\"").nth(1)?;
    let after = after.trim_start().strip_prefix(':')?.trim_start();
    let value = after.strip_prefix('"')?.split('"').next()?;
    (!value.is_empty()).then(|| value.to_string())
}

/// Windows Terminal's settings, read now: the store install, then Preview,
/// then the unpackaged one. `None` when none is there.
pub fn read_wt_settings(local_app_data: &Path) -> Option<String> {
    [
        r"Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json",
        r"Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json",
        r"Microsoft\Windows Terminal\settings.json",
    ]
    .iter()
    .find_map(|rel| std::fs::read_to_string(local_app_data.join(rel)).ok())
}

/// PowerShell 7 when it is on PATH, else Windows PowerShell, which every
/// Windows has.
pub fn shell_on_path(path_var: Option<std::ffi::OsString>) -> &'static str {
    let found = path_var.is_some_and(|p| {
        std::env::split_paths(&p).any(|d| d.join("pwsh.exe").is_file())
    });
    if found {
        "pwsh"
    } else {
        "powershell"
    }
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
            for profile in [None, Some(GUID)] {
                let out = agent_command(
                    c,
                    "wt",
                    Some("Box".into()),
                    r"D:\x\app",
                    None,
                    profile,
                    "pwsh",
                );
                assert_eq!(out, c);
            }
        }
    }

    const GUID: &str = "{00000000-1111-2222-3333-444444444444}";

    fn claude_in(
        command: &str,
        terminal: &str,
        profile: Option<&str>,
    ) -> String {
        agent_command(
            command,
            terminal,
            Some("Box\n".into()),
            r"D:\code\devgo",
            Some(PathBuf::from(r"D:\code\devgo")),
            profile,
            "pwsh",
        )
    }

    #[test]
    fn claude_in_windows_terminal_without_a_profile() {
        assert_eq!(
            claude_in("claude", "wt", None),
            "claude --name \"Box/devgo\""
        );
    }

    #[test]
    fn claude_in_windows_terminal_runs_under_the_default_profile() {
        assert_eq!(
            claude_in("claude", "wt", Some(GUID)),
            format!(
                "-p \"{GUID}\" pwsh -NoLogo -NoExit \
                 -Command \"claude --name 'Box/devgo'\""
            )
        );
    }

    #[test]
    fn the_profile_form_keeps_an_explicit_name_and_escapes_for_both() {
        assert_eq!(
            claude_in("claude -n mine", "wt", Some(GUID)),
            format!("-p \"{GUID}\" pwsh -NoLogo -NoExit -Command \"claude -n mine\"")
        );
        let out = agent_command(
            "claude",
            "wt",
            Some("it's;x".into()),
            r"D:\x\app",
            None,
            Some(GUID),
            "powershell",
        );
        assert_eq!(
            out,
            format!(
                "-p \"{GUID}\" powershell -NoLogo -NoExit \
                 -Command \"claude --name 'it''s\\;x/app'\""
            )
        );
    }

    #[test]
    fn a_quoted_command_or_another_terminal_skips_the_profile() {
        let quoted = r#""C:\Program Files\x\claude.cmd""#;
        assert_eq!(
            claude_in(quoted, "wt", Some(GUID)),
            format!("{quoted} --name \"Box/devgo\"")
        );
        assert_eq!(
            claude_in("claude", "alacritty", Some(GUID)),
            "claude --name \"Box/devgo\""
        );
    }

    #[test]
    fn the_default_profile_is_read_from_settings_with_comments() {
        let s = "{\n  // a comment\n  \"$help\": \"x\",\n  \"defaultProfile\" : \
                 \"{574e775e-4f2a-5b96-ac1e-a2962a402336}\",\n  \"profiles\": {}\n}";
        assert_eq!(
            default_profile(s).as_deref(),
            Some("{574e775e-4f2a-5b96-ac1e-a2962a402336}")
        );
        assert_eq!(default_profile("{ \"profiles\": {} }"), None);
        assert_eq!(default_profile("{ \"defaultProfile\": \"\" }"), None);
    }

    #[test]
    fn powershell_is_the_shell_when_pwsh_is_not_on_path() {
        assert_eq!(shell_on_path(None), "powershell");
        let empty = std::env::temp_dir().join(format!(
            "devgo-title-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&empty).unwrap();
        let path = std::env::join_paths([&empty]).unwrap();
        assert_eq!(shell_on_path(Some(path.clone())), "powershell");
        std::fs::write(empty.join("pwsh.exe"), b"").unwrap();
        assert_eq!(shell_on_path(Some(path)), "pwsh");
        let _ = std::fs::remove_dir_all(&empty);
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
