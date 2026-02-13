use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
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
    _watcher: RecommendedWatcher,
    tx: broadcast::Sender<FsEvent>,
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

        let watches = self.watches.read().await;
        if let Some(entry) = watches.get(&key) {
            return Ok(entry.tx.subscribe());
        }
        drop(watches);

        let full_path = workspace_root.join(relative_path);
        let (tx, rx) = broadcast::channel(256);
        let tx_clone = tx.clone();
        let root = workspace_root.to_path_buf();

        let mut watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                if let Ok(event) = result {
                    let kind = match event.kind {
                        EventKind::Create(_) => FsEventKind::Create,
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
            },
            Config::default(),
        )?;

        watcher.watch(&full_path, RecursiveMode::Recursive)?;

        self.watches.write().await.insert(
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
