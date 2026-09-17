# 23 — What Breaks When It Grows, and What Was Never Readable (post-plan)

**Branch:** `23.window` — `git checkout 23.window` gives you this chapter's finished app; `git diff 22.config-guard 23.window` is exactly what this chapter adds.

**Starting from:** chapter 22 — DevGo is a complete launcher with a settings surface, nested discovery and a config guard. It opens in a 900×720 window, centred, exactly as it has since chapter 01, and nothing in its UI has ever been painted wider than that.

**Goal:** open maximized, remember where you left the window, and survive being three times wider than anything ever rendered it — then a contrast audit that indicts all five themes, and the default, for the same two mistakes.

> **Hold on to:**
> 1. **Gates prove you did not break what was already tested; they cannot prove a window opened.** `"maximized": true` is a real Tauri key, every gate was green, and the window came up 916×729. The config key stays as declared intent; one line of Rust in `setup` is what actually does it.
> 2. **Store the rectangle you want back, not the one you can see.** Maximized, the window's size is the screen. Save that and the restore button hands back a screen-sized window, which reads as restore being broken.
> 3. **When several things break at a new size, find the container they share.** Three symptoms at 2560px, one missing `max-w` — and `mx-auto` appeared nowhere in `src/`, because nothing had ever been wide enough to need centring.
> 4. **When a token fails in one role and passes in another, split the token.** `border` as a divider was fine; `border` as the edge of a control was invisible. A compromise value would have been wrong twice.
>
> Rust: struct update syntax (`WindowState { maximized: true, ..base }`); `let ... else` on a tuple of `Result`s; `#[serde(default)]` as the thing that keeps an older `prefs.json` out of `.bak` (§22.1's guard now has teeth, so every new field must clear it). TypeScript: a hook that subscribes to a window event and unsubscribes through the promise it was handed.

> This chapter starts with a one-line config change and spends the rest of itself paying for it. Then the second half arrives from a different direction: asked whether text has "enough contrast with the background everywhere", we measure instead of squinting, and every one of the six palettes fails the identical two checks. Not five authors each slipping — **a rule that was never written down.** Chapter 19 celebrated that a theme is just a variable override and no component knows one exists. The bill for that freedom is here.
>
> The contrast check joins `bun run build`, not a lint step: the tree has no eslint (chapter 22 said so), and `build` is the gate this repo already runs, the one `bun tauri build` runs for you.

---

## 23.1 — One line

The window is declared in `src-tauri/tauri.conf.json` and has never been touched by code:

```json
"width": 900,
"height": 720,
"resizable": true,
"maximized": true,
"decorations": false,
"center": true,
"visible": false
```

Two things that look like conflicts are not:

- **`center: true` does not fight it.** Centring is resolved before the window is created, into an explicit initial position, not as a `set_outer_position` afterwards (which on Windows would clear the maximized flag). So `center` only decides the *restored* rectangle — the one the restore button hands back. That is why `width` and `height` stay.
- **`visible: false` does fight it — and this you only learn by running it.** Reading tao's source says it should not: maximize is applied before visibility and lands in the window style. Running it: the window came up **916×729 at the centred position, `IsZoomed` false**. Build, `tsc`, the tests, all green, and the feature did not work. The key stays in the config as declared intent; §23.4 maximizes explicitly.

What we deliberately do **not** use is `"fullscreen": true`. It takes precedence over `maximized` and covers the taskbar. For an app summoned by a global hotkey with a hand-drawn title bar (`decorations: false`), that means the only way out is a button we drew ourselves. A launcher should not be able to trap you.

> `✅CONFIG: open maximized`

## 23.2 — Remembering, without breaking the restore button

Maximized-by-default fights anyone who deliberately restores the window: every launch undoes their choice. So maximized becomes the *first-run* default rather than a permanent override, and the geometry is persisted. No plugin — `PreferencesStore` already exists, and this is four numbers and a flag.

### The model

In `src-tauri/src/services/preferences.rs`, above `Preferences`:

```rust
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
```

and the field, last in `Preferences`:

```rust
    /// None until the window is first moved or resized; absent means open
    /// maximized. `serde(default)` keeps an older prefs.json out of `.bak`.
    #[serde(default)]
    pub window_state: Option<WindowState>,
```

`PartialEq` is not decoration — §23.2's setter compares whole states. And `#[serde(default)]` stopped being optional in chapter 22: `PreferencesStore::new` runs every existing file through `parse_or_backup`, so a field that fails to deserialize would send someone's whole config to `.bak`. A fresh install and a `prefs.json` written before this field existed must behave identically; the test below says so.

> `✅RUST: window state in prefs`

### The store

Next to `scan_config`:

```rust
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
```

Dragging a window emits one move event per frame, and each save is a full `prefs.json` serialize. Rather than a timer, the store drops writes that change nothing — throttling *by value* is simpler than by time and exactly right: a drag that ends where it started genuinely has nothing to save.

Three tests, at the end of the module:

```rust
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
```

The second test is the throttle made observable: save, delete the file, save the same state again — the file must still be missing. The third is chapter 22's guard turned on this chapter: an old file with none of the new field loads, keeps its pins, and produces no `.bak`.

> `✅RUST: window state getter and setter` — `cargo test`: **65**.

### Saving: which rectangle

`src-tauri/src/lib.rs`, above `run` — with `use services::preferences::WindowState;` added to the imports at the top of the file:

```rust
// only the restored rect is stored: maximized, the window is the screen,
// and saving that hands the restore button a screen-sized window
fn remember_geometry(window: &tauri::Window) {
    // a hidden window's geometry is nobody's choice: startup fires resize
    // and move before show(), and close hides rather than exits
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let Some(state) = window.app_handle().try_state::<AppState>() else {
        return;
    };
    let Ok(mut prefs) = state.pref_store.lock() else {
        return;
    };

    let next = if window.is_maximized().unwrap_or(false) {
        WindowState {
            maximized: true,
            ..prefs.window_state().unwrap_or_default()
        }
    } else {
        let (Ok(size), Ok(pos)) =
            (window.inner_size(), window.outer_position())
        else {
            return;
        };
        WindowState {
            maximized: false,
            width: size.width,
            height: size.height,
            x: pos.x,
            y: pos.y,
        }
    };
    let _ = prefs.set_window_state(next);
}
```

**The subtlety is which rectangle you store.** While maximized, the window's own size *is* the screen. Save that, and the restore button hands back a window exactly the size of the display. So a maximized window updates the flag and leaves the rect it should snap back to untouched — `..prefs.window_state().unwrap_or_default()` is struct update syntax: every field not named comes from the previous state, or from the 900×720 default if there was none.

**And a guard you will not think of until you watch it happen.** The first run wrote `maximized: false, 900×720` into prefs by itself, before anyone touched the window — startup fires resize and move events while the window is still hidden, and `remember_geometry` dutifully saved them, overwriting the maximize that had just been applied. A hidden window's geometry is not a choice anyone made. Closing also hides rather than exits (chapter 07), so the same guard covers that path.

The handler becomes a `match`:

```rust
        .on_window_event(|window, event| match event {
            // ✕ hides. A launcher that takes two seconds to cold-start is a
            // launcher you stop using; Quit lives in the tray menu and Ctrl+Q.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                remember_geometry(window);
            }
            _ => {}
        })
```

> `✅RUST: save geometry on move and resize`

### Restoring: where, and when

Two constraints decide where the restore happens.

**It must be in Rust.** `capabilities/default.json` grants the webview `show`, `minimize`, `maximize`, `toggle-maximize`, `unmaximize`, `close` and `start-dragging` — no `set-size`, `set-position` or `center`. Capabilities gate the webview, not the backend.

**It must be in `setup`.** The frontend calls `show()` when React mounts (chapter 07); `setup` runs before that. Apply the geometry there and the window is the right shape the first time it is ever painted. Apply it later and you get a 900×720 flash that snaps to full size.

In `setup`, after `app.manage(...)` and before the hotkey:

```rust
            // geometry goes on before the webview calls show(), so the first
            // paint is already the right shape
            if let Some(window) = app.get_webview_window("main") {
                let saved = app
                    .state::<AppState>()
                    .pref_store
                    .lock()
                    .ok()
                    .and_then(|p| p.window_state());
                match saved {
                    // set_size is ignored on a maximized window
                    Some(s) if !s.maximized => {
                        let _ = window.unmaximize();
                        let _ = window.set_size(tauri::PhysicalSize::new(
                            s.width, s.height,
                        ));
                        let _ = window.set_position(
                            tauri::PhysicalPosition::new(s.x, s.y),
                        );
                    }
                    // `maximized: true` in the config does not survive
                    // `visible: false`; this line is what actually does it
                    _ => {
                        let _ = window.maximize();
                    }
                }
            }
```

Nothing saved and "saved as maximized" are the same branch, and — since §23.1 established the config key does not deliver on its own — that branch calls `maximize()`. The restored branch un-maximizes first: setting a size on a maximized window is ignored on Windows, and the user would be left full-screen with no idea why.

> `✅RUST: restore the window before show`

## 23.3 — Rounded corners are a statement about the window

The root has carried `rounded-xl` since chapter 01. A 12px radius says *this is a floating panel*. Maximized, there is nothing behind it to reveal — the config sets no transparency — so the corners stop being a rounded window and start being four bites taken out of the app's own background against the screen edge.

The radius is not wrong; it is *conditional*. Which means the UI has to know something it has never needed to know. `src/hooks/useMaximized.ts`:

```ts
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

// onResized rather than a maximize event: maximize, restore, snap and drag
// all arrive as resizes, and the answer can change under any of them
export const useMaximized = () => {
	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		const win = getCurrentWindow();
		let alive = true;
		const sync = () => {
			win
				.isMaximized()
				.then(v => {
					if (alive) setMaximized(v);
				})
				.catch(() => {});
		};
		sync();
		const unlisten = win.onResized(sync);
		return () => {
			alive = false;
			unlisten.then(f => f()).catch(() => {});
		};
	}, []);

	return maximized;
};
```

`onResized` returns a promise of an unlisten function; the cleanup waits for it and calls it. `alive` covers the other race — an `isMaximized` answer arriving after unmount.

> `✅HOOK: useMaximized`

In `App.tsx`, `const maximized = useMaximized();` beside `useRuntime`, and the root:

```tsx
		// the radius belongs to a floating window; flush with the screen it
		// only clips the app
		<div
			className={`flex flex-col h-screen w-screen overflow-hidden ${
				maximized ? '' : 'rounded-xl'
			}`}
		>
```

> `✅UI: corners only when floating`

## 23.4 — The one rule that fixes three symptoms

At 2560px wide, three things look wrong and they look like three problems: the search box is a single-line input about 2500 pixels long; the six action buttons huddle in a cluster marooned in the middle of an empty row; project rows stretch until short strings float in gaps.

They are one problem. The content column had no maximum width, and — this is the part worth checking in your own project — **`mx-auto` appeared nowhere in the entire `src/` tree.** Nothing was ever centred, because nothing was ever wide enough to need it.

```tsx
			{/* one cap for the search box, the action row and the rows, instead of
			    a width rule each */}
			<div className='flex-1 flex flex-col w-full max-w-[1400px] mx-auto p-5 gap-4 overflow-hidden'>
```

One rule, three symptoms gone, and no per-component width fixes to keep in sync later.

The project list needed one more, because its grid had a track that could not grow. In `ProjectTree.tsx`, `col`:

```
grid-cols-[1fr_1fr_80px_minmax(150px,0.9fr)]
                  ↑ stays 80px forever
```

Three `fr` tracks absorb every new pixel while the File System column stays exactly as cramped at 2560px as at 900. `minmax(80px,0.4fr)` gives it a floor and a share.

> `✅UI: cap and centre the content column`

The dialogs were sized for a 900px window too. Four numbers: the command palette `w-[min(640px,92vw)]` → `780px`; the confirm dialog `max-w-sm w-90` → `w-[min(460px,92vw)]` (one rule instead of two that fought); onboarding `w-[min(560px,92%)]` → `720px`; Settings `w-[min(760px,92vw)] h-[min(560px,88vh)]` → `w-[min(1040px,92vw)] h-[min(760px,86vh)]`. The `min()` keeps every one of them honest in a restored window.

> `✅UI: dialogs sized for a wide window`

## 23.5 — Measure the contrast, and the theme system sends its invoice

The brief was "enough contrast with background and text everywhere". The temptation is to squint at the screenshot and nudge a few hex values. Measure instead — the palettes are plain data, so WCAG relative luminance is a dozen lines over `THEMES`.

Every one of the six palettes fails the **same** two checks:

| pair | neon | matrix | nord | dracula | black | needs |
|---|---|---|---|---|---|---|
| `text-muted` on the list background | 4.05 | 3.60 | 4.46 | **3.03** | 4.24 | 4.5 |
| `text-muted` inside a panel or chip | 3.81 | 3.26 | 3.60 | **2.51** | 4.00 | 4.5 |
| `border` against its own fill | 1.26 | 1.38 | 1.17 | 1.29 | 1.20 | 3.0 |

Everything else passes comfortably — `text-secondary` on a bar sits between 7.2 and 11.6, the chip text between 8.7 and 19.8. It is specifically two tokens: **one too dark to read, one too dark to see.**

Five palettes failing identically is not five mistakes. Chapter 19's payoff was that a theme is a variable override and no component knows a theme exists. The missing half was any statement of **what a valid override is.** Each palette was authored by eye, against the same instinct, and drifted to the same place.

The text fix is five values, and one in `index.css` for the palette that ships before anyone picks a theme. Hue and saturation stay; only lightness moves, so Matrix stays green and Dracula stays purple:

```
neon     #6b7280 → #767e8d
matrix   #3f6f4f → #4d8861
nord     #8f9bb3 → #a4aec1
dracula  #6272a4 → #95a0c1
black    #707070 → #797979
```

> `✅THEME: readable text-muted in every palette`

### The border wants to be two tokens

Here is where the obvious fix is wrong. Raising `border` to 3:1 makes every kbd chip visible — and also every divider, every panel edge, every hairline between rows, drawn as a hard rule. The list gets louder, not clearer.

`border` is doing two jobs. The quiet line between things, and the edge of something you operate. Only the second needs to be perceivable:

- **`border`** stays as it is — the divider between panels and rows.
- **`border-strong`**, new, ≥3.0:1 — the boundary of a kbd chip, an input, a button, a badge.

A new key means `ThemeKey` in `types.d.ts` gains `| 'border-strong'` — and because chapter 19 typed `colors` as `Record<ThemeKey, string>`, every palette fails to build until it has the value. That is the type doing its job: this is one commit, not five. `KEYS` in `themes.ts` gains the key, each palette its value (`#48638e`, `#2b6d37`, `#818da5`, `#7b7f9b`, `#5d5d5d`), `index.css` its `--color-border-strong: #48638e`, and the rule goes at the top of `themes.ts` where the next palette's author will read it:

```ts
// the contract a palette has to meet (scripts/check-contrast.mjs runs it):
// - text-muted >= 4.5:1 on bg-primary and bg-panel: it carries real
//   information (badges, hints, timestamps), so the body-text bar applies
// - border-strong >= 3:1 on every surface: the edge of a control you operate
// - border is held to nothing on purpose: it is the quiet divider between
//   rows and panels, and a control-grade ratio would draw every hairline
```

> `✅THEME: border-strong token`

Then the sweep. It is short, because chapter 02's `Button` already owns most of the control edges in the app — five variants (`secondary`, `pill`, `badge`, `card`, `choice`) change once and every button in the app follows. The rest are the controls that are not buttons: the kbd chips in `ActionButtons`, `CommandPalette`, `Settings` and `StatusBar`; the search box's border and its `⏎ Enter` hint; the File System pill in `ProjectTree`; `RuntimeIndicator`; the Scanning textarea; the target form's fields and its *windows only* badge. Every `border-b`, `border-t`, `border-r` and panel edge keeps `border`.

> `✅UI: controls take border-strong`

## 23.6 — A contract nobody runs is the situation you just left

Fixing five palettes without writing the rule down means a sixth theme drifts the same way. So the rule becomes a script, and the script joins a gate that already runs. No test runner, no dependency: `scripts/check-contrast.mjs`.

```js
// the contrast contract from the top of src/themes.ts, run over every
// palette and the @theme block in index.css (the one that ships before a
// theme is picked). no runner, no dependency: the palettes are plain data
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

// WCAG 2.1 relative luminance
const luminance = hex => {
	const h = hex.replace('#', '');
	const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
	const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const ratio = (a, b) => {
	const [x, y] = [luminance(a), luminance(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// border is absent on purpose: it is the divider, not the edge of a control
const RULES = [
	{ token: 'text-muted', on: ['bg-primary', 'bg-panel'], min: 4.5 },
	{ token: 'text-secondary', on: ['bg-primary', 'bg-secondary', 'bg-panel'], min: 4.5 },
	{ token: 'text-primary', on: ['bg-primary', 'bg-secondary', 'bg-panel'], min: 4.5 },
	{ token: 'border-strong', on: ['bg-primary', 'bg-secondary', 'bg-panel'], min: 3 },
	{ token: 'accent', on: ['bg-primary', 'bg-secondary'], min: 3 }
];

// parsed, not imported: themes.ts is TypeScript and this runs with no build
const parseThemes = src => {
	const themes = [];
	const re = /id:\s*'([^']+)'[\s\S]*?colors:\s*\{([^}]*)\}/g;
	for (const [, id, body] of src.matchAll(re)) {
		const colors = {};
		for (const [, k, v] of body.matchAll(/'?([a-z-]+)'?:\s*'(#[0-9a-fA-F]{6})'/g)) {
			colors[k] = v;
		}
		themes.push({ id, colors });
	}
	return themes;
};

const parseCssTheme = src => {
	const colors = {};
	for (const [, k, v] of src.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
		colors[k] = v;
	}
	return { id: 'index.css @theme', colors };
};

const palettes = [parseCssTheme(read('../src/index.css')), ...parseThemes(read('../src/themes.ts'))];

if (palettes.length < 2) {
	console.error('check-contrast: parsed no palettes, the file shape changed');
	process.exit(1);
}

const failures = [];
for (const { id, colors } of palettes) {
	for (const { token, on, min } of RULES) {
		const fg = colors[token];
		if (!fg) {
			failures.push(`${id}: missing token "${token}"`);
			continue;
		}
		for (const bgName of on) {
			const bg = colors[bgName];
			if (!bg) continue;
			const r = ratio(fg, bg);
			if (r < min) {
				failures.push(`${id}: ${token} (${fg}) on ${bgName} (${bg}) is ${r.toFixed(2)}:1, needs ${min}:1`);
			}
		}
	}
}

if (failures.length) {
	console.error(`\ncontrast contract violated, ${failures.length} failing pair(s):\n`);
	for (const f of failures) console.error('  ' + f);
	console.error('\nthe rule lives at the top of src/themes.ts. raise the token, not the bar\n');
	process.exit(1);
}

console.log(`contrast ok: ${palettes.length} palettes x ${RULES.length} rules`);
```

`border` is absent from `RULES` on purpose, and the script says so — a rule that omits something should explain the omission, or someone will "fix" the gap later. It checks six palettes, not five: the `@theme` block in `index.css` drifted with the others. The `parseThemes` regex matches the public file's shape — single quotes, no trailing commas — and `palettes.length < 2` is the check on the check: a rewrite of `themes.ts` that the regex no longer reads must fail loudly, not pass on zero palettes.

Then `package.json`:

```json
"build": "bun run check:contrast && tsc && vite build",
"check:contrast": "bun scripts/check-contrast.mjs",
```

Chaining it into `build` matters more than it looks. A separate `check:contrast` script that nothing calls is a gate nobody runs, which is precisely how five palettes drifted in the first place. `bun tauri build` runs `bun run build` for you, so a release cannot ship a seventh palette that fails.

**Prove the check can fail.** A gate that cannot fail is theatre. Put Dracula's old `text-muted` back and run it:

```
contrast contract violated, 2 failing pair(s):

  dracula: text-muted (#6272a4) on bg-primary (#282a36) is 3.03:1, needs 4.5:1
  dracula: text-muted (#6272a4) on bg-panel (#343746) is 2.51:1, needs 4.5:1

the rule lives at the top of src/themes.ts. raise the token, not the bar
```

Exactly the numbers the audit found. Put it back.

> `✅BUILD: contrast check in the build gate`

## 23.7 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun run build
```

`cargo test` reports **65** — chapter 22's 62 plus three for the window state. `bun run build` prints `contrast ok: 6 palettes x 5 rules` before `tsc` runs. Then, with `prefs.json` backed up and its `window_state` key removed (the installed app may already have one):

**First run.** `bun tauri dev`: the window fills the screen, `IsZoomed` true, and the root `div` has no `rounded-xl`. The content column is 1400px wide and centred — the search box, the action row and the rows all stop at the same edges. `prefs.json` still has no `window_state`: the hidden-window guard swallowed the startup events.

**Restore.** Click the title bar's restore button: 900×720 at the centred position, the corners are back, and `prefs.json` now reads `{"maximized": false, "width": 900, "height": 720, "x": …, "y": …}`. Move and resize the window (drag it, or `MoveWindow` from a script): the rect follows. `Ctrl+Q`, `bun tauri dev` again: it opens exactly where you left it, no 900×720 flash first.

**Maximize.** Click maximize: `maximized` flips to `true` and the rect **does not change** — that is the restore button's rectangle, kept. `Ctrl+Q`, launch again: maximized.

**Contrast.** Settings → Appearance → Dracula: `--color-text-muted` on `:root` reads `#95a0c1`, `--color-border-strong` `#7b7f9b`, and the theme cards have edges you can see. The Settings dialog is 1040×760. Switch back to DevGo Neon and clear `localStorage.devgo.theme`.

Restore `prefs.json` and the rest when done.

> `✅STAGE: 23 window`; ff-merge; push.

---

## What you built

```
src-tauri/
  tauri.conf.json              maximized: true (the declared intent)
  src/lib.rs                   remember_geometry; restore in setup; Resized | Moved
  src/services/preferences.rs  WindowState; window_state / set_window_state; 3 tests
src/
  hooks/useMaximized.ts        one subscription to onResized
  App.tsx                      conditional rounded-xl; max-w-[1400px] mx-auto
  types.d.ts                   ThemeKey + 'border-strong'
  themes.ts                    the contract; five text-muted values; border-strong in each palette
  index.css                    the sixth palette, same two changes
  components/Button.tsx        five variants take border-strong
  components/…                 kbd chips, inputs, pills; four dialogs sized for a wide window
scripts/check-contrast.mjs     the contract as a gate, chained into build
```

DevGo opens filling the screen, remembers whatever size you leave it at, and no longer looks like a 900px app stretched to 2560. Its muted text is readable in all five themes and the default, its controls have edges you can see, and a script refuses to let the seventh palette drift.

> **The thread running through this chapter.** A one-line config change was never the work; the work was four rules that had never been asked a question they could get wrong — and then the key turned out not to work at all with a hidden window, which no amount of reading the source revealed and one `IsZoomed` did. **Five identical failures are never five mistakes.** They are a missing rule, and the fix that matters was not the ten hex values; it was the twenty lines that make the eleventh impossible to get wrong.
