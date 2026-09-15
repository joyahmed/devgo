use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
#[allow(dead_code)]

pub enum AppError {
    #[error("IO error: {0}")]
    IO(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
// std::io::Error and serde_json::Error don't implement Serialize, so we can't
// derive Serialize on the enum. Tauri only needs the error as a string on the
// frontend, so we serialize via the Display impl that thiserror generated.
impl Serialize for AppError {
    fn serialize<S: Serializer>(
        &self,
        Serializer: S,
    ) -> Result<S::OK, S::Error> {
        Serializer.serialize_str(&self.to_string())
    }
}
