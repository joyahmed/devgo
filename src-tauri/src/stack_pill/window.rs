//! The pill's window: a Win32 layered popup on its own thread, no webview.
//! `UpdateLayeredWindow` hands it a premultiplied bitmap, so the rounded
//! ends are the window's real shape (see-through pixels also let the mouse
//! through). It paints only when something changed: a poll that found a
//! different state, the hover, the theme. Raw imports, as `win_taskbar` in
//! lib.rs does: a handful of user32/gdi32 calls do not earn the windows crate.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::{AppHandle, Manager};
use tiny_skia::Pixmap;

use super::layout::{self, Action, Hit, Side};
use super::paint::{self, DotView, View};
use super::palette;
use crate::services::runtime_log::log_line;
use crate::services::stack::{self, StackFile};

type H = *mut c_void;

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Pt {
    x: i32,
    y: i32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Sz {
    cx: i32,
    cy: i32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct WndClassExW {
    size: u32,
    style: u32,
    wndproc: unsafe extern "system" fn(H, u32, usize, isize) -> isize,
    cls_extra: i32,
    wnd_extra: i32,
    instance: H,
    icon: H,
    cursor: H,
    background: H,
    menu_name: *const u16,
    class_name: *const u16,
    icon_sm: H,
}

#[repr(C)]
struct Msg {
    hwnd: H,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    pt: Pt,
    private: u32,
}

#[repr(C)]
struct Blend {
    op: u8,
    flags: u8,
    constant_alpha: u8,
    alpha_format: u8,
}

#[repr(C)]
struct BitmapInfoHeader {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bit_count: u16,
    compression: u32,
    size_image: u32,
    x_ppm: i32,
    y_ppm: i32,
    clr_used: u32,
    clr_important: u32,
}

#[repr(C)]
struct BitmapInfo {
    header: BitmapInfoHeader,
    colors: [u32; 1],
}

#[repr(C)]
struct TrackMouse {
    size: u32,
    flags: u32,
    hwnd: H,
    hover_time: u32,
}

#[repr(C)]
#[derive(Default)]
struct MonitorInfo {
    size: u32,
    monitor: Rect,
    work: Rect,
    flags: u32,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn RegisterClassExW(c: *const WndClassExW) -> u16;
    fn CreateWindowExW(
        ex: u32,
        class: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        parent: H,
        menu: H,
        inst: H,
        param: *mut c_void,
    ) -> H;
    fn DefWindowProcW(h: H, m: u32, w: usize, l: isize) -> isize;
    fn GetMessageW(m: *mut Msg, h: H, min: u32, max: u32) -> i32;
    fn TranslateMessage(m: *const Msg) -> i32;
    fn DispatchMessageW(m: *const Msg) -> isize;
    fn PostMessageW(h: H, m: u32, w: usize, l: isize) -> i32;
    fn SendMessageW(h: H, m: u32, w: usize, l: isize) -> isize;
    fn PostQuitMessage(code: i32);
    fn DestroyWindow(h: H) -> i32;
    fn ShowWindow(h: H, cmd: i32) -> i32;
    fn SetWindowPos(
        h: H,
        after: H,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        f: u32,
    ) -> i32;
    fn SetTimer(h: H, id: usize, ms: u32, f: *const c_void) -> usize;
    fn KillTimer(h: H, id: usize) -> i32;
    fn SetCapture(h: H) -> H;
    fn ReleaseCapture() -> i32;
    fn TrackMouseEvent(t: *mut TrackMouse) -> i32;
    fn GetCursorPos(p: *mut Pt) -> i32;
    fn GetWindowRect(h: H, r: *mut Rect) -> i32;
    fn GetDpiForWindow(h: H) -> u32;
    fn MonitorFromPoint(p: Pt, flags: u32) -> H;
    fn GetMonitorInfoW(m: H, info: *mut MonitorInfo) -> i32;
    fn LoadCursorW(inst: H, name: *const u16) -> H;
    fn SetCursor(c: H) -> H;
    fn GetDC(h: H) -> H;
    fn ReleaseDC(h: H, dc: H) -> i32;
    fn UpdateLayeredWindow(
        h: H,
        dst_dc: H,
        dst: *const Pt,
        size: *const Sz,
        src_dc: H,
        src: *const Pt,
        key: u32,
        blend: *const Blend,
        flags: u32,
    ) -> i32;
}

#[link(name = "gdi32")]
unsafe extern "system" {
    fn CreateCompatibleDC(dc: H) -> H;
    fn DeleteDC(dc: H) -> i32;
    fn CreateDIBSection(
        dc: H,
        info: *const BitmapInfo,
        usage: u32,
        bits: *mut *mut c_void,
        section: H,
        offset: u32,
    ) -> H;
    fn SelectObject(dc: H, obj: H) -> H;
    fn DeleteObject(obj: H) -> i32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetModuleHandleW(name: *const u16) -> H;
}

const WM_DESTROY: u32 = 0x0002;
const WM_SETCURSOR: u32 = 0x0020;
const WM_MOUSEACTIVATE: u32 = 0x0021;
const WM_NCLBUTTONDOWN: u32 = 0x00A1;
const WM_TIMER: u32 = 0x0113;
const WM_MOUSEMOVE: u32 = 0x0200;
const WM_LBUTTONDOWN: u32 = 0x0201;
const WM_LBUTTONUP: u32 = 0x0202;
const WM_MOUSELEAVE: u32 = 0x02A3;
const WM_DPICHANGED: u32 = 0x02E0;
const WM_APP: u32 = 0x8000;
/// poll now (a start/stop finished)
const WM_APP_POLL: u32 = WM_APP + 1;
/// paint again (the theme changed, an icon arrived)
const WM_APP_PAINT: u32 = WM_APP + 2;
/// the pill was asked to open while open: bring it forward
const WM_APP_RAISE: u32 = WM_APP + 3;

const WS_POPUP: u32 = 0x8000_0000;
const WS_EX_TOPMOST: u32 = 0x0000_0008;
const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
const WS_EX_LAYERED: u32 = 0x0008_0000;
const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
const SW_SHOWNOACTIVATE: i32 = 4;
const HTCLIENT: isize = 1;
const HTCAPTION: usize = 2;
const MA_NOACTIVATE: isize = 3;
const TME_LEAVE: u32 = 0x2;
const ULW_ALPHA: u32 = 0x2;
const AC_SRC_ALPHA: u8 = 0x1;
const MONITOR_DEFAULTTONULL: u32 = 0;
const MONITOR_DEFAULTTOPRIMARY: u32 = 1;
const MONITOR_DEFAULTTONEAREST: u32 = 2;
const IDC_ARROW: usize = 32512;
const IDC_HAND: usize = 32649;
const SWP_NOSIZE: u32 = 0x1;
const SWP_NOMOVE: u32 = 0x2;
const SWP_NOACTIVATE: u32 = 0x10;
const SWP_SHOWWINDOW: u32 = 0x40;
const HWND_TOPMOST: isize = -1;
const POLL_TIMER: usize = 1;
/// the same 5 s the webview pill polled at
const POLL_MS: u32 = 5000;

/// the open pill's window, 0 = closed
static HWND: AtomicIsize = AtomicIsize::new(0);
/// a pill thread exists (set before its window does, so two opens in a row
/// build one)
static RUNNING: AtomicBool = AtomicBool::new(false);

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn post(msg: u32) {
    let h = HWND.load(Ordering::SeqCst);
    if h != 0 {
        unsafe {
            PostMessageW(h as H, msg, 0, 0);
        }
    }
}

/// Is the native pill open?
pub fn is_open() -> bool {
    HWND.load(Ordering::SeqCst) != 0
}

/// The theme changed: paint again with the new palette.
pub fn repaint() {
    post(WM_APP_PAINT);
}

/// Open the pill, or bring the open one forward. Any thread.
pub fn open(app: &AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        post(WM_APP_RAISE);
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("stack-pill".into()).spawn(
        move || {
            run(app);
            HWND.store(0, Ordering::SeqCst);
            RUNNING.store(false, Ordering::SeqCst);
        },
    );
    if let Err(e) = spawned {
        RUNNING.store(false, Ordering::SeqCst);
        log_line!("[DevGo] stack pill: no thread: {e}");
    }
}

/// icons by expanded exe path, kept across opens: an exe's icon does not
/// change while DevGo runs
fn icons() -> &'static Mutex<HashMap<String, Option<Arc<Pixmap>>>> {
    static ICONS: OnceLock<Mutex<HashMap<String, Option<Arc<Pixmap>>>>> =
        OnceLock::new();
    ICONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Read the icons not read yet, off the window's thread; paint when done.
fn load_icons(file: &StackFile) {
    let paths: Vec<String> = {
        let have = icons().lock().unwrap_or_else(|e| e.into_inner());
        file.apps
            .iter()
            .map(|a| stack::expand(&a.path))
            .filter(|p| !have.contains_key(p))
            .collect()
    };
    if paths.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        for p in paths {
            let pm = crate::services::stack_facts::icon_rgba(&p)
                .and_then(|(w, h, rgba)| paint::icon_pixmap(w, h, &rgba))
                .map(Arc::new);
            icons()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(p, pm);
        }
        post(WM_APP_PAINT);
    });
}

struct Pill {
    hwnd: H,
    app: AppHandle,
    dir: PathBuf,
    file: StackFile,
    dots: Vec<DotView>,
    /// the bar's top-left on screen, physical px; the window sits above it
    /// while a card shows above
    origin: Pt,
    hover: Hit,
    card: Option<(usize, Side)>,
    /// where the left button went down (screen) and on what
    press: Option<(Pt, Hit)>,
    tracking: bool,
    busy: Arc<Mutex<HashSet<String>>>,
}

thread_local! {
    static PILL: RefCell<Option<Pill>> = const { RefCell::new(None) };
}

/// What a handler leaves for after its borrow ends: these calls send
/// messages straight back into the window procedure.
enum After {
    Nothing,
    Destroy,
    Drag(Pt),
}

impl Pill {
    fn scale(&self) -> f32 {
        let dpi = unsafe { GetDpiForWindow(self.hwnd) };
        if dpi == 0 {
            1.0
        } else {
            dpi as f32 / 96.0
        }
    }

    /// Read the list and the processes; true when a dot changed.
    fn poll(&mut self) -> bool {
        let file = stack::load(&self.dir);
        let snap = stack::snapshot();
        let rows = stack::status(&file, &snap, false);
        let busy = self.busy.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let dots: Vec<DotView> = file
            .apps
            .iter()
            .map(|a| {
                let st = rows.iter().find(|r| r.name == a.name);
                DotView {
                    name: a.name.clone(),
                    state: layout::state_of(st.map(|r| (r.running, r.missing))),
                    is_self: st.is_some_and(|r| r.is_self),
                    busy: busy.contains(&a.name),
                }
            })
            .collect();
        if file.apps.len() != self.file.apps.len()
            || file
                .apps
                .iter()
                .zip(&self.file.apps)
                .any(|(a, b)| a.path != b.path)
        {
            load_icons(&file);
        }
        self.file = file;
        if dots == self.dots {
            return false;
        }
        if dots.len() != self.dots.len() {
            self.hover = Hit::Nothing;
            self.card = None;
        }
        self.dots = dots;
        true
    }

    fn paint(&self) {
        let scale = self.scale();
        let icon = self.card.and_then(|(i, _)| {
            let d = self.file.apps.get(i)?;
            icons()
                .lock()
                .ok()?
                .get(&stack::expand(&d.path))
                .cloned()
                .flatten()
        });
        let view = View {
            dots: &self.dots,
            hover: self.hover,
            card: self.card,
            icon,
            palette: palette::current(&self.dir),
            scale,
        };
        let Some(pm) = paint::paint(&view) else {
            return;
        };
        let (_, dy, _, _) =
            layout::window_box(self.dots.len(), self.card.map(|c| c.1));
        let at = Pt {
            x: self.origin.x,
            y: self.origin.y + (dy * scale).round() as i32,
        };
        unsafe { present(self.hwnd, &pm, at) };
    }

    /// client px to bar logical px
    fn to_bar(&self, x: i32, y: i32) -> (f32, f32) {
        let s = self.scale();
        let top = layout::bar_top(self.card.map(|c| c.1));
        (x as f32 / s, y as f32 / s - top)
    }

    fn hover_at(&mut self, x: i32, y: i32) {
        let (bx, by) = self.to_bar(x, y);
        let hit = layout::hit(self.dots.len(), bx, by);
        if hit == self.hover {
            return;
        }
        self.hover = hit;
        let card = match hit {
            Hit::Dot(i) => {
                // keep the side while the card is up: moving dot to dot
                // must not flip it
                let side = match self.card {
                    Some((_, side)) => side,
                    None => layout::card_side(
                        self.origin.y,
                        work_bottom(self.origin),
                        self.scale(),
                    ),
                };
                Some((i, side))
            }
            _ => None,
        };
        self.card = card;
        self.paint();
    }

    fn leave(&mut self) {
        self.tracking = false;
        if self.press.is_some() {
            return;
        }
        if self.hover != Hit::Nothing || self.card.is_some() {
            self.hover = Hit::Nothing;
            self.card = None;
            self.paint();
        }
    }

    fn click(&mut self, hit: Hit) -> After {
        match hit {
            Hit::Close => {
                log_line!("[DevGo/ui] stack: close pressed (click)");
                After::Destroy
            }
            Hit::Bar => {
                crate::stack::stack_show_tab(self.app.clone());
                After::Nothing
            }
            Hit::Dot(i) => {
                let Some(d) = self.dots.get(i).cloned() else {
                    return After::Nothing;
                };
                match layout::dot_action(d.state, d.is_self, d.busy) {
                    Action::None => {}
                    Action::OpenTab => {
                        crate::stack::stack_show_tab(self.app.clone())
                    }
                    act @ (Action::Start | Action::Stop) => {
                        self.act(&d.name, act == Action::Start)
                    }
                }
                After::Nothing
            }
            Hit::Nothing => After::Nothing,
        }
    }

    /// start or stop on a worker (stop waits out a grace period); the dot
    /// fades until it is done
    fn act(&mut self, name: &str, start: bool) {
        let Some(entry) =
            self.file.apps.iter().find(|a| a.name == name).cloned()
        else {
            return;
        };
        self.busy
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(entry.name.clone());
        if self.poll() {
            self.paint();
        }
        let busy = self.busy.clone();
        std::thread::spawn(move || {
            let result = if start {
                stack::start(&entry).map(|s| {
                    if s {
                        "started"
                    } else {
                        "already running"
                    }
                })
            } else {
                stack::stop(&entry).map(|k| {
                    if k {
                        "stopped (killed after the grace period)"
                    } else {
                        "stopped"
                    }
                })
            };
            match result {
                Ok(what) => {
                    log_line!("[DevGo] stack: {} {what} (pill)", entry.name)
                }
                Err(e) => {
                    log_line!("[DevGo] stack: {}: {e} (pill)", entry.name)
                }
            }
            busy.lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&entry.name);
            post(WM_APP_POLL);
        });
    }
}

/// the bottom of the work area (above the taskbar) of the screen `p` is on
fn work_bottom(p: Pt) -> i32 {
    unsafe {
        let m = MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST);
        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            ..Default::default()
        };
        if m.is_null() || GetMonitorInfoW(m, &mut info) == 0 {
            return i32::MAX;
        }
        info.work.bottom
    }
}

/// A saved spot counts only if its top-left is on a screen now, 40 px in
/// from the right and bottom edges (the webview pill's rule): an unplugged
/// monitor must not leave the pill out of reach.
fn on_a_screen(p: Pt) -> bool {
    unsafe {
        let m = MonitorFromPoint(p, MONITOR_DEFAULTTONULL);
        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            ..Default::default()
        };
        if m.is_null() || GetMonitorInfoW(m, &mut info) == 0 {
            return false;
        }
        p.x < info.monitor.right - 40 && p.y < info.monitor.bottom - 40
    }
}

/// the middle of the primary screen's work area, for a bar `w` x `h`
fn centered(w: i32, h: i32) -> Pt {
    unsafe {
        let m = MonitorFromPoint(Pt::default(), MONITOR_DEFAULTTOPRIMARY);
        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            ..Default::default()
        };
        if m.is_null() || GetMonitorInfoW(m, &mut info) == 0 {
            return Pt { x: 100, y: 100 };
        }
        let r = info.work;
        Pt {
            x: r.left + (r.right - r.left - w) / 2,
            y: r.top + (r.bottom - r.top - h) / 2,
        }
    }
}

/// Hand the bitmap to the window at `at`: size, position and pixels in one
/// call, so a card opening above never shows a half-moved frame.
unsafe fn present(hwnd: H, pm: &Pixmap, at: Pt) {
    let (w, h) = (pm.width() as i32, pm.height() as i32);
    let screen = GetDC(std::ptr::null_mut());
    let mem = CreateCompatibleDC(screen);
    let info = BitmapInfo {
        header: BitmapInfoHeader {
            size: std::mem::size_of::<BitmapInfoHeader>() as u32,
            width: w,
            // negative: rows top-down, as the pixmap holds them
            height: -h,
            planes: 1,
            bit_count: 32,
            compression: 0,
            size_image: 0,
            x_ppm: 0,
            y_ppm: 0,
            clr_used: 0,
            clr_important: 0,
        },
        colors: [0],
    };
    let mut bits: *mut c_void = std::ptr::null_mut();
    let dib =
        CreateDIBSection(mem, &info, 0, &mut bits, std::ptr::null_mut(), 0);
    if !dib.is_null() && !bits.is_null() {
        let out = std::slice::from_raw_parts_mut(
            bits as *mut u8,
            (w * h * 4) as usize,
        );
        paint::to_bgra(pm, out);
        let old = SelectObject(mem, dib);
        let size = Sz { cx: w, cy: h };
        let src = Pt::default();
        let blend = Blend {
            op: 0,
            flags: 0,
            constant_alpha: 255,
            alpha_format: AC_SRC_ALPHA,
        };
        UpdateLayeredWindow(
            hwnd, screen, &at, &size, mem, &src, 0, &blend, ULW_ALPHA,
        );
        SelectObject(mem, old);
        DeleteObject(dib);
    }
    DeleteDC(mem);
    ReleaseDC(std::ptr::null_mut(), screen);
}

fn client_xy(l: isize) -> (i32, i32) {
    (
        (l & 0xffff) as i16 as i32,
        ((l >> 16) & 0xffff) as i16 as i32,
    )
}

fn cursor() -> Pt {
    let mut p = Pt::default();
    unsafe { GetCursorPos(&mut p) };
    p
}

/// Run `f` on the pill if it is not already borrowed (a message sent back
/// into the procedure from inside a handler gets the default treatment).
fn with<R>(f: impl FnOnce(&mut Pill) -> R) -> Option<R> {
    PILL.with(|cell| {
        let mut b = cell.try_borrow_mut().ok()?;
        b.as_mut().map(f)
    })
}

unsafe extern "system" fn wndproc(
    hwnd: H,
    msg: u32,
    wp: usize,
    lp: isize,
) -> isize {
    let after = match msg {
        WM_MOUSEACTIVATE => return MA_NOACTIVATE,
        WM_SETCURSOR if (lp & 0xffff) == HTCLIENT => {
            let hand = with(|p| match p.hover {
                Hit::Close => true,
                Hit::Dot(i) => p.dots.get(i).is_some_and(|d| !d.is_self),
                _ => false,
            });
            let id = if hand == Some(true) {
                IDC_HAND
            } else {
                IDC_ARROW
            };
            SetCursor(LoadCursorW(std::ptr::null_mut(), id as *const u16));
            return 1;
        }
        WM_MOUSEMOVE => with(|p| {
            if !p.tracking {
                let mut t = TrackMouse {
                    size: std::mem::size_of::<TrackMouse>() as u32,
                    flags: TME_LEAVE,
                    hwnd,
                    hover_time: 0,
                };
                TrackMouseEvent(&mut t);
                p.tracking = true;
            }
            if let Some((at, _)) = p.press {
                let now = cursor();
                let moved =
                    ((now.x - at.x) as f32).hypot((now.y - at.y) as f32);
                if moved > layout::DRAG_PX * p.scale() {
                    p.press = None;
                    p.hover = Hit::Nothing;
                    p.card = None;
                    p.paint();
                    return After::Drag(now);
                }
                return After::Nothing;
            }
            let (x, y) = client_xy(lp);
            p.hover_at(x, y);
            After::Nothing
        }),
        WM_MOUSELEAVE => with(|p| {
            p.leave();
            After::Nothing
        }),
        WM_LBUTTONDOWN => with(|p| {
            let (x, y) = client_xy(lp);
            let (bx, by) = p.to_bar(x, y);
            let hit = layout::hit(p.dots.len(), bx, by);
            if hit != Hit::Nothing {
                p.press = Some((cursor(), hit));
                SetCapture(hwnd);
            }
            After::Nothing
        }),
        WM_LBUTTONUP => with(|p| {
            let Some((_, down)) = p.press.take() else {
                return After::Nothing;
            };
            ReleaseCapture();
            let (x, y) = client_xy(lp);
            let (bx, by) = p.to_bar(x, y);
            // a click is a press and a release on the same thing
            if layout::hit(p.dots.len(), bx, by) != down {
                return After::Nothing;
            }
            p.click(down)
        }),
        WM_TIMER if wp == POLL_TIMER => with(|p| {
            if p.poll() {
                p.paint();
            }
            After::Nothing
        }),
        WM_APP_POLL => with(|p| {
            if p.poll() {
                p.paint();
            }
            After::Nothing
        }),
        WM_APP_PAINT | WM_DPICHANGED => with(|p| {
            p.paint();
            After::Nothing
        }),
        WM_APP_RAISE => {
            SetWindowPos(
                hwnd,
                HWND_TOPMOST as H,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            return 0;
        }
        WM_DESTROY => {
            KillTimer(hwnd, POLL_TIMER);
            log_line!("[DevGo] stack window closed");
            PostQuitMessage(0);
            return 0;
        }
        _ => None,
    };
    match after {
        Some(After::Destroy) => {
            DestroyWindow(hwnd);
            0
        }
        Some(After::Drag(at)) => {
            ReleaseCapture();
            // the system's own move loop, as a title bar drag; it returns
            // when the button comes up
            let packed =
                ((at.y as u16 as isize) << 16) | (at.x as u16 as isize);
            SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, packed);
            with(|p| {
                let mut r = Rect::default();
                if GetWindowRect(hwnd, &mut r) != 0 {
                    p.origin = Pt {
                        x: r.left,
                        y: r.top,
                    };
                    crate::stack::save_position(&p.dir, r.left, r.top);
                }
                // a move to a screen with another scale
                p.paint();
            });
            0
        }
        Some(After::Nothing) => 0,
        None => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

fn register_class() -> Vec<u16> {
    let name = wide("DevGoStackPill");
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        let class = WndClassExW {
            size: std::mem::size_of::<WndClassExW>() as u32,
            style: 0,
            wndproc,
            cls_extra: 0,
            wnd_extra: 0,
            instance: GetModuleHandleW(std::ptr::null()),
            icon: std::ptr::null_mut(),
            cursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW as *const u16),
            background: std::ptr::null_mut(),
            menu_name: std::ptr::null(),
            class_name: name.as_ptr(),
            icon_sm: std::ptr::null_mut(),
        };
        RegisterClassExW(&class);
    });
    name
}

fn run(app: AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        log_line!("[DevGo] stack pill: no data folder");
        return;
    };
    let class = register_class();
    let title = wide("My stack");
    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
            class.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            0,
            0,
            1,
            1,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            GetModuleHandleW(std::ptr::null()),
            std::ptr::null_mut(),
        )
    };
    if hwnd.is_null() {
        log_line!("[DevGo] stack pill: CreateWindowEx failed");
        return;
    }
    let mut pill = Pill {
        hwnd,
        app,
        dir: dir.clone(),
        file: StackFile::default(),
        dots: Vec::new(),
        origin: Pt::default(),
        hover: Hit::Nothing,
        card: None,
        press: None,
        tracking: false,
        busy: Arc::new(Mutex::new(HashSet::new())),
    };
    pill.poll();
    load_icons(&pill.file);
    pill.origin = match crate::stack::saved_position_in(&dir) {
        Some((x, y)) if on_a_screen(Pt { x, y }) => Pt { x, y },
        _ => {
            let s = pill.scale();
            let w = (layout::bar_width(pill.dots.len()) * s).ceil() as i32;
            centered(w, (layout::BAR_H * s).ceil() as i32)
        }
    };
    PILL.with(|c| *c.borrow_mut() = Some(pill));
    with(|p| p.paint());
    HWND.store(hwnd as isize, Ordering::SeqCst);
    unsafe {
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetTimer(hwnd, POLL_TIMER, POLL_MS, std::ptr::null());
    }
    log_line!("[DevGo] stack window opened (native)");
    let mut msg: Msg = unsafe { std::mem::zeroed() };
    while unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) } > 0 {
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    PILL.with(|c| c.borrow_mut().take());
}
