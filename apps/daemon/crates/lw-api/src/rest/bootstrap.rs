use std::collections::HashMap;
use std::path::{Path, PathBuf};

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use lw_agent::PersistedAgentInfo;

use crate::rest::workspace::{
    load_workspace_agents, load_workspaces, WorkspaceAgentEntry, WorkspaceEntry,
};
use crate::state::AppState;

#[derive(Serialize)]
pub struct BootstrapResponse {
    pub workspaces: Vec<BootstrapWorkspaceEntry>,
    pub available_agents: Vec<lw_agent::AvailableAgent>,
}

#[derive(Serialize)]
pub struct BootstrapWorkspaceEntry {
    #[serde(flatten)]
    pub workspace: WorkspaceEntry,
    pub sessions: Vec<BootstrapSession>,
}

#[derive(Serialize)]
pub struct BootstrapSession {
    pub session_id: uuid::Uuid,
    pub agent_type: lw_agent::AgentType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_name: Option<String>,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i32>,
    pub status: lw_agent::AgentStatus,
    pub resumability_status: lw_agent::ResumabilityStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_failure_reason: Option<String>,
    pub recovered_from_previous: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub activity: lw_agent::AgentActivity,
}

impl BootstrapSession {
    fn from_handle(handle: lw_agent::AgentHandle) -> Self {
        Self {
            session_id: handle.session_id,
            agent_type: handle.agent_type,
            conversation_id: handle.conversation_id,
            custom_name: handle.custom_name,
            pinned: handle.pinned,
            icon: handle.icon,
            sort_order: handle.sort_order,
            status: handle.status,
            resumability_status: handle.resumability_status,
            resume_failure_reason: handle.resume_failure_reason,
            recovered_from_previous: handle.recovered_from_previous,
            created_at: handle.created_at,
            activity: handle.activity,
        }
    }
}

fn default_workspace_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

pub async fn bootstrap(State(state): State<AppState>) -> Json<BootstrapResponse> {
    let workspaces = load_workspaces(&state.paths);

    // Reconcile-on-read: ensure every agent in workspace.json is represented
    // in the in-memory handles map before we list sessions.
    let mut all_persisted = Vec::new();
    for workspace in &workspaces {
        let workspace_path = PathBuf::from(&workspace.path);
        let agents = load_workspace_agents(&state.paths, &workspace_path);
        for (session_id, entry) in agents {
            if entry.agent_type.is_empty() {
                continue;
            }
            if let Ok(agent_type) = entry.agent_type.parse::<lw_agent::AgentType>() {
                all_persisted.push(PersistedAgentInfo {
                    session_id,
                    workspace_path: workspace_path.clone(),
                    agent_type,
                    conversation_id: entry.conversation_id,
                    custom_name: entry.custom_name,
                    pinned: entry.pinned,
                    icon: entry.icon,
                    sort_order: entry.sort_order,
                    resumability_status: entry.resumability_status.as_deref().and_then(
                        |s| match s {
                            "resumable" => Some(lw_agent::ResumabilityStatus::Resumable),
                            "unresumable" => Some(lw_agent::ResumabilityStatus::Unresumable),
                            _ => None,
                        },
                    ),
                    resume_failure_reason: entry.resume_failure_reason,
                    created_at: entry.created_at.as_ref().and_then(|s| {
                        chrono::DateTime::parse_from_rfc3339(s)
                            .ok()
                            .map(|dt| dt.with_timezone(&chrono::Utc))
                    }),
                    pid: entry.pid,
                });
            }
        }
    }
    if !all_persisted.is_empty() {
        state
            .agent_manager
            .ensure_persisted_handles(&all_persisted)
            .await;
    }

    let mut sessions: Vec<_> = state
        .agent_manager
        .list_sessions()
        .await
        .into_iter()
        .filter(|session| {
            session.status == lw_agent::AgentStatus::Running
                || session.status == lw_agent::AgentStatus::Restored
        })
        .collect();
    let mut workspace_agents = HashMap::<PathBuf, HashMap<uuid::Uuid, WorkspaceAgentEntry>>::new();
    for session in &mut sessions {
        let path = session.workspace_path.clone();
        let agents = workspace_agents
            .entry(path.clone())
            .or_insert_with(|| load_workspace_agents(&state.paths, &path));
        if let Some(agent) = agents.get(&session.session_id) {
            // Legacy fallback entries contain only sort_order.
            if !agent.agent_type.is_empty() {
                session.custom_name = agent.custom_name.clone();
                session.conversation_id = agent.conversation_id.clone();
                session.pinned = agent.pinned;
                session.icon = agent.icon.clone();
                // Only apply persisted resumability if the runtime handle
                // doesn't already carry a failure reason (which is more
                // up-to-date than the workspace.json snapshot).
                if session.resume_failure_reason.is_none() {
                    session.resumability_status = agent
                        .resumability_status
                        .as_deref()
                        .and_then(|s| match s {
                            "resumable" => Some(lw_agent::ResumabilityStatus::Resumable),
                            "unresumable" => Some(lw_agent::ResumabilityStatus::Unresumable),
                            _ => None,
                        })
                        .unwrap_or(session.resumability_status);
                    session.resume_failure_reason = agent.resume_failure_reason.clone();
                }
                if let Some(created_at) = agent.created_at.as_ref() {
                    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(created_at) {
                        session.created_at = parsed.with_timezone(&chrono::Utc);
                    }
                }
            }
            if let Some(sort_order) = agent.sort_order {
                session.sort_order = Some(sort_order);
            }
        }
    }
    let mut sessions_by_workspace = HashMap::<uuid::Uuid, (PathBuf, Vec<BootstrapSession>)>::new();
    for session in sessions {
        let workspace_path = session.workspace_path.clone();
        let workspace_id = state
            .workspace_registry
            .find_by_path(&session.workspace_path)
            .await;
        if let Some(workspace_id) = workspace_id {
            sessions_by_workspace
                .entry(workspace_id)
                .or_insert_with(|| (workspace_path, Vec::new()))
                .1
                .push(BootstrapSession::from_handle(session));
        }
    }
    let mut workspaces: Vec<_> = workspaces
        .into_iter()
        .map(|workspace| BootstrapWorkspaceEntry {
            sessions: sessions_by_workspace
                .remove(&workspace.id)
                .map(|(_, sessions)| sessions)
                .unwrap_or_default(),
            workspace,
        })
        .collect();
    for (workspace_id, (workspace_path, sessions)) in sessions_by_workspace {
        let path = workspace_path.to_string_lossy().to_string();
        workspaces.push(BootstrapWorkspaceEntry {
            workspace: WorkspaceEntry {
                id: workspace_id,
                name: default_workspace_name(&path),
                path,
                pinned: false,
                icon: None,
            },
            sessions,
        });
    }

    let available_agents = state.agent_manager.available_agents();

    Json(BootstrapResponse {
        workspaces,
        available_agents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_workspace_name_normal_path() {
        assert_eq!(default_workspace_name("/home/user/projects/myapp"), "myapp");
    }

    #[test]
    fn default_workspace_name_nested() {
        assert_eq!(
            default_workspace_name("/a/b/c/deep-project"),
            "deep-project"
        );
    }

    #[test]
    fn default_workspace_name_root() {
        // Root "/" has no file_name, falls back to the input string
        assert_eq!(default_workspace_name("/"), "/");
    }

    #[test]
    fn default_workspace_name_simple() {
        assert_eq!(default_workspace_name("myproject"), "myproject");
    }

    #[test]
    fn default_workspace_name_empty() {
        // Empty string: file_name returns None or empty, falls back to input
        assert_eq!(default_workspace_name(""), "");
    }
}
