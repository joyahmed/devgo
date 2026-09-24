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

    /// The executable is there — it is just not a program: a folder, or a
    /// file with no execute bit. "not installed" of a path the user can
    /// see in their file manager sends them looking for an install they
    /// already have.
    #[error("{0} is there, but it is not a program DevGo can run — a folder, or a file with no execute permission. Point the executable at the program itself")]
    TargetNotRunnable(String),

    /// The project's folder is gone. The list outlives the directory, and
    /// nothing downstream looks, so the terminal opened in the home
    /// directory and said nothing.
    #[error("{0} is no longer at {1} — it was moved or deleted. Refresh to update the list")]
    ProjectMissing(String, String),

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

    /// An executable given as a full path with no program at it: a typo, a
    /// folder, a move. Caught when the target is added, because a full path
    /// is the shape a file manager is registered with — no installer puts
    /// one on PATH — and "not installed, or not on PATH" of a path the user
    /// just typed sends them looking for an install they already have.
    #[error("{0} is not there, or is not a program — check the path, or pick the executable with Browse")]
    TargetPathMissing(String),

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
    #[error("{0}")]
    SetupRefused(String),

    #[error("No such action: {0}")]
    ActionNotFound(String),

    /// Traffic GitHub will not show us: the repository is not ours.
    /// Phrased for the toast
    #[error("{0}")]
    TrafficRefused(String),

    /// An attach that cannot happen: the box's tmux is off, the pane is
    /// gone. Phrased for the toast
    #[error("{0}")]
    AttachRefused(String),

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

    /// An empty args template and no WSL form either: the row has no way
    /// of opening anything. TargetWslOnly used to answer for this too,
    /// and told a linux user their kitty runs inside WSL.
    #[error("{0} has no arguments template, so it cannot open {1}. Give it one in Settings")]
    TargetHasNoLine(String, String),

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
