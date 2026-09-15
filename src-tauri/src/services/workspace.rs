use crate::error::AppError;
use serde_json;
use std::fs;
use std::path::PathBuf;

#[derive(Debug)]
pub struct WorkspaceStore {
    workspaces: Vec<String>,
    file_path: PathBuf,
}

impl WorkspaceStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;

        let file_path = app_data_dir.join("workspaces.json");
        let workspaces = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            let default: Vec<String> = Vec::new();
            fs::write(&file_path, serde_json::to_string_pretty(&default)?)?;
            default
        };

        Ok(Self {
            workspaces,
            file_path,
        })
    }

    pub fn list(&self) -> Vec<String> {
        self.workspaces.clone()
    }

    pub fn add(&mut self, path: &str) -> Result<(), AppError> {
        let normalized = path.replace('\\', "/");
        if !self
            .workspaces
            .iter()
            .any(|w| w.replace('\\', "/") == normalized)
        {
            self.workspaces.push(path.to_string());
            self.save()?;
        }
        Ok(())
    }

    pub fn remove(&mut self, index: usize) -> Result<(), AppError> {
        if index < self.workspaces.len() {
            self.workspaces.remove(index);
            self.save()?;
        }
        Ok(())
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.workspaces)?;
        fs::write(&self.file_path, data)?;
        Ok(())
    }
}
