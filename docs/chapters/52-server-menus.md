# 52 — Menus That Say What They Do (post-plan)

**Branch:** `52.server-menus` — `git checkout 52.server-menus` gives you this chapter's finished app; `git diff 51.server-forms 52.server-menus` is exactly what this chapter adds.

**Starting from:** chapter 51 — the server declares actions and forms, and DevGo draws them. The app menu was thirty flat rows, and labels like *Logs · {pm2_web}* showed their braces.

**Goal:** a menu that names what each entry acts on, in sections, and that stays on screen however tall it gets. And the *Copy tunnel command* owed since chapter 48.

> **Hold on to:**
> 1. **Placeholders in labels, by the same rule.** *Logs · shop-web* and *Logs · shop-api* on a Turborepo, no *Logs* at all on an app whose processes have no pm2 name: `canFill` runs on the label as well as the line, and `fillLabel` fills it.
> 2. **Sections, not fewer rows.** Every action carries a `group`; the entries are **clustered** by group in the order the groups first appear — not merely headed at first appearance, which put *Open github.com/…* under *nginx* because it was declared late.
> 3. **Measure, never estimate.** `items.length × ROW_H` was wrong in both directions (rows 30, headings 26, separators 9); the menu now caps `max-height` at the viewport, scrolls, and clamps `top` from `getBoundingClientRect()` in a `useLayoutEffect` after it mounts.
>
> Rust: two more `serde(default)` fields on `App` and one on `Action`, nothing else changes — the contract absorbs a schema step. TypeScript: a third `MenuEntry` shape (`{ heading }`) told apart with `'heading' in item`; a `Map` that preserves insertion order doing the clustering.

**Shape of the chapter.** The heading is a third `MenuEntry` in the one `ContextMenu` (`MenuHeading` in `types.d.ts`), rendered by the same map that renders actions and separators; `groupedEntries(acts, entry)` is one function the server menu and the app menu both call. No look pass per theme: the menu adds no colour.

---

## 52.1 — The contract grows two words

`App.pm` (from the lockfile: `pnpm | bun | yarn | npm`) and `App.ecosystem` (pm2's own file, when the app has one); `Action.group`. `placeholders` gains `{pm}` and `{eco}` — *Install (pnpm)*, *Build (pnpm)*, and one *Restart via ecosystem.config.js*, hidden where the file is not (the test asserts `eco` is `None` on the app without the file). ⚠️ The test fixture at this stage is a trimmed live inventory and still carries that box's real names; chapter 69 generalises it, and the text here does not quote it.

> `✅SERVERS: pm, ecosystem and group on the contract`

## 52.2 — Types and a filled label

`ServerApp.pm` / `.ecosystem`, `ServerAction.group`, `MenuHeading`, `MenuEntry` gains it. `serverApps.ts`: `pm` and `eco` in the mirror; `fillLabel(label, values)` — `{pm2_api}` → `shop-api`, a word the contract does not define left as it is.

> `✅TYPES: group, pm, ecosystem, a menu heading`

## 52.3 — The menu

`ContextMenu`: `top` in state, seeded from one row's height, corrected by a `useLayoutEffect` from the menu's measured height; `maxHeight: innerHeight - 16`; `overflow-y-auto`; a heading renders as a small caps label in the muted ink, not focusable, not clickable.

> `✅UI: a menu measured, not estimated, with headings`

## 52.4 — The entries

`groupedEntries` clusters by `group` (a `Map` in first-appearance order), a heading before each named group; `serverActionEntries` and `appActionEntries` use it, the latter filtering by `canFill` on the command **and** the label and showing `fillLabel`. *Make this a root* becomes **Pin as a top-level group** (hint *beside ~ · /var/www*), *Add a root folder…* becomes **List another folder at top level…**, the root drawer and the form's textarea say *top-level folders*. **Copy tunnel command** — `ssh -N <alias>`, the hint showing the line — on a `LocalForward` row with an alias.

> `✅UI: labels that name their target, in sections` · `✅UI: top-level folders, not roots`

## 52.5 — Verify

`cargo test` **185**, `cargo check` 0 warnings, `tsc -b`, contrast and `bun run build` clean. Fifteen files backed up by hash. WSL running, left alone.

**The server menu on `box`** (2560×1392): *Open terminal ⏎ · List folders & apps · List another folder at top level…* — then **Box** (*Inventory (JSON) · Update scripts from git · Server docs*), **pm2** (*List · Ports*), **Backups** (*Health · Off-site sizes*), **nginx** (*TLS certs & days left SUDO · nginx -t SUDO · Tail error log SUDO · New site… SUDO · FORM*), **DNS** (*Add record… FORM · Records (example.com) · Remove record… TYPES · This box's addresses*), **Database** (*Restore… TYPES*) — then *Copy ssh command · Copy scp prefix · Edit… · Remove*. The clustering shows: *Update scripts from git* and *Server docs* sit under **Box** though the file declares them last. The menu's bottom at **1384 of 1392** — clamped by its measured height, not scrolling.

**The app menu on `shop`**: **App** (*Shell in /var/www/shop · Logs · shop-web · Logs · shop-api · Status · shop-web · Status · shop-api · Restart via ecosystem.config.js · Install (pnpm) · Build (pnpm) · Pull · install · build · restart TYPES*), **Git** (*What is deployed · Pull TYPES · Open github.com/user/shop ↗*), **nginx** (*Site config · shop · Regenerate site… SUDO · FORM · Tail access log · shop.example.com SUDO · Open https://shop.example.com ↗*), **Config** (*Env files present*), **Database** (*psql · shop-db TYPES · DB tunnel from this PC THIS PC*). On `blog` (docker processes, no pm2 name): *Install (pnpm) · Build (pnpm) · Site config · blog · Open https://blog.example.com · psql · blog-db* — no *Logs*, no *Status*, no *Restart* (no `ecosystem`): hidden, not broken.

**A short window.** With the viewport emulated at **1200×700** over CDP (`Emulation.setDeviceMetricsOverride`; the window itself is maximized), the `shop` menu: `top 8 · bottom 692 · clientHeight 682 · scrollHeight 1049 · scrolls: true` — on screen, scrolling, nothing under the footer.

**The tunnel.** *Servers: import from ~/.ssh/config* from the palette (the hook reloads) → `box-db` back as a *tunnel* row; its menu carries **Copy tunnel command ⟶ SSH -N BOX-DB**; click → the OS clipboard reads `ssh -N box-db` (read from PowerShell — the webview refuses `readText`). Not on `box` (no forward).

`Ctrl+Q`, the localStorage sets reset, all fifteen files restored and hash-matched (the import undone), the installed DevGo restarted.

> `✅STAGE: 52 server-menus`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/server_apps.rs    App.pm / .ecosystem; Action.group; {pm} {eco}
src/
  types.d.ts                     pm, ecosystem, group; MenuHeading in MenuEntry
  serverApps.ts                  pm, eco; fillLabel
  components/ContextMenu.tsx     measured top, max-height, scroll; the heading
  App.tsx                        groupedEntries; canFill on labels; fillLabel; the tunnel entry; top-level words
  components/ServerForm.tsx      the textarea's label
```

Labels that name their target, hidden when they cannot; sections from the contract, clustered, headed, in file order; a menu that measures itself instead of guessing; plain words for the folder groups; and the tunnel line that was owed.

> **The thread running through this chapter.** Nothing new is computed here — the inventory already knew the process names and the file already carried the groups. What changed is that the menu stopped guessing: about its own height, and about what a label meant.
