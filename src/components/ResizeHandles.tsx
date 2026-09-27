import { getCurrentWindow } from '@tauri-apps/api/window';
import { isLinux } from '../platform';
import { logLine } from '../uiLog';

// ⭐ the eight strips that make an undecorated window resizable on LINUX,
// where nothing else does.
//
// the defect, measured on ubuntu with xdotool drags and xwininfo geometry
// readback: dragging any edge or corner of the DevGo window did nothing at
// all — 900x720 before, 900x720 after — while a title-bar drag moved the
// window normally. the same on a build from three weeks earlier, so it is
// not a regression; the window has never been resizable there.
//
// what the source says, and what it does NOT say:
//
//   1. `decorations: false` in tauri.conf.json, so on GNOME/mutter there is
//      no WM frame and therefore no WM resize border to grab. everything
//      after this is about the replacements the toolkit ships for that case.
//   2. every one of those replacements is gated on `!is_maximized()` —
//      tao's on the gtk::Window (platform_impl/linux/event_loop.rs, button
//      press and motion notify) and tauri-runtime-wry's on the webview
//      (undecorated_resizing.rs, BORDERLESS_RESIZE_INSET = 5) — and
//      tauri.conf.json ships `maximized: true`. so on a fresh install with
//      no saved window_state there is NO native edge at all, before any
//      other question is asked. that alone is most users' whole experience.
//   3. tao's pair is also unreachable for a second reason: they are
//      connected to the gtk::Window, and the WebKitWebView fills it and
//      handles button-press and motion-notify itself, so the window never
//      sees them. that is also why no resize cursor ever appears — the
//      handler that would set one is on the same consumed widget.
// ⛔ 4. but that does NOT finish the story, and an earlier writeup of this
//      bug said it did. tauri-runtime-wry attaches its OWN hit-test handler
//      directly to the WebKitWebView (lib.rs calls
//      undecorated_resizing::attach_resize_handler(&webview) on linux), and
//      a widget cannot consume an event out from under a handler connected
//      to itself. at the 900x720 unmaximized size the drags were measured
//      at, all three of its gates pass, so it should have fired and did
//      not. the residual cause is NOT known — candidates are the downcast
//      to gtk::Window walking the wrong parents, WebKitGTK delivering
//      presses to an inner widget rather than the WebView the handler sits
//      on, or mutter ignoring the resulting _NET_WM_MOVERESIZE. none of
//      them is settled here.
// ⚠️ none of 3 or 4 is an event trace, and nothing on this machine can
// produce one: there is no linux GUI, and jsdom cannot start a window drag.
// what makes the fix safe to ship anyway is that it does not depend on
// which of them is true — it starts the resize from inside the document,
// where a mousedown is ours by construction.
//
// so the grab has to happen INSIDE the webview, which is what this is: a
// thin invisible strip per edge and a small square per corner, each one
// calling startResizeDragging on mousedown. that routes
// start_resize_dragging → WindowMessage::ResizeDragWindow →
// tao::drag_resize_window → WindowRequest::DragResizeWindow →
// gdk_window.begin_resize_drag with NO decorated / resizable / maximized
// gate anywhere along it — verified by reading all four hops — so it is
// also the only path that is alive in the maximized state the app starts
// in. ⚠️ what mutter then does with _NET_WM_MOVERESIZE on a maximized
// window is the WM's business and is NOT verified here.
//
// ⭐ the cursor is half the fix, not polish. the motion-notify handler that
// would show ew-resize over the native band is on the same gtk::Window and
// is consumed the same way, so the native path structurally cannot tell
// you where to grab. these do.
//
// ⛔ LINUX ONLY, and not for tidiness. windows resizes an undecorated
// window through its own non-client hit testing, macOS keeps native
// decorations (tauri.macos.conf.json), and both of them already work. an
// invisible click target laid over a working edge is a click those
// platforms could lose, for nothing gained.

// @tauri-apps/api does not EXPORT its ResizeDirection type — window.d.ts
// declares it unexported beside startResizeDragging — so the eight strings
// are copied from that declaration verbatim rather than remembered. they
// are validated in rust, so a typo is a rejected promise at runtime and
// not a compile error, which is the worst way for this to fail; a union
// here is what turns it back into one.
type ResizeDirection =
	| 'East'
	| 'North'
	| 'NorthEast'
	| 'NorthWest'
	| 'South'
	| 'SouthEast'
	| 'SouthWest'
	| 'West';

type Handle = {
	direction: ResizeDirection;
	/// where the strip sits and what the pointer turns into over it. the
	/// cursor is the ONLY thing any of this is allowed to change about how
	/// the app looks: no background, no border, no outline, so there is no
	/// 4px band for a palette to make visible by accident
	where: string;
};

// 4px, one under tao's 5: the footer is `min-h-12 py-1.5` around `h-9`
// pills — 36px of content in 48px — so it has exactly 6px of padding under
// the last row of buttons, and a 4px strip along the bottom edge lands
// inside that padding with 2px to spare. the lanes and the command row
// carry `px-3`, so the left and right strips sit in 12px of padding, and
// the title bar's buttons are `h-7` centred in `h-12`, 10px clear of the
// top. nothing clickable is covered on any of the four.
// ⚠️ ONE thing is, and it is the only known cost of this file: below
// 1400px the project list is one scroller spanning the full window width
// (ProjectTree's `overflow-y-auto min-[1400px]:overflow-hidden`), so its
// 8px native scrollbar runs flush against the right edge and `East` covers
// the outer 4px of it. 4px of the thumb's hit box survives, and the wheel
// is untouched. if that trade is ever judged the wrong way round, delete
// the East entry below and the right edge goes back to being scrollbar
// only — the other seven handles are independent of it.
const EDGES: Handle[] = [
	{ direction: 'North', where: 'top-0 inset-x-0 h-1 cursor-ns-resize' },
	{ direction: 'South', where: 'bottom-0 inset-x-0 h-1 cursor-ns-resize' },
	{ direction: 'West', where: 'left-0 inset-y-0 w-1 cursor-ew-resize' },
	{ direction: 'East', where: 'right-0 inset-y-0 w-1 cursor-ew-resize' }
];

// 12px squares, and they must WIN against the edges they overlap or a
// diagonal drag is unreachable — every corner pixel is also an edge pixel.
// two things say so: these are rendered after the edges, and they carry a
// higher z-index. either alone would do it; both, because the order of two
// lists in a fragment is the kind of thing a later edit reorders without
// knowing it was load-bearing
const CORNERS: Handle[] = [
	{ direction: 'NorthWest', where: 'top-0 left-0 size-3 cursor-nwse-resize' },
	{ direction: 'NorthEast', where: 'top-0 right-0 size-3 cursor-nesw-resize' },
	{
		direction: 'SouthWest',
		where: 'bottom-0 left-0 size-3 cursor-nesw-resize'
	},
	{
		direction: 'SouthEast',
		where: 'bottom-0 right-0 size-3 cursor-nwse-resize'
	}
];

// z-20 and z-30 on purpose, both UNDER the z-40 the drawers start at: a
// drawer, dialog, context menu or popover that reaches the window edge
// must keep the click, and while one is open the edge is not a resize
// handle. above that floor they are the only positioned things in the
// tree, so they sit over the title bar, the lanes and the footer.
const LAYER = { edge: 'z-20', corner: 'z-30' };

const grab = (direction: ResizeDirection) => (event: React.MouseEvent) => {
	// the left button only, like tao's own handler: a right-click at the
	// edge is a context menu somewhere above, and a middle click is a paste
	if (event.button !== 0) return;
	event.preventDefault();
	// a rejection here means one thing in practice — the capability is
	// missing from capabilities/default.json — and it is invisible from the
	// outside, because a resize that never starts looks exactly like the bug
	// this fixes. so it goes in devgo.log, which is the file a report from a
	// platform we cannot reach arrives with
	getCurrentWindow()
		.startResizeDragging(direction)
		.catch(e => logLine(`resize ${direction} refused: ${e}`));
};

const strip = ({ direction, where }: Handle, layer: string) => (
	<div
		key={direction}
		// invisible to the accessibility tree as well as to the eye: it is a
		// window-manager gesture, not a control, and eight unlabelled boxes
		// in the tab order would be eight stops on the way to the search box
		aria-hidden='true'
		data-resize={direction}
		className={`fixed ${layer} ${where}`}
		onMouseDown={grab(direction)}
	/>
);

const ResizeHandles = () => {
	// ⚠️ isLinux comes from navigator.userAgent read at MODULE LOAD in
	// platform.ts, and under jsdom that UA is
	// `Mozilla/5.0 (win32) AppleWebKit/… jsdom/30.1.1` — measured, not
	// guessed — so isLinux, isWindows AND isMac are ALL false in the test
	// suite, on every host. (on a linux runner the UA says `(linux)`, and
	// platform.ts matches /X11|Linux/ case-sensitively, so it is still
	// false.) ResizeHandles.test.tsx therefore mocks ../platform to reach
	// either branch; it cannot rely on the environment for either one
	if (!isLinux) return null;
	return (
		<>
			{EDGES.map(h => strip(h, LAYER.edge))}
			{CORNERS.map(h => strip(h, LAYER.corner))}
		</>
	);
};

export default ResizeHandles;
