use serde::{Deserialize, Serialize};

/// What a machine is, in one word on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Runtime {
    Windows,
    Wsl,
    Linux,
    MacOs,
}

// the platform this binary was built for. the same cfg ladder as
// scanner::LOCAL_FS, and deliberately beside it in shape, because the two
// describe one machine: a record saying runtime windows next to local_fs
// Linux contradicts itself in one line. that is what a native linux build
// wrote until it stopped sharing an arm with windows
#[cfg(windows)]
pub const NATIVE: Runtime = Runtime::Windows;
#[cfg(target_os = "macos")]
pub const NATIVE: Runtime = Runtime::MacOs;
#[cfg(not(any(windows, target_os = "macos")))]
pub const NATIVE: Runtime = Runtime::Linux;

impl Runtime {
    /// The runtime of the machine this process is on: the build target,
    /// except that a linux build whose environment names a distro is
    /// running *inside* WSL and says so. `native` is a parameter rather
    /// than the constant, so every platform's answer is testable on one.
    pub fn of(native: Runtime, inside_distro: Option<&str>) -> Runtime {
        match (native, inside_distro) {
            // only a linux build can be inside a distro. the windows host
            // reaches into one from outside and stays Windows. an empty
            // name is not a distro: it guards its own contract here so the
            // case is testable, and detection filters it at the env read so
            // default_distro never carries it either
            (Runtime::Linux, Some(name)) if !name.is_empty() => Runtime::Wsl,
            (native, _) => native,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::scanner::LOCAL_FS;

    // ⭐ the bug: a native linux build reported windows, because detection's
    // only non-mac arm was the windows one. injected rather than cfg'd, so
    // all three answers are checked wherever this suite runs
    #[test]
    fn a_native_build_reports_its_own_platform() {
        assert_eq!(Runtime::of(Runtime::Windows, None), Runtime::Windows);
        assert_eq!(Runtime::of(Runtime::Linux, None), Runtime::Linux);
        assert_eq!(Runtime::of(Runtime::MacOs, None), Runtime::MacOs);
    }

    #[test]
    fn a_linux_build_inside_a_distro_is_wsl() {
        assert_eq!(Runtime::of(Runtime::Linux, Some("Ubuntu")), Runtime::Wsl);
    }

    // ⭐ an empty WSL_DISTRO_NAME is not a distro. is_ok() used to accept a
    // present-but-blank one, and Some("") then survives every Option check
    // downstream: launcher::distro_for returned Ok("") where it should have
    // refused with NoWslDistro, and windows_to_wsl_path spelled a
    // \\wsl.localhost\ prefix with no distro in it
    #[test]
    fn an_empty_distro_name_is_not_a_distro() {
        assert_eq!(Runtime::of(Runtime::Linux, Some("")), Runtime::Linux);
    }

    // the host talks to wsl from outside it: a WSL_DISTRO_NAME that leaked
    // into a windows process through interop does not move it into a distro
    #[test]
    fn a_host_build_is_never_inside_a_distro() {
        let name = Some("Ubuntu");
        assert_eq!(Runtime::of(Runtime::Windows, name), Runtime::Windows);
        assert_eq!(Runtime::of(Runtime::MacOs, name), Runtime::MacOs);
    }

    // ⭐ the self-contradicting record, pinned: runtime and local_fs answer
    // the same question, so the two ladders have to agree on every platform
    // this compiles for. the assertion that was red on native linux
    #[test]
    fn the_native_word_never_contradicts_the_filesystem_name() {
        let expected = match LOCAL_FS {
            "Windows" => Runtime::Windows,
            "Mac" => Runtime::MacOs,
            "Linux" => Runtime::Linux,
            other => panic!("no runtime word for local filesystem {other}"),
        };
        assert_eq!(NATIVE, expected);
    }

    #[test]
    fn each_platform_has_one_lowercase_word_on_the_wire() {
        let word = |r| serde_json::to_value(r).unwrap();
        assert_eq!(word(Runtime::Windows), "windows");
        assert_eq!(word(Runtime::Wsl), "wsl");
        assert_eq!(word(Runtime::Linux), "linux");
        assert_eq!(word(Runtime::MacOs), "macos");
    }
}
