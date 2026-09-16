# DevGo

A launcher for a developer's projects. Point it at the folders that hold them, on every filesystem the machine can see, and it lists every project, finds one in a few keystrokes, and opens it in the editor, terminal or agent you already use. It is not an editor, a terminal or a git client. It opens the door and gets out of the way.

On this Windows machine that means the local drives and the WSL distros. On a Mac it means the local disk. Beside those, the GitHub account you are logged into and the servers in your ssh config get a lane of their own.

<!-- screenshots: docs/screenshots/{windows,mac} -->

Tauri 2, Rust on the back, React 19 and Tailwind on the front, bun for the scripts.

## The four lanes

The window is one row of lanes. From 1900 px they sit side by side; from 1400 they fold into two rows; narrower, they stack.

- **Windows** (or **Mac**, **Linux**): workspaces on the local disk. A workspace is a folder that holds projects. Add one with `Ctrl+N`, by scanning the usual roots, or by dropping a folder on the window. Depth 1 lists every immediate child; deeper, a folder is a project only when it carries a marker (`package.json`, `Cargo.toml`, `.git`, …), so a monorepo's apps become rows without every subfolder becoming one. Every row shows what the scanner found: the framework, the package manager, the git branch, `recent`.
- **WSL**: the same, for workspaces inside a distro (`\wsl.localhost\<distro>\...`). DevGo never boots a stopped distro to read them; the rows show the last list, marked `cached · WSL stopped`, until you refresh or open one. The title bar chip says what is running and can stop a distro.
- **GitHub**: every repository you own, through `gh`. Search it, group it, clone it into a workspace, open any branch's page.
- **Servers**: the machines you ssh into. Enter opens a terminal on one in a tmux session that survives; expand it and it lists its folders and, when the box describes itself, its apps and their actions.

The search box over each lane filters that lane. `Ctrl+K` puts you in the first one, `Ctrl+G` in GitHub's. Pin a project with `Ctrl+S` and it stays at the top; sort by frecency, activity or name.

## Launch targets

A target is a program plus how to hand it a directory. DevGo detects the usual ones on this machine (VS Code, Cursor, Windsurf, Zed, Sublime, the JetBrains IDEs, Windows Terminal, Alacritty, WezTerm; on a Mac Terminal, iTerm2, Ghostty, Kitty as well) and, on Windows, inside each running distro. Add your own in Settings › Editors & Terminals with a template: `{path}`, `{distro}`, `{linux_path}`. A WSL project opens where it lives: VS Code through Remote-WSL, a terminal inside the distro in the project directory.

Three kinds of target, three keys: the editor (`Ctrl+Enter`), the terminal (`Shift+Enter`), the agent (`Ctrl+Alt+Enter`, Claude Code, Codex or Gemini CLI, whichever is installed). `Alt+Enter` opens editor and terminal together. The footer shows which one each key will use.

With the multiplexer on, a terminal launch opens a named session with the windows you listed: tmux inside the distro for a WSL project, psmux (`winget install marlocarlo.psmux`) for a Windows one, tmux on a Mac (`brew install tmux`). Close the terminal, close DevGo, come back: the session is still there and launching again reattaches. Off, a launch is one plain shell.

`Run dev script…` (`Ctrl+Shift+D`) reads the project's `package.json` scripts and runs the one you pick in a terminal that stays open.

## GitHub

The GitHub lane lists every repository you own through the GitHub CLI. It needs `gh` installed and logged in (`gh auth login`); DevGo stores no token of its own, and `gh auth logout` signs out everywhere. The list is fetched when you ask, never on launch or on focus.

- **Catalogue**: the lane header says how many repos and when the list was last updated. A repo that is already cloned into one of your workspaces carries a `local` badge, and the badge follows the disk: clone one, delete one, the lane knows on the next pass.
- **Clone**: `Clone into…` on a row picks a workspace and clones there; the new project appears in its lane as soon as the scan sees it.
- **Groups**: put repos into named groups (`Add to group…`) so the ones you touch weekly sit above the other three hundred. The ungrouped rest stays under one line at the bottom.
- **Branches**: the branch chip on a row opens the repo's branches; pick one and it opens on GitHub.
- **Live search**, off until you turn it on, is the one place a keystroke reaches the network.

## Servers

The Servers lane lists the machines you ssh into. Import `~/.ssh/config` (every `Host` becomes a row; the file is never written) or add one by hand. DevGo launches by alias so your config's key and options apply, and stores no password: an alias, a host, a key path. A `LocalForward` in the config marks the row `tunnel` and gives it *Copy tunnel command* (`ssh -N <alias>`).

Enter opens a terminal on the server in a tmux session that survives, the same promise a WSL project gets. Expand a server (or ↻) and one `ssh` lists its folders: `~`, `~/projects`, `/var/www` and `/srv` by default, plus any folder you pin as top level.

When the box carries `~/scripts/devgo-inventory.sh` from `joyahmed/server`, the same call brings back its **apps**: each `/var/www` folder shows its domain, a dot for its pm2 processes, and its ports. The server declares its own **actions** in `devgo-actions.json` beside that script; right-click the server or an app to run them. An action is typed into a tmux window on the server and the terminal attaches to it. `sudo` asks there; DevGo never holds it, never runs a script itself, and never reads what came back.

Some actions are **forms**: *New nginx site…* asks for the app, the domain, the port, the shape (`NEXT · NEST · NODE · TURBO`), www and HTTPS, and shows the exact line it composes as you type. *Preview* runs it with `--dry-run` so the script prints what it would do and changes nothing; the other button runs it for real.

## Settings

`Ctrl+,` or the gear. One page per concern: Workspaces, Editors & Terminals, tmux / psmux, GitHub, Shortcuts, Scanning, Appearance, Config, Servers, then Help and About.

- **Appearance**: five themes (DevGo Neon, Matrix, Nord, Dracula, Pure Black), a transparency knob from 0 to 60 percent (it needs the OS transparency effects on, and says so when they are off), text size from 85 to 150 percent (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`), and whether the footer shows its key hints.
- **Shortcuts**: every key DevGo binds, listed once, read from the same table the handler uses. The summon hotkey (`Ctrl+Alt+Space` by default) brings the window up from anywhere and can be rebound here.
- **Config**: export your workspaces, targets and settings as one JSON file and import them on another machine. Import is additive; the project cache is not exported because its paths are machine-local.

Everything lives as JSON in the app-data folder (`%APPDATA%\app.zetta.devgo` on Windows, `~/Library/Application Support/app.zetta.devgo` on a Mac). A file that cannot be parsed is backed up as `.bak`, never overwritten. Help › *Reveal in Explorer* opens the folder.

Closing the window hides it; the summon hotkey or the tray icon brings it back, and Quit lives in the tray menu and `Ctrl+Q`. DevGo keeps one instance: launching it again shows the window you already have.
