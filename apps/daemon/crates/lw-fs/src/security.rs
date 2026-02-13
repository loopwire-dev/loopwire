use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("Path traversal attempt detected")]
    PathTraversal,
    #[error("Symlink escapes workspace boundary")]
    SymlinkEscape,
    #[error("Workspace not registered: {0}")]
    WorkspaceNotRegistered(Uuid),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl FsError {
    pub fn error_code(&self) -> &'static str {
        match self {
            FsError::PathTraversal => "WORKSPACE_PATH_TRAVERSAL",
            FsError::SymlinkEscape => "WORKSPACE_SYMLINK_ESCAPE",
            FsError::WorkspaceNotRegistered(_) => "WORKSPACE_NOT_REGISTERED",
            FsError::Io(_) => "FS_IO_ERROR",
        }
    }
}

#[derive(Debug, Clone)]
pub struct WorkspaceRegistry {
    workspaces: Arc<RwLock<HashMap<Uuid, PathBuf>>>,
}

impl WorkspaceRegistry {
    pub fn new() -> Self {
        Self {
            workspaces: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register(&self, workspace_id: Uuid, path: PathBuf) -> Result<(), FsError> {
        let original = path.clone();
        let canonical = timeout(
            Duration::from_secs(3),
            tokio::task::spawn_blocking(move || std::fs::canonicalize(&path)),
        )
        .await
        .ok()
        .and_then(|join| join.ok())
        .and_then(Result::ok)
        .unwrap_or(original);

        self.workspaces
            .write()
            .await
            .insert(workspace_id, canonical);
        Ok(())
    }

    pub async fn unregister(&self, workspace_id: &Uuid) {
        self.workspaces.write().await.remove(workspace_id);
    }

    pub async fn resolve(
        &self,
        workspace_id: &Uuid,
        relative_path: &str,
    ) -> Result<PathBuf, FsError> {
        // Reject .. components at API layer
        if relative_path.contains("..") {
            return Err(FsError::PathTraversal);
        }

        let workspaces = self.workspaces.read().await;
        let root = workspaces
            .get(workspace_id)
            .ok_or(FsError::WorkspaceNotRegistered(*workspace_id))?;

        let target = root.join(relative_path);

        // Canonicalize and verify it's within workspace
        let canonical = if target.exists() {
            std::fs::canonicalize(&target)?
        } else {
            // For non-existent paths, canonicalize parent and append filename
            let parent = target.parent().unwrap_or(&target);
            if parent.exists() {
                let canonical_parent = std::fs::canonicalize(parent)?;
                let file_name = target.file_name().unwrap_or_default();
                canonical_parent.join(file_name)
            } else {
                target
            }
        };

        if !canonical.starts_with(root) {
            return Err(FsError::SymlinkEscape);
        }

        Ok(canonical)
    }

    pub async fn get_root(&self, workspace_id: &Uuid) -> Result<PathBuf, FsError> {
        let workspaces = self.workspaces.read().await;
        workspaces
            .get(workspace_id)
            .cloned()
            .ok_or(FsError::WorkspaceNotRegistered(*workspace_id))
    }
}

impl Default for WorkspaceRegistry {
    fn default() -> Self {
        Self::new()
    }
}
