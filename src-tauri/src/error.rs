use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Invalid(String),
    #[error("WebDAV is not configured yet — add a server URL in Settings")]
    NotConfigured,
    #[error("WebDAV request failed: {0}")]
    Http(String),
    #[error("{0}")]
    Server(String),
    #[error("could not read or write local data: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not parse stored data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::Http(err.to_string())
    }
}

// Commands return the message as a plain string so the UI can show it directly.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
