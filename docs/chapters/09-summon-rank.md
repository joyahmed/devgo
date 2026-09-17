# 09 — Launcher-Grade Access (Slice 1)

**Branch:** `09.summon-rank` — `git checkout 09.summon-rank` gives you this chapter's finished app; `git diff 08.last-project 09.summon-rank` is exactly what this chapter adds.

**Starting from:** chapter 08 — a stable tray app that survives a missing drive, remembers your last project, and never boots WSL behind your back. To use it, you alt-tab to it.

**Goal:** a global summon hotkey, a frecency-ranked list, pinned favourites, and a search box that is ready to type into the instant the window appears.

> **Hold on to:**
> 1. **A test that asserts a relationship, not a number.** `today_once > last_month_twenty` is the product decision written down; it survives every tuning pass and it is the test that caught the first formula being wrong.
> 2. **`match` with guards as a bucket function** — `a if a < DAY => 8.0` — five ranges, piecewise constant, so an order you navigate by muscle memory does not drift while you are not looking.
> 3. **An optional capability that fails loses the capability, not the app.** `if let Err(e) = summon::register(…) { eprintln!(…) }` — one line on stderr, and DevGo still starts.
> 4. **Record success, not attempts** — `launch_*(…)?;` then `record_launch`. The `?` is the feature: a project that cannot open must not climb.
> 5. **`HashMap::entry(k).or_default()`** — get-or-insert in one call; the Rust idiom for "bump a counter keyed by string".

> Everything up to here made DevGo *correct*. None of it made DevGo a **launcher**.
>
> A launcher is defined by two properties, and DevGo has neither yet. The first is that you never go looking for it — one keystroke, from inside any application, and it is in front of you with the caret blinking. The second is that the thing you want is already at the top, because a launcher that shows you four hundred projects alphabetically has handed the search problem straight back to you.
>
> This chapter is the first of Part 2, and it is the smallest slice that delivers both. It is also the chapter where the tutorial starts writing tests in earnest — the frecency score is the first piece of DevGo with a genuinely wrong-looking correct answer, and the test suite is what caught it being wrong.

---

## 9.1 — The global shortcut plugin

A global hotkey is one the OS routes to us even when another application has focus. Tauri puts that behind a plugin. From `src-tauri/`:

```powershell
cargo add tauri-plugin-global-shortcut@2
```

Register it on the builder in `src-tauri/src/lib.rs`, alongside the two plugins already there:

```rust
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

### No capability entry — and that is the interesting part

Every previous plugin needed a matching line in `capabilities/default.json`: `shell:allow-open`, `dialog:allow-open`, `core:window:allow-show`. This one does not, and `default.json` is unchanged by this chapter.

Capabilities exist to gate what the **frontend** may ask the backend to do. They are a boundary around the WebView, because the WebView renders content and content is the thing that can turn hostile. DevGo registers its hotkey from `setup` in Rust — the frontend never mentions the shortcut plugin, so there is nothing to permit.

---

## 9.2 — Summon: toggle, focus, and one event

Create `src-tauri/src/summon.rs`. This is the whole file:

```rust
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{
    GlobalShortcutExt, Shortcut, ShortcutState,
};

/// Show, focus, and tell the frontend to select the search box.
pub fn show_and_focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        // The frontend owns focus of its own input; emitting is how we ask.
        let _ = app.emit("devgo://summoned", ());
    }
}

/// Toggle: a window that is already up and focused is dismissed, so the same
/// keystroke that summons DevGo also gets it out of the way.
fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let up = window.is_visible().unwrap_or(false)
        && window.is_focused().unwrap_or(false);
    if up {
        let _ = window.hide();
    } else {
        show_and_focus(app);
    }
}

fn parse(accelerator: &str) -> Result<Shortcut, String> {
    accelerator
        .parse::<Shortcut>()
        .map_err(|e| format!("not a valid accelerator: {e}"))
}

/// Register `accelerator` as the summon hotkey.
///
/// Returns Err rather than panicking when the combination is already owned by
/// another application — a launcher that refuses to start because something
/// else holds Ctrl+Alt+Space would be worse than one without a hotkey.
pub fn register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut = parse(accelerator)?;
    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            // Fire on press only; without this the handler also runs on release
            // and the window toggles straight back.
            if event.state == ShortcutState::Pressed {
                toggle(&handle);
            }
        })
        .map_err(|e| format!("{e}"))
}
```

Declare the module at the top of `src-tauri/src/lib.rs`, beside the others:

```rust
mod commands;
mod error;
mod models;
mod services;
mod summon;
```

Note where it lives: `summon.rs` sits next to `commands.rs`, **not** in `services/`. Everything in `services/` is testable without a running app — a scanner takes a path, a store takes a directory. `summon` cannot exist without an `AppHandle` and a real window manager. Putting it in `services/` would be the first module there you could not write a unit test for, and that is a boundary worth keeping visible.

### `ShortcutState::Pressed`, or the window flickers

Delete the `if event.state == ShortcutState::Pressed` guard and the feature appears to be broken in a very confusing way: you press Ctrl+Alt+Space and nothing happens.

The handler fires twice per keystroke — once on press, once on release. The press toggles the window up; a few milliseconds later the release toggles it straight back down. It is not a race and it is not timing-dependent; it is exactly the code you wrote, running exactly twice. The state field is not optional detail, it is the difference between a working hotkey and a hotkey that does nothing.

### Toggle is a launcher behaviour, not a nicety

`toggle` dismisses the window when it is **visible and focused**. Both conditions matter:

- Visible but *not* focused — you clicked away, DevGo is behind your editor. The hotkey should raise it, not hide something you cannot see.
- Hidden — obviously show it.

The result is that one key does the whole interaction. Summon, look, decide it was the wrong moment, press again, it is gone. Compare a hotkey that only ever shows: to dismiss it you now have to find the mouse, or remember which of ✕ / Esc / Alt+F4 this particular app treats as "hide."

### Why emit an event instead of focusing the input from Rust

Rust can focus the *window*. It cannot focus the search box — that is a DOM node inside the WebView, and Rust has no handle on it and should not want one.

So `show_and_focus` does what it can and then emits `devgo://summoned`. The frontend, which owns the ref to that input, decides what "ready to type" means: clear the leftover query, focus, select. That listener lands in §9.7.

The `devgo://` prefix is a convention, not a requirement — it namespaces our events away from Tauri's own `tauri://` ones and makes them greppable. `unminimize()` sits between `show()` and `set_focus()` because a minimized window is still "visible" as far as Windows is concerned; without it, summoning a minimized DevGo focuses a window that is not on screen.

### What is *not* in this file *(skip on first pass)*

`unregister`, `rebind` and the two commands that read and change the hotkey are not here. Nothing in this chapter can change the binding, so they arrive in the chapters that give them a caller — 11 reads it; 19 adds `rebind` and `set_summon_hotkey` for the config import; 20's Shortcuts panel changes it. `register` is the whole of what startup needs.

---

## 9.3 — Registration that is allowed to fail

Two things can go wrong with a global hotkey, and neither is our bug: the accelerator string can be nonsense, or another application already owns the combination. Ctrl+Alt+Space in particular is popular.

Wire it into `setup` in `src-tauri/src/lib.rs`, after `app.manage(AppState { … })` and before the tray:

```rust
            // A hotkey another app already owns must not stop DevGo from
            // starting — log it and carry on; the tray and window still work.
            let hotkey = app
                .state::<AppState>()
                .pref_store
                .lock()
                .map(|p| p.summon_hotkey())
                .unwrap_or_else(|_| {
                    services::preferences::DEFAULT_SUMMON_HOTKEY.to_string()
                });
            if let Err(e) = summon::register(&app.handle().clone(), &hotkey) {
                eprintln!("[DevGo] summon hotkey '{hotkey}' unavailable: {e}");
            }
```

The `.map(…).unwrap_or_else(…)` chain means a poisoned mutex falls back to the default rather than panicking. We read from `AppState` rather than the local `pref_store` binding because `pref_store` was moved into `manage` on the line above. `summon_hotkey()` and `DEFAULT_SUMMON_HOTKEY` are §9.4's.

### Failure is a log line, not an exit

Read that `if let Err` again and notice what it does **not** do: no `expect`, no `?`, no toast, no dialog. DevGo starts.

The alternative is an app that refuses to launch because some other program holds a key combination. The hotkey is a convenience layered on top of a tray icon and a window that both still work perfectly. Degrading to "the launcher you have to click" is a small loss; degrading to "the launcher that will not start" is a total one. **When an optional capability is unavailable, the app loses the capability, not the app.**

The `eprintln!` is deliberate too. Silence here produces a genuinely maddening bug report — "the hotkey doesn't work on my machine, no error, nothing" — and one line on stderr turns that into a two-second diagnosis.

> **Commit checkpoint** — the hotkey half: `Cargo.toml`, `Cargo.lock`, `summon.rs` and the `lib.rs` edits above, four files. **It does not build on its own**: the `setup` block already calls `p.summon_hotkey()` and names `DEFAULT_SUMMON_HOTKEY`, and both are §9.4's. That is how the branch has it — the commit is the hotkey's files and nothing else, and `cargo check` goes green two commits later. Commit it here so your history matches, or wait until §9.5 and commit the same four files then; either way it holds only these four.
>
> ```powershell
> git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/summon.rs
> git commit -m "✅SUMMON: global hotkey toggles the window, registration allowed to fail"
> git push
> ```

---

## 9.4 — Recording launches

Ranking needs data, and the only honest source is what the user actually opened. `prefs.json` already exists (chapter 08) and already holds automatic app state, so it is the right home. Here is `src-tauri/src/services/preferences.rs` after this chapter, in full — chapter 08's parts are unchanged; the imports, `DEFAULT_SUMMON_HOTKEY`, `ProjectStat`, `now_secs`, the three fields, five methods and the tests are new:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::platform::RuntimeInfo;

pub const DEFAULT_SUMMON_HOTKEY: &str = "Ctrl+Alt+Space";

/// How often and how recently a project has been launched.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectStat {
    pub launch_count: u32,
    pub last_opened: u64,
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
            serde_json::from_str(&data).unwrap_or_default()
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

    /// Drop stats and pins for projects that no longer exist, so a renamed or
    /// deleted folder doesn't keep a phantom entry forever. Only ever called
    /// with a *live* scan result — never with a cached or unavailable one, or a
    /// detached drive would erase its own history.
    pub fn retain_known(
        &mut self,
        live_paths: &[String],
    ) -> Result<(), String> {
        let before = (self.prefs.project_stats.len(), self.prefs.pinned.len());
        self.prefs
            .project_stats
            .retain(|path, _| live_paths.iter().any(|p| p == path));
        self.prefs
            .pinned
            .retain(|path| live_paths.iter().any(|p| p == path));
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
        s.record_launch(r"G:\gone").unwrap();
        s.record_launch(r"G:\here").unwrap();
        s.toggle_pin(r"G:\gone").unwrap();

        s.retain_known(&[r"G:\here".to_string()]).unwrap();

        assert!(!s.project_stats().contains_key(r"G:\gone"));
        assert!(s.project_stats().contains_key(r"G:\here"));
        assert!(
            s.pinned().is_empty(),
            "pin for a vanished project is dropped"
        );
    }

    /// The hotkey is read through a getter that falls back to the default, so
    /// a prefs.json that never mentions it still summons.
    #[test]
    fn hotkey_defaults_when_unset() {
        let s = store("hotkey");
        assert_eq!(s.summon_hotkey(), DEFAULT_SUMMON_HOTKEY);
    }
}
```

Every new field carries `#[serde(default)]`. Without it, `serde_json::from_str` fails on the `prefs.json` already sitting on the reader's disk, and `PreferencesStore::new`'s `unwrap_or_default()` silently throws away their last project and cached runtime. **A struct that is deserialized from a file users already have must tolerate every field being absent.**

`ProjectStat` derives `Default` so a project with no history is `ProjectStat { launch_count: 0, last_opened: 0 }` rather than an `Option` every caller has to unwrap.

### `retain_known` prunes only against workspaces we actually read

This method deletes user data. It deserves the same suspicion chapter 06 gave `ProjectCacheStore::store`, and it fails in the same way.

The tempting call is `retain_known(every_path_in_the_payload)`. The payload is the merged list — live workspaces *plus* cached ones — so at a glance it looks like the complete picture. It isn't. A workspace served from cache still contributes its remembered projects to `projects`, but a workspace that is `Unavailable` **with nothing cached** contributes nothing at all. Its projects are simply absent from the list.

Play it forward. You `wsl --shutdown` on Friday. Monday morning DevGo starts, the distro is stopped, that workspace has no cache entry yet, and `retain_known` is handed a list with none of its projects in it. Six months of launch history and every pin for everything on that distro: gone, permanently, because a virtual machine was not running.

So the caller (§9.6) filters to `WorkspaceStatus::Live` before calling, and skips the call entirely when nothing was live. **A prune must be driven by positive evidence of absence — "I looked and it is not there" — never by "it is not in this list."** The comment in the file names the consequence rather than describing the code, for the same reason chapter 06's does: the next reader will otherwise "simplify" the filter away.

This is the project-cache invariant a second time, on a second store, arrived at independently. Once is a decision; twice is a house rule.

### Five tests for a file of getters *(skip on first pass)*

`prefs.json` is where DevGo's memory lives, and the failure mode of a broken store is silent data loss you notice weeks later. Each test gets its own uniquely-named temp directory and deletes it first, because `cargo test` runs tests in parallel on separate threads and a shared `prefs.json` would make them flake against each other. `launches_survive_a_reload` is the one that matters most: it constructs a second `PreferencesStore` over the same directory, which is the only way to prove the data reached disk rather than just the in-memory struct. `hotkey_defaults_when_unset` pins the getter's fallback — the only hotkey behaviour this chapter has.

---

## 9.5 — The frecency score

Create `src-tauri/src/services/frecency.rs`:

```rust
use crate::services::preferences::ProjectStat;

const DAY: u64 = 60 * 60 * 24;

/// Recency multiplier, bucketed rather than a smooth curve.
///
/// Buckets are deliberate: a continuous decay makes the list reshuffle slightly
/// every few minutes, which is worse than useless in a launcher you navigate by
/// muscle memory. Within a bucket the order is stable all day.
fn recency_weight(age_secs: u64) -> f64 {
    match age_secs {
        a if a < DAY => 8.0,
        a if a < 3 * DAY => 4.0,
        a if a < 7 * DAY => 2.0,
        a if a < 30 * DAY => 1.0,
        _ => 0.5,
    }
}

/// Frequency × recency, with frequency damped logarithmically.
///
/// The damping is the whole trick. Multiplying raw counts lets history win:
/// 20 launches a month ago (20 × 0.5 = 10) would outrank one this morning
/// (1 × 8 = 8), which is precisely backwards for a launcher. `1 + ln(count)`
/// makes the 20th launch worth far less than the 2nd, so recency dominates
/// while frequency still breaks ties.
pub fn score(stat: &ProjectStat, now: u64) -> f64 {
    if stat.launch_count == 0 {
        return 0.0;
    }
    let age = now.saturating_sub(stat.last_opened);
    let frequency = 1.0 + f64::from(stat.launch_count).ln();
    frequency * recency_weight(age)
}

/// The hint shown on a row. `None` for the long tail, so the badges stay
/// meaningful instead of decorating every line.
pub fn hint(stat: &ProjectStat, now: u64) -> Option<&'static str> {
    if stat.launch_count == 0 {
        return None;
    }
    let age = now.saturating_sub(stat.last_opened);
    if age < 3 * DAY {
        Some("recent")
    } else if stat.launch_count >= 5 {
        Some("frequent")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat(count: u32, age_days: u64) -> ProjectStat {
        ProjectStat {
            launch_count: count,
            last_opened: 1_000 * DAY - age_days * DAY,
        }
    }

    const NOW: u64 = 1_000 * DAY;

    #[test]
    fn recency_beats_raw_count() {
        let today_once = score(&stat(1, 0), NOW);
        let last_month_twenty = score(&stat(20, 31), NOW);
        assert!(
            today_once > last_month_twenty,
            "1 launch today ({today_once}) should outrank 20 a month ago ({last_month_twenty})"
        );
    }

    #[test]
    fn count_breaks_ties_within_a_bucket() {
        assert!(score(&stat(5, 0), NOW) > score(&stat(2, 0), NOW));
    }

    #[test]
    fn never_launched_scores_zero() {
        assert_eq!(score(&stat(0, 0), NOW), 0.0);
        assert_eq!(hint(&stat(0, 0), NOW), None);
    }

    /// A clock that jumped backwards must not panic or produce a wild score.
    /// saturating_sub clamps the age to 0, which lands in the freshest bucket.
    #[test]
    fn future_timestamp_is_survivable() {
        let future = ProjectStat {
            launch_count: 3,
            last_opened: NOW + 5 * DAY,
        };
        assert_eq!(score(&future, NOW), (1.0 + 3f64.ln()) * 8.0);
    }

    /// The damping must not be so strong that frequency stops mattering, nor so
    /// weak that a stale-but-popular project floats to the top.
    #[test]
    fn frequency_has_diminishing_returns() {
        let one = score(&stat(1, 0), NOW);
        let two = score(&stat(2, 0), NOW);
        let twenty = score(&stat(20, 0), NOW);
        assert!(two > one);
        assert!(twenty > two);
        // Doubling 1 → 2 should buy more than going 10 → 20 does.
        assert!(
            two - one > score(&stat(20, 0), NOW) - score(&stat(10, 0), NOW)
        );
    }

    #[test]
    fn hints_are_selective() {
        assert_eq!(hint(&stat(1, 0), NOW), Some("recent"));
        assert_eq!(hint(&stat(9, 10), NOW), Some("frequent"));
        // Opened twice, a week ago: real, but not worth a badge.
        assert_eq!(hint(&stat(2, 7), NOW), None);
    }
}
```

Register it in `src-tauri/src/services/mod.rs` — one line among the others, first alphabetically:

```rust
pub mod frecency;
```

No `pub use` — `frecency::score` and `frecency::hint` read better qualified than bare `score` and `hint` would.

### The logarithm, and the test that demanded it

The obvious formula is `launch_count * recency_weight(age)`. It is what the first implementation shipped, it is what "frequency times recency" literally says, and it is wrong.

Work an example. A project you have opened 20 times, last touched a month ago: `20 × 0.5 = 10`. A project you opened once, this morning: `1 × 8 = 8`. Linear frequency puts the month-old project **above** the one you were working on four hours ago.

That is not a rounding error, it is the wrong ranking for this application. A launcher exists to answer "what am I working on *now*", and "now" is a claim that decays fast. History is a tiebreaker, not a trump card.

`1 + ln(count)` fixes it by making each additional launch worth less than the one before:

| launches | `1 + ln(n)` | linear |
|---|---|---|
| 1 | 1.00 | 1 |
| 2 | 1.69 | 2 |
| 5 | 2.61 | 5 |
| 20 | 4.00 | 20 |
| 100 | 5.61 | 100 |

Twenty launches is worth four, not twenty. Rerun the example: `4.00 × 0.5 = 2.0` versus `1.00 × 8.0 = 8.0`. This morning wins comfortably, and two projects both opened today are still separated by how often you use them — which is exactly the behaviour you want.

The `1 +` matters as much as the `ln`. `ln(1)` is `0`, so without it a project's first ever launch would score zero and be indistinguishable from one you have never opened. `f64::from(stat.launch_count)` is an infallible conversion — `u32` fits in `f64` exactly — so no `as` cast and no precision question.

### Six tests, and the first one is the bug

`recency_beats_raw_count` is not a hypothetical. The linear version was written, it compiled, it ran, the list looked plausible — and this test failed on it. That is worth sitting with, because it is the argument for testing a scoring function at all.

There was no crash and no visible error. The bug was a *ranking* that felt subtly wrong, in a list you would have to stare at for a week to distrust. Every other kind of bug in this tutorial so far — a bad path, a missing binary, an unreadable drive — announces itself. This one hides, and the only thing that catches a hidden wrong answer is writing down the right one first.

Notice what the test asserts: not a number, a **relationship**. `today_once > last_month_twenty` is the product decision — recency wins — expressed in a form the compiler checks. Tune the weights, swap `ln` for `sqrt`, add a bucket; the test still holds you to the thing you actually meant. A test asserting `score == 8.0` would break on every tuning pass and teach you nothing.

The rest of the suite pins the edges: zero launches score zero (no `ln(0) = -inf`), a clock that jumped backwards clamps to the freshest bucket instead of panicking on underflow, damping is present but not total, and hints stay rare enough to mean something.

### Buckets, not a smooth curve *(skip on first pass)*

`recency_weight` is a `match` over five ranges, not `0.5_f64.powf(age / half_life)`. The exponential is more elegant and it is the wrong tool.

An exponential decay means every project's score is *always* changing. Two projects a few points apart at 9am have swapped by 11am, not because you did anything, but because time passed. In a list you read, that is invisible. In a launcher you navigate **by muscle memory** — summon, down-arrow twice, Enter, without looking — it is a trap. You learn a position, and the position quietly moves.

Buckets make the order piecewise constant. Everything launched today shares a weight of `8.0`, so within today the ranking only changes when *you* change it, by launching something. It reorders when you cross a boundary — overnight, or at the three-day mark — which is a rhythm you can actually internalise. The general rule: **when a computed order becomes a physical habit, prefer stability to precision.**

`hint` follows the same instinct. It returns `None` for most rows on purpose — a badge on every line is decoration, and decoration on every line is noise.

`preferences.rs` and `frecency.rs` go into the ranking half's commit at the end of §9.6, together with the commands that call them; the hotkey half was committed at the end of §9.3.

---

## 9.6 — Rank travels *beside* the project

The frontend needs a score per project. The obvious move is to put it on `Project`. Don't.

In `src-tauri/src/commands.rs`, one import and a new struct above `ProjectsPayload`, which gains a field:

```rust
use crate::services::frecency;
```

```rust
/// Ranking metadata, kept beside `Project` rather than on it so `Project` stays
/// the four fields the scanner produces.
#[derive(Serialize)]
pub struct ProjectRank {
    pub full_path: String,
    pub score: f64,
    pub launch_count: u32,
    pub last_opened: u64,
    pub hint: Option<&'static str>,
    pub pinned: bool,
}

#[derive(Serialize)]
pub struct ProjectsPayload {
    pub projects: Vec<Project>,
    pub workspaces: Vec<WorkspaceState>,
    pub ranks: Vec<ProjectRank>,
}
```

### Why not just add `score` to `Project`?

Three reasons, in increasing order of importance.

**It isn't the scanner's data.** `Project` is what `scan_workspace` produces by reading a directory. A score is computed from `prefs.json` by a completely different subsystem. Bolting it on would mean the scanner constructing `Project { score: 0.0, .. }` — a field it has no opinion about — and `ProjectCacheStore` then serialising stale scores into `projects-cache.json`.

**Cached projects would carry stale ranks.** A workspace served from cache would return projects whose `score` was computed on a previous run. Keeping rank out of `Project` makes that impossible by construction — ranks are computed fresh from `prefs.json` on every pass, for cached and live projects alike.

**And the mundane one:** `Project` has been four fields since chapter 02 and appears in a dozen listings. The cost of the separation is that the frontend joins two lists — one `new Map(...)` (§9.7) — and it buys a data model where each type has exactly one owner.

`hint` is `Option<&'static str>` rather than `Option<String>` because the only values are two compile-time literals. No allocation, and serde emits `"recent"` / `"frequent"` / `null` either way.

### Computing the ranks in `collect_projects`

At the end of `collect_projects`, replace everything from the sort to the return:

```rust
    projects.sort_by_key(|p| p.name.to_lowercase());

    let mut prefs = state.pref_store.lock().map_err(lock_err)?;

    // Only prune history against workspaces we actually read this pass. Pruning
    // against the merged list would let a stopped distro or a detached drive
    // erase the launch history of every project it holds.
    let live: Vec<String> = states
        .iter()
        .filter(|s| matches!(s.status, WorkspaceStatus::Live))
        .flat_map(|s| {
            projects
                .iter()
                .filter(|p| p.workspace == s.workspace)
                .map(|p| p.full_path.clone())
        })
        .collect();
    if !live.is_empty() {
        prefs.retain_known(&live).map_err(AppError::Lock)?;
    }

    let stats = prefs.project_stats();
    let pinned = prefs.pinned();
    let now = crate::services::preferences::now_secs();

    let ranks = projects
        .iter()
        .map(|p| {
            let stat = stats.get(&p.full_path).cloned().unwrap_or_default();
            ProjectRank {
                score: frecency::score(&stat, now),
                hint: frecency::hint(&stat, now),
                launch_count: stat.launch_count,
                last_opened: stat.last_opened,
                pinned: pinned.iter().any(|p2| p2 == &p.full_path),
                full_path: p.full_path.clone(),
            }
        })
        .collect();

    Ok(ProjectsPayload {
        projects,
        workspaces: states,
        ranks,
    })
}
```

The `live` filter is §9.4's invariant made concrete: `WorkspaceStatus::Live` only, and `if !live.is_empty()` so a pass where *nothing* was readable — laptop on a train, every drive missing — prunes nothing at all rather than everything. `now` is computed once for the whole pass, not per project: two projects launched in the same second must not score differently because the clock ticked between them.

### Counting a launch — but only a successful one

Still in `commands.rs` — a helper above the three launch commands, and one line changed in each:

```rust
/// Count a launch. Deliberately runs only after the launch itself succeeded, so
/// a project that fails to open does not climb the ranking.
fn record_launch(state: &AppState, project: &Project) -> Result<(), AppError> {
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .record_launch(&project.full_path)
        .map_err(AppError::Lock)
}

#[tauri::command]
pub fn open_vscode(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    launcher::launch_vscode(&project, &info)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn open_terminal(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    launcher::launch_terminal(&project, &info)?;
    record_launch(&state, &project)
}

#[tauri::command]
pub fn open_both(
    project: Project,
    state: State<AppState>,
) -> Result<(), AppError> {
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    launcher::launch_both(&project, &info)?;
    record_launch(&state, &project)
}
```

The three commands change by exactly one line each: `launcher::launch_*(…)?;` gains a `?` and stops being the tail expression, and `record_launch` becomes the new tail.

That `?` is the entire feature. Put `record_launch` first, or ignore the launch result, and a project that cannot open — VS Code missing from `PATH`, a distro that will not start — climbs the rankings every time you try. Worse, it climbs *faster* than working projects, because a failed launch is something you retry. **The score must measure successful use, not attempts.**

### The pin command

```rust
#[tauri::command]
pub fn toggle_pin(
    full_path: String,
    state: State<AppState>,
) -> Result<bool, AppError> {
    state
        .pref_store
        .lock()
        .map_err(lock_err)?
        .toggle_pin(&full_path)
        .map_err(AppError::Lock)
}
```

`toggle_pin` returns the resulting state as a `bool` rather than nothing, so the frontend can update one row without refetching the whole payload. Register it in the `invoke_handler` in `src-tauri/src/lib.rs`, after `quit_app`:

```rust
            commands::toggle_pin,
```

Thirteen commands. Same rule as chapter 06: a command missing from this list compiles fine and fails at runtime, so add it in the same edit.

> **Commit checkpoint**
>
> ```powershell
> git add -A && git commit -m "✅RANK: launch history, frecency score, pinning — ranks travel beside Project" && git push
> ```

`cargo test` now reports **18** — chapter 04's four, chapter 06's three, and this chapter's eleven.

---

## 9.7 — Sorting, hints, and the sort toggle

The types first. `src/types.d.ts` gains the mirror of `ProjectRank`, one field on `ProjectsPayload`, a sort mode, and the props that change:

```ts
/// Ranking metadata travels beside Project, not on it — Project stays the four
/// fields the scanner produces.
interface ProjectRank {
	full_path: string;
	score: number;
	launch_count: number;
	last_opened: number;
	hint: 'recent' | 'frequent' | null;
	pinned: boolean;
}

interface ProjectsPayload {
	projects: Project[];
	workspaces: WorkspaceState[];
	ranks: ProjectRank[];
}

type SortMode = 'frecency' | 'name';
```

```ts
interface SearchBoxProps {
	value: string;
	onChange: (v: string) => void;
	onEnter?: () => void;
	onArrow?: (dir: 1 | -1) => void;
	enterHint?: string;
	sortMode?: SortMode;
	onToggleSort?: () => void;
	ref?: React.Ref<HTMLInputElement>;
}
```

```ts
interface ProjectTreeProps {
	projects: Project[];
	selected: Project | null;
	onSelect: (p: Project) => void;
	onDoubleClick: (p: Project) => void;
	onLaunch: (p: Project) => void;
	query: string;
	loading?: boolean;
	workspaceStates?: WorkspaceState[];
	ranks?: Map<string, ProjectRank>;
	pinnedProjects?: Project[];
	onTogglePin?: (p: Project) => void;
	ref?: React.Ref<ProjectTreeHandle>;
}
```

and, below `StatusPillProps` (unchanged since chapter 06), two new shapes:

```ts
interface RowMetaProps {
	project: Project;
	rank?: ProjectRank;
	onTogglePin?: (p: Project) => void;
}

interface ProjectRowProps {
	project: Project;
	selected: boolean;
	/// Rendered in the Pinned strip rather than under its workspace header.
	pinnedStrip?: boolean;
	/// Served from cache — the row dims to say so.
	stale?: boolean;
	rank?: ProjectRank;
	onSelect: (p: Project) => void;
	onDoubleClick: (p: Project) => void;
	onTogglePin?: (p: Project) => void;
}
```

`Option<&'static str>` on the Rust side becomes `'recent' | 'frequent' | null` here — serde serialises `None` as `null`, not as a missing key, so the type is a union with `null` rather than an optional field. `SearchBoxProps` gains a `ref` the same way `ProjectTreeProps` did in chapter 03: a prop, no `forwardRef`.

### The hook

`src/hooks/useProjects.ts` after this chapter, in full. Ranks, a sort mode, a pin action, and sorting moved into `filtered`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';

/// A workspace on a virtual disk can be missing for a few seconds after boot
/// while the disk attaches. Retry a bounded number of times so the list heals
/// itself instead of needing a restart.
const RETRY_DELAYS = [2000, 5000, 15000];

/// Only local workspaces are retried. A stopped distro is a deliberate decision,
/// not a transient failure — auto-retrying it would make DevGo boot WSL in the
/// background, which is the exact behaviour this all exists to prevent.
const isRetryable = (w: WorkspaceState) =>
	w.status !== 'live' && w.reason !== 'distro_stopped';

const SORT_KEY = 'devgo.sortMode';

export const useProjects = () => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [workspaceStates, setWorkspaceStates] = useState<WorkspaceState[]>(
		[]
	);
	const [ranks, setRanks] = useState<Map<string, ProjectRank>>(new Map());
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<Project | null>(null);
	const [loading, setLoading] = useState(true);
	const [sortMode, setSortMode] = useState<SortMode>(
		() => (localStorage.getItem(SORT_KEY) as SortMode) ?? 'frecency'
	);
	const retryTimer = useRef<number | null>(null);
	const retryStep = useRef(0);

	const apply = (payload: ProjectsPayload) => {
		setProjects(payload.projects);
		setWorkspaceStates(payload.workspaces);
		setRanks(new Map(payload.ranks.map(r => [r.full_path, r])));
		return payload;
	};

	const refresh = async (force = false) => {
		setLoading(true);
		try {
			const payload = force
				? await invoke<ProjectsPayload>('refresh_projects', { force: true })
				: await invoke<ProjectsPayload>('get_projects');
			return apply(payload);
		} finally {
			setLoading(false);
		}
	};

	// Schedule a retry whenever something is recoverably missing. Cleared as soon
	// as a pass comes back with nothing left to retry.
	useEffect(() => {
		if (retryTimer.current !== null) {
			window.clearTimeout(retryTimer.current);
			retryTimer.current = null;
		}

		if (!workspaceStates.some(isRetryable)) {
			retryStep.current = 0;
			return;
		}

		const delay = RETRY_DELAYS[retryStep.current];
		if (delay === undefined) return;
		retryStep.current += 1;

		retryTimer.current = window.setTimeout(() => {
			refresh().catch(() => {});
		}, delay);

		return () => {
			if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
		};
	}, [workspaceStates]);

	// Summoning the window should show a current list. Resets the retry budget so
	// a workspace that came back is picked up promptly.
	useEffect(() => {
		const unlisten = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (!focused) return;
				retryStep.current = 0;
				refresh().catch(() => {});
			}
		);
		return () => {
			unlisten.then(f => f()).catch(() => {});
		};
	}, []);

	// First-launch restore: scan, then re-select the project saved last time if
	// it still exists. Runs exactly once — re-running it after a rescan would
	// steal the selection the user just made.
	useEffect(() => {
		refresh()
			.then(payload =>
				invoke<LastProject | null>('get_last_project')
					.then(last => {
						if (!last) return;
						const match = payload.projects.find(
							p => p.full_path === last.full_path
						);
						if (match) setSelected(match);
					})
					.catch(() => {})
			)
			.catch(() => {});
	}, []);

	// Every selection is persisted, so the next launch can land on it.
	const selectAndSave = (proj: Project | null) => {
		setSelected(proj);
		if (proj) {
			invoke('set_last_project', {
				project: { full_path: proj.full_path, workspace: proj.workspace }
			}).catch(() => {});
		}
	};

	const toggleSort = () => {
		setSortMode(prev => {
			const next: SortMode = prev === 'frecency' ? 'name' : 'frecency';
			localStorage.setItem(SORT_KEY, next);
			return next;
		});
	};

	// Patch one rank from the command's answer rather than rescanning every
	// workspace to change a star.
	const togglePin = async (project: Project) => {
		const pinned = await invoke<boolean>('toggle_pin', {
			fullPath: project.full_path
		});
		setRanks(prev => {
			const next = new Map(prev);
			const existing = prev.get(project.full_path);
			if (existing) next.set(project.full_path, { ...existing, pinned });
			return next;
		});
	};

	const q = query.trim().toLowerCase();
	const matched = q
		? projects.filter(p => p.name.toLowerCase().includes(q))
		: projects;

	// Frecency descending, falling back to name so equal-scored projects (the
	// long tail, all zero) keep a stable alphabetical order rather than
	// whatever the scan happened to return. `[...matched]` because sort mutates.
	const filtered =
		sortMode === 'name'
			? matched
			: [...matched].sort((a, b) => {
					const sa = ranks.get(a.full_path)?.score ?? 0;
					const sb = ranks.get(b.full_path)?.score ?? 0;
					if (sb !== sa) return sb - sa;
					return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
				});

	// Derived from `filtered`, not `projects`, so pins respect the search.
	const pinnedProjects = filtered.filter(p => ranks.get(p.full_path)?.pinned);

	return {
		projects,
		workspaceStates,
		ranks,
		filtered,
		pinnedProjects,
		query,
		setQuery,
		selected,
		setSelected: selectAndSave,
		refresh,
		loading,
		sortMode,
		toggleSort,
		togglePin
	};
};
```

A `Map` keyed by `full_path`, not the array. Every consumer looks rank up *by project*, and doing that against an array is a linear scan per row per render.

`togglePin` uses the command's return value to patch one entry rather than calling `refresh()`. A full refresh would rescan every workspace — including, on a bad day, waiting on a network share — to change a star. The `fullPath` key is Tauri's camelCase convention: the Rust parameter is `full_path`, the JS argument is `fullPath`. Get it wrong and you get "invalid args" at runtime, not a type error.

Three details in the comparator, each of which is a bug if you skip it: **`[...matched]`** — `Array.prototype.sort` mutates, and sorting `matched` in place would sort `projects` itself whenever the query is empty; **`sb - sa`** — descending; **the name fallback** — most projects score exactly `0.0`, so without it the tie is broken by whatever order the scan returned. `sortMode === 'name'` returns `matched` untouched because `collect_projects` already sorted alphabetically in Rust.

`pinnedProjects` derives from `filtered`, not `projects` — so pins respect the search query and disappear from the pinned strip when they do not match what you typed.

### `sortMode` in `localStorage`, not `prefs.json` *(skip on first pass)*

Every other preference in DevGo lives in `prefs.json`, behind a Rust store. This one lives in the WebView's `localStorage`, and the inconsistency is deliberate. `prefs.json` is for state the **backend** needs: `record_launch` writes to it, `collect_projects` reads it. Sort order is read by one derived value and written by one button. The heuristic: **persist through the backend when the backend uses the value; persist locally when only the view does.** The lazy initialiser (`useState(() => …)`) reads `localStorage` once on mount rather than on every render.

### The SearchBox: a ref and a sort toggle

`src/components/SearchBox.tsx` in full. What this chapter adds: the `ref` prop passed through to the input, `autoFocus`, an `Escape` entry in the key map, and the sort toggle beside the label — a `ghost` `Button`:

```tsx
import type { KeyboardEvent } from 'react';
import Button from './Button';

const SearchBox = ({
	value,
	onChange,
	onEnter,
	onArrow,
	enterHint,
	sortMode,
	onToggleSort,
	ref
}: SearchBoxProps) => {
	const keys: Record<string, (() => void) | undefined> = {
		ArrowDown: () => onArrow?.(1),
		ArrowUp: () => onArrow?.(-1),
		Escape: () => onChange(''),
		Enter: onEnter
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		const action = keys[e.key];
		if (!action) return;
		e.preventDefault();
		action();
	};

	return (
		<div className='shrink-0'>
			<div className='flex items-baseline justify-between mb-2'>
				<label className='block text-xs font-semibold uppercase tracking-wider text-text-secondary'>
					Search Projects
				</label>
				{onToggleSort && (
					<Button
						variant='ghost'
						className='text-[10px] uppercase tracking-wider p-0 hover:text-accent hover:bg-transparent'
						title='Toggle sort order'
						onClick={onToggleSort}
					>
						sort: {sortMode === 'name' ? 'A–Z' : 'frecency'}
					</Button>
				)}
			</div>
			<div className='relative bg-bg-panel rounded-lg border border-border focus-within:border-accent transition-colors'>
				<input
					ref={ref}
					type='text'
					// The launcher's whole job is to be typed into the instant it appears.
					autoFocus
					className='w-full py-2.5 pl-3.5 pr-20 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted'
					placeholder='Type to filter...'
					value={value}
					onChange={e => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
				/>
				<div className='absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5'>
					{value && (
						<Button
							variant='ghost'
							className='text-text-secondary'
							onClick={() => onChange('')}
						>
							&#10005;
						</Button>
					)}
					{enterHint && (
						<span className='text-[10px] text-text-muted px-1.5 py-0.5 border border-border rounded'>
							{enterHint}
						</span>
					)}
				</div>
			</div>
		</div>
	);
};

export default SearchBox;
```

`autoFocus` covers cold start; the `devgo://summoned` listener below covers every summon after that. The button label shows the *current* mode, not the one you would switch to — a toggle that displays its own state is the version people read correctly.

### Listening for the summon

In `src/App.tsx`: `listen` joins the imports, the hook's new values are destructured, a ref for the input and a listener for the event go beside `treeRef`, a pin handler beside the launch wrappers, and the two components get their new props.

```tsx
import { listen } from '@tauri-apps/api/event';
```

```tsx
	const {
		filtered,
		query,
		setQuery,
		selected,
		setSelected,
		refresh,
		loading,
		workspaceStates,
		ranks,
		pinnedProjects,
		sortMode,
		toggleSort,
		togglePin
	} = useProjects();
```

```tsx
	// Summoned by the global hotkey: put the caret in the search box and clear
	// whatever was left over, so the window is always ready to be typed into.
	const searchRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		const unlisten = listen('devgo://summoned', () => {
			setQuery('');
			searchRef.current?.focus();
			searchRef.current?.select();
		});
		return () => {
			unlisten.then(f => f()).catch(() => {});
		};
	}, []);
```

```tsx
	const handleTogglePin = (p: Project) => {
		togglePin(p).catch(e => toast(showError(e)));
	};
```

```tsx
				<SearchBox
					{...{
						ref: searchRef,
						value: query,
						onChange: setQuery,
						onEnter: handleSearchEnter,
						onArrow: handleArrow,
						sortMode,
						onToggleSort: toggleSort,
						enterHint:
							selected || filtered.length > 0 ? '⏎ Enter' : undefined
					}}
				/>
				<ProjectTree
					{...{
						ref: treeRef,
						projects: filtered,
						selected,
						onSelect: handleSelect,
						onDoubleClick: handleLaunch,
						onLaunch: handleLaunch,
						query,
						loading,
						workspaceStates,
						ranks,
						pinnedProjects,
						onTogglePin: handleTogglePin
					}}
				/>
```

Clearing the query is the part that is easy to leave out and immediately obvious once you use it. You summon DevGo, type `dev`, launch something, and it hides. Two hours later you summon it again — and the list is still filtered to `dev`. A launcher must open in the same state every single time, or you cannot build a habit on it. `focus()` then `select()` is belt and braces: if anything did survive, the first keystroke replaces it rather than appending to it.

`listen` returns a `Promise<UnlistenFn>`, so the cleanup awaits it before calling. Without that cleanup, React's StrictMode double-mount in dev leaves two listeners.

> **Commit checkpoint**
>
> ```powershell
> git add -A && git commit -m "✅REACT: ranks map, frecency sort + A–Z toggle, pin action, search box ready on summon" && git push
> ```

---

## 9.8 — Pinning, and one row for two places

Frecency is automatic and therefore approximate. A pin is you overriding it: *this one, always, at the top.* Two projects out of forty deserve that, and the feature is worth building precisely because the ranking is good enough that the exceptions are few.

A pinned project renders in a **Pinned** strip above the tree — and a pinned row is the same four columns as a row under a workspace header. Chapter 03 wrote that row inline in the tree; this chapter would have written it a second time. Instead it becomes `ProjectRow`, one component used from both places, and the only differences between the two uses are props: `pinnedStrip` for the accent left border, `stale` for the dimming. `RowMeta` is its fourth cell — the frecency hint and the pin star. Here is `src/components/ProjectTree.tsx` in full:

```tsx
import { useEffect, useImperativeHandle, useState } from 'react';
import Button from './Button';

const col = 'grid grid-cols-[1fr_1fr_80px_52px] items-center text-sm';

const COLUMNS = [
	{ label: 'Workspace', className: '' },
	{ label: 'Location', className: '' },
	{ label: 'File System', className: '' },
	{ label: 'Count', className: 'text-right' }
];

const lastSegment = (path: string) =>
	path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;

const pill =
	'inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-bg-panel border border-border shrink-0';

const REASON_LABEL: Record<UnavailableReason, string> = {
	distro_stopped: 'WSL stopped',
	not_mounted: 'not mounted',
	access_denied: 'no access'
};

const StatusPill = ({ state }: StatusPillProps) => {
	if (!state || state.status === 'live') return null;
	const label = state.reason ? REASON_LABEL[state.reason] : 'unavailable';
	const cached = state.status === 'cached';
	return (
		<span
			className={`${pill} ${cached ? 'text-text-muted' : 'text-danger'}`}
			title={
				cached ? `Showing cached projects — ${label}` : `Unavailable — ${label}`
			}
		>
			{cached ? `cached · ${label}` : label}
		</span>
	);
};

/// The right-hand cell of a project row: its frecency hint and pin star.
const RowMeta = ({ project, rank, onTogglePin }: RowMetaProps) => (
	<div className='flex items-center justify-end gap-1.5'>
		{rank?.hint && (
			<span className='text-[9px] uppercase tracking-wider text-text-muted'>
				{rank.hint}
			</span>
		)}
		{onTogglePin && (
			<Button
				variant='ghost'
				className={`text-xs leading-none p-0.5 hover:scale-110 hover:bg-transparent ${
					rank?.pinned ? 'text-accent' : 'text-text-muted/40'
				}`}
				title={rank?.pinned ? 'Unpin' : 'Pin to top'}
				onClick={e => {
					// The row itself selects on click; pinning must not also select.
					e.stopPropagation();
					onTogglePin(project);
				}}
			>
				{rank?.pinned ? '★' : '☆'}
			</Button>
		)}
	</div>
);

/// One project row — the same element whether it sits in the Pinned strip or
/// under its workspace header; only the left border and the dimming differ.
const ProjectRow = ({
	project,
	selected,
	pinnedStrip,
	stale,
	rank,
	onSelect,
	onDoubleClick,
	onTogglePin
}: ProjectRowProps) => (
	<div
		className={`${col} px-3 py-1.5 cursor-pointer select-none transition-colors ${
			pinnedStrip ? 'border-l-2' : 'ml-6 border-l border-border'
		} ${stale ? 'opacity-60' : ''} ${
			selected
				? 'bg-bg-selected text-text-primary border-l-accent'
				: `text-text-secondary hover:bg-bg-hover/50 ${
						pinnedStrip ? 'border-l-accent/40' : 'border-l-transparent'
					}`
		}`}
		onClick={() => onSelect(project)}
		onDoubleClick={() => onDoubleClick(project)}
	>
		<div className='truncate text-text-muted' title={project.workspace}>
			{lastSegment(project.workspace)}
		</div>
		<div
			className={`font-medium font-mono truncate ${selected ? 'text-text-primary' : ''}`}
		>
			{project.name}
		</div>
		<div
			className={
				project.file_system === 'WSL' ? 'text-accent' : 'text-text-muted'
			}
		>
			{project.file_system}
		</div>
		<RowMeta {...{ project, rank, onTogglePin }} />
	</div>
);

const ProjectTree = ({
	projects,
	selected,
	onSelect,
	onDoubleClick,
	onLaunch,
	query,
	loading,
	workspaceStates,
	ranks,
	pinnedProjects,
	onTogglePin,
	ref
}: ProjectTreeProps) => {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const grouped = new Map<string, Project[]>();
	for (const p of projects) {
		const existing = grouped.get(p.workspace) ?? [];
		existing.push(p);
		grouped.set(p.workspace, existing);
	}

	// Pinned rows come first for keyboard navigation, and are then skipped in
	// the tree below so arrowing down never lands on the same project twice.
	const pinned = pinnedProjects ?? [];
	const pinnedPaths = new Set(pinned.map(p => p.full_path));

	const visible: Project[] = [...pinned];
	for (const [ws, wsProjects] of grouped) {
		if (!collapsed.has(ws)) {
			visible.push(...wsProjects.filter(p => !pinnedPaths.has(p.full_path)));
		}
	}

	const navigate = (dir: 1 | -1) => {
		const idx = visible.findIndex(p => p.full_path === selected?.full_path);
		const next = idx === -1 ? visible[0] : visible[idx + dir];
		if (next) onSelect(next);
	};

	useImperativeHandle(ref, () => ({ navigate }));

	// Searching expands everything; otherwise only the selected workspace stays
	// open. Both were effects that called setCollapsed synchronously, which
	// cascades an extra render on every keystroke. This is React's documented
	// "adjust state while rendering" pattern instead: recompute the moment the
	// inputs actually change, and leave manual toggles alone in between.
	const derivedKey = `${query.trim() ? 'search' : 'browse'}|${
		selected?.workspace ?? ''
	}|${[...grouped.keys()].join('')}`;
	const [lastKey, setLastKey] = useState(derivedKey);
	if (derivedKey !== lastKey) {
		setLastKey(derivedKey);
		setCollapsed(() => {
			if (query.trim()) return new Set<string>();
			const next = new Set<string>();
			for (const [ws] of grouped) {
				if (ws !== selected?.workspace) next.add(ws);
			}
			return next;
		});
	}

	useEffect(() => {
		const launch = () => {
			if (selected) onLaunch(selected);
			else if (visible.length > 0) onLaunch(visible[0]);
		};
		const keys: Record<string, () => void> = {
			ArrowDown: () => navigate(1),
			ArrowUp: () => navigate(-1),
			Enter: launch
		};
		const handler = (e: globalThis.KeyboardEvent) => {
			// Bare keys belong to whatever input has focus, but modifier combos are
			// app-level and must still work while the search box is focused —
			// which is exactly where summon leaves you.
			const mod = e.ctrlKey || e.metaKey;
			const modified = mod || e.altKey;
			if (e.target instanceof HTMLInputElement && !modified) return;
			if (modified) {
				// Ctrl+S rather than bare "s": the search box is the primary input,
				// and a bare letter is unreachable while it has focus.
				if (mod && e.key === 's' && selected) {
					e.preventDefault();
					onTogglePin?.(selected);
				}
				return;
			}
			const action = keys[e.key];
			if (!action) return;
			e.preventDefault();
			action();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selected, visible, navigate, onLaunch, onTogglePin]);

	const stateFor = (ws: string) =>
		workspaceStates?.find(s => s.workspace === ws);

	const toggle = (ws: string) => {
		setCollapsed(prev => {
			const next = new Set(prev);
			if (next.has(ws)) next.delete(ws);
			else next.add(ws);
			return next;
		});
	};

	if (loading) {
		return (
			<div className='flex-1 flex items-center justify-center text-sm text-text-muted'>
				<span className='animate-spin text-lg mr-2'>&#9696;</span>
				Scanning workspaces...
			</div>
		);
	}

	if (projects.length === 0) {
		// "Nothing configured" and "everything is offline right now" are very
		// different situations and must never look the same.
		const blocked =
			workspaceStates?.filter(s => s.status === 'unavailable') ?? [];
		if (blocked.length > 0) {
			return (
				<div className='flex-1 flex flex-col items-center justify-center gap-2 text-sm text-text-muted px-6 text-center'>
					<span className='text-danger font-semibold'>
						{blocked.length === 1
							? '1 workspace is unavailable'
							: `All ${blocked.length} workspaces are unavailable`}
					</span>
					{blocked.map(s => (
						<span
							key={s.workspace}
							className='font-mono text-xs truncate max-w-full'
						>
							{s.workspace} —{' '}
							{s.reason ? REASON_LABEL[s.reason] : 'unavailable'}
						</span>
					))}
					<span className='text-xs'>
						Nothing was cached for these yet. Refresh once they are back.
					</span>
				</div>
			);
		}
		return (
			<div className='flex-1 flex items-center justify-center text-sm text-text-muted'>
				No projects found. Add a workspace to begin.
			</div>
		);
	}

	const workspaces = [...grouped.entries()];

	const rowProps = (project: Project) => ({
		project,
		selected: selected?.full_path === project.full_path,
		rank: ranks?.get(project.full_path),
		onSelect,
		onDoubleClick,
		onTogglePin
	});

	return (
		<div className='flex-1 flex flex-col min-h-0'>
			<div
				className={`${col} px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-text-primary bg-bg-hover/30 rounded-t-md shrink-0 border-b border-border`}
			>
				{COLUMNS.map(({ label, className }) => (
					<div key={label} className={className}>
						{label}
					</div>
				))}
			</div>

			<div className='flex-1 overflow-y-auto'>
				{pinned.length > 0 && (
					<div className='mb-1'>
						<div className='px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted'>
							Pinned
						</div>
						{pinned.map(project => (
							<ProjectRow
								key={`pinned-${project.full_path}`}
								{...{ ...rowProps(project), pinnedStrip: true }}
							/>
						))}
						<div className='mx-3 my-1 border-b border-border' />
					</div>
				)}

				{workspaces.map(([ws, wsProjects]) => {
					const isOpen = !collapsed.has(ws);
					const count = wsProjects.length;
					const fs = wsProjects[0]?.file_system ?? 'Windows';
					const wsState = stateFor(ws);
					const isStale = wsState?.status === 'cached';

					return (
						<div key={ws}>
							<div
								className={`${col} px-3 py-2 cursor-pointer hover:bg-bg-hover/50 select-none`}
								onClick={() => toggle(ws)}
								title={ws}
							>
								<div className='flex items-center gap-2 text-text-secondary min-w-0'>
									<span
										className={`text-xs shrink-0 ${isOpen ? 'text-accent' : 'text-text-muted'}`}
									>
										{isOpen ? '▼' : '▶'}
									</span>
									<span className='truncate font-semibold text-text-primary'>
										{lastSegment(ws)}
									</span>
									<StatusPill state={wsState} />
								</div>
								<div className='text-text-muted truncate' title={ws}>
									{ws}
								</div>
								<div
									className={`font-medium ${fs === 'WSL' ? 'text-accent' : 'text-text-muted'}`}
								>
									{fs}
								</div>
								<div className='text-right text-text-muted font-mono'>
									{count}
								</div>
							</div>

							{isOpen &&
								wsProjects
									.filter(p => !pinnedPaths.has(p.full_path))
									.map(project => (
										<ProjectRow
											key={project.full_path}
											{...{ ...rowProps(project), stale: isStale }}
										/>
									))}
						</div>
					);
				})}
			</div>
		</div>
	);
};

export default ProjectTree;
```

### What changed, piece by piece

- **`ProjectRow`** — the row chapter 03 inlined, lifted out so the Pinned strip and the workspace groups render the same element. `rowProps(project)` builds the props both callers share; each spreads it and adds its one difference.
- **`RowMeta`** — occupies the fourth grid column, the one the workspace header uses for its count. The star is a `ghost` `Button` with `e.stopPropagation()`: the row's own `onClick` selects the project, and without the stop every pin would also move the selection.
- **Pinned first, and only once** — `visible` (the keyboard order) starts with `...pinned`, and `pinnedPaths` is filtered out of each workspace group, so arrowing down reaches pins first and never lands on the same project twice. The `key` in the strip is prefixed `pinned-` because keys must be unique within a parent.
- **The modifier guard** — the keydown handler's first line changed. Chapter 03's `if (e.target instanceof HTMLInputElement) return;` was correct when nothing focused the search box automatically. Now summon leaves the caret there, and a bare guard would swallow **Ctrl+S in the exact state the hotkey always leaves you in**. Bare keys still belong to the input; modifier combos are app-level and pass through. That is also why the binding is Ctrl+S and not a bare `s` — a bare letter is unreachable whenever the search box has focus, which after this chapter is essentially always.

**When a global hotkey lands focus somewhere specific, every in-app shortcut has to work from that position, or it does not work at all.** Every later keyboard chapter has to answer this; the guard above is the shape of the answer.

> **Commit checkpoint**
>
> ```powershell
> git add -A && git commit -m "✅UI: ProjectRow shared by the Pinned strip and the tree, RowMeta hint + star, Ctrl+S pins" && git push
> ```

---

## 9.9 — Verify

```powershell
cd src-tauri
cargo test          # 18 passed
cd ..
bun tauri dev
```

**The summon toggle.** Click into another application so DevGo does not have focus. Press **Ctrl+Alt+Space** — the window appears, focused, caret in the search box. Type a letter; it lands in the box. Press **Ctrl+Alt+Space** again — the window hides (this is the `ShortcutState::Pressed` guard doing its job; if it flickers and stays, the guard is missing). Press once more — it is back, and the search box is **empty**, even though you typed into it. If it still shows your old query, the `devgo://summoned` listener is not clearing it.

**Ranking.** Launch a project. Summon again — `onFocusChanged` triggers a rescan — and that project is at the top with a `recent` badge. Click **sort: frecency** to flip to **sort: A–Z**; toggle back; quit and relaunch and the mode survived.

**Pinning.** Select a project and press **Ctrl+S** *immediately after summoning, without clicking anywhere first* — that is the state where the old input guard silently swallowed it. A **Pinned** section appears above the tree with that project and a filled ★, and it is gone from its workspace group — it must appear exactly once. `prefs.json` has a `pinned` array with that path and a `project_stats` entry for everything you launched. Ctrl+S again: star empties, section disappears.

**Keyboard order.** With something pinned, arrow down from the top: the first stop is the pinned row, then the groups, never the pinned project a second time.

**The hotkey is optional.** Bind Ctrl+Alt+Space in another application first, then start DevGo from a terminal: `[DevGo] summon hotkey 'Ctrl+Alt+Space' unavailable: …` — and DevGo starts anyway.

> **Commit checkpoint** — Stage commit, then merge the chapter into `main`:
>
> ```powershell
> git add -A
> git commit -m "✅STAGE: 09 summon-rank"
> git push
> git checkout main
> git merge 09.summon-rank
> git push
> ```

---

## What you built

```
src-tauri/src/
├── summon.rs                ← NEW: register / toggle / show_and_focus
├── commands.rs              ← ProjectRank, ranks in the payload, record_launch, toggle_pin  (13 commands)
├── lib.rs                   ← global-shortcut plugin + hotkey registration in setup
└── services/
    ├── frecency.rs          ← NEW: score, hint, recency_weight  (6 tests)
    └── preferences.rs       ← ProjectStat, project_stats, pinned, summon_hotkey,
                                record_launch, toggle_pin, retain_known  (5 tests)
src/
├── types.d.ts               ← ProjectRank, ProjectsPayload.ranks, SortMode, row props
├── App.tsx                  ← devgo://summoned listener, searchRef, pin wiring
├── hooks/useProjects.ts     ← ranks map, sortMode, toggleSort, togglePin, pinnedProjects
└── components/
    ├── SearchBox.tsx        ← ref prop, autoFocus, Escape-clear, sort toggle
    └── ProjectTree.tsx      ← ProjectRow + RowMeta, pinned strip, Ctrl+S, modifier guard
```

> **The thread running through Slice 1.** Every decision in this chapter defends the same property: **a launcher must behave identically every single time you summon it.** The bucketed recency curve exists so the order does not drift while you are not looking. The cleared query exists so the second summon looks like the first. The modifier guard exists so your shortcuts still work from the position the hotkey puts you in. Individually they are small; together they are the difference between a tool you reach for without thinking and one you have to look at first.

→ Next: [10 — Git at a Glance](./10-git.md) — branch and dirty state on every row, without ever booting WSL.
