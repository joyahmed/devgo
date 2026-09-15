use std::path::Path;

use serde::de::DeserializeOwned;

// every store used to unwrap_or_default on parse, so a truncated or
// hand-edited file read as empty defaults and the next save wrote those
// over the original. same class of bug as the cache invariant: never
// overwrite what you could not read. a plain write, not a rename, so a
// second corruption still gets a backup; best effort, never a reason not
// to start
pub fn parse_or_backup<T: DeserializeOwned + Default>(
    path: &Path,
    data: &str,
) -> T {
    match serde_json::from_str(data) {
        Ok(value) => value,
        Err(_) => {
            let backup = format!("{}.bak", path.display());
            let _ = std::fs::write(&backup, data);
            T::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_file_is_backed_up_not_lost() {
        let dir = std::env::temp_dir().join("devgo-config-io-corrupt");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("prefs.json");

        let corrupt = "{ not valid json";
        let value: Vec<String> = parse_or_backup(&path, corrupt);

        assert!(value.is_empty(), "a corrupt file yields the default");
        let backup =
            std::fs::read_to_string(dir.join("prefs.json.bak")).unwrap();
        assert_eq!(backup, corrupt, "the original is in .bak, not lost");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A guard that writes a backup on every start is noise.
    #[test]
    fn valid_file_parses_without_a_backup() {
        let dir = std::env::temp_dir().join("devgo-config-io-valid");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("workspaces.json");

        let value: Vec<String> = parse_or_backup(&path, r#"["a","b"]"#);
        assert_eq!(value, vec!["a".to_string(), "b".to_string()]);
        assert!(!dir.join("workspaces.json.bak").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
