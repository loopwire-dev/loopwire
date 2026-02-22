use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConfig {
    #[serde(default)]
    pub enabled_default: bool,
    #[serde(default = "default_invite_ttl_seconds")]
    pub invite_ttl_seconds: u64,
    #[serde(default = "default_provider_order")]
    pub provider_order: Vec<String>,
    #[serde(default = "default_auto_install_helpers")]
    pub auto_install_helpers: bool,
    #[serde(default = "default_frontend_connect_url")]
    pub frontend_connect_url: String,
}

fn default_invite_ttl_seconds() -> u64 {
    900
}

fn default_provider_order() -> Vec<String> {
    vec!["cloudflared".to_string(), "localhost_run".to_string()]
}

fn default_auto_install_helpers() -> bool {
    true
}

pub(crate) fn default_frontend_url() -> String {
    env::var("LOOPWIRE_FRONTEND_URL").unwrap_or_default()
}

fn default_frontend_connect_url() -> String {
    let base = default_frontend_url();
    if base.is_empty() {
        String::new()
    } else {
        format!("{}/connect", base.trim_end_matches('/'))
    }
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self {
            enabled_default: false,
            invite_ttl_seconds: default_invite_ttl_seconds(),
            provider_order: default_provider_order(),
            auto_install_helpers: default_auto_install_helpers(),
            frontend_connect_url: default_frontend_connect_url(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_values_are_correct() {
        let r = RemoteConfig::default();
        assert!(!r.enabled_default);
        assert_eq!(r.invite_ttl_seconds, 900);
        assert_eq!(r.provider_order, vec!["cloudflared", "localhost_run"]);
        assert!(r.auto_install_helpers);
    }

    #[test]
    fn frontend_connect_url_derives_from_frontend_url() {
        let r = RemoteConfig::default();
        if default_frontend_url().is_empty() {
            assert!(r.frontend_connect_url.is_empty());
        } else {
            assert!(r.frontend_connect_url.contains("/connect"));
            assert!(r.frontend_connect_url.starts_with("http"));
        }
    }

    #[test]
    fn serde_roundtrip() {
        let r = RemoteConfig {
            enabled_default: true,
            invite_ttl_seconds: 600,
            provider_order: vec!["localhost_run".to_string()],
            auto_install_helpers: false,
            frontend_connect_url: "https://example.com/connect".to_string(),
        };
        let serialized = toml::to_string(&r).unwrap();
        let deserialized: RemoteConfig = toml::from_str(&serialized).unwrap();
        assert!(deserialized.enabled_default);
        assert_eq!(deserialized.invite_ttl_seconds, 600);
        assert_eq!(deserialized.provider_order, vec!["localhost_run"]);
        assert!(!deserialized.auto_install_helpers);
        assert_eq!(
            deserialized.frontend_connect_url,
            "https://example.com/connect"
        );
    }
}
