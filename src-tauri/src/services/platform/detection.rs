use super::runtime::Runtime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub runtime: Runtime,
    pub wsl_available: bool,
    pub distros: Vec<String>,
    pub default_distro: Option<String>,
}

pub fn detect_runtime() -> RuntimeInfo {
    let is_wsl = std::env::var("WSL_DISTRO_NAME").is_ok();

    if is_wsl {
        return RuntimeInfo {
            runtime: Runtime::Wsl,
            wsl_available: true,
            distros: vec![],
            default_distro: std::env::var("WSL_DISTRO_NAME").ok(),
        };
    }

    let distros = super::wsl::list_distros();
    let default_distro = super::wsl::default_distro();

    RuntimeInfo {
        runtime: Runtime::Windows,
        wsl_available: !distros.is_empty(),
        distros,
        default_distro,
    }
}
