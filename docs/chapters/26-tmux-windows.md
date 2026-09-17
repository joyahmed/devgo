# 26 — Your tmux, Not Mine (post-plan)

**Branch:** `26.tmux-windows` — `git checkout 26.tmux-windows` gives you this chapter's finished app; `git diff 25.launch-surface 26.tmux-windows` is exactly what this chapter adds.

**Starting from:** chapter 25 — any registered editor or terminal launches from the row, the palette or a right-click. When one of those terminals opens a WSL project it gets a tmux session with three windows called `code`, `agents` and `git`, because those three names are written into a Rust string literal and have been since chapter 05.

**Goal:** make that list yours — an ordered list of window names in Settings, reconciled into the session on every launch rather than decided once and frozen — and a switch that turns tmux off altogether.

> **Hold on to:**
> 1. **A config the existence-check silently ignores is indistinguishable, from the chair, from a config that does not work.** `if ! tmux has-session` wrapped every window creation, so the layout was decided the first time you launched a project and frozen. Reconcile per window; never kill, rename or prune.
> 2. **A name that reaches a shell is a string somebody else wrote.** Single quotes are the only bash quoting that is wholly literal; `sh_quote` is six lines and it is the difference between a setting and `tmux kill-server` arriving through the front door.
> 3. **`DefaultHasher` is not stable across releases.** A session name that changes under you is a session you can never reattach to. FNV-1a is six lines.
> 4. **When you test a bug you fixed, ask whether the test would have failed before.** Twelve of the thirteen script tests here would pass with the frozen-layout bug restored; the thirteenth asserts *where* the blocks sit.
>
> Rust: `#[serde(default = "fn_name")]` versus `#[serde(default)]` (`bool::default()` is `false`); `struct update syntax` in tests (`TmuxConfig { enabled: true, ..off }`); building a script from an iterator of blocks so a test can count them. TypeScript: nothing new — one more panel in the registry.

> The feature here is four lines of config. The chapter is about the guard sitting on top of it. Three more bugs were already in the file this opens, and two more went in with the new code and came out in review — all six have the same shape: nothing errors, nothing logs, and the only evidence is a window that is not there, or a shell in the wrong directory.

---

## 26.1 — A name list, not a count

The reflex when you make three hardcoded things configurable is to make the *number* configurable. Try it and read what comes out: `code`, `agents`, `git`, `window4`, `window5`. The three names carry the meaning; the number carries none. So the setting is the ordered list of names, and the count is its length. In `preferences.rs`, above `MonitorRect`:

```rust
// the three windows a WSL launch has always opened, same names, same order,
// so an upgrade into this setting is invisible
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

/// The tmux windows a WSL launch opens, in order. A name list, not a
/// count: "how many" would produce code, agents, git, window4, window5.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TmuxConfig {
    /// Off means one plain login shell in the project directory, no tmux.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_window_names")]
    pub window_names: Vec<String>,
}
```

with an `impl Default` built from the same two functions, and `#[serde(default)] pub tmux_config: TmuxConfig` on `Preferences` after `scan_config`. `enabled` is typed with the struct rather than bolted on a section later, because the serde decision is the interesting one and it is the same decision whenever the field arrives: `#[serde(default)]` on `enabled` would have been the obvious thing to write and it would have switched tmux **off** for every existing install the first time it read a `prefs.json` written before the field. A new setting must never change what an existing install does. And the defaults on both fields are not politeness — chapter 22's `parse_or_backup` sends a file that fails to deserialize to `.bak`, so a field without one does not add a setting, it throws away everyone's configuration on upgrade.

> `✅PREFS: tmux window list`

The store:

```rust
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
```

Two tests: a `prefs.json` with pins, a hotkey and a scan config but no `tmux_config` loads with `TmuxConfig::default()` **and keeps its pins**, with no `.bak` beside it — asserting the other fields survived is what makes a lost serde default loud here instead of on someone's machine. And `["  code  ", "", "   ", "agents", "code", "\tgit\n"]` comes back as `code, agents, git`, while `[" "]` comes back **empty**: "no named windows" is a real answer, and quietly restoring the default would make it unsettable.

> `✅PREFS: tmux config getter and setter` — **80** tests.

## 26.2 — The list reaches the script, and the trap arrives with it

`launcher.rs` cannot read preferences and should not learn how — its imports are `AppError`, `Project`, `RuntimeInfo`, `LaunchTarget`; no `AppState`. So the config travels the way `RuntimeInfo` already does: cloned out of the mutex in `commands.rs` and passed down as a value. `launch_target`, `launch_both` and `write_tmux_script` gain a `tmux: &TmuxConfig` parameter, and in `commands.rs` every launch reads it:

```rust
    let info = state.runtime_info.lock().map_err(lock_err)?.clone();
    // the guard dies on this line: resolve_target locks pref_store itself
    let tmux = state.pref_store.lock().map_err(lock_err)?.tmux_config();
    let target = resolve_target(&state, TargetKind::Editor, target_id)?;
    launcher::launch_target(&target, &project, &info, &tmux)?;
```

The guard is dropped on the line it is created on, deliberately: `resolve_target` locks `pref_store` itself, so holding that lock one line longer is a self-deadlock. `open_both` and the tray call `launch_project_default` and change not at all, which is the payoff for that function existing.

Then the script builder gets the list — and here is the commit worth reading with the question "when does this run?" rather than "what does this do?":

```rust
    let create = match windows.next() {
        Some(first) => format!(
            "    tmux new-session -d -s \"{session}\" -n \"{first}\" -c \"{linux_path}\"\n"
        ),
        None => format!(
            "    tmux new-session -d -s \"{session}\" -c \"{linux_path}\"\n"
        ),
    };
    let rest: String = windows
        .map(|name| {
            format!(
                "    tmux new-window -t \"{session}:\" -n \"{name}\" -c \"{linux_path}\"\n"
            )
        })
        .collect();
    format!(
        r#"#!/usr/bin/env bash
if ! tmux has-session -t "{session}" 2>/dev/null; then
{create}{rest}fi
tmux attach -t "{session}"
"#
    )
```

This is the setting wired straight into the three lines it replaces, and it works perfectly — on projects you have never launched. The `if` is correct on the day you first open a project and wrong every day after: a session that exists satisfies it *with whatever layout it happens to have*, so the creations inside it never run again. Set five windows, relaunch, count three, conclude the feature is broken. The test that lands with this commit — the shipped default still produces `code`, `agents`, `git` in that order — passes, and would go on passing forever. The commit is here on purpose; §26.4 is where it gets fixed, and the test that catches it is the one to remember.

> `✅LAUNCH: the window list reaches the script`

## 26.3 — Two projects called `api`, and a script nobody asked for

The session name was `project.name`, verbatim, and only the *filename* went through `sanitize_file_stem`. So two projects called `api` in different workspaces shared one tmux session and one temp script: launch the second and you attach to the first one's shell, in the first one's directory. Nothing warns. Both now go through one function, and the disambiguator is a hash of the project's path:

```rust
fn tmux_session_name(project: &Project) -> String {
    format!(
        "{}-{}",
        sanitize_file_stem(&project.name),
        path_suffix(&project.full_path)
    )
}

/// FNV-1a over the normalised path, written out rather than DefaultHasher:
/// that one is not stable across Rust releases, and a session name that
/// changes under you is a session you can never reattach to. Lowercased and
/// slash-flipped because Windows spells the same directory several ways.
fn path_suffix(path: &str) -> String {
    let normalized = path.to_lowercase().replace('\\', "/");
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in normalized.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:08x}", (hash & 0xffff_ffff) as u32)
}
```

`sanitize_file_stem` was already mapping everything outside `[A-Za-z0-9_-]` to `-`, which happens to cover `.` and `:` — the two characters tmux treats specially in a target. That is luck rather than design, and it is load-bearing now; the test says `my.app:2` becomes `my-app-2-…`, `api` in `work` and `api` in `play` differ, and `//WSL.LOCALHOST/…/api` equals `\\wsl.localhost\…\api`. `write_tmux_script` names the file `devgo-{session}.sh` from the same string.

> `✅LAUNCH: one session per project path`

The second fossil:

```rust
        let script = if target.kind == TargetKind::Terminal {
```

ran before anything looked at the template. A custom terminal whose args ignore `{script}` — perfectly reasonable, it just opens the directory — got a `devgo-*.sh` in `%TEMP%` that nothing read and nothing ever deleted. The kind was standing in for a question it could not answer. Resolve first, then ask the template:

```rust
    // the template decides, not the kind: a terminal whose args ignore
    // {script} used to get a devgo-*.sh in %TEMP% that nothing ever read
    let args = match (&wsl, args.contains("{script}")) {
        (Some((distro, linux_path)), true) => {
            let script = write_tmux_script(project, distro, linux_path, tmux)?;
            args.replace("{script}", &script)
        }
        _ => args,
    };
```

`TargetKind` leaves the non-test imports of `launcher.rs` entirely, which is the tell that the guess is gone. Two tests pin the contract that had only ever lived in a comment: `LaunchTarget::resolve` knows `{path}`, `{distro}`, `{linux_path}`, `{command}` and **not** `{script}` — the launcher fills that one afterwards, with a file it really wrote (proved with `cmd /c echo {script} > marker`, not a distro) — and a terminal whose template has no placeholder leaves no file behind.

> `✅LAUNCH: the template asks for the script, not the kind`

## 26.4 — Reconcile, exactly, quoted

Three fixes in one builder, because they are one function:

```rust
fn build_tmux_script(
    session: &str,
    linux_path: &str,
    tmux: &TmuxConfig,
) -> String {
    let windows = &tmux.window_names;
    let session_q = sh_quote(session);
    // every -t carries `=`: tmux matches a target by prefix otherwise, and
    // has-session -t app is satisfied by a running app-api. new-session -s
    // is the exception, it names something that does not exist yet
    let exact_q = sh_quote(&format!("={session}"));
    let target_q = sh_quote(&format!("={session}:"));
    let path_q = sh_quote(linux_path);

    // an empty list is one plain window: new-session always makes one, and
    // the default is not quietly put back
    let create = match windows.first() {
        Some(first) => format!(
            "    tmux new-session -d -s {session_q} -n {} -c {path_q}\n",
            sh_quote(first)
        ),
        None => format!("    tmux new-session -d -s {session_q} -c {path_q}\n"),
    };

    // -F: a name is a literal, not a regex. -x: git must not match a
    // hand-made git-log. --: a name like -log is otherwise read as options,
    // grep exits 2, `if !` reads that as "not found", and the window is
    // created again on every launch
    let reconcile: String = windows
        .iter()
        .map(|name| {
            let name_q = sh_quote(name);
            format!(
                "if ! tmux list-windows -t {exact_q} -F '#W' 2>/dev/null | grep -Fxq -- {name_q}; then\n    tmux new-window -t {target_q} -n {name_q} -c {path_q}\nfi\n"
            )
        })
        .collect();

    format!(
        r#"#!/usr/bin/env bash
if ! tmux has-session -t {exact_q} 2>/dev/null; then
{create}fi
{reconcile}tmux attach -t {exact_q}
"#
    )
}

/// One single-quoted bash word. Names are typed by a person, or arrive from
/// an imported file: in double quotes, `a"; tmux kill-server; #` is a working
/// way to destroy every session, and one stray `"` is a syntax error that
/// stops every WSL launch. Single quotes are wholly literal; the one
/// character they cannot hold is `'`, which closes, escapes and reopens.
fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}
```

**Reconcile, per window.** Stop asking "does this session exist" and ask, for each name, "is this window here". It is `windows.iter()`, not `.skip(1)`: the first name is created by `new-session -n` inside the guard, so skipping it looks like avoiding a duplicate — but on a session that already exists `new-session` never runs, so the first name gets created by nothing. Put a new name at the top of your list and that one name is the one that never appears: the bug this section exists to kill, surviving at index 0. The one rule the loop must never break is that it only ever adds. A `logs` window someone made by hand is theirs; "make the session match the list exactly" is the most natural-sounding edit anyone will ever propose here, and there is a test whose whole job is to fail when that edit arrives.

**Exactly.** tmux resolves a `-t` target by prefix when nothing matches exactly, so while `app-api` is running, `has-session -t "app"` succeeds — DevGo skips creating `app`'s session and `attach` drops you into `app-api`. `=` forces an exact match, and every `-t` carries it. `new-session -s` must not: it names something that does not exist yet, and an `=` there ends up *inside* the name.

**Quoted.** Everything above builds and passes, all gates green, and review asks one question: what does the script do with a window name containing a `"`? `a"; tmux kill-server; #` — which kills every session on the machine, arriving through the front door as a setting, or through `import_config_from_file` from a JSON file somebody else wrote. Even an innocent `"` is a catastrophe: bash parses the **whole file** before executing any of it, so one unbalanced quote means no session, no `attach`, a terminal that flashes an error and closes. The project's path goes through the same function, and it is not hypothetical — a directory called `back$up` is legal on Linux; unquoted, `$up` expands to nothing and tmux is handed a directory that does not exist.

Nine tests, and one of them is the reason the trap in §26.2 was committed rather than skipped. Eight assert with `contains` or `matches().count()` over one flat string — the custom list appears in order with `-c` on every window, an empty list names nothing, every `-t` is `'=…'` except `-s`, no `kill-*` or `rename-*` anywhere, `grep -Fxq -- '-log'`, the hostile name occurs exactly three times and only inside its quotes, `'it'\''s'`, `-c '…/back$up'` with the `$` intact, two `api` projects write two files. Move the `new-window` blocks back inside `if ! tmux has-session … fi` — restore the frozen-layout bug exactly — and **all eight still pass**. Nothing any of them looks at has changed. What makes reconciliation work is *where* the blocks sit:

```rust
    #[test]
    fn the_reconcile_blocks_sit_outside_the_has_session_guard() {
        let script = build_tmux_script(
            "app-deadbeef",
            "/srv/app",
            &tmux_with(&["code", "git"]),
        );
        let fi = script.find("\nfi\n").expect("the guard closes");
        let first_reconcile =
            script.find("tmux list-windows").expect("reconciles");
        assert!(first_reconcile > fi, "back inside the guard: {script}");
        assert_eq!(
            script[..fi].matches("tmux new-window").count(),
            0,
            "{script}"
        );
    }
```

When you write a test for a bug you just fixed, the question is not "does this assert the new behaviour". It is "would this have failed before". `git checkout 792261f` and run it.

> `✅LAUNCH: sessions reconcile their windows` — **93** tests.

## 26.5 — "Off" is not "one window"

The setting shipped as a window list, and the first question it got back was the one that matters: *should tmux be the default at all — what if I only ever use one tab?* Two answers look equivalent and are not. An empty window list is already legal and opens a tmux session with a single unnamed window. That is still tmux: a server starts, `attach` runs, and a session outlives the tab you close it from. Somebody who does not want tmux does not want a tidier tmux. So the branch is the first thing the builder does:

```rust
    // off is no tmux, not tmux with one window: an empty list still starts
    // a server and leaves a session behind. exec so exiting closes the tab,
    // -l so the profile is read; doubled braces because this is a format
    if !tmux.enabled {
        return format!(
            r#"#!/usr/bin/env bash
cd {} || exit 1
exec "${{SHELL:-bash}}" -l
"#,
            sh_quote(linux_path)
        );
    }
```

Three tests: off produces no `tmux` at all, a `cd` into the quoted path and `exec "${SHELL:-bash}" -l`; a list left over from before the switch was turned off is ignored while off and still there when it comes back (the same config, built both ways); and `{"window_names":["code","agents"]}` with no `enabled` key parses **on**.

> `✅LAUNCH: off means a plain shell` — **96** tests.

## 26.6 — Commands, and the import that would have refused every old file

`get_tmux_config` and `set_tmux_config`, registered after `set_scan_config`, in the shape of their scan counterparts. Saving takes effect on the next launch — the script is built per launch, so there is nothing to signal and no rescan to trigger.

`PortableConfig` gains `tmux_config`, exported and applied wholesale on import like `scan_config` — an older file resets the layout to the default three, and importing a config is a deliberate "make this machine look like that one". And a latent bug from chapter 19 goes with it: `serde_json::from_str` into a struct with a missing non-default field is a hard error, so a file exported before `scan_config` existed did not import *partially*, it did not import **at all**. Both fields carry `#[serde(default)]` now.

> `✅CMD: tmux config commands`

## 26.7 — The panel

`TmuxConfig` in `types.d.ts` — snake_case, because the Rust struct has no `rename_all` and the wire field really is `window_names` — and a `TmuxPanel` in `Settings.tsx` between Scanning and Shortcuts, in the shape of `ScanningPanel`: a fetch on mount that also sets `text` on the failure path (`text === null` is what disables the controls, so a backend error must not leave a textarea nobody can type into); a save that splits on **newlines only** — `ScanningPanel` also splits on commas because a folder name never contains one, and a tmux window name legitimately can; and no `onSaved`, because a window list is not scan input and the only "changed" channel Settings hands a panel re-walks every workspace. Success is a line under the button, like ConfigPanel.

The switch comes first and the list dims under it — a live, editable text box under a disabled feature is a promise the app is not keeping:

```tsx
	const modes = [
		{ value: true, label: 'tmux session' },
		{ value: false, label: 'Plain shell' }
	];
```

```tsx
					{modes.map(m => (
						<Button
							key={m.label}
							variant='target'
							aria-current={enabled === m.value ? 'true' : undefined}
							onClick={() => setEnabled(m.value)}
							disabled={text === null}
						>
							{m.label}
						</Button>
					))}
```

Chapter 25's `target` variant — a labelled choice whose current one says so with `aria-current` — is exactly this control, so it is reused rather than an eleventh variant minted for two buttons. The textarea is `disabled={text === null || !enabled}` inside a `div` that goes `opacity-50` when off.

> `✅UI: tmux panel`

## 26.8 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **96** — chapter 25's 78 plus two for the store and sixteen for the launcher. Then, with the four config files backed up and the distro **started for the test**:

**The panel.** `bun tauri dev`, Settings → tmux. The panel shows what `prefs.json` holds (an installed DevGo may already have `tmux_config`, possibly off). Choose *tmux session*, replace the box with `code`, `logs`, `db`, *Save*: *Saved. Takes effect on the next launch.*, and `prefs.json` reads `{"enabled": true, "window_names": ["code", "logs", "db"]}`.

**Reconcile.** `open_terminal` a WSL project (Windows Terminal opens on it). From PowerShell, `wsl -d Ubuntu-26.04 -e bash -lc "tmux ls -F '#S'"` names one session, `shop-6ca30377` here — the project name plus eight hex digits — and `tmux list-windows -t '=shop-6ca30377' -F '#W'` prints `code`, `logs`, `db`. Now put a new name **first** — `extra`, `code`, `logs`, `db` — save, and launch the same project again: `list-windows` prints `code`, `logs`, `db`, `extra`. The three you had were left alone; the one you added at index 0 arrived — the case `skip(1)` would have lost. `%TEMP%\devgo-shop-6ca30377.sh` is the script from §26.4, every value single-quoted, every `-t` starting with `=`.

**Off.** *Plain shell*, *Save*: the textarea greys out. Launch again: the script is three lines — `cd '/home/user/…' || exit 1` and `exec "${SHELL:-bash}" -l` — and `tmux ls` shows no new session.

Close the terminal windows the launches opened, `tmux kill-server` in the distro, `wsl --shutdown`, restore the four files.

> `✅STAGE: 26 tmux-windows`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/preferences.rs   TmuxConfig (enabled, window_names); tmux_config / set_tmux_config; 2 tests
  src/services/launcher.rs      tmux threaded through; tmux_session_name + path_suffix; template decides;
                                build_tmux_script reconciles, exact, quoted, off branch; sh_quote; 16 tests
  src/commands.rs               get/set_tmux_config; PortableConfig defaults + tmux_config
  src/lib.rs                    two commands registered
src/
  types.d.ts                    TmuxConfig, TmuxPanelProps
  components/Settings.tsx       TmuxPanel
```

The tmux windows a WSL launch opens are an ordered list you edit in Settings, reconciled into the session on every launch — so changing the list changes what you get, on projects you have opened a hundred times, without ever touching a window you made yourself. Or no tmux at all, if that is how you work.

> **The thread running through this chapter.** Every one of the six bugs was silent: a frozen layout, a prefix match on the wrong session, two projects on one session, a script nobody read, a name that ran as a command, a path that expanded to nothing. **Four green gates found none of the last two — one question about one character did.** And the test worth keeping is the one that would have failed before the fix, because the other twelve would not have.
