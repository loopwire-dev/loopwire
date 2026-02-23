use crate::process::is_process_alive;
use lw_pty::PtySession;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

use super::session::AgentStatus;
use super::AgentManager;

/// Determines the next status for an agent handle based on whether its
/// backing process is alive and the handle's current status.
///
/// The `Restored` status is intentionally preserved regardless of process
/// state: promotion to `Running` happens explicitly via
/// [`AgentManager::transition_restored_to_running`] so that lazy-spawn
/// placeholders are not prematurely marked `Stopped`.
fn next_handle_status(process_alive: bool, current_status: AgentStatus) -> AgentStatus {
    if current_status == AgentStatus::Restored {
        AgentStatus::Restored
    } else if process_alive {
        AgentStatus::Running
    } else {
        AgentStatus::Stopped
    }
}

impl AgentManager {
    pub(crate) async fn reconcile_session_statuses(&self) {
        let mut handles = self.handles.write().await;
        let mut running_session_ids: HashSet<Uuid> = HashSet::new();
        let mut stopped_sessions: Vec<(Uuid, std::path::PathBuf)> = Vec::new();
        let mut sessions_to_monitor: Vec<(Uuid, Arc<PtySession>)> = Vec::new();
        for (session_id, handle) in handles.iter_mut() {
            let running_via_process = handle.process_id.is_some_and(is_process_alive);

            handle.status = next_handle_status(running_via_process, handle.status);
            let is_active =
                handle.status == AgentStatus::Running || handle.status == AgentStatus::Restored;

            match self.pty_manager.get(session_id).await {
                Ok(session) => {
                    if is_active {
                        running_session_ids.insert(*session_id);
                        if !session.is_stopped() {
                            sessions_to_monitor.push((*session_id, session.clone()));
                        }
                    } else {
                        stopped_sessions.push((*session_id, handle.workspace_path.clone()));
                    }
                }
                Err(_) => {
                    if is_active {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Each test expresses the expected behaviour for a (process_alive, current_status)
    // pair. The `Restored` invariant — stay Restored regardless of process state —
    // is the most critical rule to verify.

    #[test]
    fn restored_stays_restored_when_process_alive() {
        assert_eq!(
            next_handle_status(true, AgentStatus::Restored),
            AgentStatus::Restored
        );
    }

    #[test]
    fn restored_stays_restored_when_process_dead() {
        assert_eq!(
            next_handle_status(false, AgentStatus::Restored),
            AgentStatus::Restored
        );
    }

    #[test]
    fn running_stays_running_when_process_alive() {
        assert_eq!(
            next_handle_status(true, AgentStatus::Running),
            AgentStatus::Running
        );
    }

    #[test]
    fn running_becomes_stopped_when_process_dead() {
        assert_eq!(
            next_handle_status(false, AgentStatus::Running),
            AgentStatus::Stopped
        );
    }

    #[test]
    fn stopped_becomes_running_when_process_alive() {
        assert_eq!(
            next_handle_status(true, AgentStatus::Stopped),
            AgentStatus::Running
        );
    }

    #[test]
    fn stopped_stays_stopped_when_process_dead() {
        assert_eq!(
            next_handle_status(false, AgentStatus::Stopped),
            AgentStatus::Stopped
        );
    }

    #[test]
    fn starting_becomes_running_when_process_alive() {
        assert_eq!(
            next_handle_status(true, AgentStatus::Starting),
            AgentStatus::Running
        );
    }

    #[test]
    fn failed_becomes_stopped_when_process_dead() {
        assert_eq!(
            next_handle_status(false, AgentStatus::Failed),
            AgentStatus::Stopped
        );
    }
}
