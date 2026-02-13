use crate::runner::{AgentRunner, AgentType};
use std::collections::HashMap;
use std::path::Path;

pub struct ClaudeCodeRunner;

impl AgentRunner for ClaudeCodeRunner {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn name(&self) -> &str {
        "Claude Code"
    }

    fn command(&self) -> String {
        "claude".to_string()
    }

    fn args(&self, _workspace: &Path) -> Vec<String> {
        vec![]
    }

    fn env(&self) -> HashMap<String, String> {
        HashMap::new()
    }

    fn is_installed(&self) -> bool {
        which("claude")
    }

    fn detect_version(&self) -> Option<String> {
        detect_version_from_command("claude", &["--version"])
    }
}

fn which(binary: &str) -> bool {
    std::process::Command::new("which")
        .arg(binary)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn detect_version_from_command(binary: &str, args: &[&str]) -> Option<String> {
    std::process::Command::new(binary)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .map(|s| extract_version(&s))
}

fn extract_version(s: &str) -> String {
    s.split_whitespace()
        .find(|w| w.chars().next().map_or(false, |c| c.is_ascii_digit()))
        .unwrap_or(s)
        .to_string()
}
