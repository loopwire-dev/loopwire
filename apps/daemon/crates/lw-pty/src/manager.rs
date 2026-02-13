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
        cols: u16,
        rows: u16,
    ) -> Result<Arc<PtySession>, PtyError> {
        let session = PtySession::spawn(session_id, program, args, working_dir, env, cols, rows)?;
        let id = session.id;
        let session = Arc::new(session);
        self.sessions.write().await.insert(id, session.clone());
        Ok(session)
    }

    pub async fn attach_tty(
        &self,
        session_id: Uuid,
        tty_path: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<Arc<PtySession>, PtyError> {
        let session = PtySession::attach_tty(session_id, tty_path, cols, rows)?;
        let id = session.id;
        let session = Arc::new(session);
        self.sessions.write().await.insert(id, session.clone());
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

    pub async fn kill_all(&self) {
        let sessions = self.sessions.read().await;
        for session in sessions.values() {
            let _ = session.kill().await;
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}
