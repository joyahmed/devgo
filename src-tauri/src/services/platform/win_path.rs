//! The PATH a Windows child should get. DevGo's own process PATH is a
//! snapshot taken when Explorer started it: a tool installed afterwards
//! (Claude Code, an editor, node) is on the user's PATH in the registry
//! but not in that snapshot, so `where.exe` said "not installed" and every
//! terminal DevGo opened could not run it until a re-login. Explorer
//! builds a new process's PATH from two registry values, machine then
//! user; this does the same on every call, so a tool installed a minute
//! ago is found now. The process PATH is kept behind them: whatever the
//! shell that started DevGo added is not taken away.

/// Machine, then user, then the process PATH's own extras; each entry once
/// (compared without case and a trailing slash, as Windows does), empty
/// entries dropped. With no registry value at all, the process PATH as it
/// was. Pure: the registry is read by `fresh_path`, and a test hands this
/// strings of its own.
///
/// Registry entries come before anything the launching shell prepended
/// (a venv's bin, a version manager's shims). That is intentional: the
/// registry is what a fresh terminal would see, and the shell's extras
/// still follow, just no longer first.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn merge_path(
    machine: Option<&str>,
    user: Option<&str>,
    process: Option<&str>,
) -> String {
    if machine.is_none() && user.is_none() {
        return process.unwrap_or_default().to_string();
    }
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<&str> = Vec::new();
    for part in [machine, user, process].into_iter().flatten() {
        for entry in part.split(';') {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            let key = entry.trim_end_matches(['\\', '/']).to_lowercase();
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            out.push(entry);
        }
    }
    out.join(";")
}

/// `%NAME%` replaced by what `lookup` says NAME is; a name it does not
/// know stays as written, `%NAME%` and all, which is what Windows does
/// with an unset variable. A lone `%` is kept.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn expand_vars(
    s: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match lookup(name) {
                    Some(value) => out.push_str(&value),
                    None => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Read now, not once: the point is to see what changed since DevGo
/// started. Two registry reads, cheap next to the spawn they precede.
#[cfg(windows)]
pub fn fresh_path() -> String {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    const MACHINE_ENV: &str =
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    // what a fresh terminal would see for %NAME%: the user's value, then
    // the machine's, then DevGo's own (stale) environment as a last resort
    let raw = |name: &str| -> Option<String> {
        let reg = |hive: &RegKey, sub: &str| {
            hive.open_subkey(sub)
                .ok()?
                .get_value::<String, _>(name)
                .ok()
                .map(|v| v.trim_end_matches('\0').to_string())
        };
        reg(&hkcu, "Environment")
            .or_else(|| reg(&hklm, MACHINE_ENV))
            .or_else(|| std::env::var(name).ok())
    };
    // a looked-up value is expanded once more and no further, so a value
    // that names itself cannot loop
    let lookup = |name: &str| -> Option<String> {
        raw(name).map(|v| {
            expand_vars(&v, |inner| {
                if inner.eq_ignore_ascii_case(name) {
                    None
                } else {
                    raw(inner)
                }
            })
        })
    };
    let machine = read_path(&hklm, MACHINE_ENV, &lookup);
    let user = read_path(&hkcu, "Environment", &lookup);
    let process = std::env::var("PATH").ok();
    merge_path(machine.as_deref(), user.as_deref(), process.as_deref())
}

// the `Path` value under one key, %VARS% expanded when the value is a
// REG_EXPAND_SZ (the user's usually is: %USERPROFILE%\.local\bin) and
// left alone when it is a plain REG_SZ, as Windows leaves it
#[cfg(windows)]
fn read_path(
    hive: &winreg::RegKey,
    sub: &str,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    use winreg::enums::RegType;
    let key = hive.open_subkey(sub).ok()?;
    let expandable = matches!(
        key.get_raw_value("Path").ok()?.vtype,
        RegType::REG_EXPAND_SZ
    );
    let raw: String = key.get_value("Path").ok()?;
    let raw = raw.trim_end_matches('\0');
    Some(if expandable {
        expand_vars(raw, lookup)
    } else {
        raw.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn machine_comes_before_user_and_the_process_extras_trail() {
        let path = merge_path(
            Some(r"C:\Windows;C:\Windows\System32"),
            Some(r"C:\Users\u\.local\bin"),
            Some(r"C:\Windows;D:\only-in-process"),
        );
        assert_eq!(
            path,
            r"C:\Windows;C:\Windows\System32;C:\Users\u\.local\bin;D:\only-in-process"
        );
    }

    #[test]
    fn an_entry_is_kept_once_whatever_its_case_or_trailing_slash() {
        let path = merge_path(
            Some(r"C:\Tools\;;C:\tools"),
            Some(r" c:\TOOLS ;C:\Other"),
            None,
        );
        assert_eq!(path, r"C:\Tools\;C:\Other");
    }

    #[test]
    fn a_tool_installed_after_start_is_on_the_merged_path() {
        // the bug: the process snapshot predates the install, the
        // registry user Path does not
        let user = r"C:\Users\u\.local\bin";
        let path =
            merge_path(Some(r"C:\Windows"), Some(user), Some(r"C:\Windows"));
        assert!(path.split(';').any(|e| e == user), "{path}");
    }

    #[test]
    fn no_registry_value_means_the_process_path_unchanged() {
        assert_eq!(merge_path(None, None, Some("A;;B")), "A;;B");
        assert_eq!(merge_path(None, None, None), "");
        assert_eq!(merge_path(None, Some("U"), Some("P")), "U;P");
    }

    #[test]
    fn vars_are_expanded_and_unknown_ones_are_left_as_written() {
        let lookup = |name: &str| match name {
            "USERPROFILE" => Some(r"C:\Users\u".to_string()),
            "SystemRoot" => Some(r"C:\Windows".to_string()),
            _ => None,
        };
        assert_eq!(
            expand_vars(r"%USERPROFILE%\bin;%SystemRoot%\System32", lookup),
            r"C:\Users\u\bin;C:\Windows\System32"
        );
        assert_eq!(expand_vars(r"%NOPE%\x", lookup), r"%NOPE%\x");
        assert_eq!(expand_vars("100% sure", lookup), "100% sure");
        assert_eq!(expand_vars("a%%b", lookup), "a%%b");
        assert_eq!(expand_vars("plain", lookup), "plain");
    }

    #[test]
    fn a_var_only_the_registry_knows_expands_to_the_real_folder() {
        // FOO is in the "registry" map and not in the process env, which
        // is the stale snapshot DevGo started with
        let registry: std::collections::HashMap<&str, &str> =
            [("FOO", r"D:\real")].into_iter().collect();
        let process: std::collections::HashMap<&str, &str> =
            [("BAR", r"E:\old")].into_iter().collect();
        let lookup = |n: &str| {
            registry
                .get(n)
                .or_else(|| process.get(n))
                .map(|v| v.to_string())
        };
        assert_eq!(expand_vars(r"%FOO%\bin", lookup), r"D:\real\bin");
        assert_eq!(expand_vars(r"%BAR%\bin", lookup), r"E:\old\bin");
    }

    #[cfg(windows)]
    #[test]
    fn the_fresh_path_still_finds_cmd() {
        use std::path::Path;
        let path = fresh_path();
        let has_cmd = |e: &str| Path::new(e).join("cmd.exe").is_file();
        assert!(path.split(';').any(has_cmd), "no cmd.exe on {path}");
    }
}
