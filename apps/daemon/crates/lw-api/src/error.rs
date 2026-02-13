use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub details: Option<serde_json::Value>,
    pub retryable: bool,
}

impl ApiError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
            retryable: false,
        }
    }

    pub fn retryable(mut self) -> Self {
        self.retryable = true;
        self
    }

    pub fn unauthorized() -> Self {
        Self::new("UNAUTHORIZED", "Authentication required")
    }

    pub fn invalid_token() -> Self {
        Self::new("INVALID_TOKEN", "Invalid or expired token")
    }

    pub fn token_already_used() -> Self {
        Self::new(
            "TOKEN_ALREADY_USED",
            "Bootstrap token has already been used",
        )
    }

    pub fn not_found(resource: &str) -> Self {
        Self::new("NOT_FOUND", format!("{} not found", resource))
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("INTERNAL_ERROR", message).retryable()
    }

    pub fn fs_error(err: &lw_fs::FsError) -> (StatusCode, Self) {
        match err {
            lw_fs::FsError::PathTraversal => (
                StatusCode::FORBIDDEN,
                Self::new(err.error_code(), err.to_string()),
            ),
            lw_fs::FsError::SymlinkEscape => (
                StatusCode::FORBIDDEN,
                Self::new(err.error_code(), err.to_string()),
            ),
            lw_fs::FsError::WorkspaceNotRegistered(_) => (
                StatusCode::NOT_FOUND,
                Self::new(err.error_code(), err.to_string()),
            ),
            lw_fs::FsError::Io(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Self::new("FS_IO_ERROR", e.to_string()),
            ),
        }
    }
}

pub struct ApiErrorResponse {
    pub status: StatusCode,
    pub error: ApiError,
}

impl IntoResponse for ApiErrorResponse {
    fn into_response(self) -> Response {
        let body = serde_json::to_string(&self.error).unwrap_or_default();
        (self.status, [("content-type", "application/json")], body).into_response()
    }
}

impl From<(StatusCode, ApiError)> for ApiErrorResponse {
    fn from((status, error): (StatusCode, ApiError)) -> Self {
        Self { status, error }
    }
}
