mod reconcile;
mod recorder;
pub(crate) mod session;

use crate::activity::AgentActivityEvent;
use crate::activity::{ActivityTiming, AgentActivity};
use crate::runners::{default_runners, AgentRunner, AgentType, AvailableAgent};
use lw_pty::PtyManager;
use recorder::ActivityRecorder;
use session::{AgentHandle, AgentStatus, ResumabilityStatus};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock as StdRwLock};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

/// Minimal info about a persisted agent from `workspace.json`.
#[derive(Clone)]
pub struct PersistedAgentInfo {
    pub session_id: Uuid,
    pub workspace_path: PathBuf,
    pub agent_type: AgentType,
    pub conversation_id: Option<String>,
    pub custom_name: Option<String>,
    pub pinned: bool,
    pub icon: Option<String>,
    pub sort_order: Option<i32>,
    pub resumability_status: Option<ResumabilityStatus>,
    pub resume_failure_reason: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    pub pid: Option<u32>,
}

pub(crate) const AVAILABLE_AGENTS_CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub(crate) struct AvailableAgentsCache {
    pub agents: Vec<AvailableAgent>,
    pub refreshed_at: Instant,
}

pub struct AgentManager {
    pub(crate) pty_manager: Arc<PtyManager>,
    pub(crate) runners: Vec<Box<dyn AgentRunner>>,
    pub(crate) handles: Arc<RwLock<HashMap<Uuid, AgentHandle>>>,
    pub(crate) activity_monitors: Arc<RwLock<HashMap<Uuid, JoinHandle<()>>>>,
    pub(crate) recorder: ActivityRecorder,
    available_agents_cache: StdRwLock<AvailableAgentsCache>,
    pending_restorations: std::sync::Mutex<Vec<PersistedAgentInfo>>,
}

impl AgentManager {
    pub fn new(pty_manager: Arc<PtyManager>, persisted_agents: Vec<PersistedAgentInfo>) -> Self {
        let runners = default_runners();
        let initial_available_agents = Self::collect_available_agents(&runners, None);
        let (activity_events_tx, _) = broadcast::channel(512);
        let recorder = ActivityRecorder::new(
            Arc::new(RwLock::new(HashMap::new())),
            activity_events_tx,
            ActivityTiming::default(),
        );
        Self {
            pty_manager,
            runners,
            handles: Arc::new(RwLock::new(HashMap::new())),
            activity_monitors: Arc::new(RwLock::new(HashMap::new())),
            recorder,
            available_agents_cache: StdRwLock::new(AvailableAgentsCache {
                agents: initial_available_agents,
                refreshed_at: Instant::now(),
            }),
            pending_restorations: std::sync::Mutex::new(persisted_agents),
        }
    }

    pub fn available_agents(&self) -> Vec<AvailableAgent> {
        let (expired, previous) = {
            let cache = self
                .available_agents_cache
                .read()
                .unwrap_or_else(|e| e.into_inner());
            if cache.refreshed_at.elapsed() < AVAILABLE_AGENTS_CACHE_TTL {
                return cache.agents.clone();
            }
            (true, cache.agents.clone())
        };

        if !expired {
            return previous;
        }

        let refreshed = Self::collect_available_agents(&self.runners, Some(&previous));
        let mut cache = self
            .available_agents_cache
            .write()
            .unwrap_or_else(|e| e.into_inner());
        cache.agents = refreshed.clone();
        cache.refreshed_at = Instant::now();
        refreshed
    }

    fn collect_available_agents(
        runners: &[Box<dyn AgentRunner>],
        previous: Option<&[AvailableAgent]>,
    ) -> Vec<AvailableAgent> {
        let previous_versions: HashMap<AgentType, String> = previous
            .unwrap_or(&[])
            .iter()
            .filter(|agent| agent.installed)
            .filter_map(|agent| {
                agent
                    .version
                    .as_ref()
                    .map(|version| (agent.agent_type, version.clone()))
            })
            .collect();

        runners
            .iter()
            .map(|runner| {
                let installed = runner.is_installed();
                let version = if !installed {
                    None
                } else if let Some(previous) = previous_versions.get(&runner.agent_type()) {
                    Some(previous.clone())
                } else {
                    runner.detect_version()
                };
                AvailableAgent {
                    agent_type: runner.agent_type(),
                    name: runner.name().to_string(),
                    installed,
                    version,
                }
            })
            .collect()
    }

    pub fn subscribe_activity(&self) -> broadcast::Receiver<AgentActivityEvent> {
        self.recorder.activity_events_tx.subscribe()
    }

    pub async fn shutdown_all(&self) {
        let mut monitors = self.activity_monitors.write().await;
        for (_, task) in monitors.drain() {
            task.abort();
        }
        drop(monitors);

        let session_ids: Vec<Uuid> = self.handles.read().await.keys().cloned().collect();
        for session_id in session_ids {
            let _ = self.stop_session(&session_id).await;
        }

        self.pty_manager.kill_all().await;

        let mut handles = self.handles.write().await;
        for handle in handles.values_mut() {
            handle.status = AgentStatus::Stopped;
            handle.process_id = None;
        }
        drop(handles);
        self.recorder.activity_states.write().await.clear();
    }

    /// Hydrate persisted agents from `workspace.json` as `Restored` handles
    /// without spawning processes. The actual agent process is spawned lazily
    /// by `ensure_pty_attached` when the user connects to the terminal.
    pub async fn restore_persisted_agents(&self) {
        let pending: Vec<PersistedAgentInfo> = {
            let mut lock = self
                .pending_restorations
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            std::mem::take(&mut *lock)
        };
        if pending.is_empty() {
            return;
        }
        tracing::info!(
            count = pending.len(),
            "Hydrating persisted agent handles (process spawn deferred to connect)",
        );
        let now = chrono::Utc::now();
        for agent in pending {
            let created_at = agent.created_at.unwrap_or(now);
            let resumability_status = agent
                .resumability_status
                .unwrap_or(ResumabilityStatus::Resumable);
            let handle = session::AgentHandle {
                session_id: agent.session_id,
                agent_type: agent.agent_type,
                conversation_id: agent.conversation_id,
                custom_name: agent.custom_name,
                pinned: agent.pinned,
                icon: agent.icon,
                sort_order: agent.sort_order,
                workspace_path: agent.workspace_path,
                status: session::AgentStatus::Restored,
                process_id: None,
                resumability_status,
                resume_failure_reason: agent.resume_failure_reason,
                recovered_from_previous: true,
                created_at,
                activity: AgentActivity::unknown("persisted_hydrate", now),
            };
            self.handles.write().await.insert(agent.session_id, handle);
            self.recorder
                .ensure_activity_state(agent.session_id, created_at, "persisted_hydrate")
                .await;
        }
    }

    pub async fn ensure_persisted_handles(&self, persisted: &[PersistedAgentInfo]) {
        for agent in persisted {
            // Fast path: already tracked and active in memory — nothing to do.
            let dominated = self
                .handles
                .read()
                .await
                .get(&agent.session_id)
                .is_some_and(|h| {
                    h.status == AgentStatus::Running
                        || h.status == AgentStatus::Restored
                        || h.status == AgentStatus::Starting
                });
            if dominated {
                continue;
            }

            let now = chrono::Utc::now();
            let created_at = agent.created_at.unwrap_or(now);
            let resumability_status = agent
                .resumability_status
                .unwrap_or(ResumabilityStatus::Resumable);
            let handle = session::AgentHandle {
                session_id: agent.session_id,
                agent_type: agent.agent_type,
                conversation_id: agent.conversation_id.clone(),
                custom_name: agent.custom_name.clone(),
                pinned: agent.pinned,
                icon: agent.icon.clone(),
                sort_order: agent.sort_order,
                workspace_path: agent.workspace_path.clone(),
                status: AgentStatus::Restored,
                process_id: None,
                resumability_status,
                resume_failure_reason: agent.resume_failure_reason.clone(),
                recovered_from_previous: true,
                created_at,
                activity: AgentActivity::unknown("persisted_hydrate", now),
            };
            self.handles.write().await.insert(agent.session_id, handle);
            self.recorder
                .ensure_activity_state(agent.session_id, created_at, "persisted_hydrate")
                .await;
        }
    }

    /// Transition `Restored` handles to `Running`, but only those that have
    /// an active process or PTY session.  Handles without either are
    /// lazy-spawn placeholders — they stay `Restored` so that reconcile
    /// doesn't mark them `Stopped` before the user connects.
    pub(crate) async fn transition_restored_to_running(&self) {
        let mut handles = self.handles.write().await;
        for (session_id, handle) in handles.iter_mut() {
            if handle.status != AgentStatus::Restored {
                continue;
            }
            let has_live_pty = self
                .pty_manager
                .get(session_id)
                .await
                .is_ok_and(|s| !s.is_stopped());
            let has_live_process = handle
                .process_id
                .is_some_and(crate::process::is_process_alive);
            if has_live_pty || has_live_process {
                handle.status = AgentStatus::Running;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── PersistedAgentInfo ───────────────────────────────────────────

    #[test]
    fn persisted_agent_info_clone() {
        let info = PersistedAgentInfo {
            session_id: Uuid::nil(),
            workspace_path: PathBuf::from("/tmp"),
            agent_type: AgentType::ClaudeCode,
            conversation_id: Some("conv-1".to_string()),
            custom_name: Some("test".to_string()),
            pinned: true,
            icon: Some("star".to_string()),
            sort_order: Some(3),
            resumability_status: Some(ResumabilityStatus::Resumable),
            resume_failure_reason: None,
            created_at: None,
            pid: Some(1234),
        };
        let cloned = info.clone();
        assert_eq!(cloned.session_id, info.session_id);
        assert_eq!(cloned.agent_type, info.agent_type);
        assert_eq!(cloned.conversation_id, info.conversation_id);
        assert_eq!(cloned.custom_name, info.custom_name);
        assert_eq!(cloned.pinned, info.pinned);
        assert_eq!(cloned.icon, info.icon);
        assert_eq!(cloned.sort_order, info.sort_order);
        assert_eq!(cloned.pid, info.pid);
    }

    #[test]
    fn persisted_agent_info_defaults_are_none() {
        let info = PersistedAgentInfo {
            session_id: Uuid::new_v4(),
            workspace_path: PathBuf::from("/ws"),
            agent_type: AgentType::Codex,
            conversation_id: None,
            custom_name: None,
            pinned: false,
            icon: None,
            sort_order: None,
            resumability_status: None,
            resume_failure_reason: None,
            created_at: None,
            pid: None,
        };
        assert!(info.conversation_id.is_none());
        assert!(info.custom_name.is_none());
        assert!(info.resumability_status.is_none());
        assert!(info.created_at.is_none());
        assert!(info.pid.is_none());
    }

    // ── AvailableAgentsCache ─────────────────────────────────────────

    #[test]
    fn available_agents_cache_ttl_constant() {
        assert_eq!(AVAILABLE_AGENTS_CACHE_TTL, Duration::from_secs(60));
    }

    #[test]
    fn available_agents_cache_clone() {
        let cache = AvailableAgentsCache {
            agents: vec![AvailableAgent {
                agent_type: AgentType::ClaudeCode,
                name: "Claude Code".to_string(),
                installed: true,
                version: Some("1.0".to_string()),
            }],
            refreshed_at: Instant::now(),
        };
        let cloned = cache.clone();
        assert_eq!(cloned.agents.len(), 1);
        assert_eq!(cloned.agents[0].name, "Claude Code");
    }

    // ── collect_available_agents ──────────────────────────────────────

    struct MockRunner {
        agent_type: AgentType,
        name: &'static str,
        installed: bool,
        version: Option<String>,
    }

    impl AgentRunner for MockRunner {
        fn agent_type(&self) -> AgentType {
            self.agent_type
        }
        fn name(&self) -> &str {
            self.name
        }
        fn command(&self) -> String {
            "mock".to_string()
        }
        fn args(&self, _workspace: &std::path::Path) -> Vec<String> {
            vec![]
        }
        fn env(&self) -> std::collections::HashMap<String, String> {
            std::collections::HashMap::new()
        }
        fn is_installed(&self) -> bool {
            self.installed
        }
        fn detect_version(&self) -> Option<String> {
            self.version.clone()
        }
    }

    #[test]
    fn collect_available_agents_no_previous() {
        let runners: Vec<Box<dyn AgentRunner>> = vec![
            Box::new(MockRunner {
                agent_type: AgentType::ClaudeCode,
                name: "Claude Code",
                installed: true,
                version: Some("2.0".to_string()),
            }),
            Box::new(MockRunner {
                agent_type: AgentType::Codex,
                name: "Codex",
                installed: false,
                version: None,
            }),
        ];

        let agents = AgentManager::collect_available_agents(&runners, None);
        assert_eq!(agents.len(), 2);

        assert_eq!(agents[0].agent_type, AgentType::ClaudeCode);
        assert!(agents[0].installed);
        assert_eq!(agents[0].version, Some("2.0".to_string()));

        assert_eq!(agents[1].agent_type, AgentType::Codex);
        assert!(!agents[1].installed);
        assert!(agents[1].version.is_none());
    }

    #[test]
    fn collect_available_agents_reuses_previous_version() {
        let runners: Vec<Box<dyn AgentRunner>> = vec![Box::new(MockRunner {
            agent_type: AgentType::ClaudeCode,
            name: "Claude Code",
            installed: true,
            version: Some("3.0".to_string()),
        })];

        let previous = vec![AvailableAgent {
            agent_type: AgentType::ClaudeCode,
            name: "Claude Code".to_string(),
            installed: true,
            version: Some("2.5".to_string()),
        }];

        let agents = AgentManager::collect_available_agents(&runners, Some(&previous));
        // Should reuse the previous version instead of calling detect_version
        assert_eq!(agents[0].version, Some("2.5".to_string()));
    }

    #[test]
    fn collect_available_agents_ignores_previous_if_not_installed() {
        let runners: Vec<Box<dyn AgentRunner>> = vec![Box::new(MockRunner {
            agent_type: AgentType::Codex,
            name: "Codex",
            installed: false,
            version: None,
        })];

        let previous = vec![AvailableAgent {
            agent_type: AgentType::Codex,
            name: "Codex".to_string(),
            installed: true,
            version: Some("1.0".to_string()),
        }];

        let agents = AgentManager::collect_available_agents(&runners, Some(&previous));
        // Not installed now, so version should be None
        assert!(!agents[0].installed);
        assert!(agents[0].version.is_none());
    }

    #[test]
    fn collect_available_agents_previous_uninstalled_not_used() {
        let runners: Vec<Box<dyn AgentRunner>> = vec![Box::new(MockRunner {
            agent_type: AgentType::Gemini,
            name: "Gemini",
            installed: true,
            version: Some("1.5".to_string()),
        })];

        let previous = vec![AvailableAgent {
            agent_type: AgentType::Gemini,
            name: "Gemini".to_string(),
            installed: false,
            version: None,
        }];

        let agents = AgentManager::collect_available_agents(&runners, Some(&previous));
        // Previous was uninstalled, so detect_version should be called
        assert_eq!(agents[0].version, Some("1.5".to_string()));
    }

    // ── AgentManager::new ────────────────────────────────────────────

    #[test]
    fn agent_manager_new_with_empty_persisted() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);
        let agents = manager.available_agents();
        // Should have 3 default runners (claude, codex, gemini)
        assert_eq!(agents.len(), 3);
    }

    #[test]
    fn agent_manager_available_agents_cached() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);
        let first = manager.available_agents();
        let second = manager.available_agents();
        // Both calls should return the same result (from cache)
        assert_eq!(first.len(), second.len());
        for (a, b) in first.iter().zip(second.iter()) {
            assert_eq!(a.agent_type, b.agent_type);
            assert_eq!(a.name, b.name);
            assert_eq!(a.installed, b.installed);
        }
    }

    // ── restore_persisted_agents / ensure_persisted_handles ──────────

    #[tokio::test]
    async fn restore_persisted_agents_creates_restored_handles() {
        let session_id = Uuid::new_v4();
        let persisted = vec![PersistedAgentInfo {
            session_id,
            workspace_path: PathBuf::from("/tmp/ws"),
            agent_type: AgentType::ClaudeCode,
            conversation_id: Some("conv-1".to_string()),
            custom_name: Some("test".to_string()),
            pinned: true,
            icon: Some("star".to_string()),
            sort_order: Some(1),
            resumability_status: None,
            resume_failure_reason: None,
            created_at: None,
            pid: None,
        }];

        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, persisted);
        manager.restore_persisted_agents().await;

        let handles = manager.handles.read().await;
        assert!(handles.contains_key(&session_id));
        let handle = &handles[&session_id];
        assert_eq!(handle.status, AgentStatus::Restored);
        assert_eq!(handle.agent_type, AgentType::ClaudeCode);
        assert_eq!(handle.custom_name, Some("test".to_string()));
        assert!(handle.pinned);
        assert_eq!(handle.icon, Some("star".to_string()));
        assert!(handle.recovered_from_previous);
        assert_eq!(handle.resumability_status, ResumabilityStatus::Resumable);
    }

    #[tokio::test]
    async fn restore_persisted_agents_idempotent() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);
        // Second call with no pending should be a no-op
        manager.restore_persisted_agents().await;
        let handles = manager.handles.read().await;
        assert!(handles.is_empty());
    }

    #[tokio::test]
    async fn ensure_persisted_handles_skips_active() {
        let session_id = Uuid::new_v4();
        let persisted = vec![PersistedAgentInfo {
            session_id,
            workspace_path: PathBuf::from("/tmp/ws"),
            agent_type: AgentType::ClaudeCode,
            conversation_id: Some("conv-1".to_string()),
            custom_name: None,
            pinned: false,
            icon: None,
            sort_order: None,
            resumability_status: None,
            resume_failure_reason: None,
            created_at: None,
            pid: None,
        }];

        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, persisted.clone());
        manager.restore_persisted_agents().await;

        // Mark as Running
        {
            let mut handles = manager.handles.write().await;
            handles.get_mut(&session_id).unwrap().status = AgentStatus::Running;
        }

        // ensure_persisted_handles should not overwrite the Running handle
        manager.ensure_persisted_handles(&persisted).await;
        let handles = manager.handles.read().await;
        assert_eq!(handles[&session_id].status, AgentStatus::Running);
    }

    #[tokio::test]
    async fn ensure_persisted_handles_adds_missing() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);

        let session_id = Uuid::new_v4();
        let persisted = vec![PersistedAgentInfo {
            session_id,
            workspace_path: PathBuf::from("/tmp/ws"),
            agent_type: AgentType::Gemini,
            conversation_id: None,
            custom_name: None,
            pinned: false,
            icon: None,
            sort_order: None,
            resumability_status: Some(ResumabilityStatus::Unresumable),
            resume_failure_reason: Some("failed".to_string()),
            created_at: None,
            pid: None,
        }];

        manager.ensure_persisted_handles(&persisted).await;
        let handles = manager.handles.read().await;
        assert!(handles.contains_key(&session_id));
        let handle = &handles[&session_id];
        assert_eq!(handle.status, AgentStatus::Restored);
        assert_eq!(handle.agent_type, AgentType::Gemini);
        assert_eq!(handle.resumability_status, ResumabilityStatus::Unresumable);
    }

    // ── shutdown_all ─────────────────────────────────────────────────

    #[tokio::test]
    async fn shutdown_all_clears_state() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);

        // Insert a fake handle
        let session_id = Uuid::new_v4();
        let now = chrono::Utc::now();
        let handle = session::AgentHandle {
            session_id,
            agent_type: AgentType::ClaudeCode,
            conversation_id: None,
            custom_name: None,
            pinned: false,
            icon: None,
            sort_order: None,
            workspace_path: PathBuf::from("/tmp"),
            status: AgentStatus::Running,
            process_id: None,
            resumability_status: ResumabilityStatus::Resumable,
            resume_failure_reason: None,
            recovered_from_previous: false,
            created_at: now,
            activity: AgentActivity::unknown("test", now),
        };
        manager.handles.write().await.insert(session_id, handle);
        manager
            .recorder
            .ensure_activity_state(session_id, now, "test")
            .await;

        manager.shutdown_all().await;

        let handles = manager.handles.read().await;
        // Handle should still exist but be stopped with no process
        let h = &handles[&session_id];
        assert_eq!(h.status, AgentStatus::Stopped);
        assert!(h.process_id.is_none());

        // Activity states should be cleared
        let states = manager.recorder.activity_states.read().await;
        assert!(states.is_empty());
    }

    // ── update_status ────────────────────────────────────────────────

    #[tokio::test]
    async fn update_status_sets_status() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);

        let session_id = Uuid::new_v4();
        let now = chrono::Utc::now();
        let handle = session::AgentHandle {
            session_id,
            agent_type: AgentType::Codex,
            conversation_id: None,
            custom_name: None,
            pinned: false,
            icon: None,
            sort_order: None,
            workspace_path: PathBuf::from("/tmp"),
            status: AgentStatus::Running,
            process_id: None,
            resumability_status: ResumabilityStatus::Resumable,
            resume_failure_reason: None,
            recovered_from_previous: false,
            created_at: now,
            activity: AgentActivity::unknown("test", now),
        };
        manager.handles.write().await.insert(session_id, handle);

        manager
            .update_status(&session_id, AgentStatus::Failed)
            .await;
        let handles = manager.handles.read().await;
        assert_eq!(handles[&session_id].status, AgentStatus::Failed);
    }

    // ── rename_session ───────────────────────────────────────────────

    #[tokio::test]
    async fn rename_session_updates_name() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);

        let session_id = Uuid::new_v4();
        let now = chrono::Utc::now();
        let handle = session::AgentHandle {
            session_id,
            agent_type: AgentType::ClaudeCode,
            conversation_id: None,
            custom_name: None,
            pinned: false,
            icon: None,
            sort_order: None,
            workspace_path: PathBuf::from("/tmp"),
            status: AgentStatus::Running,
            process_id: None,
            resumability_status: ResumabilityStatus::Resumable,
            resume_failure_reason: None,
            recovered_from_previous: false,
            created_at: now,
            activity: AgentActivity::unknown("test", now),
        };
        manager.handles.write().await.insert(session_id, handle);

        assert!(
            manager
                .rename_session(&session_id, Some("new name".to_string()))
                .await
        );
        let handles = manager.handles.read().await;
        assert_eq!(
            handles[&session_id].custom_name,
            Some("new name".to_string())
        );
    }

    #[tokio::test]
    async fn rename_session_nonexistent_returns_false() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);
        let result = manager
            .rename_session(&Uuid::new_v4(), Some("name".to_string()))
            .await;
        assert!(!result);
    }

    // ── update_session_settings ──────────────────────────────────────

    #[tokio::test]
    async fn update_session_settings_partial() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);

        let session_id = Uuid::new_v4();
        let now = chrono::Utc::now();
        let handle = session::AgentHandle {
            session_id,
            agent_type: AgentType::ClaudeCode,
            conversation_id: None,
            custom_name: None,
            pinned: false,
            icon: None,
            sort_order: None,
            workspace_path: PathBuf::from("/tmp"),
            status: AgentStatus::Running,
            process_id: None,
            resumability_status: ResumabilityStatus::Resumable,
            resume_failure_reason: None,
            recovered_from_previous: false,
            created_at: now,
            activity: AgentActivity::unknown("test", now),
        };
        manager.handles.write().await.insert(session_id, handle);

        assert!(
            manager
                .update_session_settings(
                    &session_id,
                    Some(true),
                    Some(Some("rocket".to_string())),
                    Some(Some(5)),
                )
                .await
        );

        let handles = manager.handles.read().await;
        let h = &handles[&session_id];
        assert!(h.pinned);
        assert_eq!(h.icon, Some("rocket".to_string()));
        assert_eq!(h.sort_order, Some(5));
    }

    #[tokio::test]
    async fn update_session_settings_nonexistent_returns_false() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);
        let result = manager
            .update_session_settings(&Uuid::new_v4(), Some(true), None, None)
            .await;
        assert!(!result);
    }

    // ── subscribe_activity ───────────────────────────────────────────

    #[test]
    fn subscribe_activity_returns_receiver() {
        let pty = Arc::new(PtyManager::new());
        let manager = AgentManager::new(pty, vec![]);
        let _rx = manager.subscribe_activity();
    }
}
