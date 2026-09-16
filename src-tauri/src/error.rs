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

    /// gh could not answer: not installed, not logged in, or it failed.
    /// Carries the fix (winget install GitHub.cli, gh auth login) or gh's
    /// own stderr, never an empty repo list that looks like "no repos".
    #[error("{0}")]
    GhUnavailable(String),

    /// A url the browser should not be handed. Only https:// reaches
    /// start, and only from the two places that build one.
    #[error("Refusing to open {0}: not an https url")]
    BadUrl(String),

    /// A clone that must not start: the destination exists, the distro is
    /// stopped, the name is a path. Phrased for the row that asked.
    #[error("{0}")]
    CloneRefused(String),

    /// A group edit that must not happen: an empty or duplicate name, an
    /// order that is not a permutation. Phrased for the dialog that asked.
    #[error("{0}")]
    GroupRefused(String),

    /// Carries an already-phrased message: the distinction between "timed out"
    /// and "returned but still running" is the useful part, and only the caller
    /// knows which it was.
    #[error("{0}")]
    WslStopFailed(String),

    #[error("A target with id {0} already exists")]
    TargetExists(String),

    #[error("No such editor or terminal: {0}")]
    TargetNotFound(String),

    #[error("No such server: {0}")]
    ServerNotFound(String),

    /// A root that cannot be added: empty. Phrased for the box that asked.
    #[error("{0}")]
    RootRefused(String),

    /// An action that cannot run: no contract, nothing to fill a word
    /// with, a local line with a shell character. Phrased for the toast.
    #[error("{0}")]
    ActionRefused(String),

    #[error("No such action: {0}")]
    ActionNotFound(String),

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

    #[error("{0} has no session form, so it cannot hold a psmux session")]
    TargetCannotHost(String),

    #[error("{0} is not running. DevGo never boots a distro for a terminal; start it first")]
    WslNotRunning(String),

    #[error("Could not bind {0}: {1}")]
    HotkeyFailed(String, String),

    #[error("Workspace {0} no longer exists — the list has {1} entries. Refresh and try again")]
    WorkspaceIndexOutOfRange(usize, usize),

    // not a permutation of the stored list; obeying it would drop whatever
    // the client did not know about
    #[error("The order sent does not match the stored list ({0} sent, {1} stored). Refresh and try again")]
    WorkspaceOrderMismatch(usize, usize),

    // a refresh asked for one workspace the store no longer lists
    #[error("{0} is no longer in the list")]
    WorkspaceNotFound(String),

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
