use serde::{Deserialize, Serialize};

// macos goes over the wire as "macos": rename_all folds the camel case
// flat, so the rust spelling and the string the frontend matches differ
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Runtime {
    Windows,
    Wsl,
    MacOs,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_lowercase_names() {
        assert_eq!(
            serde_json::to_string(&Runtime::Windows).unwrap(),
            "\"windows\""
        );
        assert_eq!(serde_json::to_string(&Runtime::Wsl).unwrap(), "\"wsl\"");
        assert_eq!(
            serde_json::to_string(&Runtime::MacOs).unwrap(),
            "\"macos\""
        );
    }
}
