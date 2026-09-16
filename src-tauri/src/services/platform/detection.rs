use super::runtime::Runtime;
use crate::services::scanner::LOCAL_FS;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
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

pub fn detect_runtime() -> RuntimeInfo {
    let is_wsl = std::env::var("WSL_DISTRO_NAME").is_ok();

    if is_wsl {
        return RuntimeInfo {
            runtime: Runtime::Wsl,
            wsl_available: true,
            distros: vec![],
            default_distro: std::env::var("WSL_DISTRO_NAME").ok(),
            local_fs: LOCAL_FS,
        };
    }

    let distros = super::wsl::list_distros();
    let default_distro = super::wsl::default_distro();

    RuntimeInfo {
        runtime: Runtime::Windows,
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
}
