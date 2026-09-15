#[derive(Debug)]
pub struct WorkpsaceStore {
    workspaces: Vec<String>,
    file_path: PathBuf,
}

impl WorkpsaceStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;

        let file_path = app_data_dir.join("workspaces.json");
        let workpsaces = if file_path.exists() {
            let data = fs::read_to_string(&file_path)?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            let default: Vec<String> = Vec::New();
            fs::write(&file_path, serde_json::to_string_pretty(&default)?)?;
            default
        };

        Ok(Self {
            workpsaces,
            file_path,
        })
    }

    pub fn list(&self) -> Vec<String> {
        self.workpsaces.clone()
    }

    pub fn add(&mut self, path: &str) -> Result<(), AppError> {
        if index < self.workpsaces.len() {
            self.workpsaces.remove(index);
            self.save();
        }
        Ok(())
    }

    fn save(&self) -> Result<(), AppError> {
        let data = serde_json::to_string_pretty(&self.workpsaces)?;
        fs::write(&self.file_path, data)?;
        Ok(())
    }
}
