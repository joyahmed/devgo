use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::platform::RuntimeInfo;
use crate::models::target::TargetKind;

pub const DEFAULT_SUMMON_HOTKEY: &str = "Ctrl+Alt+Space";

/// How often and how recently a project has been launched.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectStat {
    pub launch_count: u32,
    pub last_opened: u64,
}

/// Where the window was left. The rect is always the restored one: while
/// maximized the window is the screen, and saving that would hand the
/// restore button a screen-sized window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    pub maximized: bool,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

// the configured 900x720, so a maximized window that was never restored
// has somewhere to go
impl Default for WindowState {
    fn default() -> Self {
        Self {
            maximized: false,
            width: 900,
            height: 720,
            x: 0,
            y: 0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Preferences {
    pub last_project_path: Option<String>,
    pub last_workspace: Option<String>,
    /// Startup reads this instead of shelling out to wsl.exe. Detection calls
    /// `wsl -l -q` and `wsl -l -v`, which hit WSLService — the service whose
    /// timeouts this work exists to stop provoking.
    pub cached_runtime: Option<RuntimeInfo>,
    /// Launch history keyed by `Project::full_path`, used for frecency ranking.
    #[serde(default)]
    pub project_stats: HashMap<String, ProjectStat>,
    /// Pinned project paths, kept as a Vec so the on-disk order is stable and
    /// diffable rather than reshuffling on every write.
    #[serde(default)]
    pub pinned: Vec<String>,
    /// None means "use the default"; storing it explicitly only once the user
    /// changes it keeps prefs.json honest about what was actually chosen.
    #[serde(default)]
    pub summon_hotkey: Option<String>,
    /// Chosen editor / terminal, by target id. Stored by id rather than name so
    /// renaming a target does not orphan the default.
    #[serde(default)]
    pub default_editor: Option<String>,
    #[serde(default)]
    pub default_terminal: Option<String>,
    #[serde(default)]
    pub scan_config: ScanConfig,
    /// None until the window is first moved or resized; absent means open
    /// maximized. `serde(default)` keeps an older prefs.json out of `.bak`.
    #[serde(default)]
    pub window_state: Option<WindowState>,
}

// bare names, not globs: a cheap comparison on the listing the scan already has
fn default_ignore() -> Vec<String> {
    ["node_modules", "archive", "vendor"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

fn default_depth() -> usize {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    #[serde(default = "default_ignore")]
    pub ignore: Vec<String>,
    /// 1 is the one-level scan: every immediate child is a project. Above
    /// 1, nested folders that carry a marker are projects too.
    #[serde(default = "default_depth")]
    pub depth: usize,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            ignore: default_ignore(),
            depth: default_depth(),
        }
    }
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
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
            // a corrupt file goes to .bak, not under the next save
            super::config_io::parse_or_backup(&file_path, &data)
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

    pub fn project_stats(&self) -> HashMap<String, ProjectStat> {
        self.prefs.project_stats.clone()
    }

    /// Record that a project was just launched. Called from every launch path,
    /// so opening the same project three ways in a row counts three times —
    /// which is the honest signal, since each was a deliberate act.
    pub fn record_launch(&mut self, full_path: &str) -> Result<(), String> {
        let entry = self
            .prefs
            .project_stats
            .entry(full_path.to_string())
            .or_default();
        entry.launch_count = entry.launch_count.saturating_add(1);
        entry.last_opened = now_secs();
        self.save()
    }

    pub fn pinned(&self) -> Vec<String> {
        self.prefs.pinned.clone()
    }

    pub fn toggle_pin(&mut self, full_path: &str) -> Result<bool, String> {
        let pinned = match self.prefs.pinned.iter().position(|p| p == full_path)
        {
            Some(i) => {
                self.prefs.pinned.remove(i);
                false
            }
            None => {
                self.prefs.pinned.push(full_path.to_string());
                true
            }
        };
        self.save()?;
        Ok(pinned)
    }

    /// Drop stats and pins for projects gone from a workspace read live this
    /// pass. Anything under a workspace served from cache or unavailable is
    /// kept: a stopped distro must not erase its own history.
    pub fn retain_known(
        &mut self,
        live_paths: &[String],
        live_roots: &[String],
    ) -> Result<(), String> {
        // slash-normalise so a root prefix-matches its projects on both sides
        let norm =
            |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
        let roots: Vec<String> = live_roots.iter().map(|r| norm(r)).collect();
        let known: HashSet<String> =
            live_paths.iter().map(|p| norm(p)).collect();
        let keep = |path: &str| {
            let p = norm(path);
            known.contains(&p)
                || !roots
                    .iter()
                    .any(|r| p == *r || p.starts_with(&format!("{r}/")))
        };

        let before = (self.prefs.project_stats.len(), self.prefs.pinned.len());
        self.prefs.project_stats.retain(|path, _| keep(path));
        self.prefs.pinned.retain(|path| keep(path));
        if before != (self.prefs.project_stats.len(), self.prefs.pinned.len()) {
            self.save()?;
        }
        Ok(())
    }

    pub fn summon_hotkey(&self) -> String {
        self.prefs
            .summon_hotkey
            .clone()
            .unwrap_or_else(|| DEFAULT_SUMMON_HOTKEY.to_string())
    }

    pub fn set_summon_hotkey(
        &mut self,
        accelerator: Option<String>,
    ) -> Result<(), String> {
        self.prefs.summon_hotkey = accelerator;
        self.save()
    }

    pub fn default_target(&self, kind: TargetKind) -> Option<String> {
        match kind {
            TargetKind::Editor => self.prefs.default_editor.clone(),
            TargetKind::Terminal => self.prefs.default_terminal.clone(),
        }
    }

    pub fn set_default_target(
        &mut self,
        kind: TargetKind,
        id: &str,
    ) -> Result<(), String> {
        match kind {
            TargetKind::Editor => {
                self.prefs.default_editor = Some(id.to_string())
            }
            TargetKind::Terminal => {
                self.prefs.default_terminal = Some(id.to_string())
            }
        }
        self.save()
    }

    pub fn scan_config(&self) -> ScanConfig {
        self.prefs.scan_config.clone()
    }

    pub fn set_scan_config(
        &mut self,
        config: ScanConfig,
    ) -> Result<(), String> {
        self.prefs.scan_config = config;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> PreferencesStore {
        let dir = std::env::temp_dir().join(format!("devgo-prefs-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        PreferencesStore::new(dir).unwrap()
    }

    #[test]
    fn record_launch_counts_and_stamps() {
        let mut s = store("record");
        s.record_launch(r"G:\a").unwrap();
        s.record_launch(r"G:\a").unwrap();
        s.record_launch(r"G:\b").unwrap();

        let stats = s.project_stats();
        assert_eq!(stats[r"G:\a"].launch_count, 2);
        assert_eq!(stats[r"G:\b"].launch_count, 1);
        assert!(stats[r"G:\a"].last_opened > 0, "launch must be timestamped");
    }

    #[test]
    fn launches_survive_a_reload() {
        let dir = std::env::temp_dir().join("devgo-prefs-test-reload");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut s = PreferencesStore::new(dir.clone()).unwrap();
        s.record_launch(r"G:\a").unwrap();
        s.toggle_pin(r"G:\a").unwrap();

        let reloaded = PreferencesStore::new(dir).unwrap();
        assert_eq!(reloaded.project_stats()[r"G:\a"].launch_count, 1);
        assert_eq!(reloaded.pinned(), vec![r"G:\a".to_string()]);
    }

    #[test]
    fn toggle_pin_round_trips() {
        let mut s = store("pin");
        assert!(s.toggle_pin(r"G:\a").unwrap(), "first toggle pins");
        assert_eq!(s.pinned(), vec![r"G:\a".to_string()]);
        assert!(!s.toggle_pin(r"G:\a").unwrap(), "second toggle unpins");
        assert!(s.pinned().is_empty());
    }

    #[test]
    fn retain_known_prunes_vanished_projects() {
        let mut s = store("retain");
        s.record_launch(r"G:\ws\gone").unwrap();
        s.record_launch(r"G:\ws\here").unwrap();
        s.toggle_pin(r"G:\ws\gone").unwrap();

        s.retain_known(&[r"G:\ws\here".to_string()], &[r"G:\ws".to_string()])
            .unwrap();

        assert!(!s.project_stats().contains_key(r"G:\ws\gone"));
        assert!(s.project_stats().contains_key(r"G:\ws\here"));
        assert!(
            s.pinned().is_empty(),
            "pin for a vanished project is dropped"
        );
    }

    #[test]
    fn retain_known_keeps_workspaces_not_read_live() {
        let mut s = store("retain-cached");
        let wsl = r"\\wsl.localhost\Ubuntu\home\joy\projects\api";
        s.record_launch(wsl).unwrap();
        s.toggle_pin(wsl).unwrap();
        s.record_launch(r"G:\ws\here").unwrap();

        // the distro is stopped: only G:\ws was read this pass
        s.retain_known(&[r"G:\ws\here".to_string()], &[r"G:\ws".to_string()])
            .unwrap();

        assert!(s.project_stats().contains_key(wsl), "history survives");
        assert_eq!(s.pinned(), vec![wsl.to_string()], "pin survives");
    }

    /// The hotkey is read through a getter that falls back to the default, so
    /// a prefs.json that never mentions it still summons.
    #[test]
    fn hotkey_defaults_when_unset() {
        let s = store("hotkey");
        assert_eq!(s.summon_hotkey(), DEFAULT_SUMMON_HOTKEY);
    }
}
