mod history;
pub mod manager;
mod platform;
mod reader;
pub mod session;

pub use manager::PtyManager;
pub use session::PtySession;

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("Session not found: {0}")]
    SessionNotFound(uuid::Uuid),
    #[error("Session already stopped: {0}")]
    SessionAlreadyStopped(uuid::Uuid),
    #[error("PTY error: {0}")]
    Pty(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pty_error_session_not_found_display() {
        let id = uuid::Uuid::nil();
        let err = PtyError::SessionNotFound(id);
        assert_eq!(err.to_string(), format!("Session not found: {id}"));
    }

    #[test]
    fn pty_error_session_already_stopped_display() {
        let id = uuid::Uuid::nil();
        let err = PtyError::SessionAlreadyStopped(id);
        assert_eq!(err.to_string(), format!("Session already stopped: {id}"));
    }

    #[test]
    fn pty_error_pty_display() {
        let err = PtyError::Pty("fd allocation failed".to_string());
        assert_eq!(err.to_string(), "PTY error: fd allocation failed");
    }

    #[test]
    fn pty_error_io_display() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let err = PtyError::from(io_err);
        assert!(err.to_string().starts_with("IO error:"));
        assert!(err.to_string().contains("file missing"));
    }
}
