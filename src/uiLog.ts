import { invoke } from '@tauri-apps/api/core';

// the webview's door into devgo.log - the same file the backend writes,
// so one paste from a user on a platform we cannot reach has both sides
// of the story in time order. the backend tags its lines [DevGo]; every
// line that leaves here is tagged [DevGo/ui] on the other side, cut at
// 512 characters and budgeted at 2000 lines a session. see
// src-tauri/src/services/runtime_log.rs
//
// this file is for the rare and the unexplained, not for tracing. a line
// here should be one a reader of a bug report is glad to find

/// Best effort, like the backend half: a log that can throw is a log that
/// takes down the thing it was watching.
export const logLine = (line: string) => {
	invoke('log_ui_line', { line }).catch(() => {});
};

/// One line per webview load, and that is the point of it. The backend
/// writes `--- start: v… pid … ---` once per *process*; this writes once
/// per *document*. A second `session started` under the same process
/// header means the webview reloaded underneath the user - every piece of
/// react state gone, every drawer closed, focus back at the top of the
/// document - which no react cleanup can report, because a reload runs
/// none. That pair of lines is the only evidence of it there can be.
export const logSessionStart = () => {
	logLine(`session started · ${navigator.userAgent}`);
};

// ── why a surface closed ────────────────────────────────────────────────

// a drawer knows about its own three exits (escape, the backdrop, ✕). it
// cannot know about a caller that closed it by setting state somewhere
// else - and a caller that says nothing would be logged as unexplained,
// which would bury the real unexplained case under the ordinary ones. so
// the caller leaves the reason here, keyed by the drawer's log name, and
// the drawer picks it up as it goes
const pending = new Map<string, string>();

/// Say why a drawer is about to close, immediately before the state
/// change that closes it. Records nothing on its own; the drawer's own
/// close log reads it.
export const closingBecause = (drawer: string, why: string) => {
	pending.set(drawer, why);
};

/// Take the reason a caller left, if any. Taken and not read: a reason
/// left by a close that never happened must not be attached to the next
/// one, which would be a lie in the exact file we are trusting.
export const takeReason = (drawer: string) => {
	const why = pending.get(drawer);
	pending.delete(drawer);
	return why;
};
