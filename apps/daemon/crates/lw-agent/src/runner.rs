use crate::claude::ClaudeCodeRunner;
use crate::codex::CodexRunner;
use crate::gemini::GeminiRunner;
use lw_pty::{PtyManager, PtySession};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ClaudeCode,
    Codex,
    Gemini,
}

impl std::fmt::Display for AgentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentType::ClaudeCode => write!(f, "claude_code"),
            AgentType::Codex => write!(f, "codex"),
            AgentType::Gemini => write!(f, "gemini"),
        }
    }
}

impl std::str::FromStr for AgentType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "claude_code" => Ok(AgentType::ClaudeCode),
            "codex" => Ok(AgentType::Codex),
            "gemini" => Ok(AgentType::Gemini),
            _ => Err(format!("Unknown agent type: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AvailableAgent {
    pub agent_type: AgentType,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentHandle {
    pub session_id: Uuid,
    pub agent_type: AgentType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_name: Option<String>,
    pub workspace_path: PathBuf,
    pub status: AgentStatus,
    #[serde(skip_serializing)]
    pub process_id: Option<u32>,
    #[serde(skip_serializing)]
    pub tty_path: Option<String>,
    #[serde(skip_serializing)]
    pub tmux_session: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProcessSessionMeta {
    session_id: Uuid,
    agent_type: AgentType,
    custom_name: Option<String>,
    workspace_path: PathBuf,
    tmux_session: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
struct DiscoveredProcess {
    pid: u32,
    tty_path: Option<String>,
    metadata: ProcessSessionMeta,
}

const META_ENV_KEY: &str = "LOOPWIRE_META_HEX";

pub trait AgentRunner: Send + Sync {
    fn agent_type(&self) -> AgentType;
    fn name(&self) -> &str;
    fn command(&self) -> String;
    fn args(&self, workspace: &Path) -> Vec<String>;
    fn env(&self) -> HashMap<String, String>;
    fn is_installed(&self) -> bool;
    fn detect_version(&self) -> Option<String>;
}

pub struct AgentManager {
    pty_manager: Arc<PtyManager>,
    runners: Vec<Box<dyn AgentRunner>>,
    handles: Arc<RwLock<HashMap<Uuid, AgentHandle>>>,
    tmux_available: bool,
}

impl AgentManager {
    pub fn new(pty_manager: Arc<PtyManager>) -> Self {
        let runners: Vec<Box<dyn AgentRunner>> = vec![
            Box::new(ClaudeCodeRunner),
            Box::new(CodexRunner),
            Box::new(GeminiRunner),
        ];
        let tmux_available = is_tmux_available();
        let recovered = recover_handles_from_running_processes();
        let recovered = if tmux_available {
            let mut tmux_only = HashMap::new();
            for (session_id, handle) in recovered {
                let has_tmux = handle
                    .tmux_session
                    .as_deref()
                    .map(tmux_session_exists)
                    .unwrap_or(false);
                if has_tmux {
                    tmux_only.insert(session_id, handle);
                } else if let Some(pid) = handle.process_id {
                    let _ = terminate_process(pid);
                }
            }
            tmux_only
        } else {
            if !recovered.is_empty() {
                tracing::warn!(
                    "Detected {} lingering agent process(es) from a previous backend instance; terminating them",
                    recovered.len()
                );
                for handle in recovered.values() {
                    if let Some(pid) = handle.process_id {
                        let _ = terminate_process(pid);
                    }
                }
            }
            HashMap::new()
        };
        Self {
            pty_manager,
            runners,
            handles: Arc::new(RwLock::new(recovered)),
            tmux_available,
        }
    }

    pub fn available_agents(&self) -> Vec<AvailableAgent> {
        self.runners
            .iter()
            .map(|r| AvailableAgent {
                agent_type: r.agent_type(),
                name: r.name().to_string(),
                installed: r.is_installed(),
                version: r.detect_version(),
            })
            .collect()
    }

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

        let args = runner.args(&workspace_path);
        let session_id = Uuid::new_v4();
        let created_at = chrono::Utc::now();
        let normalized_name = custom_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(ToOwned::to_owned);

        let mut env: Vec<(String, String)> = runner.env().into_iter().collect();
        let tmux_session = self
            .tmux_available
            .then(|| format!("loopwire-{}", session_id));
        let mut meta_hex: Option<String> = None;
        let metadata = ProcessSessionMeta {
            session_id,
            agent_type,
            custom_name: normalized_name.clone(),
            workspace_path: workspace_path.clone(),
            tmux_session: tmux_session.clone(),
            created_at,
        };
        if let Ok(meta_json) = serde_json::to_vec(&metadata) {
            let encoded = to_hex(&meta_json);
            env.push((META_ENV_KEY.to_string(), encoded.clone()));
            meta_hex = Some(encoded);
        }

        let runner_command = runner.command();
        let (program, args): (&str, Vec<String>) = if let Some(tmux_session_name) = &tmux_session {
            let mut command_line = shell_escape_word(&runner_command);
            for arg in &args {
                command_line.push(' ');
                command_line.push_str(&shell_escape_word(arg));
            }

            (
                "tmux",
                vec![
                    "new-session".to_string(),
                    "-A".to_string(),
                    "-s".to_string(),
                    tmux_session_name.clone(),
                    command_line,
                    ";".to_string(),
                    "set-option".to_string(),
                    "-t".to_string(),
                    tmux_session_name.clone(),
                    "status".to_string(),
                    "off".to_string(),
                    ";".to_string(),
                    "set-environment".to_string(),
                    "-t".to_string(),
                    tmux_session_name.clone(),
                    META_ENV_KEY.to_string(),
                    meta_hex.clone().unwrap_or_default(),
                ],
            )
        } else {
            (&runner_command, args)
        };

        let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let session = self
            .pty_manager
            .create(
                session_id,
                program,
                &args_refs,
                &workspace_path,
                env,
                120,
                40,
            )
            .await?;

        let mut process_id = None;
        let mut tty_path = None;
        for _ in 0..10 {
            if let Some(found) = find_discovered_by_session_id(session.id) {
                process_id = Some(found.pid);
                tty_path = found.tty_path;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        let handle = AgentHandle {
            session_id: session.id,
            agent_type,
            custom_name: normalized_name,
            workspace_path,
            status: AgentStatus::Running,
            process_id,
            tty_path,
            tmux_session,
            created_at,
        };

        self.handles.write().await.insert(session.id, handle);
        Ok((session.id, session))
    }

    pub async fn stop_session(&self, session_id: &Uuid) -> anyhow::Result<()> {
        let handle = self.handles.read().await.get(session_id).cloned();

        if let Some(tmux_session) = handle.as_ref().and_then(|h| h.tmux_session.clone()) {
            let _ = terminate_tmux_session(&tmux_session);
        }

        if let Ok(session) = self.pty_manager.get(session_id).await {
            let _ = session.kill().await;
        } else if let Some(pid) = handle.as_ref().and_then(|h| h.process_id) {
            let _ = terminate_process(pid);
        }

        if let Some(handle) = self.handles.write().await.get_mut(session_id) {
            handle.status = AgentStatus::Stopped;
        }
        Ok(())
    }

    pub async fn ensure_pty_attached(&self, session_id: &Uuid) -> anyhow::Result<Arc<PtySession>> {
        self.reconcile_session_statuses().await;

        let mut handle = self
            .handles
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        if handle.status != AgentStatus::Running {
            anyhow::bail!("Session is not running");
        }

        if let Some(tmux_session) = handle.tmux_session.clone() {
            if let Ok(existing) = self.pty_manager.get(session_id).await {
                if !existing.is_stopped() {
                    return Ok(existing);
                }
            }
            if let Some(stale) = self.pty_manager.remove(session_id).await {
                let _ = stale.kill().await;
            }
            return self
                .attach_tmux_session(*session_id, &tmux_session, &handle.workspace_path)
                .await;
        }

        if let Ok(existing) = self.pty_manager.get(session_id).await {
            return Ok(existing);
        }

        if handle.tty_path.is_none() {
            if let Some(found) = find_discovered_by_session_id(*session_id) {
                handle.process_id = Some(found.pid);
                handle.tty_path = found.tty_path;
                if let Some(stored) = self.handles.write().await.get_mut(session_id) {
                    stored.process_id = handle.process_id;
                    stored.tty_path = handle.tty_path.clone();
                }
            }
        }

        let tty_path = handle
            .tty_path
            .ok_or_else(|| anyhow::anyhow!("No tty is available for reattachment"))?;

        match self
            .pty_manager
            .attach_tty(*session_id, Path::new(&tty_path), 120, 40)
            .await
        {
            Ok(session) => Ok(session),
            Err(_) => {
                let tmux_session = handle
                    .tmux_session
                    .ok_or_else(|| anyhow::anyhow!("No tty is available for reattachment"))?;
                self.attach_tmux_session(*session_id, &tmux_session, &handle.workspace_path)
                    .await
            }
        }
    }

    pub async fn get_handle(&self, session_id: &Uuid) -> Option<AgentHandle> {
        self.reconcile_session_statuses().await;
        self.handles.read().await.get(session_id).cloned()
    }

    pub async fn list_sessions(&self) -> Vec<AgentHandle> {
        self.reconcile_session_statuses().await;
        self.handles.read().await.values().cloned().collect()
    }

    pub async fn update_status(&self, session_id: &Uuid, status: AgentStatus) {
        if let Some(handle) = self.handles.write().await.get_mut(session_id) {
            handle.status = status;
        }
    }

    pub fn tmux_enabled(&self) -> bool {
        self.tmux_available
    }

    pub async fn shutdown_all(&self) {
        let session_ids: Vec<Uuid> = self.handles.read().await.keys().cloned().collect();
        for session_id in session_ids {
            let _ = self.stop_session(&session_id).await;
        }

        self.pty_manager.kill_all().await;

        for discovered in scan_session_metadata_from_processes() {
            let _ = terminate_process(discovered.pid);
        }

        let mut handles = self.handles.write().await;
        for handle in handles.values_mut() {
            handle.status = AgentStatus::Stopped;
            handle.process_id = None;
            handle.tty_path = None;
            handle.tmux_session = None;
        }
    }

    async fn attach_tmux_session(
        &self,
        session_id: Uuid,
        tmux_session: &str,
        workspace_path: &Path,
    ) -> anyhow::Result<Arc<PtySession>> {
        let args = vec![
            "set-option".to_string(),
            "-t".to_string(),
            tmux_session.to_string(),
            "status".to_string(),
            "off".to_string(),
            ";".to_string(),
            "attach-session".to_string(),
            "-t".to_string(),
            tmux_session.to_string(),
        ];
        let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        let session = self
            .pty_manager
            .create(
                session_id,
                "tmux",
                &args_refs,
                workspace_path,
                Vec::new(),
                120,
                40,
            )
            .await?;
        Ok(session)
    }

    async fn reconcile_session_statuses(&self) {
        let discovered: HashMap<Uuid, DiscoveredProcess> = scan_session_metadata_from_processes()
            .into_iter()
            .map(|p| (p.metadata.session_id, p))
            .collect();

        let mut handles = self.handles.write().await;
        for (session_id, handle) in handles.iter_mut() {
            let discovered_entry = discovered.get(session_id);
            if let Some(entry) = discovered_entry {
                handle.process_id = Some(entry.pid);
                if entry.tty_path.is_some() {
                    handle.tty_path = entry.tty_path.clone();
                }
            }

            match self.pty_manager.get(session_id).await {
                Ok(session) => {
                    let running_via_process = if let Some(tmux_session) = handle.tmux_session.as_deref() {
                        tmux_session_exists(tmux_session)
                    } else {
                        handle.process_id.map_or(false, is_process_alive)
                    };
                    handle.status = if session.is_stopped() {
                        if running_via_process {
                            AgentStatus::Running
                        } else {
                            AgentStatus::Stopped
                        }
                    } else {
                        AgentStatus::Running
                    };
                }
                Err(_) => {
                    let running_via_process = if let Some(tmux_session) = handle.tmux_session.as_deref() {
                        tmux_session_exists(tmux_session)
                    } else {
                        handle.process_id.map_or(false, is_process_alive)
                    };
                    handle.status = if running_via_process {
                        AgentStatus::Running
                    } else {
                        AgentStatus::Stopped
                    };
                }
            }
        }

        for discovered_entry in discovered.values() {
            handles
                .entry(discovered_entry.metadata.session_id)
                .or_insert_with(|| AgentHandle {
                    session_id: discovered_entry.metadata.session_id,
                    agent_type: discovered_entry.metadata.agent_type,
                    custom_name: discovered_entry.metadata.custom_name.clone(),
                    workspace_path: discovered_entry.metadata.workspace_path.clone(),
                    status: AgentStatus::Running,
                    process_id: Some(discovered_entry.pid),
                    tty_path: discovered_entry.tty_path.clone(),
                    tmux_session: discovered_entry.metadata.tmux_session.clone(),
                    created_at: discovered_entry.metadata.created_at,
                });
        }
    }
}

fn recover_handles_from_running_processes() -> HashMap<Uuid, AgentHandle> {
    let mut handles = HashMap::new();
    for discovered in scan_session_metadata_from_processes() {
        handles.insert(
            discovered.metadata.session_id,
            AgentHandle {
                session_id: discovered.metadata.session_id,
                agent_type: discovered.metadata.agent_type,
                custom_name: discovered.metadata.custom_name,
                workspace_path: discovered.metadata.workspace_path,
                status: AgentStatus::Running,
                process_id: Some(discovered.pid),
                tty_path: discovered.tty_path,
                tmux_session: discovered.metadata.tmux_session,
                created_at: discovered.metadata.created_at,
            },
        );
    }
    handles
}

fn find_discovered_by_session_id(session_id: Uuid) -> Option<DiscoveredProcess> {
    scan_session_metadata_from_processes()
        .into_iter()
        .find(|entry| entry.metadata.session_id == session_id)
}

fn scan_session_metadata_from_processes() -> Vec<DiscoveredProcess> {
    let output = std::process::Command::new("ps")
        .args(["eww", "-axo", "pid=,tty=,command="])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut sessions = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim_start();
        let Some((pid_token, rest)) = split_once_whitespace(trimmed) else {
            continue;
        };
        let Some((tty_token, command)) = split_once_whitespace(rest) else {
            continue;
        };

        let Ok(pid) = pid_token.parse::<u32>() else {
            continue;
        };

        let Some(meta_hex) = extract_env_token(command, META_ENV_KEY) else {
            continue;
        };
        let Some(meta_bytes) = from_hex(meta_hex) else {
            continue;
        };
        let Ok(metadata) = serde_json::from_slice::<ProcessSessionMeta>(&meta_bytes) else {
            continue;
        };

        sessions.push(DiscoveredProcess {
            pid,
            tty_path: tty_path_from_token(tty_token),
            metadata,
        });
    }
    let mut by_session: HashMap<Uuid, DiscoveredProcess> = sessions
        .into_iter()
        .map(|entry| (entry.metadata.session_id, entry))
        .collect();

    for entry in scan_session_metadata_from_tmux() {
        by_session.entry(entry.metadata.session_id).or_insert(entry);
    }

    by_session.into_values().collect()
}

fn scan_session_metadata_from_tmux() -> Vec<DiscoveredProcess> {
    let output = std::process::Command::new("tmux")
        .args([
            "list-panes",
            "-a",
            "-F",
            "#{session_name}\t#{pane_pid}\t#{pane_tty}\t#{pane_current_command}\t#{pane_current_path}",
        ])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut sessions: HashMap<String, DiscoveredProcess> = HashMap::new();
    for line in stdout.lines() {
        let mut parts = line.split('\t');
        let Some(session_name) = parts.next() else {
            continue;
        };
        let Some(pid_token) = parts.next() else {
            continue;
        };
        let Some(tty_token) = parts.next() else {
            continue;
        };
        let Some(command_token) = parts.next() else {
            continue;
        };
        let Some(path_token) = parts.next() else {
            continue;
        };

        if !session_name.starts_with("loopwire-") {
            continue;
        }

        let Some(session_id_token) = session_name.strip_prefix("loopwire-") else {
            continue;
        };
        let Ok(session_id) = Uuid::parse_str(session_id_token) else {
            continue;
        };
        let Ok(pid) = pid_token.parse::<u32>() else {
            continue;
        };

        let metadata = read_tmux_session_metadata(session_name).unwrap_or_else(|| ProcessSessionMeta {
            session_id,
            agent_type: infer_agent_type_from_command(command_token),
            custom_name: None,
            workspace_path: PathBuf::from(path_token),
            tmux_session: Some(session_name.to_string()),
            created_at: chrono::Utc::now(),
        });

        sessions.entry(session_name.to_string()).or_insert_with(|| DiscoveredProcess {
            pid,
            tty_path: tty_path_from_token(tty_token),
            metadata,
        });
    }

    sessions.into_values().collect()
}

fn read_tmux_session_metadata(session_name: &str) -> Option<ProcessSessionMeta> {
    let output = std::process::Command::new("tmux")
        .args([
            "show-environment",
            "-t",
            session_name,
            META_ENV_KEY,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout);
    let token = line.trim();
    let value = token.strip_prefix(&format!("{META_ENV_KEY}="))?;
    let bytes = from_hex(value)?;
    serde_json::from_slice::<ProcessSessionMeta>(&bytes).ok()
}

fn infer_agent_type_from_command(command: &str) -> AgentType {
    match command.trim() {
        "codex" => AgentType::Codex,
        "gemini" | "gemini-cli" => AgentType::Gemini,
        _ => AgentType::ClaudeCode,
    }
}

fn split_once_whitespace(s: &str) -> Option<(&str, &str)> {
    let index = s.find(char::is_whitespace)?;
    let (left, right) = s.split_at(index);
    Some((left, right.trim_start()))
}

fn extract_env_token<'a>(s: &'a str, key: &str) -> Option<&'a str> {
    let marker = format!("{key}=");
    let start = s.find(&marker)?;
    let value = &s[start + marker.len()..];
    let end = value
        .find(|c: char| c.is_whitespace())
        .unwrap_or(value.len());
    let token = &value[..end];
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

fn tty_path_from_token(token: &str) -> Option<String> {
    let trimmed = token.trim();
    if trimmed.is_empty() || trimmed == "?" || trimmed == "??" {
        return None;
    }
    Some(format!("/dev/{trimmed}"))
}

fn to_hex(bytes: &[u8]) -> String {
    const LUT: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(LUT[(b >> 4) as usize] as char);
        out.push(LUT[(b & 0x0f) as usize] as char);
    }
    out
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let chars = s.as_bytes().chunks_exact(2);
    for pair in chars {
        let high = hex_value(pair[0])?;
        let low = hex_value(pair[1])?;
        out.push((high << 4) | low);
    }
    Some(out)
}

fn hex_value(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn terminate_process(pid: u32) -> bool {
    let term_status = std::process::Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status();
    if !matches!(term_status, Ok(s) if s.success()) {
        return false;
    }

    for _ in 0..20 {
        if !is_process_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    let kill_status = std::process::Command::new("kill")
        .arg("-KILL")
        .arg(pid.to_string())
        .status();
    matches!(kill_status, Ok(s) if s.success()) && !is_process_alive(pid)
}

fn terminate_tmux_session(name: &str) -> bool {
    let status = std::process::Command::new("tmux")
        .arg("kill-session")
        .arg("-t")
        .arg(name)
        .status();
    matches!(status, Ok(s) if s.success())
}

fn is_tmux_available() -> bool {
    std::process::Command::new("which")
        .arg("tmux")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn tmux_session_exists(name: &str) -> bool {
    let status = std::process::Command::new("tmux")
        .arg("has-session")
        .arg("-t")
        .arg(name)
        .status();
    matches!(status, Ok(s) if s.success())
}

fn shell_escape_word(input: &str) -> String {
    if input.is_empty() {
        return "''".to_string();
    }
    if input
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | ':' | '@' | '='))
    {
        return input.to_string();
    }
    let escaped = input.replace('\'', "'\\''");
    format!("'{escaped}'")
}

fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let status = std::process::Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status();
        matches!(status, Ok(s) if s.success())
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}
