use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanDiscoveryConfig {
    #[serde(default = "default_lan_enabled")]
    pub enabled: bool,
}

fn default_lan_enabled() -> bool {
    true
}

impl Default for LanDiscoveryConfig {
    fn default() -> Self {
        Self {
            enabled: default_lan_enabled(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_enabled_is_true() {
        let lan = LanDiscoveryConfig::default();
        assert!(lan.enabled);
    }

    #[test]
    fn serde_roundtrip_enabled_false() {
        let toml_str = "enabled = false\n";
        let lan: LanDiscoveryConfig = toml::from_str(toml_str).unwrap();
        assert!(!lan.enabled);

        let serialized = toml::to_string(&lan).unwrap();
        let deserialized: LanDiscoveryConfig = toml::from_str(&serialized).unwrap();
        assert!(!deserialized.enabled);
    }

    #[test]
    fn serde_missing_fields_uses_defaults() {
        let lan: LanDiscoveryConfig = toml::from_str("").unwrap();
        assert!(lan.enabled);
    }
}
