pub mod manager;
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
