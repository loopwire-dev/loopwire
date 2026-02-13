use crate::runner::{AgentRunner, AgentType};
use std::collections::HashMap;
use std::path::Path;

pub struct GeminiRunner;

impl AgentRunner for GeminiRunner {
    fn agent_type(&self) -> AgentType {
        AgentType::Gemini
    }

    fn name(&self) -> &str {
        "Gemini"
    }

    fn command(&self) -> String {
        resolve_gemini_binary().unwrap_or_else(|| "gemini".to_string())
    }

    fn args(&self, _workspace: &Path) -> Vec<String> {
        vec![]
    }

    fn env(&self) -> HashMap<String, String> {
        HashMap::new()
    }

    fn is_installed(&self) -> bool {
        resolve_gemini_binary().is_some()
    }

    fn detect_version(&self) -> Option<String> {
        resolve_gemini_binary()
            .and_then(|binary| crate::claude::detect_version_from_command(&binary, &["--version"]))
    }
}

fn resolve_gemini_binary() -> Option<String> {
    ["gemini", "gemini-cli"]
        .iter()
        .find(|binary| {
            std::process::Command::new("which")
                .arg(binary)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .map(|binary| (*binary).to_string())
}
