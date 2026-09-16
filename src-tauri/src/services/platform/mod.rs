pub mod detection;
pub mod login_path;
pub mod paths;
pub mod runtime;
pub mod wsl;
pub mod wsl_watch;

pub use detection::RuntimeInfo;
// off windows every spawn reaches these through quiet(); on windows the
// process PATH is already the user's and nothing calls them
#[cfg_attr(windows, allow(unused_imports))]
pub use login_path::{login_path, with_login_path};

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
    // there is no such window, and instead the child gets the login-shell
    // PATH. same seam, opposite direction: on windows the app inherits the
    // user's environment and must hide a window; on a mac it inherits
    // launchd's bare PATH and must be handed the user's. done here because
    // every spawn in the crate already calls this: a first cut wired only
    // the launcher and the editor probe, and gh, git, ssh and tmux were
    // still spawned with no /opt/homebrew/bin in reach
    fn quiet(&mut self) -> &mut Self;

    // one argument handed to the os verbatim. arg re-quotes anything with
    // a space, which turns --folder-uri vscode-remote://… into one quoted
    // argument and breaks it; raw_arg passes the line through and the
    // target's own template decides the split. every caller is a cmd /c
    // line, which means nothing off windows: there this is a plain arg,
    // so the crate compiles, and since the launcher has its own sh -c
    // door nothing off windows calls it at all, hence the allow
    #[cfg_attr(not(windows), allow(dead_code))]
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
        #[cfg(not(windows))]
        {
            login_path::with_login_path(self);
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

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    // the seam every spawn already passes through: gh, git, ssh and tmux
    // never call with_login_path themselves, they call quiet(), and that
    // is where a dock-launched devgo hands them the PATH with homebrew in it
    #[test]
    fn quiet_hands_a_child_the_login_path() {
        let out = Command::new("/bin/sh")
            .quiet()
            .args(["-c", "printf %s \"$PATH\""])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout), login_path());
    }
}
