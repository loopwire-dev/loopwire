use crate::runner::{AgentRunner, AgentType};
use std::collections::HashMap;
use std::path::Path;

pub struct CodexRunner;

impl AgentRunner for CodexRunner {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn name(&self) -> &str {
        "Codex"
    }

    fn command(&self) -> String {
        "codex".to_string()
    }

    fn args(&self, _workspace: &Path) -> Vec<String> {
        vec![]
    }

    fn env(&self) -> HashMap<String, String> {
        HashMap::new()
    }

    fn is_installed(&self) -> bool {
        std::process::Command::new("which")
            .arg("codex")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn detect_version(&self) -> Option<String> {
        crate::claude::detect_version_from_command("codex", &["--version"])
    }
}
