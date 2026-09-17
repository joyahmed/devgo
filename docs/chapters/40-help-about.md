# 40 — The Rules Were in the Comments; the Users Never Saw Them (post-plan)

**Branch:** `40.help-about` — `git checkout 40.help-about` gives you this chapter's finished app; `git diff 39.github-branches 40.help-about` is exactly what this chapter adds.

**Starting from:** chapter 39 — every GitHub row has its branches. The app has eight Settings panels and not one of them says what DevGo is. Every rule it lives by — never boot a stopped distro, the `{script}` seam, `gh` owning auth, where the JSON lives — is a code comment or a chapter of this tutorial, and a person who installed the `.exe` sees neither.

**Goal:** Help and About, in-app and offline; a `?` in the title bar and a *Help* beside *Commands* in the footer; the GitHub caveat on the first-run screen; both in the palette. And two things seen while it was on screen: the name is the click target, and a divider between workspaces.

> **Hold on to:**
> 1. **Help names the real keys and the real folder.** Every key comes from `shortcutFor`, the folder from a command — a rebinding or a moved app-data dir shows up in Help with nobody editing prose.
> 2. **About cannot lie about its version.** `getVersion()` reads `tauri.conf.json` through the runtime, so the number is the installer's.
> 3. **The name is the target; the row is where you read.** Select and launch live on the name cell; the row keeps its hover, its rail and its right-click.
>
> Rust: three tiny commands, one of them reusing `open_in_browser` (the `https://`-only door). TypeScript: `@tauri-apps/api/app`'s `getVersion`; sections as a data table mapped once; a `[&+&]:` variant so the first of a run gets no divider.

> Someone who did not build DevGo has no way to learn its rules from inside it: there is no Help and no About. The people the app is for are not the people who read its comments.

---

## 40.1 — Three doors in Rust

`open_url(url)` is `open_in_browser` with a name — the same door `open_remote` uses, `https://` only. `get_app_data_dir` is the lock file's parent (`AppState.lock_path`, chapter 18), which is where every JSON file lives; `reveal_app_data_dir` hands that folder to `explorer`. Three registrations.

> `✅CMD: help doors`

## 40.2 — Help: seven sections and a live one

`HelpPanel.tsx`. `HelpSection` — a 15 px heading and a 13 px paragraph — and `Code` are named exports beside the default, because About uses them too. The seven fixed sections are a `SECTIONS` table mapped once: *What DevGo is* · *Workspaces and the scan* · *WSL: DevGo never starts a stopped distro* · *Editors and terminals are templates you own* · *tmux / psmux* · *GitHub* (the rows under the workspaces, `gh` owning the login, fetched only when you ask, the live search as the one keystroke that reaches the network) · *Keyboard*. The keys it names — `Ctrl+N`, `F5`, `Ctrl+Shift+P`, `Ctrl+=` / `Ctrl+-` / `Ctrl+0` — come from `shortcutFor`. The eighth section, *Where your config lives*, is the one with a live value and a button: the folder from `get_app_data_dir`, and *Reveal in Explorer*. Registered in the Settings panel list as `help`. `HelpSectionProps`, `HelpPanelProps` in `types.d.ts`.

Short on purpose. A Help that is a README nobody reads is a README nobody reads.

> `✅UI: help panel`

## 40.3 — About: a version that cannot drift

`AboutPanel.tsx`: the mark, the name, `v{version}` from `getVersion()`, one sentence. *Source* — the repository, through `open_url`; one link, because the chapters of this book land on the repository's branches as `✅DOCS:` commits later and there is nothing else to point at until they do. *Third-party*: the GitHub CLI is MIT, by GitHub, **not bundled** — DevGo runs the copy you installed and it holds your login; psmux likewise; Tauri, React and Tailwind under their own licences. ⚠️ No licence line for DevGo itself: the repository carries no `LICENSE` and no `license` field, and inventing one here would be a legal statement nobody made. Registered as `about`.

> `✅UI: about panel`

## 40.4 — Four doors

- A `?` in the title bar, left of the gear — `openSettings('help')`, the deep-link door Shortcuts has used since chapter 16.
- Footer: *? Help* beside *Commands*, the same quiet ghost; `StatusBarProps.onOpenHelp`.
- Palette: *Help* and *About DevGo*.
- First run: one line under the buttons — *GitHub repos need the GitHub CLI, logged in: see Help, the ? in the title bar* — so a new user learns it before the GitHub rows look empty.

> `✅UI: four doors to help`

## 40.5 — Two things, found live

- **A whole row as the click target is a liability** — on a 2,400 px row a click meant for the empty middle, or a double-click near a chip, selected or launched a project. **The name cell is the click target now**, on project rows, pinned rows and GitHub rows alike: `onClick` / `onDoubleClick` move from the row to the name, `cursor-pointer` with them; the row keeps its hover, its rail and its right-click (which still selects first, so the menu and the keyboard agree).

> `✅UI: the name is the click target`

- **Workspaces need a divider** — a hairline and a breath over every workspace after the first: `[&+&]:border-t [&+&]:border-border [&+&]:mt-1 [&+&]:pt-1` on the workspace's wrapper, so the first group has none. The header alone did not close the group above it once the rows went quiet in chapter 37.

> `✅UI: divider between workspaces` — `bun run build` clean.

## 40.6 — Verify

`cargo test` **150**, `cargo check` 0 warnings. Back up the six files. **No link is clicked** — *Repository* ends in a browser; *Reveal in Explorer* opens an Explorer window, which the script closes.

**The doors.** The title bar's buttons read *No WSL distro is running · Help · Settings*; the footer ends *… Commands · ? Help*. `?` → the Settings drawer with **Help** active and the eight headings *What DevGo is · Workspaces and the scan · WSL: DevGo never starts a stopped distro · Editors and terminals are templates you own · tmux / psmux · GitHub · Keyboard · Where your config lives*; the `code` spans read `Ctrl+N, package.json, Cargo.toml, .git, F5, {path}, {distro}, {linux_path}, winget install marlocarlo.psmux, gh, gh auth login, gh auth logout, Ctrl+Shift+P, Ctrl+=, Ctrl+-, Ctrl+0, .bak`, and the last section prints `C:\Users\<you>\AppData\Roaming\app.zetta.devgo`. *Reveal in Explorer* → one Explorer window titled `app.zetta.devgo`, closed over UIA. **About** → `✦ DevGo v0.1.0`, *Source › Repository*, *Third-party*. The footer's *? Help* → the drawer with **Help** active. Palette, `about` → *About DevGo — Version, source, third-party*. The first-run line needs an empty `workspaces.json` and was not opened.

**The name is the target.** `docs` selected through the box; the `devgo` row scrolled into view: a click on its workspace cell (12 %) leaves `docs` selected, a click on its file-system cell (70 %) the same, a click on its name selects `devgo`. The row's computed `cursor` is `auto`, the name cell's `pointer`.

**Dividers.** The seven workspace wrappers: the first `0px / 0px / 0px` (border-top / margin-top / padding-top), the other six `1px / 4px / 4px`.

`Ctrl+Q`, restore the six files (all matched).

> `✅STAGE: 40 help-about`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/commands.rs, lib.rs  open_url, get_app_data_dir, reveal_app_data_dir
src/
  components/HelpPanel.tsx     HelpSection, Code (named); SECTIONS table; the live config section
  components/AboutPanel.tsx    version from getVersion; Source; Third-party
  components/Settings.tsx      help and about panels
  components/StatusBar.tsx     ? Help beside Commands
  components/Onboarding.tsx    the GitHub line
  components/ProjectTree.tsx   the name cell is the click target; workspace dividers
  components/GithubLane.tsx    the name cell is the click target
  App.tsx                      the ? in the title bar; palette entries; onOpenHelp
  types.d.ts                   HelpSectionProps, HelpPanelProps; StatusBarProps.onOpenHelp
```

The app can now explain itself to someone who is not you.

> **The thread running through this chapter.** Nothing in Help is typed twice: the keys are the shortcut table's, the folder is the lock file's parent, the version is the installer's. Prose that reads live values cannot go stale the way a README does.
