use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::platform::RuntimeInfo;
use crate::models::target::TargetKind;

pub const DEFAULT_SUMMON_HOTKEY: &str = "Ctrl+Alt+Space";

// past 60% see-through the text sits on whatever window is behind devgo
// with only the blur between them, and the contrast gate, which measures
// ink on the opaque token, has nothing left to say
pub const MAX_TRANSPARENCY: u8 = 60;

pub fn clamp_transparency(percent: u8) -> u8 {
    percent.min(MAX_TRANSPARENCY)
}

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

// the three windows a WSL launch has always opened, and since psmux a
// windows launch too, same names, same order, so an upgrade into this
// setting is invisible
fn default_window_names() -> Vec<String> {
    ["code", "agents", "git"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

// bool::default() is false, and that would switch tmux off for every
// existing install on upgrade
fn default_enabled() -> bool {
    true
}

/// The windows a terminal launch opens, in order: tmux inside the distro
/// for a WSL project, psmux for a Windows one. One list, not a parallel
/// PsmuxConfig: nobody wants code/agents/git on one half of the machine
/// and something else on the other, and two lists drift. Still called
/// tmux because that is what prefs.json already says. A name list, not a
/// count: "how many" would produce code, agents, git, window4, window5.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TmuxConfig {
    /// Off means one plain shell in the project directory, no multiplexer
    /// on either side.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_window_names")]
    pub window_names: Vec<String>,
}

impl Default for TmuxConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            window_names: default_window_names(),
        }
    }
}

/// A monitor as (x, y, width, height).
pub type MonitorRect = (i32, i32, u32, u32);

// below this the rect is a placeholder something wrote, not a window
// somebody left
const MIN_RESTORE_W: u32 = 320;
const MIN_RESTORE_H: u32 = 240;

impl WindowState {
    /// Does this rect look like a maximized window rather than a restored
    /// one? Maximizing is not atomic: a Resized arrives while is_maximized()
    /// still says false, and the screen-filling rect would be stored as the
    /// restore rect. Windows overhangs a maximized window by its invisible
    /// border, hence the slack.
    pub fn covers_a_monitor(&self, monitors: &[MonitorRect]) -> bool {
        const SLACK: i32 = 24;
        monitors.iter().any(|&(_, _, mw, mh)| {
            (self.width as i32 - mw as i32).abs() <= SLACK
                && (self.height as i32 - mh as i32).abs() <= SLACK * 4
        })
    }

    /// Could a person have left the window here? A minimized window reports
    /// (-32000, -32000) at about 144x19, and a monitor can be unplugged; a
    /// rect that fails either check strands the window off every screen,
    /// with a taskbar entry and nothing to click.
    pub fn is_restorable(&self, monitors: &[MonitorRect]) -> bool {
        if self.width < MIN_RESTORE_W || self.height < MIN_RESTORE_H {
            return false;
        }
        if monitors.is_empty() {
            // no monitor info: the size check alone, rather than refusing
            // every restore
            return true;
        }
        // a real overlap, not a shared edge: one pixel on screen is not
        // reachable in any useful sense
        const MARGIN: i32 = 80;
        let (l, t) = (self.x, self.y);
        let (r, b) = (l + self.width as i32, t + self.height as i32);
        monitors.iter().any(|&(mx, my, mw, mh)| {
            let (mr, mb) = (mx + mw as i32, my + mh as i32);
            let ox = r.min(mr) - l.max(mx);
            let oy = b.min(mb) - t.max(my);
            ox >= MARGIN && oy >= MARGIN
        })
    }
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
    pub default_agent: Option<String>,
    #[serde(default)]
    pub scan_config: ScanConfig,
    /// Absent means the three windows that were hardcoded before this was
    /// configurable. `serde(default)` again keeps an older prefs.json out of
    /// `.bak`.
    #[serde(default)]
    pub tmux_config: TmuxConfig,
    /// None until the window is first moved or resized; absent means open
    /// maximized. `serde(default)` keeps an older prefs.json out of `.bak`.
    #[serde(default)]
    pub window_state: Option<WindowState>,
    /// Which GitHub organisations the lane lists beside the user's own
    /// repos. None, the default and every prefs.json from before this
    /// field, means every org gh finds; Some(list) is a choice made in
    /// Settings, kept even when empty. `serde(default)` for the same
    /// reason as every field above it.
    #[serde(default)]
    pub github_orgs: Option<Vec<String>>,
    /// Named groups inside the GitHub list, in the user's order. Labels
    /// over full_names; see services::groups. `serde(default)`, as above.
    #[serde(default)]
    pub github_groups: Vec<super::groups::GithubGroup>,
    /// Whether the GitHub box also asks GitHub, live, as you type.
    /// Default off: this is the one place a keystroke becomes a network
    /// call, and it is opted into, never inherited by an upgrade.
    #[serde(default)]
    pub github_live_search: bool,
    /// How see-through the window is, 0 to MAX_TRANSPARENCY percent. 0,
    /// the serde default so every prefs.json before this field stays
    /// opaque, applies no effect at all: no acrylic, no compositing cost.
    #[serde(default)]
    pub window_transparency: u8,
    /// Whether a server row prints user@host and the port. Off, the
    /// default, the lane shows the name only: a screenshot of the window
    /// is not a list of where you ssh. `serde(default)`, as above.
    #[serde(default)]
    pub show_server_details: bool,
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

    pub fn window_transparency(&self) -> u8 {
        clamp_transparency(self.prefs.window_transparency)
    }

    // stored clamped, so a hand-edited 90 reads back as the cap and the
    // file says what the window does
    pub fn set_window_transparency(
        &mut self,
        percent: u8,
    ) -> Result<(), String> {
        self.prefs.window_transparency = clamp_transparency(percent);
        self.save()
    }

    pub fn show_server_details(&self) -> bool {
        self.prefs.show_server_details
    }

    pub fn set_show_server_details(&mut self, on: bool) -> Result<(), String> {
        self.prefs.show_server_details = on;
        self.save()
    }

    pub fn default_target(&self, kind: TargetKind) -> Option<String> {
        match kind {
            TargetKind::Editor => self.prefs.default_editor.clone(),
            TargetKind::Terminal => self.prefs.default_terminal.clone(),
            TargetKind::Agent => self.prefs.default_agent.clone(),
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
            TargetKind::Agent => {
                self.prefs.default_agent = Some(id.to_string())
            }
        }
        self.save()
    }

    pub fn tmux_config(&self) -> TmuxConfig {
        self.prefs.tmux_config.clone()
    }

    /// Trim, drop blanks, de-duplicate here rather than in the panel: the
    /// panel is not the only way in (the command, import, a hand edit). A
    /// blank name reaches `tmux new-window -n ''`, tmux renames it `bash`, the
    /// name is never found, and a window is appended on every launch.
    pub fn set_tmux_config(
        &mut self,
        mut config: TmuxConfig,
    ) -> Result<(), String> {
        let mut seen: Vec<String> = Vec::new();
        for name in &config.window_names {
            let trimmed = name.trim();
            if !trimmed.is_empty() && !seen.iter().any(|s| s == trimmed) {
                seen.push(trimmed.to_string());
            }
        }
        config.window_names = seen;
        self.prefs.tmux_config = config;
        self.save()
    }

    pub fn github_orgs(&self) -> Option<Vec<String>> {
        self.prefs.github_orgs.clone()
    }

    pub fn set_github_orgs(
        &mut self,
        orgs: Option<Vec<String>>,
    ) -> Result<(), String> {
        self.prefs.github_orgs = orgs;
        self.save()
    }

    pub fn github_live_search(&self) -> bool {
        self.prefs.github_live_search
    }

    pub fn set_github_live_search(&mut self, on: bool) -> Result<(), String> {
        self.prefs.github_live_search = on;
        self.save()
    }

    pub fn github_groups(&self) -> Vec<super::groups::GithubGroup> {
        self.prefs.github_groups.clone()
    }

    pub fn set_github_groups(
        &mut self,
        groups: Vec<super::groups::GithubGroup>,
    ) -> Result<(), String> {
        self.prefs.github_groups = groups;
        self.save()
    }

    pub fn window_state(&self) -> Option<WindowState> {
        self.prefs.window_state.clone()
    }

    /// Drop writes that change nothing: a drag emits one event per frame,
    /// and each save is a full serialize.
    pub fn set_window_state(
        &mut self,
        state: WindowState,
    ) -> Result<(), String> {
        if self.prefs.window_state.as_ref() == Some(&state) {
            return Ok(());
        }
        self.prefs.window_state = Some(state);
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
        let wsl = r"\\wsl.localhost\Ubuntu\home\user\projects\api";
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
        assert_eq!(
            s.window_transparency(),
            0,
            "an old prefs.json loads opaque"
        );
    }

    #[test]
    fn transparency_is_clamped() {
        assert_eq!(clamp_transparency(0), 0);
        assert_eq!(clamp_transparency(35), 35);
        assert_eq!(clamp_transparency(90), MAX_TRANSPARENCY);
        assert_eq!(clamp_transparency(255), MAX_TRANSPARENCY);
    }

    #[test]
    fn set_transparency_stores_the_clamped_value() {
        let dir = std::env::temp_dir().join("devgo-prefs-test-transparency");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut s = PreferencesStore::new(dir.clone()).unwrap();
        s.set_window_transparency(90).unwrap();
        assert_eq!(s.window_transparency(), MAX_TRANSPARENCY);

        let again = PreferencesStore::new(dir).unwrap();
        assert_eq!(
            again.window_transparency(),
            MAX_TRANSPARENCY,
            "the file holds the cap, not 90"
        );
    }

    /// A prefs.json from before this field keeps the lane quiet, and the
    /// switch survives a relaunch.
    #[test]
    fn server_details_are_hidden_until_asked() {
        let dir = std::env::temp_dir().join("devgo-prefs-test-server-details");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("prefs.json"), r#"{"window_transparency":30}"#)
            .unwrap();

        let mut s = PreferencesStore::new(dir.clone()).unwrap();
        assert!(!s.show_server_details(), "the name only, by default");
        s.set_show_server_details(true).unwrap();

        let again = PreferencesStore::new(dir).unwrap();
        assert!(again.show_server_details());
        assert_eq!(again.window_transparency(), 30, "the rest untouched");
    }

    #[test]
    fn window_state_round_trips() {
        let dir = std::env::temp_dir().join("devgo-prefs-test-window");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut s = PreferencesStore::new(dir.clone()).unwrap();
        assert!(s.window_state().is_none(), "fresh install opens maximized");
        let state = WindowState {
            maximized: false,
            width: 1200,
            height: 800,
            x: 40,
            y: 60,
        };
        s.set_window_state(state.clone()).unwrap();

        let reloaded = PreferencesStore::new(dir).unwrap();
        assert_eq!(reloaded.window_state(), Some(state));
    }

    #[test]
    fn same_window_state_does_not_write() {
        let dir = std::env::temp_dir().join("devgo-prefs-test-nowrite");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut s = PreferencesStore::new(dir.clone()).unwrap();
        let state = WindowState::default();
        s.set_window_state(state.clone()).unwrap();
        fs::remove_file(dir.join("prefs.json")).unwrap();

        s.set_window_state(state).unwrap();
        assert!(!dir.join("prefs.json").exists(), "same rect, no write");
    }

    fn rect(width: u32, height: u32, x: i32, y: i32) -> WindowState {
        WindowState {
            maximized: false,
            width,
            height,
            x,
            y,
        }
    }

    const THREE_SCREENS: [MonitorRect; 3] = [
        (0, 0, 2560, 1440),
        (-1920, 360, 1920, 1080),
        (2560, 0, 2560, 1440),
    ];

    /// The poisoned config, byte for byte: a minimized window's placeholder
    /// rect, saved, restored a window with a taskbar entry and no screen.
    #[test]
    fn the_minimized_placeholder_rect_is_never_restored() {
        let poisoned = rect(144, 19, -32000, -32000);
        assert!(!poisoned.is_restorable(&THREE_SCREENS));
        assert!(!poisoned.is_restorable(&[]), "size alone condemns it");
    }

    /// The second poisoned value: maximized true with a 2560x1392 restore
    /// rect on a 2560x1440 screen, written during the maximize transition.
    #[test]
    fn a_screen_sized_rect_is_a_maximize_artefact() {
        let screens = &THREE_SCREENS[..2];
        assert!(rect(2560, 1392, -8, -8).covers_a_monitor(screens));
        assert!(
            rect(1920, 1040, -1920, 360).covers_a_monitor(screens),
            "the smaller monitor's full size counts too"
        );
    }

    #[test]
    fn an_ordinary_window_is_not_a_maximize_artefact() {
        let screens = &THREE_SCREENS[..1];
        for (w, h) in [(900, 720), (1400, 900), (2000, 1200), (2400, 1000)] {
            assert!(
                !rect(w, h, 100, 100).covers_a_monitor(screens),
                "{w}x{h} is a real window size"
            );
        }
    }

    #[test]
    fn a_normal_window_on_any_monitor_is_restorable() {
        for (x, y, on) in [
            (830, 336, "primary"),
            (-1600, 500, "the monitor to the left"),
            (3000, 200, "the monitor to the right"),
        ] {
            assert!(
                rect(900, 720, x, y).is_restorable(&THREE_SCREENS),
                "should restore on {on}"
            );
        }
    }

    /// Unplugging the monitor a window was left on must not strand it.
    #[test]
    fn a_window_on_a_monitor_that_is_gone_is_refused() {
        let only_primary = &THREE_SCREENS[..1];
        assert!(!rect(900, 720, -1600, 500).is_restorable(only_primary));
    }

    #[test]
    fn a_window_barely_touching_a_screen_edge_is_refused() {
        let only_primary = &THREE_SCREENS[..1];
        assert!(
            !rect(900, 720, -880, 100).is_restorable(only_primary),
            "only 20px on screen"
        );
    }

    /// Every prefs.json in the wild predates tmux_config; the other fields
    /// surviving is what makes a lost serde default loud here, not on
    /// someone's machine.
    #[test]
    fn a_config_from_before_tmux_windows_still_loads() {
        let dir = std::env::temp_dir().join("devgo-prefs-test-pre-tmux");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("prefs.json"),
            r#"{"pinned":["G:\\ws\\api"],"summon_hotkey":"Ctrl+Alt+D",
                "scan_config":{"ignore":["node_modules"],"depth":2}}"#,
        )
        .unwrap();

        let s = PreferencesStore::new(dir.clone()).unwrap();
        assert_eq!(s.tmux_config(), TmuxConfig::default());
        assert_eq!(s.pinned(), vec![r"G:\ws\api".to_string()]);
        assert_eq!(s.summon_hotkey(), "Ctrl+Alt+D");
        assert!(!dir.join("prefs.json.bak").exists(), "nothing quarantined");
    }

    #[test]
    fn a_window_list_is_cleaned_on_the_way_in() {
        let mut s = store("tmux-normalise");
        let names = ["  code  ", "", "   ", "agents", "code", "\tgit\n"];
        s.set_tmux_config(TmuxConfig {
            enabled: true,
            window_names: names.iter().map(|n| n.to_string()).collect(),
        })
        .unwrap();
        assert_eq!(
            s.tmux_config().window_names,
            vec!["code".to_string(), "agents".to_string(), "git".to_string()],
            "trimmed, blanks dropped, duplicates gone, order kept"
        );

        // an empty list survives as empty: "no named windows" is an answer,
        // and restoring the default would make it unsettable
        s.set_tmux_config(TmuxConfig {
            enabled: true,
            window_names: vec![" ".into()],
        })
        .unwrap();
        assert!(s.tmux_config().window_names.is_empty());
    }

    /// A prefs.json from before this field must load, not go to .bak.
    #[test]
    fn prefs_without_window_state_still_load() {
        let dir = std::env::temp_dir().join("devgo-prefs-test-old");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("prefs.json"), r#"{"pinned":["G:\\a"]}"#).unwrap();

        let s = PreferencesStore::new(dir.clone()).unwrap();
        assert_eq!(s.pinned(), vec![r"G:\a".to_string()]);
        assert!(s.window_state().is_none());
        assert!(!dir.join("prefs.json.bak").exists(), "nothing to back up");
    }
}
