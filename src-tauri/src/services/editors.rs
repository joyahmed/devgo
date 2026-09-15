//! Finding the editors and terminals that are actually installed.
//!
//! One `where.exe` for every Windows candidate and one `bash -lc` per
//! running distro, never a process per editor. A stopped distro is not
//! asked: an editor list is not worth booting a VM for.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x08000000;

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

    /// where.exe is always present on Windows, so this is the real lookup:
    /// cmd.exe resolves, an invented name does not.
    #[test]
    fn path_lookup_finds_real_programs_and_rejects_invented_ones() {
        assert!(is_on_path("cmd"), "cmd.exe must resolve on PATH");
        assert!(!is_on_path("devgo-definitely-not-a-real-program"));
    }
}
