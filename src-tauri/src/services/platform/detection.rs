use super::runtime::{self, Runtime};
use crate::services::scanner::LOCAL_FS;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    // what this machine is. on the wire only, for the same reason local_fs
    // below is: prefs.json may have been written by another os, or by a
    // build whose own derivation was wrong, and the word is cheap to derive
    // again — a compile-time constant and one env var, never a spawn
    #[serde(skip_deserializing, default = "native_runtime")]
    pub runtime: Runtime,
    pub wsl_available: bool,
    pub distros: Vec<String>,
    pub default_distro: Option<String>,
    // the name of this machine's own file system, so the frontend never
    // spells it. on the wire only: prefs.json may have been written by an
    // older build or another os, and the constant is the truth here
    #[serde(skip_deserializing, default = "local_fs")]
    pub local_fs: &'static str,
}

fn local_fs() -> &'static str {
    LOCAL_FS
}

// the distro this process is inside, if any. empty is not a distro name:
// an exported-but-blank WSL_DISTRO_NAME used to read as "inside wsl" and
// hand the launcher an empty distro to build unc paths from
fn inside_distro() -> Option<String> {
    std::env::var("WSL_DISTRO_NAME")
        .ok()
        .filter(|name| !name.is_empty())
}

fn native_runtime() -> Runtime {
    Runtime::of(runtime::NATIVE, inside_distro().as_deref())
}

// only the windows host can see other distros, and only it has a wsl.exe to
// ask. a mac has one filesystem and no wsl, and a native linux box has no
// wsl either — asking list_distros and letting it come back empty would be
// a spawn per detection for a binary that cannot exist. inside a distro the
// distro is the answer and needs no asking
#[cfg(not(windows))]
pub fn detect_runtime() -> RuntimeInfo {
    let inside = inside_distro();
    let runtime = Runtime::of(runtime::NATIVE, inside.as_deref());

    RuntimeInfo {
        runtime,
        wsl_available: runtime == Runtime::Wsl,
        distros: vec![],
        default_distro: inside,
        local_fs: LOCAL_FS,
    }
}

#[cfg(windows)]
pub fn detect_runtime() -> RuntimeInfo {
    let distros = super::wsl::list_distros();
    let default_distro = super::wsl::default_distro();

    RuntimeInfo {
        runtime: runtime::NATIVE,
        wsl_available: !distros.is_empty(),
        distros,
        default_distro,
        local_fs: LOCAL_FS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_fs_is_written_and_never_read_back() {
        let info = RuntimeInfo {
            runtime: Runtime::Windows,
            wsl_available: false,
            distros: vec![],
            default_distro: None,
            local_fs: LOCAL_FS,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["local_fs"], LOCAL_FS);

        // a prefs.json from before the field, and one another os wrote
        let old = r#"{"runtime":"windows","wsl_available":true,"distros":["Ubuntu"],"default_distro":"Ubuntu"}"#;
        let back: RuntimeInfo = serde_json::from_str(old).unwrap();
        assert_eq!(back.local_fs, LOCAL_FS);
        let foreign = old.replace('}', r#","local_fs":"Mac"}"#);
        let back: RuntimeInfo = serde_json::from_str(&foreign).unwrap();
        assert_eq!(back.local_fs, LOCAL_FS);
        assert_eq!(back.distros, vec!["Ubuntu"]);
    }

    // ⭐ prefs.json records what the machine was, not what it is. it may
    // have been written by another os, or by a build whose own derivation
    // was wrong — joy's linux prefs.json carries runtime windows — so the
    // word has to be re-derived on the way in, the same reason local_fs is
    #[test]
    fn the_cached_runtime_word_is_re_derived_not_believed() {
        let stale = r#"{"runtime":"wsl","wsl_available":true,"distros":["Ubuntu"],"default_distro":"Ubuntu","local_fs":"Mac"}"#;
        let back: RuntimeInfo = serde_json::from_str(stale).unwrap();
        assert_eq!(back.runtime, native_runtime());
        assert!(
            !matches!(back.runtime, Runtime::Wsl),
            "a machine that is not inside a distro must not come back as one"
        );
    }

    // detection and the record agree with each other on whatever platform
    // this runs: the pair that used to disagree on linux
    #[test]
    fn detection_agrees_with_the_native_word() {
        let info = detect_runtime();
        assert_eq!(info.runtime, native_runtime());
        assert_eq!(info.local_fs, LOCAL_FS);
        if info.runtime != Runtime::Wsl {
            assert_eq!(info.runtime, runtime::NATIVE);
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod mac_tests {
    use super::*;

    #[test]
    fn a_mac_has_no_second_filesystem_and_no_wsl() {
        let info = detect_runtime();
        assert!(!info.wsl_available);
        assert!(info.distros.is_empty());
        assert_eq!(info.default_distro, None);
        assert_eq!(info.local_fs, "Mac");
        assert_eq!(info.runtime, Runtime::MacOs);
    }
}

// a native linux box is not a windows host: nothing here may claim windows,
// and nothing may spawn a wsl.exe that cannot exist. these are the
// assertions that were red before 78 — they do not compile on windows
#[cfg(all(test, not(any(windows, target_os = "macos"))))]
mod linux_tests {
    use super::*;

    #[test]
    fn a_native_linux_box_is_linux_or_the_distro_it_is_inside() {
        let info = detect_runtime();
        let expected = match inside_distro() {
            Some(_) => Runtime::Wsl,
            None => Runtime::Linux,
        };
        assert_eq!(info.runtime, expected);
        assert_ne!(info.runtime, Runtime::Windows);
        assert_eq!(info.local_fs, "Linux");
        assert!(info.distros.is_empty());
    }
}
