# Screenshots

Real screen captures of the app over the desktop wallpaper, every other window minimised, the
window born see-through at the transparency knob. Neon theme. Server rows are name-only (the
*Show connection details* switch off).

## Windows

2560×1392, the window maximised, knob 20 %.

| file | what it shows |
|---|---|
| `windows/01-four-lanes.png` | WSL · Windows · GitHub (groups + the ungrouped tail) · Servers with a server expanded: its top-level folders, the app rows with domain and ports |
| `windows/02-app-actions.png` | Right-click on the `erp` app: the actions the server declares, in sections |
| `windows/03-nginx-form.png` | *New site…* — a form action, the exact line it will type |
| `windows/04-palette.png` | The command palette filtered to `server` |
| `windows/05-server-actions.png` | Right-click on a server row: the terminals, the folder asks, then the box's own actions in sections (Box · pm2 · Backups · nginx · DNS · Database), the copy lines, Edit… |
| `windows/10-settings-workspaces.png` | Settings › Workspaces |
| `windows/11-settings-editors-terminals.png` | Settings › Editors & Terminals |
| `windows/12-settings-tmux-psmux.png` | Settings › tmux / psmux |
| `windows/13-settings-github.png` | Settings › GitHub |
| `windows/14-settings-shortcuts.png` | Settings › Shortcuts |
| `windows/15-settings-scanning.png` | Settings › Scanning |
| `windows/16-settings-appearance.png` | Settings › Appearance |
| `windows/17-settings-config.png` | Settings › Config |
| `windows/18-settings-servers.png` | Settings › Servers |
| `windows/19-settings-help.png` | Settings › Help |
| `windows/20-settings-about.png` | Settings › About |

### How to retake

The frames are the dev build over CDP, so the app can be driven without touching the mouse. Close the installed DevGo first (the two share one WebView2 user-data folder and the debug port opens on the first instance only), then:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
bun tauri dev
bun scripts/cdp.mjs metrics                       # the viewport, to check the scale
bun scripts/cdp.mjs eval "document.title"         # anything the frame needs: select a row, open a menu
scripts/shoot.ps1 -Out docs/screenshots/windows/01-four-lanes.png
```

`scripts/shoot.ps1` minimises every other window, hides the desktop icons, brings DevGo up maximised, copies the client area from the screen at native scale and puts the desktop back. `-Knob 20` writes the transparency into `prefs.json` for the next launch and restores the file after; `-Wait 2` is the pause before the capture. `scripts/cdp.mjs` has `eval`, `file`, `click`, `rclick`, `dbl`, `key`, `type`, `shot` and `metrics`; a real click (`click x,y`) is what the clipboard and a native dialog need, `eval` is enough for the rest.

## Mac

1686×990, knob 18 %, `screencapture`.

| file | what it shows |
|---|---|
| `mac/01-three-lanes.png` | Mac · GitHub · Servers with a server expanded |
| `mac/01b-three-lanes-collapsed.png` | The same, the server collapsed |

## Linux

1920×972, knob 0 %, `import` (ImageMagick), over an X11 session — no wallpaper behind it, so this
one is opaque rather than see-through like the other two.

| file | what it shows |
|---|---|
| `linux/01-three-lanes.png` | Linux · GitHub · Servers with a server expanded: its top-level folders and the `/var/www` app rows with domain and ports |

The first Linux run, 2026-09-23, on Ubuntu 24.04. There is no WSL lane here, so Linux is three
lanes like the Mac. ⚠️ The frame shows the app working, not Linux finished: the **terminal lane
is empty on Linux** — the candidate list carries no `gnome-terminal`, `konsole`, `xfce4-terminal`,
`tilix`, `foot` or `xterm`, and its macOS Terminal entry passes its PATH check here because
`/usr/bin/open` is `xdg-open` on Ubuntu. Editor, agent, GitHub and Servers are what is real in
this picture.

### How to retake

No CDP here — this is the installed release build, captured straight off X:

```bash
xwininfo -root -tree | grep '"DevGo"'      # the window id of the 1920x972 one
import -window <id> docs/screenshots/linux/01-three-lanes.png
```
