use crate::error::AppError;
use crate::models::Project;

fn detect_file_system(workspace: &str) -> &str {
    let normalized = workspace.replace('\\', "/");
    if normalized.starts_with("//wsl.localhost/")
        || normalized.starts_with("//wsl$/")
    {
        "WSL"
    } else {
        "Windows"
    }
}

pub fn scan_workspace(path: &str) -> Result<Vec<Project>, AppError> {
    let entries = std::fs::read_dir(path)
        .map_err(|_| AppError::DirAccess(path.to_string()))?;

    let fs_type = detect_file_system(path).to_string();

    let mut projects: Vec<Project> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let file_type = entry.file_type().ok()?;
            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden folders (.git, .vscode, .cache, ...) — they are
                // never projects and only clutter the list.
                if name.starts_with('.') {
                    return None;
                }
                let full_path = entry.path().to_string_lossy().to_string();
                Some(Project::new(
                    name,
                    full_path,
                    path.to_string(),
                    fs_type.clone(),
                ))
            } else {
                None
            }
        })
        .collect();

    projects.sort_by_key(|p| p.name.to_lowercase());
    Ok(projects)
}
