#[cfg(test)]
use notify::PollWatcher;
#[cfg(not(test))]
use notify::RecommendedWatcher;
use notify::{event::ModifyKind, Config, Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct FsEvent {
    pub kind: FsEventKind,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsEventKind {
    Create,
    Modify,
    Delete,
    Rename,
}

struct WatchEntry {
    _watcher: WatcherHandle,
    tx: broadcast::Sender<FsEvent>,
}

#[cfg(not(test))]
enum WatcherHandle {
    Recommended(RecommendedWatcher),
}

#[cfg(test)]
enum WatcherHandle {
    Poll(PollWatcher),
}

impl WatcherHandle {
    fn watch(&mut self, path: &Path) -> notify::Result<()> {
        match self {
            #[cfg(not(test))]
            WatcherHandle::Recommended(watcher) => watcher.watch(path, RecursiveMode::Recursive),
            #[cfg(test)]
            WatcherHandle::Poll(watcher) => watcher.watch(path, RecursiveMode::Recursive),
        }
    }
}

pub struct FsWatcher {
    watches: Arc<RwLock<HashMap<(Uuid, String), WatchEntry>>>,
}

impl FsWatcher {
    pub fn new() -> Self {
        Self {
            watches: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn watch(
        &self,
        workspace_id: Uuid,
        workspace_root: &Path,
        relative_path: &str,
    ) -> anyhow::Result<broadcast::Receiver<FsEvent>> {
        let key = (workspace_id, relative_path.to_string());

        // Take write lock upfront to avoid TOCTOU race between read-check and write-insert
        let mut watches = self.watches.write().await;
        if let Some(entry) = watches.get(&key) {
            return Ok(entry.tx.subscribe());
        }

        let full_path = if relative_path.is_empty() || relative_path == "." {
            workspace_root.to_path_buf()
        } else {
            workspace_root.join(relative_path)
        };
        if !full_path.exists() {
            anyhow::bail!("watch path does not exist: {}", full_path.display());
        }
        let watch_path = full_path.canonicalize().unwrap_or(full_path);
        let (tx, rx) = broadcast::channel(256);
        let tx_clone = tx.clone();
        let root = workspace_root
            .canonicalize()
            .unwrap_or_else(|_| workspace_root.to_path_buf());

        let callback = move |result: Result<Event, notify::Error>| match result {
            Ok(event) => {
                let kind = match event.kind {
                    EventKind::Create(_) => FsEventKind::Create,
                    EventKind::Modify(ModifyKind::Name(_)) => FsEventKind::Rename,
                    EventKind::Modify(_) => FsEventKind::Modify,
                    EventKind::Remove(_) => FsEventKind::Delete,
                    _ => return,
                };
                for path in &event.paths {
                    let relative = path
                        .strip_prefix(&root)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .to_string();
                    let _ = tx_clone.send(FsEvent {
                        kind: kind.clone(),
                        path: relative,
                    });
                }
            }
            Err(e) => {
                tracing::warn!("File watcher error: {e}");
            }
        };

        #[cfg(test)]
        let mut watcher = WatcherHandle::Poll(PollWatcher::new(
            callback,
            Config::default().with_poll_interval(std::time::Duration::from_millis(100)),
        )?);

        #[cfg(not(test))]
        let mut watcher =
            WatcherHandle::Recommended(RecommendedWatcher::new(callback, Config::default())?);

        watcher.watch(&watch_path)?;

        watches.insert(
            key,
            WatchEntry {
                _watcher: watcher,
                tx,
            },
        );

        Ok(rx)
    }

    pub async fn unwatch(&self, workspace_id: Uuid, relative_path: &str) {
        let key = (workspace_id, relative_path.to_string());
        self.watches.write().await.remove(&key);
    }
}

impl Default for FsWatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn watch_create_event() {
        let dir = TempDir::new().unwrap();
        let watcher = FsWatcher::new();
        let id = Uuid::new_v4();

        let mut rx = watcher.watch(id, dir.path(), ".").await.unwrap();

        // Give the watcher time to start
        sleep(Duration::from_millis(100)).await;

        fs::write(dir.path().join("new_file.txt"), "hello").unwrap();

        // Wait for event with timeout
        let event = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("timed out waiting for event")
            .expect("channel closed");

        assert!(
            matches!(event.kind, FsEventKind::Create | FsEventKind::Modify),
            "expected Create or Modify, got {:?}",
            event.kind
        );
    }

    #[tokio::test]
    async fn watch_delete_event() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("to_delete.txt");
        fs::write(&file_path, "bye").unwrap();

        let watcher = FsWatcher::new();
        let id = Uuid::new_v4();

        let mut rx = watcher.watch(id, dir.path(), ".").await.unwrap();
        sleep(Duration::from_millis(100)).await;

        fs::remove_file(&file_path).unwrap();

        // Collect events until we get a Delete
        let mut got_delete = false;
        for _ in 0..20 {
            match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
                Ok(Ok(event)) if matches!(event.kind, FsEventKind::Delete) => {
                    got_delete = true;
                    break;
                }
                Ok(Ok(_)) => continue,
                _ => break,
            }
        }
        assert!(got_delete, "expected a Delete event");
    }

    #[tokio::test]
    async fn multiple_subscribers_same_path() {
        let dir = TempDir::new().unwrap();
        let watcher = FsWatcher::new();
        let id = Uuid::new_v4();

        let mut rx1 = watcher.watch(id, dir.path(), ".").await.unwrap();
        let mut rx2 = watcher.watch(id, dir.path(), ".").await.unwrap();

        sleep(Duration::from_millis(100)).await;
        fs::write(dir.path().join("shared.txt"), "data").unwrap();

        let event1 = tokio::time::timeout(Duration::from_secs(5), rx1.recv())
            .await
            .expect("timed out")
            .expect("channel closed");
        let event2 = tokio::time::timeout(Duration::from_secs(5), rx2.recv())
            .await
            .expect("timed out")
            .expect("channel closed");

        // Both subscribers should receive the same event path
        assert_eq!(event1.path, event2.path);
    }

    #[tokio::test]
    async fn unwatch_removes_watcher() {
        let dir = TempDir::new().unwrap();
        let watcher = FsWatcher::new();
        let id = Uuid::new_v4();

        let _rx = watcher.watch(id, dir.path(), ".").await.unwrap();
        assert_eq!(watcher.watches.read().await.len(), 1);

        watcher.unwatch(id, ".").await;
        assert_eq!(watcher.watches.read().await.len(), 0);
    }

    #[tokio::test]
    async fn unwatch_nonexistent_is_noop() {
        let watcher = FsWatcher::new();
        watcher.unwatch(Uuid::new_v4(), "nonexistent").await;
        assert_eq!(watcher.watches.read().await.len(), 0);
    }

    #[tokio::test]
    async fn watch_nonexistent_path_fails() {
        let watcher = FsWatcher::new();
        let id = Uuid::new_v4();

        let result = watcher.watch(id, Path::new("/nonexistent"), "path").await;
        assert!(result.is_err());
    }

    #[test]
    fn default_creates_new() {
        let _watcher = FsWatcher::default();
    }

    #[test]
    fn fs_event_kind_serialization() {
        assert_eq!(
            serde_json::to_string(&FsEventKind::Create).unwrap(),
            "\"create\""
        );
        assert_eq!(
            serde_json::to_string(&FsEventKind::Modify).unwrap(),
            "\"modify\""
        );
        assert_eq!(
            serde_json::to_string(&FsEventKind::Delete).unwrap(),
            "\"delete\""
        );
        assert_eq!(
            serde_json::to_string(&FsEventKind::Rename).unwrap(),
            "\"rename\""
        );
    }

    #[test]
    fn fs_event_serialization() {
        let event = FsEvent {
            kind: FsEventKind::Create,
            path: "test.txt".to_string(),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["kind"], "create");
        assert_eq!(json["path"], "test.txt");
    }
}
