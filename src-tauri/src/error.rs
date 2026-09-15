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

    #[error("{0} is not installed, or not on PATH. Detect editors in Settings, or fix the executable")]
    TargetNotInstalled(String),

    #[error("Failed to launch: {0}")]
    LaunchFailed(String),

    #[error("No browsable remote for {0}")]
    NoRemote(String),

    /// Carries an already-phrased message: the distinction between "timed out"
    /// and "returned but still running" is the useful part, and only the caller
    /// knows which it was.
    #[error("{0}")]
    WslStopFailed(String),

    #[error("A target with id {0} already exists")]
    TargetExists(String),

    #[error("No such editor or terminal: {0}")]
    TargetNotFound(String),

    #[error(
        "{0} is the only one of its kind — add another before removing it"
    )]
    LastTarget(String),

    #[error(
        "{0} has no WSL configuration, so it cannot open the WSL project {1}"
    )]
    TargetCannotOpenWsl(String, String),

    #[error("{0} runs inside WSL, so it cannot open the Windows project {1}")]
    TargetWslOnly(String, String),

    #[error("{0} has no run template, so it cannot run a command")]
    TargetCannotRun(String),

    #[error("Could not bind {0}: {1}")]
    HotkeyFailed(String, String),

    #[error("Workspace {0} no longer exists — the list has {1} entries. Refresh and try again")]
    WorkspaceIndexOutOfRange(usize, usize),

    // not a permutation of the stored list; obeying it would drop whatever
    // the client did not know about
    #[error("The order sent does not match the stored list ({0} sent, {1} stored). Refresh and try again")]
    WorkspaceOrderMismatch(usize, usize),

    #[error("{0} overlaps the workspace {1}. Nested workspaces scan the same folders twice, so remove one before adding the other")]
    WorkspaceOverlaps(String, String),
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
