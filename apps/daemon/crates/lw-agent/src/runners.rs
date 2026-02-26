use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::{OnceLock, RwLock};
use std::thread;
use std::time::{Duration, Instant};

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

pub trait AgentRunner: Send + Sync {
    fn agent_type(&self) -> AgentType;
    fn name(&self) -> &str;
    fn command(&self) -> String;
    fn args(&self, workspace: &Path) -> Vec<String>;
    fn env(&self) -> HashMap<String, String>;
    fn is_installed(&self) -> bool;
    fn detect_version(&self) -> Option<String>;
}

/// Returns the shells to try for binary detection, in order.
///
/// Starts with the user's `$SHELL` when it is a Bourne-compatible shell that
/// supports `sh -lc` semantics (bash, zsh, dash, ksh). Always appends `sh`
/// as a final fallback so detection works even if `$SHELL` is unset, exotic
/// (fish, nu, …), or already equals sh.
fn candidate_login_shells() -> Vec<String> {
    let mut shells: Vec<String> = Vec::new();

    if let Ok(user_shell) = std::env::var("SHELL") {
        let basename = user_shell.rsplit('/').next().unwrap_or(&user_shell);
        if matches!(basename, "sh" | "bash" | "zsh" | "dash" | "ksh") {
            shells.push(user_shell);
        }
    }

    // Append sh unless it is already in the list.
    let has_sh = shells.iter().any(|s| s == "sh" || s.ends_with("/sh"));
    if !has_sh {
        shells.push("sh".to_string());
    }

    shells
}

/// Returns the flags to start a shell as an interactive login session — the
/// same mode a terminal emulator uses.  `-i` sources RC files (`~/.zshrc`,
/// `~/.bashrc`), `-l` sources profile files (`~/.zprofile`, `~/.profile`),
/// and `-c` runs the given command string.
fn interactive_login_args() -> &'static [&'static str] {
    &["-ilc"]
}

fn parse_path_from_shell_output(stdout: &str) -> Option<String> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let absolute_parts: Vec<&str> = trimmed
            .split(':')
            .filter(|part| part.starts_with('/'))
            .collect();
        if !absolute_parts.is_empty() {
            return Some(absolute_parts.join(":"));
        }
    }
    None
}

fn parse_command_path_from_shell_output(stdout: &str) -> Option<String> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        for token in trimmed.split_whitespace() {
            let candidate = token.trim_matches(|c| c == '"' || c == '\'');
            if candidate.starts_with('/') {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

const SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const COMMAND_PATH_CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Clone)]
struct CommandPathCacheEntry {
    resolved_path: Option<String>,
    at: Instant,
}

fn command_path_cache() -> &'static RwLock<HashMap<String, CommandPathCacheEntry>> {
    static CACHE: OnceLock<RwLock<HashMap<String, CommandPathCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .ok()
            .is_some_and(|m| (m.permissions().mode() & 0o111) != 0)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn lookup_binary_in_path(binary: &str, path_var: &str) -> Option<String> {
    let path_dirs = std::env::split_paths(path_var);
    for dir in path_dirs {
        let candidate = dir.join(binary);
        if is_executable_file(&candidate) {
            return Some(candidate.to_string_lossy().to_string());
        }
        #[cfg(windows)]
        {
            for ext in [".exe", ".bat", ".cmd"] {
                let candidate_with_ext = dir.join(format!("{binary}{ext}"));
                if is_executable_file(&candidate_with_ext) {
                    return Some(candidate_with_ext.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

fn run_shell_probe(shell: &str, command: &str) -> Option<Output> {
    let mut child = Command::new(shell)
        .args(interactive_login_args())
        .arg(command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + SHELL_PROBE_TIMEOUT;
    loop {
        match child.try_wait().ok()? {
            Some(_) => return child.wait_with_output().ok(),
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                thread::sleep(Duration::from_millis(25));
            }
        }
    }
}

fn run_command_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<Output> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait().ok()? {
            Some(_) => return child.wait_with_output().ok(),
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                thread::sleep(Duration::from_millis(25));
            }
        }
    }
}

pub fn detect_version_from_command(binary: &str, args: &[&str]) -> Option<String> {
    if let Some(command_path) = resolve_command_path(binary) {
        if let Some(output) = run_command_with_timeout(&command_path, args, SHELL_PROBE_TIMEOUT) {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return Some(extract_version(&stdout));
            }
        }
    }

    let full_cmd = std::iter::once(binary)
        .chain(args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ");
    candidate_login_shells().iter().find_map(|shell| {
        run_shell_probe(shell, &full_cmd)
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .map(|s| extract_version(&s))
    })
}

/// Returns the `PATH` as seen by a fully interactive login shell — the same
/// environment a user gets when they open a terminal.  This ensures that
/// PATH additions in *both* profile files (`~/.zprofile`) and RC files
/// (`~/.zshrc`, `~/.bashrc`) are visible, even when the daemon was launched
/// by launchd with a sparse environment.
pub fn resolve_login_shell_path() -> Option<String> {
    candidate_login_shells().iter().find_map(|shell| {
        run_shell_probe(shell, "printenv PATH")
            .filter(|o| o.status.success())
            .and_then(|o| parse_path_from_shell_output(&String::from_utf8_lossy(&o.stdout)))
    })
}

/// Returns the absolute path to `binary` as resolved by a fully interactive
/// login shell, or `None` if the binary cannot be found.  Mirrors the
/// shell-search strategy used by `is_command_available` so detection and
/// spawn use the same PATH.
pub fn resolve_command_path(binary: &str) -> Option<String> {
    if let Some(entry) = command_path_cache()
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(binary)
        .cloned()
    {
        if entry.at.elapsed() < COMMAND_PATH_CACHE_TTL {
            return entry.resolved_path;
        }
    }

    if let Ok(path_var) = std::env::var("PATH") {
        if let Some(path) = lookup_binary_in_path(binary, &path_var) {
            command_path_cache()
                .write()
                .unwrap_or_else(|e| e.into_inner())
                .insert(
                    binary.to_string(),
                    CommandPathCacheEntry {
                        resolved_path: Some(path.clone()),
                        at: Instant::now(),
                    },
                );
            return Some(path);
        }
    }

    let login_shell_path = resolve_login_shell_path();
    if let Some(shell_path) = login_shell_path {
        if let Some(path) = lookup_binary_in_path(binary, &shell_path) {
            command_path_cache()
                .write()
                .unwrap_or_else(|e| e.into_inner())
                .insert(
                    binary.to_string(),
                    CommandPathCacheEntry {
                        resolved_path: Some(path.clone()),
                        at: Instant::now(),
                    },
                );
            return Some(path);
        }
    }

    let cmd = format!("command -v -- {binary}");
    let resolved = candidate_login_shells().iter().find_map(|shell| {
        run_shell_probe(shell, &cmd)
            .filter(|o| o.status.success())
            .and_then(|o| parse_command_path_from_shell_output(&String::from_utf8_lossy(&o.stdout)))
    });

    command_path_cache()
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            binary.to_string(),
            CommandPathCacheEntry {
                resolved_path: resolved.clone(),
                at: Instant::now(),
            },
        );

    resolved
}

pub fn is_command_available(binary: &str) -> bool {
    resolve_command_path(binary).is_some()
}

fn extract_version(s: &str) -> String {
    s.split_whitespace()
        .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .unwrap_or(s)
        .to_string()
}

macro_rules! define_runner {
    ($name:ident, $agent_type:expr, $display:expr, $cmd:expr) => {
        pub struct $name;

        impl AgentRunner for $name {
            fn agent_type(&self) -> AgentType {
                $agent_type
            }

            fn name(&self) -> &str {
                $display
            }

            fn command(&self) -> String {
                $cmd.to_string()
            }

            fn args(&self, _workspace: &Path) -> Vec<String> {
                vec![]
            }

            fn env(&self) -> HashMap<String, String> {
                HashMap::new()
            }

            fn is_installed(&self) -> bool {
                is_command_available($cmd)
            }

            fn detect_version(&self) -> Option<String> {
                detect_version_from_command($cmd, &["--version"])
            }
        }
    };
}

define_runner!(
    ClaudeCodeRunner,
    AgentType::ClaudeCode,
    "Claude Code",
    "claude"
);
define_runner!(CodexRunner, AgentType::Codex, "Codex", "codex");
define_runner!(GeminiRunner, AgentType::Gemini, "Gemini", "gemini");

pub fn default_runners() -> Vec<Box<dyn AgentRunner>> {
    vec![
        Box::new(ClaudeCodeRunner),
        Box::new(CodexRunner),
        Box::new(GeminiRunner),
    ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn agent_type_display_roundtrip() {
        for (variant, expected) in [
            (AgentType::ClaudeCode, "claude_code"),
            (AgentType::Codex, "codex"),
            (AgentType::Gemini, "gemini"),
        ] {
            let display = variant.to_string();
            assert_eq!(display, expected);
            let parsed: AgentType = display.parse().unwrap();
            assert_eq!(parsed, variant);
        }
    }

    #[test]
    fn agent_type_from_str_unknown() {
        let result = "unknown".parse::<AgentType>();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown agent type"));
    }

    #[test]
    fn agent_type_serde_roundtrip() {
        for variant in [AgentType::ClaudeCode, AgentType::Codex, AgentType::Gemini] {
            let json = serde_json::to_string(&variant).unwrap();
            let parsed: AgentType = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, variant);
        }
    }

    #[test]
    fn agent_type_serde_snake_case() {
        assert_eq!(
            serde_json::to_string(&AgentType::ClaudeCode).unwrap(),
            "\"claude_code\""
        );
        assert_eq!(
            serde_json::to_string(&AgentType::Codex).unwrap(),
            "\"codex\""
        );
        assert_eq!(
            serde_json::to_string(&AgentType::Gemini).unwrap(),
            "\"gemini\""
        );
    }

    #[test]
    fn agent_type_hash_eq() {
        let mut set = HashSet::new();
        set.insert(AgentType::ClaudeCode);
        set.insert(AgentType::ClaudeCode);
        assert_eq!(set.len(), 1);
    }

    #[test]
    fn extract_version_with_version_prefix() {
        assert_eq!(extract_version("tool 1.2.3"), "1.2.3");
    }

    #[test]
    fn extract_version_bare_version() {
        assert_eq!(extract_version("4.5.6"), "4.5.6");
    }

    #[test]
    fn extract_version_no_digit_word() {
        assert_eq!(extract_version("no version here"), "no version here");
    }

    #[test]
    fn extract_version_version_in_middle() {
        assert_eq!(extract_version("tool 2.0.0 (stable)"), "2.0.0");
    }

    #[test]
    fn is_command_available_nonexistent() {
        assert!(!is_command_available("__nonexistent_binary_12345__"));
    }

    #[test]
    fn resolve_login_shell_path_is_nonempty_and_absolute() {
        let path = resolve_login_shell_path();
        assert!(path.is_some(), "login shell PATH should be resolvable");
        let path = path.unwrap();
        // PATH is colon-separated; every component should start with '/'
        assert!(
            path.split(':').all(|p| p.starts_with('/')),
            "all PATH entries should be absolute: {path}"
        );
    }

    #[test]
    fn resolve_command_path_nonexistent() {
        assert!(resolve_command_path("__nonexistent_binary_12345__").is_none());
    }

    #[test]
    fn resolve_command_path_real_binary() {
        // sh is guaranteed to be present; its resolved path must be non-empty
        // and start with '/'.
        let path = resolve_command_path("sh");
        assert!(path.is_some());
        assert!(path.unwrap().starts_with('/'));
    }

    #[test]
    fn detect_version_nonexistent_binary() {
        assert!(
            detect_version_from_command("__nonexistent_binary_12345__", &["--version"]).is_none()
        );
    }

    #[test]
    fn available_agent_serializes() {
        let agent = AvailableAgent {
            agent_type: AgentType::ClaudeCode,
            name: "Claude Code".to_string(),
            installed: true,
            version: Some("1.0.0".to_string()),
        };
        let json = serde_json::to_string(&agent).unwrap();
        assert!(json.contains("\"claude_code\""));
        assert!(json.contains("\"Claude Code\""));
        assert!(json.contains("\"1.0.0\""));

        let agent_no_version = AvailableAgent {
            agent_type: AgentType::Codex,
            name: "Codex".to_string(),
            installed: false,
            version: None,
        };
        let json = serde_json::to_string(&agent_no_version).unwrap();
        assert!(json.contains("\"installed\":false"));
    }

    #[test]
    fn runner_properties() {
        let claude = ClaudeCodeRunner;
        assert_eq!(claude.agent_type(), AgentType::ClaudeCode);
        assert_eq!(claude.name(), "Claude Code");
        assert_eq!(claude.command(), "claude");

        let codex = CodexRunner;
        assert_eq!(codex.agent_type(), AgentType::Codex);
        assert_eq!(codex.name(), "Codex");
        assert_eq!(codex.command(), "codex");

        let gemini = GeminiRunner;
        assert_eq!(gemini.agent_type(), AgentType::Gemini);
        assert_eq!(gemini.name(), "Gemini");
        assert_eq!(gemini.command(), "gemini");
    }

    #[test]
    fn runner_args_returns_empty() {
        let runner = ClaudeCodeRunner;
        let args = runner.args(Path::new("/tmp"));
        assert!(args.is_empty());
    }

    #[test]
    fn runner_env_returns_empty() {
        let runner = ClaudeCodeRunner;
        let env = runner.env();
        assert!(env.is_empty());
    }

    #[test]
    fn default_runners_returns_three_distinct() {
        let runners = default_runners();
        assert_eq!(runners.len(), 3);
        let types: HashSet<AgentType> = runners.iter().map(|r| r.agent_type()).collect();
        assert_eq!(types.len(), 3);
    }

    #[test]
    fn lookup_binary_in_path_finds_executable_in_given_path() {
        let dir = std::env::temp_dir().join(format!("lw-agent-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("fake-agent");
        std::fs::write(&bin, "#!/bin/sh\necho ok\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&bin).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&bin, perms).unwrap();
        }

        let path_var = dir.to_string_lossy().to_string();
        let resolved = lookup_binary_in_path("fake-agent", &path_var);
        assert_eq!(resolved, Some(bin.to_string_lossy().to_string()));
        let _ = std::fs::remove_file(&bin);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_command_with_timeout_returns_output_for_fast_command() {
        let output = run_command_with_timeout("sh", &["-c", "echo 1.2.3"], Duration::from_secs(1));
        assert!(output.is_some());
        let output = output.unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "1.2.3");
    }

    #[test]
    fn run_command_with_timeout_kills_slow_command() {
        let output = run_command_with_timeout("sh", &["-c", "sleep 5"], Duration::from_millis(50));
        assert!(output.is_none());
    }
}
