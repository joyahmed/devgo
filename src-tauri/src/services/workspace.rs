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
            // a corrupt file goes to .bak, not under the next save
            super::config_io::parse_or_backup(&file_path, &data)
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

    /// An exact duplicate is a no-op. A nested one is refused: two roots
    /// where one contains the other scan the same folders, every project
    /// under the overlap shows twice and survives removing either root,
    /// and that looks exactly like delete being broken. Here is the only
    /// place it can still be described.
    pub fn add(&mut self, path: &str) -> Result<(), AppError> {
        let candidate = super::platform::paths::normalize(path);

        if self
            .workspaces
            .iter()
            .any(|w| super::platform::paths::normalize(w) == candidate)
        {
            return Ok(());
        }

        if let Some(existing) = self.workspaces.iter().find(|w| {
            let e = super::platform::paths::normalize(w);
            contains(&e, &candidate) || contains(&candidate, &e)
        }) {
            return Err(AppError::WorkspaceOverlaps(
                path.to_string(),
                existing.clone(),
            ));
        }

        self.workspaces.push(path.to_string());
        self.save()?;
        Ok(())
    }

    // Ok with nothing removed was a removal that never happened, reported
    // as done
    pub fn remove(&mut self, index: usize) -> Result<(), AppError> {
        if index >= self.workspaces.len() {
            return Err(AppError::WorkspaceIndexOutOfRange(
                index,
                self.workspaces.len(),
            ));
        }
        self.workspaces.remove(index);
        self.save()?;
        Ok(())
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.workspaces)?;
        fs::write(&self.file_path, data)?;
        Ok(())
    }
}

// the separator is the point: without it G:/dev would contain G:/devtools
fn contains(parent: &str, child: &str) -> bool {
    child.starts_with(&format!("{parent}/"))
}
