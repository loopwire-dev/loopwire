use lw_agent::{AgentManager, AgentType, PersistedAgentInfo};
use lw_config::{ConfigPaths, DaemonConfig};
use lw_fs::{FsWatcher, WorkspaceRegistry};
use lw_pty::PtyManager;

use std::path::PathBuf;
use std::sync::Arc;

use crate::auth::TokenStore;
use crate::remote::RemoteAccessManager;
use crate::rest::workspace::{load_workspace_agents, load_workspaces, save_workspaces};

#[derive(Clone)]
pub struct AppState {
    pub config: DaemonConfig,
    pub paths: ConfigPaths,
    pub token_store: Arc<TokenStore>,
    pub remote_access: Arc<RemoteAccessManager>,
    pub pty_manager: Arc<PtyManager>,
    pub agent_manager: Arc<AgentManager>,
    pub workspace_registry: WorkspaceRegistry,
    pub fs_watcher: Arc<FsWatcher>,

    pub version: &'static str,
}

impl AppState {
    pub fn new(config: DaemonConfig, bootstrap_token_hash: String) -> anyhow::Result<Self> {
        let paths = config.paths()?;

        let pty_manager = Arc::new(PtyManager::new());
        let fs_watcher = Arc::new(FsWatcher::new());

        // Populate the workspace registry from persisted workspaces.json
        let ws_entries = load_workspaces(&paths);

        // Build persisted agent info from all workspaces for recovery.
        let mut persisted_agents = Vec::new();
        for ws in &ws_entries {
            let ws_path = PathBuf::from(&ws.path);
            let agents = load_workspace_agents(&paths, &ws_path);
            for (session_id, entry) in agents {
                let agent_type = entry
                    .agent_type
                    .parse::<AgentType>()
                    .unwrap_or(AgentType::ClaudeCode);
                let created_at = entry
                    .created_at
                    .as_ref()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|dt| dt.with_timezone(&chrono::Utc));
                persisted_agents.push(PersistedAgentInfo {
                    session_id,
                    workspace_path: ws_path.clone(),
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
                    created_at,
                    pid: entry.pid,
                });
            }
        }

        let agent_manager = Arc::new(AgentManager::new(pty_manager.clone(), persisted_agents));
        let registry_entries: Vec<(uuid::Uuid, PathBuf)> = ws_entries
            .iter()
            .filter(|e| PathBuf::from(&e.path).is_dir())
            .map(|e| (e.id, PathBuf::from(&e.path)))
            .collect();
        let workspace_registry = WorkspaceRegistry::with_entries(registry_entries);
        // Re-save so that any entries missing an id (backfilled by serde
        // default) get their id persisted for next startup.
        if !ws_entries.is_empty() {
            let _ = save_workspaces(&paths, &ws_entries);
        }

        let token_store = Arc::new(TokenStore::new(bootstrap_token_hash, paths.clone()));
        let remote_access = Arc::new(RemoteAccessManager::new(
            config.clone(),
            token_store.clone(),
            paths.clone(),
        )?);

        Ok(Self {
            config,
            paths,
            token_store,
            remote_access,
            pty_manager,
            agent_manager,
            workspace_registry,
            fs_watcher,

            version: option_env!("LOOPWIRED_VERSION").unwrap_or(env!("CARGO_PKG_VERSION")),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn make_test_state() -> (tempfile::TempDir, AppState) {
        let dir = tempfile::tempdir().unwrap();
        let mut config = lw_config::DaemonConfig::default();
        config.set_paths(lw_config::ConfigPaths::with_base(dir.path().to_path_buf()));
        let bootstrap_hash = crate::auth::TokenStore::hash_token("test-bootstrap");
        let state = AppState::new(config, bootstrap_hash).unwrap();
        (dir, state)
    }

    #[tokio::test]
    async fn new_creates_state_with_version_set() {
        let (_dir, state) = make_test_state().await;
        assert!(!state.version.is_empty());
    }

    #[tokio::test]
    async fn new_workspace_registry_starts_empty() {
        let (_dir, state) = make_test_state().await;
        let id = uuid::Uuid::new_v4();
        let result = state.workspace_registry.resolve(&id, ".").await;
        assert!(matches!(
            result,
            Err(lw_fs::FsError::WorkspaceNotRegistered(_))
        ));
    }

    #[tokio::test]
    async fn new_token_store_validates_provided_bootstrap_hash() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = lw_config::DaemonConfig::default();
        config.set_paths(lw_config::ConfigPaths::with_base(dir.path().to_path_buf()));
        let hash = crate::auth::TokenStore::hash_token("my-secret");
        let state = AppState::new(config, hash).unwrap();
        assert!(state.token_store.validate_bootstrap("my-secret").await);
    }

    #[tokio::test]
    async fn new_agent_manager_exposes_three_runner_types() {
        let (_dir, state) = make_test_state().await;
        assert_eq!(state.agent_manager.available_agents().len(), 3);
    }
}
