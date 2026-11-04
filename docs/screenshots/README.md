# Screenshots

The screen captures that used to live here were removed from `main`: the frames showed
home-directory paths, private repository names and server hostnames. They are still in git
history. A retake must use a clean profile first: a throwaway `servers.json` and workspace
folders with neutral names, and *Show connection details* off.

## How to retake

The frames are the dev build over CDP, so the app can be driven without touching the mouse. Close the installed DevGo first (the two share one WebView2 user-data folder and the debug port opens on the first instance only), then:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
bun tauri dev
bun scripts/cdp.mjs metrics                       # the viewport, to check the scale
bun scripts/cdp.mjs eval "document.title"         # anything the frame needs: select a row, open a menu
scripts/shoot.ps1 -Out docs/screenshots/windows/01-four-lanes.png
```

`scripts/shoot.ps1` minimises every other window, hides the desktop icons, brings DevGo up maximised, copies the client area from the screen at native scale and puts the desktop back. `-Knob 20` writes the transparency into `prefs.json` for the next launch and restores the file after; `-Wait 2` is the pause before the capture. `scripts/cdp.mjs` has `eval`, `file`, `click`, `rclick`, `dbl`, `key`, `type`, `shot` and `metrics`; a real click (`click x,y`) is what the clipboard and a native dialog need, `eval` is enough for the rest.
