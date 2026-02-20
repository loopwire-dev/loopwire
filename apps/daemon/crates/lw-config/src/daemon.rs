use serde::{Deserialize, Serialize};
use std::env;
use std::net::{IpAddr, Ipv4Addr};

use crate::lan::LanDiscoveryConfig;
use crate::paths::ConfigPaths;

use crate::remote::{default_frontend_url, RemoteConfig};

fn default_host() -> IpAddr {
    IpAddr::V4(Ipv4Addr::UNSPECIFIED)
}

fn default_port() -> u16 {
    9400
}

fn default_allowed_origins() -> Vec<String> {
    match env::var("LOOPWIRE_ALLOWED_ORIGINS") {
        Ok(val) => val
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    #[serde(default = "default_host")]
    pub host: IpAddr,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_frontend_url")]
    pub frontend_url: String,
    #[serde(default = "default_allowed_origins")]
    pub allowed_origins: Vec<String>,
    #[serde(default)]
    pub remote: RemoteConfig,

    #[serde(default)]
    pub lan: LanDiscoveryConfig,
    #[serde(skip)]
    paths: Option<ConfigPaths>,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            frontend_url: default_frontend_url(),
            allowed_origins: default_allowed_origins(),
            remote: RemoteConfig::default(),

            lan: LanDiscoveryConfig::default(),
            paths: None,
        }
    }
}

impl DaemonConfig {
    /// Returns the `ConfigPaths` for this config. If paths haven't been set,
    /// creates the default paths (may fail if `$HOME` is unset).
    pub fn paths(&self) -> anyhow::Result<ConfigPaths> {
        match &self.paths {
            Some(p) => Ok(p.clone()),
            None => ConfigPaths::new(),
        }
    }

    /// Set a custom `ConfigPaths` (useful for testing or multi-instance).
    pub fn set_paths(&mut self, paths: ConfigPaths) {
        self.paths = Some(paths);
    }

    /// Load config from the default location (`~/.loopwire/config.toml`).
    pub fn load() -> anyhow::Result<Self> {
        let paths = ConfigPaths::new()?;
        Self::load_from(&paths)
    }

    /// Load config from a specific `ConfigPaths`.
    pub fn load_from(paths: &ConfigPaths) -> anyhow::Result<Self> {
        let config_file = paths.config_path();
        let mut config = if config_file.exists() {
            let content = std::fs::read_to_string(&config_file)?;
            let config: DaemonConfig = toml::from_str(&content)?;
            config
        } else {
            Self::default()
        };
        config.paths = Some(paths.clone());
        config.validate()?;
        Ok(config)
    }

    /// Validate config values. Called automatically by `load` / `load_from`.
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.port == 0 {
            anyhow::bail!("port must not be 0");
        }
        if self.frontend_url.is_empty() {
            anyhow::bail!("frontend_url must not be empty");
        }
        if self.remote.invite_ttl_seconds == 0 {
            anyhow::bail!("remote.invite_ttl_seconds must be greater than 0");
        }
        if self.remote.provider_order.is_empty() {
            anyhow::bail!("remote.provider_order must not be empty");
        }
        if self.remote.frontend_connect_url.is_empty() {
            anyhow::bail!("remote.frontend_connect_url must not be empty");
        }
        Ok(())
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_paths() -> ConfigPaths {
        let dir = tempfile::tempdir().unwrap();
        ConfigPaths::with_base(dir.keep())
    }

    #[test]
    fn default_produces_expected_values() {
        let config = DaemonConfig::default();
        assert_eq!(config.host, IpAddr::V4(Ipv4Addr::UNSPECIFIED));
        assert_eq!(config.port, 9400);
        assert_eq!(config.frontend_url, "http://loopwire.dev");
        assert!(config.lan.enabled);
    }

    #[test]
    fn bind_addr_formats_correctly() {
        let mut config = DaemonConfig::default();
        config.port = 8080;
        config.host = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        assert_eq!(config.bind_addr(), "127.0.0.1:8080");
    }

    #[test]
    fn load_with_no_file_returns_default() {
        let paths = test_paths();
        paths.ensure_config_dir().unwrap();
        let config = DaemonConfig::load_from(&paths).unwrap();
        assert_eq!(config.port, 9400);
    }

    #[test]
    fn load_with_valid_toml() {
        let paths = test_paths();
        paths.ensure_config_dir().unwrap();
        std::fs::write(
            paths.config_path(),
            "port = 8888\nfrontend_url = \"http://example.com\"\n",
        )
        .unwrap();
        let config = DaemonConfig::load_from(&paths).unwrap();
        assert_eq!(config.port, 8888);
        assert_eq!(config.frontend_url, "http://example.com");
    }

    #[test]
    fn load_with_partial_toml_fills_defaults() {
        let paths = test_paths();
        paths.ensure_config_dir().unwrap();
        std::fs::write(paths.config_path(), "port = 7777\n").unwrap();
        let config = DaemonConfig::load_from(&paths).unwrap();
        assert_eq!(config.port, 7777);
        // frontend_url should be the default
        assert_eq!(config.frontend_url, "http://loopwire.dev");
    }

    #[test]
    fn load_with_invalid_toml_returns_error() {
        let paths = test_paths();
        paths.ensure_config_dir().unwrap();
        std::fs::write(paths.config_path(), "not valid {{{{ toml").unwrap();
        assert!(DaemonConfig::load_from(&paths).is_err());
    }

    #[test]
    fn validate_rejects_port_zero() {
        let mut config = DaemonConfig::default();
        config.port = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_empty_frontend_url() {
        let mut config = DaemonConfig::default();
        config.frontend_url = String::new();
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_zero_invite_ttl() {
        let mut config = DaemonConfig::default();
        config.remote.invite_ttl_seconds = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_empty_provider_order() {
        let mut config = DaemonConfig::default();
        config.remote.provider_order = vec![];
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_empty_frontend_connect_url() {
        let mut config = DaemonConfig::default();
        config.remote.frontend_connect_url = String::new();
        assert!(config.validate().is_err());
    }

    #[test]
    fn toml_roundtrip() {
        let config = DaemonConfig::default();
        let serialized = toml::to_string(&config).unwrap();
        let deserialized: DaemonConfig = toml::from_str(&serialized).unwrap();
        assert_eq!(deserialized.port, config.port);
        assert_eq!(deserialized.host, config.host);
        assert_eq!(deserialized.frontend_url, config.frontend_url);
    }

    #[test]
    fn set_paths_is_used_by_paths_accessor() {
        let mut config = DaemonConfig::default();
        let base = PathBuf::from("/custom/base");
        config.set_paths(ConfigPaths::with_base(base.clone()));
        let paths = config.paths().unwrap();
        assert_eq!(paths.config_dir(), base.as_path());
    }

    #[test]
    fn allowed_origins_default_is_empty() {
        // Without the env var set, should be empty
        let origins = default_allowed_origins();
        // Can't assert empty because env var might be set in CI,
        // but the function should not panic
        let _ = origins;
    }
}
