// the wsl light: is the vm up, right now, without asking wsl.
//
// wsl2 runs every distro inside one utility vm, and windows lists that
// vm's memory as a process named vmmemWSL. its presence in the process
// table is "wsl is up", and the table is a kernel snapshot: no wsl.exe,
// no wslservice, no distro touched. that is what makes a watcher legal
// under the no-timer rule; wsl.exe itself is asked once per transition.
//
// vmmemWSL, not Vmmem: the older name is every hyper-v vm's (sandbox,
// wsa, a lab vm) and lighting the chip for those would be a lie

use serde::Serialize;

/// The chip's state: the watcher's event, `get_wsl_state`'s answer, and
/// the hook's state share it. `up` is the VM's process being in the
/// process table; `distros` is what `wsl -l -q --running` last said.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WslState {
    pub up: bool,
    pub distros: Vec<String>,
}

// two seconds is under the time a distro takes to boot and register, so
// the light lands as the terminal's prompt does, and coarse enough that
// the snapshot is noise on the cpu graph
#[cfg(windows)]
const TICK: std::time::Duration = std::time::Duration::from_secs(2);

// the vm's process appears a beat before the distro is listed as running,
// so after an up the names are asked once a second until one arrives or
// this many asks are spent; the chip says starting until then
#[cfg(windows)]
const NAME_RETRIES: u32 = 5;

/// The state read fresh: the process table now, the memo'd list.
pub fn current() -> WslState {
    WslState {
        up: vm_is_up(),
        distros: super::wsl::running_distros_memo(),
    }
}

/// Start the watcher thread. One per process, from `setup()`.
#[cfg(windows)]
pub fn start(app: tauri::AppHandle) {
    use tauri::Emitter;
    std::thread::Builder::new()
        .name("wsl-watch".into())
        .spawn(move || {
            // the first look is the baseline, not an event: the window asks
            // get_wsl_state at mount, and a second wsl.exe from here would
            // say the same thing. transitions only
            let mut last = vm_is_up();
            loop {
                std::thread::sleep(TICK);
                let up = vm_is_up();
                if up == last {
                    continue;
                }
                // the memo is from before the transition either way
                super::wsl::forget_running();
                let distros = if up { names_after_boot() } else { Vec::new() };
                let _ = app.emit("devgo://wsl", WslState { up, distros });
                last = up;
            }
        })
        .expect("spawn wsl-watch thread");
}

/// No VM to watch; nothing to start.
#[cfg(not(windows))]
pub fn start(_app: tauri::AppHandle) {}

// the names, asked until the first one registers
#[cfg(windows)]
fn names_after_boot() -> Vec<String> {
    for attempt in 0..NAME_RETRIES {
        let names = super::wsl::refresh_running();
        if !names.is_empty() || attempt + 1 == NAME_RETRIES {
            return names;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    Vec::new()
}

/// Is `vmmemWSL` in the process table.
// toolhelp over raw imports, as win_taskbar in lib.rs: the windows crate
// is in the tree through tauri but not ours, and four functions do not
// earn a dependency
#[cfg(windows)]
pub fn vm_is_up() -> bool {
    use std::ffi::c_void;

    // PROCESSENTRY32W as kernel32 lays it out: 568 bytes on x64
    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32)
            -> *mut c_void;
        fn Process32FirstW(
            snapshot: *mut c_void,
            entry: *mut ProcessEntry32W,
        ) -> i32;
        fn Process32NextW(
            snapshot: *mut c_void,
            entry: *mut ProcessEntry32W,
        ) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const INVALID_HANDLE_VALUE: *mut c_void = -1isize as *mut c_void;

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        // no snapshot, no answer; down is the one that never makes devgo
        // do anything with wsl
        return false;
    }

    let mut entry = ProcessEntry32W {
        dw_size: std::mem::size_of::<ProcessEntry32W>() as u32,
        cnt_usage: 0,
        th32_process_id: 0,
        th32_default_heap_id: 0,
        th32_module_id: 0,
        cnt_threads: 0,
        th32_parent_process_id: 0,
        pc_pri_class_base: 0,
        dw_flags: 0,
        sz_exe_file: [0; 260],
    };

    let mut found = false;
    let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) };
    while ok != 0 {
        if is_vm_name(&entry.sz_exe_file) {
            found = true;
            break;
        }
        ok = unsafe { Process32NextW(snapshot, &mut entry) };
    }
    unsafe {
        CloseHandle(snapshot);
    }
    found
}

/// No VM to look for.
#[cfg(not(windows))]
pub fn vm_is_up() -> bool {
    false
}

// the name test on a nul-terminated utf-16 buffer, apart from the snapshot
// so it tests without one. case-insensitive: nothing says a future build
// keeps the capitals. off windows only the tests reach it
#[cfg_attr(not(windows), allow(dead_code))]
fn is_vm_name(exe_file: &[u16]) -> bool {
    let len = exe_file
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(exe_file.len());
    String::from_utf16_lossy(&exe_file[..len]).eq_ignore_ascii_case("vmmemWSL")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wide(s: &str) -> Vec<u16> {
        let mut v: Vec<u16> = s.encode_utf16().collect();
        v.push(0);
        v.resize(260, 0);
        v
    }

    #[test]
    fn the_vm_is_vmmemwsl_in_any_case() {
        assert!(is_vm_name(&wide("vmmemWSL")));
        assert!(is_vm_name(&wide("VMMEMWSL")));
        assert!(is_vm_name(&wide("vmmemwsl")));
    }

    // the generic hyper-v name is every other vm's
    #[test]
    fn plain_vmmem_is_not_wsl() {
        assert!(!is_vm_name(&wide("Vmmem")));
        assert!(!is_vm_name(&wide("vmmem")));
        assert!(!is_vm_name(&wide("vmmemWSL.exe")));
        assert!(!is_vm_name(&wide("wslservice.exe")));
        assert!(!is_vm_name(&wide("")));
    }

    // every one of the 260 slots used: still terminates, compares whole
    #[test]
    fn unterminated_buffer_is_read_whole() {
        let v = vec![b'a' as u16; 260];
        assert!(!is_vm_name(&v));
    }

    // a wrong size makes Process32FirstW fail with ERROR_INVALID_PARAMETER
    // and the light never comes on, silently: a failed first call is down
    #[cfg(all(windows, target_pointer_width = "64"))]
    #[test]
    fn process_entry_is_568_bytes_on_x64() {
        // same shape as inside vm_is_up, which keeps it local on purpose
        #[repr(C)]
        struct ProcessEntry32W {
            _a: u32,
            _b: u32,
            _c: u32,
            _d: usize,
            _e: u32,
            _f: u32,
            _g: u32,
            _h: i32,
            _i: u32,
            _j: [u16; 260],
        }
        assert_eq!(std::mem::size_of::<ProcessEntry32W>(), 568);
    }

    // the probe against the machine: vm_is_up must agree with tasklist.
    // ignored because it depends on whether wsl happens to be up; run by
    // hand with cargo test -- --ignored vm_probe
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn vm_probe_agrees_with_tasklist() {
        use crate::services::platform::Quiet;
        let out = std::process::Command::new("tasklist")
            .quiet()
            .output()
            .expect("tasklist runs");
        let listed = String::from_utf8_lossy(&out.stdout)
            .lines()
            .any(|l| l.to_ascii_lowercase().starts_with("vmmemwsl"));
        assert_eq!(
            vm_is_up(),
            listed,
            "tasklist says vmmemWSL listed = {listed}"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn off_windows_the_vm_is_never_up() {
        assert!(!vm_is_up());
        assert_eq!(
            current(),
            WslState {
                up: false,
                distros: vec![]
            }
        );
    }
}
