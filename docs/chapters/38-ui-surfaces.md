# 38 — Drawers, Not Web Modals (post-plan)

**Branch:** `38.ui-surfaces` — `git checkout 38.ui-surfaces` gives you this chapter's finished app; `git diff 37.ui-rows 38.ui-surfaces` is exactly what this chapter adds.

**Starting from:** chapter 37 — the rows sit on one type scale, the footer is the action bar. Every *secondary* surface, though, is still the web's: a centred card on a dimmed backdrop (`Modal.tsx`), a second and larger copy of that card for Settings with its own Escape handler, a third overlay for the command palette, and the menu and the toast each choosing their own radius and fill.

**Goal:** one secondary surface — a drawer that slides in from the edge it belongs to and leaves the list visible beside it — plus four small things found while watching it live: smaller workspace headers and footer, keycaps in caps, a user-set text size, and an Enter chip on the GitHub box.

> **Hold on to:**
> 1. **One secondary surface.** Right to work in, top to pause. Escape, the backdrop, focus-in, Tab-cycling and focus-back live in one component, so no content has to do them again.
> 2. **The list stays in view.** A drawer is beside your work, not over it; a confirm is a pause, not a place.
> 3. **The size is the user's, and it is the webview's zoom.** Not a second type scale: the five tokens, the spacing and the chips grow together, so 120 % DevGo is the same design at 120 %.
>
> Rust: none — one capability line (`core:webview:allow-set-webview-zoom`). TypeScript: a focus trap in one effect (`querySelectorAll` of the focusable set, head and tail swapped on Tab); `document.activeElement` remembered in a ref and restored in the cleanup; a `CustomEvent`-free `window.dispatchEvent(new Event(…))` so a panel can follow a shortcut; `getCurrentWebview().setZoom`.

> Secondary surfaces should not appear as web modals: a drawer from the right or from the top, whichever fits the content, keeps the list in view. A desktop launcher's Settings is not a dialog; it is a panel you work in while the thing it configures stays in view.

---

## 38.1 — `Drawer` replaces `Modal`

The prop shape, not code from the tip — App spells every use as `<Drawer {...{ side: 'top' as const, open: …, width: … }}>`:

```tsx
<Drawer open side='right' title='Clone from GitHub' width='w-[min(640px,92vw)]' onClose={…}>
<Drawer open side='top' title='Remove workspace' onClose={…}>            // a confirm sheet
<Drawer open side='top' width='w-[min(780px,92vw)]' onClose={…}>        // the palette, no title
```

One component, two sides. **Right** for anything you work inside — Settings, the clone and group pickers, *Add a repo*, *New group* / *Rename*, the scan picker: full height, `border-l`, the inner corners on `radius-panel`. **Top** for a sentence and two buttons — the confirm sheets — and for the palette. Both sit *under* the title bar (`top-12`), so the window's own chrome is never covered; the backdrop is `bg-black/40`, lighter than the modal's `/60`, because the list behind it is meant to be read.

What the frame owns, so no content has to: **Escape** and **backdrop-click** close it; **focus moves in** when it opens — to the first control in the *body* (`[data-drawer-body]`), which is *Cancel* on a confirm and the input on a name box, never the header's ✕; **Tab cycles** inside it; and **focus returns** to whatever had it when it closes. `Modal` did the first two, and Settings did the first one again by hand. Two keyframes in `@theme`: `slide-left` (`translateX(24px)` → 0) for the right drawer and `slide-down` for the top sheet — which carries its `translateX(-50%)` centring through both frames, or the sheet would jump sideways on the last one. 180 ms, the toast's length; `prefers-reduced-motion` collapses both, as chapter 37 arranged. `DrawerProps` replaces `ModalProps`; the ✕ is a ghost `Button`. `ConfirmDialog` becomes a top sheet (*Remove workspace*, sentence case), App's five modals become right drawers, the pickers narrow from 680 to 640 px, and `ClonePicker`'s list stops capping at `46vh` inside a full-height panel (`flex-1 min-h-0`); `ScanPicker` keeps its `50vh` because it also renders inline on the first-run screen, where there is no flex parent to fill.

> `✅UI: drawer replaces modal`

## 38.2 — The palette and Settings

**The palette** already dropped from the top and becomes the top drawer's first user instead of its own overlay: `CommandPalette` is content only (a fragment: the input, the list at `max-h-[60vh]`), its Escape row leaves the key map — the drawer owns the key — and App wraps it: `<Drawer side='top' open={paletteOpen} width='w-[min(780px,92vw)]'>`. (The palette's active row has been `Button variant='tab'` with `aria-current` since chapter 16, so the class-order bug a hand-styled row invites here — `bg-transparent` sorting after `bg-bg-selected` — is one it never had.)

> `✅UI: palette is the top drawer`

**Settings** is a right drawer at `w-[min(760px,94vw)]`, `z: 40` so a confirm sheet (50) opens over it: the nav column inside, the list still visible beside it. Its own Escape effect and frame go; the *Settings* heading in the nav steps to `text-18 font-bold` as the drawer's title.

> `✅UI: settings is a right drawer`

## 38.3 — One surface recipe

`bg-secondary` · `border` · `radius-panel` · `shadow-surface` — the drawer, the palette, the context menu, the toast. The menu gains `overflow-hidden` so its first row's hover fill does not poke out of the larger radius; the toast moves from `bg-panel` / `radius-control` to the recipe. Nothing else about them changes.

> `✅UI: one surface recipe`

## 38.4 — Four things, found live

Four changes, each a line:

- **Workspace headers and footer items are too large** — the workspace header's name steps to 13, its path, file system, count and arrow to 11; every footer control steps from 13 to 11 — as a `text-11` on the *span* inside each `target` Button, because the variant carries its own size (see the fix below). A workspace header is a label for the rows, not a row.

> `✅UI: smaller workspace headers and footer`

- **Shortcuts read in caps** — `Kbd` gets `uppercase` at 11 px with tighter padding; the menu hints too. Chapter 37 removed it as a third of the app's caps; keycaps are the exception, because a keycap reads as a keycap. Still CSS-only, so `prettyKeys` keeps feeding tooltips and prose in normal case.

> `✅UI: keycaps in caps`

- **The text size is the user's** — **Ctrl+=** / **Ctrl+-** / **Ctrl+0**, and **Settings › Appearance › Text size**. `textSize.ts`: `TEXT_STEPS` 85 → 150 %, `savedTextScale`, `applyTextScale` (saves, `setZoom`, dispatches `devgo:textscale`), `stepTextScale`. Applied before first paint in `main.tsx` like the theme. The panel's `TextStep` is `−` · *120%* · `+` (two `choice` Buttons from one two-entry table) and *Reset* when it is not 100 %; it listens for the event so a shortcut moves the number too. Three rows in `SHORTCUTS`, three ids, three `fire`s; one capability line.

> `✅UI: text size is the users`

- **The GitHub box has no Enter chip** — the GitHub box has opened the first match on Enter since chapter 36; what it lacked was the chip. `enterHint` when the cache has rows.

> `✅UI: enter chip on the github box`

## 38.5 — Onboarding

The ✧ that stood alone at 24 px above *Welcome to DevGo* sits beside it in the heading; the two buttons are the footer's own `target` variant — the default one with `aria-current`, the plain one — so the first screen and every screen after it press the same.

> `✅UI: onboarding presses the footers buttons` — `bun run build` clean.

**FIX, found live.** *Manage…* and *Commands* in the footer read at 15 px, not 11: the ghost variant carried `text-15`, and since chapter 37's pass a caller's `text-11` is a theme size that sorts *before* it, where the old `text-[11px]` sorted after. Every ghost Button that passed a size was losing it — the footer's two, the pickers' *Tick shown*, TargetManager's and WslControl's. The ghost variant carries no size now (a ghost is a glyph or a word inside something that already has one) and the two ghosts with bare text — the search box's ✕ and WorkspaceManager's — say `text-15` themselves.

> `✅FIX: ghost buttons keep their own size`

## 38.6 — Verify

No Rust changed: **149** tests, `cargo check` 0 warnings. Back up the six files; nothing here opens a browser. The onboarding screen needs an empty `workspaces.json` and was not opened this time.

**Settings.** `Ctrl+,` → `[role=dialog]` at `x=1800..2560, y=48..1392` (760 wide, under the title bar), `slide-left 0.18s`, radius `12px 0 12px 0`, `z-index 40`, `shadow-surface`; focus on *Workspaces*, the first control in the body; the project box still in the DOM behind it. `Escape` → no dialog, focus back in the project box.

**The palette.** `Ctrl+Shift+P` → a top sheet at `x=890..1670`, `slide-down 0.18s`, radius `0 0 12px 12px`, focus in *Type a command…*, the active row at `rgb(30, 58, 95)`; `↓` moves it; `Escape`.

**A confirm.** Right-click a workspace header: the menu at radius 12 px, `overflow: hidden`, *Refresh this workspace F5 · Reveal in Explorer · Remove 01_turbo DEL*. *Remove* → a top sheet *Remove workspace*, 560 × 191 under the title bar, focus on **Cancel**, the red button reads *Remove*; `Escape`.

**Sizes and caps.** The first workspace header: name `01_turbo` at 13 px, path / `WSL` / count at 11. The footer's eleven text elements all at 11 px after the fix (15 before it). `kbd`: `text-transform: uppercase`, 11 px — `CTRL+⏎`, `SHIFT+⏎`, `ALT+⏎`, `CTRL+SHIFT+P`. The GitHub box carries `⏎ Enter`. The main screen's text sizes are still {11, 13, 15, 18}.

**Text size.** `innerWidth 2560, devicePixelRatio 1`; `Ctrl+=` → `2327, 1.1`, `devgo.textScale` = `1.1`; again → `2133, 1.2`; Appearance reads `− 120% + Reset`; `Ctrl+0` while it is open → `− 100% +`, no *Reset*; `2560, 1`.

Remove `devgo.textScale`, `Ctrl+Q`, restore the six files (all matched).

> `✅STAGE: 38 ui-surfaces`; ff-merge; push.

---

## What you built

```
src/
  components/Drawer.tsx        the one secondary surface: right or top, focus in / trap / back, Escape, backdrop
  components/Modal.tsx         deleted
  components/ConfirmDialog.tsx a top sheet
  components/CommandPalette.tsx  content only; the top drawer is App's
  components/Settings.tsx      a right drawer; Text size (TextStep); no Escape effect
  components/ContextMenu.tsx, Toast.tsx   the surface recipe; menu hints in caps
  components/Kbd.tsx           uppercase, px-1.5
  components/ProjectTree.tsx, StatusBar.tsx   headers and footer one step smaller
  components/Button.tsx        ghost carries no size
  components/Onboarding.tsx    ✧ beside the title; target buttons
  textSize.ts                  TEXT_STEPS, savedTextScale, applyTextScale, stepTextScale
  main.tsx                     the saved scale before first paint
  shortcuts.ts                 textBigger, textSmaller, textReset
  index.css                    slide-left, slide-down
  App.tsx                      Drawer ×6 (five right, the palette top); the three text-size fires; enterHint
  types.d.ts                   DrawerSide, DrawerProps (ModalProps gone), TextStepProps; ShortcutId ×3
src-tauri/capabilities/default.json   core:webview:allow-set-webview-zoom
```

The last of the web's dialogs, replaced by the desktop's drawers — and the app's text size handed to the user.

> **The thread running through this chapter.** Every secondary surface used to own its own frame, and every frame owned its own Escape. One `Drawer` owns the edge, the motion, the key and the focus; what the content keeps is what only it knows — a title, a width, which side it belongs to.
