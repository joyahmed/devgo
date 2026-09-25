use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::thread;

use super::runtime_log::{self, log_line};

pub fn try_acquire(
    lock_file: PathBuf,
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
                        let _ = stream.write_all(b"restore");
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
            try_acquire(lock_file)
        }
        Err(e) => {
            drop(listener);
            Err(format!("Failed to create lock file: {e}"))
        }
    }
}

pub fn start_restore_listener(
    listener: TcpListener,
    on_restore: impl Fn() + Send + 'static,
) {
    thread::spawn(move || loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 16];
                if let Ok(n) = stream.read(&mut buf) {
                    if &buf[..n] == b"restore" {
                        runtime_log::append(
                            "[DevGo] single instance: a second launch asked for the window",
                        );
                        on_restore();
                    }
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
