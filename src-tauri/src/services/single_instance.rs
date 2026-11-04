use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use super::launch_args::{Handoff, MAX_HANDOFF};
use super::runtime_log::{self, log_line};

/// Take the lock, or hand `handoff` to the instance that holds it.
///
/// The lock itself is unchanged since chapter 07: `instance.lock` holds the
/// port, `create_new` decides who serves, a stale lock is removed and taken.
/// What changed is the message: it was always the word `restore`, and now a
/// second launch with a folder on its command line sends `open {json}`
/// instead (see `launch_args::Handoff`).
pub fn try_acquire(
    lock_file: PathBuf,
    handoff: &Handoff,
) -> Result<(TcpListener, PathBuf), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get port: {e}"))?
        .port();

    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_file)
    {
        Ok(mut file) => {
            write!(file, "{port}")
                .map_err(|e| format!("Failed to write lock file: {e}"))?;
            Ok((listener, lock_file))
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            drop(listener);
            if let Ok(port_str) = fs::read_to_string(&lock_file) {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    // a stale lock (the last DevGo was killed, not quit)
                    // names a port nobody listens on, and a plain connect
                    // sat in the stack's timeout on every start after one.
                    // a live instance answers on loopback in far less
                    let addr =
                        std::net::SocketAddr::from(([127, 0, 0, 1], port));
                    if let Ok(mut stream) = TcpStream::connect_timeout(
                        &addr,
                        std::time::Duration::from_millis(200),
                    ) {
                        let _ = stream.write_all(&handoff.encode());
                        // the end of the message: the listener reads to
                        // EOF now, not one fixed-size read
                        let _ = stream.shutdown(std::net::Shutdown::Write);
                        // the handoff, from the side that gives up. the
                        // running instance logs the other half when it
                        // reads the word, so a log with one half and not
                        // the other says which end broke
                        runtime_log::append(&format!(
                            "[DevGo] single instance: handed off to the instance on port {port}"
                        ));
                        return Err(
                            "Another instance is already running".into()
                        );
                    }
                }
            }
            let _ = fs::remove_file(&lock_file);
            try_acquire(lock_file, handoff)
        }
        Err(e) => {
            drop(listener);
            Err(format!("Failed to create lock file: {e}"))
        }
    }
}

/// The whole message one connection sent, to EOF, capped at `MAX_HANDOFF`.
/// A peer that sends nothing and never closes is cut off by the timeout, so
/// one stuck connection cannot hold the listener's only thread.
fn read_handoff(stream: &mut TcpStream) -> Option<Handoff> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = Vec::new();
    let _ = Read::take(&mut *stream, MAX_HANDOFF as u64).read_to_end(&mut buf);
    Handoff::decode(&buf)
}

pub fn start_restore_listener(
    listener: TcpListener,
    on_handoff: impl Fn(Handoff) + Send + 'static,
) {
    thread::spawn(move || loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                if let Some(h) = read_handoff(&mut stream) {
                    runtime_log::append(match h {
                        Handoff::Restore => "[DevGo] single instance: a second launch asked for the window",
                        Handoff::Open(_) => "[DevGo] single instance: a second launch asked for the window and a folder",
                    });
                    on_handoff(h);
                }
            }
            Err(e) => {
                log_line!(
                    "[DevGo] instance listener error: {e}, shutting down listener"
                );
                break;
            }
        }
    });
}

pub fn release_lock(lock_file: &PathBuf) {
    let _ = fs::remove_file(lock_file);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::launch_args::OpenRequest;
    use std::sync::mpsc;

    fn lock_in(name: &str) -> PathBuf {
        let d = std::env::temp_dir()
            .join(format!("devgo-lock-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d.join("instance.lock")
    }

    /// a served lock and a channel that receives every handoff it is sent
    fn serve(lock: &PathBuf) -> mpsc::Receiver<Handoff> {
        let (listener, path) =
            try_acquire(lock.clone(), &Handoff::Restore).unwrap();
        assert_eq!(&path, lock);
        let (tx, rx) = mpsc::channel();
        start_restore_listener(listener, move |h| {
            let _ = tx.send(h);
        });
        rx
    }

    #[test]
    fn the_first_launch_takes_the_lock_and_writes_its_port() {
        let lock = lock_in("first");
        let (listener, _) =
            try_acquire(lock.clone(), &Handoff::Restore).unwrap();
        let port: u16 = fs::read_to_string(&lock).unwrap().parse().unwrap();
        assert_eq!(port, listener.local_addr().unwrap().port());
        release_lock(&lock);
        assert!(!lock.exists());
    }

    #[test]
    fn a_second_launch_hands_restore_over_and_does_not_serve() {
        let lock = lock_in("restore");
        let rx = serve(&lock);
        assert!(try_acquire(lock.clone(), &Handoff::Restore).is_err());
        let got = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(got, Handoff::Restore);
        // the lock still names the first instance
        assert!(lock.exists());
        release_lock(&lock);
    }

    #[test]
    fn a_second_launch_carries_its_folder_to_the_first() {
        let lock = lock_in("open");
        let rx = serve(&lock);
        let req = OpenRequest {
            path: "/home/alex/projects/devgo".into(),
            error: None,
        };
        assert!(try_acquire(lock.clone(), &Handoff::Open(req.clone())).is_err());
        let got = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(got, Handoff::Open(req));
        release_lock(&lock);
    }

    #[test]
    fn the_listener_still_takes_the_bare_word_an_older_devgo_sends() {
        let lock = lock_in("old");
        let rx = serve(&lock);
        let port: u16 = fs::read_to_string(&lock).unwrap().parse().unwrap();
        // the pre-payload writer: one write, then the socket is dropped
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(b"restore").unwrap();
        drop(s);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            Handoff::Restore
        );
        release_lock(&lock);
    }

    #[test]
    fn a_stray_connection_raises_nothing() {
        let lock = lock_in("stray");
        let rx = serve(&lock);
        let port: u16 = fs::read_to_string(&lock).unwrap().parse().unwrap();
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(b"hello").unwrap();
        drop(s);
        assert!(rx.recv_timeout(Duration::from_millis(500)).is_err());
        release_lock(&lock);
    }

    #[test]
    fn a_released_lock_is_taken_by_the_next_launch() {
        let lock = lock_in("released");
        let (first, _) = try_acquire(lock.clone(), &Handoff::Restore).unwrap();
        release_lock(&lock);
        drop(first);
        let (next, _) = try_acquire(lock.clone(), &Handoff::Restore).unwrap();
        let port: u16 = fs::read_to_string(&lock).unwrap().parse().unwrap();
        assert_eq!(port, next.local_addr().unwrap().port());
        release_lock(&lock);
    }

    #[test]
    fn a_stale_lock_from_a_killed_instance_is_taken_over() {
        let lock = lock_in("stale");
        // a port that was listened on and no longer is
        let dead = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = dead.local_addr().unwrap().port();
        drop(dead);
        fs::write(&lock, port.to_string()).unwrap();
        let req = OpenRequest {
            path: "/home/alex/x".into(),
            error: None,
        };
        let (listener, _) =
            try_acquire(lock.clone(), &Handoff::Open(req)).unwrap();
        let now: u16 = fs::read_to_string(&lock).unwrap().parse().unwrap();
        assert_eq!(now, listener.local_addr().unwrap().port());
        release_lock(&lock);
    }
}
