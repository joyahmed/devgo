use std::process::Command;

use serde::Deserialize;

#[cfg(windows)]
use super::platform::Quiet;
use super::platform::RuntimeInfo;
use super::preferences::TmuxConfig;
use crate::error::AppError;
use crate::models::target::LaunchTarget;
use crate::models::Project;

// where a server's ssh line runs on this machine: the terminal's own run
// form, a psmux session whose window runs it, or the default distro's ssh
// through the terminal's wsl run form. the remote half, tmux on the box
// or a plain shell, is the server's own flag and lives in the line
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerVia {
    Terminal,
    Psmux,
    Wsl,
}

fn is_wsl(project: &Project) -> bool {
    let normalized = project.full_path.replace('\\', "/");
    normalized.starts_with("//wsl.localhost/")
        || normalized.starts_with("//wsl$/")
}

/// Resolve which distro a project belongs to.
///
/// A WSL-native path names its own distro, so prefer that. Otherwise fall back
/// to the detected default. There is deliberately no hardcoded distro name —
/// "Ubuntu" is not a safe guess, and silently launching into the wrong distro
/// is worse than a clear error.
fn distro_from_project(
    project: &Project,
    info: &RuntimeInfo,
) -> Result<String, AppError> {
    if is_wsl(project) {
        let path = project.full_path.replace('\\', "/");
        for prefix in ["//wsl.localhost/", "//wsl$/"] {
            if let Some(rest) = path.strip_prefix(prefix) {
                if let Some(distro) = rest.split('/').find(|s| !s.is_empty()) {
                    return Ok(distro.to_string());
                }
            }
        }
    }
    info.default_distro
        .clone()
        .ok_or_else(|| AppError::NoWslDistro(project.full_path.clone()))
}

/// Spawn a command line that is already quoted the way the target wants it.
///
/// `Command::args` re-quotes anything containing spaces, which turns
/// `--folder-uri vscode-remote://…` into a single quoted argument and breaks
/// it. So the line goes through a shell that does the splitting the
/// template intended: `cmd /c` on Windows (`shell_line` hands the string
/// over verbatim), `sh -c` on a Mac. Either way the target's own
/// `args_template` is the only thing deciding how it is split. pub(crate)
/// because commands.rs launches a remote editor the same way and must not
/// keep its own copy of the shell choice.
pub(crate) fn spawn_raw(exe: &str, args: &str) -> Result<(), AppError> {
    // the process spawned below is the shell, which always exists, so a
    // missing editor "launched" fine: a console flashed, Ok came back, and a
    // frecency launch was recorded. wsl is exempt: the program it runs lives
    // inside the distro, where a windows PATH lookup means nothing
    if exe != "wsl" {
        // a path that is there but is not a program is a different
        // mistake from one that is not there, and "not installed" of a
        // folder sends the user looking for an install
        if super::editors::exists_but_not_a_program(exe) {
            return Err(AppError::TargetNotRunnable(exe.to_string()));
        }
        if !super::editors::is_on_path(exe) {
            return Err(AppError::TargetNotInstalled(exe.to_string()));
        }
    }

    let mut cmd = shell_command(exe, args);
    scrub_agent_env(&mut cmd);
    cmd.spawn()
        .map_err(|e| AppError::LaunchFailed(format!("{exe}: {e}")))?;
    Ok(())
}

// the shell that splits a template's line on windows: cmd /c, the line
// handed over verbatim through raw_arg
#[cfg(windows)]
fn shell_command(exe: &str, args: &str) -> Command {
    let mut cmd = Command::new("cmd");
    cmd.quiet().shell_line(cmd_line(exe, args));
    cmd
}

/// The line `cmd /c` is handed.
///
/// An exe that is a path the user typed can carry a space — `C:\Program
/// Files\Trove\trove.exe` is where an installer puts things — and cmd reads
/// the first word as the program, so such a target launched `C:\Program`
/// and said nothing. Quoting the exe alone is not enough: cmd then strips
/// the first quote of the line and the last, so the pair round the whole
/// line is what puts them back. Only for an exe that needs it, so every
/// line that works today is still the same bytes.
#[cfg(windows)]
fn cmd_line(exe: &str, args: &str) -> String {
    if exe.contains(' ') {
        format!("/c \"\"{exe}\" {args}\"")
    } else {
        format!("/c {exe} {args}")
    }
}

// the shell that splits a template's line on a mac: /bin/sh -c, with the
// login-shell PATH in its environment, or code, zed and every nvm agent
// are "not installed" from the dock. the template already double-quotes
// {path}, so the string that works under cmd works under sh; the exe is
// single-quoted because it may be a path inside a bundle, and a bundle
// name can carry a space
#[cfg(not(windows))]
fn shell_command(exe: &str, args: &str) -> Command {
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg(format!("{} {args}", sh_quote(exe)));
    super::platform::with_login_path(&mut cmd);
    cmd
}

// what an agent's tool shell sets so its own commands stay plain and
// never ask: no colours, no editor, no credential prompt. a terminal
// opened from a devgo started in that shell came up all white
const AGENT_SHELL_VARS: &[&str] = &[
    "NO_COLOR",
    "GIT_EDITOR",
    "GIT_ASKPASS",
    "GIT_TERMINAL_PROMPT",
    "GCM_INTERACTIVE",
    "PROMPT",
    "DISABLE_AUTOUPDATER",
    "NoDefaultCurrentDirectoryInExePath",
];

// a launcher is nobody's child. devgo started from inside a claude code
// session inherits that session's environment, and every editor, terminal
// and agent it opens inherits it too: a claude launched that way said
// its transcript saving was off, a terminal had no colours. scrub both so
// what devgo opens is a fresh top-level thing, whatever started devgo.
// the markers by prefix because their set grows; the list unconditionally,
// env_remove on a name that is not set is a no-op. never env_clear: that
// drops PATH and HOME with them
fn scrub_agent_env(cmd: &mut Command) {
    for (key, _) in std::env::vars_os() {
        let name = key.to_string_lossy();
        if name.starts_with("CLAUDE_CODE_")
            || ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "AI_AGENT"]
                .contains(&name.as_ref())
        {
            cmd.env_remove(&key);
        }
    }
    for name in AGENT_SHELL_VARS {
        cmd.env_remove(name);
    }
}

/// Launch a project into any registered target.
///
/// Replaces the hardcoded `code` and `wt` calls. Nothing here knows what an
/// editor is any more — it resolves a command line from the target's own
/// templates and spawns it.
pub fn launch_target(
    target: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    tmux: &TmuxConfig,
) -> Result<(), AppError> {
    let (resolved, wsl) = if is_wsl(project) {
        let distro = distro_from_project(project, info)?;
        let linux_path = super::platform::paths::windows_to_wsl_path(
            &project.full_path,
            &distro,
        );
        let resolved =
            target.resolve(&project.full_path, Some((&distro, &linux_path)));
        (resolved, Some((distro, linux_path)))
    } else {
        (target.resolve(&project.full_path, None), None)
    };

    // A target with no form for this side cannot open the project. Saying so
    // is the whole point — launching anyway would open the wrong directory
    // silently.
    let (exe, args) = resolved.ok_or_else(|| {
        let (t, p) = (target.name.clone(), project.name.clone());
        if is_wsl(project) {
            AppError::TargetCannotOpenWsl(t, p)
        } else if cfg!(windows) && target.wsl_args_template.is_some() {
            // the wsl sentence needs both halves: a machine that has wsl,
            // and a row saying it lives in one. a distro editor on
            // windows is all it was ever about, and on linux it told
            // someone their kitty runs inside a wsl they do not have
            AppError::TargetWslOnly(t, p)
        } else {
            AppError::TargetHasNoLine(t, p)
        }
    })?;

    // the template decides, not the kind: a terminal whose args ignore
    // {script} used to get a devgo-*.sh in %TEMP% that nothing ever read.
    // the filesystem decides which script: bash driving tmux in the distro,
    // or the platform's own for a local project (powershell driving psmux
    // on windows, bash driving native tmux on a mac), same windows from the
    // same config. until psmux the windows side was the `_` arm, and a
    // windows project opened one bare tab while the same launch on a wsl
    // project opened three
    let args = match (&wsl, args.contains("{script}")) {
        (Some((distro, linux_path)), true) => {
            let script = write_tmux_script(project, distro, linux_path, tmux)?;
            args.replace("{script}", &script)
        }
        (None, true) => {
            let script = write_local_script(project, tmux)?;
            args.replace("{script}", &script)
        }
        _ => args,
    };

    spawn_raw(&exe, &args)
}

// the session script for a local project: psmux on windows. one cfg seam,
// at the function, so launch_target reads the same on both platforms
#[cfg(windows)]
fn write_local_script(
    project: &Project,
    tmux: &TmuxConfig,
) -> Result<String, AppError> {
    write_psmux_script(project, tmux)
}

// the session script for a local project on a mac: native tmux, driven by
// the same bash the wsl side runs inside a distro. written as
// devgo-{session}.command, the extension terminal.app runs when handed a
// file, and made executable, because terminal refuses one that is not.
// the path comes back as-is; the template double-quotes it
#[cfg(not(windows))]
fn write_local_script(
    project: &Project,
    tmux: &TmuxConfig,
) -> Result<String, AppError> {
    let session = tmux_session_name(project);
    let script = build_mac_script(&session, &project.full_path, tmux);
    write_command_file(&format!("devgo-{session}.command"), &script)
}

// a .command file in the temp directory, executable; both mac scripts go
// through here so the mode bits are set in one place
#[cfg(not(windows))]
fn write_command_file(name: &str, script: &str) -> Result<String, AppError> {
    use std::os::unix::fs::PermissionsExt;
    let temp_file = std::env::temp_dir().join(name);
    std::fs::write(&temp_file, script)?;
    std::fs::set_permissions(
        &temp_file,
        std::fs::Permissions::from_mode(0o755),
    )?;
    Ok(temp_file.to_string_lossy().into_owned())
}

/// Write the tmux session script for a WSL project and return its Linux path.
///
/// This is a DevGo behaviour rather than a property of any terminal — the
/// three-window code/agents/git session is the thing worth keeping. Templates
/// reach it through `{script}`; a terminal whose template ignores the
/// placeholder simply opens a plain shell.
fn write_tmux_script(
    project: &Project,
    distro: &str,
    linux_path: &str,
    tmux: &TmuxConfig,
) -> Result<String, AppError> {
    // the same name is the session and the filename: two projects called
    // api used to share one file, and the second write could land before
    // the first wsl had read it
    let session = tmux_session_name(project);
    let script = build_tmux_script(&session, linux_path, tmux);
    let temp_file = std::env::temp_dir().join(format!("devgo-{session}.sh"));
    std::fs::write(&temp_file, &script)?;
    Ok(super::platform::paths::windows_to_wsl_path(
        &temp_file.to_string_lossy(),
        distro,
    ))
}

/// The Windows twin of write_tmux_script: same session name, same filename
/// discipline, and no path conversion, because the shell reading it is the
/// one that wrote it. The template double-quotes the path it gets back.
#[cfg(windows)]
fn write_psmux_script(
    project: &Project,
    tmux: &TmuxConfig,
) -> Result<String, AppError> {
    let session = tmux_session_name(project);
    let script = build_psmux_script(&session, &project.full_path, tmux);
    let temp_file = std::env::temp_dir().join(format!("devgo-{session}.ps1"));
    std::fs::write(&temp_file, &script)?;
    Ok(temp_file.to_string_lossy().into_owned())
}

/// A session name unique to this project. sanitize_file_stem already maps
/// `.` and `:` (tmux's target separators) to `-`; the suffix is what keeps two
/// projects called `api` from attaching to each other's shell.
pub(crate) fn tmux_session_name(project: &Project) -> String {
    format!(
        "{}-{}",
        sanitize_file_stem(&project.name),
        path_suffix(&project.full_path)
    )
}

// every project's session name to its path, for the live read: the same
// function the scripts use, so a session created on launch and a session
// found by tmux ls agree by construction
pub(crate) fn session_names(
    projects: &[Project],
) -> std::collections::HashMap<String, String> {
    projects
        .iter()
        .map(|p| (tmux_session_name(p), p.full_path.clone()))
        .collect()
}

/// FNV-1a over the normalised path, written out rather than DefaultHasher:
/// that one is not stable across Rust releases, and a session name that
/// changes under you is a session you can never reattach to. Lowercased and
/// slash-flipped because Windows spells the same directory several ways.
fn path_suffix(path: &str) -> String {
    let normalized = path.to_lowercase().replace('\\', "/");
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in normalized.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:08x}", (hash & 0xffff_ffff) as u32)
}

/// Reduce a project name to something safe to embed in a filename. Without this
/// a project containing a separator would escape the temp directory.
fn sanitize_file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Bring the project's session up to the requested layout, and nothing more.
///
/// The old script wrapped every window creation in the has-session guard,
/// so the layout was decided the first time you launched a project and
/// frozen: add a window, relaunch, still see three, with nothing to explain
/// it. Every window gets its own guard now, the first one included: on a
/// session that already exists new-session never runs, and a name you put at
/// the top of the list would otherwise be the one that never appears.
///
/// Nothing here kills, renames or prunes. A window someone made by hand is
/// theirs, and a launcher that tidies your session is one you stop trusting
/// with a long-running process.
fn build_tmux_script(
    session: &str,
    linux_path: &str,
    tmux: &TmuxConfig,
) -> String {
    // off is no tmux, not tmux with one window: an empty list still starts
    // a server and leaves a session behind. exec so exiting closes the tab,
    // -l so the profile is read; doubled braces because this is a format
    if !tmux.enabled {
        return format!(
            r#"#!/usr/bin/env bash
cd {} || exit 1
exec "${{SHELL:-bash}}" -l
"#,
            sh_quote(linux_path)
        );
    }

    let windows = &tmux.window_names;
    let session_q = sh_quote(session);
    // every -t carries `=`: tmux matches a target by prefix otherwise, and
    // has-session -t app is satisfied by a running app-api. new-session -s
    // is the exception, it names something that does not exist yet
    let exact_q = sh_quote(&format!("={session}"));
    let target_q = sh_quote(&format!("={session}:"));
    let path_q = sh_quote(linux_path);

    // an empty list is one plain window: new-session always makes one, and
    // the default is not quietly put back
    let create = match windows.first() {
        Some(first) => format!(
            "    tmux new-session -d -s {session_q} -n {} -c {path_q}\n",
            sh_quote(first)
        ),
        None => format!("    tmux new-session -d -s {session_q} -c {path_q}\n"),
    };

    // -F: a name is a literal, not a regex. -x: git must not match a
    // hand-made git-log. --: a name like -log is otherwise read as options,
    // grep exits 2, `if !` reads that as "not found", and the window is
    // created again on every launch
    let reconcile: String = windows
        .iter()
        .map(|name| {
            let name_q = sh_quote(name);
            format!(
                "if ! tmux list-windows -t {exact_q} -F '#W' 2>/dev/null | grep -Fxq -- {name_q}; then\n    tmux new-window -t {target_q} -n {name_q} -c {path_q}\nfi\n"
            )
        })
        .collect();

    format!(
        r#"#!/usr/bin/env bash
if ! tmux has-session -t {exact_q} 2>/dev/null; then
{create}fi
{reconcile}tmux attach -t {exact_q}
"#
    )
}

/// One single-quoted bash word. Names are typed by a person, or arrive from
/// an imported file: in double quotes, `a"; tmux kill-server; #` is a working
/// way to destroy every session, and one stray `"` is a syntax error that
/// stops every WSL launch. Single quotes are wholly literal; the one
/// character they cannot hold is `'`, which closes, escapes and reopens.
fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

// the first lines of every .command file. terminal runs the file directly,
// not through the rc files, so it starts with the same bare PATH the app
// has, and tmux lives in /opt/homebrew/bin. the -x guard lets an intel mac
// (homebrew in /usr/local, appended) and a mac with no homebrew pass
// through silently. #!/bin/bash, not env bash: env would search the very
// PATH this fixes.
//
// homebrew is not the whole answer: `claude` lives in ~/.local/bin, bun in
// ~/.bun/bin, node in an nvm directory whose version number nobody can
// hardcode. login_path() already asked the login shell for the real answer
// and memoised it for the life of the process, so the resolved string is
// pasted in here and the script pays nothing at launch — no `zsh -ilc` per
// .command.
//
// the rule the order enforces: the script resolves what the detector
// trusted, in the same order. editors::path_lookup walks login_path()'s
// directories and takes the first hit; a script that put $PATH and
// /usr/local/bin in front would, for any name living in both — a homebrew
// `node` over an nvm one, a homebrew `python3` over a pyenv one — launch a
// different file than the one devgo detected, silently. so login_path
// leads and the old fallbacks trail it: they still widen the PATH for a
// machine whose login shell answered with nothing useful, they just no
// longer outrank it.
//
// brew shellenv stays, and not for PATH: login_path already carries
// /opt/homebrew/bin on any mac whose .zprofile runs it, and the fallback
// appends it regardless. what only shellenv sets is HOMEBREW_PREFIX,
// HOMEBREW_CELLAR, MANPATH and INFOPATH, which a PATH string cannot
// carry and some formulae read. it runs first so the PATH line's
// prepend still wins.
//
// the value is single-quoted and concatenated onto the double-quoted
// fallbacks, because a path is not a place to trust $ and `; adjacent
// quoted segments are one bash word, so a directory with a space stays
// one entry. empty is skipped whole: a leading `:` is bash for "and the
// current directory", a PATH entry nobody asked for
#[cfg(any(not(windows), test))]
fn mac_preamble() -> String {
    let path_line = mac_path_line(&super::platform::login_path());
    format!(
        r#"#!/bin/bash
[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
{path_line}
"#
    )
}

// the PATH line alone, pure, so a test can hand it a login path instead of
// waiting on the OnceLock'd login shell this process happens to have
#[cfg(any(not(windows), test))]
fn mac_path_line(login: &str) -> String {
    let login = login.trim();
    if login.is_empty() {
        return r#"export PATH="$PATH:/usr/local/bin""#.to_string();
    }
    format!(r#"export PATH={}:"$PATH:/usr/local/bin""#, sh_quote(login))
}

// the tmux session script for a local project on a mac: the body is
// build_tmux_script's output unchanged, shebang aside, because tmux is
// native here and bash is bash. what the mac adds is what terminal.app
// takes away: the PATH, and one line plus a plain shell when tmux is not
// installed, the courtesy psmux's script extends on windows. cd inside
// the bail so the plain shell is in the project. not a flag on
// build_tmux_script: its output is pinned byte for byte by the wsl tests,
// and a shared function with a mac bool would be the drift this seam
// exists to prevent
#[cfg(any(not(windows), test))]
fn build_mac_script(session: &str, path: &str, tmux: &TmuxConfig) -> String {
    let body = build_tmux_script(session, path, tmux);
    let body = body.strip_prefix("#!/usr/bin/env bash\n").unwrap_or(&body);

    let bail = if tmux.enabled {
        // the same generic bash runs on linux, where homebrew is not the
        // answer; the install line follows the build, not the extension
        #[cfg(target_os = "linux")]
        let install = "sudo apt install tmux";
        #[cfg(not(target_os = "linux"))]
        let install = "brew install tmux";
        format!(
            r#"if ! command -v tmux >/dev/null 2>&1; then
    echo 'DevGo: tmux is not installed, so this is a plain shell. For named windows: {install}'
    cd {} || exit 1
    exec "${{SHELL:-bash}}" -l
fi
"#,
            sh_quote(path)
        )
    } else {
        String::new()
    };

    format!("{}{bail}{body}", mac_preamble())
}

// the three lines the window opens with, before anything of the user's
// runs. terminal echoes the .command's own absolute path and a `; exit;`
// first, so the header starts with a blank line and then says the only
// three things worth saying: which project, where it is, and the line
// about to run. a dim rule closes it and a blank line separates it from
// the command's own output.
//
// colour ONLY when stdout is a terminal that claims to render it: a
// .command can be piped or logged, and escape bytes in a log are worse
// than no colour. -t 1 answers "am i a tty", TERM answers "does it
// understand" — unset or dumb and every variable stays empty, which
// leaves the same header in plain text.
//
// printf, not echo -e: echo -e is not portable and reads the DATA for
// escapes. here the format string is ours alone — the colour variables
// hold either nothing or a literal \033[..m, never a % — and every
// interpolated value arrives as a %s argument, already sh_quote'd, so a
// project called `%s%s` or a path with a backslash prints as itself. the
// rule is a plain repeat of one character rather than a box: nothing to
// misalign when the window is narrow.
#[cfg(any(not(windows), test))]
fn mac_run_header(name: &str, path: &str, command: &str) -> String {
    format!(
        r#"if [ -t 1 ] && [ -n "$TERM" ] && [ "$TERM" != dumb ]; then
    dg_b='\033[1m'; dg_c='\033[36m'; dg_d='\033[2m'; dg_r='\033[0m'
else
    dg_b=''; dg_c=''; dg_d=''; dg_r=''
fi
printf '\n'
printf "$dg_d%s$dg_r $dg_b$dg_c%s$dg_r\n" 'DevGo' {}
printf "$dg_d%s$dg_r\n" {}
printf "$dg_d%s$dg_r $dg_b%s$dg_r\n" '$' {}
printf "$dg_d%s$dg_r\n\n" '──────────────────────────────'
unset dg_b dg_c dg_d dg_r
"#,
        sh_quote(name),
        sh_quote(path),
        sh_quote(command)
    )
}

// the run script for a local project on a mac: PATH, the header, into the
// project, the command, then a login shell so the window stays open there
// after the command exits, windows terminal's -NoExit spelled in bash. a
// failing dev script leaves its error on screen instead of vanishing. the
// path goes through sh_quote; || exit 1 because a cd that fails must not
// run the command wherever terminal started.
//
// the command runs through an INTERACTIVE shell, not this bash directly,
// because no PATH can reach the half of these commands that are not files:
// `pnpm` on a lazy-nvm setup is a shell FUNCTION defined in ~/.zshrc that
// sources nvm on first call, and a function does not exist for any
// non-interactive child, whatever PATH it is handed. -i sources the rc
// file where those functions live; the preamble has already done the PATH,
// so -l is not needed on top. the command is the user's own line, shell
// syntax by definition — sh_quote keeps it one word for THIS shell and the
// interactive one parses it as the shell syntax it is
#[cfg(any(not(windows), test))]
fn build_mac_run_script(name: &str, path: &str, command: &str) -> String {
    format!(
        r#"{}{}cd {} || exit 1
"${{SHELL:-bash}}" -ic {}
exec "${{SHELL:-bash}}" -l
"#,
        mac_preamble(),
        mac_run_header(name, path, command),
        sh_quote(path),
        sh_quote(command)
    )
}

/// The PowerShell twin of build_tmux_script, line for line where the
/// shells allow it. psmux speaks tmux's commands and returns tmux's exit
/// codes, so every rule above holds here for the same reasons: reconcile
/// per window, `=` on every target but the one being created, nothing
/// killed or renamed. The reasons are repeated beside each line rather
/// than pointed at, because whoever edits one script will not have the
/// other open. Built on a Mac too under test, as the Mac script is on
/// Windows: a script is a string, and each platform proving the other's
/// shape is free.
#[cfg(any(windows, test))]
fn build_psmux_script(
    session: &str,
    windows_path: &str,
    tmux: &TmuxConfig,
) -> String {
    // -LiteralPath, not -Path: -Path reads [ and ] as wildcards, and
    // api[v2] is a legal directory that then "cannot be found". first in
    // both branches, so a detach leaves the -NoExit shell in the project
    let path_q = ps_quote(windows_path);
    let cd = format!("Set-Location -LiteralPath {path_q}\n");

    // off is no psmux, not psmux with one window: an empty list still
    // starts a server and leaves a session behind. the template's -NoExit
    // is what keeps this shell open
    if !tmux.enabled {
        return cd;
    }

    let windows = &tmux.window_names;
    let session_q = ps_quote(session);
    let exact_q = ps_quote(&format!("={session}"));
    let target_q = ps_quote(&format!("={session}:"));

    let create = match windows.first() {
        Some(first) => format!(
            "    psmux.exe new-session -d -s {session_q} -n {} -c {path_q}\n",
            ps_quote(first)
        ),
        None => {
            format!("    psmux.exe new-session -d -s {session_q} -c {path_q}\n")
        }
    };

    // -cnotcontains: the plain -notcontains is case-insensitive, so a
    // hand-made Code satisfies the check for code and the window you
    // configured never appears. whole-element too, so git cannot match a
    // git-log. @( ) so one window is still an array and none is an empty
    // one, not $null, which -cnotcontains would read as a list of one
    let reconcile: String = windows
        .iter()
        .map(|name| {
            let name_q = ps_quote(name);
            format!(
                "if (@(psmux.exe list-windows -t {exact_q} -F '#W' 2>$null) -cnotcontains {name_q}) {{\n    psmux.exe new-window -t {target_q} -n {name_q} -c {path_q}\n}}\n"
            )
        })
        .collect();

    // not installed is not an error: the user keeps the plain tab they had
    // before psmux, in the project, plus one line saying how to get the
    // windows. return ends the script and nothing else; exit would end pwsh
    // regardless of -NoExit and close the tab on the one machine where the
    // message matters.
    // psmux.exe, and -CommandType Application: this runs in the user's own
    // shell, profile included, and a profile that aliases psmux to a
    // project picker made Get-Command say yes and every call below open a
    // folder dialog. ask for the program, call the program
    // has-session answers with its exit code, and 1 is the answer we are
    // asking for; a profile that turns the native preference on under
    // ErrorActionPreference Stop would abort the script on it
    format!(
        r#"{cd}if (-not (Get-Command psmux.exe -CommandType Application -ErrorAction SilentlyContinue)) {{
    Write-Host 'DevGo: psmux is not installed, so this is a plain shell. For named windows: winget install marlocarlo.psmux'
    return
}}
$PSNativeCommandUseErrorActionPreference = $false
psmux.exe has-session -t {exact_q} 2>$null
if ($LASTEXITCODE -ne 0) {{
{create}}}
{reconcile}psmux.exe attach -t {exact_q}
"#
    )
}

// the psmux script for a server: one session, one window, and the window
// runs the line (psmux takes a shell command on new-session, as tmux
// does). attach when it exists, so the next click lands on the shell
// already open on the box instead of a second ssh. no psmux is the line
// run plain in the -NoExit shell, the same courtesy the project script
// pays
#[cfg(any(windows, test))]
fn build_psmux_command_script(
    session: &str,
    windows_path: &str,
    command: &str,
) -> String {
    let cd = format!("Set-Location -LiteralPath {}\n", ps_quote(windows_path));
    let session_q = ps_quote(session);
    let exact_q = ps_quote(&format!("={session}"));
    let command_q = ps_quote(command);
    format!(
        r#"{cd}if (-not (Get-Command psmux.exe -CommandType Application -ErrorAction SilentlyContinue)) {{
    Write-Host 'DevGo: psmux is not installed, so this is a plain ssh. For a session: winget install marlocarlo.psmux'
    {command}
    return
}}
$PSNativeCommandUseErrorActionPreference = $false
psmux.exe has-session -t {exact_q} 2>$null
if ($LASTEXITCODE -ne 0) {{
    psmux.exe new-session -d -s {session_q} -n 'ssh' {command_q}
}}
psmux.exe attach -t {exact_q}
"#
    )
}

/// One single-quoted PowerShell string, for the same reason as sh_quote:
/// in double quotes $var and $( ) expand and a `"` ends the string. Single
/// quotes hold everything but `'`, which PowerShell escapes by doubling.
/// A backslash needs nothing done to it, the escape character is the
/// backtick, so G:\dev is G:\dev.
#[cfg(any(windows, test))]
fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Open a terminal that runs a command in the project directory.
pub fn launch_with_command(
    target: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    command: &str,
) -> Result<(), AppError> {
    let (exe, args) = run_line(target, project, info, command)?;
    spawn_raw(&exe, &args)
}

// what launch_with_command spawns, before the spawn: a caller that only
// wants to show the line reads it here
pub fn run_line(
    target: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    command: &str,
) -> Result<(String, String), AppError> {
    let resolved = if is_wsl(project) {
        let distro = distro_from_project(project, info)?;
        let linux_path = super::platform::paths::windows_to_wsl_path(
            &project.full_path,
            &distro,
        );
        target.resolve_run(
            &project.full_path,
            Some((&distro, &linux_path)),
            &escape(command),
        )
    } else {
        target.resolve_run(&project.full_path, None, command)
    };

    let (exe, args) = resolved
        .ok_or_else(|| AppError::TargetCannotRun(target.name.clone()))?;

    let args = run_script_args(&args, project, command)?;
    Ok((exe, args))
}

// the line for a server through one of the local hosts. home is the
// stand-in project (a server is not a folder here; the terminal's {path}
// is the home directory). running is the live distro list, read by the
// caller without booting anything: a stopped default distro is a refusal,
// never a boot
pub fn server_line(
    target: &LaunchTarget,
    home: &Project,
    info: &RuntimeInfo,
    command: &str,
    via: ServerVia,
    running: &[String],
) -> Result<(String, String), AppError> {
    match via {
        ServerVia::Terminal => run_line(target, home, info, command),
        ServerVia::Psmux => psmux_line(target, home, command),
        ServerVia::Wsl => {
            let distro = info
                .default_distro
                .clone()
                .ok_or_else(|| AppError::NoWslDistro(home.name.clone()))?;
            if !super::platform::wsl::is_running(&distro, running) {
                return Err(AppError::WslNotRunning(distro));
            }
            // ~ is wsl's own spelling of the distro user's home, and the
            // line runs under bash -lc, so it is the distro's ssh and the
            // distro's ~/.ssh that answer
            target
                .resolve_run(
                    &home.full_path,
                    Some((&distro, "~")),
                    &escape(command),
                )
                .ok_or_else(|| AppError::TargetCannotRun(target.name.clone()))
        }
    }
}

// the terminal's session form with the server script in the {script}
// seam, the way a project launch goes; a terminal whose template has no
// seam has nowhere to put a session
#[cfg(windows)]
fn psmux_line(
    target: &LaunchTarget,
    home: &Project,
    command: &str,
) -> Result<(String, String), AppError> {
    let (exe, args) =
        target.resolve(&home.full_path, None).ok_or_else(|| {
            AppError::TargetWslOnly(target.name.clone(), home.name.clone())
        })?;
    if !args.contains("{script}") {
        return Err(AppError::TargetCannotHost(target.name.clone()));
    }
    let session = format!("ssh-{}", sanitize_file_stem(&home.name));
    let script = build_psmux_command_script(&session, &home.full_path, command);
    let temp_file = std::env::temp_dir().join(format!("devgo-{session}.ps1"));
    std::fs::write(&temp_file, &script)?;
    Ok((exe, args.replace("{script}", &temp_file.to_string_lossy())))
}

// psmux is a windows thing; a mac's terminal is the row's own button
#[cfg(not(windows))]
fn psmux_line(
    target: &LaunchTarget,
    _home: &Project,
    _command: &str,
) -> Result<(String, String), AppError> {
    Err(AppError::TargetCannotHost(target.name.clone()))
}

// a windows run template carries the command on the terminal's own line
// (the command IS the tab), so there is nothing to write
#[cfg(windows)]
fn run_script_args(
    args: &str,
    _project: &Project,
    _command: &str,
) -> Result<String, AppError> {
    Ok(args.to_string())
}

// a mac run template may ask for {script} instead: terminal.app cannot
// take a command at all, only a file to run, so the command goes into a
// devgo-run-{session}.command. a template without the placeholder
// (wezterm's start -- {command}) is spawned as resolved
#[cfg(not(windows))]
fn run_script_args(
    args: &str,
    project: &Project,
    command: &str,
) -> Result<String, AppError> {
    if !args.contains("{script}") {
        return Ok(args.to_string());
    }
    let session = tmux_session_name(project);
    let script =
        build_mac_run_script(&project.name, &project.full_path, command);
    let path =
        write_command_file(&format!("devgo-run-{session}.command"), &script)?;
    Ok(args.replace("{script}", &path))
}

// the command sits inside a double-quoted bash -lc argument
fn escape(command: &str) -> String {
    command.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn launch_both(
    editor: &LaunchTarget,
    terminal: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    tmux: &TmuxConfig,
) -> Result<(), AppError> {
    launch_target(editor, project, info, tmux)?;
    // The editor needs a moment to claim the foreground, or the terminal opens
    // behind it.
    std::thread::sleep(std::time::Duration::from_millis(1000));
    launch_target(terminal, project, info, tmux)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::target::TargetKind;

    fn tmux_with(names: &[&str]) -> TmuxConfig {
        TmuxConfig {
            enabled: true,
            window_names: names.iter().map(|n| n.to_string()).collect(),
        }
    }

    // every caller below used to assert `script.starts_with(&mac_preamble())`,
    // which is the generator compared with itself: it holds for any PATH
    // order at all, which is how a script that disagreed with the detector
    // shipped green. what a caller actually owes is the shape — shebang,
    // brew's environment, then one PATH line whose hardcoded fallbacks
    // TRAIL the resolved value instead of outranking it
    fn assert_mac_preamble(script: &str) {
        let mut lines = script.lines();
        assert_eq!(lines.next(), Some("#!/bin/bash"), "{script}");
        assert_eq!(
            lines.next(),
            Some(
                r#"[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)""#
            ),
            "{script}"
        );
        let value = lines
            .next()
            .and_then(|l| l.strip_prefix("export PATH="))
            .unwrap_or_else(|| panic!("no PATH line third: {script}"));
        assert!(
            value.ends_with(r#""$PATH:/usr/local/bin""#),
            "the fallbacks trail the login path, they do not lead it: {script}"
        );
        assert!(
            !value.starts_with(':'),
            "a leading colon is the current directory: {script}"
        );
    }

    // the invariant the whole preamble exists for: editors::path_lookup
    // resolves a name by walking login_path()'s directories, first hit
    // wins, so the script must search those same directories first or it
    // launches a different `node` than the one devgo detected. /usr/local/bin
    // is in both lists on a homebrew mac; the login one has to win
    #[test]
    fn the_script_searches_the_login_path_before_the_fallbacks() {
        let line = mac_path_line("/Users/joy/.local/bin:/usr/local/bin");
        let value = line
            .strip_prefix("export PATH=")
            .unwrap_or_else(|| panic!("not a PATH line: {line}"));
        assert!(
            value.starts_with("'/Users/joy/.local/bin"),
            "the resolved path leads: {line}"
        );
        let login_at = value
            .find("/Users/joy/.local/bin")
            .unwrap_or_else(|| panic!("{line}"));
        let fallback_at = value
            .rfind("/usr/local/bin")
            .unwrap_or_else(|| panic!("{line}"));
        assert!(
            login_at < fallback_at,
            "the hardcoded /usr/local/bin shadows the detected one: {line}"
        );
        assert!(
            value.ends_with(r#":"$PATH:/usr/local/bin""#),
            "the old fallbacks are still there, behind: {line}"
        );
    }

    // two real directories, each holding a file of the same name, so the
    // question "which one does this order reach" has a filesystem answer
    // rather than a reading of the format!. the first is what login_path
    // would have answered, the second is what the hardcoded fallbacks
    // reach - on a real mac that second one is /usr/local/bin, which no
    // test may write to, so the test builds its own and hands it to the
    // script as the `$PATH` the fallbacks widen
    fn two_dirs_one_name(
        tag: &str,
        name: &str,
    ) -> (std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(tag);
        let _ = std::fs::remove_dir_all(&root);
        let login = root.join("login");
        let fallback = root.join("fallback");
        for (dir, body) in [(&login, "login"), (&fallback, "fallback")] {
            std::fs::create_dir_all(dir).expect("temp dir");
            let exe = dir.join(name);
            std::fs::write(&exe, format!("#!/bin/sh\nprintf %s {body}\n"))
                .expect("write probe");
            #[cfg(not(windows))]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(
                    &exe,
                    std::fs::Permissions::from_mode(0o755),
                )
                .expect("chmod probe");
            }
        }
        (login, fallback)
    }

    // THE invariant, with no literal in it: devgo has two independent
    // readers of one PATH - editors::binary_on_path, which is what the
    // detector resolved a name with, and this PATH line, which is what the
    // launched script resolves it with. when they disagree devgo reports
    // one binary and runs another, silently. so: put the same name in two
    // directories, let the detector pick, and ask the generated line -
    // structurally, by position - whether it reaches that same directory
    // before it reaches anything the fallbacks bring. an appended login
    // path puts `$PATH` first and fails here.
    #[test]
    fn the_line_reaches_the_directory_the_detector_resolved_from() {
        const NAME: &str = "devgo-agree-probe";
        let (login_dir, fallback_dir) =
            two_dirs_one_name("devgo-path-agreement-order", NAME);

        // the detector's own PATH holds both, login first: that is the
        // machine where the disagreement is even possible
        let login = std::env::join_paths([&login_dir, &fallback_dir])
            .expect("join paths")
            .to_string_lossy()
            .into_owned();
        let detected = crate::services::editors::binary_on_path(&login, NAME)
            .expect("the detector finds the probe");
        let detected_dir = detected.parent().expect("a parent").to_path_buf();
        assert_eq!(detected_dir, login_dir, "the detector takes the first hit");

        let line = mac_path_line(&login);
        let value = line
            .strip_prefix("export PATH=")
            .unwrap_or_else(|| panic!("not a PATH line: {line}"));

        let detected_at = value
            .find(&*detected_dir.to_string_lossy())
            .unwrap_or_else(|| {
                panic!("the detector's directory is not on the script's PATH at all: {line}")
            });
        let inherited_at = value
            .find("$PATH")
            .unwrap_or_else(|| panic!("no inherited PATH in: {line}"));
        assert!(
            detected_at < inherited_at,
            "the script reaches $PATH before the directory devgo detected \
             from, so it launches a different {NAME}: {line}"
        );
        let hardcoded_at = value
            .rfind("/usr/local/bin")
            .unwrap_or_else(|| panic!("no fallback in: {line}"));
        assert!(
            detected_at < hardcoded_at,
            "the hardcoded fallback outranks the detected directory: {line}"
        );
    }

    // the same invariant with the reading taken out: bash runs the
    // generated line and says which file it would launch, and that has to
    // be the file the detector resolved, byte for byte. only off windows -
    // there login_path() is a `C:\...;C:\...` string, and a bash given that
    // as its PATH reaches neither directory, so the agreement it would
    // "prove" is two failures matching. the test above is the windows half.
    #[cfg(not(windows))]
    #[test]
    fn bash_launches_the_file_the_detector_resolved() {
        const NAME: &str = "devgo-agree-run";
        let (login_dir, fallback_dir) =
            two_dirs_one_name("devgo-path-agreement-run", NAME);

        let login = std::env::join_paths([&login_dir, &fallback_dir])
            .expect("join paths")
            .to_string_lossy()
            .into_owned();
        let detected = crate::services::editors::binary_on_path(&login, NAME)
            .expect("the detector finds the probe");

        // the environment a .command really opens in: the fallbacks' half
        // of the line - `$PATH` - reaches the other copy
        let out = Command::new("/bin/bash")
            .arg("-c")
            .arg(format!("{}\ncommand -v {NAME}\n", mac_path_line(&login)))
            .env("PATH", &fallback_dir)
            .output()
            .expect("bash");
        let launched = String::from_utf8_lossy(&out.stdout).trim().to_string();
        assert_eq!(
            launched,
            detected.to_string_lossy(),
            "the script launches a different {NAME} than devgo detected"
        );
    }

    // a login path nobody could resolve leaves the line exactly as it was
    // before login_path was pasted in: no `:` with nothing in front of it,
    // which bash reads as the current directory
    #[test]
    fn an_empty_login_path_leaves_no_stray_separator() {
        let bare = r#"export PATH="$PATH:/usr/local/bin""#;
        assert_eq!(mac_path_line(""), bare);
        assert_eq!(mac_path_line("   \n"), bare);
        assert!(!mac_path_line("").contains("=:"));
        assert!(!mac_path_line("").contains("::"));
    }

    // a homebrew prefix under /Users/joy's mac or an nvm directory inside a
    // folder with a space is one PATH entry, not two words: the value is
    // single-quoted and butted up against the double-quoted fallbacks, and
    // bash joins adjacent quoted segments into one word
    #[test]
    fn a_login_path_with_a_space_and_an_apostrophe_stays_one_word() {
        assert_eq!(
            mac_path_line("/opt/a b/bin:/Users/joy's mac/.local/bin"),
            r#"export PATH='/opt/a b/bin:/Users/joy'\''s mac/.local/bin':"$PATH:/usr/local/bin""#
        );
        // and nothing the shell would expand survives unquoted
        let line = mac_path_line("/x/$HOME/`whoami`/bin");
        assert_eq!(
            line,
            r#"export PATH='/x/$HOME/`whoami`/bin':"$PATH:/usr/local/bin""#
        );
    }

    /// The one way to register a program no installer puts on PATH is an
    /// absolute exe path, and the ones installers write have a space in
    /// them. cmd reads the first word of the line as the program, so
    /// `C:\Program Files\Trove\trove.exe` launched `C:\Program`, cmd printed
    /// into a window nobody sees and spawn_raw still returned Ok. The outer
    /// pair is cmd's own rule: with more than two quotes on the line it
    /// strips the first and the last, so without it the exe's closing quote
    /// would be the one eaten.
    #[cfg(windows)]
    #[test]
    fn a_spaced_exe_path_is_quoted_for_cmd() {
        let line =
            cmd_line(r"C:\Program Files\Trove\trove.exe", r#""G:\dev\app""#);
        assert_eq!(
            line,
            r#"/c ""C:\Program Files\Trove\trove.exe" "G:\dev\app"""#
        );
        // every line that worked before is still the same bytes
        assert_eq!(
            cmd_line("code", r#""G:\dev\app""#),
            r#"/c code "G:\dev\app""#
        );
    }

    /// The same line through the real cmd, not a string comparison: cmd's
    /// quote rule is the whole reason for the outer pair, and only cmd can
    /// say whether it was read the way this expects. Without it cmd answers
    /// "'C:\Program' is not recognized", writes the empty file the
    /// redirection created, and spawn_raw still returns Ok - the silent
    /// failure a hand-registered Trove would have hit. The empty file is
    /// what makes the assertion honest: the marker exists either way, and
    /// only a program that really ran puts bytes in it.
    #[cfg(windows)]
    #[test]
    fn a_spaced_exe_path_really_launches() {
        let dir = std::env::temp_dir().join("devgo spaced exe");
        std::fs::create_dir_all(&dir).unwrap();
        let probe = dir.join("my probe.bat");
        let marker = dir.join("landed.txt");
        let _ = std::fs::remove_file(&marker);
        std::fs::write(&probe, "@echo landed\r\n").unwrap();

        spawn_raw(
            &probe.to_string_lossy(),
            &format!("> \"{}\"", marker.display()),
        )
        .unwrap();

        let written = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(written() > 0, "{} is empty", marker.display());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn wsl_project(name: &str, workspace: &str) -> Project {
        Project::new(
            name.into(),
            format!(r"\\wsl.localhost\Ubuntu\home\user\{workspace}\{name}"),
            format!(r"\\wsl.localhost\Ubuntu\home\user\{workspace}"),
            "WSL".into(),
        )
    }

    // a windows project, because psmux only enters the picture for those
    #[cfg(windows)]
    fn windows_project(name: &str, workspace: &str) -> Project {
        Project::new(
            name.into(),
            format!(r"G:\{workspace}\{name}"),
            format!(r"G:\{workspace}"),
            "Windows".into(),
        )
    }

    // every test that really spawns needs a program that certainly exists
    // and can be told to exit, or to echo a substituted argument into a
    // marker file: cmd on windows, sh elsewhere. written once against
    // these, so each proves the same thing on both platforms
    #[cfg(windows)]
    const SHELL: &str = "cmd";
    #[cfg(not(windows))]
    const SHELL: &str = "sh";

    // runs the shell and exits, with the suffix on the line: on windows
    // exit ignores what follows, on unix it lands in $0 and is ignored too
    #[cfg(windows)]
    fn shell_exit(suffix: &str) -> String {
        format!("/c exit{suffix}")
    }
    #[cfg(not(windows))]
    fn shell_exit(suffix: &str) -> String {
        format!("-c exit{suffix}")
    }

    // echoes `what` (a placeholder, so the launcher fills it in) into
    // marker. three arguments plus a redirect on windows; on unix one -c
    // string the template itself quotes, which sh -c must not re-quote
    #[cfg(windows)]
    fn shell_echo_to(what: &str, marker: &std::path::Path) -> String {
        format!("/c echo {what} > \"{}\"", marker.display())
    }
    #[cfg(not(windows))]
    fn shell_echo_to(what: &str, marker: &std::path::Path) -> String {
        format!("-c \"echo {what} > '{}'\"", marker.display())
    }

    // dumps the child's environment into marker
    #[cfg(windows)]
    fn shell_dump_env(marker: &std::path::Path) -> String {
        format!("/c set > \"{}\"", marker.display())
    }
    #[cfg(not(windows))]
    fn shell_dump_env(marker: &std::path::Path) -> String {
        format!("-c \"env > '{}'\"", marker.display())
    }

    // the extension of the local session script: powershell on windows, a
    // terminal.app .command on a mac
    #[cfg(windows)]
    const LOCAL_SCRIPT_EXT: &str = "ps1";
    #[cfg(not(windows))]
    const LOCAL_SCRIPT_EXT: &str = "command";

    // a local path spelled the way this platform spells one
    #[cfg(windows)]
    fn local_path(rest: &str) -> String {
        format!(r"G:\{}", rest.replace('/', r"\"))
    }
    #[cfg(not(windows))]
    fn local_path(rest: &str) -> String {
        format!("/Users/user/{rest}")
    }

    // a project on this platform's local filesystem, for the tests that
    // really launch and look at what the process was handed
    fn local_project(name: &str, workspace: &str) -> Project {
        Project::new(
            name.into(),
            local_path(&format!("{workspace}/{name}")),
            local_path(workspace),
            crate::services::scanner::LOCAL_FS.into(),
        )
    }

    fn no_distro() -> RuntimeInfo {
        RuntimeInfo {
            runtime: crate::services::platform::runtime::Runtime::Windows,
            wsl_available: false,
            distros: vec![],
            default_distro: None,
            local_fs: crate::services::scanner::LOCAL_FS,
        }
    }

    #[test]
    fn the_session_name_is_sanitised_and_unique_per_project_path() {
        let dotted = Project::new(
            "my.app:2".into(),
            r"\\wsl.localhost\Ubuntu\home\user\work\my.app".into(),
            r"\\wsl.localhost\Ubuntu\home\user\work".into(),
            "WSL".into(),
        );
        let session = tmux_session_name(&dotted);
        assert!(
            !session.contains('.') && !session.contains(':'),
            "{session}"
        );
        assert!(session.starts_with("my-app-2-"), "{session}");

        let work = wsl_project("api", "work");
        let play = wsl_project("api", "play");
        assert_ne!(tmux_session_name(&work), tmux_session_name(&play));

        // the same directory under another spelling is the same session
        let shouted = Project::new(
            "api".into(),
            r"//WSL.LOCALHOST/Ubuntu/home/user/work/api".into(),
            r"//WSL.LOCALHOST/Ubuntu/home/user/work".into(),
            "WSL".into(),
        );
        assert_eq!(tmux_session_name(&work), tmux_session_name(&shouted));
    }

    /// {script} is the one placeholder resolve knows nothing about; the
    /// launcher fills it afterwards, because only the launcher writes the file.
    #[test]
    fn the_script_placeholder_is_filled_by_the_launcher_not_by_resolve() {
        let every = LaunchTarget {
            id: "every".into(),
            name: "Every Placeholder".into(),
            kind: TargetKind::Terminal,
            executable: "wt".into(),
            args_template: "-d \"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: Some(
                "{distro} {linux_path} {path} {script}".into(),
            ),
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        let windows_path = r"\\wsl.localhost\Ubuntu\home\user\api";
        let (_, args) = every
            .resolve(windows_path, Some(("Ubuntu", "/home/user/api")))
            .unwrap();
        assert_eq!(
            args,
            format!("Ubuntu /home/user/api {windows_path} {{script}}")
        );

        // the other half: the launcher fills it with a file it really wrote.
        // cmd, not wsl, so the suite does not depend on a distro
        let marker =
            std::env::temp_dir().join("devgo-script-placeholder-proof.txt");
        let _ = std::fs::remove_file(&marker);
        let echoes = LaunchTarget {
            id: "echo-script".into(),
            name: "Echo Script".into(),
            kind: TargetKind::Terminal,
            executable: SHELL.into(),
            args_template: shell_exit(""),
            wsl_executable: None,
            wsl_args_template: Some(shell_echo_to("{script}", &marker)),
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        let project = wsl_project("placeholder", "work");
        launch_target(&echoes, &project, &no_distro(), &tmux_with(&["code"]))
            .unwrap();
        let written_len = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written_len() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let written =
            std::fs::read_to_string(&marker).expect("target never ran");
        assert!(!written.contains("{script}"), "{written:?}");
        assert!(written.contains(".sh"), "{written:?}");
        let _ = std::fs::remove_file(&marker);
    }

    /// A terminal that opens the directory directly asks for no script and
    /// must not be left one in %TEMP%.
    #[test]
    fn a_terminal_template_without_the_placeholder_writes_no_script() {
        let project = wsl_project("orphan-check", "work");
        let script_path = std::env::temp_dir()
            .join(format!("devgo-{}.sh", tmux_session_name(&project)));
        let _ = std::fs::remove_file(&script_path);
        let plain = LaunchTarget {
            id: "plain".into(),
            name: "Plain".into(),
            kind: TargetKind::Terminal,
            executable: SHELL.into(),
            args_template: shell_exit(""),
            wsl_executable: None,
            wsl_args_template: Some(shell_exit("")),
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        launch_target(&plain, &project, &no_distro(), &tmux_with(&["code"]))
            .unwrap();
        // the write is synchronous inside launch_target: it exists or never was
        assert!(!script_path.exists(), "{}", script_path.display());
    }

    // a directory name carrying every character that ends a word for one
    // shell or another: a space, an ampersand, an apostrophe, parentheses
    const SPLIT_BAIT_DIR: &str = "devgo probe (a & b)'s";

    // writes `landed` at the substituted {path}, through the same double
    // quotes every shipped template puts round the seam. split wrong, the
    // redirect goes somewhere else and the file never appears
    #[cfg(windows)]
    fn shell_write_to_path() -> String {
        "/c echo landed > \"{path}\"".to_string()
    }
    #[cfg(not(windows))]
    fn shell_write_to_path() -> String {
        r#"-c "echo landed > \"{path}\"""#.to_string()
    }

    /// Nothing in the crate splits the resolved line: cmd /c on Windows and
    /// sh -c elsewhere do, and both honour the quotes. This is the claim end
    /// to end — a real spawn, a path with a space in it, and the file where
    /// the template said to put it.
    #[test]
    fn a_path_with_a_space_reaches_the_target_as_one_argument() {
        let dir = std::env::temp_dir().join(SPLIT_BAIT_DIR);
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("landed.txt");
        let _ = std::fs::remove_file(&marker);

        let project = Project::new(
            "probe".into(),
            marker.to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
            crate::services::scanner::LOCAL_FS.into(),
        );
        let probe = LaunchTarget {
            id: "probe".into(),
            name: "Probe".into(),
            kind: TargetKind::Terminal,
            executable: SHELL.into(),
            args_template: shell_write_to_path(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        launch_target(&probe, &project, &no_distro(), &tmux_with(&["code"]))
            .unwrap();

        let written = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(written() > 0, "{} never appeared", marker.display());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_custom_window_list_produces_exactly_those_windows_in_order() {
        let names = ["editor", "logs", "db", "shell"];
        let script =
            build_tmux_script("app-deadbeef", "/srv/app", &tmux_with(&names));
        assert_eq!(script.matches("tmux new-session").count(), 1);
        // names.len(), not names.len() - 1: the first name is reconciled too
        assert_eq!(script.matches("tmux new-window").count(), names.len());
        let mut cursor = 0;
        for name in names {
            let needle = format!("-n '{name}' -c '/srv/app'");
            let at = script[cursor..]
                .find(&needle)
                .unwrap_or_else(|| panic!("{name} missing or out of order"));
            cursor += at + needle.len();
        }
        for stale in ["code", "agents", "git"] {
            assert!(!script.contains(stale), "the default leaked: {script}");
        }
    }

    #[test]
    fn an_empty_window_list_opens_one_unnamed_window() {
        let script =
            build_tmux_script("app-deadbeef", "/srv/app", &tmux_with(&[]));
        assert!(script
            .contains("tmux new-session -d -s 'app-deadbeef' -c '/srv/app'"));
        assert!(!script.contains("-n "), "must not name a window: {script}");
        assert!(
            !script.contains("new-window"),
            "nothing to reconcile: {script}"
        );
        assert!(script.contains("tmux attach -t '=app-deadbeef'"));
    }

    /// has-session -t app is satisfied by a running app-api; `=` forces an
    /// exact match everywhere but on the name being created.
    #[test]
    fn every_tmux_target_is_matched_exactly_except_the_name_being_created() {
        let script = build_tmux_script(
            "app",
            "/srv/app",
            &tmux_with(&["code", "agents"]),
        );
        assert!(script.contains("tmux has-session -t '=app'"), "{script}");
        assert!(script.contains("tmux list-windows -t '=app'"), "{script}");
        assert!(script.contains("tmux new-window -t '=app:'"), "{script}");
        assert!(script.contains("tmux attach -t '=app'"), "{script}");
        assert!(!script.contains("-s '=app"), "{script}");
    }

    /// "Make the session match the list" is the most natural edit anyone
    /// will propose here, and it is the one that loses a running build.
    #[test]
    fn reconciliation_never_kills_or_renames_a_window() {
        let script = build_tmux_script(
            "app-deadbeef",
            "/srv/app",
            &tmux_with(&["code", "agents"]),
        );
        for destructive in [
            "kill-window",
            "kill-session",
            "kill-server",
            "rename-window",
            "rename-session",
            "move-window",
            "unlink-window",
        ] {
            assert!(!script.contains(destructive), "{destructive}: {script}");
        }
    }

    /// Every other test here is a contains over one flat string and would
    /// pass with the new-window blocks back inside the guard. What makes
    /// reconciliation work is where the blocks sit.
    #[test]
    fn the_reconcile_blocks_sit_outside_the_has_session_guard() {
        let script = build_tmux_script(
            "app-deadbeef",
            "/srv/app",
            &tmux_with(&["code", "git"]),
        );
        let fi = script.find("\nfi\n").expect("the guard closes");
        let first_reconcile =
            script.find("tmux list-windows").expect("reconciles");
        assert!(first_reconcile > fi, "back inside the guard: {script}");
        assert_eq!(
            script[..fi].matches("tmux new-window").count(),
            0,
            "{script}"
        );
    }

    #[test]
    fn a_window_name_that_looks_like_an_option_is_still_a_pattern() {
        let script = build_tmux_script(
            "app-deadbeef",
            "/srv/app",
            &tmux_with(&["code", "-log"]),
        );
        assert!(script.contains("grep -Fxq -- 'code'"), "{script}");
        assert!(script.contains("grep -Fxq -- '-log'"), "{script}");
        assert_eq!(
            script.matches("grep -Fxq -- ").count(),
            script.matches("grep ").count(),
            "a grep without -- crept back in: {script}"
        );
    }

    #[test]
    fn a_hostile_window_name_stays_one_inert_word() {
        let hostile = r#"a"; tmux kill-server; #"#;
        let names = tmux_with(&[hostile, "$(touch /tmp/pwned)", "it's"]);
        let script = build_tmux_script("app-deadbeef", "/srv/app", &names);
        // the script does say kill-server, harmlessly, inside the quoted name;
        // it must never say it anywhere else
        let quoted = format!("'{hostile}'");
        assert_eq!(
            script.matches("kill-server").count(),
            script.matches(&quoted).count(),
            "a name escaped its quotes: {script}"
        );
        assert_eq!(script.matches(&quoted).count(), 3, "{script}");
        assert!(script.contains("'$(touch /tmp/pwned)'"), "{script}");
        assert!(script.contains(r"'it'\''s'"), "{script}");
        // every double quote left is one the name contained
        assert_eq!(script.matches('"').count(), 3, "{script}");
    }

    /// back$up is a legal directory; unquoted, bash expands $up to nothing.
    #[test]
    fn a_project_path_with_shell_characters_is_not_expanded() {
        let script = build_tmux_script(
            "app-deadbeef",
            "/home/user/back$up",
            &tmux_with(&["code"]),
        );
        assert!(script.contains("-c '/home/user/back$up'"), "{script}");
    }

    #[test]
    fn the_temp_script_filename_carries_the_session_name() {
        let here = wsl_project("api", "work");
        let there = wsl_project("api", "other");
        let terminal = LaunchTarget {
            id: "tmux-term".into(),
            name: "tmux Terminal".into(),
            kind: TargetKind::Terminal,
            executable: SHELL.into(),
            args_template: shell_exit(""),
            wsl_executable: None,
            wsl_args_template: Some(shell_exit(" {script}")),
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        for project in [&here, &there] {
            let expected = std::env::temp_dir()
                .join(format!("devgo-{}.sh", tmux_session_name(project)));
            let _ = std::fs::remove_file(&expected);
            launch_target(
                &terminal,
                project,
                &no_distro(),
                &tmux_with(&["code"]),
            )
            .unwrap();
            assert!(expected.exists(), "{}", expected.display());
            let _ = std::fs::remove_file(&expected);
        }
    }

    #[test]
    fn tmux_switched_off_opens_a_plain_shell_and_no_session() {
        let off = TmuxConfig {
            enabled: false,
            window_names: vec!["code".into()],
        };
        let script = build_tmux_script("api", "/home/user/api", &off);
        assert!(!script.contains("tmux"), "{script}");
        assert!(script.contains("cd '/home/user/api'"), "{script}");
        assert!(script.contains(r#"exec "${SHELL:-bash}" -l"#), "{script}");
    }

    /// The list is ignored while off and still there when it comes back.
    #[test]
    fn the_window_list_survives_being_switched_off() {
        let names = ["editor", "logs", "db"];
        let off = TmuxConfig {
            enabled: false,
            ..tmux_with(&names)
        };
        let off_script = build_tmux_script("app", "/srv/app", &off);
        for name in names {
            assert!(!off_script.contains(name), "{off_script}");
        }
        let on = TmuxConfig {
            enabled: true,
            ..off
        };
        let on_script = build_tmux_script("app", "/srv/app", &on);
        for name in names {
            assert!(on_script.contains(&format!("-n '{name}'")), "{on_script}");
        }
    }

    /// bool::default() is false; a plain serde(default) on `enabled` would
    /// have switched tmux off for every existing install.
    #[test]
    fn tmux_is_on_for_a_config_that_predates_the_switch() {
        let parsed: TmuxConfig =
            serde_json::from_str(r#"{"window_names":["code","agents"]}"#)
                .unwrap();
        assert!(parsed.enabled);
        assert_eq!(
            parsed.window_names,
            vec!["code".to_string(), "agents".to_string()]
        );
    }

    /// The shipped default must still be byte-for-byte what the three
    /// hardcoded lines produced, or every existing session gets a new layout.
    #[test]
    fn the_default_list_still_opens_code_agents_and_git_in_that_order() {
        let shipped = TmuxConfig::default();
        assert!(shipped.enabled, "tmux on, or every install loses it");
        assert_eq!(shipped.window_names, ["code", "agents", "git"]);
        let script = build_tmux_script("api", "/home/user/api", &shipped);
        let mut cursor = 0;
        for name in &shipped.window_names {
            let needle = format!("-n '{name}' -c '/home/user/api'");
            let at = script[cursor..]
                .find(&needle)
                .unwrap_or_else(|| panic!("{name} missing or out of order"));
            cursor += at + needle.len();
        }
    }

    // psmux: each test below is the Windows twin of a tmux test above. A
    // rule that holds for one script and silently not the other is the
    // asymmetry this work exists to remove

    #[test]
    fn the_default_list_opens_code_agents_and_git_under_psmux_too() {
        let shipped = TmuxConfig::default();
        let script =
            build_psmux_script("api-1f2e3d4c", r"G:\dev\api", &shipped);
        assert!(
            script.contains(
                r"psmux.exe new-session -d -s 'api-1f2e3d4c' -n 'code' -c 'G:\dev\api'"
            ),
            "the first window belongs to new-session: {script}"
        );
        let mut cursor = 0;
        for name in &shipped.window_names {
            let needle = format!(r"-n '{name}' -c 'G:\dev\api'");
            let at = script[cursor..]
                .find(&needle)
                .unwrap_or_else(|| panic!("{name} missing or out of order"));
            cursor += at + needle.len();
        }
    }

    #[test]
    fn a_custom_window_list_produces_exactly_those_psmux_windows_in_order() {
        let names = ["editor", "logs", "db", "shell"];
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&names),
        );
        assert_eq!(script.matches("psmux.exe new-session").count(), 1);
        // the first name is reconciled too
        assert_eq!(script.matches("psmux.exe new-window").count(), names.len());
        let mut cursor = 0;
        for name in names {
            let needle = format!(r"-n '{name}' -c 'G:\srv\app'");
            let at = script[cursor..]
                .find(&needle)
                .unwrap_or_else(|| panic!("{name} missing or out of order"));
            cursor += at + needle.len();
        }
        for stale in ["code", "agents", "git"] {
            assert!(!script.contains(stale), "the default leaked: {script}");
        }
    }

    #[test]
    fn an_empty_window_list_opens_one_unnamed_psmux_window() {
        let script =
            build_psmux_script("app-deadbeef", r"G:\srv\app", &tmux_with(&[]));
        assert!(script.contains(
            r"psmux.exe new-session -d -s 'app-deadbeef' -c 'G:\srv\app'"
        ));
        assert!(!script.contains("-n "), "must not name a window: {script}");
        assert!(
            !script.contains("new-window"),
            "nothing to reconcile: {script}"
        );
        assert!(script.contains("psmux.exe attach -t '=app-deadbeef'"));
    }

    /// Probed on psmux 3.3.8: a bare name matches exactly and a prefix not
    /// at all, so the `=` is inert there today. It stays: tmux's own rule
    /// is prefix match, psmux tracks tmux, and a release that adopts the
    /// rule would attach you to somebody else's project without a word.
    #[test]
    fn every_psmux_target_is_matched_exactly_except_the_name_being_created() {
        let script = build_psmux_script(
            "app",
            r"G:\srv\app",
            &tmux_with(&["code", "agents"]),
        );
        assert!(
            script.contains("psmux.exe has-session -t '=app'"),
            "{script}"
        );
        assert!(
            script.contains("psmux.exe list-windows -t '=app'"),
            "{script}"
        );
        assert!(
            script.contains("psmux.exe new-window -t '=app:'"),
            "{script}"
        );
        assert!(script.contains("psmux.exe attach -t '=app'"), "{script}");
        assert!(!script.contains("-s '=app"), "{script}");
        assert_eq!(
            script.matches(" -t ").count(),
            script.matches(" -t '=").count(),
            "a target without = crept in: {script}"
        );
    }

    #[test]
    fn psmux_reconciliation_never_kills_or_renames_a_window() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code", "agents"]),
        );
        for destructive in [
            "kill-window",
            "kill-session",
            "kill-server",
            "rename-window",
            "rename-session",
            "move-window",
            "unlink-window",
        ] {
            assert!(!script.contains(destructive), "{destructive}: {script}");
        }
    }

    /// The contains checks above cannot see where a block sits; this can.
    #[test]
    fn the_psmux_reconcile_blocks_sit_outside_the_has_session_guard() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code", "git"]),
        );
        let guard = script
            .find("if ($LASTEXITCODE -ne 0) {")
            .expect("the guard opens");
        let guard_close =
            guard + script[guard..].find("\n}\n").expect("the guard closes");
        let first_reconcile =
            script.find("psmux.exe list-windows").expect("reconciles");
        assert!(
            first_reconcile > guard_close,
            "back inside the guard: {script}"
        );
        assert_eq!(
            script[..guard_close]
                .matches("psmux.exe new-window")
                .count(),
            0,
            "{script}"
        );
    }

    /// -notcontains is case-insensitive, so a hand-made Code satisfies the
    /// check for code; -cnotcontains is the grep -Fx of this script, and
    /// one easily deleted letter.
    #[test]
    fn a_psmux_window_name_is_compared_exactly_and_case_sensitively() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code", "-log"]),
        );
        assert!(script.contains("-cnotcontains 'code'"), "{script}");
        assert!(script.contains("-cnotcontains '-log'"), "{script}");
        assert_eq!(
            script.matches("-cnotcontains ").count(),
            script.matches("notcontains").count(),
            "a case-insensitive -notcontains crept back in: {script}"
        );
        // one window is a string and none is $null; @( ) makes both a list
        assert_eq!(
            script.matches("if (@(psmux.exe list-windows").count(),
            2,
            "{script}"
        );
    }

    #[test]
    fn a_hostile_window_name_stays_one_inert_powershell_string() {
        let hostile = r#"a"; psmux kill-server; #"#;
        let names =
            tmux_with(&[hostile, "$(Remove-Item -Recurse G:\\)", "it's"]);
        let script = build_psmux_script("app-deadbeef", r"G:\srv\app", &names);
        let quoted = format!("'{hostile}'");
        assert_eq!(
            script.matches("kill-server").count(),
            script.matches(&quoted).count(),
            "a name escaped its quotes: {script}"
        );
        assert_eq!(script.matches(&quoted).count(), 3, "{script}");
        assert!(
            script.contains("'$(Remove-Item -Recurse G:\\)'"),
            "{script}"
        );
        // powershell's own escape for a quote inside single quotes: double it
        assert!(script.contains("'it''s'"), "{script}");
        // the bash escape would end the string and leave a stray backslash
        assert!(!script.contains(r"'\''"), "{script}");
        // every double quote left is one the name contained
        assert_eq!(script.matches('"').count(), 3, "{script}");
    }

    /// Set-Location -Path 'G:\dev\api[v2]' reads the brackets as a wildcard
    /// and fails on a directory that is right there.
    #[test]
    fn a_project_path_with_wildcard_characters_is_taken_literally() {
        let on = build_psmux_script(
            "app-deadbeef",
            r"G:\dev\api[v2]",
            &tmux_with(&["code"]),
        );
        let off = build_psmux_script(
            "app-deadbeef",
            r"G:\dev\api[v2]",
            &TmuxConfig {
                enabled: false,
                window_names: vec![],
            },
        );
        for script in [&on, &off] {
            assert!(
                script.contains(r"Set-Location -LiteralPath 'G:\dev\api[v2]'"),
                "{script}"
            );
            assert!(!script.contains("Set-Location -Path"), "{script}");
        }
        assert!(on.contains(r"-c 'G:\dev\api[v2]'"), "{on}");
    }

    /// With -NoExit on the template a bare Set-Location is a shell that
    /// stays open in the project.
    #[test]
    fn psmux_switched_off_opens_a_plain_shell_and_no_session() {
        let off = TmuxConfig {
            enabled: false,
            window_names: vec!["code".into()],
        };
        let script = build_psmux_script("api-1f2e3d4c", r"G:\dev\api", &off);
        assert!(!script.contains("psmux"), "{script}");
        assert_eq!(script, "Set-Location -LiteralPath 'G:\\dev\\api'\n");
    }

    #[test]
    fn a_machine_without_psmux_gets_a_plain_shell_and_the_install_command() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code"]),
        );
        let check = script
            .find("if (-not (Get-Command psmux.exe -CommandType Application")
            .expect("asks whether psmux is installed");
        let cd = script.find("Set-Location").expect("enters the project");
        let first_call =
            script.find("psmux.exe has-session").expect("then talks");
        assert!(cd < check, "the directory comes before any bail: {script}");
        assert!(check < first_call, "the check comes first: {script}");
        assert!(
            script.contains("winget install marlocarlo.psmux"),
            "{script}"
        );
        let bail = &script[check..first_call];
        assert!(bail.contains("    return\n"), "{bail}");
        assert!(!bail.contains("exit"), "exit would close the tab: {bail}");
        assert!(
            !bail.contains("throw") && !bail.contains("Write-Error"),
            "not installed is not an error: {bail}"
        );
    }

    // a server's session: the window is the ssh, and a second launch
    // attaches to it rather than opening a second ssh
    #[test]
    fn a_psmux_session_for_a_server_runs_the_line_in_its_window() {
        let line = "ssh -t box tmux new-session -A -s devgo";
        let script =
            build_psmux_command_script("ssh-box", r"C:\Users\user", line);
        assert!(
            script.contains(&format!(
                "psmux.exe new-session -d -s 'ssh-box' -n 'ssh' '{line}'"
            )),
            "{script}"
        );
        assert!(script.contains("psmux.exe has-session -t '=ssh-box'"));
        assert!(script.ends_with("psmux.exe attach -t '=ssh-box'\n"));
        // no psmux: the line runs plain, the tab stays
        let check = script.find("Get-Command psmux.exe").unwrap();
        let first_call = script.find("psmux.exe has-session").unwrap();
        let bail = &script[check..first_call];
        assert!(
            bail.contains(&format!("\n    {line}\n    return\n")),
            "{bail}"
        );
        assert!(!script.contains("new-window"), "one window, no layout");
    }

    // the seeded windows terminal, the way commands.rs hands it over
    #[cfg(windows)]
    fn wt() -> LaunchTarget {
        crate::models::target::defaults()
            .into_iter()
            .find(|t| t.id == "wt")
            .unwrap()
    }

    #[cfg(windows)]
    fn home() -> Project {
        Project::new(
            "box".into(),
            r"C:\Users\user".into(),
            String::new(),
            crate::services::scanner::LOCAL_FS.into(),
        )
    }

    fn with_distro(name: &str) -> RuntimeInfo {
        RuntimeInfo {
            runtime: crate::services::platform::runtime::Runtime::Windows,
            wsl_available: true,
            distros: vec![name.into()],
            default_distro: Some(name.into()),
            local_fs: crate::services::scanner::LOCAL_FS,
        }
    }

    const SSH: &str = "ssh -t box tmux new-session -A -s devgo";

    // the terminal host is the run template with the line as the tab
    #[cfg(windows)]
    #[test]
    fn a_server_through_the_terminal_is_the_ssh_line_in_a_tab() {
        let (exe, args) = server_line(
            &wt(),
            &home(),
            &no_distro(),
            SSH,
            ServerVia::Terminal,
            &[],
        )
        .unwrap();
        assert_eq!(exe, "wt");
        assert_eq!(args, format!(r#"-d "C:\Users\user" {SSH}"#));
    }

    // the psmux host is the session form: the script in the seam holds
    // the line, the tab attaches to it
    #[cfg(windows)]
    #[test]
    fn a_server_through_psmux_attaches_a_session_that_runs_the_line() {
        let (exe, args) = server_line(
            &wt(),
            &home(),
            &no_distro(),
            SSH,
            ServerVia::Psmux,
            &[],
        )
        .unwrap();
        assert_eq!(exe, "wt");
        assert!(args.contains("pwsh -NoExit"), "{args}");
        assert!(!args.contains(SSH), "the line rides in the script: {args}");
        let script_path = args
            .rsplit_once("-File \"")
            .map(|(_, p)| p.trim_end_matches('"'))
            .unwrap();
        assert!(script_path.ends_with("devgo-ssh-box.ps1"), "{script_path}");
        let script = std::fs::read_to_string(script_path).unwrap();
        assert!(script.contains(&format!("-s 'ssh-box' -n 'ssh' '{SSH}'")));
        assert!(script.contains("attach -t '=ssh-box'"));

        // a terminal without the seam has nowhere to put a session
        let mut bare = wt();
        bare.args_template = "-d \"{path}\"".into();
        let err = server_line(
            &bare,
            &home(),
            &no_distro(),
            SSH,
            ServerVia::Psmux,
            &[],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::TargetCannotHost(_)), "{err}");
    }

    // the wsl host is the terminal's wsl run form with the distro's own
    // ssh: ~ for the distro's home, bash -lc for its PATH and ~/.ssh
    #[cfg(windows)]
    #[test]
    fn a_server_through_wsl_runs_the_distros_own_ssh() {
        let (exe, args) = server_line(
            &wt(),
            &home(),
            &with_distro("Ubuntu"),
            SSH,
            ServerVia::Wsl,
            &["Ubuntu".into()],
        )
        .unwrap();
        assert_eq!(exe, "wt");
        assert_eq!(
            args,
            format!(
                r#"wsl -d Ubuntu --cd "~" -e bash -lc "{SSH}\; exec bash""#
            )
        );
    }

    // never a boot: a stopped default distro is a refusal that names it,
    // and no distro at all is the older refusal
    #[test]
    fn a_server_through_wsl_is_refused_when_the_distro_is_not_running() {
        let target = LaunchTarget {
            id: "t".into(),
            name: "T".into(),
            kind: TargetKind::Terminal,
            executable: "t".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: Some("{command}".into()),
            reveal_args_template: None,
            wsl_run_args_template: Some("-d {distro} {command}".into()),
        };
        let home = local_project("box", "home");
        let err = server_line(
            &target,
            &home,
            &with_distro("Ubuntu"),
            SSH,
            ServerVia::Wsl,
            &["Debian".into()],
        )
        .unwrap_err();
        assert!(
            matches!(err, AppError::WslNotRunning(ref d) if d == "Ubuntu"),
            "{err}"
        );
        assert!(err.to_string().contains("never boots"), "{err}");
        let err =
            server_line(&target, &home, &no_distro(), SSH, ServerVia::Wsl, &[])
                .unwrap_err();
        assert!(matches!(err, AppError::NoWslDistro(_)), "{err}");
        // running, any case: the distro's ssh through the wsl run form
        let (_, args) = server_line(
            &target,
            &home,
            &with_distro("Ubuntu"),
            SSH,
            ServerVia::Wsl,
            &["ubuntu".into()],
        )
        .unwrap();
        assert_eq!(args, format!("-d Ubuntu {SSH}"));
    }

    /// The other half of the {script} contract, on the Windows side: a .ps1,
    /// its Windows path, no conversion.
    #[cfg(windows)]
    #[test]
    fn the_script_placeholder_is_substituted_for_a_windows_project_too() {
        let marker =
            std::env::temp_dir().join("devgo-psmux-placeholder-proof.txt");
        let _ = std::fs::remove_file(&marker);
        let echoes = LaunchTarget {
            id: "echo-script".into(),
            name: "Echo Script".into(),
            kind: TargetKind::Terminal,
            executable: "cmd".into(),
            args_template: format!(
                "/c echo {{script}} > \"{}\"",
                marker.display()
            ),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        let project = windows_project("placeholder", "work");
        let expected = std::env::temp_dir()
            .join(format!("devgo-{}.ps1", tmux_session_name(&project)));
        let _ = std::fs::remove_file(&expected);

        launch_target(
            &echoes,
            &project,
            &no_distro(),
            &tmux_with(&["code", "git"]),
        )
        .unwrap();

        // the write is synchronous inside launch_target; only the echo is not
        let on_disk = std::fs::read_to_string(&expected)
            .unwrap_or_else(|_| panic!("no script at {}", expected.display()));
        assert!(
            on_disk.contains("psmux.exe new-session -d -s "),
            "{on_disk}"
        );
        assert!(on_disk.contains("-n 'code'"), "{on_disk}");
        assert!(
            on_disk
                .contains(r"Set-Location -LiteralPath 'G:\work\placeholder'"),
            "the windows path, unconverted: {on_disk}"
        );

        let written_len = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written_len() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let written =
            std::fs::read_to_string(&marker).expect("target never ran");
        assert!(!written.contains("{script}"), "{written:?}");
        assert!(written.contains(".ps1"), "{written:?}");
        assert!(!written.contains("/mnt/"), "{written:?}");
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::remove_file(&expected);
    }

    /// devgo restarted from inside a claude code session carries its markers;
    /// nothing it launches may. the target dumps its environment to a file.
    #[test]
    fn a_launched_target_inherits_no_claude_code_markers() {
        std::env::set_var("CLAUDE_CODE_PROOF", "1");
        std::env::set_var("CLAUDECODE", "1");
        std::env::set_var("DEVGO_PROOF_KEPT", "1");
        let marker = std::env::temp_dir().join("devgo-env-scrub-proof.txt");
        let _ = std::fs::remove_file(&marker);
        let dumps = LaunchTarget {
            id: "dump-env".into(),
            name: "Dump Env".into(),
            kind: TargetKind::Terminal,
            executable: SHELL.into(),
            args_template: shell_dump_env(&marker),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        let project = local_project("env-scrub", "work");
        launch_target(&dumps, &project, &no_distro(), &tmux_with(&[])).unwrap();

        // the kept marker is the last thing set; wait for it, not for bytes
        let read = || std::fs::read_to_string(&marker).unwrap_or_default();
        for _ in 0..40 {
            if read().contains("DEVGO_PROOF_KEPT=1") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let written = read();
        assert!(written.contains("DEVGO_PROOF_KEPT=1"), "{written}");
        assert!(!written.contains("CLAUDE_CODE_PROOF"), "{written}");
        assert!(!written.contains("CLAUDECODE="), "{written}");
        let _ = std::fs::remove_file(&marker);
    }

    // get_envs reports a removed variable as (name, None), so the scrub is
    // observable without spawning. the PATH line is the test's real job:
    // it fails the day someone reaches for env_clear
    #[test]
    fn the_scrub_removes_the_agent_shells_conveniences_and_its_markers() {
        let mut cmd = Command::new(SHELL);
        scrub_agent_env(&mut cmd);
        let removed: Vec<String> = cmd
            .get_envs()
            .filter(|(_, v)| v.is_none())
            .map(|(k, _)| k.to_string_lossy().into_owned())
            .collect();
        for name in ["NO_COLOR", "GIT_EDITOR", "GIT_TERMINAL_PROMPT", "PROMPT"]
        {
            assert!(removed.iter().any(|r| r == name), "{name}: {removed:?}");
        }
        assert!(!removed.iter().any(|r| r == "PATH"), "{removed:?}");
    }

    /// The `_` arm was what made a plain windows terminal fine by accident;
    /// now that the arm is real, no placeholder still has to mean no file.
    #[test]
    fn a_windows_terminal_template_without_the_placeholder_writes_no_script() {
        let project = local_project("orphan-check", "work");
        let script_path = std::env::temp_dir().join(format!(
            "devgo-{}.{LOCAL_SCRIPT_EXT}",
            tmux_session_name(&project)
        ));
        let _ = std::fs::remove_file(&script_path);
        let plain = LaunchTarget {
            id: "plain".into(),
            name: "Plain".into(),
            kind: TargetKind::Terminal,
            executable: SHELL.into(),
            args_template: shell_exit(""),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        launch_target(&plain, &project, &no_distro(), &tmux_with(&["code"]))
            .unwrap();
        assert!(!script_path.exists(), "{}", script_path.display());
    }

    /// Found in verify: a profile that aliased psmux to a project picker
    /// made Get-Command say yes, and every call opened a folder dialog in
    /// the tab. The script runs in the user's shell, profile included.
    #[test]
    fn the_script_calls_the_binary_not_whatever_psmux_means_in_the_profile() {
        let script = build_psmux_script(
            "app-deadbeef",
            r"G:\srv\app",
            &tmux_with(&["code"]),
        );
        assert!(
            script.contains("Get-Command psmux.exe -CommandType Application"),
            "an alias or a function answers a bare Get-Command: {script}"
        );
        // every mention outside the bail message is a call, and a call
        // names the program
        let calls: Vec<&str> = script
            .lines()
            .filter(|l| !l.contains("Write-Host"))
            .flat_map(|l| l.match_indices("psmux").map(move |(i, _)| &l[i..]))
            .collect();
        assert!(!calls.is_empty());
        for call in calls {
            assert!(call.starts_with("psmux.exe "), "an alias answers: {call}");
        }
    }

    #[test]
    fn an_editor_that_is_not_installed_reports_instead_of_pretending() {
        let ghost = LaunchTarget {
            id: "ghost".into(),
            name: "Ghost Editor".into(),
            kind: TargetKind::Editor,
            executable: "devgo-no-such-editor".into(),
            args_template: "\"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        let project = local_project("project", "some");

        let err =
            launch_target(&ghost, &project, &no_distro(), &tmux_with(&[]))
                .unwrap_err();
        assert!(
            matches!(err, AppError::TargetNotInstalled(ref e) if e == "devgo-no-such-editor"),
            "expected TargetNotInstalled, got {err:?}"
        );
    }

    /// A folder in the executable field is a real mistake — the project
    /// folder dropped in instead of the binary — and it used to answer
    /// "/tmp is not installed, or not on PATH", which sends the user
    /// looking for an install of a directory they can see.
    #[test]
    fn an_executable_that_is_a_folder_is_not_reported_as_missing() {
        let dir = std::env::temp_dir().join("devgo-not-a-program");
        std::fs::create_dir_all(&dir).unwrap();
        let folder = dir.to_string_lossy().into_owned();

        let err = spawn_raw(&folder, "").unwrap_err();
        assert!(
            matches!(err, AppError::TargetNotRunnable(ref e) if *e == folder),
            "expected TargetNotRunnable, got {err:?}"
        );
        assert!(!err.to_string().contains("not installed"), "{err}");

        // and the other half of the distinction still says what it said
        let err = spawn_raw("devgo-no-such-program", "").unwrap_err();
        assert!(matches!(err, AppError::TargetNotInstalled(_)), "{err:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A kitty row with an empty args template on linux was told it "runs
    /// inside WSL, so it cannot open the Windows project" — a message
    /// reasoning about a platform that machine does not have. The empty
    /// template means one thing only when the row has a WSL form to run
    /// in instead.
    #[test]
    fn a_row_with_no_launch_line_says_so_instead_of_blaming_wsl() {
        let project = local_project("project", "some");
        let mut bare = LaunchTarget {
            id: "kitty".into(),
            name: "Kitty".into(),
            kind: TargetKind::Terminal,
            executable: "kitty".into(),
            args_template: String::new(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            wsl_run_args_template: None,
            reveal_args_template: None,
        };
        let err = launch_target(&bare, &project, &no_distro(), &tmux_with(&[]))
            .unwrap_err();
        assert!(
            matches!(err, AppError::TargetHasNoLine(ref t, ref p)
                if t == "Kitty" && p == "project"),
            "{err:?}"
        );
        assert!(!err.to_string().contains("WSL"), "{err}");

        // the sentence it replaced is still right where both halves hold:
        // a machine that has wsl, and a row saying it lives in one
        bare.wsl_args_template =
            Some("-d {distro} --cd \"{linux_path}\"".into());
        let err = launch_target(&bare, &project, &no_distro(), &tmux_with(&[]))
            .unwrap_err();
        if cfg!(windows) {
            assert!(matches!(err, AppError::TargetWslOnly(..)), "{err:?}");
        } else {
            assert!(matches!(err, AppError::TargetHasNoLine(..)), "{err:?}");
        }
    }

    /// What the shell between DevGo and the target makes of a project
    /// path, run rather than reasoned about. Every template puts {path}
    /// inside double quotes, and there the two platforms part: `sh -c`
    /// expands `$name` and runs `` `cmd` `` and `$(cmd)` before the
    /// emulator is ever started, `cmd /c` does neither. `%VAR%` is the
    /// one cmd does expand, quotes or no quotes — a different character,
    /// and the only one that bites on Windows.
    #[test]
    fn the_shell_expands_a_dollar_and_a_backtick_on_unix_only() {
        let say = |args: &str| {
            let out = shell_command("echo", args).output().unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };

        if cfg!(windows) {
            assert_eq!(say("\"a$(echo hi)b\""), "\"a$(echo hi)b\"");
            assert_eq!(say("\"a`echo hi`b\""), "\"a`echo hi`b\"");
            assert_eq!(say("\"a${HOME}b\""), "\"a${HOME}b\"");
            // the character cmd does read, quotes or no quotes. a folder
            // may legally be called `100%PATH%`, and that one is the
            // windows exposure - not the two above
            assert!(
                say("\"a%COMSPEC%b\"").to_lowercase().contains("cmd.exe"),
                "cmd expands a percent inside the quotes"
            );
        } else {
            assert_eq!(say("\"a$(echo hi)b\""), "ahib");
            assert_eq!(say("\"a`echo hi`b\""), "ahib", "backticks fire too");
            assert_eq!(say("\"a${DEVGO_NOT_SET}b\""), "ab");
        }
    }

    /// The other half, and the reason a linux tester found the right cwd
    /// in a directory called ``tick`id` ``: a {script} template's working
    /// directory is not the mangled argument, it is the script's own `cd`,
    /// and that one is single-quoted and wholly literal. The expansion
    /// still happened — it went into an argument nothing reads.
    #[test]
    fn a_session_script_lands_in_the_directory_the_flag_could_not_hold() {
        let hostile = "/home/joy/tick`id`$(id)";
        let quoted = format!("'{hostile}'");

        let tmux =
            build_tmux_script("app-deadbeef", hostile, &tmux_with(&["code"]));
        assert!(tmux.contains(&format!("-c {quoted}")), "{tmux}");
        assert_eq!(
            tmux.matches(hostile).count(),
            tmux.matches(&quoted).count(),
            "the path appears only inside its quotes: {tmux}"
        );

        let mac = build_mac_script("app-deadbeef", hostile, &tmux_with(&[]));
        assert!(mac.contains(&format!("-c {quoted}")), "{mac}");
        let off = TmuxConfig {
            enabled: false,
            window_names: vec![],
        };
        let bail = build_mac_script("app-deadbeef", hostile, &off);
        assert!(bail.contains(&format!("cd {quoted} || exit 1")), "{bail}");
        let run = build_mac_run_script("app", hostile, "bun dev");
        assert!(run.contains(&format!("cd {quoted} || exit 1")), "{run}");

        // and the windows twin, where the shell never read the characters
        // in the first place
        let ps = build_psmux_script(
            "app-deadbeef",
            r"G:\dev\tick`id`$env:PATH",
            &tmux_with(&["code"]),
        );
        assert!(ps.contains(r"'G:\dev\tick`id`$env:PATH'"), "{ps}");
    }

    /// Where it does bite. A template with no {script} has nothing to put
    /// the directory right afterwards, so on unix the mangled argument IS
    /// the working directory — and the substitution ran to produce it.
    /// This is the exposure, pinned as exposure: closing it needs a real
    /// argv splitter instead of a shell, which is a different change.
    #[test]
    fn a_template_without_a_session_script_hands_the_path_to_the_shell() {
        let bare = LaunchTarget {
            id: "bare".into(),
            name: "Bare".into(),
            kind: TargetKind::Terminal,
            executable: "kitty".into(),
            args_template: "--directory \"{path}\"".into(),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: Some("--directory \"{path}\" {command}".into()),
            wsl_run_args_template: None,
            reveal_args_template: None,
        };
        let hostile = "/home/joy/tick`id`";
        let (_, args) = bare.resolve(hostile, None).unwrap();
        assert_eq!(args, format!("--directory \"{hostile}\""));
        assert!(!args.contains("{script}"), "nothing follows to fix it");

        // the {command} run path is the same line: a mac emulator taking
        // a command directly, and every linux one
        let (_, run) = bare.resolve_run(hostile, None, "bun dev").unwrap();
        assert_eq!(run, format!("--directory \"{hostile}\" bun dev"));
    }

    /// End-to-end proof that a template survives into a real process.
    ///
    /// The failure this guards is subtle: `Command::args` re-quotes anything
    /// containing spaces, so a multi-word template arrives as one argument and
    /// the target sees garbage. Only actually spawning catches that.
    #[test]
    fn a_multi_word_template_reaches_the_process_intact() {
        let marker = std::env::temp_dir().join("devgo-launch-proof.txt");
        let _ = std::fs::remove_file(&marker);

        let target = LaunchTarget {
            id: "proof".into(),
            name: "Proof".into(),
            kind: TargetKind::Editor,
            executable: SHELL.into(),
            // Three separate arguments plus a redirect: exactly the shape that
            // breaks under re-quoting.
            args_template: shell_echo_to("{path}", &marker),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };

        let project = local_project("project", "some");

        launch_target(&target, &project, &no_distro(), &tmux_with(&[]))
            .unwrap();

        // The spawn is async; give the child a moment to finish writing. The
        // redirect creates the file before echo runs, so wait for bytes, not
        // for existence — polling on `exists()` read an empty file.
        let written_len = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written_len() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        let written =
            std::fs::read_to_string(&marker).expect("target never ran");
        assert!(
            written.contains(&local_path("some/project")),
            "template did not survive into the process: {written:?}"
        );
        let _ = std::fs::remove_file(&marker);
    }

    // the mac: the wsl script, made local. the pure tests run on both
    // platforms; the ones that spawn are unix-only, they hand sh a .command

    // a path with a space and an apostrophe: a directory a mac user can
    // make in the finder without thinking, and sh quoting is not cmd quoting
    const HOSTILE_DIR: &str = "My Projects/it's here";

    // the cheap way to write the mac script is a flag on build_tmux_script,
    // at which point the two drift the first time someone edits one arm.
    // so the wsl output stays byte-identical, the mac body is exactly that
    // output minus its shebang, and only the mac output mentions homebrew
    #[test]
    fn the_mac_script_is_the_wsl_script_with_a_preamble() {
        let tmux = tmux_with(&["code", "agents"]);
        let wsl = build_tmux_script("app-deadbeef", "/Users/user/app", &tmux);
        let mac = build_mac_script("app-deadbeef", "/Users/user/app", &tmux);

        assert!(wsl.starts_with("#!/usr/bin/env bash\n"), "{wsl}");
        assert!(
            !wsl.contains("brew") && !wsl.contains("/opt/homebrew"),
            "no mac lines leaked into the wsl script: {wsl}"
        );

        assert_mac_preamble(&mac);
        assert!(mac.starts_with("#!/bin/bash\n"), "not env bash: {mac}");
        assert!(mac.contains(r#"eval "$(/opt/homebrew/bin/brew shellenv)""#));
        assert!(mac.contains("/usr/local/bin"), "an intel mac too: {mac}");

        let body = wsl.strip_prefix("#!/usr/bin/env bash\n").unwrap();
        assert!(
            mac.ends_with(body),
            "the mac body is the wsl script verbatim:\n{mac}\n---\n{wsl}"
        );
    }

    // the script must not die on tmux: command not found; it cds into the
    // project and hands over a plain login shell with one line saying how
    // to get the windows, and checks after the preamble, because that is
    // where /opt/homebrew/bin enters PATH
    #[test]
    fn a_mac_without_tmux_gets_a_plain_shell_and_the_install_command() {
        let script = build_mac_script(
            "app-deadbeef",
            "/Users/user/app",
            &tmux_with(&["code"]),
        );

        let preamble = script.find("brew shellenv").expect("PATH first");
        let check = script
            .find("if ! command -v tmux")
            .expect("then looked for");
        let first_call =
            script.find("tmux has-session").expect("then talked to");
        assert!(preamble < check && check < first_call, "{script}");

        let bail = &script[check..first_call];
        // the advice follows the build: apt on linux, homebrew on a mac
        #[cfg(target_os = "linux")]
        assert!(bail.contains("sudo apt install tmux"), "{bail}");
        #[cfg(not(target_os = "linux"))]
        assert!(bail.contains("brew install tmux"), "{bail}");
        assert!(bail.contains("cd '/Users/user/app' || exit 1"), "{bail}");
        assert!(bail.contains(r#"exec "${SHELL:-bash}" -l"#), "{bail}");
        assert_eq!(script.matches("DevGo: tmux is not installed").count(), 1);

        // off means no tmux, so there is no tmux to look for and nothing to
        // say about it; the body is already the plain-shell script
        let off = TmuxConfig {
            enabled: false,
            window_names: vec!["code".into()],
        };
        let script = build_mac_script("app-deadbeef", "/Users/user/app", &off);
        assert!(!script.contains("tmux"), "{script}");
        assert!(
            script.contains("cd '/Users/user/app' || exit 1"),
            "{script}"
        );
        assert_mac_preamble(&script);
    }

    // a directory with a space and an apostrophe reaches bash as one word,
    // through sh_quote: single quotes, the apostrophe closed, escaped and
    // reopened. every occurrence of the path is the quoted form
    #[test]
    fn a_mac_script_quotes_a_hostile_path_as_one_word() {
        let path = format!("/Users/user/{HOSTILE_DIR}");
        let quoted = r#"'/Users/user/My Projects/it'\''s here'"#;

        let session =
            build_mac_script("app-deadbeef", &path, &tmux_with(&["code"]));
        assert!(session.contains(&format!("cd {quoted} || exit 1")));
        assert!(session.contains(&format!("-c {quoted}")), "{session}");
        assert_eq!(
            session.matches("My Projects").count(),
            session.matches(quoted).count(),
            "the path appears only inside its quotes: {session}"
        );

        let run = build_mac_run_script("app", &path, "bun dev");
        assert_mac_preamble(&run);
        assert!(
            run.contains(&format!(
                "cd {quoted} || exit 1\n\"${{SHELL:-bash}}\" -ic 'bun dev'\n"
            )),
            "cd, then the line through an interactive shell: {run}"
        );
        assert!(run.ends_with("exec \"${SHELL:-bash}\" -l\n"), "{run}");
        assert_eq!(
            run.matches("My Projects").count(),
            run.matches(quoted).count()
        );
    }

    // the header colours only when it is looking at a terminal, and every
    // value it prints is data, not format. the guard is one line so a
    // future edit that drops half of it fails here; the %s name proves the
    // arguments never reach printf's format string, which is the bug that
    // turns a project name into someone else's escape sequence
    #[test]
    fn the_run_header_guards_its_colour_and_quotes_its_values() {
        let header = mac_run_header(
            "%s%n Dev's App",
            "/tmp/My Projects/it's here",
            "pnpm dev",
        );

        assert!(
            header.contains(
                r#"if [ -t 1 ] && [ -n "$TERM" ] && [ "$TERM" != dumb ]; then"#
            ),
            "a tty AND a TERM that renders, or no colour at all: {header}"
        );
        assert!(
            header.contains("dg_b=''; dg_c=''; dg_d=''; dg_r=''"),
            "the else branch leaves plain text behind: {header}"
        );
        assert!(!header.contains("echo -e"), "printf only: {header}");

        for value in [
            r#"'%s%n Dev'\''s App'"#,
            r#"'/tmp/My Projects/it'\''s here'"#,
            "'pnpm dev'",
        ] {
            assert!(header.contains(value), "{value} is quoted: {header}");
        }
        // three printf lines carry values, and each of them is a %s
        // argument — never the format
        assert_eq!(header.matches("%s%n").count(), 1, "{header}");
        assert!(header.ends_with("unset dg_b dg_c dg_d dg_r\n"), "{header}");
    }

    // the mac twin of the psmux placeholder test: a local project gets a
    // .command, the tmux script with the project's own path and no
    // conversion, that is executable, and the template is handed its path
    #[cfg(not(windows))]
    #[test]
    fn the_script_placeholder_is_substituted_for_a_local_project_on_a_mac() {
        use std::os::unix::fs::PermissionsExt;

        let marker =
            std::env::temp_dir().join("devgo-mac-placeholder-proof.txt");
        let _ = std::fs::remove_file(&marker);

        let echoes = LaunchTarget {
            id: "echo-script".into(),
            name: "Echo Script".into(),
            kind: TargetKind::Terminal,
            executable: SHELL.into(),
            args_template: shell_echo_to("{script}", &marker),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: None,
            reveal_args_template: None,
            wsl_run_args_template: None,
        };

        let project = local_project("placeholder", "work");
        let expected = std::env::temp_dir()
            .join(format!("devgo-{}.command", tmux_session_name(&project)));
        let _ = std::fs::remove_file(&expected);

        launch_target(
            &echoes,
            &project,
            &no_distro(),
            &tmux_with(&["code", "git"]),
        )
        .unwrap();

        let on_disk = std::fs::read_to_string(&expected)
            .unwrap_or_else(|_| panic!("no script at {}", expected.display()));
        assert_mac_preamble(&on_disk);
        assert!(on_disk.contains("tmux new-session -d -s "), "{on_disk}");
        assert!(on_disk.contains("-n 'code'"), "{on_disk}");
        assert!(
            on_disk.contains("-c '/Users/user/work/placeholder'"),
            "the project's own path, unconverted: {on_disk}"
        );
        let mode = std::fs::metadata(&expected).unwrap().permissions().mode();
        assert_eq!(
            mode & 0o111,
            0o111,
            "terminal.app refuses a file it cannot execute: {mode:o}"
        );

        let written_len = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written_len() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let written =
            std::fs::read_to_string(&marker).expect("target never ran");
        assert!(!written.contains("{script}"), "{written:?}");
        assert!(written.contains(".command"), "{written:?}");
        assert!(!written.contains(".sh") && !written.contains(".ps1"));
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::remove_file(&expected);
    }

    // for real: a {script} run template goes through launch_with_command
    // on a project whose directory has a space and an apostrophe, the
    // .command runs under sh, and the command inside it runs in that
    // directory. exit 0 at the end of the line ends the script before its
    // final exec would hand the test a login shell to sit in
    #[cfg(not(windows))]
    #[test]
    fn a_run_script_enters_a_directory_with_a_space_and_an_apostrophe() {
        let root = std::env::temp_dir().join("devgo-hostile-dir-test");
        let dir = root.join(HOSTILE_DIR);
        std::fs::create_dir_all(&dir).unwrap();
        let marker = root.join("where-was-i.txt");
        let _ = std::fs::remove_file(&marker);

        let terminal = LaunchTarget {
            id: "runs-script".into(),
            name: "Runs Script".into(),
            kind: TargetKind::Terminal,
            executable: SHELL.into(),
            args_template: shell_exit(""),
            wsl_executable: None,
            wsl_args_template: None,
            // the terminal.app shape: the file is the whole command line
            run_args_template: Some("-c \"{script}\"".into()),
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        let project = Project::new(
            "hostile".into(),
            dir.to_string_lossy().into_owned(),
            root.to_string_lossy().into_owned(),
            crate::services::scanner::LOCAL_FS.into(),
        );
        let command = format!("pwd > '{}' && exit 0", marker.display());

        launch_with_command(&terminal, &project, &no_distro(), &command)
            .unwrap();

        let expected = std::env::temp_dir()
            .join(format!("devgo-run-{}.command", tmux_session_name(&project)));
        let script =
            std::fs::read_to_string(&expected).expect("the run script");
        assert!(
            script.contains(&format!(
                "cd {} || exit 1\n\"${{SHELL:-bash}}\" -ic {}\n",
                sh_quote(&dir.to_string_lossy()),
                sh_quote(&command)
            )),
            "{script}"
        );

        let written_len = || std::fs::metadata(&marker).map_or(0, |m| m.len());
        for _ in 0..40 {
            if written_len() > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let written =
            std::fs::read_to_string(&marker).expect("the command never ran");
        assert!(
            written.trim_end().ends_with(HOSTILE_DIR),
            "ran somewhere other than the project: {written:?}"
        );

        let _ = std::fs::remove_file(&expected);
        let _ = std::fs::remove_dir_all(&root);
    }

    // a run template without {script} (wezterm's start -- {command}) is
    // spawned as resolved and writes nothing
    #[cfg(not(windows))]
    #[test]
    fn a_run_template_without_the_placeholder_writes_no_run_script() {
        let project = local_project("no-run-script", "work");
        let expected = std::env::temp_dir()
            .join(format!("devgo-run-{}.command", tmux_session_name(&project)));
        let _ = std::fs::remove_file(&expected);

        let terminal = LaunchTarget {
            id: "plain-run".into(),
            name: "Plain Run".into(),
            kind: TargetKind::Terminal,
            executable: SHELL.into(),
            args_template: shell_exit(""),
            wsl_executable: None,
            wsl_args_template: None,
            run_args_template: Some("-c \"{command}\"".into()),
            reveal_args_template: None,
            wsl_run_args_template: None,
        };
        launch_with_command(&terminal, &project, &no_distro(), "exit 0")
            .unwrap();
        assert!(!expected.exists(), "orphaned at {}", expected.display());
    }
}
