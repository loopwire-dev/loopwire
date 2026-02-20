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
    #[error("File too large: {size} bytes (max {max} bytes)")]
    FileTooLarge { size: u64, max: u64 },
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl FsError {
    pub fn error_code(&self) -> &'static str {
        match self {
            FsError::PathTraversal => "WORKSPACE_PATH_TRAVERSAL",
            FsError::SymlinkEscape => "WORKSPACE_SYMLINK_ESCAPE",
            FsError::WorkspaceNotRegistered(_) => "WORKSPACE_NOT_REGISTERED",
            FsError::FileTooLarge { .. } => "FS_FILE_TOO_LARGE",
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

    /// Create a registry pre-populated with the given entries.
    /// Canonicalizes each path synchronously; safe to call before the async
    /// runtime is driving tasks on this thread.
    pub fn with_entries(entries: Vec<(Uuid, PathBuf)>) -> Self {
        let mut map = HashMap::new();
        for (id, path) in entries {
            let canonical = std::fs::canonicalize(&path).unwrap_or(path);
            map.insert(id, canonical);
        }
        Self {
            workspaces: Arc::new(RwLock::new(map)),
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
        .unwrap_or_else(|| {
            tracing::warn!(
                workspace_id = %workspace_id,
                path = %original.display(),
                "Failed to canonicalize workspace path, using original"
            );
            original
        });

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
        // Reject .. components at API layer (check actual path components,
        // not substring, to avoid false positives on names like "my..file")
        if std::path::Path::new(relative_path)
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(FsError::PathTraversal);
        }

        let workspaces = self.workspaces.read().await;
        let root = workspaces
            .get(workspace_id)
            .ok_or(FsError::WorkspaceNotRegistered(*workspace_id))?;

        let target = root.join(relative_path);
        let root = root.clone();

        // Move blocking FS operations off the async runtime
        let canonical = tokio::task::spawn_blocking(move || -> Result<PathBuf, FsError> {
            let resolved = if target.exists() {
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

            if !resolved.starts_with(&root) {
                return Err(FsError::SymlinkEscape);
            }

            Ok(resolved)
        })
        .await
        .map_err(|_| {
            FsError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "resolve task panicked",
            ))
        })??;

        Ok(canonical)
    }

    /// Look up a workspace ID by its root path.
    pub async fn find_by_path(&self, path: &std::path::Path) -> Option<Uuid> {
        let workspaces = self.workspaces.read().await;
        for (id, root) in workspaces.iter() {
            if root == path {
                return Some(*id);
            }
        }
        None
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup() -> (TempDir, WorkspaceRegistry, Uuid) {
        let dir = TempDir::new().unwrap();
        let registry = WorkspaceRegistry::new();
        let id = Uuid::new_v4();
        (dir, registry, id)
    }

    #[test]
    fn error_codes() {
        assert_eq!(
            FsError::PathTraversal.error_code(),
            "WORKSPACE_PATH_TRAVERSAL"
        );
        assert_eq!(
            FsError::SymlinkEscape.error_code(),
            "WORKSPACE_SYMLINK_ESCAPE"
        );
        assert_eq!(
            FsError::WorkspaceNotRegistered(Uuid::nil()).error_code(),
            "WORKSPACE_NOT_REGISTERED"
        );
        assert_eq!(
            FsError::FileTooLarge { size: 100, max: 50 }.error_code(),
            "FS_FILE_TOO_LARGE"
        );
        assert_eq!(
            FsError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "x")).error_code(),
            "FS_IO_ERROR"
        );
    }

    #[test]
    fn error_display() {
        assert!(FsError::PathTraversal.to_string().contains("traversal"));
        assert!(FsError::SymlinkEscape.to_string().contains("Symlink"));
        let err = FsError::FileTooLarge { size: 100, max: 50 };
        assert!(err.to_string().contains("100"));
        assert!(err.to_string().contains("50"));
    }

    #[tokio::test]
    async fn register_and_get_root() {
        let (dir, registry, id) = setup();
        registry
            .register(id, dir.path().to_path_buf())
            .await
            .unwrap();
        let root = registry.get_root(&id).await.unwrap();
        // Canonicalized path should resolve to the same directory
        assert_eq!(fs::canonicalize(dir.path()).unwrap(), root);
    }

    #[tokio::test]
    async fn unregister_removes_workspace() {
        let (dir, registry, id) = setup();
        registry
            .register(id, dir.path().to_path_buf())
            .await
            .unwrap();
        registry.unregister(&id).await;
        let result = registry.get_root(&id).await;
        assert!(matches!(result, Err(FsError::WorkspaceNotRegistered(_))));
    }

    #[tokio::test]
    async fn get_root_unregistered() {
        let registry = WorkspaceRegistry::new();
        let result = registry.get_root(&Uuid::new_v4()).await;
        assert!(matches!(result, Err(FsError::WorkspaceNotRegistered(_))));
    }

    #[tokio::test]
    async fn resolve_valid_relative_path() {
        let (dir, registry, id) = setup();
        fs::write(dir.path().join("hello.txt"), "hi").unwrap();
        registry
            .register(id, dir.path().to_path_buf())
            .await
            .unwrap();

        let resolved = registry.resolve(&id, "hello.txt").await.unwrap();
        assert!(resolved.ends_with("hello.txt"));
        assert!(resolved.is_file());
    }

    #[tokio::test]
    async fn resolve_nonexistent_file_with_existing_parent() {
        let (dir, registry, id) = setup();
        registry
            .register(id, dir.path().to_path_buf())
            .await
            .unwrap();

        let resolved = registry.resolve(&id, "new_file.txt").await.unwrap();
        assert!(resolved.ends_with("new_file.txt"));
    }

    #[tokio::test]
    async fn resolve_rejects_dotdot_traversal() {
        let (dir, registry, id) = setup();
        registry
            .register(id, dir.path().to_path_buf())
            .await
            .unwrap();

        let result = registry.resolve(&id, "../etc/passwd").await;
        assert!(matches!(result, Err(FsError::PathTraversal)));
    }

    #[tokio::test]
    async fn resolve_allows_double_dot_in_filename() {
        let (dir, registry, id) = setup();
        fs::write(dir.path().join("my..file"), "ok").unwrap();
        registry
            .register(id, dir.path().to_path_buf())
            .await
            .unwrap();

        let resolved = registry.resolve(&id, "my..file").await.unwrap();
        assert!(resolved.ends_with("my..file"));
    }

    #[tokio::test]
    async fn resolve_rejects_symlink_escape() {
        let (dir, registry, id) = setup();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret.txt"), "secret").unwrap();

        // Create a symlink inside workspace pointing outside
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                outside.path().join("secret.txt"),
                dir.path().join("escape_link"),
            )
            .unwrap();
        }
        #[cfg(not(unix))]
        {
            // Skip on non-unix
            return;
        }

        registry
            .register(id, dir.path().to_path_buf())
            .await
            .unwrap();
        let result = registry.resolve(&id, "escape_link").await;
        assert!(matches!(result, Err(FsError::SymlinkEscape)));
    }

    #[tokio::test]
    async fn resolve_unregistered_workspace() {
        let registry = WorkspaceRegistry::new();
        let result = registry.resolve(&Uuid::new_v4(), "file.txt").await;
        assert!(matches!(result, Err(FsError::WorkspaceNotRegistered(_))));
    }

    #[tokio::test]
    async fn resolve_subdirectory() {
        let (dir, registry, id) = setup();
        fs::create_dir_all(dir.path().join("sub/dir")).unwrap();
        fs::write(dir.path().join("sub/dir/file.txt"), "nested").unwrap();
        registry
            .register(id, dir.path().to_path_buf())
            .await
            .unwrap();

        let resolved = registry.resolve(&id, "sub/dir/file.txt").await.unwrap();
        assert!(resolved.ends_with("sub/dir/file.txt"));
    }

    #[test]
    fn default_creates_new() {
        let _registry = WorkspaceRegistry::default();
    }
}
