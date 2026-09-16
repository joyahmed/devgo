// which desktop the webview is standing on, known before the first paint.
// the user agent, not a tauri round-trip, on purpose: invoke is async, and
// a title bar that renders windows buttons for one frame and then swaps
// them for traffic lights is a flash of the wrong chrome on every launch.
// the string is reliable because the webview is ours: wkwebview always
// says Macintosh, webview2 always says Windows NT
export const isMac: boolean = /Macintosh|Mac OS X/.test(navigator.userAgent);
