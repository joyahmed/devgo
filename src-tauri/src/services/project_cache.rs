use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::Project;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedWorkspace {
    pub projects: Vec<Project>,
    pub scanned_at: u64,
}

#[derive(Debug)]
pub struct ProjectCacheStore {
    entries: HashMap<String, CachedWorkspace>,
    file_path: PathBuf,
}

impl ProjectCacheStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;

        let file_path = app_data_dir.join("projects-cache.json");
        let entries = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            HashMap::new()
        };

        Ok(Self { entries, file_path })
    }

    pub fn get(&self, workspace: &str) -> Option<&CachedWorkspace> {
        self.entries.get(workspace)
    }

    // every cached project, no scan
    pub fn all_projects(&self) -> Vec<Project> {
        self.entries
            .values()
            .flat_map(|w| w.projects.iter().cloned())
            .collect()
    }

    pub fn find(&self, full_path: &str) -> Option<Project> {
        self.entries
            .values()
            .flat_map(|w| w.projects.iter())
            .find(|p| p.full_path == full_path)
            .cloned()
    }

    /// Record a successful scan.
    ///
    /// There is deliberately no counterpart for a failed one. An unavailable
    /// workspace must never overwrite what we already know about it — otherwise
    /// a single boot with the drive still attaching would erase the cache and
    /// turn a transient glitch into permanent data loss.
    pub fn store(
        &mut self,
        workspace: &str,
        projects: Vec<Project>,
    ) -> Result<(), AppError> {
        self.entries.insert(
            workspace.to_string(),
            CachedWorkspace {
                projects,
                scanned_at: now(),
            },
        );
        self.save()
    }

    /// Forget workspaces that are no longer configured, so removing one does not
    /// leave its projects cached forever.
    pub fn retain(&mut self, workspaces: &[String]) -> Result<(), AppError> {
        let before = self.entries.len();
        self.entries
            .retain(|key, _| workspaces.iter().any(|w| w == key));
        if self.entries.len() != before {
            self.save()?;
        }
        Ok(())
    }

    // the machine-local file; a fresh scan rebuilds it
    pub fn clear(&mut self) -> Result<(), AppError> {
        if !self.entries.is_empty() {
            self.entries.clear();
            self.save()?;
        }
        Ok(())
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.entries)?;
        fs::write(&self.file_path, data)?;
        Ok(())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> ProjectCacheStore {
        let dir = std::env::temp_dir().join(format!("devgo-cache-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        ProjectCacheStore::new(dir).unwrap()
    }

    fn project(name: &str, workspace: &str) -> Project {
        Project::new(
            name.to_string(),
            format!("{workspace}\\{name}"),
            workspace.to_string(),
            "Windows".to_string(),
        )
    }

    #[test]
    fn find_reads_across_workspaces() {
        let mut s = store("find");
        s.store(r"G:\a", vec![project("api", r"G:\a")]).unwrap();
        s.store(r"G:\b", vec![project("web", r"G:\b")]).unwrap();

        assert_eq!(s.all_projects().len(), 2);
        assert_eq!(s.find(r"G:\b\web").map(|p| p.name), Some("web".into()));
        assert!(s.find(r"G:\b\gone").is_none());
    }
}
