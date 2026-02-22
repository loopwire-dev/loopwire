use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use lw_config::ConfigPaths;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::state::AppState;

// ── Workspace persistence ──────────────────────────────────────────────

fn default_workspace_id() -> Uuid {
    Uuid::new_v4()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkspaceEntry {
    #[serde(default = "default_workspace_id")]
    pub id: Uuid,
    pub path: String,
    pub name: String,
    pub pinned: bool,
    pub icon: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct WorkspacePersistence {
    #[serde(default = "default_workspace_id")]
    id: Uuid,
    path: String,
    name: String,
    pinned: bool,
    icon: Option<String>,
    #[serde(default)]
    agents: HashMap<String, WorkspaceAgentEntry>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct WorkspaceAgentEntry {
    #[serde(default)]
    pub agent_type: String,
    pub conversation_id: Option<String>,
    pub custom_name: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    pub icon: Option<String>,
    pub sort_order: Option<i32>,
    pub resumability_status: Option<String>,
    pub resume_failure_reason: Option<String>,
    pub created_at: Option<String>,
    #[serde(default)]
    pub pid: Option<u32>,
}

fn workspace_persistence_path(paths: &ConfigPaths, workspace_id: Uuid) -> PathBuf {
    paths.workspace_data_dir(workspace_id).join("workspace.json")
}

fn default_workspace_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(value)
        .map_err(std::io::Error::other)?;
    let tmp = path.with_extension(format!("tmp.{}", Uuid::new_v4()));
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn load_single_workspace_persistence(path: &Path) -> Option<WorkspacePersistence> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn load_workspaces(paths: &ConfigPaths) -> Vec<WorkspaceEntry> {
    let dir = paths.workspaces_data_dir();
    if !dir.is_dir() {
        return Vec::new();
    }
    let read_dir = match std::fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(_) => return Vec::new(),
    };
    let mut seen_paths = HashSet::new();
    let mut entries = Vec::new();
    for item in read_dir.flatten() {
        let workspace_json = item.path().join("workspace.json");
        let Some(persistence) = load_single_workspace_persistence(&workspace_json) else {
            continue;
        };
        if !seen_paths.insert(persistence.path.clone()) {
            continue;
        }
        entries.push(WorkspaceEntry {
            id: persistence.id,
            path: persistence.path,
            name: persistence.name,
            pinned: persistence.pinned,
            icon: persistence.icon,
        });
    }
    entries
}

pub fn save_workspaces(
    paths: &ConfigPaths,
    entries: &[WorkspaceEntry],
) -> Result<(), std::io::Error> {
    let mut seen_paths = HashSet::new();
    for entry in entries {
        if !seen_paths.insert(entry.path.clone()) {
            continue;
        }
        let path = workspace_persistence_path(paths, entry.id);
        let existing_agents = load_single_workspace_persistence(&path)
            .map(|p| p.agents)
            .unwrap_or_default();
        let persistence = WorkspacePersistence {
            id: entry.id,
            path: entry.path.clone(),
            name: entry.name.clone(),
            pinned: entry.pinned,
            icon: entry.icon.clone(),
            agents: existing_agents,
        };
        write_json_atomic(&path, &persistence)?;
    }
    Ok(())
}

pub fn load_workspace_agents(
    paths: &ConfigPaths,
    workspace_path: &Path,
) -> HashMap<Uuid, WorkspaceAgentEntry> {
    let workspace_path_str = workspace_path.to_string_lossy();
    let dir = paths.workspaces_data_dir();
    if !dir.is_dir() {
        return HashMap::new();
    }
    let read_dir = match std::fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(_) => return HashMap::new(),
    };
    for item in read_dir.flatten() {
        let workspace_json = item.path().join("workspace.json");
        let Some(persistence) = load_single_workspace_persistence(&workspace_json) else {
            continue;
        };
        if persistence.path != workspace_path_str.as_ref() {
            continue;
        }
        return persistence
            .agents
            .into_iter()
            .filter_map(|(session_id, entry)| {
                Uuid::parse_str(&session_id)
                    .ok()
                    .map(|parsed| (parsed, entry))
            })
            .collect();
    }
    HashMap::new()
}

pub fn save_workspace_agents(
    paths: &ConfigPaths,
    workspace_path: &Path,
    agents: &HashMap<Uuid, WorkspaceAgentEntry>,
) -> Result<(), std::io::Error> {
    let workspace_path_str = workspace_path.to_string_lossy().to_string();
    let existing_entry = load_workspaces(paths)
        .into_iter()
        .find(|entry| entry.path == workspace_path_str);

    let (workspace_id, persistence_path) = if let Some(ref entry) = existing_entry {
        (entry.id, workspace_persistence_path(paths, entry.id))
    } else {
        let id = Uuid::new_v4();
        (id, workspace_persistence_path(paths, id))
    };

    let existing_persistence = load_single_workspace_persistence(&persistence_path);
    let persisted_agents: HashMap<String, WorkspaceAgentEntry> = agents
        .iter()
        .map(|(session_id, entry)| (session_id.to_string(), entry.clone()))
        .collect();

    let persistence = WorkspacePersistence {
        id: workspace_id,
        path: workspace_path_str.clone(),
        name: existing_entry
            .as_ref()
            .map(|e| e.name.clone())
            .or_else(|| existing_persistence.as_ref().map(|p| p.name.clone()))
            .unwrap_or_else(|| default_workspace_name(&workspace_path_str)),
        pinned: existing_entry
            .as_ref()
            .map(|e| e.pinned)
            .or_else(|| existing_persistence.as_ref().map(|p| p.pinned))
            .unwrap_or(false),
        icon: existing_entry
            .as_ref()
            .and_then(|e| e.icon.clone())
            .or_else(|| existing_persistence.as_ref().and_then(|p| p.icon.clone())),
        agents: persisted_agents,
    };

    write_json_atomic(&persistence_path, &persistence)
}

pub fn load_workspace_agent_sort_orders(
    paths: &ConfigPaths,
    workspace_path: &Path,
) -> HashMap<Uuid, i32> {
    load_workspace_agents(paths, workspace_path)
        .into_iter()
        .filter_map(|(session_id, entry)| {
            entry.sort_order.map(|sort_order| (session_id, sort_order))
        })
        .collect()
}

pub fn save_workspace_agent_sort_orders(
    paths: &ConfigPaths,
    workspace_path: &Path,
    sort_orders: &HashMap<Uuid, i32>,
) -> Result<(), std::io::Error> {
    let mut persisted_agents = load_workspace_agents(paths, workspace_path);
    for entry in persisted_agents.values_mut() {
        entry.sort_order = None;
    }
    for (session_id, sort_order) in sort_orders {
        let entry = persisted_agents.entry(*session_id).or_default();
        entry.sort_order = Some(*sort_order);
    }
    save_workspace_agents(paths, workspace_path, &persisted_agents)
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
    pub include_binary: Option<bool>,
}

#[derive(Deserialize)]
pub struct ReadManyRequest {
    pub workspace_id: Uuid,
    pub relative_paths: Vec<String>,
}

#[derive(Serialize)]
pub struct ReadManyResponse {
    pub files: HashMap<String, lw_fs::FileContent>,
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
    let entries = lw_fs::list_directory(path).map_err(|e| {
        let (status, error) = ApiError::fs_error(&e);
        ApiErrorResponse { status, error }
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

    let entries = lw_fs::list_directory(&path).map_err(|e| {
        let (status, error) = ApiError::fs_error(&e);
        ApiErrorResponse { status, error }
    })?;

    Ok(Json(entries))
}

pub async fn read(
    State(state): State<AppState>,
    Query(query): Query<ReadQuery>,
) -> Result<Json<lw_fs::FileContent>, ApiErrorResponse> {
    let path = state
        .workspace_registry
        .resolve(&query.workspace_id, &query.relative_path)
        .await
        .map_err(|e| {
            let (status, error) = ApiError::fs_error(&e);
            ApiErrorResponse { status, error }
        })?;

    let include_binary = query.include_binary.unwrap_or(false);
    let content = (if include_binary {
        lw_fs::read_file_with_binary(&path)
    } else {
        lw_fs::read_file(&path)
    })
    .map_err(|e| {
        let (status, error) = ApiError::fs_error(&e);
        ApiErrorResponse { status, error }
    })?;

    Ok(Json(content))
}

pub async fn read_many(
    State(state): State<AppState>,
    Json(body): Json<ReadManyRequest>,
) -> Result<Json<ReadManyResponse>, ApiErrorResponse> {
    const MAX_READ_MANY_FILES: usize = 256;
    if body.relative_paths.len() > MAX_READ_MANY_FILES {
        return Err(ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new(
                "TOO_MANY_FILES",
                format!("Maximum {MAX_READ_MANY_FILES} files per request"),
            ),
        });
    }

    let mut files = HashMap::new();
    let mut seen = HashSet::new();

    for relative_path in body.relative_paths {
        if !seen.insert(relative_path.clone()) {
            continue;
        }

        let path = state
            .workspace_registry
            .resolve(&body.workspace_id, &relative_path)
            .await
            .map_err(|e| {
                let (status, error) = ApiError::fs_error(&e);
                ApiErrorResponse { status, error }
            })?;

        let content = lw_fs::read_file(&path).map_err(|e| {
            let (status, error) = ApiError::fs_error(&e);
            ApiErrorResponse { status, error }
        })?;

        files.insert(relative_path, content);
    }

    Ok(Json(ReadManyResponse { files }))
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

    // Reuse existing workspace ID if already registered, otherwise create new
    let mut entries = load_workspaces(&state.paths);
    let workspace_id = if let Some(existing) = entries.iter().find(|e| e.path == body.path) {
        let id = existing.id;
        // Ensure it's in the in-memory registry (may have been lost on restart)
        state
            .workspace_registry
            .register(id, workspace_path)
            .await
            .map_err(|e| ApiErrorResponse {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: ApiError::internal(e.to_string()),
            })?;
        id
    } else {
        let id = Uuid::new_v4();
        state
            .workspace_registry
            .register(id, workspace_path)
            .await
            .map_err(|e| ApiErrorResponse {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: ApiError::internal(e.to_string()),
            })?;
        let name = default_workspace_name(&body.path);
        entries.push(WorkspaceEntry {
            id,
            path: body.path.clone(),
            name,
            pinned: false,
            icon: None,
        });
        save_workspaces(&state.paths, &entries).map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(e.to_string()),
        })?;
        id
    };

    Ok((
        StatusCode::CREATED,
        Json(RegisterResponse {
            workspace_id,
            path: body.path,
        }),
    ))
}

// ── List all persisted workspaces ──────────────────────────────────────

pub async fn list_workspaces(State(state): State<AppState>) -> Json<Vec<WorkspaceEntry>> {
    Json(load_workspaces(&state.paths))
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
    State(state): State<AppState>,
    Json(body): Json<UpdateSettingsRequest>,
) -> Result<StatusCode, ApiErrorResponse> {
    let mut entries = load_workspaces(&state.paths);
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
            save_workspaces(&state.paths, &entries).map_err(|e| ApiErrorResponse {
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
    State(state): State<AppState>,
    Json(body): Json<RemoveWorkspaceRequest>,
) -> Result<StatusCode, ApiErrorResponse> {
    let entries = load_workspaces(&state.paths);
    let workspace_id = entries.iter().find(|e| e.path == body.path).map(|e| e.id);

    if workspace_id.is_none() {
        return Ok(StatusCode::NO_CONTENT);
    }

    if let Some(id) = workspace_id {
        let data_dir = state.paths.workspace_data_dir(id);
        let _ = std::fs::remove_dir_all(&data_dir);
    }

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lw_config::ConfigPaths;

    #[test]
    fn workspace_entry_serde_roundtrip() {
        let id = Uuid::new_v4();
        let entry = WorkspaceEntry {
            id,
            path: "/home/user/project".to_string(),
            name: "project".to_string(),
            pinned: true,
            icon: Some("folder".to_string()),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: WorkspaceEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, id);
        assert_eq!(parsed.path, entry.path);
        assert_eq!(parsed.name, entry.name);
        assert_eq!(parsed.pinned, entry.pinned);
        assert_eq!(parsed.icon, entry.icon);
    }

    #[test]
    fn workspace_entry_serde_no_icon() {
        let entry = WorkspaceEntry {
            id: Uuid::new_v4(),
            path: "/tmp/test".to_string(),
            name: "test".to_string(),
            pinned: false,
            icon: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: WorkspaceEntry = serde_json::from_str(&json).unwrap();
        assert!(parsed.icon.is_none());
        assert!(!parsed.pinned);
    }

    #[test]
    fn workspace_entry_serde_missing_id_gets_default() {
        // Backward compat: old entries without "id"
        let json = r#"{"path":"/tmp/test","name":"test","pinned":false,"icon":null}"#;
        let parsed: WorkspaceEntry = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.path, "/tmp/test");
        assert!(!parsed.id.is_nil());
    }

    #[test]
    fn save_and_load_workspaces_uses_workspace_local_persistence() {
        let root = std::env::temp_dir().join(format!("loopwire-test-{}", Uuid::new_v4()));
        let workspace = root.join("workspace-a");
        let config = root.join("daemon-config");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&config).unwrap();

        let paths = ConfigPaths::with_base(config.clone());
        let entry = WorkspaceEntry {
            id: Uuid::new_v4(),
            path: workspace.to_string_lossy().to_string(),
            name: "Workspace A".to_string(),
            pinned: true,
            icon: Some("AA".to_string()),
        };

        save_workspaces(&paths, &[entry.clone()]).unwrap();

        let persisted = config
            .join("workspaces")
            .join(entry.id.to_string())
            .join("workspace.json");
        assert!(persisted.exists());

        let loaded = load_workspaces(&paths);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].path, entry.path);
        assert_eq!(loaded[0].name, "Workspace A");
        assert!(loaded[0].pinned);
        assert_eq!(loaded[0].icon.as_deref(), Some("AA"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_agents_are_persisted_locally() {
        let root = std::env::temp_dir().join(format!("loopwire-test-{}", Uuid::new_v4()));
        let workspace = root.join("workspace-b");
        let config = root.join("daemon-config");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&config).unwrap();

        let paths = ConfigPaths::with_base(config.clone());
        let workspace_path = workspace.to_string_lossy().to_string();
        let entry = WorkspaceEntry {
            id: Uuid::new_v4(),
            path: workspace_path.clone(),
            name: "Workspace B".to_string(),
            pinned: false,
            icon: None,
        };
        save_workspaces(&paths, &[entry.clone()]).unwrap();

        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let agents: HashMap<Uuid, WorkspaceAgentEntry> = HashMap::from([
            (
                a,
                WorkspaceAgentEntry {
                    agent_type: "codex".to_string(),
                    conversation_id: Some("conv-a".to_string()),
                    custom_name: Some("Agent A".to_string()),
                    pinned: true,
                    icon: Some("AA".to_string()),
                    sort_order: Some(0),
                    resumability_status: Some("resumable".to_string()),
                    resume_failure_reason: None,
                    created_at: Some("2026-02-17T00:00:00Z".to_string()),
                    pid: None,
                },
            ),
            (
                b,
                WorkspaceAgentEntry {
                    agent_type: "claude_code".to_string(),
                    conversation_id: Some("conv-b".to_string()),
                    custom_name: None,
                    pinned: false,
                    icon: None,
                    sort_order: Some(1),
                    resumability_status: Some("unresumable".to_string()),
                    resume_failure_reason: Some("restore failed".to_string()),
                    created_at: Some("2026-02-17T00:00:01Z".to_string()),
                    pid: None,
                },
            ),
        ]);
        save_workspace_agents(&paths, workspace.as_path(), &agents).unwrap();

        let loaded_agents = load_workspace_agents(&paths, workspace.as_path());
        assert_eq!(
            loaded_agents.get(&a).map(|entry| entry.agent_type.as_str()),
            Some("codex")
        );
        assert_eq!(
            loaded_agents
                .get(&a)
                .and_then(|entry| entry.custom_name.as_deref()),
            Some("Agent A")
        );
        assert_eq!(loaded_agents.get(&a).map(|entry| entry.pinned), Some(true));
        assert_eq!(
            loaded_agents
                .get(&a)
                .and_then(|entry| entry.icon.as_deref()),
            Some("AA")
        );
        assert_eq!(
            loaded_agents.get(&a).and_then(|entry| entry.sort_order),
            Some(0)
        );
        assert_eq!(
            loaded_agents.get(&b).map(|entry| entry.agent_type.as_str()),
            Some("claude_code")
        );
        assert_eq!(
            loaded_agents.get(&b).and_then(|entry| entry.sort_order),
            Some(1)
        );

        // Saving workspace metadata should preserve workspace-local agent data.
        save_workspaces(&paths, &[entry.clone()]).unwrap();
        let loaded_after_workspace_save = load_workspace_agents(&paths, workspace.as_path());
        assert_eq!(
            loaded_after_workspace_save
                .get(&a)
                .and_then(|agent| agent.custom_name.as_deref()),
            Some("Agent A"),
        );
        assert_eq!(
            loaded_after_workspace_save
                .get(&b)
                .and_then(|agent| agent.sort_order),
            Some(1),
        );
        let persisted = config
            .join("workspaces")
            .join(entry.id.to_string())
            .join("workspace.json");
        let persisted_content = std::fs::read_to_string(persisted).unwrap();
        assert!(!persisted_content.contains("\"agent_sort_orders\""));

        let _ = std::fs::remove_dir_all(root);
    }
}
