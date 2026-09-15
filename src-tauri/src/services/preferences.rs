use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::platform::RuntimeInfo;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Preferences {
    pub last_project_path: Option<String>,
    pub last_workspace: Option<String>,
    /// Startup reads this instead of shelling out to wsl.exe. Detection calls
    /// `wsl -l -q` and `wsl -l -v`, which hit WSLService — the service whose
    /// timeouts this work exists to stop provoking.
    pub cached_runtime: Option<RuntimeInfo>,
}

pub struct PreferencesStore {
    prefs: Preferences,
    file_path: PathBuf,
}

impl PreferencesStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        let file_path = app_data_dir.join("prefs.json");
        let prefs = if file_path.exists() {
            let data = fs::read_to_string(&file_path)
                .map_err(|e| format!("Failed to read prefs: {e}"))?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Preferences::default()
        };
        Ok(Self { prefs, file_path })
    }

    pub fn get_last_project(&self) -> Option<(&str, &str)> {
        match (&self.prefs.last_project_path, &self.prefs.last_workspace) {
            (Some(path), Some(ws)) => Some((path.as_str(), ws.as_str())),
            _ => None,
        }
    }

    pub fn set_last_project(
        &mut self,
        path: String,
        workspace: String,
    ) -> Result<(), String> {
        self.prefs.last_project_path = Some(path);
        self.prefs.last_workspace = Some(workspace);
        self.save()
    }

    pub fn get_cached_runtime(&self) -> Option<RuntimeInfo> {
        self.prefs.cached_runtime.clone()
    }

    pub fn set_cached_runtime(
        &mut self,
        info: RuntimeInfo,
    ) -> Result<(), String> {
        self.prefs.cached_runtime = Some(info);
        self.save()
    }

    fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&self.prefs)
            .map_err(|e| format!("Failed to serialize prefs: {e}"))?;
        fs::write(&self.file_path, json)
            .map_err(|e| format!("Failed to write prefs: {e}"))?;
        Ok(())
    }
}
