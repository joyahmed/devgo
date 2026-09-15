use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub full_path: String,
    pub workspace: String,
    pub file_system: String,
}

impl Project {
    pub fn new(
        name: String,
        full_path: String,
        workspace: String,
        file_system: String,
    ) -> Self {
        Self {
            name,
            full_path,
            workspace,
            file_system,
        }
    }
}
