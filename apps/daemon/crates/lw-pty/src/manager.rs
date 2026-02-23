use crate::session::PtySession;
use crate::PtyError;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<Uuid, Arc<PtySession>>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn create(
        &self,
        session_id: Uuid,
        program: &str,
        args: &[&str],
        working_dir: &Path,
        env: Vec<(String, String)>,
        size: (u16, u16),
    ) -> Result<Arc<PtySession>, PtyError> {
        let (cols, rows) = size;
        let session = PtySession::spawn(session_id, program, args, working_dir, env, cols, rows)?;
        let id = session.id;
        let session = Arc::new(session);
        self.sessions.write().await.insert(id, session.clone());
        tracing::debug!(session_id = %id, "session added to manager");
        Ok(session)
    }

    pub async fn get(&self, id: &Uuid) -> Result<Arc<PtySession>, PtyError> {
        self.sessions
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or(PtyError::SessionNotFound(*id))
    }

    pub async fn kill(&self, id: &Uuid) -> Result<(), PtyError> {
        tracing::debug!(session_id = %id, "killing session");
        let session = self.get(id).await?;
        session.kill().await
    }

    pub async fn remove(&self, id: &Uuid) -> Option<Arc<PtySession>> {
        self.sessions.write().await.remove(id)
    }

    pub async fn list(&self) -> Vec<(Uuid, bool)> {
        self.sessions
            .read()
            .await
            .iter()
            .map(|(id, s)| (*id, s.is_stopped()))
            .collect()
    }

    /// Removes all stopped sessions from the manager and returns their IDs.
    pub async fn reap_stopped(&self) -> Vec<Uuid> {
        let mut sessions = self.sessions.write().await;
        let stopped_ids: Vec<Uuid> = sessions
            .iter()
            .filter(|(_, s)| s.is_stopped())
            .map(|(id, _)| *id)
            .collect();
        for id in &stopped_ids {
            sessions.remove(id);
        }
        tracing::debug!(count = stopped_ids.len(), "reaped stopped sessions");
        stopped_ids
    }

    pub async fn kill_all(&self) {
        tracing::info!("killing all sessions");
        let mut sessions = self.sessions.write().await;
        for session in sessions.values() {
            let _ = session.kill().await;
        }
        sessions.clear();
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn new_starts_with_empty_session_list() {
        let mgr = PtyManager::new();
        assert!(mgr.list().await.is_empty());
    }

    #[tokio::test]
    async fn default_is_equivalent_to_new() {
        let mgr = PtyManager::default();
        assert!(mgr.list().await.is_empty());
    }

    #[tokio::test]
    async fn get_nonexistent_returns_session_not_found_error() {
        let mgr = PtyManager::new();
        let id = Uuid::new_v4();
        let result = mgr.get(&id).await;
        assert!(
            matches!(result, Err(crate::PtyError::SessionNotFound(found_id)) if found_id == id)
        );
    }

    #[tokio::test]
    async fn remove_nonexistent_returns_none() {
        let mgr = PtyManager::new();
        let result = mgr.remove(&Uuid::new_v4()).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn kill_nonexistent_returns_session_not_found_error() {
        let mgr = PtyManager::new();
        let id = Uuid::new_v4();
        let result = mgr.kill(&id).await;
        assert!(
            matches!(result, Err(crate::PtyError::SessionNotFound(found_id)) if found_id == id)
        );
    }

    #[tokio::test]
    async fn reap_stopped_on_empty_manager_returns_empty_vec() {
        let mgr = PtyManager::new();
        let reaped = mgr.reap_stopped().await;
        assert!(reaped.is_empty());
    }
}
