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
            lw_fs::FsError::FileTooLarge { .. } => (
                StatusCode::PAYLOAD_TOO_LARGE,
                Self::new(err.error_code(), err.to_string()),
            ),
            lw_fs::FsError::Io(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Self::new("FS_IO_ERROR", e.to_string()),
            ),
        }
    }
}

#[derive(Debug)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    #[test]
    fn api_error_new() {
        let err = ApiError::new("CODE", "message");
        assert_eq!(err.code, "CODE");
        assert_eq!(err.message, "message");
        assert!(!err.retryable);
        assert!(err.details.is_none());
    }

    #[test]
    fn api_error_retryable() {
        let err = ApiError::new("CODE", "msg").retryable();
        assert!(err.retryable);
    }

    #[test]
    fn api_error_unauthorized() {
        let err = ApiError::unauthorized();
        assert_eq!(err.code, "UNAUTHORIZED");
    }

    #[test]
    fn api_error_invalid_token() {
        let err = ApiError::invalid_token();
        assert_eq!(err.code, "INVALID_TOKEN");
    }

    #[test]
    fn api_error_token_already_used() {
        let err = ApiError::token_already_used();
        assert_eq!(err.code, "TOKEN_ALREADY_USED");
    }

    #[test]
    fn api_error_not_found() {
        let err = ApiError::not_found("Widget");
        assert_eq!(err.code, "NOT_FOUND");
        assert!(err.message.contains("Widget"));
    }

    #[test]
    fn api_error_internal() {
        let err = ApiError::internal("boom");
        assert_eq!(err.code, "INTERNAL_ERROR");
        assert!(err.retryable);
    }

    #[test]
    fn api_error_json_serialization() {
        let err = ApiError::new("TEST", "test message");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "TEST");
        assert_eq!(json["message"], "test message");
        assert_eq!(json["retryable"], false);
    }

    #[test]
    fn fs_error_path_traversal() {
        let fs_err = lw_fs::FsError::PathTraversal;
        let (status, _) = ApiError::fs_error(&fs_err);
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn fs_error_symlink_escape() {
        let fs_err = lw_fs::FsError::SymlinkEscape;
        let (status, _) = ApiError::fs_error(&fs_err);
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn fs_error_workspace_not_registered() {
        let fs_err = lw_fs::FsError::WorkspaceNotRegistered(uuid::Uuid::nil());
        let (status, _) = ApiError::fs_error(&fs_err);
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[test]
    fn fs_error_io() {
        let fs_err = lw_fs::FsError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "gone"));
        let (status, _) = ApiError::fs_error(&fs_err);
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn api_error_response_into_response() {
        let resp = ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new("BAD", "bad request"),
        };
        let response = resp.into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn api_error_response_from_tuple() {
        let resp = ApiErrorResponse::from((StatusCode::NOT_FOUND, ApiError::not_found("Item")));
        assert_eq!(resp.status, StatusCode::NOT_FOUND);
    }

    #[test]
    fn fs_error_file_too_large_maps_to_payload_too_large() {
        let err = lw_fs::FsError::FileTooLarge {
            size: 200,
            max: 100,
        };
        let (status, api_err) = ApiError::fs_error(&err);
        assert_eq!(status, axum::http::StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(api_err.code, "FS_FILE_TOO_LARGE");
        assert!(api_err.message.contains("200"));
    }

    #[test]
    fn fs_error_io_maps_to_internal_server_error() {
        let err = lw_fs::FsError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "denied",
        ));
        let (status, api_err) = ApiError::fs_error(&err);
        assert_eq!(status, axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(api_err.code, "FS_IO_ERROR");
        assert!(api_err.message.contains("denied"));
    }
}
