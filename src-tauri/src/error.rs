use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Internal lock poisoned: {0}")]
    Lock(String),

    #[error("Could not determine which WSL distro to use for {0}. Check that WSL is installed and has at least one distro registered.")]
    NoWslDistro(String),

    #[error("Failed to launch: {0}")]
    LaunchFailed(String),

    #[error("No browsable remote for {0}")]
    NoRemote(String),

    /// Carries an already-phrased message: the distinction between "timed out"
    /// and "returned but still running" is the useful part, and only the caller
    /// knows which it was.
    #[error("{0}")]
    WslStopFailed(String),
}

// std::io::Error and serde_json::Error don't implement Serialize, so we can't
// derive Serialize on the enum. Tauri only needs the error as a string on the
// frontend, so we serialize via the Display impl that thiserror generated.
impl Serialize for AppError {
    fn serialize<S: Serializer>(
        &self,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
