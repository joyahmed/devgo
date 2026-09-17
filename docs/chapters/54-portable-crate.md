# 54 — The Portable Crate (post-plan)

**Branch:** `54.portable-crate` — `git checkout 54.portable-crate` gives you this chapter's finished app; `git diff 53.polish 54.portable-crate` is exactly what this chapter adds.

**Starting from:** chapter 53 — a day of use, fixed. *"then only mac left now."*

**Goal:** the first stage of the Mac port, done on Windows, changing nothing you can see. The crate did not compile for `aarch64-apple-darwin`: twelve files imported `std::os::windows::process::CommandExt`, and the first `use` is where the compiler stops. After this chapter it is imported in one place. Plus one thing the day after found: a see-through window costs memory, and every install had been paying for it, Opaque included.

> The question: *"should we do mac development in mac? or it's good enough here?"* — Both, split at this chapter: this part is provable here, and everything after it needs the Mac.

> **Hold on to:**
> 1. **One seam, `cfg` inside.** A trait on `Command` (`Quiet`: `quiet()`, `shell_line()`) whose two bodies carry the `#[cfg(windows)]`; every call site reads the same on every OS. The inverse — a `#[cfg]` per site — is twenty places to forget, and the next `Command::new` is the twenty-first.
> 2. **`transparent` is a creation flag.** It cannot change on a live window, and it is not free: a window born see-through holds one screen-sized alpha surface. So the window is built in `setup()` from the stored knob, not by the config, and a `OnceLock<bool>` remembers how it was born so the panel can say when a move of the knob lands.
> 3. **A no-op is a stub.** With `quiet()` doing nothing off Windows, `platform/wsl.rs` compiles as it is; on a machine with no `wsl` binary every call is `ENOENT` → `None` → no distros, which is exactly what a stub would answer. No second copy of the module.
>
> Rust: a trait with a default-less method implemented for a foreign type (`impl Quiet for Command`), `impl AsRef<OsStr>` as a parameter, a `#[cfg]` on a block and on a `let`. TypeScript: `Promise.all` over two invokes.

**Shape of the chapter.** The count is **twelve files, seventeen `creation_flags` sites and two `raw_arg`**: there is no `reg` query (`os_transparency_effects_enabled` was never typed, since 41) and ch. 49 gave the crate one `fn ssh`, so one builder to switch, not three. There is no third Appearance note about Windows' *Transparency effects* switch — no acrylic and no command to ask. `setTransparency` lives in `transparency.ts` (the ch. 53 shape) and gains a `born` argument instead of the panel calling `invoke` itself. `macos-private-api` is not enabled, so the `#[cfg(not(target_os = "macos"))]` guard on `.transparent(…)` stays. ⚠️ `cargo check --target aarch64-apple-darwin` cannot run from this machine either: a Tauri dependency's build script needs Apple's C toolchain. This chapter is done by inspection and `grep`, and proven on the Mac first thing in 55.

---

## 54.1 — Why it did not compile

One idiom, in twelve files:

```rust
use std::os::windows::process::CommandExt;
const CREATE_NO_WINDOW: u32 = 0x08000000;
…
Command::new("wsl").creation_flags(CREATE_NO_WINDOW).args(…)
```

That flag is what stops a spawned console program from flashing a black window over the app on Windows — every `wsl`, `git`, `gh`, `ssh`, `where.exe`, `psmux` and `cmd` call needs it. Two sites used `raw_arg` from the same trait for a `cmd /c …` line that must not be re-quoted (`spawn_raw` in the launcher, `open_server_folder_in` in commands). The trait does not exist off Windows, so the crate could not even be type-checked for the Mac.

`grep -rnE 'CommandExt|CREATE_NO_WINDOW|creation_flags|raw_arg' src-tauri/src` before you start: twelve files. The goal of 54.2 is that only `platform/mod.rs` matches.

## 54.2 — One seam, not twenty `#[cfg]`s

`services/platform/mod.rs` gains a trait on `Command`:

```rust
pub trait Quiet {
    // no console window for the child. on windows a spawned console
    // program otherwise flashes a black window over the app; elsewhere
    // there is no such window and this is a no-op
    fn quiet(&mut self) -> &mut Self;

    // one argument handed to the os verbatim. arg re-quotes anything with
    // a space, which turns --folder-uri vscode-remote://… into one quoted
    // argument and breaks it; raw_arg passes the line through and the
    // target's own template decides the split. every caller today is a
    // cmd /c line, which means nothing off windows: there this is a plain
    // arg, so the crate compiles, and the mac gets its own doors later
    fn shell_line(&mut self, line: impl AsRef<OsStr>) -> &mut Self;
```

`impl Quiet for Command`: `quiet` is a `#[cfg(windows)]` block (`use std::os::windows::process::CommandExt; const CREATE_NO_WINDOW: u32 = 0x0800_0000; self.creation_flags(CREATE_NO_WINDOW);`) followed by `self`; `shell_line` is two blocks, `#[cfg(windows)] { self.raw_arg(line) }` and `#[cfg(not(windows))] { self.arg(line) }`. `platform/wsl.rs` switches first (`use super::Quiet;`, `cmd.quiet()` in `wsl_command`) — the seam and its first user in one commit. ⚠️ Until the launcher switches, `cargo check` warns that `shell_line` is never used; that is the only warning the chapter ever shows, and a *missed* import is also only a warning (an unused `CommandExt`), so read the check output, not just its exit code.

> `✅PLATFORM: one seam for the windows-only half`

`shell_line` off Windows is a plain `arg`. That is *not* a Mac launch path — `cmd /c` means nothing there — it is what lets the crate compile until the Mac chapters give `spawn_raw`, `open_in_browser` and the remote-editor launch their own doors. The comment on the method says so, in one line.

Then every service, three at a time, `cargo fmt` + `cargo check` between: the `use std::os::windows::process::CommandExt;` line becomes `use super::platform::Quiet;` in the `super::` group (`use crate::services::platform::Quiet;` in `sessions.rs`, which imports by `crate::`), the `const CREATE_NO_WINDOW` goes, every `.creation_flags(CREATE_NO_WINDOW)` reads `.quiet()`. Same chain shape, so the diff is mechanical and reviewable; rustfmt collapses a chain that now fits on one line (`where_lookup` in `editors.rs`).

> `✅PLATFORM: scanner, detect and git through the seam` · `✅PLATFORM: scripts, editors and github through the seam` · `✅PLATFORM: clone, sessions and server folders through the seam`

`launcher.rs`: `cmd.quiet().shell_line(format!("/c {exe} {args}"));` and the doc comment on `spawn_raw` names `shell_line` (`raw_arg` on Windows, `platform::Quiet`). The warning is gone.

> `✅PLATFORM: launcher through the seam`

`commands.rs` last: `Quiet` joins the existing `use crate::services::platform::{wsl, Quiet, RuntimeInfo};`, `open_server_folder_in` reads `.quiet().shell_line(…)`, `open_in_browser` `.quiet()`. The `grep` now matches `platform/mod.rs` and one doc comment in the launcher — nothing else.

> `✅PLATFORM: commands through the seam`

## 54.3 — What the WSL module needs: nothing

One could put the process half of `platform/wsl.rs` behind `#[cfg(windows)]` with stubs now. With `quiet()` a no-op it compiles as it is, and on a machine without a `wsl` binary every call is an immediate `ENOENT` → `None` → no distros — the stub's answer, with no second copy of the module. The Mac chapters stop asking altogether (`wsl_available: false`), which is the real gate.

## 54.4 — See-through is paid for only when it is on

Task Manager open: *"now the app is using more rams"* — the `devgo.exe` row where it used to be single digits. `transparent` is a *creation* flag, and it had been `true` in `tauri.conf.json` since stage 41 — so every install paid for a screen-sized alpha surface, Opaque included. A release build maximized on 2560×1440 pays about 13 MB for it; this chapter's numbers are in Verify.

**The window is built in `setup()`.** `tauri.conf.json`: the main window gets `"create": false` and `"transparent": false`. `lib.rs`, before the window-restore block (which does `app.get_webview_window("main")` and now finds what this creates): read `pct` from the pref store (`window_transparency()`, `unwrap_or(0)`), `let see_through = pct > 0;`, remember it in a `static LAUNCHED_TRANSPARENT: OnceLock<bool>` (`pub fn launched_transparent() -> bool` reads it, `false` before set), clone the `main` entry out of `app.config().app.windows`, then

```rust
let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &main_cfg)?;
#[cfg(not(target_os = "macos"))]
let builder = builder.transparent(see_through);
builder.build()?;
```

The later `pct` read inside the restore block goes; `apply_transparency(&window, pct)` reuses the value. Opaque costs nothing again, see-through costs what it costs.

> `✅WINDOW: born opaque unless the knob says so`

**The panel can ask.** `commands.rs`: `window_launched_transparent() -> bool` returns `crate::launched_transparent()`, registered in `generate_handler!` next to `get_window_transparency`; the comment on `set_window_transparency` now says *when it was born see-through*.

> `✅WINDOW: the panel can ask how it was born`

**The ground alpha only on a window born see-through.** ⛔ On a window born opaque the ground alpha must stay 1: alpha in the page then composites over the webview's plain background, which reads as a dark tint, not as glass. `transparency.ts`: `launchedTransparent()` (the invoke, `.catch(() => false)`); `loadGroundAlpha` is a `Promise.all` over the knob and the birth and applies `born ? pct : 0`; `setTransparency(percent, born)` applies the same after storing.

> `✅UI: the ground alpha only on a window born see-through` — on its own this commit does not type-check (`Settings.tsx` still calls the one-argument form); the next one closes it.

**The panel says when the knob lands.** `AppearancePanel` in `Settings.tsx`: a `born` state read on mount beside the knob, `previewTransparency` passes `born === true`, and two notes under the stepper, both `<p className='text-13 text-text-muted mt-2'>`: born opaque and knob above 0 — *Saved. DevGo opened opaque this time, so the window goes see-through on the next launch — a see-through window holds about 30 MB more, and an opaque one is not asked to.*; born see-through and knob at 0 — *Opaque. The memory a see-through window holds is given back on the next launch.* The knob still previews live on a window born see-through.

> `✅UI: the panel says when the knob lands`

## 54.5 — Task Manager showed the old icon

The exe already carried the `>_` tile. Explorer extracts an exe's icon once per *path* and keeps it in `iconcache_*.db`, and Task Manager keeps its own copy in-process. `scripts/reset-icon-cache.ps1` has been in the repo since chapter 29; run it, then reopen Task Manager. ⛔ Not while you are working: it restarts Explorer. Nothing to type.

## 54.6 — Verify

`cargo test` **186** (unchanged), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. Fourteen files backed up by hash; the installed DevGo stopped for the run. WSL was already running, left alone. The stored knob is 0, so the first dev launch is born opaque.

**The flag still lands.** `window_launched_transparent` → `false`, 53 rows, `--ground-alpha` `1`. A refresh (F5 over CDP) with the process list sampled every 30 ms for ten seconds: **102 `git` and 4 `wsl` spawned, 43 new `conhost`s beside the 9 already on the machine — and not one of them had a window** (`MainWindowHandle` 0 throughout); 0 `conhost` with `devgo.exe` as its parent. A `conhost` per console child is normal under `CREATE_NO_WINDOW` — it runs headless — so the window count is the proof, the parent count only another phrasing of it.

**Born opaque.** Settings › Appearance, `20` typed into the stepper: the note *Saved. DevGo opened opaque this time…* appears, `--ground-alpha` stays `1`, `get_window_transparency` and `prefs.json` say 20. `Ctrl+Q`.

**Born see-through.** Relaunched with the knob at 20: `window_launched_transparent` → `true`, `--ground-alpha` `0.8`, a card at `oklab(… / 0.4)`, the terminal behind the window reads through the Settings drawer, no note at 20. `+` once → `1`, alpha `0.99` live. *Opaque* → `0`, alpha `1`, the note *Opaque. The memory a see-through window holds is given back on the next launch.*, `prefs.json` `0`.

**Memory** — dev build (`bun tauri dev`, unoptimized), maximized on 2560×1440, Settings › Appearance open, read at the same uptime (171 / 175 s):

| `devgo.exe` | born opaque | born see-through |
|---|---|---|
| private bytes | **9.2 MB** | **21.8 MB** |
| working set | 40.0 MB | 52.9 MB |
| the six WebView2 processes, private | 267.5 MB | 344.8 MB |

12.6 MB on the exe is the alpha surface (about 13.5 on a release build); the WebView2 line is noisier and read once each, so take its direction, not its size.

The dev build stopped, all fourteen files restored and hash-matched (verified before the installed DevGo was relaunched; it then rewrote its own `instance.lock` and `projects-cache.json`, as it does on every start), the installed DevGo running.

> `✅STAGE: 54 portable-crate`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/platform/mod.rs      Quiet: quiet() and shell_line(), the cfg inside
  src/services/platform/wsl.rs      the first user
  src/services/{scanner,detect,git,scripts,editors,github,clone,sessions,server_folders,launcher}.rs
                                    use super::platform::Quiet; .quiet(); constants gone
  src/commands.rs                   the same, plus window_launched_transparent
  src/lib.rs                        the window built in setup(); LAUNCHED_TRANSPARENT
  tauri.conf.json                   "create": false, "transparent": false
src/
  transparency.ts                   launchedTransparent(); alpha only when born see-through
  components/Settings.tsx           born, the two notes
```

- **A crate with one Windows-only seam** instead of twelve — `platform::Quiet`, `.quiet()` and `.shell_line()`, `cfg` inside.
- **Nothing visible changed** — 186 tests, 0 warnings, every spawn still quiet.
- **See-through paid for only when it is on**, with the panel honest about when the knob lands.
- **The Mac's first step** taken where it could be proven; `cargo check --target aarch64-apple-darwin` on the Mac is chapter 55's first line.
