//! Draws the pill into a pixel buffer: tiny-skia for the shapes, ab_glyph for
//! the text. Everything is laid out in logical px (`layout`) and drawn at
//! the window's scale, so it is sharp at 100% and at 150%.

use std::sync::{Arc, OnceLock};

use ab_glyph::{Font, FontVec, PxScale, ScaleFont};
use tiny_skia::{
    Color, FillRule, GradientStop, LineCap, Paint, Path, PathBuilder, Pixmap,
    PixmapPaint, Point, RadialGradient, SpreadMode, Stroke, Transform,
};

use super::layout::{self, DotLook, Hit, Side, State};
use super::palette::{Palette, Rgb};

/// One dot as the window knows it.
#[derive(Debug, Clone, PartialEq)]
pub struct DotView {
    pub name: String,
    pub state: State,
    pub is_self: bool,
    /// a start or stop in flight: drawn faded, clicks ignored
    pub busy: bool,
}

pub struct View<'a> {
    pub dots: &'a [DotView],
    pub hover: Hit,
    /// the card: which dot, which side of the bar
    pub card: Option<(usize, Side)>,
    /// the card's icon, premultiplied, if the exe has one
    pub icon: Option<Arc<Pixmap>>,
    pub palette: Palette,
    pub scale: f32,
}

pub struct Fonts {
    regular: FontVec,
    semibold: FontVec,
}

/// Segoe UI from the Windows fonts folder, read once. `None` (no such font)
/// = the pill draws without words rather than not at all.
pub fn fonts() -> Option<&'static Fonts> {
    static FONTS: OnceLock<Option<Fonts>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let dir = std::env::var_os("WINDIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| "C:\\Windows".into())
                .join("Fonts");
            let load = |name: &str| {
                FontVec::try_from_vec(std::fs::read(dir.join(name)).ok()?).ok()
            };
            let regular = load("segoeui.ttf")?;
            let semibold = load("seguisb.ttf")
                .or_else(|| load("segoeuib.ttf"))
                .or_else(|| load("segoeui.ttf"))?;
            Some(Fonts { regular, semibold })
        })
        .as_ref()
}

fn color(c: Rgb, alpha: f32) -> Color {
    Color::from_rgba8(c.r, c.g, c.b, (alpha.clamp(0.0, 1.0) * 255.0) as u8)
}

fn solid(c: Rgb, alpha: f32) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color(color(c, alpha));
    p.anti_alias = true;
    p
}

/// a rounded rectangle, corners as cubic quarter circles
fn rounded(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<Path> {
    let r = r.min(w / 2.0).min(h / 2.0);
    // 4/3 * (sqrt(2) - 1): a cubic's handle length for a quarter circle
    let k = r * 0.552_284_8;
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    pb.close();
    pb.finish()
}

/// a panel: filled, with a 1 px border drawn inside its edge
fn panel(pm: &mut Pixmap, ts: Transform, b: layout::Rect, r: f32, p: &Palette) {
    if let Some(path) =
        rounded(b.x + 0.5, b.y + 0.5, b.w - 1.0, b.h - 1.0, r - 0.5)
    {
        pm.fill_path(
            &path,
            &solid(p.surface, 1.0),
            FillRule::Winding,
            ts,
            None,
        );
        let stroke = Stroke {
            width: 1.0,
            ..Stroke::default()
        };
        pm.stroke_path(&path, &solid(p.border_strong, 1.0), &stroke, ts, None);
    }
}

fn circle(
    pm: &mut Pixmap,
    ts: Transform,
    cx: f32,
    cy: f32,
    r: f32,
    paint: &Paint,
) {
    if let Some(path) = PathBuilder::from_circle(cx, cy, r) {
        pm.fill_path(&path, paint, FillRule::Winding, ts, None);
    }
}

fn dot(
    pm: &mut Pixmap,
    ts: Transform,
    cx: f32,
    cy: f32,
    look: DotLook,
    alpha: f32,
) {
    let r = layout::DOT_R;
    match look {
        DotLook::Fill { color: c, glow } => {
            if glow {
                // `shadow-[0_0_6px_#34d399]`: a soft halo 6 px out
                let stops = vec![
                    GradientStop::new(0.0, color(c, 0.55 * alpha)),
                    GradientStop::new(r / (r + 6.0), color(c, 0.45 * alpha)),
                    GradientStop::new(1.0, color(c, 0.0)),
                ];
                if let Some(shader) = RadialGradient::new(
                    Point::from_xy(cx, cy),
                    Point::from_xy(cx, cy),
                    r + 6.0,
                    stops,
                    SpreadMode::Pad,
                    Transform::identity(),
                ) {
                    let paint = Paint {
                        shader,
                        anti_alias: true,
                        ..Paint::default()
                    };
                    circle(pm, ts, cx, cy, r + 6.0, &paint);
                }
            }
            circle(pm, ts, cx, cy, r, &solid(c, alpha));
        }
        DotLook::Ring { color: c, width } => {
            if let Some(path) =
                PathBuilder::from_circle(cx, cy, r - width / 2.0)
            {
                let stroke = Stroke {
                    width,
                    ..Stroke::default()
                };
                pm.stroke_path(&path, &solid(c, alpha), &stroke, ts, None);
            }
        }
    }
}

/// a font size in CSS px, as ab_glyph's scale (which is the font's height)
fn px_scale(font: &FontVec, css_px: f32) -> PxScale {
    let em = font.units_per_em().unwrap_or(2048.0);
    PxScale::from(css_px * font.height_unscaled() / em)
}

/// physical px wide
fn measure(font: &FontVec, scale: PxScale, text: &str) -> f32 {
    let sf = font.as_scaled(scale);
    let mut w = 0.0;
    let mut prev = None;
    for ch in text.chars() {
        let id = sf.glyph_id(ch);
        if let Some(p) = prev {
            w += sf.kern(p, id);
        }
        w += sf.h_advance(id);
        prev = Some(id);
    }
    w
}

/// `text`, or as much of it as fits in `max` with an ellipsis
fn fit(font: &FontVec, scale: PxScale, text: &str, max: f32) -> String {
    if measure(font, scale, text) <= max {
        return text.to_string();
    }
    let mut chars: Vec<char> = text.chars().collect();
    while !chars.is_empty() {
        chars.pop();
        let s: String =
            chars.iter().collect::<String>().trim_end().to_string() + "…";
        if measure(font, scale, &s) <= max {
            return s;
        }
    }
    String::new()
}

/// Draws `text` with its baseline at (x, baseline), physical px; returns the
/// caret after it. Coverage is blended source-over into the premultiplied
/// buffer, a little heavier than linear so light text on a dark bar does
/// not look thin.
fn text(
    pm: &mut Pixmap,
    font: &FontVec,
    scale: PxScale,
    x: f32,
    baseline: f32,
    s: &str,
    c: Rgb,
) -> f32 {
    let sf = font.as_scaled(scale);
    let (w, h) = (pm.width() as i32, pm.height() as i32);
    let data = pm.data_mut();
    let mut caret = x;
    let mut prev = None;
    for ch in s.chars() {
        let id = sf.glyph_id(ch);
        if let Some(p) = prev {
            caret += sf.kern(p, id);
        }
        let glyph =
            id.with_scale_and_position(scale, ab_glyph::point(caret, baseline));
        caret += sf.h_advance(id);
        prev = Some(id);
        let Some(outlined) = font.outline_glyph(glyph) else {
            continue;
        };
        let b = outlined.px_bounds();
        outlined.draw(|gx, gy, cov| {
            let px = b.min.x as i32 + gx as i32;
            let py = b.min.y as i32 + gy as i32;
            if px < 0 || py < 0 || px >= w || py >= h {
                return;
            }
            let a = cov.clamp(0.0, 1.0).powf(0.8);
            let i = ((py * w + px) * 4) as usize;
            let inv = 1.0 - a;
            let src = [c.r, c.g, c.b];
            for k in 0..3 {
                data[i + k] = (src[k] as f32 * a + data[i + k] as f32 * inv)
                    .round() as u8;
            }
            data[i + 3] = (255.0 * a + data[i + 3] as f32 * inv).round() as u8;
        });
    }
    caret
}

/// straight RGBA (stack_facts' icon pixels) to a premultiplied pixmap
pub fn icon_pixmap(w: u32, h: u32, rgba: &[u8]) -> Option<Pixmap> {
    let mut pm = Pixmap::new(w, h)?;
    if rgba.len() != (w * h * 4) as usize {
        return None;
    }
    for (dst, src) in pm
        .data_mut()
        .as_chunks_mut::<4>()
        .0
        .iter_mut()
        .zip(rgba.as_chunks::<4>().0)
    {
        let a = src[3] as u32;
        for k in 0..3 {
            dst[k] = ((src[k] as u32 * a + 127) / 255) as u8;
        }
        dst[3] = src[3];
    }
    Some(pm)
}

/// The whole window, in physical px.
pub fn paint(v: &View) -> Option<Pixmap> {
    let n = v.dots.len();
    let s = v.scale;
    let card_side = v.card.map(|(_, side)| side);
    let (_, _, lw, lh) = layout::window_box(n, card_side);
    let mut pm = Pixmap::new((lw * s).ceil() as u32, (lh * s).ceil() as u32)?;
    let top = layout::bar_top(card_side);
    let ts = Transform::from_row(s, 0.0, 0.0, s, 0.0, top * s);
    let p = &v.palette;
    let bar_w = layout::bar_width(n);

    // the bar
    let bar = layout::Rect {
        x: 0.0,
        y: 0.0,
        w: bar_w,
        h: layout::BAR_H,
    };
    panel(&mut pm, ts, bar, layout::BAR_H / 2.0, p);

    // the grip: six 1 px dots, a 6 x 14 block in the grip's middle
    let g = layout::grip_rect();
    let grip_ink = if v.hover == Hit::Bar {
        p.text_secondary
    } else {
        p.text_muted
    };
    for gy in [1.0, 7.0, 13.0] {
        for gx in [1.0, 5.0] {
            circle(
                &mut pm,
                ts,
                g.cx() - 3.0 + gx,
                g.cy() - 7.0 + gy,
                1.0,
                &solid(grip_ink, 1.0),
            );
        }
    }

    // the dots, the hovered one on a hover disc
    for (i, d) in v.dots.iter().enumerate() {
        let r = layout::dot_rect(i);
        if v.hover == Hit::Dot(i) {
            circle(
                &mut pm,
                ts,
                r.cx(),
                r.cy(),
                layout::DOT_BTN / 2.0,
                &solid(p.hover, 1.0),
            );
        }
        let alpha = if d.busy { 0.45 } else { 1.0 };
        dot(
            &mut pm,
            ts,
            r.cx(),
            r.cy(),
            layout::dot_look(d.state, p),
            alpha,
        );
    }
    let fonts = fonts();
    if n == 0 {
        if let Some(f) = fonts {
            let sc = px_scale(&f.regular, 11.0);
            let x = layout::dot_rect(0).x + 4.0;
            text(
                &mut pm,
                &f.regular,
                sc,
                x * s,
                (top + 24.0) * s,
                "No apps yet",
                p.text_secondary,
            );
        }
    }

    // the divider and ✕
    let dx = layout::divider_x(n);
    let mut pb = PathBuilder::new();
    pb.move_to(dx, 12.0);
    pb.line_to(dx, 28.0);
    if let Some(path) = pb.finish() {
        let stroke = Stroke {
            width: 1.0,
            ..Stroke::default()
        };
        pm.stroke_path(&path, &solid(p.border_strong, 1.0), &stroke, ts, None);
    }
    let c = layout::close_rect(n);
    if v.hover == Hit::Close {
        circle(
            &mut pm,
            ts,
            c.cx(),
            c.cy(),
            layout::CLOSE_BTN / 2.0,
            &solid(p.hover, 1.0),
        );
    }
    let ink = if v.hover == Hit::Close {
        p.text_primary
    } else {
        p.text_secondary
    };
    let mut pb = PathBuilder::new();
    let a = 3.5;
    pb.move_to(c.cx() - a, c.cy() - a);
    pb.line_to(c.cx() + a, c.cy() + a);
    pb.move_to(c.cx() + a, c.cy() - a);
    pb.line_to(c.cx() - a, c.cy() + a);
    if let Some(path) = pb.finish() {
        let stroke = Stroke {
            width: 1.25,
            line_cap: LineCap::Round,
            ..Stroke::default()
        };
        pm.stroke_path(&path, &solid(ink, 1.0), &stroke, ts, None);
    }

    // the card
    if let Some((i, side)) = v.card {
        if let Some(d) = v.dots.get(i) {
            card(&mut pm, v, d, side, fonts);
        }
    }
    Some(pm)
}

fn card(
    pm: &mut Pixmap,
    v: &View,
    d: &DotView,
    side: Side,
    fonts: Option<&Fonts>,
) {
    let s = v.scale;
    let p = &v.palette;
    let n = v.dots.len();
    let r = layout::card_rect(n, side);
    let ts = Transform::from_scale(s, s);
    panel(pm, ts, r, 12.0, p);

    // the icon, 28 px, or the letter tile
    let icon = 28.0;
    let (ix, iy) = (r.x + 8.0, r.y + (r.h - icon) / 2.0);
    match &v.icon {
        Some(img) => {
            let k = icon * s / img.width() as f32;
            let paint = PixmapPaint {
                quality: tiny_skia::FilterQuality::Bicubic,
                ..PixmapPaint::default()
            };
            pm.draw_pixmap(
                0,
                0,
                Pixmap::as_ref(img),
                &paint,
                Transform::from_row(k, 0.0, 0.0, k, ix * s, iy * s),
                None,
            );
        }
        None => {
            if let Some(path) = rounded(ix, iy, icon, icon, 6.0) {
                pm.fill_path(
                    &path,
                    &solid(p.raised, 1.0),
                    FillRule::Winding,
                    ts,
                    None,
                );
            }
            if let Some(f) = fonts {
                let letter = d
                    .name
                    .chars()
                    .find(|c| c.is_alphanumeric())
                    .map(|c| c.to_uppercase().to_string())
                    .unwrap_or_else(|| "?".into());
                let sc = px_scale(&f.semibold, 13.0);
                let w = measure(&f.semibold, sc, &letter);
                text(
                    pm,
                    &f.semibold,
                    sc,
                    (ix + icon / 2.0) * s - w / 2.0,
                    (iy + 19.0) * s,
                    &letter,
                    p.text_primary,
                );
            }
        }
    }

    let Some(f) = fonts else {
        return;
    };
    let tx = (ix + icon + 8.0) * s;
    let max = (r.x + r.w - 8.0) * s - tx;
    let name_sc = px_scale(&f.semibold, 13.0);
    let name = fit(&f.semibold, name_sc, &d.name, max);
    text(
        pm,
        &f.semibold,
        name_sc,
        tx,
        (r.y + 18.0) * s,
        &name,
        p.text_primary,
    );

    // "Running · click to stop": the state word in its dot's colour
    let small = px_scale(&f.regular, 11.0);
    let word = layout::state_word(d.state);
    let hint = layout::hint(d.state, d.is_self);
    let rest = if hint.is_empty() {
        String::new()
    } else {
        format!(" · {hint}")
    };
    let word_fit = fit(&f.regular, small, word, max);
    let after = text(
        pm,
        &f.regular,
        small,
        tx,
        (r.y + 32.0) * s,
        &word_fit,
        layout::state_tone(d.state, p),
    );
    if !rest.is_empty() && word_fit == word {
        let rest = fit(&f.regular, small, &rest, max - (after - tx));
        text(
            pm,
            &f.regular,
            small,
            after,
            (r.y + 32.0) * s,
            &rest,
            p.text_muted,
        );
    }
}

/// premultiplied RGBA to premultiplied BGRA (what a 32-bit DIB holds)
pub fn to_bgra(pm: &Pixmap, out: &mut [u8]) {
    for (dst, src) in out
        .as_chunks_mut::<4>()
        .0
        .iter_mut()
        .zip(pm.data().as_chunks::<4>().0)
    {
        dst[0] = src[2];
        dst[1] = src[1];
        dst[2] = src[0];
        dst[3] = src[3];
    }
}

#[cfg(test)]
mod tests {
    use super::super::palette::NEON;
    use super::*;

    fn dots(n: usize) -> Vec<DotView> {
        (0..n)
            .map(|i| DotView {
                name: format!("App {i}"),
                state: State::Running,
                is_self: false,
                busy: false,
            })
            .collect()
    }

    #[test]
    fn paints_the_window_size_at_the_scale() {
        let d = dots(4);
        let v = View {
            dots: &d,
            hover: Hit::Nothing,
            card: None,
            icon: None,
            palette: NEON,
            scale: 1.5,
        };
        let pm = paint(&v).unwrap();
        assert_eq!((pm.width(), pm.height()), (281, 60));
        // the rounded corner is see-through, the bar's middle is solid
        assert_eq!(pm.pixel(0, 0).unwrap().alpha(), 0);
        assert_eq!(pm.pixel(140, 2).unwrap().alpha(), 255);
        let card = View {
            card: Some((1, Side::Above)),
            hover: Hit::Dot(1),
            ..v
        };
        let pm = paint(&card).unwrap();
        assert_eq!((pm.width(), pm.height()), (281, 126));
        // the 4 px gap between the card and the bar is see-through
        assert_eq!(pm.pixel(140, 62).unwrap().alpha(), 0);
    }

    #[test]
    fn icon_is_premultiplied() {
        let pm = icon_pixmap(1, 1, &[200, 100, 50, 128]).unwrap();
        let px = pm.pixel(0, 0).unwrap();
        assert_eq!(
            (px.red(), px.green(), px.blue(), px.alpha()),
            (100, 50, 25, 128)
        );
        assert!(icon_pixmap(2, 2, &[0; 4]).is_none());
    }
}
