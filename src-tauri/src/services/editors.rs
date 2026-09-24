//! Finding the editors and terminals that are actually installed.
//!
//! One `where.exe` for every Windows candidate and one `bash -lc` per
//! running distro, never a process per editor. A stopped distro is not
//! asked: an editor list is not worth booting a VM for. On a Mac there is
//! no crossing at all: the login-shell PATH is one string, resolved once,
//! and a name is found by joining it to each entry, a stat per directory.
//!
//! One `detect()` for both platforms. What differs is the candidate table
//! and the PATH lookup, both cfg-selected; everything after (agents,
//! distros, ids) is one code path.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;

use serde::Serialize;

use super::platform::wsl;
#[cfg(windows)]
use super::platform::Quiet;
use crate::models::target::{LaunchTarget, TargetKind};

struct Candidate {
    id: &'static str,
    name: &'static str,
    kind: TargetKind,
    /// the command as it appears on PATH. empty on a mac for a program with
    /// no cli worth calling (terminal.app, iterm2) whose only door is
    /// open -a; then args is the whole open line and app decides installed
    exe: &'static str,
    args: &'static str,
    /// how it opens a WSL project; None means it cannot, and launch_target
    /// says so rather than opening the wrong directory
    wsl_args: Option<&'static str>,
    run_args: Option<&'static str>,
    wsl_run_args: Option<&'static str>,
    /// mac only: the bundle name under /Applications. a mac app is installed
    /// by dragging it there and its cli is a separate step most people
    /// skip, so the bundle is the truth about installation. None on every
    /// windows row: PATH decides
    app: Option<&'static str>,
}

// the VS Code family does the crossing itself
#[cfg(windows)]
const REMOTE_URI: &str = crate::models::target::VSCODE_WSL_ARGS;

/// Editors and terminals worth looking for on the Windows side, roughly in
/// the order a WSL-first developer is likely to have them. `vscode` and `wt`
/// must keep the ids `defaults()` seeds, or detection would offer to add
/// what every install already has.
#[cfg(windows)]
const CANDIDATES: &[Candidate] = &[
    Candidate {
        id: "vscode",
        name: "VS Code",
        kind: TargetKind::Editor,
        exe: "code",
        args: "\"{path}\"",
        wsl_args: Some(REMOTE_URI),
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "vscode-insiders",
        name: "VS Code Insiders",
        kind: TargetKind::Editor,
        exe: "code-insiders",
        args: "\"{path}\"",
        wsl_args: Some(REMOTE_URI),
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "cursor",
        name: "Cursor",
        kind: TargetKind::Editor,
        exe: "cursor",
        args: "\"{path}\"",
        wsl_args: Some(REMOTE_URI),
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "windsurf",
        name: "Windsurf",
        kind: TargetKind::Editor,
        exe: "windsurf",
        args: "\"{path}\"",
        wsl_args: Some(REMOTE_URI),
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    // zed's windows cli takes the distro as a flag and resolves the linux
    // path itself; it was None until that cli shipped, and devgo refused
    // WSL projects zed opened fine by hand
    Candidate {
        id: "zed",
        name: "Zed",
        kind: TargetKind::Editor,
        exe: "zed",
        args: "\"{path}\"",
        wsl_args: Some("--wsl {distro} \"{linux_path}\""),
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "sublime",
        name: "Sublime Text",
        kind: TargetKind::Editor,
        exe: "subl",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "idea",
        name: "IntelliJ IDEA",
        kind: TargetKind::Editor,
        exe: "idea",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "webstorm",
        name: "WebStorm",
        kind: TargetKind::Editor,
        exe: "webstorm",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "pycharm",
        name: "PyCharm",
        kind: TargetKind::Editor,
        exe: "pycharm",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "rustrover",
        name: "RustRover",
        kind: TargetKind::Editor,
        exe: "rustrover",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "goland",
        name: "GoLand",
        kind: TargetKind::Editor,
        exe: "goland",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "fleet",
        name: "Fleet",
        kind: TargetKind::Editor,
        exe: "fleet",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: None,
    },
    // terminals open WSL projects through the tmux script, like the seed;
    // WT_ARGS shared with it, so a wt removed and added back from this list
    // gets the psmux script and not the bare tab the default used to open
    Candidate {
        id: "wt",
        name: "Windows Terminal",
        kind: TargetKind::Terminal,
        exe: "wt",
        args: crate::models::target::WT_ARGS,
        wsl_args: Some("wsl -d {distro} bash \"{script}\""),
        run_args: Some(crate::models::target::WT_RUN_ARGS),
        wsl_run_args: Some(crate::models::target::WT_WSL_RUN_ARGS),
        app: None,
    },
    Candidate {
        id: "alacritty",
        name: "Alacritty",
        kind: TargetKind::Terminal,
        exe: "alacritty",
        args: "--working-directory \"{path}\"",
        wsl_args: Some("-e wsl -d {distro} bash \"{script}\""),
        run_args: Some("--working-directory \"{path}\" -e cmd /k {command}"),
        wsl_run_args: Some(
            "-e wsl -d {distro} --cd \"{linux_path}\" -e bash -lc \"{command}; exec bash\"",
        ),
        app: None,
    },
    Candidate {
        id: "wezterm",
        name: "WezTerm",
        kind: TargetKind::Terminal,
        exe: "wezterm",
        args: "start --cwd \"{path}\"",
        wsl_args: Some("start -- wsl -d {distro} bash \"{script}\""),
        run_args: Some("start --cwd \"{path}\" -- cmd /k {command}"),
        wsl_run_args: Some(
            "start -- wsl -d {distro} --cd \"{linux_path}\" -e bash -lc \"{command}; exec bash\"",
        ),
        app: None,
    },
];

// editors and terminals worth looking for on a mac. no wsl form anywhere,
// and every row carries its bundle name, because on a mac the bundle is
// what installed means. when the cli is on the login PATH the cli form
// runs; when only the bundle is there, locate swaps the form for
// open -a "<App>" "{path}". terminal.app and iterm2 have no cli: their
// door is open -a <App> <file>, which opens a window that runs the file,
// the {script} seam. the others have real clis with a working directory
// and a way to run a command; a bundle without its cli on PATH is still
// found, through the binary inside it (Contents/MacOS/<exe>). neovim and
// helix are not here: a mac project is local, so launch_target would
// spawn nvim with no window to live in, the entry that fails to launch
#[cfg(not(windows))]
const CANDIDATES: &[Candidate] = &[
    Candidate {
        id: "vscode",
        name: "VS Code",
        kind: TargetKind::Editor,
        exe: "code",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("Visual Studio Code"),
    },
    Candidate {
        id: "vscode-insiders",
        name: "VS Code Insiders",
        kind: TargetKind::Editor,
        exe: "code-insiders",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("Visual Studio Code - Insiders"),
    },
    Candidate {
        id: "cursor",
        name: "Cursor",
        kind: TargetKind::Editor,
        exe: "cursor",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("Cursor"),
    },
    Candidate {
        id: "windsurf",
        name: "Windsurf",
        kind: TargetKind::Editor,
        exe: "windsurf",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("Windsurf"),
    },
    Candidate {
        id: "zed",
        name: "Zed",
        kind: TargetKind::Editor,
        exe: "zed",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("Zed"),
    },
    Candidate {
        id: "sublime",
        name: "Sublime Text",
        kind: TargetKind::Editor,
        exe: "subl",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("Sublime Text"),
    },
    Candidate {
        id: "idea",
        name: "IntelliJ IDEA",
        kind: TargetKind::Editor,
        exe: "idea",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("IntelliJ IDEA"),
    },
    Candidate {
        id: "webstorm",
        name: "WebStorm",
        kind: TargetKind::Editor,
        exe: "webstorm",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("WebStorm"),
    },
    Candidate {
        id: "pycharm",
        name: "PyCharm",
        kind: TargetKind::Editor,
        exe: "pycharm",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("PyCharm"),
    },
    Candidate {
        id: "rustrover",
        name: "RustRover",
        kind: TargetKind::Editor,
        exe: "rustrover",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("RustRover"),
    },
    Candidate {
        id: "goland",
        name: "GoLand",
        kind: TargetKind::Editor,
        exe: "goland",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("GoLand"),
    },
    Candidate {
        id: "fleet",
        name: "Fleet",
        kind: TargetKind::Editor,
        exe: "fleet",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
        app: Some("Fleet"),
    },
    // MAC_TERMINAL_ARGS shared with the seed, as wt shares WT_ARGS:
    // re-adding terminal from this list must give back the session script
    Candidate {
        id: "terminal",
        name: "Terminal",
        kind: TargetKind::Terminal,
        exe: "",
        args: crate::models::target::MAC_TERMINAL_ARGS,
        wsl_args: None,
        run_args: Some(crate::models::target::MAC_TERMINAL_RUN_ARGS),
        wsl_run_args: None,
        app: Some("Terminal"),
    },
    Candidate {
        id: "iterm",
        name: "iTerm2",
        kind: TargetKind::Terminal,
        exe: "",
        args: "-a iTerm \"{script}\"",
        wsl_args: None,
        run_args: Some("-a iTerm \"{script}\""),
        wsl_run_args: None,
        app: Some("iTerm"),
    },
    // the four emulators a mac and a linux box can both have. each opens
    // the session script the way its own cli spells "run this": -e for
    // ghostty and alacritty, start -- for wezterm, bare trailing words for
    // kitty. every one of them wants that part last, so the working
    // directory goes first - it is what the shell lands in when the script
    // finds no tmux. bash "{script}", not the file alone: a /tmp mounted
    // noexec would refuse the file
    //
    // ghostty's -e takes the rest of the line as the command; the tab
    // closes when it exits, which is ghostty's own rule
    Candidate {
        id: "ghostty",
        name: "Ghostty",
        kind: TargetKind::Terminal,
        exe: "ghostty",
        args: "--working-directory=\"{path}\" -e bash \"{script}\"",
        wsl_args: None,
        run_args: Some("--working-directory=\"{path}\" -e {command}"),
        wsl_run_args: None,
        app: Some("Ghostty"),
    },
    Candidate {
        id: "wezterm",
        name: "WezTerm",
        kind: TargetKind::Terminal,
        exe: "wezterm",
        args: "start --cwd \"{path}\" -- bash \"{script}\"",
        wsl_args: None,
        run_args: Some("start --cwd \"{path}\" -- {command}"),
        wsl_run_args: None,
        app: Some("WezTerm"),
    },
    Candidate {
        id: "kitty",
        name: "Kitty",
        kind: TargetKind::Terminal,
        exe: "kitty",
        args: "--directory \"{path}\" bash \"{script}\"",
        wsl_args: None,
        run_args: Some("--directory \"{path}\" {command}"),
        wsl_run_args: None,
        app: Some("kitty"),
    },
    Candidate {
        id: "alacritty",
        name: "Alacritty",
        kind: TargetKind::Terminal,
        exe: "alacritty",
        args: "--working-directory \"{path}\" -e bash \"{script}\"",
        wsl_args: None,
        run_args: Some("--working-directory \"{path}\" -e {command}"),
        wsl_run_args: None,
        app: Some("Alacritty"),
    },
    // the linux terminal emulators. none of the rows above match a stock
    // gnome or kde box: Terminal.app and iTerm2 are mac bundles, and
    // ghostty/wezterm/kitty/alacritty are installs a distro does not ship.
    // without these a linux machine detects NO terminal at all, so the
    // terminal key has nothing to open. on a mac none of them are on PATH
    // and the rows never fire, which is why they sit in the shared table.
    //
    // each carries the {script} seam too, and tmux is the one multiplexer
    // that IS native here: without it a linux launch opened a bare shell
    // while windows and a mac both got the three named windows. the flag
    // differs per emulator and a wrong one fails silently, so each is the
    // one its own man page documents, and it is always last
    Candidate {
        id: "gnome-terminal",
        name: "GNOME Terminal",
        kind: TargetKind::Terminal,
        exe: "gnome-terminal",
        // -- and not -e: -e is deprecated and reads the rest as one string
        args: "--working-directory \"{path}\" -- bash \"{script}\"",
        wsl_args: None,
        run_args: Some("--working-directory \"{path}\" -- bash -lc {command}"),
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "konsole",
        name: "Konsole",
        kind: TargetKind::Terminal,
        exe: "konsole",
        // -e catches every following argument, so nothing may follow it
        args: "--workdir \"{path}\" -e bash \"{script}\"",
        wsl_args: None,
        run_args: Some("--workdir \"{path}\" -e bash -lc {command}"),
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "xfce4-terminal",
        name: "Xfce Terminal",
        kind: TargetKind::Terminal,
        exe: "xfce4-terminal",
        // -x is the remainder of the line; -e would be one string to parse
        args: "--working-directory=\"{path}\" -x bash \"{script}\"",
        wsl_args: None,
        run_args: Some("--working-directory=\"{path}\" -x bash -lc {command}"),
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "tilix",
        name: "Tilix",
        kind: TargetKind::Terminal,
        exe: "tilix",
        // -e runs all text after it, so the man page calls it the last one
        args: "--working-directory=\"{path}\" -e bash \"{script}\"",
        wsl_args: None,
        run_args: Some("--working-directory=\"{path}\" -e bash -lc {command}"),
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "foot",
        name: "foot",
        kind: TargetKind::Terminal,
        exe: "foot",
        // foot takes the command as trailing words, with no flag at all
        args: "--working-directory=\"{path}\" bash \"{script}\"",
        wsl_args: None,
        run_args: Some("--working-directory=\"{path}\" bash -lc {command}"),
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "terminator",
        name: "Terminator",
        kind: TargetKind::Terminal,
        exe: "terminator",
        // -x is the rest of the line; -e is a single command string
        args: "--working-directory=\"{path}\" -x bash \"{script}\"",
        wsl_args: None,
        run_args: Some("--working-directory=\"{path}\" -x bash -lc {command}"),
        wsl_run_args: None,
        app: None,
    },
    Candidate {
        id: "xterm",
        name: "xterm",
        kind: TargetKind::Terminal,
        exe: "xterm",
        // xterm has no working-directory flag, which is why the old form cd'd
        // by hand; the script does its own cd, so -e is the whole line now
        args: "-e bash \"{script}\"",
        wsl_args: None,
        run_args: Some("-e bash -lc {command}"),
        wsl_run_args: None,
        app: None,
    },
];

/// Coding-agent CLIs, on the Windows side and inside each running distro,
/// found the way the editors are: where.exe here, command -v under bash -lc
/// there (so an nvm install is on PATH). On Windows an npm-installed CLI
/// resolves to claude.cmd; where lists it and the terminal's run template
/// runs it. On a Mac the same four names resolve on the login-shell PATH,
/// which is where nvm put them.
pub const AGENTS: &[(&str, &str)] = &[
    ("claude", "Claude Code"),
    ("codex", "Codex"),
    ("opencode", "OpenCode"),
    ("gemini", "Gemini CLI"),
];

/// Command-line editors worth looking for inside a distro. No GUI terminal
/// emulators: running one inside WSL needs an X server, and a target that
/// opens nothing is worse than no target.
const IN_DISTRO: &[(&str, &str)] = &[
    ("nvim", "Neovim"),
    ("hx", "Helix"),
    ("vim", "Vim"),
    ("emacs", "Emacs"),
    ("micro", "Micro"),
];

fn to_target(c: &Candidate) -> LaunchTarget {
    LaunchTarget {
        id: c.id.to_string(),
        name: c.name.to_string(),
        kind: c.kind,
        executable: c.exe.to_string(),
        args_template: c.args.to_string(),
        wsl_executable: None,
        wsl_args_template: c.wsl_args.map(str::to_string),
        run_args_template: c.run_args.map(str::to_string),
        wsl_run_args_template: c.wsl_run_args.map(str::to_string),
    }
}

/// The same editor in two distros is two targets opening two filesystems,
/// so the distro is in the name and, slugified, in the id.
fn distro_target(exe: &str, name: &str, distro: &str) -> LaunchTarget {
    LaunchTarget {
        id: format!("{exe}-{}", slugify(distro)),
        name: format!("{name} ({distro})"),
        kind: TargetKind::Editor,
        // a linux binary cannot take a windows path, so there is no windows
        // form; launch_target refuses windows projects for it
        executable: "wsl".to_string(),
        args_template: String::new(),
        wsl_executable: Some("wsl".to_string()),
        wsl_args_template: Some(format!(
            "-d {{distro}} --cd \"{{linux_path}}\" -e {exe} ."
        )),
        run_args_template: None,
        wsl_run_args_template: None,
    }
}

/// A target found installed but not yet registered, with where it came
/// from so the UI can say why it is offered.
#[derive(Debug, Clone, Serialize)]
pub struct DetectedTarget {
    pub target: LaunchTarget,
    /// "path" for a program on PATH, "app" for a mac bundle found without
    /// its cli, or the distro name
    pub source: String,
    /// the resolved exe path, the bundle path, or "Ubuntu-26.04 · nvim"
    pub detail: String,
}

// where a mac keeps its applications: the system folder, the user's own,
// and the two the os ships in (terminal.app is under utilities). on
// windows none exist and the walk finds nothing, which is right
fn app_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.insert(1, PathBuf::from(home).join("Applications"));
    }
    dirs
}

// the bundle for app, if it is installed in any of the usual places
fn app_bundle(app: &str) -> Option<PathBuf> {
    app_dirs()
        .into_iter()
        .map(|d| d.join(format!("{app}.app")))
        .find(|p| p.is_dir())
}

// foot is a wayland client and nothing else: on an X11 session it prints
// "failed to connect to wayland; no compositor running?" and no window
// appears, so a box whose first terminal is foot was seeded a key that
// silently did nothing. it stays in the table because the same binary is
// right under a compositor. footclient needs a `foot --server` in that
// same session, so it is no door out and is not offered either
fn usable_in_session(c: &Candidate, wayland: bool) -> bool {
    c.id != "foot" || wayland
}

// is there a compositor? WAYLAND_DISPLAY is what one sets, and what foot
// itself reads to decide
fn wayland_session() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty())
}

// is this candidate installed, and how is it launched? in order: its cli
// is on PATH, the cli form as the table spells it (the only rule that can
// fire on windows, no windows row has an app; a mac row with no exe skips
// it, no cli is the point of the row); it has a bundle and the bundle is
// there, bundle_form; neither, not installed and not offered
fn locate(
    c: &Candidate,
    found: &HashMap<String, String>,
) -> Option<DetectedTarget> {
    if !c.exe.is_empty() {
        if let Some(path) = found.get(&c.exe.to_lowercase()) {
            return Some(DetectedTarget {
                target: to_target(c),
                source: "path".to_string(),
                detail: path.clone(),
            });
        }
    }

    let app = c.app?;
    let bundle = app_bundle(app)?;
    Some(DetectedTarget {
        target: bundle_form(c, app, &bundle),
        source: "app".to_string(),
        detail: bundle.to_string_lossy().into_owned(),
    })
}

// ghostty's mac app is not the cli its linux row runs. the binary inside
// the bundle is the gui: given -e bash "<script>" it opens a window and
// drops the command, no error anywhere, so a mac with ghostty and no
// ghostty on PATH did nothing at all. open -na runs the same line and the
// script really starts. wezterm and kitty ship the real cli inside their
// bundles and are verified working with it, so they keep it; alacritty's
// cask is disabled and nobody can install it to say which group it is in,
// so it keeps the form it shipped with rather than a guess
fn bundle_binary_takes_a_command(c: &Candidate) -> bool {
    c.id != "ghostty"
}

// the launch forms for a candidate whose bundle was found and whose cli
// was not on PATH. a row with no cli (terminal.app, iterm2) is launched
// through open and its args were written as the whole open line; a
// terminal whose in-bundle binary ignores a command gets the same cli
// line handed to open instead; a terminal whose binary sits inside the
// bundle keeps its cli forms with the binary's full path; anything else
// opens through open -a "<App>", with no run form, open cannot carry one.
// pure, so a test hands it a bundle of its own making instead of
// depending on /Applications
fn bundle_form(c: &Candidate, app: &str, bundle: &Path) -> LaunchTarget {
    let mut target = to_target(c);

    if c.exe.is_empty() {
        target.executable = "open".to_string();
        return target;
    }

    if c.kind == TargetKind::Terminal && !bundle_binary_takes_a_command(c) {
        target.executable = "open".to_string();
        target.args_template = format!("-na \"{app}\" --args {}", c.args);
        target.run_args_template =
            c.run_args.map(|a| format!("-na \"{app}\" --args {a}"));
        return target;
    }

    let inside = bundle.join("Contents").join("MacOS").join(c.exe);
    if c.kind == TargetKind::Terminal && inside.is_file() {
        target.executable = inside.to_string_lossy().into_owned();
    } else {
        target.executable = "open".to_string();
        target.args_template = format!("-a \"{app}\" \"{{path}}\"");
        target.run_args_template = None;
    }
    target
}

/// What detection makes of a bundle, by candidate id — the same row a
/// fresh `locate` would hand back for it. `TargetStore` repairs a ghostty
/// row written before the `open` form by reading its replacement here, so
/// the repaired row and a detected one cannot drift apart. None when no
/// row answers to that id, which is every id on windows: no windows row
/// has a bundle.
pub fn bundle_target(id: &str, bundle: &Path) -> Option<LaunchTarget> {
    let c = CANDIDATES.iter().find(|c| c.id == id)?;
    Some(bundle_form(c, c.app?, bundle))
}

/// Everything installed, as targets ready to be added. `running` is passed
/// in so a caller that already paid for `wsl -l --running` does not pay
/// twice; only those distros are asked. On a Mac it is empty and the
/// distro loops are never entered.
pub fn detect(running: &[String]) -> Vec<DetectedTarget> {
    let names: Vec<&str> = CANDIDATES
        .iter()
        .map(|c| c.exe)
        .filter(|e| !e.is_empty())
        .collect();
    let found = path_lookup(&names);

    let wayland = wayland_session();
    let mut out: Vec<DetectedTarget> = CANDIDATES
        .iter()
        .filter(|c| usable_in_session(c, wayland))
        .filter_map(|c| locate(c, &found))
        .collect();

    // agents on the local side: one lookup for the four names
    let agent_exes: Vec<&str> = AGENTS.iter().map(|(exe, _)| *exe).collect();
    let found = path_lookup(&agent_exes);
    for (exe, name) in AGENTS {
        if !found.contains_key(*exe) {
            continue;
        }
        out.push(DetectedTarget {
            target: LaunchTarget {
                id: (*exe).to_string(),
                name: (*name).to_string(),
                kind: TargetKind::Agent,
                executable: (*exe).to_string(),
                args_template: String::new(),
                wsl_executable: None,
                wsl_args_template: None,
                run_args_template: None,
                wsl_run_args_template: None,
            },
            source: "path".to_string(),
            detail: format!("agent · {exe}"),
        });
    }

    for distro in running {
        for (exe, name) in present_in_distro(distro, AGENTS) {
            out.push(DetectedTarget {
                target: LaunchTarget {
                    id: format!("{}-{}", exe, slugify(distro)),
                    name: format!("{name} ({distro})"),
                    kind: TargetKind::Agent,
                    // no windows command: this agent lives in the distro
                    executable: String::new(),
                    args_template: String::new(),
                    wsl_executable: Some((*exe).to_string()),
                    wsl_args_template: Some(String::new()),
                    run_args_template: None,
                    wsl_run_args_template: None,
                },
                source: distro.clone(),
                detail: format!("agent · {distro} · {exe}"),
            });
        }
        for (exe, name) in present_in_distro(distro, IN_DISTRO) {
            out.push(DetectedTarget {
                target: distro_target(exe, name, distro),
                source: distro.clone(),
                detail: format!("{distro} · {exe}"),
            });
        }
    }
    out
}

/// Which of a table's commands exist in the distro, in one bash -lc.
fn present_in_distro(
    distro: &str,
    table: &'static [(&'static str, &'static str)],
) -> Vec<(&'static str, &'static str)> {
    let list = table
        .iter()
        .map(|(exe, _)| *exe)
        .collect::<Vec<_>>()
        .join(" ");
    let script = format!(
        "for c in {list}; do command -v \"$c\" >/dev/null 2>&1 && echo \"$c\"; done"
    );
    let present = wsl::probe_lines(distro, &script);
    table
        .iter()
        .filter(|(exe, _)| present.iter().any(|p| p == exe))
        .copied()
        .collect()
}

fn slugify(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    cleaned.trim_matches('-').replace("--", "-")
}

/// Resolve names against PATH in one spawn. `where` exits non-zero when any
/// name is missing, which is the normal case here, so the status is ignored
/// and stdout parsed: each line is a full path, mapped back to the name that
/// asked for it by file stem.
#[cfg(windows)]
fn path_lookup(names: &[&str]) -> HashMap<String, String> {
    let mut found = HashMap::new();
    if names.is_empty() {
        return found;
    }
    let Ok(out) = Command::new("where.exe").quiet().args(names).output() else {
        return found;
    };
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let path = line.trim();
        if path.is_empty() {
            continue;
        }
        // where prints several hits per name (code, code.cmd); the first wins
        if let Some(stem) = std::path::Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
        {
            found.entry(stem).or_insert_with(|| path.to_string());
        }
    }
    found
}

// the mac twin of the where.exe batch, in no spawns: the PATH is one
// string login_path resolved once, and a name is found by joining it to
// each entry and asking the filesystem, first hit wins, which is what the
// shell would do. not env::var("PATH"): a dock-launched app has the bare
// four directories and every editor cli lives elsewhere. same shape as
// the windows result, lowercase name to resolved path
#[cfg(not(windows))]
fn path_lookup(names: &[&str]) -> HashMap<String, String> {
    let mut found = HashMap::new();
    if names.is_empty() {
        return found;
    }

    let path = super::platform::login_path();
    let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();

    for name in names {
        if name.is_empty() {
            continue;
        }
        if let Some(hit) =
            dirs.iter().map(|d| d.join(name)).find(|p| p.is_file())
        {
            found
                .entry(name.to_lowercase())
                .or_insert_with(|| hit.to_string_lossy().into_owned());
        }
    }

    found
}

/// The first terminal on PATH, in the order the table lists them.
///
/// Linux seeds its registry with this rather than a constant, because there
/// is no one terminal every distro ships: gnome has gnome-terminal, kde has
/// konsole, a wlroots box may have only foot. A machine with none gets no
/// terminal row at all, which is honest - better than a row whose command
/// cannot run.
#[cfg(target_os = "linux")]
pub fn first_terminal() -> Option<LaunchTarget> {
    let names: Vec<&str> = CANDIDATES
        .iter()
        .filter(|c| c.kind == TargetKind::Terminal && !c.exe.is_empty())
        .map(|c| c.exe)
        .collect();
    let found = path_lookup(&names);
    let wayland = wayland_session();
    CANDIDATES
        .iter()
        .find(|c| {
            c.kind == TargetKind::Terminal
                && !c.exe.is_empty()
                && usable_in_session(c, wayland)
                && found.contains_key(&c.exe.to_lowercase())
        })
        .map(to_target)
}

/// Is this executable resolvable? A full path the user typed, or one
/// `locate` resolved inside a bundle, is checked directly: the PATH lookup
/// only searches PATH and would call it missing.
pub fn is_on_path(exe: &str) -> bool {
    let direct = Path::new(exe);
    if direct.is_absolute() {
        return direct.is_file();
    }
    !path_lookup(&[exe]).is_empty()
}

/// Is this executable a path that is there, but is not a program? The one
/// people hit is a directory: the folder gets typed into the field
/// instead of the binary inside it, and `is_on_path` says the same "not
/// installed" it says for a typo, which sends them looking for an install
/// they already have. Only a full path can be asked; a bare name is
/// PATH's business.
pub fn exists_but_not_a_program(exe: &str) -> bool {
    let direct = Path::new(exe);
    direct.is_absolute() && direct.exists() && !runnable(direct)
}

// windows decides by extension, so being a file is the whole question
#[cfg(windows)]
fn runnable(path: &Path) -> bool {
    path.is_file()
}

// a unix program is a file with an execute bit; without one the shell
// answers "permission denied" on a stderr nobody reads
#[cfg(not(windows))]
fn runnable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    // what where and command -v are asked for, verbatim: no paths, no
    // extensions, so claude.cmd on windows and claude in a distro both
    // resolve
    #[test]
    fn agent_names_are_plain_commands() {
        for (exe, name) in AGENTS {
            assert!(exe.chars().all(|c| c.is_ascii_lowercase()), "{exe}");
            assert!(!name.is_empty());
        }
        assert_eq!(AGENTS.len(), 4);
    }

    // the shell that certainly exists, so the lookup is exercised for real
    #[cfg(windows)]
    const SHELL: &str = "cmd";
    #[cfg(not(windows))]
    const SHELL: &str = "sh";

    #[test]
    fn every_candidate_id_is_unique() {
        let mut ids: Vec<&str> = CANDIDATES.iter().map(|c| c.id).collect();
        let before = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), before, "duplicate id in the candidate table");
    }

    // is every occurrence of `seam` inside a double-quoted stretch of the
    // template? nothing in the crate splits a resolved line itself - cmd /c
    // and sh -c do - and both keep a quoted word whole however many spaces
    // are in it. outside the quotes the same value is several arguments
    fn quoted_everywhere(template: &str, seam: &str) -> bool {
        let (bytes, needle) = (template.as_bytes(), seam.as_bytes());
        let mut inside = false;
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'"' {
                inside = !inside;
            } else if bytes[i..].starts_with(needle) {
                if !inside {
                    return false;
                }
                i += needle.len();
                continue;
            }
            i += 1;
        }
        true
    }

    /// A project under `G:\01_tauri\my project`, a temp directory under
    /// `C:\Users\Joy Ahmed`, a distro home at `/home/joy/my project`: every
    /// one of them is one argument only while the template quotes the seam.
    /// {command} is deliberately not in the list - a command is shell syntax
    /// the user typed, and quoting it would run the whole line as a program.
    #[test]
    fn every_shipped_template_quotes_the_path_and_script_seams() {
        use crate::models::target::{
            LINUX_ARGS_PRE_TMUX, MAC_TERMINAL_ARGS, MAC_TERMINAL_RUN_ARGS,
            VSCODE_WSL_ARGS, WT_ARGS, WT_ARGS_PRE_PSMUX, WT_RUN_ARGS,
            WT_RUN_ARGS_PRE, WT_WSL_RUN_ARGS, WT_WSL_RUN_ARGS_PRE,
        };
        let mut templates: Vec<String> = vec![
            WT_ARGS.into(),
            WT_ARGS_PRE_PSMUX.into(),
            WT_RUN_ARGS.into(),
            WT_RUN_ARGS_PRE.into(),
            WT_WSL_RUN_ARGS.into(),
            WT_WSL_RUN_ARGS_PRE.into(),
            VSCODE_WSL_ARGS.into(),
            MAC_TERMINAL_ARGS.into(),
            MAC_TERMINAL_RUN_ARGS.into(),
            distro_target("nvim", "Neovim", "Ubuntu")
                .wsl_args_template
                .unwrap(),
        ];
        templates
            .extend(LINUX_TERMINAL_ARGS.iter().map(|(_, a)| a.to_string()));
        // the forms an upgrade reads as well as the ones it writes: a
        // migration compares bytes, so a bare seam here is a bad match
        templates
            .extend(LINUX_ARGS_PRE_TMUX.iter().map(|(_, p, _)| p.to_string()));
        for c in CANDIDATES {
            templates.push(c.args.to_string());
            templates.extend(c.wsl_args.map(str::to_string));
            templates.extend(c.run_args.map(str::to_string));
            templates.extend(c.wsl_run_args.map(str::to_string));
        }
        for t in crate::models::target::defaults() {
            templates.push(t.args_template);
            templates.extend(t.wsl_args_template);
            templates.extend(t.run_args_template);
            templates.extend(t.wsl_run_args_template);
        }

        for template in &templates {
            for seam in ["{path}", "{script}", "{linux_path}"] {
                assert!(
                    quoted_everywhere(template, seam),
                    "{seam} is bare, so a space in it splits the line: {template}"
                );
            }
        }
    }

    /// A detected VS Code or Windows Terminal is the seeded one: same id, so
    /// it is never offered as new, and the same templates, so a fresh install
    /// and a detected add behave alike.
    #[test]
    fn detected_seeds_match_the_seeded_defaults() {
        for seed in crate::models::target::defaults() {
            let c = CANDIDATES
                .iter()
                .find(|c| c.id == seed.id)
                .unwrap_or_else(|| panic!("{} has no candidate", seed.id));
            // a row with no cli (terminal.app) is only ever launched as
            // its bundle form, so that is the one to compare
            let t = match c.app {
                Some(app) if c.exe.is_empty() => {
                    bundle_form(c, app, Path::new(""))
                }
                _ => to_target(c),
            };
            assert_eq!(t.executable, seed.executable);
            assert_eq!(t.args_template, seed.args_template);
            assert_eq!(t.wsl_args_template, seed.wsl_args_template);
            assert_eq!(t.run_args_template, seed.run_args_template);
            assert_eq!(t.wsl_run_args_template, seed.wsl_run_args_template);
        }
    }

    /// A VS Code fork carries the remote-URI form; a Windows-only editor
    /// carries none, so launch_target refuses rather than opening the wrong
    /// directory.
    #[cfg(windows)]
    #[test]
    fn wsl_form_decides_whether_a_target_can_open_wsl() {
        let code = CANDIDATES.iter().find(|c| c.id == "cursor").unwrap();
        let t = to_target(code);
        assert!(t.resolve("x", Some(("Ubuntu", "/home/user"))).is_some());

        let subl = CANDIDATES.iter().find(|c| c.id == "sublime").unwrap();
        let t = to_target(subl);
        assert!(t.resolve("x", Some(("Ubuntu", "/home/user"))).is_none());
        assert!(t.resolve(r"G:\dev", None).is_some(), "still opens Windows");

        // a third form: the program crosses with its own flag
        let zed = CANDIDATES.iter().find(|c| c.id == "zed").unwrap();
        let (_, args) = to_target(zed)
            .resolve("x", Some(("Ubuntu", "/home/user/p")))
            .unwrap();
        assert_eq!(args, "--wsl Ubuntu \"/home/user/p\"");
    }

    #[test]
    fn a_distro_editor_gets_a_distinct_id_per_distro() {
        assert_eq!(slugify("Ubuntu-26.04"), "ubuntu-26-04");
        let a = distro_target("nvim", "Neovim", "Ubuntu-26.04");
        let b = distro_target("nvim", "Neovim", "Debian");
        assert_ne!(a.id, b.id);
        assert_eq!(a.name, "Neovim (Ubuntu-26.04)");
        assert!(a.resolve("x", None).is_none(), "no windows form");
        let (exe, args) =
            a.resolve("x", Some(("Ubuntu-26.04", "/srv/app"))).unwrap();
        assert_eq!(exe, "wsl");
        assert_eq!(args, "-d Ubuntu-26.04 --cd \"/srv/app\" -e nvim .");
    }

    /// The shell is always present, so this is the real lookup: cmd.exe (or
    /// /bin/sh through the login PATH) resolves, an invented name does not.
    #[test]
    fn path_lookup_finds_real_programs_and_rejects_invented_ones() {
        assert!(is_on_path(SHELL), "{SHELL} must resolve on PATH");
        assert!(!is_on_path("devgo-definitely-not-a-real-program"));
    }

    // neither a mac nor a linux box has a second filesystem, so no candidate
    // may claim a wsl form: one that did would make launch_target accept a
    // \\wsl.localhost path and spawn wsl, which does not exist here.
    //
    // the bundle rule USED to be "every row has one", which was true while
    // this table was mac-only. it now also carries the linux emulators, which
    // are found on PATH and have no bundle. the invariant that actually
    // matters is that a row can be found at all - locate() tries the exe then
    // the bundle, so a row with neither is dead weight nobody can launch.
    #[cfg(not(windows))]
    #[test]
    fn no_candidate_claims_a_wsl_form_and_every_row_is_detectable() {
        for c in CANDIDATES {
            assert!(c.wsl_args.is_none(), "{}", c.id);
            assert!(c.wsl_run_args.is_none(), "{}", c.id);
            assert!(
                !c.exe.is_empty() || c.app.is_some(),
                "{} has neither a cli nor a bundle, so it can never be detected",
                c.id
            );
            assert!(
                !c.exe.is_empty() || c.args.starts_with("-a "),
                "a row without a cli is launched through open: {}",
                c.id
            );
        }
    }

    // the session form of every terminal a linux box can have, pinned here
    // as well as in the table: a linux-only row is invisible to a windows
    // compiler, so these are the rules that run everywhere. the comparison
    // against the table itself is the test below, where the rows exist
    const LINUX_TERMINAL_ARGS: &[(&str, &str)] = &[
        (
            "ghostty",
            "--working-directory=\"{path}\" -e bash \"{script}\"",
        ),
        ("wezterm", "start --cwd \"{path}\" -- bash \"{script}\""),
        ("kitty", "--directory \"{path}\" bash \"{script}\""),
        (
            "alacritty",
            "--working-directory \"{path}\" -e bash \"{script}\"",
        ),
        (
            "gnome-terminal",
            "--working-directory \"{path}\" -- bash \"{script}\"",
        ),
        ("konsole", "--workdir \"{path}\" -e bash \"{script}\""),
        (
            "xfce4-terminal",
            "--working-directory=\"{path}\" -x bash \"{script}\"",
        ),
        (
            "tilix",
            "--working-directory=\"{path}\" -e bash \"{script}\"",
        ),
        ("foot", "--working-directory=\"{path}\" bash \"{script}\""),
        (
            "terminator",
            "--working-directory=\"{path}\" -x bash \"{script}\"",
        ),
        ("xterm", "-e bash \"{script}\""),
    ];

    /// tmux is the multiplexer linux ships, and linux was the platform that
    /// never saw it: write_local_script only fires on a template carrying
    /// {script}, so every one of these rows opened a bare shell. The command
    /// flag is last in all of them because -e, -x and -- each swallow the
    /// rest of the line, and the working directory stays in front, since
    /// that is where a shell outliving the script sits.
    #[test]
    fn every_linux_terminal_runs_the_session_script_last() {
        for (id, args) in LINUX_TERMINAL_ARGS {
            assert!(args.contains("{script}"), "{id} opens a bare shell");
            assert!(args.ends_with("bash \"{script}\""), "{id}: {args}");
            // xterm is the one with no working-directory flag to keep
            assert_eq!(args.contains("{path}"), *id != "xterm", "{id}: {args}");
            for mac_only in ["open ", "-a ", "brew", "/Applications"] {
                assert!(!args.contains(mac_only), "{id}: {mac_only}");
            }
        }
        assert_eq!(LINUX_TERMINAL_ARGS.len(), 11);
    }

    /// An install from before the seam is migrated onto these same bytes,
    /// so the two tables are one thing said twice and have to agree: an
    /// upgrade landing anywhere else is a form the app never shipped.
    #[test]
    fn the_upgrade_lands_on_the_shipped_session_form() {
        use crate::models::target::LINUX_ARGS_PRE_TMUX;
        for (id, pre, seam) in LINUX_ARGS_PRE_TMUX {
            let (_, args) = LINUX_TERMINAL_ARGS
                .iter()
                .find(|(p, _)| p == id)
                .unwrap_or_else(|| panic!("{id} has no session form"));
            assert_eq!(seam, args, "{id}");
            assert!(!pre.contains("{script}"), "{id} was never bare");
        }
        assert_eq!(LINUX_ARGS_PRE_TMUX.len(), LINUX_TERMINAL_ARGS.len());
    }

    /// foot on X11 opens nothing and says so only on a stderr nobody
    /// reads, so it is not offered and not seeded without a compositor.
    /// Every other row is unconditional: a terminal that fails on a
    /// desktop it cannot see is the only case this covers.
    #[test]
    fn foot_is_offered_only_in_a_wayland_session() {
        let foot = Candidate {
            id: "foot",
            name: "foot",
            kind: TargetKind::Terminal,
            exe: "foot",
            args: "--working-directory=\"{path}\" bash \"{script}\"",
            wsl_args: None,
            run_args: None,
            wsl_run_args: None,
            app: None,
        };
        assert!(!usable_in_session(&foot, false));
        assert!(usable_in_session(&foot, true));
        for c in CANDIDATES {
            assert!(usable_in_session(c, true), "{}", c.id);
            assert_eq!(usable_in_session(c, false), c.id != "foot", "{}", c.id);
        }
    }

    // the same bytes as the table, and no terminal with a cli left without
    // the seam - four of these rows are the mac's too, so a row dropped
    // here is a bare shell on both
    #[cfg(not(windows))]
    #[test]
    fn the_candidate_table_carries_exactly_those_terminal_forms() {
        for (id, args) in LINUX_TERMINAL_ARGS {
            let c = CANDIDATES
                .iter()
                .find(|c| c.id == *id)
                .unwrap_or_else(|| panic!("{id} left the table"));
            assert_eq!(&c.args, args, "{id}");
        }
        for c in CANDIDATES
            .iter()
            .filter(|c| c.kind == TargetKind::Terminal && !c.exe.is_empty())
        {
            assert!(
                LINUX_TERMINAL_ARGS.iter().any(|(id, _)| *id == c.id),
                "{} has a cli and no pinned session form",
                c.id
            );
        }
    }

    // the path a fresh linux install really takes: defaults() seeds what
    // this finds, so a row without the seam is a machine that never gets
    // the named windows
    #[cfg(target_os = "linux")]
    #[test]
    fn the_terminal_linux_seeds_asks_for_a_session_script() {
        let Some(t) = first_terminal() else {
            return;
        };
        assert_eq!(t.kind, TargetKind::Terminal);
        assert!(t.args_template.contains("{script}"), "{}", t.id);
        assert!(t.wsl_args_template.is_none(), "{}", t.id);
    }

    // the three shapes locate can give a mac candidate, decided without
    // touching /Applications: the cli form when the cli resolved, open -a
    // for an editor found only by bundle, and the bundle's own binary for
    // a terminal found only by bundle
    #[cfg(not(windows))]
    #[test]
    fn a_bundle_without_its_cli_is_launched_through_open_or_its_own_binary() {
        let code = CANDIDATES.iter().find(|c| c.id == "vscode").unwrap();
        let mut found = HashMap::new();
        found.insert("code".to_string(), "/opt/homebrew/bin/code".to_string());
        let d = locate(code, &found).expect("on PATH");
        assert_eq!(d.source, "path");
        assert_eq!(d.target.executable, "code");
        assert_eq!(d.target.args_template, "\"{path}\"");

        let ghost = Candidate {
            id: "ghost",
            name: "Ghost",
            kind: TargetKind::Editor,
            exe: "ghost",
            args: "\"{path}\"",
            wsl_args: None,
            run_args: None,
            wsl_run_args: None,
            app: Some("DevGo Ghost Editor That Does Not Exist"),
        };
        assert!(locate(&ghost, &HashMap::new()).is_none());

        let root = std::env::temp_dir().join("devgo-editors-bundle-test");
        let _ = std::fs::remove_dir_all(&root);
        let bin = root.join("Fake Term.app/Contents/MacOS");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("faketerm"), "").unwrap();
        std::fs::create_dir_all(root.join("Fake Editor.app/Contents/MacOS"))
            .unwrap();

        let term = Candidate {
            id: "faketerm",
            name: "Fake Term",
            kind: TargetKind::Terminal,
            exe: "faketerm",
            args: "--working-directory \"{path}\"",
            wsl_args: None,
            run_args: Some("--working-directory \"{path}\" -e {command}"),
            wsl_run_args: None,
            app: Some("Fake Term"),
        };
        let editor = Candidate {
            id: "fakeed",
            name: "Fake Editor",
            kind: TargetKind::Editor,
            exe: "fakeed",
            args: "\"{path}\"",
            wsl_args: None,
            run_args: None,
            wsl_run_args: None,
            app: Some("Fake Editor"),
        };
        let no_cli = Candidate {
            id: "fakeopen",
            name: "Fake Open",
            kind: TargetKind::Terminal,
            exe: "",
            args: "-a \"Fake Editor\" \"{script}\"",
            wsl_args: None,
            run_args: Some("-a \"Fake Editor\" \"{script}\""),
            wsl_run_args: None,
            app: Some("Fake Editor"),
        };

        // none of these fakes is in /Applications, so locate itself says no
        for c in [&term, &editor, &no_cli] {
            assert!(locate(c, &HashMap::new()).is_none(), "{}", c.id);
        }

        let t = bundle_form(&term, "Fake Term", &root.join("Fake Term.app"));
        assert_eq!(t.executable, bin.join("faketerm").to_string_lossy());
        assert_eq!(t.args_template, "--working-directory \"{path}\"");
        assert!(t.run_args_template.is_some(), "the run form survives");
        assert!(is_on_path(&t.executable), "an absolute exe passes the gate");

        let editor_bundle = root.join("Fake Editor.app");
        let t = bundle_form(&editor, "Fake Editor", &editor_bundle);
        assert_eq!(t.executable, "open");
        assert_eq!(t.args_template, "-a \"Fake Editor\" \"{path}\"");
        assert!(t.run_args_template.is_none(), "open cannot carry a command");

        let t = bundle_form(&no_cli, "Fake Editor", &editor_bundle);
        assert_eq!(t.executable, "open");
        assert_eq!(t.args_template, "-a \"Fake Editor\" \"{script}\"");
        assert_eq!(
            t.run_args_template.as_deref(),
            Some("-a \"Fake Editor\" \"{script}\"")
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    // one of the four rows a mac and a linux box share, written out because
    // a windows compiler has no such row to read; the test below holds
    // these bytes against the real ones where they exist
    fn shared_terminal(
        id: &'static str,
        name: &'static str,
        app: &'static str,
        args: &'static str,
        run_args: &'static str,
    ) -> Candidate {
        Candidate {
            id,
            name,
            kind: TargetKind::Terminal,
            exe: id,
            args,
            wsl_args: None,
            run_args: Some(run_args),
            wsl_run_args: None,
            app: Some(app),
        }
    }

    fn ghostty_row() -> Candidate {
        shared_terminal(
            "ghostty",
            "Ghostty",
            "Ghostty",
            "--working-directory=\"{path}\" -e bash \"{script}\"",
            "--working-directory=\"{path}\" -e {command}",
        )
    }

    // a bundle with its binary in place, so the in-bundle branch is the one
    // the test has to beat rather than one a missing file already ruled out
    fn fake_bundle(dir: &str, app: &str, exe: &str) -> PathBuf {
        let root = std::env::temp_dir().join(dir);
        let _ = std::fs::remove_dir_all(&root);
        let bundle = root.join(format!("{app}.app"));
        let bin = bundle.join("Contents").join("MacOS");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(exe), "").unwrap();
        bundle
    }

    /// Ghostty's mac app is not the cli its linux row runs: handed
    /// `-e bash "<script>"` the binary inside the bundle opens a window and
    /// throws the command away, with no error anywhere, so shift+enter on a
    /// mac with no ghostty on PATH did nothing at all. `open -na` is the
    /// form a tester watched start the script for real. The {script} seam
    /// has to survive into it, too: the launcher writes no script for a
    /// line that does not ask for one.
    #[test]
    fn a_ghostty_bundle_is_launched_through_open_and_not_its_own_binary() {
        let c = ghostty_row();
        let bundle = fake_bundle("devgo-editors-ghostty", "Ghostty", "ghostty");
        let inside = bundle.join("Contents").join("MacOS").join("ghostty");
        assert!(inside.is_file(), "the tempting branch is available");

        let t = bundle_form(&c, "Ghostty", &bundle);
        assert_eq!(t.executable, "open");
        assert_ne!(t.executable, inside.to_string_lossy());

        let (exe, args) = t.resolve("/Users/joy/my app", None).unwrap();
        assert_eq!(exe, "open");
        assert!(args.contains("{script}"), "no script would be written");
        assert_eq!(
            args.replace("{script}", "/tmp/devgo-1a2b3c4d.sh"),
            "-na \"Ghostty\" --args --working-directory=\"/Users/joy/my app\" \
             -e bash \"/tmp/devgo-1a2b3c4d.sh\""
        );

        // the run form goes the same way, or the command key would open a
        // window and drop the command exactly as the session key did
        let (_, run) = t
            .resolve_run("/Users/joy/my app", None, "npm run dev")
            .unwrap();
        assert_eq!(
            run,
            "-na \"Ghostty\" --args \
             --working-directory=\"/Users/joy/my app\" -e npm run dev"
        );

        let _ = std::fs::remove_dir_all(bundle.parent().unwrap());
    }

    /// WezTerm and Kitty were verified working through the binary inside
    /// their bundles, so a later fix for a fifth emulator must not quietly
    /// move them onto `open`. Alacritty is here as the honest unknown: its
    /// cask was disabled for failing Gatekeeper, so nobody can install it
    /// to find out which of the two it behaves like, and a row nobody can
    /// test keeps the form it shipped with rather than a guess.
    #[test]
    fn wezterm_kitty_and_alacritty_keep_the_binary_in_their_bundles() {
        let rows = [
            shared_terminal(
                "wezterm",
                "WezTerm",
                "WezTerm",
                "start --cwd \"{path}\" -- bash \"{script}\"",
                "start --cwd \"{path}\" -- {command}",
            ),
            shared_terminal(
                "kitty",
                "Kitty",
                "kitty",
                "--directory \"{path}\" bash \"{script}\"",
                "--directory \"{path}\" {command}",
            ),
            shared_terminal(
                "alacritty",
                "Alacritty",
                "Alacritty",
                "--working-directory \"{path}\" -e bash \"{script}\"",
                "--working-directory \"{path}\" -e {command}",
            ),
        ];
        for c in &rows {
            let app = c.app.unwrap();
            let bundle =
                fake_bundle(&format!("devgo-editors-{}", c.id), app, c.exe);
            let inside = bundle.join("Contents").join("MacOS").join(c.exe);

            let t = bundle_form(c, app, &bundle);
            assert_eq!(t.executable, inside.to_string_lossy(), "{}", c.id);
            assert_eq!(t.args_template, c.args, "{}", c.id);
            assert_eq!(t.run_args_template.as_deref(), c.run_args, "{}", c.id);
            assert!(!t.args_template.contains("open"), "{}", c.id);

            let _ = std::fs::remove_dir_all(bundle.parent().unwrap());
        }
    }

    /// The fix is the bundle form and nothing else. On linux ghostty is on
    /// PATH, `locate` hands back the row itself, and the plain `-e` line is
    /// the right one there — so the row, the session form pinned for every
    /// platform, and the bytes an old install is migrated onto are all one
    /// thing still, and none of them mentions `open`.
    #[test]
    fn the_ghostty_path_form_and_its_upgrade_are_untouched() {
        use crate::models::target::LINUX_ARGS_PRE_TMUX;
        let t = to_target(&ghostty_row());
        assert_eq!(t.executable, "ghostty");
        assert_eq!(
            t.args_template,
            "--working-directory=\"{path}\" -e bash \"{script}\""
        );
        for line in [Some(&t.args_template), t.run_args_template.as_ref()] {
            let line = line.unwrap();
            for mac_only in ["open ", "-na ", "--args ", "/Applications"] {
                assert!(!line.contains(mac_only), "{mac_only}: {line}");
            }
        }
        let (_, args) = LINUX_TERMINAL_ARGS
            .iter()
            .find(|(id, _)| *id == "ghostty")
            .unwrap();
        assert_eq!(*args, t.args_template);
        let (_, _, seam) = LINUX_ARGS_PRE_TMUX
            .iter()
            .find(|(id, _, _)| *id == "ghostty")
            .unwrap();
        assert_eq!(*seam, t.args_template);
    }

    // the rows the three tests above stand in for are the table's own, and
    // ghostty is the only row whose in-bundle binary is not trusted with a
    // command - wezterm and kitty are verified working with it
    #[cfg(not(windows))]
    #[test]
    fn those_stand_in_rows_are_the_table_rows() {
        for stand_in in [
            ghostty_row(),
            shared_terminal(
                "wezterm",
                "WezTerm",
                "WezTerm",
                "start --cwd \"{path}\" -- bash \"{script}\"",
                "start --cwd \"{path}\" -- {command}",
            ),
            shared_terminal(
                "kitty",
                "Kitty",
                "kitty",
                "--directory \"{path}\" bash \"{script}\"",
                "--directory \"{path}\" {command}",
            ),
            shared_terminal(
                "alacritty",
                "Alacritty",
                "Alacritty",
                "--working-directory \"{path}\" -e bash \"{script}\"",
                "--working-directory \"{path}\" -e {command}",
            ),
        ] {
            let c = CANDIDATES
                .iter()
                .find(|c| c.id == stand_in.id)
                .unwrap_or_else(|| panic!("{} left the table", stand_in.id));
            assert_eq!(c.name, stand_in.name, "{}", c.id);
            assert_eq!(c.exe, stand_in.exe, "{}", c.id);
            assert_eq!(c.app, stand_in.app, "{}", c.id);
            assert_eq!(c.args, stand_in.args, "{}", c.id);
            assert_eq!(c.run_args, stand_in.run_args, "{}", c.id);
        }
        for c in CANDIDATES {
            assert_eq!(
                bundle_binary_takes_a_command(c),
                c.id != "ghostty",
                "{}",
                c.id
            );
        }
    }
}
