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
