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

    /// The whole list, not "move index 3 to 1": a client that sends the
    /// full order saw the full list, and that claim can be checked. An
    /// order that is not a permutation of what is stored comes from a
    /// stale view, and obeying it would drop the workspace the client
    /// never saw. Same rule as remove: not honoured exactly is an error.
    /// Compared through the normalisation add uses, so forward slashes
    /// still name the same workspace.
    pub fn reorder(&mut self, order: Vec<String>) -> Result<(), AppError> {
        let norm = |p: &str| super::platform::paths::normalize(p);
        let mut have: Vec<String> =
            self.workspaces.iter().map(|w| norm(w)).collect();
        let mut want: Vec<String> = order.iter().map(|w| norm(w)).collect();
        have.sort();
        want.sort();
        if have != want {
            return Err(AppError::WorkspaceOrderMismatch(
                order.len(),
                self.workspaces.len(),
            ));
        }
        // the stored spelling stays; only the positions change
        let reordered = order
            .iter()
            .map(|o| {
                let key = norm(o);
                self.workspaces
                    .iter()
                    .find(|w| norm(w) == key)
                    .cloned()
                    .unwrap_or_else(|| o.clone())
            })
            .collect();
        self.workspaces = reordered;
        self.save()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> WorkspaceStore {
        let dir = std::env::temp_dir().join(format!("devgo-ws-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        WorkspaceStore::new(dir).unwrap()
    }

    #[test]
    fn removing_out_of_range_is_an_error_not_a_silent_success() {
        let mut s = store("range");
        s.add(r"G:\dev").unwrap();

        assert!(
            s.remove(5).is_err(),
            "a stale index must not report success"
        );
        assert_eq!(s.list().len(), 1, "nothing may be removed on a bad index");

        s.remove(0).unwrap();
        assert!(s.list().is_empty());
    }

    #[test]
    fn re_adding_the_same_workspace_is_a_no_op_not_an_error() {
        let mut s = store("dupe");
        s.add(r"G:\dev").unwrap();
        s.add(r"G:/dev").unwrap();
        s.add(r"G:\dev\").unwrap();
        assert_eq!(
            s.list().len(),
            1,
            "separator and trailing slash must not fool it"
        );
    }

    /// The bug behind "I removed the workspace and its projects are still
    /// there": two overlapping roots scan the same folders.
    #[test]
    fn a_workspace_inside_another_is_refused_either_way_round() {
        let mut s = store("nested-child");
        s.add(r"\\wsl.localhost\Ubuntu\home\user\projects\03_ai")
            .unwrap();
        assert!(
            s.add(
                r"\\wsl.localhost\Ubuntu\home\user\projects\03_ai\palimpsest"
            )
            .is_err(),
            "a child of an existing workspace must be refused"
        );

        let mut s = store("nested-parent");
        s.add(r"G:\dev\apps").unwrap();
        assert!(s.add(r"G:\dev").is_err(), "a parent must be refused too");
        assert_eq!(s.list(), vec![r"G:\dev\apps".to_string()]);
    }

    /// Without the separator in `contains`, this pair would be rejected.
    #[test]
    fn a_sibling_with_a_shared_prefix_is_not_nested() {
        let mut s = store("prefix");
        s.add(r"G:\dev").unwrap();
        s.add(r"G:\devtools").unwrap();
        assert_eq!(s.list().len(), 2, "G:\\devtools is not inside G:\\dev");
    }

    /// A client reordering from a stale list: obeying its order would drop
    /// the workspace it never saw.
    #[test]
    fn reorder_refuses_anything_that_is_not_a_permutation() {
        let mut s = store("reorder-refuse");
        s.add(r"G:\dev").unwrap();
        s.add(r"G:\work").unwrap();
        s.add(r"G:\play").unwrap();

        // missing one
        assert!(s
            .reorder(vec![r"G:\work".into(), r"G:\dev".into()])
            .is_err());
        // one extra
        assert!(s
            .reorder(vec![
                r"G:\work".into(),
                r"G:\dev".into(),
                r"G:\play".into(),
                r"G:\new".into()
            ])
            .is_err());
        // a stranger with the right count
        assert!(s
            .reorder(vec![
                r"G:\work".into(),
                r"G:\dev".into(),
                r"G:\other".into()
            ])
            .is_err());
        assert_eq!(
            s.list(),
            vec![r"G:\dev", r"G:\work", r"G:\play"],
            "a refused reorder changes nothing"
        );
    }

    #[test]
    fn reorder_applies_a_permutation_and_persists_it() {
        let dir = std::env::temp_dir().join("devgo-ws-test-reorder-ok");
        let _ = fs::remove_dir_all(&dir);
        let mut s = WorkspaceStore::new(dir.clone()).unwrap();
        s.add(r"G:\dev").unwrap();
        s.add(r"G:\work").unwrap();
        s.add(r"G:\play").unwrap();

        // forward slashes and a trailing one: still the same workspaces
        s.reorder(vec!["G:/play/".into(), r"G:\dev".into(), "G:/work".into()])
            .unwrap();
        assert_eq!(
            s.list(),
            vec![r"G:\play", r"G:\dev", r"G:\work"],
            "positions change, the stored spelling does not"
        );

        let again = WorkspaceStore::new(dir).unwrap();
        assert_eq!(again.list(), vec![r"G:\play", r"G:\dev", r"G:\work"]);
    }

    #[test]
    fn workspaces_survive_a_reload() {
        let dir = std::env::temp_dir().join("devgo-ws-test-reload");
        let _ = fs::remove_dir_all(&dir);
        let mut s = WorkspaceStore::new(dir.clone()).unwrap();
        s.add(r"G:\dev").unwrap();

        let reloaded = WorkspaceStore::new(dir).unwrap();
        assert_eq!(reloaded.list(), vec![r"G:\dev".to_string()]);
    }
}
