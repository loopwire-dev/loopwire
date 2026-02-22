use crate::process::is_process_alive;
use lw_pty::PtySession;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

use super::session::AgentStatus;
use super::AgentManager;

impl AgentManager {
    pub(crate) async fn reconcile_session_statuses(&self) {
        let mut handles = self.handles.write().await;
        let mut running_session_ids: HashSet<Uuid> = HashSet::new();
        let mut stopped_sessions: Vec<(Uuid, std::path::PathBuf)> = Vec::new();
        let mut sessions_to_monitor: Vec<(Uuid, Arc<PtySession>)> = Vec::new();
        for (session_id, handle) in handles.iter_mut() {
            let running_via_process = handle.process_id.is_some_and(is_process_alive);

            match self.pty_manager.get(session_id).await {
                Ok(session) => {
                    handle.status = if running_via_process {
                        if handle.status == AgentStatus::Restored {
                            AgentStatus::Restored
                        } else {
                            AgentStatus::Running
                        }
                    } else if handle.status == AgentStatus::Restored {
                        // Preserve Restored even when a PTY exists in the
                        // manager but the process already exited (e.g. the
                        // agent CLI rejected --resume and quit immediately).
                        // transition_restored_to_running will consume this
                        // after the handle has been surfaced once.
                        AgentStatus::Restored
                    } else {
                        AgentStatus::Stopped
                    };
                    if handle.status == AgentStatus::Running
                        || handle.status == AgentStatus::Restored
                    {
                        running_session_ids.insert(*session_id);
                        if !session.is_stopped() {
                            sessions_to_monitor.push((*session_id, session.clone()));
                        }
                    } else {
                        stopped_sessions.push((*session_id, handle.workspace_path.clone()));
                    }
                }
                Err(_) => {
                    handle.status = if running_via_process {
                        if handle.status == AgentStatus::Restored {
                            AgentStatus::Restored
                        } else {
                            AgentStatus::Running
                        }
                    } else if handle.status == AgentStatus::Restored {
                        // Preserve Restored status for handles that have no PTY
                        // and no live process (e.g. failed restore from persistence).
                        // They stay Restored so the bootstrap response can surface
                        // them; transition_restored_to_running will flip them to
                        // Running after they've been returned once, and the next
                        // reconcile will then correctly mark them Stopped.
                        AgentStatus::Restored
                    } else {
                        AgentStatus::Stopped
                    };
                    if handle.status == AgentStatus::Running
                        || handle.status == AgentStatus::Restored
                    {
                        running_session_ids.insert(*session_id);
                    } else {
                        stopped_sessions.push((*session_id, handle.workspace_path.clone()));
                    }
                }
            }
        }

        drop(handles);

        let now = chrono::Utc::now();
        for session_id in running_session_ids {
            self.recorder
                .ensure_activity_state(session_id, now, "session_running")
                .await;
        }
        for (session_id, _workspace_path) in &stopped_sessions {
            self.recorder
                .record_stopped(*session_id, "session_not_running")
                .await;
        }
        for (session_id, session) in sessions_to_monitor {
            self.recorder
                .ensure_activity_monitor(
                    session_id,
                    session,
                    &self.activity_monitors,
                    &self.handles,
                )
                .await;
        }
    }
}
