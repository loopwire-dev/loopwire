use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path as StdPath;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use base64::Engine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::rest::workspace::{load_workspace_agents, save_workspace_agents, WorkspaceAgentEntry};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct CreateSessionRequest {
    pub agent_type: lw_agent::AgentType,
    pub custom_name: Option<String>,
    pub workspace_path: String,
}

#[derive(Serialize)]
pub struct CreateSessionResponse {
    pub session_id: Uuid,
    pub workspace_id: Uuid,
    pub agent_type: lw_agent::AgentType,
    pub conversation_id: Option<String>,
    pub custom_name: Option<String>,
    pub pinned: bool,
    pub icon: Option<String>,
    pub sort_order: Option<i32>,
    pub status: lw_agent::AgentStatus,
    pub resumability_status: lw_agent::ResumabilityStatus,
    pub resume_failure_reason: Option<String>,
    pub recovered_from_previous: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub activity: lw_agent::AgentActivity,
}

#[derive(Serialize)]
pub struct AgentSessionResponse {
    pub session_id: Uuid,
    pub workspace_id: Uuid,
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

#[derive(Deserialize)]
pub struct RenameSessionRequest {
    pub custom_name: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateSessionSettingsRequest {
    pub pinned: Option<bool>,
    pub icon: Option<Option<String>>,
    pub sort_order: Option<Option<i32>>,
}

fn sort_workspace_sessions(mut sessions: Vec<lw_agent::AgentHandle>) -> Vec<lw_agent::AgentHandle> {
    sessions.sort_by(|a, b| match (a.sort_order, b.sort_order) {
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => a.created_at.cmp(&b.created_at),
    });
    sessions
}

fn is_active_status(status: lw_agent::AgentStatus) -> bool {
    status == lw_agent::AgentStatus::Running || status == lw_agent::AgentStatus::Restored
}

async fn running_sessions_for_workspace(
    state: &AppState,
    workspace_path: &StdPath,
) -> Vec<lw_agent::AgentHandle> {
    let workspace_path = workspace_path.to_path_buf();
    let sessions: Vec<_> = state
        .agent_manager
        .list_sessions()
        .await
        .into_iter()
        .filter(|session| {
            session.workspace_path == workspace_path && is_active_status(session.status)
        })
        .collect();
    sort_workspace_sessions(sessions)
}

async fn persist_workspace_agents_snapshot(
    state: &AppState,
    workspace_path: &StdPath,
    skip_sort_fallback_for: Option<Uuid>,
) -> Result<(), ApiErrorResponse> {
    let sessions = running_sessions_for_workspace(state, workspace_path).await;
    let persisted = load_workspace_agents(&state.paths, workspace_path);
    let agents: HashMap<Uuid, WorkspaceAgentEntry> = sessions
        .into_iter()
        .map(|session| {
            let persisted_entry = persisted.get(&session.session_id);
            let should_preserve_sort = skip_sort_fallback_for != Some(session.session_id);
            (
                session.session_id,
                WorkspaceAgentEntry {
                    agent_type: session.agent_type.to_string(),
                    conversation_id: session.conversation_id,
                    custom_name: session.custom_name,
                    pinned: session.pinned,
                    icon: session.icon,
                    // Preserve persisted order when recovered runtime handles have no sort order yet.
                    sort_order: if should_preserve_sort {
                        session
                            .sort_order
                            .or_else(|| persisted_entry.and_then(|entry| entry.sort_order))
                    } else {
                        session.sort_order
                    },
                    resumability_status: Some(match session.resumability_status {
                        lw_agent::ResumabilityStatus::Resumable => "resumable".to_string(),
                        lw_agent::ResumabilityStatus::Unresumable => "unresumable".to_string(),
                    }),
                    resume_failure_reason: session.resume_failure_reason,
                    created_at: Some(session.created_at.to_rfc3339()),
                    pid: session.process_id,
                },
            )
        })
        .collect();

    save_workspace_agents(&state.paths, workspace_path, &agents).map_err(|e| ApiErrorResponse {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: ApiError::internal(format!(
            "Failed to persist workspace agent settings for {}: {}",
            workspace_path.display(),
            e
        )),
    })
}

pub async fn available(State(state): State<AppState>) -> Json<Vec<lw_agent::AvailableAgent>> {
    Json(state.agent_manager.available_agents())
}

fn to_api_session(session: lw_agent::AgentHandle, workspace_id: Uuid) -> AgentSessionResponse {
    AgentSessionResponse {
        session_id: session.session_id,
        workspace_id,
        agent_type: session.agent_type,
        conversation_id: session.conversation_id,
        custom_name: session.custom_name,
        pinned: session.pinned,
        icon: session.icon,
        sort_order: session.sort_order,
        status: session.status,
        resumability_status: session.resumability_status,
        resume_failure_reason: session.resume_failure_reason,
        recovered_from_previous: session.recovered_from_previous,
        created_at: session.created_at,
        activity: session.activity,
    }
}

pub async fn list_sessions(State(state): State<AppState>) -> Json<Vec<AgentSessionResponse>> {
    let sessions: Vec<_> = state
        .agent_manager
        .list_sessions()
        .await
        .into_iter()
        .filter(|session| is_active_status(session.status))
        .collect();
    let mut response = Vec::with_capacity(sessions.len());
    for session in sessions {
        let Some(workspace_id) = state
            .workspace_registry
            .find_by_path(&session.workspace_path)
            .await
        else {
            continue;
        };
        response.push(to_api_session(session, workspace_id));
    }
    Json(response)
}

pub async fn create_session(
    State(state): State<AppState>,
    Json(body): Json<CreateSessionRequest>,
) -> Result<(StatusCode, Json<CreateSessionResponse>), ApiErrorResponse> {
    let workspace_path = std::path::PathBuf::from(&body.workspace_path);

    if !workspace_path.is_dir() {
        return Err(ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new(
                "INVALID_WORKSPACE",
                "Workspace path is not a valid directory",
            ),
        });
    }

    // Reuse existing workspace registration if present, otherwise create new
    let workspace_id = state
        .workspace_registry
        .find_by_path(&workspace_path)
        .await
        .unwrap_or_else(Uuid::new_v4);
    state
        .workspace_registry
        .register(workspace_id, workspace_path.clone())
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(e.to_string()),
        })?;

    let (session_id, _session) = state
        .agent_manager
        .start_session(
            body.agent_type,
            workspace_path.clone(),
            body.custom_name.clone(),
        )
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(e.to_string()),
        })?;

    let handle = state.agent_manager.get_handle(&session_id).await;
    let created_at = handle
        .as_ref()
        .map(|h| h.created_at)
        .unwrap_or_else(chrono::Utc::now);
    let conversation_id = handle.as_ref().and_then(|h| h.conversation_id.clone());
    let resumability_status = handle
        .as_ref()
        .map(|h| h.resumability_status)
        .unwrap_or(lw_agent::ResumabilityStatus::Resumable);
    let resume_failure_reason = handle
        .as_ref()
        .and_then(|h| h.resume_failure_reason.clone());
    let recovered_from_previous = handle
        .as_ref()
        .map(|h| h.recovered_from_previous)
        .unwrap_or(false);
    persist_workspace_agents_snapshot(&state, &workspace_path, None).await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateSessionResponse {
            session_id,
            workspace_id,
            agent_type: body.agent_type,
            conversation_id,
            custom_name: body.custom_name,
            pinned: false,
            icon: None,
            sort_order: None,
            status: lw_agent::AgentStatus::Running,
            resumability_status,
            resume_failure_reason,
            recovered_from_previous,
            created_at,
            activity: state.agent_manager.get_activity(&session_id).await,
        }),
    ))
}

pub async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<AgentSessionResponse>, ApiErrorResponse> {
    let handle = state
        .agent_manager
        .get_handle(&id)
        .await
        .ok_or_else(|| ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::not_found("Session"),
        })?;
    let workspace_id = state
        .workspace_registry
        .find_by_path(&handle.workspace_path)
        .await
        .ok_or_else(|| ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::not_found("Workspace"),
        })?;
    Ok(Json(to_api_session(handle, workspace_id)))
}

pub async fn stop_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiErrorResponse> {
    let workspace_path = state
        .agent_manager
        .get_handle(&id)
        .await
        .map(|handle| handle.workspace_path);
    state
        .agent_manager
        .stop_session(&id)
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(e.to_string()),
        })?;
    if let Some(workspace_path) = &workspace_path {
        if let Some(workspace_id) = state.workspace_registry.find_by_path(workspace_path).await {
            let dir = state
                .paths
                .workspace_data_dir(workspace_id)
                .join("attachments")
                .join(id.to_string());
            let _ = tokio::fs::remove_dir_all(dir).await;
        }
        persist_workspace_agents_snapshot(&state, workspace_path, None).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn rename_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<RenameSessionRequest>,
) -> Result<StatusCode, ApiErrorResponse> {
    let found = state
        .agent_manager
        .rename_session(&id, body.custom_name)
        .await;
    if !found {
        return Err(ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::not_found("Session"),
        });
    }
    if let Some(handle) = state.agent_manager.get_handle(&id).await {
        persist_workspace_agents_snapshot(&state, &handle.workspace_path, None).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_session_settings(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateSessionSettingsRequest>,
) -> Result<StatusCode, ApiErrorResponse> {
    let found = state
        .agent_manager
        .update_session_settings(&id, body.pinned, body.icon, body.sort_order)
        .await;
    if !found {
        return Err(ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::not_found("Session"),
        });
    }

    if let Some(handle) = state.agent_manager.get_handle(&id).await {
        persist_workspace_agents_snapshot(
            &state,
            &handle.workspace_path,
            if body.sort_order.is_some() {
                Some(id)
            } else {
                None
            },
        )
        .await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024; // 10 MB

#[derive(Deserialize)]
pub struct AttachRequest {
    pub data: String,
    pub filename: String,
}

#[derive(Serialize)]
pub struct AttachResponse {
    pub path: String,
}

pub async fn attach_to_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<AttachRequest>,
) -> Result<Json<AttachResponse>, ApiErrorResponse> {
    let handle = state
        .agent_manager
        .get_handle(&id)
        .await
        .ok_or_else(|| ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::not_found("Session"),
        })?;

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&body.data)
        .map_err(|_| ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new("INVALID_DATA", "Invalid base64 data"),
        })?;

    if decoded.len() > MAX_ATTACHMENT_BYTES {
        return Err(ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new("ATTACHMENT_TOO_LARGE", "Attachment exceeds 10 MB limit"),
        });
    }

    let ext = StdPath::new(&body.filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");

    let workspace_id = state
        .workspace_registry
        .find_by_path(&handle.workspace_path)
        .await
        .unwrap_or_else(Uuid::new_v4);
    let attachments_dir = state
        .paths
        .workspace_data_dir(workspace_id)
        .join("attachments")
        .join(id.to_string());
    tokio::fs::create_dir_all(&attachments_dir)
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(format!("Failed to create attachments directory: {}", e)),
        })?;

    let file_name = format!("{}.{}", Uuid::new_v4(), ext);
    let file_path = attachments_dir.join(&file_name);

    tokio::fs::write(&file_path, &decoded)
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(format!("Failed to write attachment: {}", e)),
        })?;

    Ok(Json(AttachResponse {
        path: file_path.to_string_lossy().into_owned(),
    }))
}

#[derive(Deserialize)]
pub struct ScrollbackQuery {
    pub before_offset: Option<usize>,
    pub max_bytes: Option<usize>,
}

#[derive(Serialize)]
pub struct ScrollbackResponse {
    pub data: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub has_more: bool,
}

pub async fn session_scrollback(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(query): Query<ScrollbackQuery>,
) -> Result<Json<ScrollbackResponse>, ApiErrorResponse> {
    let max_bytes = query.max_bytes.unwrap_or(512 * 1024).min(2 * 1024 * 1024);

    let result = state
        .agent_manager
        .capture_scrollback_raw(&id, query.before_offset, max_bytes)
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::new("SCROLLBACK_UNAVAILABLE", e.to_string()),
        })?;

    Ok(Json(ScrollbackResponse {
        data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.data),
        start_offset: result.start_offset,
        end_offset: result.end_offset,
        has_more: result.has_more,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_handle(
        sort_order: Option<i32>,
        created_at: chrono::DateTime<chrono::Utc>,
    ) -> lw_agent::AgentHandle {
        lw_agent::AgentHandle {
            session_id: Uuid::new_v4(),
            agent_type: lw_agent::AgentType::ClaudeCode,
            conversation_id: Some(Uuid::new_v4().to_string()),
            custom_name: None,
            pinned: false,
            icon: None,
            sort_order,
            workspace_path: std::path::PathBuf::from("/tmp"),
            status: lw_agent::AgentStatus::Running,
            process_id: None,
            resumability_status: lw_agent::ResumabilityStatus::Resumable,
            resume_failure_reason: None,
            recovered_from_previous: false,
            created_at,
            activity: lw_agent::AgentActivity::unknown("test", created_at),
        }
    }

    #[test]
    fn sort_workspace_sessions_empty() {
        let sorted = sort_workspace_sessions(vec![]);
        assert!(sorted.is_empty());
    }

    #[test]
    fn sort_workspace_sessions_by_sort_order() {
        let now = chrono::Utc::now();
        let a = make_handle(Some(2), now);
        let b = make_handle(Some(1), now);
        let sorted = sort_workspace_sessions(vec![a, b]);
        assert_eq!(sorted[0].sort_order, Some(1));
        assert_eq!(sorted[1].sort_order, Some(2));
    }

    #[test]
    fn sort_workspace_sessions_some_before_none() {
        let now = chrono::Utc::now();
        let with_order = make_handle(Some(5), now);
        let without_order = make_handle(None, now);
        let sorted = sort_workspace_sessions(vec![without_order, with_order]);
        assert!(sorted[0].sort_order.is_some());
        assert!(sorted[1].sort_order.is_none());
    }

    #[test]
    fn sort_workspace_sessions_none_falls_back_to_created_at() {
        let earlier = chrono::Utc::now() - chrono::Duration::seconds(10);
        let later = chrono::Utc::now();
        let old = make_handle(None, earlier);
        let new = make_handle(None, later);
        let old_id = old.session_id;
        let sorted = sort_workspace_sessions(vec![new, old]);
        assert_eq!(sorted[0].session_id, old_id);
    }

    #[test]
    fn sort_workspace_sessions_mixed() {
        let now = chrono::Utc::now();
        let ordered = make_handle(Some(1), now);
        let unordered_old = make_handle(None, now - chrono::Duration::seconds(5));
        let unordered_new = make_handle(None, now);
        let ordered_id = ordered.session_id;
        let old_id = unordered_old.session_id;
        let new_id = unordered_new.session_id;
        let sorted = sort_workspace_sessions(vec![unordered_new, ordered, unordered_old]);
        assert_eq!(sorted[0].session_id, ordered_id);
        assert_eq!(sorted[1].session_id, old_id);
        assert_eq!(sorted[2].session_id, new_id);
    }

    #[test]
    fn is_active_running() {
        assert!(is_active_status(lw_agent::AgentStatus::Running));
    }

    #[test]
    fn is_active_restored() {
        assert!(is_active_status(lw_agent::AgentStatus::Restored));
    }

    #[test]
    fn is_active_inactive_statuses() {
        assert!(!is_active_status(lw_agent::AgentStatus::Stopped));
        assert!(!is_active_status(lw_agent::AgentStatus::Starting));
        assert!(!is_active_status(lw_agent::AgentStatus::Failed));
    }
}
