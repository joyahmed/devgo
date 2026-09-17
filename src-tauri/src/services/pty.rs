//! The attach view's other half: a pseudo-terminal whose child is a
//! multiplexer client. The session itself lives in a server (psmux on
//! this pc, tmux in a distro, tmux on a box); what runs here is `attach`,
//! so ending the child detaches and never kills. The bytes the child
//! prints stream to the pane through a channel; what the user types
//! comes back as writes. Nothing here is a shell of its own.

use std::collections::HashMap;
use std::io::{Read, Write};

use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize,
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::Project;
use crate::services::launcher::tmux_session_name;
use crate::services::platform::wsl;
use crate::services::scanner::{distro_of, LOCAL_FS};
use crate::services::servers::Server;
use crate::services::sessions::LOCAL_MUX;

/// What the pane attaches to: a project's session, or a server's.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AttachTarget {
    Project { project: Project },
    Server { id: String },
}

/// The line the pane runs: the multiplexer client for one session.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AttachLine {
    pub exe: String,
    pub args: Vec<String>,
    pub session: String,
    /// where the session lives, for the pane's header
    pub place: String,
}

impl AttachLine {
    pub fn display(&self) -> String {
        std::iter::once(self.exe.as_str())
            .chain(self.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

// = is an exact target, the rule from chapter 26
fn exact(session: &str) -> String {
    format!("={session}")
}

/// A project's session: psmux on windows, tmux on a mac, tmux inside the
/// project's distro. A stopped distro is a refusal, never a boot.
pub fn project_line(
    project: &Project,
    running: &[String],
) -> Result<AttachLine, AppError> {
    let session = tmux_session_name(project);
    match distro_of(&project.full_path) {
        Some(distro) => {
            if !wsl::is_running(&distro, running) {
                return Err(AppError::WslNotRunning(distro));
            }
            Ok(AttachLine {
                exe: "wsl".into(),
                args: vec![
                    "-d".into(),
                    distro.clone(),
                    "-e".into(),
                    "tmux".into(),
                    "attach".into(),
                    "-t".into(),
                    exact(&session),
                ],
                session,
                place: format!("tmux in {distro}"),
            })
        }
        None => Ok(AttachLine {
            exe: LOCAL_MUX.into(),
            args: vec!["attach".into(), "-t".into(), exact(&session)],
            session,
            place: format!(
                "{} on {LOCAL_FS}",
                LOCAL_MUX.trim_end_matches(".exe")
            ),
        }),
    }
}

/// A server's session over ssh: the same attach-or-create line the
/// terminal runs, so the pane and a tab land in one session. A row whose
/// tmux flag is off has no session to attach to.
pub fn server_line(server: &Server) -> Result<AttachLine, AppError> {
    if !server.tmux {
        return Err(AppError::AttachRefused(format!(
            "tmux on the box is off for {}. The attach view attaches a tmux session there; turn it on first",
            server.name
        )));
    }
    let session = server
        .session
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("devgo")
        .to_string();
    let mut args = vec!["-t".to_string()];
    // the target words as ssh_target spells them, the key path bare: this
    // is a spawn, not a line typed into a shell
    args.extend(
        server
            .ssh_target()
            .iter()
            .map(|a| a.trim_matches('"').to_string()),
    );
    args.extend(
        ["tmux", "new-session", "-A", "-s", &session].map(String::from),
    );
    Ok(AttachLine {
        exe: "ssh".into(),
        args,
        session,
        place: format!("tmux on {}", server.name),
    })
}

// one open pane: the pty's master (resize), its writer (keys) and the
// child's killer (detach). the child itself is owned by the thread that
// waits on it
struct Pane {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Every open pane by id.
#[derive(Default)]
pub struct Registry {
    next: u64,
    panes: HashMap<String, Pane>,
}

fn no_pane(id: &str) -> AppError {
    AppError::AttachRefused(format!("attach pane {id} is gone"))
}

fn failed(e: impl std::fmt::Display) -> AppError {
    AppError::LaunchFailed(format!("pty: {e:#}"))
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

impl Registry {
    /// Spawn the line in a pty of the pane's size. `on_data` gets every
    /// chunk the child prints, from its own thread; `on_exit` fires once
    /// with the pane's id and the exit code, from another.
    pub fn open(
        &mut self,
        line: &AttachLine,
        cols: u16,
        rows: u16,
        on_data: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce(String, u32) + Send + 'static,
    ) -> Result<String, AppError> {
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(failed)?;
        let mut cmd = CommandBuilder::new(&line.exe);
        cmd.args(&line.args);
        cmd.env("TERM", "xterm-256color");
        let mut child = pair.slave.spawn_command(cmd).map_err(failed)?;
        // the slave is the child's end; ours is the master
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(failed)?;
        let writer = pair.master.take_writer().map_err(failed)?;
        let killer = child.clone_killer();

        self.next += 1;
        let id = format!("pty-{}", self.next);
        std::thread::Builder::new()
            .name(format!("{id}-read"))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => on_data(buf[..n].to_vec()),
                    }
                }
            })?;
        let exit_id = id.clone();
        std::thread::Builder::new()
            .name(format!("{id}-wait"))
            .spawn(move || {
                let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
                on_exit(exit_id, code);
            })?;
        self.panes.insert(
            id.clone(),
            Pane {
                master: pair.master,
                writer,
                killer,
            },
        );
        Ok(id)
    }

    pub fn write(&mut self, id: &str, data: &[u8]) -> Result<(), AppError> {
        let pane = self.panes.get_mut(id).ok_or_else(|| no_pane(id))?;
        pane.writer.write_all(data)?;
        pane.writer.flush()?;
        Ok(())
    }

    pub fn resize(
        &self,
        id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), AppError> {
        let pane = self.panes.get(id).ok_or_else(|| no_pane(id))?;
        pane.master.resize(size(cols, rows)).map_err(failed)
    }

    /// End the client: the session it was attached to stays. The pane is
    /// forgotten here; the wait thread still reports the exit.
    pub fn close(&mut self, id: &str) -> Result<(), AppError> {
        let mut pane = self.panes.remove(id).ok_or_else(|| no_pane(id))?;
        // a child that already ended is a detach that already happened
        let _ = pane.killer.kill();
        Ok(())
    }

    /// The exit path's half of close: nothing to kill.
    pub fn forget(&mut self, id: &str) {
        self.panes.remove(id);
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.panes.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, full_path: &str) -> Project {
        let fs = if full_path.starts_with("//wsl") {
            "WSL"
        } else {
            LOCAL_FS
        };
        Project::new(name.into(), full_path.into(), String::new(), fs.into())
    }

    fn server(tmux: bool, session: Option<&str>) -> Server {
        Server {
            id: "box".into(),
            name: "box".into(),
            alias: None,
            host: "203.0.113.7".into(),
            user: Some("user".into()),
            port: Some(2222),
            identity: Some("C:\\Users\\user\\.ssh\\id_ed25519".into()),
            default_path: None,
            tmux,
            session: session.map(String::from),
            tunnel: false,
            source: "manual".into(),
            roots: Vec::new(),
        }
    }

    #[test]
    fn a_local_project_attaches_through_the_platforms_multiplexer() {
        let p = project("app", "G:/dev/app");
        let line = project_line(&p, &[]).unwrap();
        let session = tmux_session_name(&p);
        assert_eq!(line.exe, LOCAL_MUX);
        assert_eq!(line.args, ["attach", "-t", &format!("={session}")]);
        assert_eq!(line.session, session);
        assert!(line.place.ends_with(LOCAL_FS), "{}", line.place);
        assert_eq!(line.display(), format!("{LOCAL_MUX} attach -t ={session}"));
    }

    #[test]
    fn a_wsl_project_attaches_inside_its_running_distro() {
        let p = project("app", "//wsl.localhost/Ubuntu/home/user/app");
        let line = project_line(&p, &["ubuntu".into()]).unwrap();
        assert_eq!(line.exe, "wsl");
        assert_eq!(
            line.args[..6],
            ["-d", "Ubuntu", "-e", "tmux", "attach", "-t"]
        );
        assert!(line.args[6].starts_with("=app-"), "{:?}", line.args);
        assert_eq!(line.place, "tmux in Ubuntu");
    }

    #[test]
    fn a_stopped_distro_is_refused_not_booted() {
        let p = project("app", "//wsl.localhost/Ubuntu/home/user/app");
        match project_line(&p, &[]) {
            Err(AppError::WslNotRunning(d)) => assert_eq!(d, "Ubuntu"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_server_attaches_or_creates_its_session_with_the_key_bare() {
        let line = server_line(&server(true, None)).unwrap();
        assert_eq!(line.exe, "ssh");
        assert_eq!(
            line.args,
            [
                "-t",
                "-p",
                "2222",
                "-i",
                "C:\\Users\\user\\.ssh\\id_ed25519",
                "user@203.0.113.7",
                "tmux",
                "new-session",
                "-A",
                "-s",
                "devgo"
            ]
        );
        assert_eq!(line.session, "devgo");
        assert_eq!(line.place, "tmux on box");
        let named = server_line(&server(true, Some("work"))).unwrap();
        assert_eq!(named.args.last().unwrap(), "work");
    }

    #[test]
    fn a_server_with_tmux_off_has_nothing_to_attach() {
        match server_line(&server(false, None)) {
            Err(AppError::AttachRefused(m)) => {
                assert!(m.contains("box"), "{m}")
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_unknown_pane_is_refused_everywhere() {
        let mut reg = Registry::default();
        assert!(reg.write("pty-9", b"x").is_err());
        assert!(reg.resize("pty-9", 80, 24).is_err());
        assert!(reg.close("pty-9").is_err());
        reg.forget("pty-9");
        assert_eq!(reg.len(), 0);
    }

    // a real pty, a program that does not exist: the spawn fails, no
    // thread starts, and the registry holds nothing
    #[test]
    fn a_missing_program_is_a_launch_failure_and_leaves_no_pane() {
        let mut reg = Registry::default();
        let line = AttachLine {
            exe: "devgo-no-such-program-75".into(),
            args: vec!["attach".into()],
            session: "x".into(),
            place: "nowhere".into(),
        };
        let result = reg.open(&line, 80, 24, |_| {}, |_, _| {});
        assert!(
            matches!(result, Err(AppError::LaunchFailed(_))),
            "{result:?}"
        );
        assert_eq!(reg.len(), 0);
    }
}
