use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
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
    pub custom_name: Option<String>,
    pub workspace_path: String,
    pub status: lw_agent::AgentStatus,
}

#[derive(Deserialize)]
pub struct ResizeRequest {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Deserialize)]
pub struct InputRequest {
    pub data: String,
}

pub async fn available(State(state): State<AppState>) -> Json<Vec<lw_agent::AvailableAgent>> {
    Json(state.agent_manager.available_agents())
}

pub async fn list_sessions(State(state): State<AppState>) -> Json<Vec<lw_agent::AgentHandle>> {
    Json(state.agent_manager.list_sessions().await)
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

    // Register workspace for FS operations
    let workspace_id = Uuid::new_v4();
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

    Ok((
        StatusCode::CREATED,
        Json(CreateSessionResponse {
            session_id,
            workspace_id,
            agent_type: body.agent_type,
            custom_name: body.custom_name,
            workspace_path: body.workspace_path,
            status: lw_agent::AgentStatus::Running,
        }),
    ))
}

pub async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<lw_agent::AgentHandle>, ApiErrorResponse> {
    state
        .agent_manager
        .get_handle(&id)
        .await
        .map(Json)
        .ok_or_else(|| ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::not_found("Session"),
        })
}

pub async fn stop_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiErrorResponse> {
    state
        .agent_manager
        .stop_session(&id)
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(e.to_string()),
        })?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn resize_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<ResizeRequest>,
) -> Result<StatusCode, ApiErrorResponse> {
    let session = state
        .agent_manager
        .ensure_pty_attached(&id)
        .await
        .map_err(|_| ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::not_found("Session"),
        })?;

    session
        .resize(body.cols, body.rows)
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(e.to_string()),
        })?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn input_session(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<InputRequest>,
) -> Result<StatusCode, ApiErrorResponse> {
    let session = state
        .agent_manager
        .ensure_pty_attached(&id)
        .await
        .map_err(|_| ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::not_found("Session"),
        })?;

    session
        .write(body.data.as_bytes())
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(e.to_string()),
        })?;

    Ok(StatusCode::NO_CONTENT)
}
