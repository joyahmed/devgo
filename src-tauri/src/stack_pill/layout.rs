//! Where everything on the pill sits, and what a click there does. Pure
//! numbers in logical px (the window scales them by its DPI), so the tests
//! pin them without a window. The sizes are the webview pill's (S8):
//! a 40 px bar, `pl-1 pr-1`, a 20 px grip, 28 px dot buttons with a 2 px
//! gap, a divider, a 28 px ✕; four apps = 187 px, as that pill measured.

use super::palette::{Palette, Rgb, EMERALD_DOT};

pub const BAR_H: f32 = 40.0;
const BORDER: f32 = 1.0;
const PAD: f32 = 4.0;
const GRIP_W: f32 = 20.0;
const GAP: f32 = 2.0;
pub const DOT_BTN: f32 = 28.0;
pub const DOT_R: f32 = 5.0;
/// the divider before ✕: 2 px margin, a 1 px line, 2 px margin
const DIVIDER: f32 = 5.0;
pub const CLOSE_BTN: f32 = 28.0;
/// "No apps yet" in place of the dots
pub const EMPTY_W: f32 = 72.0;

/// the hover card: 40 px tall, 4 px from the bar, at least this wide
pub const CARD_H: f32 = 40.0;
pub const CARD_GAP: f32 = 4.0;
pub const CARD_MIN_W: f32 = 160.0;
/// the window's growth while a card shows
pub const CARD_EXTRA: f32 = CARD_H + CARD_GAP;

/// a press that moves further than this (logical px) is a drag
pub const DRAG_PX: f32 = 3.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub fn contains(&self, x: f32, y: f32) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
    pub fn cx(&self) -> f32 {
        self.x + self.w / 2.0
    }
    pub fn cy(&self) -> f32 {
        self.y + self.h / 2.0
    }
}

fn first_dot_x() -> f32 {
    BORDER + PAD + GRIP_W + GAP
}

/// The bar's width for `n` dots: what the webview pill's `w-max` gave.
pub fn bar_width(n: usize) -> f32 {
    let dots = if n == 0 {
        EMPTY_W + GAP
    } else {
        n as f32 * (DOT_BTN + GAP)
    };
    first_dot_x() + dots + DIVIDER + GAP + CLOSE_BTN + PAD + BORDER
}

/// Button rects, in bar coordinates (the bar's top-left is 0,0).
pub fn grip_rect() -> Rect {
    Rect {
        x: BORDER + PAD,
        y: (BAR_H - DOT_BTN) / 2.0,
        w: GRIP_W,
        h: DOT_BTN,
    }
}

pub fn dot_rect(i: usize) -> Rect {
    Rect {
        x: first_dot_x() + i as f32 * (DOT_BTN + GAP),
        y: (BAR_H - DOT_BTN) / 2.0,
        w: DOT_BTN,
        h: DOT_BTN,
    }
}

/// the 1 px divider's x
pub fn divider_x(n: usize) -> f32 {
    bar_width(n) - BORDER - PAD - CLOSE_BTN - GAP - DIVIDER / 2.0
}

pub fn close_rect(n: usize) -> Rect {
    Rect {
        x: bar_width(n) - BORDER - PAD - CLOSE_BTN,
        y: (BAR_H - CLOSE_BTN) / 2.0,
        w: CLOSE_BTN,
        h: CLOSE_BTN,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hit {
    /// a dot's button, by index
    Dot(usize),
    Close,
    /// the grip or the bar between buttons: opens the tab
    Bar,
    /// off the bar (the card, the gap, the window's transparent corners)
    Nothing,
}

/// What the point (bar coordinates, logical px) is on. The bar's rounded
/// ends count as bar; the corners outside them do not.
pub fn hit(n: usize, x: f32, y: f32) -> Hit {
    let w = bar_width(n);
    if !(Rect {
        x: 0.0,
        y: 0.0,
        w,
        h: BAR_H,
    })
    .contains(x, y)
    {
        return Hit::Nothing;
    }
    let r = BAR_H / 2.0;
    let cx = x.clamp(r, w - r);
    if (x - cx).hypot(y - r) > r {
        return Hit::Nothing;
    }
    if close_rect(n).contains(x, y) {
        return Hit::Close;
    }
    (0..n)
        .find(|&i| dot_rect(i).contains(x, y))
        .map_or(Hit::Bar, Hit::Dot)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Below,
    Above,
}

/// The card goes below the bar unless that would cross the bottom of the
/// work area; then above, and the window moves up by `CARD_EXTRA`.
/// Physical px: `bar_top` and `work_bottom` are screen coordinates.
pub fn card_side(bar_top: i32, work_bottom: i32, scale: f32) -> Side {
    let full = ((BAR_H + CARD_EXTRA) * scale).round() as i32;
    if bar_top + full > work_bottom {
        Side::Above
    } else {
        Side::Below
    }
}

/// The window around the bar, in logical px relative to the bar's top-left:
/// (dx, dy, width, height). With a card it is at least `CARD_MIN_W` wide and
/// `CARD_EXTRA` taller, the extra above the bar when the card is above.
pub fn window_box(n: usize, card: Option<Side>) -> (f32, f32, f32, f32) {
    let bar = bar_width(n);
    match card {
        None => (0.0, 0.0, bar, BAR_H),
        Some(side) => {
            let dy = if side == Side::Above {
                -CARD_EXTRA
            } else {
                0.0
            };
            (0.0, dy, bar.max(CARD_MIN_W), BAR_H + CARD_EXTRA)
        }
    }
}

/// The card's rect inside that window (window coordinates).
pub fn card_rect(n: usize, side: Side) -> Rect {
    let (_, _, w, _) = window_box(n, Some(side));
    Rect {
        x: 0.0,
        y: if side == Side::Above {
            0.0
        } else {
            BAR_H + CARD_GAP
        },
        w,
        h: CARD_H,
    }
}

/// The bar's top inside that window.
pub fn bar_top(card: Option<Side>) -> f32 {
    if card == Some(Side::Above) {
        CARD_EXTRA
    } else {
        0.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Checking,
    Running,
    Stopped,
    Missing,
}

/// `stateOf` in stackFormat.ts
pub fn state_of(status: Option<(bool, bool)>) -> State {
    match status {
        None => State::Checking,
        Some((true, _)) => State::Running,
        Some((false, true)) => State::Missing,
        Some((false, false)) => State::Stopped,
    }
}

pub fn state_word(s: State) -> &'static str {
    match s {
        State::Checking => "Checking…",
        State::Running => "Running",
        State::Stopped => "Stopped",
        State::Missing => "Not installed",
    }
}

/// what a click on the dot does, in the card's three words
pub fn hint(s: State, is_self: bool) -> &'static str {
    if is_self {
        return "this app";
    }
    match s {
        State::Checking => "",
        State::Running => "click to stop",
        State::Stopped => "click to start",
        State::Missing => "click to fix",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    None,
    Start,
    Stop,
    OpenTab,
}

/// A dot click (`clickDot` in useStackPill): DevGo's own dot and a busy one
/// do nothing; not installed has nothing to start, so it opens the tab.
pub fn dot_action(s: State, is_self: bool, busy: bool) -> Action {
    if is_self || busy {
        return Action::None;
    }
    match s {
        State::Running => Action::Stop,
        State::Stopped => Action::Start,
        State::Missing => Action::OpenTab,
        State::Checking => Action::None,
    }
}

/// How a dot is drawn (`DOT_CLASS` in stackFormat.ts).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DotLook {
    /// a filled dot; `glow` = the running dot's soft halo
    Fill { color: Rgb, glow: bool },
    /// a ring of this width
    Ring { color: Rgb, width: f32 },
}

pub fn dot_look(s: State, p: &Palette) -> DotLook {
    match s {
        State::Checking => DotLook::Ring {
            color: p.border_strong,
            width: 1.0,
        },
        State::Running => DotLook::Fill {
            color: EMERALD_DOT,
            glow: true,
        },
        State::Stopped => DotLook::Fill {
            color: p.danger,
            glow: false,
        },
        State::Missing => DotLook::Ring {
            color: p.text_muted,
            width: 2.0,
        },
    }
}

/// the state word's colour on the card (`STATE_TONE` in StackPillCard)
pub fn state_tone(s: State, p: &Palette) -> Rgb {
    match s {
        State::Checking => p.text_muted,
        State::Running => super::palette::EMERALD_TEXT,
        State::Stopped => p.danger,
        State::Missing => p.text_secondary,
    }
}

#[cfg(test)]
mod tests {
    use super::super::palette::NEON;
    use super::*;

    #[test]
    fn width_fits_the_dots_like_the_webview_pill() {
        // the webview pill measured 187 px for four apps
        assert_eq!(bar_width(4), 187.0);
        assert_eq!(bar_width(5) - bar_width(4), DOT_BTN + GAP);
        // no apps: room for "No apps yet"
        assert!(bar_width(0) > bar_width(1));
        // the ✕ ends PAD + BORDER before the bar's end
        let c = close_rect(4);
        assert_eq!(c.x + c.w, 187.0 - PAD - BORDER);
        // the divider sits between the last dot and ✕
        let last = dot_rect(3);
        assert!(divider_x(4) > last.x + last.w && divider_x(4) < c.x);
    }

    #[test]
    fn hit_test_finds_dots_close_and_bar() {
        let n = 3;
        let d1 = dot_rect(1);
        assert_eq!(hit(n, d1.cx(), d1.cy()), Hit::Dot(1));
        assert_eq!(hit(n, d1.x, d1.cy()), Hit::Dot(1));
        // the 2 px gap between two dots is bar
        assert_eq!(hit(n, d1.x - 1.0, d1.cy()), Hit::Bar);
        let c = close_rect(n);
        assert_eq!(hit(n, c.cx(), c.cy()), Hit::Close);
        let g = grip_rect();
        assert_eq!(hit(n, g.cx(), g.cy()), Hit::Bar);
        // off the bar, and in the corner outside the rounded end
        assert_eq!(hit(n, bar_width(n) + 1.0, 20.0), Hit::Nothing);
        assert_eq!(hit(n, 0.5, 0.5), Hit::Nothing);
        assert_eq!(hit(n, 20.0, 45.0), Hit::Nothing);
        // the dot row's top edge, inside the bar
        assert_eq!(hit(n, d1.cx(), 39.0), Hit::Bar);
        // no apps: no dot can be hit
        assert_eq!(hit(0, dot_rect(0).cx(), 20.0), Hit::Bar);
    }

    #[test]
    fn card_goes_above_only_at_the_bottom_of_the_screen() {
        // 1080 px work area at 100%: the card needs 84 px under the top
        assert_eq!(card_side(100, 1040, 1.0), Side::Below);
        assert_eq!(card_side(956, 1040, 1.0), Side::Below);
        assert_eq!(card_side(957, 1040, 1.0), Side::Above);
        // at 150% the same bar needs 126 px
        assert_eq!(card_side(914, 1040, 1.5), Side::Below);
        assert_eq!(card_side(915, 1040, 1.5), Side::Above);
    }

    #[test]
    fn window_grows_for_the_card_on_its_side() {
        assert_eq!(window_box(4, None), (0.0, 0.0, 187.0, 40.0));
        // narrower than the card minimum: widened to it
        assert_eq!(window_box(2, Some(Side::Below)), (0.0, 0.0, 160.0, 84.0));
        assert_eq!(window_box(4, Some(Side::Above)), (0.0, -44.0, 187.0, 84.0));
        assert_eq!(card_rect(4, Side::Below).y, 44.0);
        assert_eq!(card_rect(4, Side::Above).y, 0.0);
        assert_eq!(bar_top(Some(Side::Above)), 44.0);
        assert_eq!(bar_top(Some(Side::Below)), 0.0);
        assert_eq!(card_rect(1, Side::Below).w, CARD_MIN_W);
    }

    #[test]
    fn clicks_map_like_the_webview_pill() {
        assert_eq!(dot_action(State::Running, false, false), Action::Stop);
        assert_eq!(dot_action(State::Stopped, false, false), Action::Start);
        assert_eq!(dot_action(State::Missing, false, false), Action::OpenTab);
        assert_eq!(dot_action(State::Checking, false, false), Action::None);
        // DevGo's own dot, and a dot whose start/stop is in flight
        assert_eq!(dot_action(State::Running, true, false), Action::None);
        assert_eq!(dot_action(State::Stopped, false, true), Action::None);
    }

    #[test]
    fn states_words_and_colours() {
        assert_eq!(state_of(None), State::Checking);
        assert_eq!(state_of(Some((true, true))), State::Running);
        assert_eq!(state_of(Some((false, true))), State::Missing);
        assert_eq!(state_of(Some((false, false))), State::Stopped);
        assert_eq!(hint(State::Running, true), "this app");
        assert_eq!(hint(State::Stopped, false), "click to start");
        assert_eq!(state_word(State::Missing), "Not installed");
        assert_eq!(
            dot_look(State::Running, &NEON),
            DotLook::Fill {
                color: EMERALD_DOT,
                glow: true
            }
        );
        assert_eq!(
            dot_look(State::Stopped, &NEON),
            DotLook::Fill {
                color: NEON.danger,
                glow: false
            }
        );
        assert_eq!(
            dot_look(State::Missing, &NEON),
            DotLook::Ring {
                color: NEON.text_muted,
                width: 2.0
            }
        );
        assert_eq!(state_tone(State::Stopped, &NEON), NEON.danger);
    }
}
