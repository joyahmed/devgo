//! What the Stack tab says about an app beyond "running": its real icon and
//! display name (read from the exe), and its uptime and memory (read from
//! the processes the snapshot already found). The Windows calls are in
//! `imp`; everything that can be checked without them is a plain function
//! here, with tests.

use std::path::Path;

use super::stack::{normalize, Proc};

/// FILETIME ticks (100 ns) in a second
const TICKS: u64 = 10_000_000;

/// The name a person knows an exe by: its FileDescription, then its
/// ProductName, then the file name with dashes and underscores as spaces.
/// A description that is only the file name again (many build tools write
/// that) loses to a ProductName that says more.
pub fn pick_name(
    description: Option<&str>,
    product: Option<&str>,
    path: &str,
) -> String {
    let stem = path
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_string();
    let stem = normalize(&stem);
    let clean = |s: Option<&str>| {
        s.map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let desc = clean(description);
    let prod = clean(product);
    // "desk-monitor" or "voiceapp" is a file name written into the
    // description; "Notepad" is the same word written as a name, and stays
    let raw_file_name = |s: &String| {
        normalize(s) == stem
            && (s.contains(['-', '_']) || *s == s.to_lowercase())
    };
    match (desc, prod) {
        (Some(d), Some(p)) if raw_file_name(&d) && !raw_file_name(&p) => p,
        (Some(d), _) => d,
        (None, Some(p)) => p,
        (None, None) => pretty_stem(&stem),
    }
}

/// `desk-monitor` -> `Desk monitor`
fn pretty_stem(stem: &str) -> String {
    let spaced: String = stem
        .chars()
        .map(|c| if c == '-' || c == '_' { ' ' } else { c })
        .collect();
    let mut chars = spaced.trim().chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Seconds between two FILETIMEs; 0 when the clock reads earlier than the
/// start (a clock change must not show a negative uptime).
pub fn uptime_secs(now: u64, created: u64) -> u64 {
    now.saturating_sub(created) / TICKS
}

/// The app's own processes and every process under them: a WebView2 or
/// Electron app does most of its work in children with other names, and
/// leaving them out reports a third of its memory. `visited` stops a
/// parent-pid loop (Windows reuses pids, so a stale parent can point back).
pub fn family(snap: &[Proc], roots: &[u32]) -> Vec<u32> {
    let mut out: Vec<u32> = roots.to_vec();
    let mut i = 0;
    while i < out.len() {
        let parent = out[i];
        for p in snap {
            if p.parent == parent && p.pid != parent && !out.contains(&p.pid) {
                out.push(p.pid);
            }
        }
        i += 1;
    }
    out
}

/// BGRA rows from GetDIBits -> RGBA. Icons from before alpha channels
/// carry alpha 0 everywhere and say what is transparent in a separate
/// mask (white = see-through), so when no pixel has alpha the mask decides.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn bgra_to_rgba(bgra: &[u8], mask: Option<&[u8]>) -> Vec<u8> {
    let px = bgra.as_chunks::<4>().0;
    let has_alpha = px.iter().any(|p| p[3] != 0);
    let mut out = Vec::with_capacity(bgra.len());
    for (i, p) in px.iter().enumerate() {
        let alpha = if has_alpha {
            p[3]
        } else {
            match mask {
                Some(m) if m.get(i * 4).copied().unwrap_or(0) != 0 => 0,
                _ => 255,
            }
        };
        out.extend_from_slice(&[p[2], p[1], p[0], alpha]);
    }
    out
}

/// RGBA -> `data:image/png;base64,...`, ready for an `<img src>`.
pub fn png_data_url(width: u32, height: u32, rgba: &[u8]) -> Option<String> {
    use base64::Engine;
    let mut bytes = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut bytes, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().ok()?;
        w.write_image_data(rgba).ok()?;
    }
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Name, process and icon of an exe (the command caches the icon itself).
#[cfg(test)]
fn describe(path: &str) -> (String, String, Option<String>) {
    let (name, process) = describe_text(path);
    (name, process, icon(path))
}

/// Name and process of an exe the user just picked.
pub fn describe_text(path: &str) -> (String, String) {
    let (desc, prod) = imp::version_strings(Path::new(path));
    let name = pick_name(desc.as_deref(), prod.as_deref(), path);
    let file = path.trim().rsplit(['/', '\\']).next().unwrap_or("");
    (name, normalize(file))
}

/// The exe's icon as a PNG data URL, `None` when it has none or is gone.
pub fn icon(path: &str) -> Option<String> {
    let (w, h, rgba) = icon_rgba(path)?;
    png_data_url(w, h, &rgba)
}

/// The exe's icon as straight RGBA pixels (width, height, pixels): the
/// native pill draws them without a PNG round trip.
pub fn icon_rgba(path: &str) -> Option<(u32, u32, Vec<u8>)> {
    imp::icon_rgba(Path::new(path))
}

/// (uptime in seconds, working set in bytes) for an app's processes and
/// their children. Uptime is the oldest of its own processes.
pub fn usage(snap: &[Proc], roots: &[u32]) -> (Option<u64>, Option<u64>) {
    if roots.is_empty() {
        return (None, None);
    }
    let now = imp::now_filetime();
    let uptime = roots
        .iter()
        .filter_map(|pid| imp::created(*pid))
        .min()
        .map(|c| uptime_secs(now, c));
    let mem: u64 = family(snap, roots)
        .iter()
        .filter_map(|pid| imp::working_set(*pid))
        .sum();
    (uptime, (mem > 0).then_some(mem))
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    type Handle = *mut c_void;

    #[repr(C)]
    struct IconInfo {
        is_icon: i32,
        hotspot_x: u32,
        hotspot_y: u32,
        mask: Handle,
        color: Handle,
    }

    #[repr(C)]
    struct Bitmap {
        kind: i32,
        width: i32,
        height: i32,
        width_bytes: i32,
        planes: u16,
        bits_pixel: u16,
        bits: *mut c_void,
    }

    #[repr(C)]
    struct BitmapInfo {
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
        colors: [u32; 1],
    }

    #[repr(C)]
    struct MemoryCounters {
        cb: u32,
        page_faults: u32,
        peak_working_set: usize,
        working_set: usize,
        quota_peak_paged: usize,
        quota_paged: usize,
        quota_peak_non_paged: usize,
        quota_non_paged: usize,
        pagefile: usize,
        peak_pagefile: usize,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(h: Handle) -> i32;
        fn GetProcessTimes(
            h: Handle,
            created: *mut u64,
            exited: *mut u64,
            kernel: *mut u64,
            user: *mut u64,
        ) -> i32;
        fn GetSystemTimeAsFileTime(now: *mut u64);
        fn K32GetProcessMemoryInfo(
            h: Handle,
            counters: *mut MemoryCounters,
            cb: u32,
        ) -> i32;
    }

    #[link(name = "version")]
    unsafe extern "system" {
        fn GetFileVersionInfoSizeExW(
            flags: u32,
            file: *const u16,
            handle: *mut u32,
        ) -> u32;
        fn GetFileVersionInfoExW(
            flags: u32,
            file: *const u16,
            handle: u32,
            len: u32,
            data: *mut c_void,
        ) -> i32;
        fn VerQueryValueW(
            block: *const c_void,
            sub: *const u16,
            out: *mut *mut c_void,
            len: *mut u32,
        ) -> i32;
    }

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHDefExtractIconW(
            file: *const u16,
            index: i32,
            flags: u32,
            large: *mut Handle,
            small: *mut Handle,
            sizes: u32,
        ) -> i32;
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetIconInfo(icon: Handle, info: *mut IconInfo) -> i32;
        fn DestroyIcon(icon: Handle) -> i32;
        fn GetDC(wnd: Handle) -> Handle;
        fn ReleaseDC(wnd: Handle, dc: Handle) -> i32;
    }

    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn GetObjectW(obj: Handle, size: i32, out: *mut c_void) -> i32;
        fn GetDIBits(
            dc: Handle,
            bitmap: Handle,
            start: u32,
            lines: u32,
            bits: *mut c_void,
            info: *mut BitmapInfo,
            usage: u32,
        ) -> i32;
        fn DeleteObject(obj: Handle) -> i32;
    }

    const QUERY_LIMITED: u32 = 0x1000;
    /// read the strings through the exe's language resources (.mui), as
    /// Explorer does: a system exe keeps its FileDescription there only
    const LOCALISED: u32 = 0x01;
    /// 48 px: crisp in a 32 px tile at 150% scaling, and one PNG per app
    const ICON_PX: u32 = 48;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn wide_path(p: &Path) -> Vec<u16> {
        p.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    pub fn now_filetime() -> u64 {
        let mut now = 0u64;
        unsafe { GetSystemTimeAsFileTime(&mut now) };
        now
    }

    fn with_process<T>(
        pid: u32,
        f: impl FnOnce(Handle) -> Option<T>,
    ) -> Option<T> {
        unsafe {
            let h = OpenProcess(QUERY_LIMITED, 0, pid);
            if h.is_null() {
                return None;
            }
            let out = f(h);
            CloseHandle(h);
            out
        }
    }

    pub fn created(pid: u32) -> Option<u64> {
        with_process(pid, |h| {
            let (mut c, mut e, mut k, mut u) = (0u64, 0u64, 0u64, 0u64);
            let ok =
                unsafe { GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u) };
            (ok != 0 && c != 0).then_some(c)
        })
    }

    pub fn working_set(pid: u32) -> Option<u64> {
        with_process(pid, |h| {
            let mut m: MemoryCounters = unsafe { std::mem::zeroed() };
            m.cb = std::mem::size_of::<MemoryCounters>() as u32;
            let ok = unsafe { K32GetProcessMemoryInfo(h, &mut m, m.cb) };
            (ok != 0).then_some(m.working_set as u64)
        })
    }

    fn query_string(block: &[u8], key: &str) -> Option<String> {
        let mut ptr: *mut c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let sub = wide(key);
        let ok = unsafe {
            VerQueryValueW(
                block.as_ptr() as *const c_void,
                sub.as_ptr(),
                &mut ptr,
                &mut len,
            )
        };
        if ok == 0 || ptr.is_null() || len == 0 {
            return None;
        }
        let chars = unsafe {
            std::slice::from_raw_parts(ptr as *const u16, len as usize)
        };
        let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
        Some(String::from_utf16_lossy(&chars[..end]))
    }

    /// (FileDescription, ProductName) in the exe's own first language, then
    /// in US English, the two tables most exes carry.
    pub fn version_strings(path: &Path) -> (Option<String>, Option<String>) {
        let file = wide_path(path);
        let size = unsafe {
            GetFileVersionInfoSizeExW(
                LOCALISED,
                file.as_ptr(),
                std::ptr::null_mut(),
            )
        };
        if size == 0 {
            return (None, None);
        }
        let mut block = vec![0u8; size as usize];
        let ok = unsafe {
            GetFileVersionInfoExW(
                LOCALISED,
                file.as_ptr(),
                0,
                size,
                block.as_mut_ptr() as *mut c_void,
            )
        };
        if ok == 0 {
            return (None, None);
        }
        let mut tables = Vec::new();
        let mut ptr: *mut c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let sub = wide("\\VarFileInfo\\Translation");
        let has = unsafe {
            VerQueryValueW(
                block.as_ptr() as *const c_void,
                sub.as_ptr(),
                &mut ptr,
                &mut len,
            )
        };
        if has != 0 && !ptr.is_null() && len >= 4 {
            let pairs = unsafe {
                std::slice::from_raw_parts(
                    ptr as *const u16,
                    (len / 2) as usize,
                )
            };
            for p in pairs.as_chunks::<2>().0 {
                tables.push(format!("{:04x}{:04x}", p[0], p[1]));
            }
        }
        tables.extend(["040904b0".to_string(), "040904e4".to_string()]);
        let find = |key: &str| {
            tables.iter().find_map(|t| {
                query_string(&block, &format!("\\StringFileInfo\\{t}\\{key}"))
                    .filter(|s| !s.trim().is_empty())
            })
        };
        (find("FileDescription"), find("ProductName"))
    }

    /// The bitmap's pixels as top-down BGRA.
    unsafe fn pixels(
        dc: Handle,
        bitmap: Handle,
        w: i32,
        h: i32,
    ) -> Option<Vec<u8>> {
        let mut info: BitmapInfo = unsafe { std::mem::zeroed() };
        info.size = (std::mem::size_of::<BitmapInfo>() - 4) as u32;
        info.width = w;
        info.height = -h;
        info.planes = 1;
        info.bit_count = 32;
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let lines = unsafe {
            GetDIBits(
                dc,
                bitmap,
                0,
                h as u32,
                buf.as_mut_ptr() as *mut c_void,
                &mut info,
                0,
            )
        };
        (lines == h).then_some(buf)
    }

    pub fn icon_rgba(path: &Path) -> Option<(u32, u32, Vec<u8>)> {
        if !path.exists() {
            return None;
        }
        let file = wide_path(path);
        unsafe {
            let (mut large, mut small): (Handle, Handle) =
                (std::ptr::null_mut(), std::ptr::null_mut());
            let hr = SHDefExtractIconW(
                file.as_ptr(),
                0,
                0,
                &mut large,
                &mut small,
                ICON_PX | (16 << 16),
            );
            if !small.is_null() {
                DestroyIcon(small);
            }
            if hr != 0 || large.is_null() {
                return None;
            }
            let mut ii: IconInfo = std::mem::zeroed();
            let got = GetIconInfo(large, &mut ii);
            DestroyIcon(large);
            if got == 0 {
                return None;
            }
            let out = (|| {
                if ii.color.is_null() {
                    return None;
                }
                let mut bm: Bitmap = std::mem::zeroed();
                let n = GetObjectW(
                    ii.color,
                    std::mem::size_of::<Bitmap>() as i32,
                    &mut bm as *mut Bitmap as *mut c_void,
                );
                if n == 0 || bm.width <= 0 || bm.height <= 0 {
                    return None;
                }
                let (w, h) = (bm.width, bm.height);
                let dc = GetDC(std::ptr::null_mut());
                let color = pixels(dc, ii.color, w, h);
                let mask = if ii.mask.is_null() {
                    None
                } else {
                    pixels(dc, ii.mask, w, h)
                };
                ReleaseDC(std::ptr::null_mut(), dc);
                let rgba = super::bgra_to_rgba(&color?, mask.as_deref());
                Some((w as u32, h as u32, rgba))
            })();
            if !ii.color.is_null() {
                DeleteObject(ii.color);
            }
            if !ii.mask.is_null() {
                DeleteObject(ii.mask);
            }
            out
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::Path;

    pub fn now_filetime() -> u64 {
        0
    }
    pub fn created(_pid: u32) -> Option<u64> {
        None
    }
    pub fn working_set(_pid: u32) -> Option<u64> {
        None
    }
    pub fn version_strings(_path: &Path) -> (Option<String>, Option<String>) {
        (None, None)
    }
    pub fn icon_rgba(_path: &Path) -> Option<(u32, u32, Vec<u8>)> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(pid: u32, parent: u32, name: &str) -> Proc {
        Proc {
            pid,
            parent,
            name: name.into(),
        }
    }

    #[test]
    fn the_name_is_the_description_then_the_product_then_the_file() {
        let p = r"C:\x\desk-monitor.exe";
        assert_eq!(
            pick_name(Some("Desk Monitor"), Some("DM"), p),
            "Desk Monitor"
        );
        assert_eq!(pick_name(None, Some("Desk Monitor"), p), "Desk Monitor");
        assert_eq!(
            pick_name(Some("  "), Some("Desk Monitor"), p),
            "Desk Monitor"
        );
        assert_eq!(pick_name(None, None, p), "Desk monitor");
        assert_eq!(pick_name(None, None, "/usr/bin/voice_app"), "Voice app");
    }

    #[test]
    fn a_description_that_is_only_the_file_name_loses_to_the_product() {
        let p = r"C:\x\desk-monitor.exe";
        assert_eq!(
            pick_name(Some("desk-monitor"), Some("Desk Monitor"), p),
            "Desk Monitor"
        );
        // both are the file name: keep what the exe says
        assert_eq!(
            pick_name(Some("desk-monitor"), Some("Desk-Monitor"), p),
            "desk-monitor"
        );
        // the file name written as a name is a name
        assert_eq!(
            pick_name(Some("Notepad"), Some("Windows"), r"C:\w\notepad.exe"),
            "Notepad"
        );
    }

    #[test]
    fn uptime_is_whole_seconds_and_never_negative() {
        assert_eq!(uptime_secs(25 * TICKS + 5, 0), 25);
        assert_eq!(uptime_secs(TICKS * 3600, TICKS * 60), 3540);
        assert_eq!(uptime_secs(0, TICKS), 0);
    }

    #[test]
    fn the_family_takes_children_and_grandchildren_once() {
        let snap = vec![
            proc(10, 1, "app"),
            proc(11, 10, "webview"),
            proc(12, 11, "webview"),
            proc(13, 99, "other"),
            // a stale parent pointing back at its own child
            proc(1, 12, "loop"),
        ];
        let mut f = family(&snap, &[10]);
        f.sort();
        assert_eq!(f, vec![1, 10, 11, 12]);
        assert!(family(&snap, &[]).is_empty());
    }

    #[test]
    fn bgra_becomes_rgba_and_the_mask_decides_when_there_is_no_alpha() {
        // two pixels with alpha: channels swap, alpha kept
        let with_alpha = [1, 2, 3, 200, 4, 5, 6, 0];
        assert_eq!(
            bgra_to_rgba(&with_alpha, None),
            vec![3, 2, 1, 200, 6, 5, 4, 0]
        );
        // no alpha anywhere: white in the mask is see-through, black is solid
        let flat = [1, 2, 3, 0, 4, 5, 6, 0];
        let mask = [255, 255, 255, 0, 0, 0, 0, 0];
        assert_eq!(
            bgra_to_rgba(&flat, Some(&mask)),
            vec![3, 2, 1, 0, 6, 5, 4, 255]
        );
        // no alpha and no mask: solid
        assert_eq!(bgra_to_rgba(&flat, None)[3], 255);
    }

    #[test]
    fn a_png_data_url_decodes_back_to_the_same_pixels() {
        use base64::Engine;
        let rgba: Vec<u8> = (0..2 * 2 * 4).map(|i| i as u8 * 10).collect();
        let url = png_data_url(2, 2, &rgba).unwrap();
        let b64 = url.strip_prefix("data:image/png;base64,").unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap();
        let mut dec = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut buf = vec![0; dec.output_buffer_size().unwrap()];
        let info = dec.next_frame(&mut buf).unwrap();
        assert_eq!((info.width, info.height), (2, 2));
        assert_eq!(&buf[..info.buffer_size()], &rgba[..]);
    }

    #[test]
    fn a_missing_exe_has_no_icon_and_a_name_from_its_file() {
        let (name, process, icon) = describe(r"C:\no\such\voice-app.exe");
        assert_eq!(
            (name.as_str(), process.as_str()),
            ("Voice app", "voice-app")
        );
        assert!(icon.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn notepad_has_a_description_and_an_icon() {
        let windir =
            std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
        let path = format!(r"{windir}\System32\notepad.exe");
        if !Path::new(&path).exists() {
            return;
        }
        let (name, process, icon) = describe(&path);
        assert_eq!(process, "notepad");
        assert!(name.to_lowercase().contains("notepad"), "{name}");
        let icon = icon.expect("notepad has an icon");
        assert!(icon.starts_with("data:image/png;base64,"));
        assert!(icon.len() > 200, "{} bytes", icon.len());
    }

    #[cfg(windows)]
    #[test]
    fn this_test_process_has_an_uptime_and_memory() {
        let snap = super::super::stack::snapshot();
        let (up, mem) = usage(&snap, &[std::process::id()]);
        assert!(up.is_some());
        assert!(mem.unwrap_or(0) > 1_000_000, "{mem:?}");
    }
}
