pub mod detect;
pub mod frecency;
pub mod git;
pub mod launcher;
pub mod platform;
pub mod preferences;
pub mod project_cache;
pub mod scanner;
pub mod single_instance;
pub mod target_store;
pub mod workspace;

pub use preferences::PreferencesStore;
pub use project_cache::ProjectCacheStore;
pub use scanner::scan_workspace;
pub use target_store::TargetStore;
pub use workspace::WorkspaceStore;
