use std::path::PathBuf;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use lw_config::DaemonConfig;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::state::AppState;

// ── Workspace persistence ──────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkspaceEntry {
    pub path: String,
    pub name: String,
    pub pinned: bool,
    pub icon: Option<String>,
}

fn workspaces_path() -> PathBuf {
    DaemonConfig::config_dir().join("workspaces.json")
}

fn load_workspaces() -> Vec<WorkspaceEntry> {
    let path = workspaces_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_workspaces(entries: &[WorkspaceEntry]) -> Result<(), std::io::Error> {
    let path = workspaces_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

#[derive(Serialize)]
pub struct RootsResponse {
    pub roots: Vec<String>,
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub workspace_id: Uuid,
    pub relative_path: Option<String>,
}

#[derive(Deserialize)]
pub struct ReadQuery {
    pub workspace_id: Uuid,
    pub relative_path: String,
}

#[derive(Deserialize)]
pub struct BrowseQuery {
    pub path: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub path: String,
}

#[derive(Serialize)]
pub struct RegisterResponse {
    pub workspace_id: Uuid,
    pub path: String,
}

pub async fn roots() -> Json<RootsResponse> {
    Json(RootsResponse {
        roots: lw_fs::suggest_roots(),
    })
}

pub async fn browse(
    Query(query): Query<BrowseQuery>,
) -> Result<Json<Vec<lw_fs::DirEntry>>, ApiErrorResponse> {
    let path = std::path::Path::new(&query.path);
    if !path.is_absolute() {
        return Err(ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new("INVALID_PATH", "Path must be absolute"),
        });
    }
    let entries = lw_fs::list_directory(path).map_err(|e| ApiErrorResponse {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: ApiError::internal(e.to_string()),
    })?;
    Ok(Json(entries))
}

pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<lw_fs::DirEntry>>, ApiErrorResponse> {
    let relative = query.relative_path.as_deref().unwrap_or(".");
    let path = state
        .workspace_registry
        .resolve(&query.workspace_id, relative)
        .await
        .map_err(|e| {
            let (status, error) = ApiError::fs_error(&e);
            ApiErrorResponse { status, error }
        })?;

    let entries = lw_fs::list_directory(&path).map_err(|e| ApiErrorResponse {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: ApiError::internal(e.to_string()),
    })?;

    Ok(Json(entries))
}

pub async fn read(
    State(state): State<AppState>,
    Query(query): Query<ReadQuery>,
) -> Result<Json<lw_fs::read::FileContent>, ApiErrorResponse> {
    let path = state
        .workspace_registry
        .resolve(&query.workspace_id, &query.relative_path)
        .await
        .map_err(|e| {
            let (status, error) = ApiError::fs_error(&e);
            ApiErrorResponse { status, error }
        })?;

    let content = lw_fs::read_file(&path).map_err(|e| ApiErrorResponse {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: ApiError::internal(e.to_string()),
    })?;

    Ok(Json(content))
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<RegisterResponse>), ApiErrorResponse> {
    let workspace_path = std::path::PathBuf::from(&body.path);

    if !workspace_path.is_absolute() {
        return Err(ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new("INVALID_PATH", "Path must be absolute"),
        });
    }

    if !workspace_path.is_dir() {
        return Err(ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new("INVALID_WORKSPACE", "Path is not a valid directory"),
        });
    }

    let workspace_id = Uuid::new_v4();
    state
        .workspace_registry
        .register(workspace_id, workspace_path)
        .await
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(e.to_string()),
        })?;

    // Persist to workspaces.json if not already present
    let mut entries = load_workspaces();
    if !entries.iter().any(|e| e.path == body.path) {
        let name = body
            .path
            .split('/')
            .filter(|s| !s.is_empty())
            .last()
            .unwrap_or(&body.path)
            .to_string();
        entries.push(WorkspaceEntry {
            path: body.path.clone(),
            name,
            pinned: false,
            icon: None,
        });
        let _ = save_workspaces(&entries);
    }

    Ok((
        StatusCode::CREATED,
        Json(RegisterResponse {
            workspace_id,
            path: body.path,
        }),
    ))
}

// ── List all persisted workspaces ──────────────────────────────────────

pub async fn list_workspaces() -> Json<Vec<WorkspaceEntry>> {
    Json(load_workspaces())
}

// ── Update workspace settings ──────────────────────────────────────────

#[derive(Deserialize)]
pub struct UpdateSettingsRequest {
    pub path: String,
    pub name: Option<String>,
    pub pinned: Option<bool>,
    pub icon: Option<Option<String>>,
}

pub async fn update_workspace_settings(
    Json(body): Json<UpdateSettingsRequest>,
) -> Result<StatusCode, ApiErrorResponse> {
    let mut entries = load_workspaces();
    let entry = entries.iter_mut().find(|e| e.path == body.path);

    match entry {
        Some(entry) => {
            if let Some(name) = body.name {
                entry.name = name;
            }
            if let Some(pinned) = body.pinned {
                entry.pinned = pinned;
            }
            if let Some(icon) = body.icon {
                entry.icon = icon;
            }
            save_workspaces(&entries).map_err(|e| ApiErrorResponse {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: ApiError::internal(e.to_string()),
            })?;
            Ok(StatusCode::NO_CONTENT)
        }
        None => Err(ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::new("NOT_FOUND", "Workspace not found"),
        }),
    }
}

// ── Remove workspace ───────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RemoveWorkspaceRequest {
    pub path: String,
}

pub async fn remove_workspace(
    Json(body): Json<RemoveWorkspaceRequest>,
) -> Result<StatusCode, ApiErrorResponse> {
    let mut entries = load_workspaces();
    let before = entries.len();
    entries.retain(|e| e.path != body.path);
    if entries.len() == before {
        return Ok(StatusCode::NO_CONTENT);
    }
    save_workspaces(&entries).map_err(|e| ApiErrorResponse {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: ApiError::internal(e.to_string()),
    })?;
    Ok(StatusCode::NO_CONTENT)
}
