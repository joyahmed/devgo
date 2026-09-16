pub mod detection;
pub mod paths;
pub mod runtime;
pub mod wsl;
pub mod wsl_watch;

pub use detection::RuntimeInfo;

use std::ffi::OsStr;
use std::process::Command;

// the windows-only half of Command, behind one seam. twelve files used to
// import std::os::windows::process::CommandExt for creation_flags at
// seventeen sites and raw_arg at two, and that import is why the crate
// did not compile for the mac. not a cfg per call site: that is twenty
// places to forget. one trait, two methods, the cfg inside
pub trait Quiet {
    // no console window for the child. on windows a spawned console
    // program otherwise flashes a black window over the app; elsewhere
    // there is no such window and this is a no-op
    fn quiet(&mut self) -> &mut Self;

    // one argument handed to the os verbatim. arg re-quotes anything with
    // a space, which turns --folder-uri vscode-remote://… into one quoted
    // argument and breaks it; raw_arg passes the line through and the
    // target's own template decides the split. every caller today is a
    // cmd /c line, which means nothing off windows: there this is a plain
    // arg, so the crate compiles, and the mac gets its own doors later
    fn shell_line(&mut self, line: impl AsRef<OsStr>) -> &mut Self;
}

impl Quiet for Command {
    fn quiet(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }

    fn shell_line(&mut self, line: impl AsRef<OsStr>) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.raw_arg(line)
        }
        #[cfg(not(windows))]
        {
            self.arg(line)
        }
    }
}
