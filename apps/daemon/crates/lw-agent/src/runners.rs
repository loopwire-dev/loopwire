use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

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

pub fn detect_version_from_command(binary: &str, args: &[&str]) -> Option<String> {
    std::process::Command::new(binary)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .map(|s| extract_version(&s))
}

pub fn is_command_available(binary: &str) -> bool {
    std::process::Command::new("which")
        .arg(binary)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
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
}
