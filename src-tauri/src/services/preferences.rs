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

/// A monitor and the part of it a window is allowed to fill. `full` is the
/// panel; `work` is the panel minus whatever the platform reserves — the
/// Windows taskbar, the macOS menu bar and dock. Both come from the
/// platform, because that reserved strip is not a number this code can
/// guess: it is 0 with the taskbar auto-hidden, ~48px at 100% scale, ~96px
/// at 200%, and ~25px of menu bar plus up to ~90px of dock on a mac.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Screen {
    pub full: MonitorRect,
    pub work: MonitorRect,
}

// below this the rect is a placeholder something wrote, not a window
// somebody left
const MIN_RESTORE_W: u32 = 320;
const MIN_RESTORE_H: u32 = 240;

impl WindowState {
    /// Does this rect look like a maximized window rather than a restored
    /// one? Maximizing is not atomic: a Resized arrives while is_maximized()
    /// still says false, and the screen-filling rect would be stored as the
    /// restore rect. So the question is asked of the geometry, not of
    /// is_maximized() — inside the branch that calls this, is_maximized()
    /// has already said false, which is exactly the answer this cannot
    /// trust.
    ///
    /// A maximized window fills the **work area**; a full-screen one fills
    /// the **panel**. Both are compared, both with the same tight slack,
    /// because the only fuzziness left is the frame itself: Windows
    /// overhangs a maximized window by its invisible border, and edges
    /// round. The reserved strip — taskbar, menu bar, dock — is not in the
    /// slack any more; `work` already accounts for it. The recorded
    /// artefact, 2560x1392 at (-8, -8) on the 2560x1440 screen these docs
    /// are shot on, is the work area exactly: a 48px Windows 11 taskbar at
    /// scale factor 1 leaves 2560x1392, which is why every maximized
    /// screenshot in `docs/` is that size. The -8 is the invisible border
    /// in the position, which this compares nothing against.
    ///
    /// It used to be: width within 24 of the panel AND height within 96 of
    /// it. That second band is wider than a mac's menu bar, so it was true
    /// for every ordinary macOS window, and an AND with a vacuous half is
    /// its other half alone — any window within 24px of the panel width
    /// lost every save, measured to the pixel on a 1920x1080 display at
    /// scale factor 1.
    ///
    /// ⚠️ The band stays symmetric even when the work area says nothing.
    /// A monitor can report `work == full`: a Mac **second display** shows
    /// no menu bar by default, `_HIHideMenuBar` with an auto-hidden Dock
    /// does it on the primary, an auto-hidden Windows taskbar does it, and
    /// Wayland has no work-area protocol for GDK to answer from. Then both
    /// arms test one rectangle and the chrome really is unknown. A wider
    /// height band for exactly that case was tried and reverted, because
    /// it cannot tell a maximized window from a near-maximized one — it
    /// only picks which way to fail. **The safe direction is to SAVE the
    /// user's rectangle, not to discard it.** Dropping a real resize is
    /// *silent* data loss: nothing on screen, nothing in the log, and the
    /// next launch quietly opens at the stale size. Storing a maximize
    /// artefact gives a screen-sized window the user can see and move.
    ///
    /// ⭐ And "only on degenerate monitors" is not a narrow exception:
    /// this is an `.any()` over every screen, so ONE degenerate secondary
    /// display would apply the wide band to a window on any screen. A
    /// 24-wide by 96-high band is what the paragraph above describes —
    /// vacuous for every ordinary macOS window — and confining it here
    /// only makes that silent drop conditional: on a blind 1920x1080,
    /// 1910x1000 (w 10, h 80) and 1897x1000 (w 23, h 80) are the measured
    /// pair that defined the bug, and both would be condemned again.
    ///
    /// The cost of the symmetric band, stated rather than buried: on a
    /// monitor that reports no work area, a genuine maximize artefact
    /// about a taskbar-height short of the panel — 2560x1392 on a blind
    /// 2560x1440, height delta 48 — is now SAVED rather than rejected.
    /// That is the accepted trade, not an oversight: a visible, movable
    /// full-size window beats a resize that vanishes without a trace.
    pub fn covers_a_monitor(&self, screens: &[Screen]) -> bool {
        // the frame's own slop, and nothing else
        const SLACK: i32 = 24;
        let fills = |(_, _, rw, rh): MonitorRect| {
            (self.width as i32 - rw as i32).abs() <= SLACK
                && (self.height as i32 - rh as i32).abs() <= SLACK
        };
        // no special case for `work == full`: both arms then test the same
        // rectangle against the same symmetric band, which is the right
        // answer for a monitor whose chrome nobody reported
        screens.iter().any(|s| fills(s.full) || fills(s.work))
    }

    /// Could a person have left the window here? A minimized window reports
    /// (-32000, -32000) at about 144x19, and a monitor can be unplugged; a
    /// rect that fails either check strands the window off every screen,
    /// with a taskbar entry and nothing to click.
    pub fn is_restorable(&self, screens: &[Screen]) -> bool {
        if self.width < MIN_RESTORE_W || self.height < MIN_RESTORE_H {
            return false;
        }
        if screens.is_empty() {
            // no monitor info: the size check alone, rather than refusing
            // every restore
            return true;
        }
        // a real overlap, not a shared edge: one pixel on screen is not
        // reachable in any useful sense
        const MARGIN: i32 = 80;
        let (l, t) = (self.x, self.y);
        let (r, b) = (l + self.width as i32, t + self.height as i32);
        screens.iter().any(|s| {
            let (mx, my, mw, mh) = s.full;
            let (mr, mb) = (mx + mw as i32, my + mh as i32);
            let ox = r.min(mr) - l.max(mx);
            let oy = b.min(mb) - t.max(my);
            ox >= MARGIN && oy >= MARGIN
        })
    }
}

/// One call the startup restore makes on the window. The restore is
/// expressed as data so its ORDER is testable: on a live window it is two
/// side effects with no return value, and the order was the bug.
// macOS is the only caller (`lib.rs`, behind its own cfg), but the tests run
// on every platform: the step order is pure data, and a Windows or Linux CI
// run asserting it is worth more than a lint silenced with `allow(dead_code)`.
// Without the `test` arm the lib target has no consumer off macOS and
// `clippy -D warnings` fails the build there while `cargo test` stays green —
// a red gate no macOS box can reproduce.
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestoreStep {
    Position { x: i32, y: i32 },
    Size { width: u32, height: u32 },
}

/// The restore, as data — macOS only, and position comes FIRST.
///
/// ⛔ The order is not cosmetic. macOS refuses to let a window extend past
/// the right edge of the region it is allowed to occupy, so `set_size` is
/// clamped to the distance from wherever the window currently sits to that
/// edge. Sized first, a 1910-wide rect asked for from x=234 came back 1686
/// wide (measured, 1920x1080 panel, scale factor 1); positioned first, the
/// window is at x=0 when the width is asked for and there is room for all
/// of it.
///
/// ⚠️ Ordering alone is not the whole fix: with Stage Manager on, macOS
/// rewrites the frame again when the window is first ordered on screen
/// (x pinned to the stage rect's left edge, width clamped to its width,
/// y untouched), which discards everything set while the window was still
/// hidden. That is why the caller applies these steps a second time once
/// the window is visible — see `lib.rs`. A window that is already on
/// screen keeps what these steps set.
#[cfg(any(target_os = "macos", test))]
pub fn macos_restore_steps(s: &WindowState) -> [RestoreStep; 2] {
    [
        RestoreStep::Position { x: s.x, y: s.y },
        RestoreStep::Size {
            width: s.width,
            height: s.height,
        },
    ]
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
    pub default_file_manager: Option<String>,
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
            TargetKind::FileManager => self.prefs.default_file_manager.clone(),
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
            TargetKind::FileManager => {
                self.prefs.default_file_manager = Some(id.to_string())
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

    /// Point every default at the row its target moved into: `moved` is
    /// (old id, new id), from TargetStore::adopt_one_row_per_program. A
    /// default naming a row that no longer exists would fall back to the
    /// first of its kind, a different program than the one chosen. The
    /// file it found is kept aside as prefs.json.pre-one-row-per-program,
    /// and only when a default actually moves.
    pub fn remap_default_targets(
        &mut self,
        moved: &[(String, String)],
    ) -> Result<(), String> {
        let p = &mut self.prefs;
        let mut changed = false;
        for slot in [
            &mut p.default_editor,
            &mut p.default_terminal,
            &mut p.default_agent,
            &mut p.default_file_manager,
        ] {
            let Some(id) = slot.as_ref() else { continue };
            if let Some((_, new)) = moved.iter().find(|(old, _)| old == id) {
                *slot = Some(new.clone());
                changed = true;
            }
        }
        if !changed {
            return Ok(());
        }
        if self.file_path.exists() {
            let backup =
                format!("{}.pre-one-row-per-program", self.file_path.display());
            fs::copy(&self.file_path, backup)
                .map_err(|e| format!("Failed to back up prefs: {e}"))?;
        }
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

    /// One row per program: a default naming a distro row that merged away
    /// follows it to the merged row, once, with the file it found kept
    /// aside byte for byte; a default that did not move is left alone and
    /// a pass with nothing to move writes nothing.
    #[test]
    fn defaults_follow_the_rows_that_merged_into_one_row_per_program() {
        let dir = std::env::temp_dir().join("devgo-prefs-test-one-row");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut s = PreferencesStore::new(dir.clone()).unwrap();
        s.set_default_target(TargetKind::Editor, "nvim-ubuntu-26-04")
            .unwrap();
        s.set_default_target(TargetKind::Terminal, "wt").unwrap();
        let file = dir.join("prefs.json");
        let original = fs::read(&file).unwrap();
        let moved = vec![
            ("nvim-ubuntu-26-04".to_string(), "nvim".to_string()),
            ("claude-ubuntu-26-04".to_string(), "claude".to_string()),
        ];
        s.remap_default_targets(&moved).unwrap();
        assert_eq!(
            s.default_target(TargetKind::Editor).as_deref(),
            Some("nvim")
        );
        assert_eq!(
            s.default_target(TargetKind::Terminal).as_deref(),
            Some("wt")
        );
        let backup = dir.join("prefs.json.pre-one-row-per-program");
        assert_eq!(fs::read(&backup).unwrap(), original);

        fs::remove_file(&backup).unwrap();
        let mut again = PreferencesStore::new(dir.clone()).unwrap();
        assert_eq!(
            again.default_target(TargetKind::Editor).as_deref(),
            Some("nvim")
        );
        again.remap_default_targets(&moved).unwrap();
        assert!(!backup.exists(), "nothing moved, nothing written");
        let _ = fs::remove_dir_all(&dir);
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

    /// Windows, scale factor 1, a 40px taskbar on the primary and on the
    /// monitor to the left: hence a work area 40px shorter than the panel.
    const THREE_SCREENS: [Screen; 3] = [
        Screen {
            full: (0, 0, 2560, 1440),
            work: (0, 0, 2560, 1400),
        },
        Screen {
            full: (-1920, 360, 1920, 1080),
            work: (-1920, 360, 1920, 1040),
        },
        Screen {
            full: (2560, 0, 2560, 1440),
            work: (2560, 0, 2560, 1400),
        },
    ];

    /// The mac the dropped saves were measured on: an M1 Max with ONE
    /// 1920x1080 display at **scale factor 1** — no Retina, no scaling at
    /// any point, so no unit mismatch anywhere. Deliberately scale 1: a
    /// scale-2 fixture would encode the mechanism the measurements
    /// DISPROVED and leave the case that actually bit the user untested.
    /// A 25px menu bar at the top and a dock out of the way, so a zoomed
    /// window fills 1920x1055 at (0, 25).
    const MAC_SCREEN: [Screen; 1] = [Screen {
        full: (0, 0, 1920, 1080),
        work: (0, 25, 1920, 1055),
    }];

    /// Laptop plus external, the common real setup and the one neither
    /// verifying box has the hardware for. `covers_a_monitor` is an
    /// `.any()` over every screen, so a second monitor is a second chance
    /// to trip the guard: a rect that is plainly a resize against the
    /// 2560x1440 panel is within 10px of the 1920x1080 one's width.
    const MIXED_SCREENS: [Screen; 2] = [
        Screen {
            full: (0, 0, 2560, 1440),
            work: (0, 0, 2560, 1400),
        },
        Screen {
            full: (2560, 180, 1920, 1080),
            work: (2560, 205, 1920, 1055),
        },
    ];

    /// A monitor that reports no work area at all: `work` is the panel,
    /// dimension for dimension. This is the DEFAULT on a Mac second
    /// display — no menu bar there, so `visibleFrame == frame` — and it
    /// also happens with `_HIHideMenuBar` plus an auto-hidden Dock on the
    /// primary, with an auto-hidden Windows taskbar, and under Wayland,
    /// which has no work-area protocol for GDK to answer from. So the case
    /// is reachable by configuration, not by exotic hardware, and
    /// `covers_a_monitor` is an `.any()`: one of these in the list decides
    /// for windows on every other screen too. A 1920x1080 panel at scale
    /// factor 1, like every fixture here.
    const BLIND_SCREEN: [Screen; 1] = [Screen {
        full: (0, 0, 1920, 1080),
        work: (0, 0, 1920, 1080),
    }];

    /// The screen the 2560x1392 artefact was recorded on, with the work
    /// area it really had: a 48px Windows 11 taskbar at scale factor 1
    /// leaves 2560x1392 of 2560x1440, which is why every maximized
    /// screenshot under `docs/` measures 2560x1392. So the artefact is the
    /// work area to the pixel — the work arm catches it at delta 0x0, and
    /// the panel arm never would (height delta 48). `THREE_SCREENS` keeps a
    /// 40px taskbar instead, where the same rect is delta 0x8: caught by
    /// the same arm, with slack to spare.
    const WIN_SCREEN: [Screen; 1] = [Screen {
        full: (0, 0, 2560, 1440),
        work: (0, 0, 2560, 1392),
    }];

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

    /// The five rows measured against installed v1.2.2 on the mac above,
    /// literally: each rect was asked for, the window became it, and
    /// prefs.json kept the previous one or did not. The old guard compared
    /// width against 24 and height against 96, and a mac window is
    /// permanently inside that height band — the menu bar guarantees it —
    /// so width decided alone and anything within 24px of the panel width
    /// lost every save.
    ///
    /// ⭐ 1897x1000 (w delta 23, inside) and 1895x1000 (delta 25, outside)
    /// are the regression test: the boundary sat exactly on SLACK=24, to
    /// the pixel, and 1897 saving is what says the guard no longer decides
    /// on width alone.
    #[test]
    fn a_full_width_mac_resize_is_not_a_maximize_artefact() {
        for (w, h, was) in [
            (1600, 1050, "saved before: w delta 320, outside the band"),
            (1910, 900, "saved before: h delta 180, outside the band"),
            (1910, 1000, "DROPPED before"),
            (1897, 1000, "DROPPED before: w delta 23, inside SLACK"),
            (1895, 1000, "saved before: w delta 25, just outside"),
        ] {
            assert!(
                !rect(w, h, 0, 30).covers_a_monitor(&MAC_SCREEN),
                "{w}x{h} is a resize somebody asked for ({was})"
            );
        }
    }

    /// Two monitors, two chances for `.any()` to condemn one save. The
    /// 1910x1000 window lives on the 2560x1440 panel, where it is plainly
    /// a resize; the guard must not reach over to the 1920x1080 one and
    /// call it an artefact because the widths nearly match there.
    #[test]
    fn a_second_monitor_must_not_condemn_a_resize_on_the_first() {
        assert!(
            !rect(1910, 1000, 100, 100).covers_a_monitor(&MIXED_SCREENS),
            "innocuous against monitor A, near-width against monitor B"
        );
        assert!(
            !rect(1897, 1000, 100, 100).covers_a_monitor(&MIXED_SCREENS),
            "the boundary case, with a second monitor to trip on"
        );
        assert!(
            rect(1920, 1055, 2560, 205).covers_a_monitor(&MIXED_SCREENS),
            "a real maximize on the second monitor is still an artefact"
        );
    }

    /// The other half of the same guard: on that mac a zoomed window fills
    /// the work area and a full-screen one fills the panel, and neither may
    /// become the restore rect.
    #[test]
    fn a_zoomed_or_full_screen_mac_window_is_still_an_artefact() {
        assert!(
            rect(1920, 1055, 0, 25).covers_a_monitor(&MAC_SCREEN),
            "the work area, filled: that is what zoom does"
        );
        assert!(
            rect(1920, 1080, 0, 0).covers_a_monitor(&MAC_SCREEN),
            "the whole panel: full screen, and is_maximized() says false"
        );
    }

    /// The shape of the bug as a rule, on Windows numbers so it holds on
    /// every platform: the two conditions are an AND, so a band loose
    /// enough to be true for every ordinary window leaves the other one
    /// deciding alone. Full panel width plus a height no reserved strip
    /// can explain is a resize, not a maximize.
    #[test]
    fn full_width_alone_does_not_condemn_a_save() {
        let screens = &THREE_SCREENS[..1];
        assert!(
            !rect(2560, 1100, 0, 0).covers_a_monitor(screens),
            "full width, 300px short: a resize"
        );
        assert!(
            rect(2560, 1392, -8, -8).covers_a_monitor(screens),
            "full width and the work area's height: the artefact"
        );
    }

    /// ⚠️ THE COST OF THE DECISION, ASSERTED SO IT CANNOT BE FORGOTTEN.
    /// `work == full`, so both arms test one rectangle and the symmetric
    /// 24 decides alone. A GNOME maximize race stores the panel width and
    /// the panel height less a ~32px top bar, and a Windows maximize
    /// artefact sits a 48px taskbar short of the panel: on a monitor that
    /// reported no chrome, BOTH ARE SAVED. That is deliberate. With the
    /// chrome unknown these rects are indistinguishable from a window
    /// somebody dragged to nearly full height, and the trade is taken in
    /// the direction that fails visibly — the user gets a screen-sized
    /// window they can see and move, instead of a resize that disappears
    /// with nothing on screen and nothing in the log. The alternative, a
    /// wide height band, was measured to condemn ordinary windows (see
    /// `a_vacuous_height_band_must_never_come_back`).
    #[test]
    fn a_maximize_race_on_a_blind_monitor_is_saved_on_purpose() {
        assert!(
            !rect(1920, 1048, 0, 32).covers_a_monitor(&BLIND_SCREEN),
            "h delta 32 with no reported chrome: saved, the accepted cost"
        );
        assert!(
            !rect(2560, 1392, -8, -8).covers_a_monitor(&[Screen {
                full: (0, 0, 2560, 1440),
                work: (0, 0, 2560, 1440),
            }]),
            "the shipped artefact on a blind screen: h delta 48, saved"
        );
    }

    /// ⭐⭐ THE REGRESSION GUARD FOR THIS WHOLE ARGUMENT. These two rows
    /// are the pair that defined the original bug, and they were verified
    /// a second time on a Mac against a 24-wide by 96-high band:
    ///
    ///   1910x1000  w delta 10 <= 24  h delta 80 <= 96  -> DROPPED
    ///   1897x1000  w delta 23 <= 24  h delta 80 <= 96  -> DROPPED
    ///
    /// A 96px height band is vacuous for every ordinary window, so an AND
    /// with a permanently-true half is its other half alone — width, which
    /// was never enough to condemn a save. Confining that band to monitors
    /// that report no work area does not make it safe, it makes the silent
    /// drop conditional, and via `.any()` a single degenerate secondary
    /// display reaches windows on every screen. So: if this test ever goes
    /// red, a vacuous height band has come back and the 2026 silent
    /// data-loss bug is back with it. Do not widen the band; the cautious
    /// direction is SAVE, not DISCARD.
    #[test]
    fn a_vacuous_height_band_must_never_come_back() {
        for (w, h, delta) in [
            (1910, 1000, "w 10, h 80: dropped by the old 24x96 band"),
            (1897, 1000, "w 23, h 80: dropped by the old 24x96 band"),
        ] {
            assert!(
                !rect(w, h, 0, 30).covers_a_monitor(&BLIND_SCREEN),
                "{w}x{h} must be SAVED even with no work area ({delta})"
            );
        }
    }

    /// The artefact against the work area it actually had, and the reason
    /// a reported work area is worth so much: 2560x1392 IS that work area,
    /// caught at delta 0x0 by the work arm, while the ordinary windows
    /// beside it are still saved. Independent of the blind case — nothing
    /// here is degenerate.
    #[test]
    fn the_shipped_artefact_matches_a_real_windows_work_area() {
        assert!(
            rect(2560, 1392, -8, -8).covers_a_monitor(&WIN_SCREEN),
            "delta 0x0 against the work area: this is the maximize"
        );
        assert!(
            rect(2560, 1372, 0, 0).covers_a_monitor(&WIN_SCREEN),
            "20px off the work area is the invisible border, not a resize"
        );
        for (w, h) in [(2560, 1100), (1400, 900), (2400, 1000)] {
            assert!(
                !rect(w, h, 0, 0).covers_a_monitor(&WIN_SCREEN),
                "{w}x{h} is a resize somebody asked for"
            );
        }
    }

    /// The ordinary sizes, on the monitor with nothing to say about its
    /// chrome: a person's own window size survives the missing work area
    /// because the band did not widen to compensate for it.
    #[test]
    fn an_ordinary_window_survives_a_missing_work_area() {
        for (w, h) in [(900, 720), (1400, 900), (1600, 1000), (1200, 1080)] {
            assert!(
                !rect(w, h, 100, 100).covers_a_monitor(&BLIND_SCREEN),
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

    // ── the macOS restore order, and the show that undoes it ──────────
    //
    // ⚠️ Honest limit: `remember_geometry` and the restore block in
    // `lib.rs` take a live `tauri::Window` and have no test seam — there
    // is no way from a unit test to place a real window, show it and read
    // the frame back. What IS testable is the restore expressed as data,
    // and the order was half the bug. The model below is not invented: it
    // is what a native AppKit probe measured on this display (1920x1080
    // panel, 1920x1050 work area, scale factor 1, Stage Manager on with
    // its shelf on the left, so the region a window may occupy is
    // x >= 234, width <= 1686):
    //
    //   born hidden        900x720  @(510,195)
    //   setContentSize     1910x1000 @(510,195)  hidden: exact, no clamp
    //   setFrameTopLeft    1910x1000 @(0,30)     hidden: exact
    //   orderFront         1686x1000 @(234,30)   ⛔ the whole bug
    //   setFrameTopLeft    1686x1000 @(0,30)     visible: exact
    //   setContentSize     1910x1000 @(0,30)     visible: and it sticks
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct Rect {
        x: i32,
        y: i32,
        w: u32,
        h: u32,
    }

    // the measured region a window is allowed to occupy on this display
    const STAGE_X: i32 = 234;
    const SCREEN_RIGHT: i32 = 1920;

    fn step(rect: &mut Rect, s: RestoreStep, visible: bool) {
        match s {
            RestoreStep::Position { x, y } => {
                rect.x = x;
                rect.y = y;
            }
            RestoreStep::Size { width, height } => {
                rect.h = height;
                // a visible window cannot be grown past the right edge of
                // the region it sits in; a hidden one is not clamped
                rect.w = if visible {
                    width.min((SCREEN_RIGHT - rect.x).max(0) as u32)
                } else {
                    width
                };
            }
        }
    }

    // what the window server does the first time the window is shown
    fn order_front(rect: &mut Rect) {
        rect.x = rect.x.max(STAGE_X);
        rect.w = rect.w.min((SCREEN_RIGHT - rect.x).max(0) as u32);
    }

    fn saved() -> WindowState {
        WindowState {
            maximized: false,
            width: 1910,
            height: 1000,
            x: 0,
            y: 30,
        }
    }

    // the window as `visible: false` leaves it: centered at the configured
    // 900x720 on a 1920x1080 panel under a 30px menu bar
    fn born() -> Rect {
        Rect {
            x: 510,
            y: 195,
            w: 900,
            h: 720,
        }
    }

    /// ⛔ the shipped bug, in the shape the fix has to beat: size first,
    /// position second, applied once while the window is still hidden.
    /// Every value lands, and the show throws them all away.
    #[test]
    fn geometry_set_before_the_show_is_lost_to_the_show() {
        let s = saved();
        let mut r = born();
        step(
            &mut r,
            RestoreStep::Size {
                width: s.width,
                height: s.height,
            },
            false,
        );
        step(&mut r, RestoreStep::Position { x: s.x, y: s.y }, false);
        assert_eq!(
            r,
            Rect {
                x: 0,
                y: 30,
                w: 1910,
                h: 1000
            },
            "hidden, both calls land exactly"
        );
        order_front(&mut r);
        assert_eq!(
            r,
            Rect {
                x: 234,
                y: 30,
                w: 1686,
                h: 1000
            },
            "and the show rewrites it: this is the measured defect"
        );
    }

    /// the fix: the same steps again, once the window is on screen
    #[test]
    fn restoring_again_after_the_show_lands_the_saved_rect() {
        let s = saved();
        let mut r = born();
        for st in macos_restore_steps(&s) {
            step(&mut r, st, false);
        }
        order_front(&mut r);
        for st in macos_restore_steps(&s) {
            step(&mut r, st, true);
        }
        assert_eq!(
            r,
            Rect {
                x: s.x,
                y: s.y,
                w: s.width,
                h: s.height
            },
            "position then size, after the show, restores the rect exactly"
        );
    }

    /// and the order within the pass is load-bearing: sizing first, from
    /// the x the show imposed, loses 224px of width that no later move
    /// gives back
    #[test]
    fn size_before_position_loses_the_width() {
        let s = saved();
        let mut r = born();
        for st in macos_restore_steps(&s) {
            step(&mut r, st, false);
        }
        order_front(&mut r);
        // the wrong order, deliberately
        step(
            &mut r,
            RestoreStep::Size {
                width: s.width,
                height: s.height,
            },
            true,
        );
        step(&mut r, RestoreStep::Position { x: s.x, y: s.y }, true);
        assert_eq!(r.w, 1686, "clamped by the x it was sized from");
        assert_ne!(r.w, s.width);
        // and the shipped plan is the other way round
        assert_eq!(
            macos_restore_steps(&s)[0],
            RestoreStep::Position { x: s.x, y: s.y },
            "position is the first step of the restore"
        );
    }
}
