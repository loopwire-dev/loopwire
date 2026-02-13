use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    #[serde(default = "default_host")]
    pub host: IpAddr,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_frontend_url")]
    pub frontend_url: String,
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    #[serde(default)]
    pub quota: QuotaConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QuotaConfig {
    pub anthropic_api_key: Option<String>,
    pub openai_api_key: Option<String>,
}

fn default_host() -> IpAddr {
    IpAddr::V4(Ipv4Addr::LOCALHOST)
}

fn default_port() -> u16 {
    9400
}

fn default_frontend_url() -> String {
    "http://localhost:5173".to_string()
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            frontend_url: default_frontend_url(),
            allowed_origins: Vec::new(),
            quota: QuotaConfig::default(),
        }
    }
}

impl DaemonConfig {
    pub fn config_dir() -> PathBuf {
        dirs::home_dir()
            .expect("Could not determine home directory")
            .join(".loopwire")
    }

    pub fn config_path() -> PathBuf {
        Self::config_dir().join("config.toml")
    }

    pub fn pid_path() -> PathBuf {
        Self::config_dir().join("loopwired.pid")
    }

    pub fn token_path() -> PathBuf {
        Self::config_dir().join("bootstrap_token")
    }

    pub fn sessions_path() -> PathBuf {
        Self::config_dir().join("session_hashes")
    }

    pub fn load() -> anyhow::Result<Self> {
        let path = Self::config_path();
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            let config: DaemonConfig = toml::from_str(&content)?;
            Ok(config)
        } else {
            Ok(Self::default())
        }
    }

    pub fn ensure_config_dir() -> anyhow::Result<PathBuf> {
        let dir = Self::config_dir();
        if !dir.exists() {
            std::fs::create_dir_all(&dir)?;
        }
        Ok(dir)
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}
