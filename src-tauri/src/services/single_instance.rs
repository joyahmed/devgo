use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::thread;

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
                    if let Ok(mut stream) =
                        TcpStream::connect(format!("127.0.0.1:{port}"))
                    {
                        let _ = stream.write_all(b"restore");
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
                        on_restore();
                    }
                }
            }
            Err(e) => {
                eprintln!(
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
