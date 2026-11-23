//! The pill's colours: the active DevGo palette, as the main window hands it
//! over (`stack_pill_palette`, on every theme change) and as it was last
//! saved, so a pill opened before the main window has loaded still wears
//! the right theme. Plain data and parsing only; the window reads it.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// premultiplied-free 8-bit colour, alpha 255 unless a caller fades it
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// `#rrggbb` or `#rgb`; anything else (a `none`, an rgb() glow) is `None`
pub fn parse_hex(s: &str) -> Option<Rgb> {
    let h = s.trim().strip_prefix('#')?;
    let digit =
        |i: usize, n: usize| u8::from_str_radix(h.get(i..i + n)?, 16).ok();
    match h.len() {
        6 => Some(Rgb {
            r: digit(0, 2)?,
            g: digit(2, 2)?,
            b: digit(4, 2)?,
        }),
        3 => Some(Rgb {
            r: digit(0, 1)? * 17,
            g: digit(1, 1)? * 17,
            b: digit(2, 1)? * 17,
        }),
        _ => None,
    }
}

/// tailwind emerald-400 / -300: the app's "online" green, the same in
/// every palette (the webview pill's `bg-emerald-400`, `text-emerald-300`)
pub const EMERALD_DOT: Rgb = Rgb {
    r: 0x34,
    g: 0xd3,
    b: 0x99,
};
pub const EMERALD_TEXT: Rgb = Rgb {
    r: 0x6e,
    g: 0xe7,
    b: 0xb7,
};

/// The keys of `src/themes.ts` the pill paints with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Palette {
    /// the bar and the card (`bg-secondary`; `bg-popover` derives from it)
    pub surface: Rgb,
    pub hover: Rgb,
    /// the letter tile under an app with no icon
    pub raised: Rgb,
    pub border_strong: Rgb,
    pub text_primary: Rgb,
    pub text_secondary: Rgb,
    pub text_muted: Rgb,
    pub danger: Rgb,
}

/// DevGo Neon, the default theme (`THEMES[0]`), for a first run with
/// nothing saved yet
pub const NEON: Palette = Palette {
    surface: Rgb {
        r: 0x09,
        g: 0x0e,
        b: 0x19,
    },
    hover: Rgb {
        r: 0x13,
        g: 0x1f,
        b: 0x38,
    },
    raised: Rgb {
        r: 0x24,
        g: 0x3c,
        b: 0x66,
    },
    border_strong: Rgb {
        r: 0x5f,
        g: 0x7f,
        b: 0xb5,
    },
    text_primary: Rgb {
        r: 0xf4,
        g: 0xf8,
        b: 0xff,
    },
    text_secondary: Rgb {
        r: 0xb9,
        g: 0xc6,
        b: 0xde,
    },
    text_muted: Rgb {
        r: 0x8f,
        g: 0x9d,
        b: 0xba,
    },
    danger: Rgb {
        r: 0xfb,
        g: 0x71,
        b: 0x85,
    },
};

/// The theme's `colors` map (`themes.ts` keys) to a palette. A key that is
/// missing or not a hex keeps neon's value, so a half-filled map still
/// paints.
pub fn from_theme(colors: &HashMap<String, String>) -> Palette {
    let pick = |key: &str, fallback: Rgb| {
        colors
            .get(key)
            .and_then(|v| parse_hex(v))
            .unwrap_or(fallback)
    };
    Palette {
        surface: pick("bg-secondary", NEON.surface),
        hover: pick("bg-hover", NEON.hover),
        raised: pick("bg-raised", NEON.raised),
        border_strong: pick("border-strong", NEON.border_strong),
        text_primary: pick("text-primary", NEON.text_primary),
        text_secondary: pick("text-secondary", NEON.text_secondary),
        text_muted: pick("text-muted", NEON.text_muted),
        danger: pick("danger", NEON.danger),
    }
}

pub const FILE: &str = "stack-pill-palette.json";

/// the palette a pill paints with right now
static CURRENT: Mutex<Option<Palette>> = Mutex::new(None);

/// The saved map, or neon. Read once per process; later changes arrive
/// through `set`.
pub fn current(dir: &Path) -> Palette {
    let mut cur = CURRENT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(p) = *cur {
        return p;
    }
    let p = std::fs::read_to_string(dir.join(FILE))
        .ok()
        .and_then(|s| serde_json::from_str::<HashMap<String, String>>(&s).ok())
        .map(|m| from_theme(&m))
        .unwrap_or(NEON);
    *cur = Some(p);
    p
}

/// A theme change: keep it for this run and the next. Returns whether it
/// differs from what was painted, so an unchanged theme does not repaint.
pub fn set(dir: &Path, colors: &HashMap<String, String>) -> bool {
    let p = from_theme(colors);
    let mut cur = CURRENT.lock().unwrap_or_else(|e| e.into_inner());
    let changed = *cur != Some(p);
    *cur = Some(p);
    drop(cur);
    if changed {
        if let Ok(json) = serde_json::to_string(colors) {
            let _ = std::fs::write(dir.join(FILE), json);
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_six_three_and_junk() {
        assert_eq!(
            parse_hex("#22d3ee"),
            Some(Rgb {
                r: 0x22,
                g: 0xd3,
                b: 0xee
            })
        );
        assert_eq!(
            parse_hex(" #fff "),
            Some(Rgb {
                r: 255,
                g: 255,
                b: 255
            })
        );
        assert_eq!(parse_hex("none"), None);
        assert_eq!(parse_hex("#12345"), None);
        assert_eq!(parse_hex("#gg0000"), None);
        assert_eq!(parse_hex("0 0 0 1px rgb(34 211 238 / 0.45)"), None);
    }

    #[test]
    fn theme_map_picks_its_keys_and_falls_back_to_neon() {
        let mut m = HashMap::new();
        // nord's values
        m.insert("bg-secondary".to_string(), "#2e3440".to_string());
        m.insert("danger".to_string(), "#bf616a".to_string());
        m.insert("glow".to_string(), "none".to_string());
        m.insert("text-primary".to_string(), "not a colour".to_string());
        let p = from_theme(&m);
        assert_eq!(p.surface, parse_hex("#2e3440").unwrap());
        assert_eq!(p.danger, parse_hex("#bf616a").unwrap());
        assert_eq!(p.text_primary, NEON.text_primary);
        assert_eq!(p.border_strong, NEON.border_strong);
    }

    #[test]
    fn neon_matches_themes_ts() {
        let ts = include_str!("../../../src/themes.ts");
        let neon = &ts[ts.find("id: 'neon'").unwrap()..];
        let neon = &neon[..neon.find("glow:").unwrap()];
        for (key, want) in [
            ("'bg-secondary'", NEON.surface),
            ("'bg-hover'", NEON.hover),
            ("'bg-raised'", NEON.raised),
            ("'border-strong'", NEON.border_strong),
            ("'text-primary'", NEON.text_primary),
            ("'text-secondary'", NEON.text_secondary),
            ("'text-muted'", NEON.text_muted),
            ("danger", NEON.danger),
        ] {
            let at = neon.find(&format!("{key}:")).unwrap();
            let hex =
                neon[at..].split('\'').find(|s| s.starts_with('#')).unwrap();
            assert_eq!(parse_hex(hex), Some(want), "{key}");
        }
    }
}
