use lw_agent::AgentManager;
use lw_config::DaemonConfig;
use lw_fs::{FsWatcher, WorkspaceRegistry};
use lw_pty::PtyManager;
use lw_quota::{QuotaStore, QuotaTracker};
use std::sync::Arc;

use crate::auth::TokenStore;

#[derive(Clone)]
pub struct AppState {
    pub config: DaemonConfig,
    pub token_store: Arc<TokenStore>,
    pub pty_manager: Arc<PtyManager>,
    pub agent_manager: Arc<AgentManager>,
    pub workspace_registry: WorkspaceRegistry,
    pub fs_watcher: Arc<FsWatcher>,
    pub quota_tracker: Arc<QuotaTracker>,
    pub version: &'static str,
}

impl AppState {
    pub fn new(config: DaemonConfig, bootstrap_token_hash: String) -> anyhow::Result<Self> {
        let pty_manager = Arc::new(PtyManager::new());
        let agent_manager = Arc::new(AgentManager::new(pty_manager.clone()));
        let workspace_registry = WorkspaceRegistry::new();
        let fs_watcher = Arc::new(FsWatcher::new());

        let config_dir = DaemonConfig::ensure_config_dir()?;
        let db_path = config_dir.join("quota.db");
        let quota_store = Arc::new(QuotaStore::open(&db_path)?);
        let quota_tracker = Arc::new(QuotaTracker::new(quota_store));

        let token_store = Arc::new(TokenStore::new(bootstrap_token_hash));

        Ok(Self {
            config,
            token_store,
            pty_manager,
            agent_manager,
            workspace_registry,
            fs_watcher,
            quota_tracker,
            version: env!("CARGO_PKG_VERSION"),
        })
    }
}
