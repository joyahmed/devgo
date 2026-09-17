// the server side of the contract, carried in the binary: the three files
// under server/ ride along as strings, so a box that has none gets them
// from the row's menu instead of two scp lines typed by hand. one ssh
// reads what ~/scripts already holds, one ssh writes what is missing. a
// file that is there and differs is the user's own and stays: a private
// inventory or a hand-edited actions file wins over the shipped one

use std::collections::HashMap;

use serde::Serialize;

// where the contract says the files live
pub const DIR: &str = "~/scripts";

// a file the app carries, and how it lands
#[derive(Debug, Clone, PartialEq)]
pub struct Bundled {
    pub name: &'static str,
    pub body: String,
    // chmod +x: the two scripts
    pub executable: bool,
    // chmod 600: the actions file decides what a click runs
    pub private: bool,
}

// the repo keeps these lf; a checkout that rewrote them to crlf must not
// ship a script bash cannot run
fn lf(text: &str) -> String {
    text.replace("\r\n", "\n")
}

pub fn bundled() -> Vec<Bundled> {
    vec![
        Bundled {
            name: "devgo-inventory.sh",
            body: lf(include_str!("../../../server/devgo-inventory.sh")),
            executable: true,
            private: false,
        },
        Bundled {
            name: "site-new.sh",
            body: lf(include_str!("../../../server/site-new.sh")),
            executable: true,
            private: false,
        },
        Bundled {
            name: "devgo-actions.json",
            body: lf(include_str!(
                "../../../server/devgo-actions.example.json"
            )),
            executable: false,
            private: true,
        },
    ]
}

// a directory the remote shell can take unquoted: ~ and a plain path, no
// space, no quote, no operator. the default is DIR; a scratch directory is
// how the install is tried without touching ~/scripts
pub fn check_dir(dir: &str) -> Result<(), String> {
    let ok = !dir.is_empty()
        && dir
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "~/._-".contains(c));
    if ok {
        Ok(())
    } else {
        Err(format!("not a plain directory path: {dir}"))
    }
}

pub const HAVE_MARK: &str = "__DEVGO_HAVE__";

// the probe: for each file the box has, its name on a mark line and then
// its bytes. a file that is not there prints nothing, so its absence is
// the answer. -e, not -f: a directory by that name is also "in the way"
pub fn probe_command(dir: &str) -> String {
    let names: Vec<&str> = bundled().iter().map(|b| b.name).collect();
    format!(
        "for f in {}; do if [ -e {dir}/$f ]; then echo \"{HAVE_MARK} $f\"; \
         cat {dir}/$f 2>/dev/null; fi; done",
        names.join(" ")
    )
}

// the probe's output back into name → contents
pub fn parse_probe(stdout: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut current: Option<(String, Vec<&str>)> = None;
    for line in stdout.lines() {
        if let Some(name) = line.strip_prefix(HAVE_MARK) {
            if let Some((n, body)) = current.take() {
                out.insert(n, body.join("\n"));
            }
            current = Some((name.trim().to_string(), Vec::new()));
        } else if let Some((_, body)) = current.as_mut() {
            body.push(line);
        }
    }
    if let Some((n, body)) = current {
        out.insert(n, body.join("\n"));
    }
    out
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    // not on the box: install it
    Missing,
    // on the box, byte for byte the shipped one
    Same,
    // on the box and the user's own: kept
    Differs,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SetupFile {
    pub name: String,
    pub status: FileStatus,
    pub bytes: usize,
    // what the confirm will do with it
    pub install: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SetupPlan {
    pub dir: String,
    pub files: Vec<SetupFile>,
}

// trailing whitespace and line endings do not make a file someone else's
fn same(a: &str, b: &str) -> bool {
    lf(a).trim_end() == lf(b).trim_end()
}

// what the confirm sheet shows and the apply does: a missing file is
// installed, the rest stay as they are
pub fn plan(dir: &str, existing: &HashMap<String, String>) -> SetupPlan {
    let files = bundled()
        .into_iter()
        .map(|b| {
            let status = match existing.get(b.name) {
                None => FileStatus::Missing,
                Some(have) if same(have, &b.body) => FileStatus::Same,
                Some(_) => FileStatus::Differs,
            };
            SetupFile {
                name: b.name.to_string(),
                status,
                bytes: b.body.len(),
                install: status == FileStatus::Missing,
            }
        })
        .collect();
    SetupPlan {
        dir: dir.to_string(),
        files,
    }
}

pub const PUT_MARK: &str = "__DEVGO_PUT__";

// the files to write, one after the other on stdin, each under a mark
// line with its name. the remote awk opens a new output file at every
// mark and prints every other line into the one that is open
pub fn put_input(names: &[String]) -> Vec<u8> {
    let mut out = String::new();
    for b in bundled()
        .iter()
        .filter(|b| names.contains(&b.name.to_string()))
    {
        out.push_str(PUT_MARK);
        out.push(' ');
        out.push_str(b.name);
        out.push('\n');
        out.push_str(b.body.trim_end_matches('\n'));
        out.push('\n');
    }
    out.into_bytes()
}

// the one ssh that writes: the directory made, awk splitting stdin into
// the files, then the modes. only the files being written are touched,
// so a kept file's mode is not changed under the user
pub fn put_command(dir: &str, names: &[String]) -> String {
    let chosen: Vec<Bundled> = bundled()
        .into_iter()
        .filter(|b| names.contains(&b.name.to_string()))
        .collect();
    let mut line = format!(
        "mkdir -p {dir} && cd {dir} && awk '/^{PUT_MARK} /{{f=$2; next}} \
         {{print > f}}'"
    );
    let exec: Vec<&str> = chosen
        .iter()
        .filter(|b| b.executable)
        .map(|b| b.name)
        .collect();
    if !exec.is_empty() {
        line.push_str(&format!(" && chmod +x {}", exec.join(" ")));
    }
    let private: Vec<&str> = chosen
        .iter()
        .filter(|b| b.private)
        .map(|b| b.name)
        .collect();
    if !private.is_empty() {
        line.push_str(&format!(" && chmod 600 {}", private.join(" ")));
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_binary_carries_the_three_files_lf_only() {
        let files = bundled();
        assert_eq!(files.len(), 3);
        for b in &files {
            assert!(!b.body.is_empty(), "{} is empty", b.name);
            assert!(!b.body.contains('\r'), "{} has crlf", b.name);
        }
        assert!(files[0].body.starts_with("#!/usr/bin/env bash"));
        assert!(files[1].body.starts_with("#!/usr/bin/env bash"));
        assert!(files[2].body.trim_start().starts_with('{'));
        assert_eq!(files[2].name, "devgo-actions.json");
    }

    #[test]
    fn a_directory_is_a_plain_word() {
        assert!(check_dir("~/scripts").is_ok());
        assert!(check_dir("/tmp/devgo-setup").is_ok());
        assert!(check_dir("").is_err());
        assert!(check_dir("~/my scripts").is_err());
        assert!(check_dir("~/scripts; rm -rf /").is_err());
        assert!(check_dir("$HOME/scripts").is_err());
    }

    #[test]
    fn the_probe_names_every_file_and_cats_the_present_ones() {
        let cmd = probe_command("~/scripts");
        assert_eq!(
            cmd,
            "for f in devgo-inventory.sh site-new.sh devgo-actions.json; do \
             if [ -e ~/scripts/$f ]; then echo \"__DEVGO_HAVE__ $f\"; \
             cat ~/scripts/$f 2>/dev/null; fi; done"
        );
    }

    #[test]
    fn the_probe_output_splits_into_files_and_absence_is_absence() {
        let out = "__DEVGO_HAVE__ devgo-inventory.sh\n#!/usr/bin/env bash\n\
                   echo hi\n__DEVGO_HAVE__ devgo-actions.json\n{\"schema\": 2}\n";
        let have = parse_probe(out);
        assert_eq!(have.len(), 2);
        assert_eq!(have["devgo-inventory.sh"], "#!/usr/bin/env bash\necho hi");
        assert_eq!(have["devgo-actions.json"], "{\"schema\": 2}");
        assert!(!have.contains_key("site-new.sh"));
        assert!(parse_probe("").is_empty());
    }

    #[test]
    fn the_plan_installs_the_missing_and_keeps_the_rest() {
        let shipped = bundled();
        let mut have = HashMap::new();
        // the shipped inventory with crlf and a trailing newline: still ours
        have.insert(
            "devgo-inventory.sh".to_string(),
            shipped[0].body.replace('\n', "\r\n") + "\r\n",
        );
        have.insert(
            "devgo-actions.json".to_string(),
            "{\"schema\": 2, \"server\": []}".to_string(),
        );
        let p = plan("~/scripts", &have);
        assert_eq!(p.dir, "~/scripts");
        let by: HashMap<_, _> =
            p.files.iter().map(|f| (f.name.as_str(), f)).collect();
        assert_eq!(by["devgo-inventory.sh"].status, FileStatus::Same);
        assert!(!by["devgo-inventory.sh"].install);
        assert_eq!(by["site-new.sh"].status, FileStatus::Missing);
        assert!(by["site-new.sh"].install);
        assert_eq!(by["devgo-actions.json"].status, FileStatus::Differs);
        assert!(!by["devgo-actions.json"].install);
        assert_eq!(by["site-new.sh"].bytes, shipped[1].body.len());
    }

    #[test]
    fn a_fresh_box_installs_all_three() {
        let p = plan("~/scripts", &HashMap::new());
        assert!(p.files.iter().all(|f| f.install));
        assert_eq!(p.files.len(), 3);
    }

    #[test]
    fn the_put_line_makes_the_dir_splits_stdin_and_sets_the_modes() {
        let names = vec![
            "devgo-inventory.sh".to_string(),
            "devgo-actions.json".to_string(),
        ];
        assert_eq!(
            put_command("~/scripts", &names),
            "mkdir -p ~/scripts && cd ~/scripts && awk '/^__DEVGO_PUT__ /{f=$2; next} \
             {print > f}' && chmod +x devgo-inventory.sh && chmod 600 devgo-actions.json"
        );
        // only scripts: no 600
        let one = vec!["site-new.sh".to_string()];
        assert_eq!(
            put_command("/tmp/x", &one),
            "mkdir -p /tmp/x && cd /tmp/x && awk '/^__DEVGO_PUT__ /{f=$2; next} \
             {print > f}' && chmod +x site-new.sh"
        );
    }

    #[test]
    fn the_put_input_frames_each_chosen_file_under_its_mark() {
        let names =
            vec!["site-new.sh".to_string(), "devgo-actions.json".to_string()];
        let input = String::from_utf8(put_input(&names)).unwrap();
        assert!(input
            .starts_with("__DEVGO_PUT__ site-new.sh\n#!/usr/bin/env bash\n"));
        assert!(input.contains("\n__DEVGO_PUT__ devgo-actions.json\n{"));
        assert!(!input.contains("__DEVGO_PUT__ devgo-inventory.sh"));
        assert!(input.ends_with("}\n"));
        // the frame reads back as the files, byte for byte
        let back = parse_probe(&input.replace(PUT_MARK, HAVE_MARK));
        let shipped = bundled();
        assert_eq!(back["site-new.sh"], shipped[1].body.trim_end());
        assert_eq!(back["devgo-actions.json"], shipped[2].body.trim_end());
    }

    #[test]
    fn no_bundled_line_looks_like_a_mark() {
        for b in bundled() {
            assert!(
                !b.body.lines().any(|l| l.starts_with(PUT_MARK)),
                "{} would split itself",
                b.name
            );
        }
    }
}
