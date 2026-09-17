# 29 — Where the Taskbar Gets Its Icon (post-plan)

**Branch:** `29.taskbar` — `git checkout 29.taskbar` gives you this chapter's finished app; `git diff 28.psmux 29.taskbar` is exactly what this chapter adds.

**Starting from:** chapter 28 — a Windows project's terminal opens the same named-window session a WSL project's does, and DevGo is feature-complete for its plan. Of the two complaints a week of daily use produced, chapter 27 answered *the app has become slow*. The other is still open: *the icon doesn't always load in the taskbar*.

**Goal:** find out where the taskbar gets an icon from before sending it one.

> **Hold on to:**
> 1. **Read where the OS gets it from before you change what you give it.** The reflex answer to a blank taskbar button is *the icon file is wrong*. The `.ico` was never the problem; two lines of tao source and one property on a `.lnk` were.
> 2. **The window is shown from four places; the icon is set from one.** Hook the event they all end in, not the four calls.
> 3. **Some fixes have no test, and saying so is part of the fix.** `cargo check` is the gate here. What verifies this chapter is `WM_GETICON` before and after, and then a week of looking at the taskbar.
>
> Rust: a `#[cfg(windows)]` module with a `#[cfg(not(windows))]` twin of empty functions, so the call sites have no `cfg` on them; `#[link(name = "user32")] unsafe extern "system" { … }` — five raw imports instead of a crate dependency; `tauri::generate_context!()` bound to a name so `run()` can read `config().identifier` before the builder.

> The complaint arrives as a feeling — *sometimes* blank — and the reflex answer is a file. This is the same lesson chapter 27 learned about slowness, pointed at the operating system.

---

## 29.1 — Where does the taskbar get an icon from?

`icon.ico` is fine — six sizes from 16 to 256 px, all 32-bit — and `tauri.conf.json` lists it under `bundle.icon`, so *the icon file is wrong* is dead on arrival. The question is what Windows actually reads, and the answer is in two crate sources and one shortcut, not in DevGo:

1. **tauri sets only the small icon.** `tauri-codegen` decodes the *first* entry of `icon.ico` to RGBA — 32×32 here — and tao's `set_window_icon` sends it as `ICON_SMALL`. `ICON_BIG` is never set. You can ask the window yourself: on the chapter 28 build, `SendMessageW(hwnd, WM_GETICON, ICON_SMALL, 0)` answers a handle and `ICON_BIG` answers **0**. Explorer asks a freshly shown window for its icon with a timeout, and a UI thread busy bringing WebView2 up is exactly where that query times out, the button is painted generic, and nothing asks again until a `WM_SETICON` arrives.
2. **Nothing sets an AppUserModelID.** The NSIS installer stamps the Start Menu shortcut with the bundle identifier — `(New-Object -ComObject Shell.Application).Namespace(...).ParseName('DevGo.lnk').ExtendedProperty('System.AppUserModel.ID')` reads `app.zetta.devgo` straight off the `.lnk` on this machine — but tauri never calls `SetCurrentProcessExplicitAppUserModelID`, so the running process carries the implicit path-derived id. To the taskbar, the window and its own pinned shortcut are two different applications. That is the *sometimes* in "sometimes blank": it depends on which one Explorer resolves first.

Neither is fixable by changing a PNG. Both are fixable in `lib.rs`.

## 29.2 — The process carries the installer's id

A `win_taskbar` module at the top of `lib.rs`, with five raw imports rather than a `windows` crate dependency — it is in the tree through tauri, but five functions do not earn a dependency of our own. The first piece is one import and one call:

```rust
#[cfg(windows)]
mod win_taskbar {
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Before the first window exists: the taskbar reads the id at window
    /// creation, so this is the first thing run() does.
    pub fn set_app_user_model_id(id: &str) {
        let id = wide(id);
        // a failure costs grouping, not the app; nothing to do at runtime
        let hr =
            unsafe { SetCurrentProcessExplicitAppUserModelID(id.as_ptr()) };
        if hr < 0 {
            eprintln!("[DevGo] SetCurrentProcessExplicitAppUserModelID failed: 0x{hr:08x}");
        }
    }
}

#[cfg(not(windows))]
mod win_taskbar {
    pub fn set_app_user_model_id(_id: &str) {}
}
```

Ordering is the whole subtlety, as it was for geometry in chapter 23. The AUMID must exist before the window does, because the taskbar reads it at window creation — and the main window is created inside `Builder::run`. So `run()` binds the context first and reads the identifier off it, instead of calling `generate_context!()` inline at the end:

```rust
pub fn run() {
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();

    // before the builder: the main window is created inside run
    win_taskbar::set_app_user_model_id(&context.config().identifier);

    tauri::Builder::default()
        …
        .run(context)
```

The same string the installer wrote on the shortcut, from the same `tauri.conf.json`, so they cannot drift.

> `✅RUST: process carries the installer app id`

## 29.3 — Both icon sizes, from the exe's own resources

The rest of the imports (`user32`: `SendMessageW`, `LoadImageW`, `GetSystemMetrics`; `kernel32`: `GetModuleHandleW`), the ten constants, and:

```rust
    // from the exe's own resource group, not rebuilt from RGBA: windows
    // picks the entry for the dpi, and LR_SHARED leaves the handle
    // system-owned, so nothing to destroy and nothing dangling if tauri
    // ever replaces ICON_SMALL behind us
    fn load_icon(cx: i32, cy: i32) -> *mut c_void {
        unsafe {
            LoadImageW(
                GetModuleHandleW(std::ptr::null()),
                IDI_APPLICATION as *const u16,
                IMAGE_ICON,
                cx,
                cy,
                LR_SHARED,
            )
        }
    }

    /// Both window icons from the exe's resources. Idempotent and cheap,
    /// which is the point: a WM_SETICON is the only thing that makes a
    /// taskbar button that already gave up on us look again.
    pub fn apply_window_icon(window: &tauri::Window) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let hwnd = hwnd.0;
        let (big, small) = unsafe {
            (
                load_icon(
                    GetSystemMetrics(SM_CXICON),
                    GetSystemMetrics(SM_CYICON),
                ),
                load_icon(
                    GetSystemMetrics(SM_CXSMICON),
                    GetSystemMetrics(SM_CYSMICON),
                ),
            )
        };
        // no resource group means a build that skipped tauri-build's
        // resource step; tao's small icon is still there, leave it
        if big.is_null() || small.is_null() {
            eprintln!("[DevGo] exe carries no icon resource; taskbar icon left to tao");
            return;
        }
        unsafe {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG, big as isize);
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, small as isize);
        }
    }
```

`IDI_APPLICATION` is `32512`, the id `tauri-build` gives the exe's icon group when it embeds `icon.ico`. `LoadImageW` against that group with `LR_SHARED` means Windows picks the right entry for the DPI and owns the handle: nothing to destroy, nothing left dangling if tauri ever replaces `ICON_SMALL` behind us, and the second call for the same size hands back the cached handle. The `not(windows)` twin gains an empty `apply_window_icon` in the same commit.

The first call goes in `setup`, right after the geometry block and before anything can show the window — the button is created the moment the window becomes visible, and what it finds then is what it paints:

```rust
                // icons before the first show, for the same reason as
                // geometry: the button is created the moment the window is
                // visible, and what it finds then is what it paints
                let plain: tauri::Window = window.as_ref().window();
                win_taskbar::apply_window_icon(&plain);
```

(`window` there is the `WebviewWindow`; `as_ref().window()` is the plain `Window` that has `hwnd()`.)

> `✅RUST: both icon sizes from the exe resource`

## 29.4 — And again on every focus

Four code paths show this window — React's `show()` once it mounts, the tray, the summon hotkey, the single-instance restore — and every one of them ends in an activation. One arm in `on_window_event` sees all four without each having to remember:

```rust
            tauri::WindowEvent::Focused(true) => {
                win_taskbar::apply_window_icon(window);
            }
```

A `WM_SETICON` is the only thing that makes a button Explorer already painted generic look at the window again, and `LR_SHARED` makes the repeat free.

> `✅RUST: icons again on every focus`

## 29.5 — The case left outside the app

The exe is reinstalled into the same path several times a day, and Explorer caches the icon it extracts from an exe *by path*; when the taskbar falls back to that cache and the entry is stale, the button is blank no matter what the window says. `scripts/reset-icon-cache.ps1` stops Explorer, deletes `iconcache_*.db`, runs `ie4uinit -show` and restarts Explorer. It is a script you run, not something the app does, because restarting the user's shell is not a launcher's decision to make.

> `✅SCRIPTS: reset the shell icon cache`

## 29.6 — Verify

```powershell
cd src-tauri
cargo check
cargo test
cd ..
```

`cargo check` is clean; `cargo test` still reports **118** — nothing here has a test that means anything, and the chapter says so rather than writing one that passes by construction. What it does have is a number before and after. A probe script with `SendMessageW` and `GetClassLongPtrW` imported through `Add-Type`, pointed at the dev build's `MainWindowHandle`:

**Before** (the chapter 28 build): `ICON_SMALL` a handle, **`ICON_BIG` 0**, the class icons 0.
**After:** `bun tauri dev`, wait for the window: `ICON_SMALL` a handle — a *different* one, ours from the resource group — and `ICON_BIG` a handle. No `[DevGo] … failed` line in the dev log. Minimize from the title bar, restore from the taskbar, probe again: the same two handles, which is `LR_SHARED` doing what it says.

The AUMID half cannot be read from outside the process — `GetApplicationUserModelId` only knows packaged apps and answers `APPMODEL_ERROR_NO_APPLICATION` (15703) for this one, and `SHGetPropertyStoreForWindow` reports a window's *explicit* id, not the process's. What can be verified is that the shortcut says `app.zetta.devgo`, `tauri.conf.json` says the same, and the call did not log. The rest is a week of the pinned button lighting up.

Restore the config files (a dev launch on an install whose `targets.json` carries kinds this chapter's model does not know trips chapter 22's guard; restore by hash).

> `✅STAGE: 29 taskbar`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/lib.rs                     win_taskbar: set_app_user_model_id, load_icon, apply_window_icon;
                                 context bound first in run(); icons after geometry in setup; Focused(true)
scripts/
  reset-icon-cache.ps1           the case the app leaves to you
```

The taskbar button carries the identity the installer gave the shortcut and both sizes of icon from the exe's own resources.

> **The thread running through this chapter.** Chapter 27's lesson, pointed at the operating system: a complaint that arrives as a feeling gets turned into a fact before anything is changed. `WM_GETICON` said 0; the `.lnk` said `app.zetta.devgo`; the fix was five raw imports and one event arm — and **the honest verification is a number before, a number after, and a week of looking.**
