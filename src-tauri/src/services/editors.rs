//! Finding the editors and terminals that are actually installed.
//!
//! One `where.exe` for every Windows candidate and one `bash -lc` per
//! running distro, never a process per editor. A stopped distro is not
//! asked: an editor list is not worth booting a VM for.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;

use crate::models::target::{LaunchTarget, TargetKind};

const CREATE_NO_WINDOW: u32 = 0x08000000;

struct WinCandidate {
    id: &'static str,
    name: &'static str,
    kind: TargetKind,
    /// the command as it appears on PATH
    exe: &'static str,
    args: &'static str,
    /// how it opens a WSL project; None means it cannot, and launch_target
    /// says so rather than opening the wrong directory
    wsl_args: Option<&'static str>,
    run_args: Option<&'static str>,
    wsl_run_args: Option<&'static str>,
}

// the VS Code family does the crossing itself
const REMOTE_URI: &str =
    "--folder-uri vscode-remote://wsl+{distro}{linux_path}";

/// Editors and terminals worth looking for on the Windows side, roughly in
/// the order a WSL-first developer is likely to have them. `vscode` and `wt`
/// must keep the ids `defaults()` seeds, or detection would offer to add
/// what every install already has.
const WINDOWS: &[WinCandidate] = &[
    WinCandidate {
        id: "vscode",
        name: "VS Code",
        kind: TargetKind::Editor,
        exe: "code",
        args: "\"{path}\"",
        wsl_args: Some(REMOTE_URI),
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "vscode-insiders",
        name: "VS Code Insiders",
        kind: TargetKind::Editor,
        exe: "code-insiders",
        args: "\"{path}\"",
        wsl_args: Some(REMOTE_URI),
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "cursor",
        name: "Cursor",
        kind: TargetKind::Editor,
        exe: "cursor",
        args: "\"{path}\"",
        wsl_args: Some(REMOTE_URI),
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "windsurf",
        name: "Windsurf",
        kind: TargetKind::Editor,
        exe: "windsurf",
        args: "\"{path}\"",
        wsl_args: Some(REMOTE_URI),
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "zed",
        name: "Zed",
        kind: TargetKind::Editor,
        exe: "zed",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "sublime",
        name: "Sublime Text",
        kind: TargetKind::Editor,
        exe: "subl",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "idea",
        name: "IntelliJ IDEA",
        kind: TargetKind::Editor,
        exe: "idea",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "webstorm",
        name: "WebStorm",
        kind: TargetKind::Editor,
        exe: "webstorm",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "pycharm",
        name: "PyCharm",
        kind: TargetKind::Editor,
        exe: "pycharm",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "rustrover",
        name: "RustRover",
        kind: TargetKind::Editor,
        exe: "rustrover",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "goland",
        name: "GoLand",
        kind: TargetKind::Editor,
        exe: "goland",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
    },
    WinCandidate {
        id: "fleet",
        name: "Fleet",
        kind: TargetKind::Editor,
        exe: "fleet",
        args: "\"{path}\"",
        wsl_args: None,
        run_args: None,
        wsl_run_args: None,
    },
    // terminals open WSL projects through the tmux script, like the seed
    WinCandidate {
        id: "wt",
        name: "Windows Terminal",
        kind: TargetKind::Terminal,
        exe: "wt",
        args: "-d \"{path}\"",
        wsl_args: Some("wsl -d {distro} bash \"{script}\""),
        run_args: Some("-d \"{path}\" cmd /k {command}"),
        wsl_run_args: Some(
            "wsl -d {distro} --cd \"{linux_path}\" -e bash -lc \"{command}; exec bash\"",
        ),
    },
    WinCandidate {
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
    },
    WinCandidate {
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
    },
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

fn to_target(c: &WinCandidate) -> LaunchTarget {
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
fn where_lookup(names: &[&str]) -> HashMap<String, String> {
    let mut found = HashMap::new();
    if names.is_empty() {
        return found;
    }
    let Ok(out) = Command::new("where.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(names)
        .output()
    else {
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

/// Is this executable resolvable? A full path the user typed is checked
/// directly: `where` only searches PATH and would call it missing.
pub fn is_on_path(exe: &str) -> bool {
    let direct = std::path::Path::new(exe);
    if direct.is_absolute() {
        return direct.is_file();
    }
    !where_lookup(&[exe]).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_candidate_id_is_unique() {
        let mut ids: Vec<&str> = WINDOWS.iter().map(|c| c.id).collect();
        let before = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), before, "duplicate id in the candidate table");
    }

    /// A detected VS Code or Windows Terminal is the seeded one: same id, so
    /// it is never offered as new, and the same templates, so a fresh install
    /// and a detected add behave alike.
    #[test]
    fn detected_seeds_match_the_seeded_defaults() {
        for seed in crate::models::target::defaults() {
            let c = WINDOWS
                .iter()
                .find(|c| c.id == seed.id)
                .unwrap_or_else(|| panic!("{} has no candidate", seed.id));
            let t = to_target(c);
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
    #[test]
    fn wsl_form_decides_whether_a_target_can_open_wsl() {
        let code = WINDOWS.iter().find(|c| c.id == "cursor").unwrap();
        let t = to_target(code);
        assert!(t.resolve("x", Some(("Ubuntu", "/home/joy"))).is_some());

        let subl = WINDOWS.iter().find(|c| c.id == "sublime").unwrap();
        let t = to_target(subl);
        assert!(t.resolve("x", Some(("Ubuntu", "/home/joy"))).is_none());
        assert!(t.resolve(r"G:\dev", None).is_some(), "still opens Windows");
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

    /// where.exe is always present on Windows, so this is the real lookup:
    /// cmd.exe resolves, an invented name does not.
    #[test]
    fn path_lookup_finds_real_programs_and_rejects_invented_ones() {
        assert!(is_on_path("cmd"), "cmd.exe must resolve on PATH");
        assert!(!is_on_path("devgo-definitely-not-a-real-program"));
    }
}
