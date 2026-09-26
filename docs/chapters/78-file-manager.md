# 78 — The File Manager You Chose

**Branch:** `78.file-manager` — `git checkout 78.file-manager` gives you this chapter's finished tree; `git diff 3c6a6c5 78.file-manager` is exactly what this chapter adds.

**Starting from:** `main` after 76 and the whole Linux season (`3c6a6c5`). Written from the public work itself.

**Goal:** *Reveal in Explorer* was the last hardcoded program in DevGo. Editors, terminals and agents have been a registry since 13 — a row in `targets.json`, a default you pick in Settings, a menu that lists what you registered — while the file manager was a program name written into `commands.rs` behind a `#[cfg]` per platform. This chapter makes it the fourth `TargetKind`: Explorer and Finder become seeded rows like `code` and `wt`, the reveal key goes through whichever manager you made the default, a second one shows up as its own row on every reveal menu, and that menu puts the default first rather than whatever was registered first.

Then the second half, which is the harder one. A file manager is the one kind of program nobody puts on `PATH`, so a registry that can only be filled by typing a path is a registry most people will leave alone. The Add form grows a *Browse…* button and the store learns to refuse a path with nothing at it — and `detect()` grows a second door, the Windows Start Menu shortcut, which is the only machine-readable record an installer is obliged to leave behind. The worked example throughout is **Trove**, a Tauri file manager built in the folder next door, which is installed on this machine at `E:\Softwares\Trove\trove.exe` and appears nowhere on `PATH`, in no registry key, and under no shell verb.

## Also since 76

A great deal, because 76's branch and this one are far apart on `main`.

- **The Linux season, with no chapter of its own.** `116e59c ✅LINUX: not windows never meant macos` split the mac tables from the Linux ones; `c5e279c` and `036848a` gave Linux a terminal row that really opens a tmux session; `0167f08` pinned that a box with no emulator seeds no terminal row at all; `6ed2451` taught the UI which desktop it is on; `b1b4e1e` made the install advice match the platform; `427ac49 ✅LINUX: a v1.1.0 install loses the mac terminal row` is the migration §78.4 is modelled on.
- **Four releases.** `ab97192 v1.1.0`, `a877419 v1.1.1`, `fa27d68 v1.2.0 — linux is a first class platform`, `1112bc0 v1.2.1`.
- **The mac launch path.** `89b4d92 ✅LAUNCHER: the generated script gets the login PATH`, `5565a4e` and `d8895ae` on ghostty, `3c6a6c5 ✅LAUNCHER: the launched window says what it is running, in colour`.
- **Two fixes this chapter leans on.** `013d59a ✅FIX: a wsl path with a space opened the wrong folder` — the same family as §78.3, one layer out; `ec113bb ✅UI: the settings drawer has room for a real path`, which is the drawer the Add form lives in.
- **`e5ed762 ✅UI: the footer keys are big enough to read`** landed on `main` while this branch carried a byte-identical copy of it. The rebase onto `3c6a6c5` dropped ours by patch-id, so the footer work belongs to `main` and is not in this diff. It was 17 commits rebased, not 18, and nothing was lost.

And a fair amount rode this branch that is **not** this chapter's subject, because the branch stayed open while other work needed somewhere to land:

- **`✅LAUNCHER: the script searches the login path before the fallbacks`** and **`✅TEST: the detector and the launcher must reach the same binary`** repair `89b4d92`: the generated `.command` appended the login PATH after `$PATH:/usr/local/bin`, so a name living in both — a homebrew `node` over an nvm one — resolved to a *different file* than `editors::path_lookup` had detected. `mac_path_line(login)` is the pure line, the fallbacks now trail, and two tests hold it: a position test everywhere, and, off Windows, one that runs the generated line through bash and compares `command -v` against what `editors::first_on_path` resolved. That `first_on_path` extraction is the only place the two halves of this chapter touch that work — it is the same one-rule-two-readers argument, applied to `PATH` instead of to the Start Menu.
- **`✅LINT: four findings clippy had been carrying`** and **`✅LINT: the test module moves to the end`** clear the last of `clippy --all-targets -- -D warnings`. The judgement worth keeping is `github.rs`: the `assert!(TRAFFIC_STALE_SECS < STALE_AFTER_SECS)` clippy called a tautology is a real invariant between two independently editable consts, so it became a `const { assert! }` — a compile error now, which is stronger than the runtime assert it replaced.
- **`✅GATE: one script the repo owns`** adds `scripts/verify.sh` — two cheap tiers before every commit, a third behind `--full`, and a closing list of what this repo has no way to check at all. Its header numbers are a *measurement* of the tree it was wired against, not a target: re-measure rather than trusting them, because a baseline goes stale the moment the toolchain moves.
- **`✅UI: the clone drawer stops trapping the keyboard`** root-causes four ClonePicker defects, of which the first is a genuine keyboard trap: every repo row was a native checkbox with no `tabIndex`, so 388 repos meant 388 tab stops between the search box and the destination. It is a roving-tabindex listbox now. Its third defect shares a file with this chapter only by accident — `Select.tsx`'s first-letter jump searched the accumulated buffer whole, so a second `w` searched `ww`, matched nothing and stuck.
- **`✅FIX: a second copy of devgo raises the first window, from whatever state it is in`** is `summon::raise_main`, and the find under it is the one to remember: the raise had been written **four** times and two copies had drifted, so the tray and the single-instance restore did `show` then `set_focus` with no `unminimize` and no app-level unhide. `set_focus` guards itself on *visible && not minimized* and returns `Ok(())` when it skips.

> **Hold on to:**
> 1. **A kind's wire name is not its `Debug` spelling.** The default-target map was keyed with `format!("{kind:?}").to_lowercase()`, which agreed with serde only while every variant was one word. `FileManager` debug-prints as `filemanager`; serde, renaming to snake_case, writes `file_manager`, and so does the frontend's union. The key would have missed, the *default* badge would never have appeared, and **nothing anywhere would have errored** — not a panic, not a log line, not a type error in either language. `TargetKind::wire()` is the one spelling now, and a test asserts it is the one serde writes, in both directions, for every variant.
> 2. **A second invocation of one target, not a second target.** A terminal has a run form as well as an open form; a file manager has a *reveal* form — the item selected inside its parent — as well as an open form. Same row, same executable, another template: `reveal_args_template`, resolved by `resolve_reveal`. `None` is a real answer rather than a gap: no Linux file manager has a portable verb for selecting an item, and `reveal_line` then opens the containing folder rather than pretending it selected something.
> 3. **Installed is not the same as findable.** `PATH` is a convention a program may simply decline to join, and a GUI application usually does. Nothing else on this machine records where Trove went — no `App Paths` key, no Uninstall entry, no shell verb, no predictable directory, because the user put it on `E:`. The one machine-readable record an installer leaves is `Start Menu\Programs\<name>.lnk`, and its `TargetPath` is the answer. Which makes the *name of that shortcut* a published interface between two programs, and it is treated as one: DevGo matches the stem `Trove` exactly, Trove's `installer.nsi` was read to confirm the name carries no version, and a change on either side is a thing the other must be told about.

---

## 78.1 — A fourth kind, and the name serde writes

`src-tauri/src/models/target.rs`. `LaunchTarget` gains one field, `reveal_args_template: Option<String>` under `#[serde(default)]`, with the reason in the doc comment: the reveal mode is to a file manager what the run mode is to a terminal, one target and two invocations, so it is a template on the row rather than a second row.

`TargetKind` gains `FileManager`, and with it two things the enum never had. `pub const ALL: [Self; 4]` — *"every kind, so the places that must cover all of them — the default map, a portable config — cannot quietly miss one"*. And `wire()`, a `match` from variant to string, with the trap written down above it in full, because the trap is invisible at runtime and a comment is the only place it can be caught.

`resolve_reveal(&self, path)` is the reveal twin of `resolve` and `resolve_run`, and it is deliberately the shortest of the three: no WSL pair, because *"a WSL project is revealed through its UNC path, which is already the Windows path the template takes"*. An empty template means the same as `None` — that is what the Add form sends for a blank field — so it filters on `!t.is_empty()` before substituting.

Then the seeds. Windows gains an `explorer` row (`File Explorer`, executable `explorer`, args `"{path}"`) whose reveal template is *also* `"{path}"`, and the comment says why the obvious switch is not used:

```rust
// the folder itself, not /select: the switch exists, but the
// UNC path of a WSL project does not survive it, and those are
// half of what DevGo reveals
reveal_args_template: Some("\"{path}\"".into()),
```

A Mac gains `finder`: executable `open`, args `-a Finder "{path}"`, reveal `-R "{path}"` — `-R` being the parent window with the item highlighted, the one reveal verb a file manager on any platform here really has. `-a` names the app rather than letting the desktop answer, the same call 55 made for `Terminal.app`. Linux calls `editors::first_file_manager()` beside `first_terminal()`, and a box with neither gets neither row.

Three tests. `every_kinds_wire_name_is_the_one_serde_writes` round-trips every variant through serde and additionally asserts `wire() != format!("{:?}").to_lowercase()` for `FileManager`, so the trap itself is pinned and not merely avoided. `a_file_manager_is_seeded_and_is_never_the_mac_door_on_linux` — one row on Windows and a Mac, at most one on Linux, and on Linux never `open`, because `open` there is `xdg-open`, which rejects `-R`; that is the exact shape of the bug that left the Linux reveal key silently dead before. `the_reveal_template_is_a_second_form_of_the_same_target` pins that the folder form is untouched by the reveal form, and that both `None` and `Some("")` mean *no verb*.

## 78.2 — Reveal stops being a program name

`src-tauri/src/commands.rs`. `reveal_command(path, select)` — a `#[cfg]` block per platform returning `("explorer", vec![path])` or `(OPENER, …)` — is gone, and with it the last hardcoded program in the app. In its place, two steps, the first of them pure:

```rust
fn reveal_line(
    target: &LaunchTarget,
    path: &str,
    select: bool,
) -> Option<(String, String)> {
    if !select {
        return target.resolve(path, None);
    }
    target.resolve_reveal(path).or_else(|| {
        let parent = std::path::Path::new(path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string());
        target.resolve(&parent, None)
    })
}
```

That `or_else` is the whole Linux story and half the Windows one in a single branch: a manager with no selecting verb opens the containing folder, which is the closest honest thing. `reveal_path(state, path, select, target_id)` resolves the target through the existing `resolve_target(state, TargetKind::FileManager, target_id)` — the same fallback chain the editor button uses, so a default pointing at a deleted row falls through to the first of its kind — and hands the line to `launcher::spawn_raw`. Reveal goes through the one spawn helper now instead of a bare `Command::new`, which is what gives it §78.3's quoting for free. A target with no template at all is `AppError::ActionRefused` naming the manager, not a silent nothing.

`reveal_in_explorer` keeps its name and gains `target_id: Option<String>` and the state handle: the frontend relabels the button, not the door. `reveal_app_data_dir` passes `select: false` and no id — the folder itself, never selected in its parent, because nobody asked to see where roaming keeps its subdirectories.

Two repairs ride along, both of them consequences of `wire()`. `resolve_target`'s not-found error built its message with `{kind:?}`; it uses `kind.wire()` now, so what a user reads is `file_manager` and not `FileManager`. And `get_default_targets` iterates `TargetKind::ALL` keyed by `wire()` instead of a hand-written three-element array keyed by `Debug` — that array being the second place the new kind would have been forgotten.

`PortableConfig` gains `default_agent` **and** `default_file_manager`, both `#[serde(default)]`, plus a `defaults()` method returning `[(TargetKind, Option<String>); 4]` that export writes and import walks. The agent's default had been travelling in neither direction since 45, silently, and nothing said so; listing every kind in one place is what fixes that and what stops the next kind repeating it. `a_portable_config_round_trips_every_default` asserts the kinds `defaults()` yields are exactly `TargetKind::ALL`, and that a file exported before the two later fields still imports.

The platform reveal tests stay one per platform and now read the seeded row rather than a hardcoded pair: `windows_reveals_the_folder_itself_either_way` (both shapes, the UNC path inside the quotes the template puts round it), `a_mac_reveals_with_open_dash_r`, `linux_reveals_through_its_file_manager_and_never_with_r`. A fourth, `a_manager_with_no_reveal_template_opens_the_parent`, covers the `or_else`.

> `✅TARGETS: the file manager is a target you can switch`

## 78.3 — The line cmd never ran

`src-tauri/src/services/launcher.rs`. A file manager is registered with an absolute path, and the paths installers write have spaces in them. `cmd /c C:\Program Files\Trove\trove.exe "G:\dev\app"` launches `C:\Program`, prints a complaint into a window nobody sees, and `spawn_raw` returns `Ok`. So `shell_command` stops formatting its own line and asks for one:

```rust
#[cfg(windows)]
fn cmd_line(exe: &str, args: &str) -> String {
    if exe.contains(' ') {
        format!("/c \"\"{exe}\" {args}\"")
    } else {
        format!("/c {exe} {args}")
    }
}
```

Quoting the exe alone is not enough. With more than two quotes on the line `cmd` strips the first and the last, so the pair round the *whole* line is what puts the exe's own quotes back. Only an exe that needs it gets them, so every line that works today is still the same bytes — the same rule 13 set when it chose `raw_arg` over `args`.

Two tests, and the second is the one that matters. `a_spaced_exe_path_is_quoted_for_cmd` pins the string and pins that a bare `code` is unchanged. `a_spaced_exe_path_really_launches` writes `my probe.bat` into a directory whose own name has a space, spawns it through `spawn_raw` with a redirection into a marker file, and waits for the marker to have **bytes** in it. The empty file is what makes the assertion honest: `cmd` creates the redirect target either way, and only a program that really ran puts anything in it.

## 78.4 — A registry from before the kind existed

`src-tauri/src/services/target_store.rs`. Reveal used to need no row, so every `targets.json` on every machine that already has DevGo has none — and the reveal key would answer *no such target* on all of them. `adopt_file_manager_row` seeds the platform's own row into such a file, once, and *once* is the interesting part:

```rust
// whether this file was written by a version that knows what a file
// manager is: every row serialises reveal_args_template, so its
// absence dates the whole file. see adopt_file_manager_row
let mut knows_file_managers = true;
let targets: Vec<LaunchTarget> = if file_path.exists() {
    let data = fs::read_to_string(&file_path)?;
    knows_file_managers = data.contains("\"reveal_args_template\"");
```

The flag is read off the bytes as they came in rather than stored anywhere, because **zero file managers is a legal registry** — `remove` allows the last one to go — and a migration that could not tell a gap from a choice would put Explorer back on the next launch, silently undoing a removal the user meant. A file without the field predates the kind; a file with it has been here before. The old file is copied to `targets.json.pre-file-manager` before the row is added, the way `adopt_linux_terminal_row` does it.

`remove` learns the same distinction. Its rule was *the last target of a kind cannot be removed, unless it is an agent*; it is now `let optional = matches!(kind, TargetKind::Agent | TargetKind::FileManager)`, because a Linux box with neither `nautilus` nor `xdg-open` seeds no row at all, so the rule could only ever have bound the platforms that happen to seed one. Zero editors or terminals is still refused: that is a launcher whose main button can never do anything.

And the other half of the mistake a hand-registered manager invites. `add` gains one guard and the store one predicate:

```rust
fn is_a_program_there(exe: &str) -> bool {
    let path = std::path::Path::new(exe);
    !path.is_absolute() || path.is_file()
}
```

A bare name is not asked about — `PATH` changes, and registering a tool before installing it is a legitimate thing to do, so that check belongs at launch — and neither is the empty executable an agent carries. A full path is asked about, and a wrong one is `AppError::TargetPathMissing`, whose message says what to do next: *"{0} is not there, or is not a program — check the path, or pick the executable with Browse"*. Before this, a mistyped path was accepted and then reported at the first reveal as *not installed, or not on PATH*, which sends a user looking for an install they already have.

Three tests. `an_old_registry_gains_a_file_manager_and_keeps_a_removal` writes a pre-kind `targets.json` by hand, opens the store, removes the seeded manager, and opens the store again to prove nothing came back. `the_last_file_manager_can_be_removed` returns early on a Linux box that seeded none, which is the honest shape rather than a `#[cfg]`. `refuses_a_full_path_with_no_program_at_it` covers all five cases in one test: an absolute path to nothing, a folder instead of the binary inside it, a bare name, an agent's empty string, and `std::env::current_exe()` — the program the test itself is running as, which certainly exists.

## 78.5 — Four tabs, and Browse for the kind nobody puts on PATH

`src/components/TargetManager.tsx`. `KINDS` gains `'file_manager'`, with a `LABELS` map beside it because the wire name is snake_case and nobody writes a button label that way. The flat `FIELDS` array becomes `fieldsFor(kind)`, which is what lets one form serve four kinds that do not want the same questions: no WSL pair for a file manager on any platform (its UNC path is already a Windows path), `RUN_FIELDS` for a terminal only, `REVEAL_FIELDS` for a file manager only. The placeholders name the worked example — `Name — e.g. Trove`, and on Windows `Executable — a full path, e.g. C:\Program Files\Trove\trove.exe`. The Windows reveal placeholder offers Explorer's own switch as the thing to copy, `/select,"{path}"`, which is what a manager written for Windows answers to; the Linux one offers no example at all, because there is none.

Beside the executable field, and only that field, a *Browse…* button:

```ts
const browse = () =>
	openDialog({ filters: EXE_FILTERS })
		.then(picked => {
			if (typeof picked === 'string')
				setDraft(d => ({ ...d, executable: picked }));
		})
		.catch(e => onError(String(e)));
```

`EXE_FILTERS` is `[{ name: 'Programs', extensions: ['exe', 'cmd', 'bat', 'com'] }]` on Windows and `undefined` elsewhere: Windows names its programs by extension, so the filter is real there; elsewhere an executable is any file, and a mac `.app` is a directory a file dialog cannot pick — which is right, because a bundle is not something DevGo can spawn, `open -a` is. Typing the path is still there; Browse is for the kind where you know where it is and not what it is called.

`TargetList`'s badges get the same treatment as the fields. *windows only* and *wsl only* used to be shown for anything that was not an agent; they are now gated on `crosses`, true for editors and terminals alone — an agent and a file manager have no halves to badge either, one being a command the terminal runs and the other taking a WSL project's UNC path as it stands.

`src/App.tsx`. One `reveal(path, targetId?)` replaces the two `invoke` sites, passing `targetId: targetId ?? null` so an omitted id reaches Rust as `None` and the backend resolves the default. `revealInExplorer` and `revealWorkspace` become one-liners over it, and the clone toast's *Open* goes through it too. `useTargets` gains `fileManagers`, Settings' panel is relabelled *Launch targets*, its palette row gains the keywords `agent` and `file manager`, and the Add button stops saying *Add editor or terminal*.

> `✅TARGETS: browse for the exe, and refuse a path with nothing at it`

## 78.6 — Finding a program nobody put on PATH

`src-tauri/src/services/editors.rs`. Everything above assumes you can tell DevGo where the program is. This section is about DevGo finding it.

Before this, detection was **PATH-only**. `locate()` checked a map built by one batched `where.exe`, fell through to a macOS bundle rule (`Candidate.app`, `None` on every Windows row), and returned `None`. There is no registry crate in `src-tauri/Cargo.toml` and never has been. An installer puts nothing on `PATH`, so **no row in the table could ever have found Trove** — the comment above the `explorer` row said exactly that and treated it as the end of the matter.

Two alternatives were tried on paper against this machine and both are dead:

- **Well-known install directories.** Trove is at `E:\Softwares\Trove`, a hand-chosen folder on a hand-chosen drive. No table of `%ProgramFiles%` and `%LOCALAPPDATA%\Programs` would guess it.
- **The registry.** There is nothing to read: no Uninstall key under HKCU, HKLM or WOW6432Node, no `Applications\trove.exe`, no `Directory\shell` verb, no `RegisteredApplications`, and no `App Paths\trove.exe` in either hive — only passive traces in MuiCache and UserAssist. Worth knowing separately: `where.exe` does **not** consult `App Paths` anyway; that key is honoured by ShellExecute and the Run dialog.

What does exist is one file, 748 bytes: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Trove.lnk`, whose `TargetPath` is `E:\Softwares\Trove\trove.exe`.

So `Candidate` gains `win_lnk: Option<&'static str>`, the base name of the Start Menu shortcut without `.lnk`, `None` on every pre-existing row in both tables so nothing else changes behaviour. It gains `reveal_args` at the same time, which is how the `explorer` row and the new `trove` row carry their second form; `trove`'s is `/select,"{path}"`, comma and no space, Explorer's own spelling, which is what a Windows file manager copies.

`locate(c, found, lnks)` gains one rule between the PATH rule and the bundle rule: a candidate that named a shortcut, and whose shortcut resolved, is detected with the resolved path substituted for the bare command and `source: "shortcut"`. Every template stays the row's own. PATH still wins when both could answer.

The lookup is built so that a machine where nothing needs it pays nothing:

- `shortcut_lookup(found)` collects the `win_lnk` of every candidate whose cli **missed** `PATH`, and returns an empty map at once if that list is empty. Off Windows there is a second `#[cfg(not(windows))]` body returning an empty map, so `locate` has one signature and the call site has no `cfg`.
- `start_menu_dirs()` is the two trees — `%APPDATA%\Microsoft\Windows\Start Menu\Programs` and the `%ProgramData%` one — because which of them an installer wrote to depends on whether it asked for admin. A missing one is simply not there.
- `find_shortcut(dirs, name)` walks them for `<name>.lnk`, matched case-insensitively on the whole stem, because an installer drops its shortcut in a vendor folder as often as at the top level. Pure filesystem, no spawn, so a test hands it a tree it built itself.
- `resolve_shortcuts(lnks)` starts **one** `powershell.exe`, and only when a `.lnk` was actually found. `WScript.Shell` is the only reader of a `.lnk` without a COM crate, and a shell is worth starting once and never once per row.
- `resolved_exe(target)` gates the answer on `is_file()`, because a shortcut outlives the program it pointed at and an uninstalled one would otherwise be offered as a target that cannot launch.

Two hardenings followed, and both are the kind that only look necessary once someone says them out loud. The walk has a depth cap:

```rust
const SHORTCUT_MAX_DEPTH: usize = 8;
```

`file_type()` follows a reparse point, so a junction under a Start Menu tree pointing back at its own parent was an endless descent **inside `detect()`** — a hang of target detection, on launch, with no error. Eight is far past anything an installer writes and still a number the walk cannot run past. The depth rides with each directory on the stack (`Vec<(PathBuf, usize)>`) rather than being a shared counter, because a stack walk visits siblings between levels and one counter would not say how deep the directory in hand actually is.

And the PowerShell list is built by a pure `shortcut_script(lnks)`, split out from the spawn so the quoting can be read by a test without a shell or a real `.lnk`. Single quotes throughout: the script goes over as one argument, which std re-quotes with double quotes, and a double quote inside would not survive the round trip; a single quote in a path is doubled, which is PowerShell's own escape; a single-quoted string is literal, so a `$` in a path stays a `$`. The `foreach` emits exactly one `Write-Output` on both the success and the catch branch, so a shortcut that cannot be read is a blank line rather than a shift in the pairing with `names`.

One more thing moved here, and it is the bridge to the work described under *Also since 76*. `path_lookup`'s resolution rule — join the name to each directory of the PATH in order, first file wins — is extracted as `pub(crate) fn first_on_path(path, name)`, compiled `#[cfg(any(not(windows), test))]`, so the launcher's preamble test can be written against the very function that decides what DevGo detected instead of a second copy of the rule written inside the test. (Linux has a private `first_on_path(kind)` of its own in the same file, the one `first_terminal` and the new `first_file_manager` share; same name, different signature, different `cfg`.)

Five tests, all without a Start Menu. `a_shortcut_is_found_by_name_anywhere_under_the_start_menu` builds a tree with `Trove.lnk` in a vendor subfolder, `Trovex.lnk` and `Trove.txt` beside it, and pins that the case does not matter, that a prefix is not a match, that `"Trove.lnk"` as a name is not a match, and that no directories means no walk; it then covers `resolved_exe` over a missing file, a real file with surrounding whitespace, an empty string and a directory. `the_start_menu_walk_stops_at_a_fixed_depth` derives its chain length from the constant and puts `Near.lnk` inside the cap and `Far.lnk` one past it. `a_shortcut_path_with_shell_characters_is_quoted_whole` pins the exact `@('…','…')` list for `C:\Joy's Apps\$env Tools\Trove.lnk`, that the quotes stay balanced, that only the real quote is doubled, and that an empty slice is `@()`. `only_a_row_that_names_a_shortcut_reads_the_shortcut_map` proves `explorer` is untouched however full the map is, that `trove` with nothing resolved is not offered, and that PATH beats the shortcut when both could answer. `shortcut_lookup_costs_nothing_when_every_row_resolved_on_path` asserts the empty map.

The Add form shows the new provenance: `d.source === 'path' || d.source === 'shortcut'` both render the resolved path, and anything else renders `in <source>` — a distro name, or a bundle.

> `✅TARGETS: devgo finds trove through its start menu shortcut`
> `✅TARGETS: the start menu walk cannot wander off`

## 78.7 — The default leads the menu, and the labels stop naming Explorer

A report came back against the built app: *"reveal in file explorer opens explorer even though trove is default"*. It was not a broken default, and the two plausible theories were both wrong — the installed build **did** carry the file-manager work, and `default_file_manager` is both written (`preferences.rs`, from `useTargets`) and read (`default_target`, consumed by `resolve_target`, `get_default_targets` and the export). It was on disk in `prefs.json` as `"default_file_manager": "trove"`. Every reveal entry point honoured it — the key, all three palette rows, the clone toast, reveal-app-data.

The defect was in the shape of the menu. `revealItems` emits one generic row while there is a single manager, and one row per manager once there are two or more, in `targets.json` order. Explorer is registered first. So *Reveal in File Explorer* occupied the exact seat and the exact label the default-honouring row used to have, and it did what it said.

```ts
const revealItems = (path: string, keys?: string): MenuEntry[] =>
	targets.fileManagers.length > 1
		? [
				...(defaultFileManager ? [defaultFileManager] : []),
				...targets.fileManagers.filter(t => t.id !== defaultFileManager?.id)
			].map(t => ({
				label: `Reveal in ${t.name}`,
				// the key opens the default one, so only that row claims it
				hint: t.id === targets.defaults.file_manager ? keys : undefined,
				onClick: () => reveal(path, t.id)
			}))
		: [ /* the single generic row, passing no id */ ];
```

A stable partition, not a sort: the default is prepended and filtered out of the rest, and everything else keeps registration order. An unknown or absent default makes `find` return `undefined`, the filter predicate becomes `t.id !== undefined` and is true for all, the prepend spreads nothing, and the list is byte-for-byte what it was. The `Ctrl+Shift+E` hint keys on identity rather than position and was left alone — it already marked only the default, and now position and hint agree instead of contradicting each other.

That fixed the seat. The labels were a second defect with the same cause, and three sites still narrated Explorer while opening Trove, all of them rows that reveal with **no** target id so the backend resolves the default:

- `revealLabel` in `App.tsx` names the default manager for the project palette row, falling back to `labelFor('revealExplorer')` when there is none.
- `revealTargetName` is the bare name, for the rows that build a sentence around it rather than carrying a whole label — the **workspace** palette row, which read *Reveal workspace ‹segment› in Explorer*.
- `ShortcutTableProps.fileManagerName` feeds a `shortcutLabel()` in `Settings.tsx` that substitutes for `revealExplorer` and `revealWorkspace` only. That was the worst of the three: the Shortcuts table is the one screen a user opens to find out what a key does.
- `HelpPanelProps.revealLabel` does the same for Help's *Reveal in Explorer* button, which opens the app-data folder in the default manager.

`shortcuts.ts` is untouched in all four cases — its `label` / `macLabel` / `linuxLabel` stay the shared static fallback, and the substitution happens at the call sites. An unset default, or one naming a deleted target, leaves every one of them saying *Explorer* (or *Finder*, or *file manager*), which is then true.

> `✅TARGETS: the default file manager leads the reveal menu`
> `✅TARGETS: the last two rows that said explorer while opening trove`

## 78.8 — Verify

**Gates**, on this branch after the rebase onto `3c6a6c5`: `cargo fmt --check` clean; `cargo clippy --all-targets -- -D warnings` **zero findings** (it had been red on five pre-existing sites for the whole life of the slice, and the last of them, `items_after_test_module` in `wsl.rs`, was cleared here — the deferral reason for it, a predicted conflict with `77.wsl-doctor`, turned out to be false: that branch never touches `wsl.rs`); `cargo test` **287 passed / 0 failed / 1 ignored**; `tsc --noEmit` clean; `bun run build` exit 0 with the contrast check green. `scripts/verify.sh` runs the first three by default and all five with `--full`.

**Driven by hand, on a build from this branch.** The installed `DevGo.exe` had to be killed first and relaunched after: single-instance is hand-rolled (`services/single_instance.rs`) and keyed on a lock file under the app-data directory, which derives from the identifier `app.zetta.devgo` — **which the dev build shares**. A `bun tauri dev` while the installed copy is running connects to the port in the lock file, sends `"restore"` and exits 0, so you would be testing the released binary without knowing it. Anyone driving this branch must do the same.

- **Detected.** Settings → Launch targets → *Detected on this machine* → Scan lists `Trove [file_manager]` with the provenance rendered as `E:\Softwares\Trove\trove.exe` — `source: "shortcut"` doing its job, since `trove` is on no PATH and the only route is `Trove.lnk`. Verified independently by a second agent that did not write the code, calling the functions on the real machine: `shortcut_lookup` → `{"trove": "E:\\Softwares\\Trove\\trove.exe"}`, and `detect()`'s trove entry carrying `reveal_args_template: Some("/select,\"{path}\"")` and `source: "shortcut"`.
- **Added.** `%APPDATA%\app.zetta.devgo\targets.json` carries `"id": "trove"`, `"executable": "E:\\Softwares\\Trove\\trove.exe"`, `"reveal_args_template": "/select,\"{path}\""`. The *default* setting lives in `prefs.json`, not here — `targets.json` holds rows only.
- **Revealed.** With two managers registered the project menu switched from one generic row to `Reveal in File Explorer · CTRL+SHIFT+E` and `Reveal in Trove`. *Reveal in Trove* launched `trove.exe` (window title `01_tauri - Trove`), opened `G: > 01_tauri`, and its status bar read **18 items · 1 item selected** with `devgo` highlighted — so `/select,"{path}"` genuinely selects the item rather than merely opening the folder. That is the one thing no unit test could prove.
- **The contract with Trove**, checked against its generated `installer.nsi` rather than against intentions: `CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"` with `PRODUCTNAME "Trove"` and the version a separate define never interpolated into the name; `STARTMENUFOLDER ""`, so the shortcut is unnested at depth 0; `installMode: "currentUser"`, so `$SMPROGRAMS` is the `%APPDATA%` tree we walk first; and the target is `$INSTDIR\trove.exe`, the real binary and not a stub, so the `is_file()` gate passes and `TargetPath` follows whatever directory the user picks. The standing objection to raise if it is ever proposed: `installMode: "both"` would make the shell context a runtime choice, and which Start Menu tree receives `Trove.lnk` would stop being knowable from config at all.
- **Not provable on this machine:** the Mac and Linux seeds and their reveal lines (the unit tests and their `#[cfg]`s carry them); the `.pre-file-manager` backup against a real pre-78 `targets.json` in the field (the test writes one by hand); `resolve_shortcuts`' line pairing against a `TargetPath` containing a newline, which needs a real `IWshShell`-written shortcut to produce.

## 78.9 — Deferred

- **`reveal_args_template` has no UI outside the Add form.** A registered row cannot be edited; the way to change a template is remove and add. True of every kind since 13.
- **Explorer's `/select,` is not used for the seeded row.** A WSL project's UNC path does not survive it, and those are half of what DevGo reveals, so the seed opens the folder. A per-target *supports UNC* flag would let a Windows-only project get the selection; nothing asks for it yet.
- **`is_a_program_there` checks only that something is a file.** It does not ask whether it is executable, and on Windows it could not: the extension is the only signal, and Browse already filters on it.
- **Shortcut name matching is exact on the stem.** A future `Trove 1.0.lnk` or `Trove (Beta).lnk` would not match and detection would silently stop working. Measured safe today, by reading Trove's `.nsi` rather than by trusting it — still the sharpest edge in the design.
- **Nothing reads the shortcut's `WorkingDirectory`, icon or arguments**, only `TargetPath` plus the `is_file()` gate. A shortcut pointing at a launcher would register the launcher.
- **An `App Paths` reader is the sturdier second signal** and is not here: it needs a registry dependency (`winreg`) the crate has never had. Trove has agreed to write the key as its own slice, but it is not a live contract until DevGo can read it.
- **One file manager is detected by name.** Windows detection finds Explorer, which every install already has, and Trove; a Mac finds Finder; Linux finds whichever of `xdg-open`, `nautilus`, `dolphin`, `nemo`, `thunar`, `caja` or `pcmanfm` is on PATH, in that order. Everything else is Browse.

---

## What you built

```
src-tauri/src/models/target.rs          reveal_args_template, resolve_reveal; TargetKind::FileManager, ALL, wire(); the explorer and finder seeds; 3 tests
src-tauri/src/services/editors.rs       reveal_args and win_lnk on Candidate; the explorer and trove rows; the linux file managers; shortcut_lookup, start_menu_dirs, find_shortcut, SHORTCUT_MAX_DEPTH, shortcut_script, resolve_shortcuts, resolved_exe; first_file_manager; first_on_path; bundle_form's second-form rule; /System/Library/CoreServices; 5 tests
src-tauri/src/services/target_store.rs  adopt_file_manager_row(knew) and the .pre-file-manager backup; remove's optional kinds; is_a_program_there; 3 tests
src-tauri/src/services/preferences.rs   default_file_manager, and the two match arms that read and write it
src-tauri/src/services/launcher.rs      cmd_line: a spaced exe path quoted the way cmd reads it; 2 tests
src-tauri/src/commands.rs               reveal_line, reveal_path through resolve_target; reveal_in_explorer takes a target_id; get_default_targets over TargetKind::ALL; PortableConfig::defaults; 5 tests, three of them one per platform
src-tauri/src/error.rs                  TargetPathMissing
src/hooks/useTargets.ts                 fileManagers
src/components/TargetManager.tsx        the fourth tab, LABELS, fieldsFor(kind), REVEAL_FIELDS, Browse… and EXE_FILTERS, the badge rule, the shortcut provenance
src/components/Settings.tsx             the panel is Launch targets; defaultManagerName, and shortcutLabel for the two reveal keys
src/components/HelpPanel.tsx            revealLabel on the app-data button
src/App.tsx                             one reveal(path, targetId?), revealItems with the default leading, revealLabel and revealTargetName, the clone toast's Open
src/types.d.ts                          'file_manager' in TargetKind, reveal_args_template, fileManagers, revealLabel, fileManagerName
```

- **Reveal is a registered target** — no program name left in `commands.rs`, on any platform.
- **One target, two invocations** — the reveal form is to a file manager what the run form is to a terminal, and `None` means *open the parent* rather than *fail*.
- **The migration can tell a gap from a choice** — an old registry gains a manager; a user who removed every manager keeps them removed.
- **A wrong path is refused where it is typed** — and `Browse…` is there so it need not be typed.
- **A program nobody put on PATH is found anyway** — through the one record an installer is obliged to leave, read once, walked with a depth cap, and treated as an interface between two projects rather than a trick.
- **The default leads the menu and names itself everywhere** — the seat, the key hint, the palette, the Shortcuts table and Help all say what will actually open.
