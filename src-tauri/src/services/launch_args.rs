//! `devgo <folder>` and `devgo --open <folder>`: a project named on the
//! command line.
//!
//! Three pure steps, so each is testable without a window:
//!
//! 1. [`parse`] reads argv into an [`Invocation`] - nothing, a folder, or
//!    a refusal that says what it did not understand.
//! 2. [`resolve`] turns a folder argument into an absolute path against the
//!    cwd of the process that was *launched*, and checks it is a folder that
//!    exists. It has to happen on that side: the running instance has a cwd
//!    of its own, so a relative path forwarded as typed would land somewhere
//!    else.
//! 3. [`Handoff`] is what crosses the single-instance socket. `restore` is
//!    the word every DevGo has always sent and stays byte-for-byte the same;
//!    `open {json}` is the new one, carrying the path or the reason it was
//!    refused, so the running window can say so instead of the launching
//!    process failing into a console nobody has open.
//!
//! A refused path never stops DevGo from starting: the window comes up and
//! says what was wrong. Exiting with no window is the "nothing happened"
//! failure chapter 07 already removed once.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const USAGE: &str = "usage: devgo [--open] <folder>";

/// What argv asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// no folder: a plain launch, or a second one that only raises
    Plain,
    /// one folder, as typed - not yet resolved
    Open(String),
    /// argv named something DevGo cannot act on; the reason is the notice
    Invalid(String),
}

/// argv, without the program name. `--smoke-probe` never reaches here:
/// `main` handles it before tauri starts.
pub fn parse<S: AsRef<str>>(args: &[S], windows: bool) -> Invocation {
    let mut folder: Option<String> = None;
    let mut it = args.iter().map(AsRef::as_ref);
    let take = |raw: &str, folder: &mut Option<String>| {
        if folder.is_some() {
            return Err(format!("one folder at a time. {USAGE}"));
        }
        let cleaned = clean_arg(raw, windows);
        if cleaned.is_empty() {
            return Err("the folder named on the command line is empty".into());
        }
        *folder = Some(cleaned);
        Ok(())
    };
    while let Some(arg) = it.next() {
        let step = match arg {
            "--open" => match it.next() {
                Some(p) => take(p, &mut folder),
                None => Err(format!("--open needs a folder. {USAGE}")),
            },
            // everything after `--` is a folder, even one that starts with -
            "--" => {
                let mut r = Ok(());
                for p in it.by_ref() {
                    r = take(p, &mut folder);
                    if r.is_err() {
                        break;
                    }
                }
                r
            }
            // macOS hands a Finder launch a process serial number
            a if a.starts_with("-psn_") => Ok(()),
            a if a.starts_with('-') && a.len() > 1 => {
                Err(format!("unknown option {a}. {USAGE}"))
            }
            a => take(a, &mut folder),
        };
        if let Err(e) = step {
            return Invocation::Invalid(e);
        }
    }
    match folder {
        Some(f) => Invocation::Open(f),
        None => Invocation::Plain,
    }
}

/// Windows quoting: `devgo "C:\work\"` arrives as `C:\work"`, because the
/// backslash escapes the closing quote. A folder name cannot contain `"` on
/// Windows, so a trailing one is always that accident.
fn clean_arg(raw: &str, windows: bool) -> String {
    let s = raw.trim();
    if windows {
        s.trim_end_matches('"').to_string()
    } else {
        s.to_string()
    }
}

/// `raw` made absolute against `cwd`, with `.` and `..` folded lexically, and
/// checked to be an existing folder. `Err` is the sentence the window shows.
///
/// Lexical, not `canonicalize`: on Windows that returns the `\\?\C:\…`
/// verbatim form, which matches no project row, and on Unix it resolves
/// symlinks, so a project scanned through a linked folder would stop
/// matching itself. The path is used to *find* a row, so it stays spelled
/// the way the user spelled it.
pub fn resolve(raw: &str, cwd: &Path) -> Result<PathBuf, String> {
    let given = Path::new(raw);
    let joined = if given.is_absolute() {
        given.to_path_buf()
    } else {
        cwd.join(given)
    };
    let path = fold(&joined);
    match std::fs::metadata(&path) {
        Ok(m) if m.is_dir() => Ok(path),
        Ok(_) => Err(format!(
            "{} is a file, not a folder. DevGo opens project folders",
            path.display()
        )),
        Err(_) => Err(format!("{} does not exist", path.display())),
    }
}

/// `.` dropped, `..` pops a name; never above the root or the drive.
fn fold(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(
                    out.components().next_back(),
                    Some(Component::Normal(_))
                ) {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// A folder argument, resolved: what the window acts on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenRequest {
    /// the absolute path, or the argument as typed when it was refused
    pub path: String,
    /// why it was refused; `None` means the folder exists
    pub error: Option<String>,
}

impl OpenRequest {
    /// argv to the request the window acts on. `None` for a plain launch.
    pub fn from_invocation(inv: Invocation, cwd: &Path) -> Option<Self> {
        match inv {
            Invocation::Plain => None,
            Invocation::Invalid(error) => Some(Self {
                path: String::new(),
                error: Some(error),
            }),
            Invocation::Open(raw) => Some(match resolve(&raw, cwd) {
                Ok(p) => Self {
                    path: p.to_string_lossy().into_owned(),
                    error: None,
                },
                Err(e) => Self {
                    path: raw,
                    error: Some(e),
                },
            }),
        }
    }
}

/// What a second launch tells the first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Handoff {
    Restore,
    Open(OpenRequest),
}

/// The listener reads at most this much; a path is far shorter.
pub const MAX_HANDOFF: usize = 64 * 1024;

impl Handoff {
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Self::Restore => b"restore".to_vec(),
            Self::Open(req) => {
                let mut v = b"open ".to_vec();
                // a struct of two strings always serializes
                v.extend(serde_json::to_vec(req).unwrap_or_default());
                v
            }
        }
    }

    /// `None` for anything that is not a DevGo handoff: a stray connection
    /// to the port is ignored, as it always was.
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        if bytes == b"restore" {
            return Some(Self::Restore);
        }
        let json = bytes.strip_prefix(b"open ")?;
        serde_json::from_slice(json).ok().map(Self::Open)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir()
            .join(format!("devgo-args-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn no_arguments_is_a_plain_launch() {
        assert_eq!(parse::<&str>(&[], false), Invocation::Plain);
    }

    #[test]
    fn a_bare_path_and_open_flag_both_name_a_folder() {
        assert_eq!(
            parse(&["/home/alex/work"], false),
            Invocation::Open("/home/alex/work".into())
        );
        assert_eq!(
            parse(&["--open", "/home/alex/work"], false),
            Invocation::Open("/home/alex/work".into())
        );
    }

    #[test]
    fn a_folder_after_double_dash_may_start_with_a_dash() {
        assert_eq!(
            parse(&["--", "-odd"], false),
            Invocation::Open("-odd".into())
        );
    }

    #[test]
    fn open_with_no_folder_is_refused_with_the_usage() {
        let Invocation::Invalid(e) = parse(&["--open"], false) else {
            panic!("expected a refusal");
        };
        assert!(e.contains("--open needs a folder") && e.contains(USAGE));
    }

    #[test]
    fn an_unknown_flag_is_refused_by_name() {
        let Invocation::Invalid(e) = parse(&["--wat"], false) else {
            panic!("expected a refusal");
        };
        assert!(e.contains("--wat"), "{e}");
    }

    #[test]
    fn two_folders_are_refused() {
        assert!(matches!(
            parse(&["/a", "/b"], false),
            Invocation::Invalid(_)
        ));
        assert!(matches!(
            parse(&["--open", "/a", "/b"], false),
            Invocation::Invalid(_)
        ));
    }

    #[test]
    fn a_finder_serial_number_is_ignored() {
        assert_eq!(parse(&["-psn_0_12345"], false), Invocation::Plain);
        assert_eq!(
            parse(&["-psn_0_1", "/x"], false),
            Invocation::Open("/x".into())
        );
    }

    #[test]
    fn a_windows_escaped_closing_quote_is_dropped() {
        assert_eq!(
            parse(&[r#"C:\work\devgo""#], true),
            Invocation::Open(r"C:\work\devgo".into())
        );
        // a unix name may hold a quote; it is kept there
        assert_eq!(parse(&["a\""], false), Invocation::Open("a\"".into()));
    }

    #[test]
    fn a_relative_folder_resolves_against_the_launching_cwd() {
        let root = tmp("rel");
        std::fs::create_dir_all(root.join("proj")).unwrap();
        assert_eq!(resolve("proj", &root).unwrap(), root.join("proj"));
        assert_eq!(resolve("./proj/", &root).unwrap(), root.join("proj"));
        assert_eq!(resolve("proj/../proj", &root).unwrap(), root.join("proj"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_path_and_a_file_are_refused_plainly() {
        let root = tmp("bad");
        let e = resolve("nope", &root).unwrap_err();
        assert!(e.ends_with("does not exist"), "{e}");
        std::fs::write(root.join("f.txt"), "x").unwrap();
        let e = resolve("f.txt", &root).unwrap_err();
        assert!(e.contains("is a file, not a folder"), "{e}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_refused_folder_keeps_what_was_typed() {
        let root = tmp("req");
        let r = OpenRequest::from_invocation(
            Invocation::Open("gone".into()),
            &root,
        )
        .unwrap();
        assert_eq!(r.path, "gone");
        assert!(r.error.is_some());
        assert_eq!(
            OpenRequest::from_invocation(Invocation::Plain, &root),
            None
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_fold_and_keep_their_drive() {
        assert_eq!(
            fold(Path::new(r"C:\work\.\a\..\devgo\")),
            PathBuf::from(r"C:\work\devgo")
        );
        assert_eq!(fold(Path::new(r"C:\..")), PathBuf::from(r"C:\"));
        assert!(Path::new(r"C:\work").is_absolute());
    }

    #[cfg(unix)]
    #[test]
    fn unix_paths_never_fold_above_the_root() {
        assert_eq!(fold(Path::new("/../a/./b/..")), PathBuf::from("/a"));
    }

    #[test]
    fn restore_is_the_bytes_every_devgo_sends() {
        assert_eq!(Handoff::Restore.encode(), b"restore");
        assert_eq!(Handoff::decode(b"restore"), Some(Handoff::Restore));
    }

    #[test]
    fn an_open_handoff_round_trips_its_path_and_error() {
        for req in [
            OpenRequest {
                path: r"C:\Users\alex\work dir\ü".into(),
                error: None,
            },
            OpenRequest {
                path: "/home/alex/x".into(),
                error: Some("/home/alex/x does not exist".into()),
            },
        ] {
            let h = Handoff::Open(req);
            assert_eq!(Handoff::decode(&h.encode()), Some(h));
        }
    }

    #[test]
    fn a_stray_connection_decodes_to_nothing() {
        assert_eq!(Handoff::decode(b""), None);
        assert_eq!(Handoff::decode(b"GET / HTTP/1.1"), None);
        assert_eq!(Handoff::decode(b"open {not json"), None);
    }
}
