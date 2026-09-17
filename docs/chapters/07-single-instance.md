# 07 — One Instance, in the Tray (Phase 6)

**Branch:** `07.single-instance` — `git checkout 07.single-instance` gives you this chapter's finished app; `git diff 06.cache 07.single-instance` is exactly what this chapter adds.

**Starting from:** chapter 06 — a launcher that is cheap to launch and honest when it can't be complete. It still opens like a document: a white flash, a window you close to quit, and a second copy if you start it twice.

**Goal:** make DevGo something you keep around rather than something you open — a window created hidden and shown once it is painted, a system tray icon, a ✕ that hides instead of quitting, and a lock that turns a second launch into "bring the first one back".

> **Hold on to:**
> 1. **`create_new(true)` is the atomic "create only if absent"** — the OS serialises two launches racing for the same file, so a lock built on it has no time-of-check/time-of-use hole.
> 2. **UI calls from a background thread go through `run_on_main_thread`.** The restore listener is a thread; `show()` is not thread-safe; the closure hands it to the event loop.
> 3. **A closure that outlives the function `move`s what it uses** — the tray menu handler captures `lock_path` by value because `setup` returns long before Quit is clicked.

> Chapter 06 was the rule; this chapter and the next are the conveniences that a launcher earns once the rule is in place. They come after it because a tray app is exactly the kind of app that is started fifty times a day — and every one of those starts would have been a WSL boot without chapter 06. Nothing here touches the scanner. It is all about the window: when it appears, what ✕ means, and what happens when you launch DevGo while DevGo is already running.

---

## 7.1 — Fix: the startup white flash

Launch the app cold and you'll catch a split-second white rectangle before the dark UI paints — the native window exists before WebView2 has rendered your CSS. The fix: create the window **hidden**, and show it from React only after the first paint.

### Create the window hidden

In `src-tauri/tauri.conf.json`, flip the window to hidden (we set it visible in chapter 01 so earlier chapters were runnable):

```json
"visible": false
```

### Show after mount

In `src/App.tsx`, show the window from the outer `App` (which mounts once). `getCurrentWindow` joins the imports, and `App` grows a body:

```tsx
import { getCurrentWindow } from '@tauri-apps/api/window';
```

```tsx
const App = () => {
	// The window is created hidden (tauri.conf.json) and shown once React has
	// painted, so a cold start never flashes a white rectangle.
	useEffect(() => {
		getCurrentWindow().show();
	}, []);

	return (
		<ToastProvider>
			<AppInner />
		</ToastProvider>
	);
};
```

`useEffect(…, [])` runs *after* the component mounts and paints. By then the HTML is parsed, the dark CSS is applied, and React has rendered — so `show()` reveals a fully-painted window. No flash.

### The permission arrives with its caller

Tauri v2 blocks frontend window APIs unless allowed. Add `core:window:allow-show` to `src-tauri/capabilities/default.json`, next to the other `core:window:` lines the title bar has used since chapter 01:

```json
		"core:window:allow-show",
```

Without it, `show()` is rejected — the error names the permission — and the window stays hidden forever: the app appears to launch straight to nowhere. If you ever see that symptom, this line is the first thing to check. It was not granted in chapter 01 because nothing called `show()` until now. On the branch it is the chapter's *last* commit, not its first — the symptom above is exactly what the first three commits produced, and the fourth (§7.4) is the fix. Add the line now and you skip the symptom.

### The Cargo features

`tauri` gates the tray behind a feature flag. In `src-tauri/Cargo.toml`, the `features = []` chapter 01 left empty becomes:

```toml
tauri = { version = "2", features = ["tray-icon", "image-png"] }
```

`tray-icon` enables the tray API; `image-png` lets us reuse the app's PNG icon for the tray. They are added now because this is the chapter that uses them — and on the branch they land in this first commit, ahead of the tray itself, so that the one `cargo` rebuild the new features cost happens here rather than in the middle of §7.2.

> **Commit checkpoint** — `tauri.conf.json`, `App.tsx`, `Cargo.toml` and `Cargo.lock`.
>
> ```powershell
> git add -A
> git commit -m "✅FIX: prevent white flash — hidden window + show on mount"
> git push
> ```

---

## 7.2 — System tray & minimize-to-tray

DevGo is a launcher you keep around, not a window you quit constantly. So closing the window should **hide it to the tray**, not exit — and a tray icon should bring it back. The `tray-icon` and `image-png` features from §7.1 are what make the tray API exist.

### Intercept the close button

Add an `on_window_event` handler to the builder in `src-tauri/src/lib.rs`, between `.setup(…)` and `.invoke_handler(…)` — when the user clicks ✕, prevent the close and hide instead:

```rust
        .on_window_event(|window, event| {
            // ✕ hides. A launcher that takes two seconds to cold-start is a
            // launcher you stop using; Quit lives in the tray menu and Ctrl+Q.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
```

Note what you have just done to the ✕ button: it can no longer quit DevGo. That is intentional — but it leaves two ways out, and only one of them is discoverable: the tray menu below, which most people never open, and chapter 06's Ctrl+Q, which is why that command exists.

### Build the tray icon

Inside `setup` (after managing `AppState`), build a tray with a Show/Quit menu. Two `use` lines at the top of `src-tauri/src/lib.rs` (§7.3 adds a third):

```rust
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{
    MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent,
};
```

and the tray, after `app.manage(…)` and before `Ok(())`:

```rust
            let show_item =
                MenuItemBuilder::with_id("show", "Show").build(app)?;
            let quit_item =
                MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &quit_item])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        single_instance::release_lock(&lock_path);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
```

`use tauri::Manager;` has been at the top of `lib.rs` since chapter 02 and is what provides `get_webview_window`. Left-clicking the tray icon restores the window; the right-click menu offers **Show** and **Quit**. `show_menu_on_left_click(false)` keeps left-click for restore and reserves the menu for right-click.

The `"quit"` arm calls `single_instance::release_lock` with a `lock_path` — both from §7.3, which is why this does not compile until that section is in. Read on before you build.

---

## 7.3 — Single-instance enforcement

Because the app lives in the tray, a second launch (double-clicking the shortcut again) should **restore the running instance**, not start a duplicate. We do it with stdlib only: a random-port TCP listener plus a lock file that records the port.

### The single-instance service

Create `src-tauri/src/services/single_instance.rs`:

```rust
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::thread;

pub fn try_acquire(
    lock_file: PathBuf,
) -> Result<(TcpListener, PathBuf), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get port: {e}"))?
        .port();

    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_file)
    {
        Ok(mut file) => {
            write!(file, "{port}")
                .map_err(|e| format!("Failed to write lock file: {e}"))?;
            Ok((listener, lock_file))
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            drop(listener);
            if let Ok(port_str) = fs::read_to_string(&lock_file) {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    if let Ok(mut stream) =
                        TcpStream::connect(format!("127.0.0.1:{port}"))
                    {
                        let _ = stream.write_all(b"restore");
                        return Err(
                            "Another instance is already running".into()
                        );
                    }
                }
            }
            let _ = fs::remove_file(&lock_file);
            try_acquire(lock_file)
        }
        Err(e) => {
            drop(listener);
            Err(format!("Failed to create lock file: {e}"))
        }
    }
}

pub fn start_restore_listener(
    listener: TcpListener,
    on_restore: impl Fn() + Send + 'static,
) {
    thread::spawn(move || loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 16];
                if let Ok(n) = stream.read(&mut buf) {
                    if &buf[..n] == b"restore" {
                        on_restore();
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "[DevGo] instance listener error: {e}, shutting down listener"
                );
                break;
            }
        }
    });
}

pub fn release_lock(lock_file: &PathBuf) {
    let _ = fs::remove_file(lock_file);
}
```

Register it in `src-tauri/src/services/mod.rs` — one line among the others:

```rust
pub mod single_instance;
```

### Wire it into setup

At the **top** of `setup` (right after `create_dir_all`, before the stores), try to acquire the lock; if another instance holds it, exit. Then spawn the restore listener. One `use` at the top of `src-tauri/src/lib.rs`:

```rust
use services::single_instance;
```

```rust
            // One instance. A second launch hands "restore" to the first over
            // the port in instance.lock and exits before creating anything.
            let lock_file = app_data_dir.join("instance.lock");
            let (listener, lock_path) =
                match single_instance::try_acquire(lock_file) {
                    Ok((listener, path)) => (listener, path),
                    Err(_) => {
                        std::process::exit(0);
                    }
                };

            let app_handle = app.handle().clone();
            single_instance::start_restore_listener(listener, move || {
                let h = app_handle.clone();
                let h2 = h.clone();
                let _ = h.run_on_main_thread(move || {
                    if let Some(window) = h2.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            });
```

### How it works

```
First launch:  bind 127.0.0.1:{random} → atomically create instance.lock (write port) → spawn listener
Second launch: instance.lock exists → read port → connect → send "restore" → exit(0)
                                                                  ↓
                                        first instance's listener receives "restore" → show() + focus()
```

- **`create_new(true)`** is `O_CREAT | O_EXCL` — the OS creates the file only if it doesn't exist, and serializes concurrent attempts, so two launches can't both win. No TOCTOU race.
- **Random port** (`127.0.0.1:0`) — the OS picks a free ephemeral port. Fixed ports can fail on some machines (reservations, Defender). The lock file carries the port so the second instance can find it.
- **Stale lock** — if the first instance crashed, the port is dead; `connect` fails, we delete the lock and retry (`try_acquire` recurses).
- **`run_on_main_thread`** — the listener runs on a background thread, but `show()`/`set_focus()` must run on the UI thread or Tauri panics. `run_on_main_thread` schedules the closure onto the event loop. The double clone (`h`, `h2`) satisfies the borrow: `run_on_main_thread` borrows `h`, the inner closure moves `h2`.

### Release the lock on quit

Now the tray's `"quit"` arm from §7.2 compiles: `lock_path` is the `PathBuf` `try_acquire` handed back, and the tray is built later in `setup`, so the `on_menu_event` closure captures it by `move`. Without that `release_lock`, "Quit" would call `app.exit(0)` and leave `instance.lock` behind; the next launch would then hit a stale lock and have to clean it up. Release it explicitly.

> **Commit checkpoint** — the tray and the lock are one piece of behaviour, so they ship together.
>
> ```powershell
> git add -A
> git commit -m "✅TRAY: system tray + minimize-to-tray on close; single instance via random-port TCP + lock file"
> git push
> ```

---

## 7.4 — Quitting for real, from the window

Think about what §7.2 actually shipped. `CloseRequested` → `prevent_close()` → `hide()`. That is correct behaviour for a launcher — the whole point is to be summoned instantly — but it means the ✕ button *never* quits, and most people never open the tray menu. The process stays resident, and the user believes they closed it. Every "I closed it and it's still running" bug report starts here.

Chapter 06's `quit_app` is the window's own exit, and it has the same leak the tray menu just fixed: it needs to release the lock too. `AppState` gains the path, in `src-tauri/src/commands.rs`:

```rust
pub struct AppState {
    pub workspace_store: Mutex<WorkspaceStore>,
    pub cache_store: Mutex<ProjectCacheStore>,
    pub runtime_info: Mutex<RuntimeInfo>,
    pub lock_path: std::path::PathBuf,
}
```

and the command grows a parameter, a line, and the comment that now describes its job:

```rust
/// Quit for real.
///
/// Closing the window only hides it — that is the point of a tray launcher — but
/// the tray menu must not be the only way out, or the process quietly outlives
/// every "close". This gives the window itself an exit, and releases the
/// instance lock so the next launch starts clean.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle, state: State<AppState>) {
    crate::services::single_instance::release_lock(&state.lock_path);
    app.exit(0);
}
```

`AppState.lock_path` exists so this command can find the lock file — that is the only reason the field is there. In `lib.rs`, the path goes into state next to the stores:

```rust
            app.manage(AppState {
                workspace_store: std::sync::Mutex::new(store),
                cache_store: std::sync::Mutex::new(cache_store),
                runtime_info: std::sync::Mutex::new(runtime_info),
                lock_path: lock_path.clone(),
            });
```

`lock_path.clone()` because the tray's quit handler captures the original. Two ways out, both discoverable — the tray's **Quit** and Ctrl+Q — and the ✕ still hides, because that behaviour is deliberate and now it is the *only* thing that behaves that way.

> **Commit checkpoint** — the kind of small correctness fix you make once you think through the lifecycle.
>
> ```powershell
> git add -A
> git commit -m "✅FIX: release the instance lock on quit, from the tray and from Ctrl+Q"
> git push
> ```
>
> And the fourth commit on the branch is the one-line capability edit from §7.1, made when the hidden window first refused to show: `capabilities/default.json` alone. If you added `core:window:allow-show` when the text said to, it is already in your first commit and this one has nothing to hold; on the branch it is:
>
> ```powershell
> git add -A
> git commit -m "✅FIX: grant core:window:allow-show — the first show() from React is this chapter's"
> git push
> ```

---

## 7.5 — Verify

```powershell
bun tauri dev
```

- ✅ No startup white flash
- ✅ Closing the window hides to tray; the tray icon restores it; **Quit** or **Ctrl+Q** exits, and `%APPDATA%\app.zetta.devgo\instance.lock` is gone afterwards
- ✅ A second launch restores the running instance instead of duplicating — run `src-tauri\target\debug\devgo.exe` while the dev build is up; it exits at once and the first window comes forward
- ✅ Kill the process from Task Manager, launch again → it starts, having cleaned up the stale lock (or write a dead port such as `1` into `instance.lock` by hand and launch)

> **Commit checkpoint** — DevGo is a resident. Stage commit, then merge the chapter into `main`:
>
> ```powershell
> git add -A
> git commit -m "✅STAGE: 07 single-instance"
> git push
> git checkout main
> git merge 07.single-instance
> git push
> ```

---

## What you built

```
src-tauri/
├── Cargo.toml                         ← tray-icon, image-png
├── tauri.conf.json                    ← visible: false
├── capabilities/default.json          ← + core:window:allow-show
└── src/
    ├── lib.rs                         ← instance lock, restore listener, tray, close-hides
    ├── commands.rs                    ← AppState.lock_path, quit_app releases the lock
    └── services/single_instance.rs    ← try_acquire / start_restore_listener / release_lock
src/
└── App.tsx                            ← show() on mount
```

- **Create hidden, show when painted.** The flash is the gap between a native window and a rendered webview; `visible: false` plus one effect closes it.
- **✕ means hide, and that needs a second way out.** A resident app must be quittable from somewhere the user will actually look — the tray menu and a shortcut, not just one of them.
- **A lock file with a port in it is a single-instance protocol.** `create_new` for atomicity, an ephemeral port so nothing is reserved, a dead port as the stale-lock signal.

→ Next: [08 — Remembering Between Launches](./08-last-project.md)

→ Appendix: [Tauri Concepts](./appendix/tauri-concepts.md)
