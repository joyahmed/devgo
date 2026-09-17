# 41 — One Ground, One Knob (post-plan)

**Branch:** `41.transparency` — `git checkout 41.transparency` gives you this chapter's finished app; `git diff 40.help-about 41.transparency` is exactly what this chapter adds.

**Starting from:** chapter 40 — the app explains itself. Its window is a solid slab: `body { background: var(--color-bg-primary) }`, one opaque token under five themes.

**Goal:** a transparency setting — the window shows what is behind it, by an amount the user sets, with the OS blur so text stays readable — and a second thing that surfaced while watching chapter 40: the workspace divider in colour and short. (The other ask from that look, the click target narrowed to the name, chapter 40 already did.)

> **Hold on to:**
> 1. **There is exactly one opaque ground.** So the setting is one alpha on it — `--ground-alpha` on `body` and the two chrome bars — and nothing else changes: rows, panels and drawers keep their opaque tokens and stay legible over whatever is behind the window.
> 2. **Two halves, one number.** The OS half is Rust (`set_effects`: Acrylic above 0, nothing at 0); the ground half is CSS. Both read the same preference, and the command that stores it applies it — the window is the preview.
> 3. **The cap is the safety.** Past 60 % the contrast contract, which measures ink on the opaque token, has nothing left to say; the store clamps on the way in, so the file says what the window does.
>
> Rust: a `u8` with `#[serde(default)]` (chapter 26's rule for a new field), `u8::min` as the clamp, `bool::then` to build an `Option<WindowEffectsConfig>`. TypeScript: one CSS variable set from a command before `show()`; a `<input type="range">` whose `onChange` calls the command and takes the *returned* value.

> The idea was checked against Tauri 2's window API before anything was typed: `transparent` on the window, `set_effects()` at runtime, `Acrylic` on Windows 11, `HudWindow` on macOS, nothing on Linux.

---

## 41.1 — The cap and the field

```rust
pub const MAX_TRANSPARENCY: u8 = 60;
pub fn clamp_transparency(percent: u8) -> u8 { percent.min(MAX_TRANSPARENCY) }
```

`Preferences.window_transparency: u8`, `#[serde(default)]` so every prefs.json on disk loads opaque. A Rust `ground_alpha(percent) -> f32` — "so the number is never re-derived in TypeScript" — is tempting and wrong: nothing in Rust would call it, and the frontend has to compute `1 - pct / 100` anyway. The frontend is the only reader of the number, so it is the only place that derives it.

> `✅PREFS: window transparency with a cap`

## 41.2 — Stored clamped

`window_transparency()` clamps on the way out too, so a hand-edited 90 reads back as 60; `set_window_transparency(percent)` stores the clamped value and saves. Three tests: `transparency_is_clamped` (0, 35, 90 → 60, 255 → 60), `set_transparency_stores_the_clamped_value` (set 90, reload the store from the same folder, read 60 — *the file holds the cap, not 90*), and one line in `hotkey_defaults_when_unset`: an old prefs.json loads opaque.

> `✅PREFS: transparency stored clamped` — `cargo test` **152**.

## 41.3 — The OS half

`apply_transparency(window: &WebviewWindow, percent)` in `lib.rs`:

```rust
pub fn apply_transparency(window: &tauri::WebviewWindow, percent: u8) {
    use tauri::window::{Effect, EffectsBuilder};
    let pct = services::preferences::clamp_transparency(percent);
    let effects = (pct > 0).then(|| {
        #[cfg(target_os = "macos")]
        let effect = Effect::HudWindow;
        #[cfg(not(target_os = "macos"))]
        let effect = Effect::Acrylic;
        EffectsBuilder::new().effect(effect).build()
    });
    if let Err(e) = window.set_effects(effects) {
        eprintln!("transparency: {e}");
    }
}
```

`set_effects(None)` at 0 — no acrylic, no compositing cost; Acrylic above it (blur and tint — not Mica, which shows the wallpaper rather than what is behind a window that summons over other windows). Called in `setup()` right after the icon, before the first show, for the same reason geometry and the icon go there: an opaque window that then blurs is a flash. ⚠️ On Windows 11 22H2+ `window-vibrancy` implements Acrylic through `DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_TRANSIENTWINDOW)`, not the older `SetWindowCompositionAttribute` — which has a consequence the Verify section found.

> `✅WINDOW: acrylic behind the knob`

## 41.4 — Two commands

`get_window_transparency` reads the store. `set_window_transparency(percent, window, state)` stores (clamped), applies through `apply_transparency`, and **returns the stored value** — the slider shows what was kept, not what was dragged. The lock is taken in a block and released before the window call. Registered beside `get_summon_hotkey`.

> `✅CMD: get and set window transparency`

## 41.5 — A transparent window

`tauri.conf.json`: `"transparent": true` and nothing else. `windowEffects` is not set in the config, so "off" is genuinely off.

> `✅CONFIG: transparent window`

## 41.6 — One ground, one alpha

`index.css`: `:root { --ground-alpha: 1 }`, and

```css
body { background: color-mix(in srgb, var(--color-bg-primary) calc(var(--ground-alpha) * 100%), transparent); }
.ground-chrome { background: color-mix(in srgb, var(--color-bg-secondary) calc(var(--ground-alpha) * 100%), transparent); }
```

`TitleBar` and `StatusBar` swap `bg-bg-secondary` for `ground-chrome`. ⛔ Inverse: nothing else gets an alpha. Rows, panels and drawers are *on* the ground and keep their tokens; the contrast gate (chapter 23, chained into `build`) keeps measuring exactly what it measured before. The scaffold's `bg-[#080C12]` on `<body>` in `index.html` is still there and loses to this rule — a layered utility never beats an unlayered author style — so it was left alone.

> `✅UI: one ground alpha on the body`

## 41.7 — The alpha from the preference, before the first show

`src/transparency.ts`, beside `textSize.ts`: `MAX_TRANSPARENCY = 60` (a label for the slider's end — Rust clamps), `applyGroundAlpha(percent)` sets the variable on `documentElement`, `loadGroundAlpha()` reads the command and applies it, `setTransparency(percent)` calls `set_window_transparency` and applies the value it returns. `App`'s mount effect becomes `loadGroundAlpha().finally(() => getCurrentWindow().show())` — a see-through install never flashes opaque.

> `✅UI: ground alpha from the preference`

## 41.8 — The window is the preview

Settings › Appearance › *Transparency*, between *Text size* and *Hint words*. `TransparencySlider` (`TransparencySliderProps` in `types.d.ts`: `value: number | null`, `onChange`) is *Opaque* · a range 0–60 in steps of 5, `accent-accent` · *See-through* · the number. `AppearancePanel` holds `transparency` as `number | null` — null until `get_window_transparency` answers, and the input is `disabled` until then, so the thumb never sits at 0 on a see-through window. `previewTransparency` shows the dragged value at once, then the stored one when it comes back. There is no Save. One paragraph says Windows 11 and macOS, nothing on Linux, and why the cap.

> `✅UI: transparency slider in appearance`

## 41.9 — Watching it live

The ask, watching the knob: *a colourful divider, and not full width* — the chapter-40 hairline becomes a short gradient rule in the group's hue: `h-px ml-4 mb-1 w-[38%] bg-linear-to-r to-transparent` plus `DIVIDER[fs]` — `from-accent/70` for WSL, `from-amber-400/70` for Network, `from-text-muted/50` for Windows, the same hues the rail (`RAIL`) and `FsCell` use, so the divider adds no colour the rows do not already have. A `.ws-group + .ws-group` rule in `index.css` would be one way to say *every group but the first*; the map already has the index — `entries.map(([ws, wsProjects], i) => …)`, `{i > 0 && <div aria-hidden … />}`, and the wrapper's spacing is `i ? 'mt-2 pt-1' : ''`. No CSS, no `[&+&]:`.

> `✅UI: short divider in the groups hue` — `bun run build` clean.

## 41.10 — Verify

`cargo test` **152**, `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. Back up the six files. Headless over CDP; no browser tab. The prefs on this machine already carried `"window_transparency": 0` from an installed build.

**The ground.** `--ground-alpha` on `:root` reads `1`; `body` computes to `color(srgb 0.031 0.047 0.071)` — a `color-mix` result, so the rule wins over the scaffold's `bg-[#080C12]`; `header` and `footer` the secondary token; every element between the pointer and `body` at (1200, 1300) is `rgba(0, 0, 0, 0)`. Settings › Appearance: the range has `min 0 · max 60 · step 5 · value 0`, `aria-label` *Transparency*, the words *Opaque · See-through · 0%*, `accentColor rgb(59, 130, 246)`. Set to **40** through React's `onChange` (native setter + `input` event): the number reads *40%*, `--ground-alpha` is `0.6`, `body` is `color(srgb … / 0.6)`, header and footer too, prefs.json says `"window_transparency": 40`. `set_window_transparency` with **90** over `invoke` returns **60** and the file holds 60; the slider, reopened, shows 60. Back to **0** through the slider: alpha `1`, file `0`.

**The window really is transparent — by number, over a red window.** A borderless red WinForms form placed directly under DevGo in z-order (its own timer re-inserts it under the DevGo hwnd every 200 ms; DevGo made `HWND_TOPMOST` for the test so both sit above every other window), then a 1×1 `CopyFromScreen` at three window points:
- alpha 1, effect off: title bar `rgb(12,18,28)`, ground `rgb(8,12,18)` — the theme tokens, exactly.
- alpha 0.6, `set_effects(None)`: ground `rgb(107,7,11)` = 0.6 × (8,12,18) + 0.4 × red. The DOM half works and the window is see-through.
- alpha 0.6, Acrylic, window **inactive**: ground `rgb(39,41,45)` at every point, red or video behind — DWM paints a system backdrop's flat fallback on an inactive window. With the window **active** (summoned by its own hotkey) and Chrome's video behind, the same points read `(134,123,118)`, `(222,202,174)`, `(175,33,26)` across frames — the backdrop follows what is behind. ⚠️ The red-under-active-DevGo grab was not achieved: the summon and the foreground lock kept trading places, and `Ctrl+Alt+Space` through `SendKeys` once left the Alt-Tab switcher up on screen (dismissed by hand — do not script the hotkey). What the numbers prove: the effect is applied and removed on the knob, and it composites the desktop when the window is the active one. What only an eye can judge: the tint.

**Startup.** Slider to 40, `Ctrl+Q`, relaunch: `--ground-alpha` is `0.6` before anything else is read, no `transparency:` line on stderr, and the red-under grab reads `rgb(102,113,129)` — not the no-effect `(107,7,11)`, so `apply_transparency` ran in `setup()`. Slider back to 0 (file `0`), `Ctrl+Q`.

**Dividers.** Seven workspace groups, six dividers, the first group has none; each `1px` high, `952 px` of a `2506 px` group (**38 %**), inset `16 px`; `background-image` is `linear-gradient(to right, oklab(… / 0.7) 0%, rgba(0, 0, 0, 0) …)`; two hues on this machine — the accent at 0.7 (WSL) and text-muted at 0.5 (Windows); wrappers `0px/0px` then `8px/4px` (margin-top / padding-top); `border-top` `0px` on all seven.

Restore the six files (all matched; ch. 22's `targets.json.bak` deleted); the installed DevGo restarted.

> `✅STAGE: 41 transparency`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/preferences.rs  MAX_TRANSPARENCY, clamp_transparency; window_transparency field, getter, setter; 2 tests + 1 line
  src/lib.rs                   apply_transparency (Acrylic / HudWindow / none); applied in setup before show
  src/commands.rs              get_window_transparency, set_window_transparency (returns the stored value)
  tauri.conf.json              "transparent": true
src/
  transparency.ts              MAX_TRANSPARENCY, applyGroundAlpha, loadGroundAlpha, setTransparency
  index.css                    --ground-alpha; body and .ground-chrome through color-mix
  App.tsx                      loadGroundAlpha before show()
  components/TitleBar.tsx      ground-chrome
  components/StatusBar.tsx     ground-chrome
  components/Settings.tsx      TransparencySlider; the Transparency section in Appearance
  components/ProjectTree.tsx   DIVIDER hues; the short gradient rule by index
  types.d.ts                   TransparencySliderProps
```

Five themes, one alpha, nothing else moves. Off is off: no effect at 0, and every existing install stays exactly as it was.

> **The thread running through this chapter.** The setting is one number in one place. Rust clamps it, stores it, applies the OS half and hands it back; the frontend puts the same number in one variable. Nothing derives a second copy that could drift.
