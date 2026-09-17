# 00 — Prerequisites

## Tools You Need

| Tool | Check | Install |
|------|-------|---------|
| Rust | `rustc --version` | `winget install Rustlang.Rustup` then `rustup default stable` |
| Node.js | `node --version` | `winget install OpenJS.NodeJS.LTS` |
| bun | `bun --version` | `powershell -c "irm bun.sh/install.ps1 \| iex"` |
| Git | `git --version` | `winget install Git.Git` |
| VS Code | `code --version` | `winget install Microsoft.VisualStudioCode` |
| Windows Terminal | `wt --version` | Microsoft Store or `winget install Microsoft.WindowsTerminal` |

Optional but used later:
- **WSL**: `wsl --list` (Ubuntu recommended: `wsl --install -d Ubuntu`)
- **Tauri CLI**: comes with `bun`; `cargo install tauri-cli` if needed separately

## What You'll Learn

### Rust (the real focus)
- Structs, enums, impl blocks, traits
- `serde` for JSON serialization (Serialize, Deserialize)
- `thiserror` for custom error types
- `Result<T, E>` — Rust's error handling philosophy
- Ownership, borrowing, `Clone`, `Arc`
- Tauri patterns: `AppState`, `manage()`, `#[tauri::command]`
- Process spawning: `std::process::Command`, reading stdout/stderr
- Path manipulation, filesystem traversal

### React + Tauri
- `useState`, `useEffect` — and *when* to use each (the React Compiler is on, so there is no `useCallback` or `useMemo` to learn)
- `invoke()` — calling Rust commands from the frontend
- Tauri events — listening for backend events in React
- Custom hooks pattern — `useWorkspaces`, `useProjects`
- Tailwind CSS v4 — utility-first styling without CSS files
- Component composition — small, single-responsibility components

## Project Name

We'll call it **DevGo**. Make an empty folder anywhere. For this tutorial we use:

```powershell
mkdir D:\Projects\devgo-tutorial
cd D:\Projects\devgo-tutorial
```

All paths in the tutorial are relative to this root.

## How the tutorial works

The book is **76 chapters, and each chapter is a branch.** Chapter `NN` ends with the app in a
definite state, and that state is checked in as branch `NN.name` — so you can build along, or
you can jump:

```powershell
git checkout 05.launcher          # the app exactly as chapter 05 leaves it — it builds and runs
git diff 04.wsl 05.launcher       # everything chapter 05 adds, and nothing else
```

Every branch descends from the one before it, and the last one, `76.repo-traffic`, is the
finished app. Nothing is thrown away later: a line you write in chapter 03 is still there in
chapter 76. That is the rule the whole book is written to — *every line the tutorial tells you
to write exists in the final repo* — and it is what makes the diff between two branches an
honest answer to "what did this chapter actually change?"

Each chapter introduces **one Rust unit — a model, a store, a service, a command group — and only
the React that calls it.** So the UI arrives a piece at a time, beside the backend feature it
exists for, rather than all at once.

Each chapter's text lives on its own branch too, as `docs/chapters/NN-name.md`: check the branch
out and the chapter that describes that tree is in it. The one exception to the numbering is
chapter 55, **DevGo on a Mac**: it was typed on a Mac after chapter 65, so `55.macos` branches
from `65.github-local-live` rather than from `54.portable-crate`, and chapter 56 continues from 54.
| chapter | branch |
|---|---|
| [01 — Project Scaffold](./01-scaffold.md) | `01.scaffold` |
| [02 — Workspaces](./02-workspaces.md) | `02.workspaces` |
| [03 — The Scanner](./03-scanner.md) | `03.scanner` |
| [04 — WSL Detection](./04-wsl.md) | `04.wsl` |
| [05 — Launcher Service](./05-launcher.md) | `05.launcher` |
| [06 — The Cache, and the Rule the App Is Built Around](./06-cache.md) | `06.cache` |
| [07 — One Instance, in the Tray](./07-single-instance.md) | `07.single-instance` |
| [08 — Remembering Between Launches](./08-last-project.md) | `08.last-project` |
| [09 — Launcher-Grade Access](./09-summon-rank.md) | `09.summon-rank` |
| [10 — Git at a Glance](./10-git.md) | `10.git` |
| [11 — Keyboard-First & the Settings Shell](./11-keyboard.md) | `11.keyboard` |
| [12 — WSL Control](./12-wsl-control.md) | `12.wsl-control` |
| [13 — The Editor & Terminal Registry](./13-targets.md) | `13.targets` |
| [14 — Project Intelligence](./14-intelligence.md) | `14.intelligence` |
| [15 — Quick Actions & Paths](./15-quick-actions.md) | `15.quick-actions` |
| [16 — Command Palette](./16-palette.md) | `16.palette` |
| [17 — Onboarding & Scan Config](./17-onboarding.md) | `17.onboarding` |
| [18 — Tray Quick-Launch](./18-tray-launch.md) | `18.tray-launch` |
| [19 — Polish, Themes & Portability](./19-themes-portability.md) | `19.themes-portability` |
| [20 — The Settings That Were Already There](./20-settings-surface.md) | `20.settings-surface` |
| [21 — Nested Projects, Any Layout](./21-nested-discovery.md) | `21.nested-discovery` |
| [22 — The Failures That Said Nothing](./22-config-guard.md) | `22.config-guard` |
| [23 — What Breaks When It Grows, and What Was Never Readable](./23-window.md) | `23.window` |
| [24 — Finding What Is Actually Installed](./24-editor-detection.md) | `24.editor-detection` |
| [25 — One Row, Many Editors](./25-launch-surface.md) | `25.launch-surface` |
| [26 — Your tmux, Not Mine](./26-tmux-windows.md) | `26.tmux-windows` |
| [27 — What Slow Actually Is](./27-perf.md) | `27.perf` |
| [28 — The Same Session on Both Sides](./28-psmux.md) | `28.psmux` |
| [29 — Where the Taskbar Gets Its Icon](./29-taskbar.md) | `29.taskbar` |
| [30 — Scan for Folders, Check the Ones You Want](./30-scan-pick.md) | `30.scan-pick` |
| [31 — The List in Your Order](./31-workspace-order.md) | `31.workspace-order` |
| [32 — From a Row to the Repo](./32-remote-branches.md) | `32.remote-branches` |
| [33 — The Rule We Retired, and the One That Replaced It](./33-github-catalog.md) | `33.github-catalog` |
| [34 — Get It on Disk](./34-github-clone.md) | `34.github-clone` |
| [35 — Groups Are Labels](./35-github-groups.md) | `35.github-groups` |
| [36 — One Strip Fewer, Two Boxes](./36-ui-chrome.md) | `36.ui-chrome` |
| [37 — Tokens the Components Cannot Disobey](./37-ui-rows.md) | `37.ui-rows` |
| [38 — Drawers, Not Web Modals](./38-ui-surfaces.md) | `38.ui-surfaces` |
| [39 — Branches on GitHub Rows](./39-github-branches.md) | `39.github-branches` |
| [40 — The Rules Were in the Comments; the Users Never Saw Them](./40-help-about.md) | `40.help-about` |
| [41 — One Ground, One Knob](./41-transparency.md) | `41.transparency` |
| [42 — Neon Is Neon](./42-neon.md) | `42.neon` |
| [43 — Cards, Not Rails](./43-lane-cards.md) | `43.lane-cards` |
| [44 — Your Terminal Is Still There](./44-live-sessions.md) | `44.live-sessions` |
| [45 — The Agent Runs in a Real Terminal](./45-agent-targets.md) | `45.agent-targets` |
| [46 — The Honest Number](./46-startup-budget.md) | `46.startup-budget` |
| [47 — Your Machines, One Enter Away](./47-servers.md) | `47.servers` |
| [48 — The Folders on the Box](./48-server-folders.md) | `48.server-folders` |
| [49 — Look Inside](./49-server-tree.md) | `49.server-tree` |
| [50 — The Apps on the Box](./50-server-apps.md) | `50.server-apps` |
| [51 — One Click for a New nginx Site](./51-server-forms.md) | `51.server-forms` |
| [52 — Menus That Say What They Do](./52-server-menus.md) | `52.server-menus` |
| [53 — A Day of Using It](./53-polish.md) | `53.polish` |
| [54 — The Portable Crate](./54-portable-crate.md) | `54.portable-crate` |
| [55 — DevGo on a Mac](./55-macos.md) | `55.macos` |
| [56 — Equal Lanes](./56-equal-lanes.md) | `56.equal-lanes` |
| [57 — One Container's Null](./57-docker-null.md) | `57.docker-null` |
| [58 — A Workspace's Door](./58-workspace-reveal.md) | `58.workspace-reveal` |
| [59 — Nobody's Child, Fully](./59-clean-environment.md) | `59.clean-environment` |
| [60 — A Partial Listing Is Not a Scan](./60-partial-listing.md) | `60.partial-listing` |
| [61 — A Project's Menu Is About the Project](./61-project-menu.md) | `61.project-menu` |
| [62 — The WSL Light](./62-wsl-light.md) | `62.wsl-light` |
| [63 — Every Menu, Read Once](./63-menu-audit.md) | `63.menu-audit` |
| [64 — Every File System, Named](./64-filesystems.md) | `64.filesystems` |
| [65 — The Local Mark, Live](./65-github-local-live.md) | `65.github-local-live` |
| [66 — Equal Lanes](./66-lanes.md) | `66.lanes` |
| [67 — The Chrome](./67-chrome.md) | `67.chrome` |
| [68 — The README](./68-readme.md) | `68.readme` |
| [69 — The Row Is Its Name](./69-server-privacy.md) | `69.server-privacy` |
| [70 — Release](./70-release.md) | `70.release` |
| [71 — A Clone Says Where It Went](./71-screenshots.md) | `71.screenshots` |
| [72 — Where a Server Opens](./72-server-terminals.md) | `72.server-terminals` |
| [73 — Teach a Server to Describe Itself](./73-server-contract.md) | `73.server-contract` |
| [74 — Set Up This Box](./74-built-in-contract.md) | `74.built-in-contract` |
| [75 — The Attach View](./75-attach-view.md) | `75.attach-view` |
| [76 — Repo Traffic](./76-repo-traffic.md) | `76.repo-traffic` |

Chapters 01–08 are the foundation: a workspace list, a scanner, WSL awareness, a launcher, and
the caching rule the whole app is built around (never boot a stopped distro behind the user's
back). 09–19 turn a project list into a launcher: summon, git, keyboard, WSL control, editors and
terminals, a palette, onboarding, themes. 20–32 are what daily use asked for: settings, nested
projects, guarded config, a window that behaves, editor detection, tmux, psmux, the taskbar, a
scan picker, ordering, and a branch chip that opens somewhere. 33–46 add GitHub (catalogue,
clone, groups, branches) and rework the UI (tokens, drawers, transparency, cards, live sessions,
agents). 47–54 add servers: import, folders, a tree, apps, forms, menus, a portable crate. 55 is
the Mac. 56–76 are a second season of daily use — every menu read once, every file system named,
the chrome, the README, a release, server terminals, a server contract, the attach view, and repo
traffic.

Each chapter ends with a **commit checkpoint** — the stage commit (`✅STAGE: NN name`) plus the
chapter's own commits. The `✅DOMAIN: task` shape is just DevGo's convention; the point is that a
stage is one commit whose diff is one idea.

**Before you start**, create a repo and make your first commit:

```powershell
mkdir D:\Projects\devgo-tutorial
cd D:\Projects\devgo-tutorial
git init
echo "# DevGo" > README.md
git add -A
git commit -m "✅Init: empty project"
git remote add origin https://github.com/YOUR_USERNAME/devgo-tutorial.git
git push -u origin main
```

## Ready?

→ Next: [01 — Project Scaffold](./01-scaffold.md)