use crate::activity::AgentActivity;
use crate::runners::AgentType;
use lw_pty::PtySession;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

use super::AgentManager;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ResumabilityStatus {
    Resumable,
    Unresumable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Starting,
    Running,
    Stopped,
    Failed,
    Restored,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentHandle {
    pub session_id: Uuid,
    pub agent_type: AgentType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_name: Option<String>,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i32>,
    pub workspace_path: PathBuf,
    pub status: AgentStatus,
    #[serde(skip_serializing)]
    pub process_id: Option<u32>,
    pub resumability_status: ResumabilityStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_failure_reason: Option<String>,
    pub recovered_from_previous: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub activity: AgentActivity,
}

#[derive(Debug, Clone)]
pub struct ScrollbackRawResult {
    pub data: Vec<u8>,
    pub start_offset: usize,
    pub end_offset: usize,
    pub has_more: bool,
}

fn generate_conversation_id() -> String {
    Uuid::new_v4().to_string()
}

/// Builds the environment for a PTY-spawned agent process.
///
/// Injects variables that the daemon's launchd environment lacks but that
/// interactive CLI agents (and the MCP servers they spawn) require:
///
/// - `PATH`: resolved from a login shell so Homebrew/nvm/cargo tools are
///   visible.
/// - `TERM` / `COLORTERM`: the PTY provides a colour-capable terminal;
///   without these Claude Code's Ink TUI degrades to dumb/broken rendering.
///
/// Runner-supplied values always take precedence over the injected defaults.
fn build_env(runner: &dyn crate::runners::AgentRunner) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = runner.env().into_iter().collect();

    if !env.iter().any(|(k, _)| k == "PATH") {
        if let Some(path) = crate::runners::resolve_login_shell_path() {
            env.push(("PATH".to_string(), path));
        }
    }
    if !env.iter().any(|(k, _)| k == "TERM") {
        env.push(("TERM".to_string(), "xterm-256color".to_string()));
    }
    if !env.iter().any(|(k, _)| k == "COLORTERM") {
        env.push(("COLORTERM".to_string(), "truecolor".to_string()));
    }

    env
}

fn normalized_name(custom_name: Option<String>) -> Option<String> {
    custom_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
}

fn launch_for_start(
    agent_type: AgentType,
    command: String,
    base_args: Vec<String>,
    conversation_id: &str,
) -> (String, Vec<String>) {
    match agent_type {
        AgentType::ClaudeCode => {
            let mut args = vec!["--session-id".to_string(), conversation_id.to_string()];
            args.extend(base_args);
            (command, args)
        }
        _ => (command, base_args),
    }
}

fn launch_for_resume(
    agent_type: AgentType,
    command: String,
    conversation_id: &str,
) -> (String, Vec<String>) {
    match agent_type {
        AgentType::ClaudeCode => (
            command,
            vec!["--resume".to_string(), conversation_id.to_string()],
        ),
        AgentType::Codex => (
            command,
            vec!["resume".to_string(), conversation_id.to_string()],
        ),
        AgentType::Gemini => (
            command,
            vec!["--resume".to_string(), conversation_id.to_string()],
        ),
    }
}

impl AgentManager {
    pub async fn start_session(
        &self,
        agent_type: AgentType,
        workspace_path: PathBuf,
        custom_name: Option<String>,
    ) -> anyhow::Result<(Uuid, Arc<PtySession>)> {
        let runner = self
            .runners
            .iter()
            .find(|r| r.agent_type() == agent_type)
            .ok_or_else(|| anyhow::anyhow!("Unknown agent type: {:?}", agent_type))?;

        if !runner.is_installed() {
            anyhow::bail!("Agent {} is not installed", runner.name());
        }

        let session_id = Uuid::new_v4();
        let created_at = chrono::Utc::now();
        let normalized_name = normalized_name(custom_name);
        let conversation_id = generate_conversation_id();

        let args = runner.args(&workspace_path);
        let env = build_env(runner.as_ref());

        let (program, args) = launch_for_start(
            agent_type,
            crate::runners::resolve_command_path(&runner.command())
                .unwrap_or_else(|| runner.command()),
            args,
            &conversation_id,
        );
        let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        let session = self
            .pty_manager
            .create(
                session_id,
                &program,
                &args_refs,
                &workspace_path,
                env,
                (120, 40),
            )
            .await?;

        let process_id = session.child_pid;

        let handle = AgentHandle {
            session_id: session.id,
            agent_type,
            conversation_id: Some(conversation_id),
            custom_name: normalized_name,
            pinned: false,
            icon: None,
            sort_order: None,
            workspace_path,
            status: AgentStatus::Running,
            process_id,
            resumability_status: ResumabilityStatus::Resumable,
            resume_failure_reason: None,
            recovered_from_previous: false,
            created_at,
            activity: AgentActivity::unknown("session_started", created_at),
        };

        self.handles.write().await.insert(session.id, handle);
        self.recorder
            .ensure_activity_state(session.id, created_at, "session_started")
            .await;
        self.recorder
            .ensure_activity_monitor(
                session.id,
                session.clone(),
                &self.activity_monitors,
                &self.handles,
            )
            .await;
        Ok((session.id, session))
    }

    pub(crate) async fn restore_session(
        &self,
        persisted: super::PersistedAgentInfo,
    ) -> anyhow::Result<Uuid> {
        // Kill any stale process from a previous daemon run.
        if let Some(old_pid) = persisted.pid {
            if crate::process::is_process_alive(old_pid) {
                tracing::info!(
                    session_id = %persisted.session_id,
                    pid = old_pid,
                    "Killing stale agent process before restoring session",
                );
                crate::process::terminate_process(old_pid);
            }
        }

        let runner = self
            .runners
            .iter()
            .find(|r| r.agent_type() == persisted.agent_type)
            .ok_or_else(|| anyhow::anyhow!("Unknown agent type: {:?}", persisted.agent_type))?;

        if !runner.is_installed() {
            anyhow::bail!("Agent {} is not installed", runner.name());
        }

        let session_id = persisted.session_id;
        let created_at = persisted.created_at.unwrap_or_else(chrono::Utc::now);
        let workspace_path = persisted.workspace_path;
        let normalized_name = normalized_name(persisted.custom_name.clone());

        let preferred_conversation_id = persisted
            .conversation_id
            .clone()
            .unwrap_or_else(generate_conversation_id);

        let resume_result = async {
            let env = build_env(runner.as_ref());

            let (program, args) = launch_for_resume(
                persisted.agent_type,
                crate::runners::resolve_command_path(&runner.command())
                    .unwrap_or_else(|| runner.command()),
                &preferred_conversation_id,
            );
            let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            self.pty_manager
                .create(
                    session_id,
                    &program,
                    &args_refs,
                    &workspace_path,
                    env,
                    (120, 40),
                )
                .await
        }
        .await;

        let (
            session,
            resumability_status,
            resume_failure_reason,
            conversation_id,
            recovered_from_previous,
        ) = match resume_result {
            Ok(session) => (
                session,
                ResumabilityStatus::Resumable,
                None,
                preferred_conversation_id,
                true,
            ),
            Err(resume_err) => {
                let fresh_conversation_id = generate_conversation_id();
                let env = build_env(runner.as_ref());

                let (program, args) = launch_for_start(
                    persisted.agent_type,
                    crate::runners::resolve_command_path(&runner.command())
                        .unwrap_or_else(|| runner.command()),
                    runner.args(&workspace_path),
                    &fresh_conversation_id,
                );
                let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                let session = self
                    .pty_manager
                    .create(
                        session_id,
                        &program,
                        &args_refs,
                        &workspace_path,
                        env,
                        (120, 40),
                    )
                    .await?;
                (
                    session,
                    ResumabilityStatus::Unresumable,
                    Some(format!(
                        "failed resuming conversation {}: {}",
                        preferred_conversation_id, resume_err
                    )),
                    fresh_conversation_id,
                    false,
                )
            }
        };

        let process_id = session.child_pid;

        let handle = AgentHandle {
            session_id,
            agent_type: persisted.agent_type,
            conversation_id: Some(conversation_id),
            custom_name: normalized_name,
            pinned: persisted.pinned,
            icon: persisted.icon,
            sort_order: persisted.sort_order,
            workspace_path,
            status: AgentStatus::Restored,
            process_id,
            resumability_status,
            resume_failure_reason,
            recovered_from_previous,
            created_at,
            activity: AgentActivity::unknown("session_restored", created_at),
        };

        self.handles.write().await.insert(session_id, handle);
        self.recorder
            .ensure_activity_state(session_id, created_at, "session_restored")
            .await;
        self.recorder
            .ensure_activity_monitor(
                session_id,
                session.clone(),
                &self.activity_monitors,
                &self.handles,
            )
            .await;
        Ok(session_id)
    }

    pub async fn stop_session(&self, session_id: &Uuid) -> anyhow::Result<()> {
        let handle = self.handles.read().await.get(session_id).cloned();

        if let Some(task) = self.activity_monitors.write().await.remove(session_id) {
            task.abort();
        }

        if let Ok(session) = self.pty_manager.get(session_id).await {
            let _ = session.kill().await;
        }

        if let Some(pid) = handle.as_ref().and_then(|h| h.process_id) {
            let _ = crate::process::terminate_process(pid);
        }

        if let Some(handle) = self.handles.write().await.get_mut(session_id) {
            handle.status = AgentStatus::Stopped;
        }
        self.recorder
            .record_stopped(*session_id, "session_stopped")
            .await;

        Ok(())
    }

    pub async fn ensure_pty_attached(&self, session_id: &Uuid) -> anyhow::Result<Arc<PtySession>> {
        self.reconcile_session_statuses().await;

        let handle = self
            .handles
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        // If the session is stopped but has a conversation_id, we can re-spawn
        // it below. Only bail for sessions that are truly unrecoverable.
        let is_active =
            handle.status == AgentStatus::Running || handle.status == AgentStatus::Restored;
        if !is_active && handle.conversation_id.is_none() {
            anyhow::bail!("Session is not running and has no conversation to resume");
        }

        if let Ok(existing) = self.pty_manager.get(session_id).await {
            if !existing.is_stopped() {
                self.recorder
                    .ensure_activity_monitor(
                        *session_id,
                        existing.clone(),
                        &self.activity_monitors,
                        &self.handles,
                    )
                    .await;
                return Ok(existing);
            }
        }

        // If already marked unresumable, a previous attempt already fell back
        // to a fresh session.  Just re-launch fresh again.
        if handle.resumability_status == ResumabilityStatus::Unresumable {
            return self.spawn_fresh_for_session(session_id, &handle).await;
        }

        // PTY is gone or stopped — re-spawn the agent process, resuming its
        // conversation so the user gets back to where they left off.
        tracing::info!(
            session_id = %session_id,
            agent_type = %handle.agent_type,
            "PTY gone, re-spawning agent to resume conversation",
        );

        self.restore_session(super::PersistedAgentInfo {
            session_id: handle.session_id,
            workspace_path: handle.workspace_path.clone(),
            agent_type: handle.agent_type,
            conversation_id: handle.conversation_id.clone(),
            custom_name: handle.custom_name.clone(),
            pinned: handle.pinned,
            icon: handle.icon.clone(),
            sort_order: handle.sort_order,
            resumability_status: Some(handle.resumability_status),
            resume_failure_reason: handle.resume_failure_reason.clone(),
            created_at: Some(handle.created_at),
            pid: handle.process_id,
        })
        .await?;

        let session = self.pty_manager.get(session_id).await.map_err(|_| {
            anyhow::anyhow!(
                "Failed to re-attach PTY after re-spawning agent {}",
                session_id
            )
        })?;

        self.recorder
            .ensure_activity_monitor(
                *session_id,
                session.clone(),
                &self.activity_monitors,
                &self.handles,
            )
            .await;
        Ok(session)
    }

    /// Start a fresh agent process (no `--resume`), reusing the same
    /// session ID.  Marks the handle as unresumable so the UI can warn
    /// the user that the previous conversation was lost.
    async fn spawn_fresh_for_session(
        &self,
        session_id: &Uuid,
        handle: &AgentHandle,
    ) -> anyhow::Result<Arc<PtySession>> {
        // Clean up any leftover PTY from the failed resume attempt so its
        // output history doesn't bleed into the fresh session.
        let _ = self.pty_manager.kill(session_id).await;
        let _ = self.pty_manager.remove(session_id).await;

        let runner = self
            .runners
            .iter()
            .find(|r| r.agent_type() == handle.agent_type)
            .ok_or_else(|| anyhow::anyhow!("Unknown agent type: {:?}", handle.agent_type))?;

        if !runner.is_installed() {
            anyhow::bail!("Agent {} is not installed", runner.name());
        }

        let fresh_conversation_id = Uuid::new_v4().to_string();
        let env = build_env(runner.as_ref());
        let (program, args) = launch_for_start(
            handle.agent_type,
            crate::runners::resolve_command_path(&runner.command())
                .unwrap_or_else(|| runner.command()),
            runner.args(&handle.workspace_path),
            &fresh_conversation_id,
        );
        let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        let session = self
            .pty_manager
            .create(
                *session_id,
                &program,
                &args_refs,
                &handle.workspace_path,
                env,
                (120, 40),
            )
            .await?;

        let process_id = session.child_pid;

        if let Some(h) = self.handles.write().await.get_mut(session_id) {
            h.conversation_id = Some(fresh_conversation_id);
            h.process_id = process_id;
            h.status = AgentStatus::Running;
            h.resumability_status = ResumabilityStatus::Unresumable;
            h.resume_failure_reason =
                Some("Previous conversation could not be resumed — started a fresh session".into());
        }

        self.recorder
            .ensure_activity_monitor(
                *session_id,
                session.clone(),
                &self.activity_monitors,
                &self.handles,
            )
            .await;
        Ok(session)
    }

    pub async fn get_handle(&self, session_id: &Uuid) -> Option<AgentHandle> {
        self.reconcile_session_statuses().await;
        let mut handle = self.handles.read().await.get(session_id).cloned()?;
        let is_active =
            handle.status == AgentStatus::Running || handle.status == AgentStatus::Restored;
        handle.activity = self
            .recorder
            .activity_snapshot_for_handle(handle.session_id, is_active)
            .await;
        if handle.status == AgentStatus::Restored {
            // Only transition to Running if there is a live process or PTY.
            // Lazy-spawn placeholders must stay Restored.
            let has_live_pty = self
                .pty_manager
                .get(session_id)
                .await
                .is_ok_and(|s| !s.is_stopped());
            let has_live_process = handle
                .process_id
                .is_some_and(crate::process::is_process_alive);
            if has_live_pty || has_live_process {
                if let Some(stored) = self.handles.write().await.get_mut(session_id) {
                    if stored.status == AgentStatus::Restored {
                        stored.status = AgentStatus::Running;
                    }
                }
            }
        }
        Some(handle)
    }

    pub async fn list_sessions(&self) -> Vec<AgentHandle> {
        self.reconcile_session_statuses().await;
        let mut handles: Vec<AgentHandle> = self.handles.read().await.values().cloned().collect();
        for handle in &mut handles {
            let is_active =
                handle.status == AgentStatus::Running || handle.status == AgentStatus::Restored;
            handle.activity = self
                .recorder
                .activity_snapshot_for_handle(handle.session_id, is_active)
                .await;
        }
        self.transition_restored_to_running().await;
        handles
    }

    pub async fn update_status(&self, session_id: &Uuid, status: AgentStatus) {
        if let Some(handle) = self.handles.write().await.get_mut(session_id) {
            handle.status = status;
        }
        if status != AgentStatus::Running {
            self.recorder
                .record_stopped(*session_id, "status_not_running")
                .await;
        }
    }

    pub async fn input_session(&self, session_id: &Uuid, data: &[u8]) -> anyhow::Result<()> {
        let session = match self.pty_manager.get(session_id).await {
            Ok(session) if !session.is_stopped() => session,
            _ => self.ensure_pty_attached(session_id).await?,
        };
        session.write(data).await?;
        self.recorder.record_input(*session_id, data).await;
        Ok(())
    }

    pub async fn get_activity(&self, session_id: &Uuid) -> AgentActivity {
        self.recorder
            .activity_snapshot(*session_id, "activity_requested")
            .await
    }

    pub async fn capture_scrollback_raw(
        &self,
        session_id: &Uuid,
        before_offset: Option<usize>,
        max_bytes: usize,
    ) -> anyhow::Result<ScrollbackRawResult> {
        // Read from whatever PTY exists — do NOT spawn a new process just
        // to read scrollback history.
        let session = self
            .pty_manager
            .get(session_id)
            .await
            .map_err(|_| anyhow::anyhow!("No terminal history available for {}", session_id))?;
        let (data, start_offset, end_offset, has_more) =
            session.output_slice_before(before_offset, max_bytes);
        Ok(ScrollbackRawResult {
            data,
            start_offset,
            end_offset,
            has_more,
        })
    }

    pub async fn rename_session(&self, session_id: &Uuid, custom_name: Option<String>) -> bool {
        let normalized = normalized_name(custom_name);
        if let Some(handle) = self.handles.write().await.get_mut(session_id) {
            handle.custom_name = normalized;
            true
        } else {
            false
        }
    }

    pub async fn update_session_settings(
        &self,
        session_id: &Uuid,
        pinned: Option<bool>,
        icon: Option<Option<String>>,
        sort_order: Option<Option<i32>>,
    ) -> bool {
        if let Some(handle) = self.handles.write().await.get_mut(session_id) {
            if let Some(pinned) = pinned {
                handle.pinned = pinned;
            }
            if let Some(icon) = icon {
                handle.icon = icon;
            }
            if let Some(sort_order) = sort_order {
                handle.sort_order = sort_order;
            }
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── normalized_name ──────────────────────────────────────────────

    #[test]
    fn normalized_name_none() {
        assert_eq!(normalized_name(None), None);
    }

    #[test]
    fn normalized_name_empty_string() {
        assert_eq!(normalized_name(Some("".to_string())), None);
    }

    #[test]
    fn normalized_name_whitespace_only() {
        assert_eq!(normalized_name(Some("   ".to_string())), None);
    }

    #[test]
    fn normalized_name_trims_whitespace() {
        assert_eq!(
            normalized_name(Some("  hello  ".to_string())),
            Some("hello".to_string())
        );
    }

    #[test]
    fn normalized_name_preserves_inner_spaces() {
        assert_eq!(
            normalized_name(Some("hello world".to_string())),
            Some("hello world".to_string())
        );
    }

    // ── launch_for_start ─────────────────────────────────────────────

    #[test]
    fn launch_for_start_claude_code_prepends_session_id() {
        let (cmd, args) = launch_for_start(
            AgentType::ClaudeCode,
            "claude".to_string(),
            vec!["--flag".to_string()],
            "conv-123",
        );
        assert_eq!(cmd, "claude");
        assert_eq!(args, vec!["--session-id", "conv-123", "--flag"]);
    }

    #[test]
    fn launch_for_start_codex_passes_through() {
        let (cmd, args) = launch_for_start(
            AgentType::Codex,
            "codex".to_string(),
            vec!["arg1".to_string()],
            "conv-456",
        );
        assert_eq!(cmd, "codex");
        assert_eq!(args, vec!["arg1"]);
    }

    #[test]
    fn launch_for_start_gemini_passes_through() {
        let (cmd, args) =
            launch_for_start(AgentType::Gemini, "gemini".to_string(), vec![], "conv-789");
        assert_eq!(cmd, "gemini");
        assert!(args.is_empty());
    }

    // ── launch_for_resume ────────────────────────────────────────────

    #[test]
    fn launch_for_resume_claude_code() {
        let (cmd, args) =
            launch_for_resume(AgentType::ClaudeCode, "claude".to_string(), "conv-123");
        assert_eq!(cmd, "claude");
        assert_eq!(args, vec!["--resume", "conv-123"]);
    }

    #[test]
    fn launch_for_resume_codex() {
        let (cmd, args) = launch_for_resume(AgentType::Codex, "codex".to_string(), "conv-456");
        assert_eq!(cmd, "codex");
        assert_eq!(args, vec!["resume", "conv-456"]);
    }

    #[test]
    fn launch_for_resume_gemini() {
        let (cmd, args) = launch_for_resume(AgentType::Gemini, "gemini".to_string(), "conv-789");
        assert_eq!(cmd, "gemini");
        assert_eq!(args, vec!["--resume", "conv-789"]);
    }

    // ── AgentStatus serde ────────────────────────────────────────────

    #[test]
    fn agent_status_serde_roundtrip() {
        for status in [
            AgentStatus::Starting,
            AgentStatus::Running,
            AgentStatus::Stopped,
            AgentStatus::Failed,
            AgentStatus::Restored,
        ] {
            let json = serde_json::to_string(&status).unwrap();
            let parsed: AgentStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, status);
        }
    }

    #[test]
    fn agent_status_lowercase_serialization() {
        assert_eq!(
            serde_json::to_string(&AgentStatus::Running).unwrap(),
            "\"running\""
        );
        assert_eq!(
            serde_json::to_string(&AgentStatus::Stopped).unwrap(),
            "\"stopped\""
        );
        assert_eq!(
            serde_json::to_string(&AgentStatus::Starting).unwrap(),
            "\"starting\""
        );
        assert_eq!(
            serde_json::to_string(&AgentStatus::Failed).unwrap(),
            "\"failed\""
        );
        assert_eq!(
            serde_json::to_string(&AgentStatus::Restored).unwrap(),
            "\"restored\""
        );
    }

    // ── ResumabilityStatus serde ─────────────────────────────────────

    #[test]
    fn resumability_status_serde_roundtrip() {
        for status in [
            ResumabilityStatus::Resumable,
            ResumabilityStatus::Unresumable,
        ] {
            let json = serde_json::to_string(&status).unwrap();
            let parsed: ResumabilityStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, status);
        }
    }

    #[test]
    fn resumability_status_snake_case_serialization() {
        assert_eq!(
            serde_json::to_string(&ResumabilityStatus::Resumable).unwrap(),
            "\"resumable\""
        );
        assert_eq!(
            serde_json::to_string(&ResumabilityStatus::Unresumable).unwrap(),
            "\"unresumable\""
        );
    }

    // ── AgentHandle serialization ────────────────────────────────────

    fn make_handle() -> AgentHandle {
        let now = chrono::Utc::now();
        AgentHandle {
            session_id: Uuid::nil(),
            agent_type: AgentType::ClaudeCode,
            conversation_id: Some("conv-1".to_string()),
            custom_name: Some("my session".to_string()),
            pinned: false,
            icon: None,
            sort_order: None,
            workspace_path: PathBuf::from("/tmp/ws"),
            status: AgentStatus::Running,
            process_id: Some(12345),
            resumability_status: ResumabilityStatus::Resumable,
            resume_failure_reason: None,
            recovered_from_previous: false,
            created_at: now,
            activity: AgentActivity::unknown("test", now),
        }
    }

    #[test]
    fn agent_handle_serializes_without_process_id() {
        let handle = make_handle();
        let json = serde_json::to_string(&handle).unwrap();
        // process_id has #[serde(skip_serializing)]
        assert!(!json.contains("process_id"));
    }

    #[test]
    fn agent_handle_omits_none_fields() {
        let mut handle = make_handle();
        handle.icon = None;
        handle.sort_order = None;
        handle.resume_failure_reason = None;
        let json = serde_json::to_string(&handle).unwrap();
        assert!(!json.contains("\"icon\""));
        assert!(!json.contains("\"sort_order\""));
        assert!(!json.contains("\"resume_failure_reason\""));
    }

    #[test]
    fn agent_handle_includes_present_optional_fields() {
        let mut handle = make_handle();
        handle.icon = Some("rocket".to_string());
        handle.sort_order = Some(5);
        let json = serde_json::to_string(&handle).unwrap();
        assert!(json.contains("\"icon\":\"rocket\""));
        assert!(json.contains("\"sort_order\":5"));
    }

    #[test]
    fn agent_handle_contains_expected_fields() {
        let handle = make_handle();
        let value: serde_json::Value = serde_json::to_value(&handle).unwrap();
        assert_eq!(value["session_id"], "00000000-0000-0000-0000-000000000000");
        assert_eq!(value["agent_type"], "claude_code");
        assert_eq!(value["status"], "running");
        assert_eq!(value["pinned"], false);
        assert_eq!(value["conversation_id"], "conv-1");
        assert_eq!(value["custom_name"], "my session");
        assert_eq!(value["resumability_status"], "resumable");
        assert_eq!(value["recovered_from_previous"], false);
    }

    // ── ScrollbackRawResult ──────────────────────────────────────────

    #[test]
    fn scrollback_raw_result_fields() {
        let result = ScrollbackRawResult {
            data: vec![1, 2, 3],
            start_offset: 10,
            end_offset: 13,
            has_more: true,
        };
        assert_eq!(result.data, vec![1, 2, 3]);
        assert_eq!(result.start_offset, 10);
        assert_eq!(result.end_offset, 13);
        assert!(result.has_more);
    }

    #[test]
    fn scrollback_raw_result_clone() {
        let result = ScrollbackRawResult {
            data: vec![4, 5],
            start_offset: 0,
            end_offset: 2,
            has_more: false,
        };
        let cloned = result.clone();
        assert_eq!(cloned.data, result.data);
        assert_eq!(cloned.has_more, result.has_more);
    }

    // ── generate_conversation_id ─────────────────────────────────────

    #[test]
    fn generate_conversation_id_is_valid_uuid() {
        let id = generate_conversation_id();
        assert!(Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn generate_conversation_id_unique() {
        let id1 = generate_conversation_id();
        let id2 = generate_conversation_id();
        assert_ne!(id1, id2);
    }
}
