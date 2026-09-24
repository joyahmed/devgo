// which desktop the webview is standing on, known before the first paint.
// the user agent, not a tauri round-trip, on purpose: invoke is async, and
// a title bar that renders windows buttons for one frame and then swaps
// them for traffic lights is a flash of the wrong chrome on every launch.
// the string is reliable because the webview is ours: wkwebview always
// says Macintosh, webview2 always says Windows NT, webkitgtk always says
// X11; Linux x86_64. three flags, not one: `not a mac` meant windows
// until the linux build shipped, and a ua nobody recognises is none of
// them rather than windows by default
const ua = navigator.userAgent;

export const isMac: boolean = /Macintosh|Mac OS X/.test(ua);
export const isWindows: boolean = /Windows NT/.test(ua);
export const isLinux: boolean = !isMac && !isWindows && /X11|Linux/.test(ua);
