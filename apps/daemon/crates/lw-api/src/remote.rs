mod crypto;
mod invite;
mod tunnel;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use lw_config::{ConfigPaths, DaemonConfig};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};

use crate::auth::{generate_token, TokenStore};
use crypto::{constant_time_eq, hash_pin, sign_payload, verify_pin, TrustedDevicePayload};
use invite::{build_connect_url, validate_invite};
#[cfg(test)]
use invite::{obfuscate_backend_target, parse_hex_or_bytes, stream_key_byte};
use tunnel::{
    find_in_path, install_cloudflared, spawn_output_reader, wait_for_localhost_run_url,
    wait_for_public_url, TunnelProvider,
};

const DEFAULT_PIN_MAX_ATTEMPTS: u8 = 5;
const TRUSTED_DEVICE_DAYS: i64 = 30;

#[derive(Debug, thiserror::Error)]
pub enum RemoteError {
    #[error("No active remote share session")]
    NotActive,
    #[error("Invite token is invalid")]
    InvalidInvite,
    #[error("Invite token has expired")]
    InviteExpired,
    #[error("Invite token has already been used")]
    InviteUsed,
    #[error("PIN is required")]
    PinRequired,
    #[error("PIN is invalid")]
    InvalidPin,
    #[error("Invite token locked after too many invalid PIN attempts")]
    PinLocked,
    #[error("Trusted device token is invalid")]
    InvalidTrustedDeviceToken,
    #[error("No tunnel provider available: {0}")]
    ProviderFailed(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Debug, Clone)]
pub struct ShareStartOptions {
    pub pin: Option<String>,
    pub ttl_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShareStatus {
    pub active: bool,
    pub provider: Option<String>,
    pub public_backend_url: Option<String>,
    pub connect_url: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub pin_required: bool,
    pub started_at: Option<DateTime<Utc>>,
    pub host_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShareStartResult {
    pub connect_url: String,
    pub public_backend_url: String,
    pub expires_at: DateTime<Utc>,
    pub pin_required: bool,
    pub provider: String,
    pub host_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteBootstrapResult {
    pub host_id: String,
    pub pin_required: bool,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteExchangeResult {
    pub session_token: String,
    pub trusted_device_token: Option<String>,
    pub trusted_device_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
struct ActiveShare {
    provider: TunnelProvider,
    public_backend_url: String,
    connect_url: String,
    invite_hash: String,
    invite_expires_at: DateTime<Utc>,
    invite_used: bool,
    pin_hash: Option<String>,
    pin_failures: u8,
    started_at: DateTime<Utc>,
}

pub struct RemoteAccessManager {
    config: DaemonConfig,
    token_store: std::sync::Arc<TokenStore>,
    paths: ConfigPaths,
    host_id: String,
    trusted_device_key: Vec<u8>,
    active_share: RwLock<Option<ActiveShare>>,
    tunnel_child: Mutex<Option<Child>>,
}

impl RemoteAccessManager {
    pub fn new(
        config: DaemonConfig,
        token_store: std::sync::Arc<TokenStore>,
        paths: ConfigPaths,
    ) -> Result<Self, RemoteError> {
        paths.ensure_config_dir()?;
        let host_id = load_or_create_host_id(&paths)?;
        let trusted_device_key = load_or_create_trust_key(&paths)?;

        Ok(Self {
            config,
            token_store,
            paths,
            host_id,
            trusted_device_key,
            active_share: RwLock::new(None),
            tunnel_child: Mutex::new(None),
        })
    }

    pub async fn start_share(
        &self,
        options: ShareStartOptions,
    ) -> Result<ShareStartResult, RemoteError> {
        self.stop_share().await?;

        let (provider, public_backend_url, child) = self.start_tunnel_with_fallback().await?;

        let ttl_seconds = options
            .ttl_seconds
            .unwrap_or(self.config.remote.invite_ttl_seconds)
            .clamp(60, 86_400);
        let expires_at = Utc::now() + ChronoDuration::seconds(ttl_seconds as i64);

        let invite_token = generate_token();
        let invite_hash = TokenStore::hash_token(&invite_token);

        let pin_hash = match options.pin.map(|v| v.trim().to_string()) {
            Some(v) if !v.is_empty() => Some(hash_pin(&v)?),
            _ => None,
        };

        let connect_url = build_connect_url(
            &self.config.remote.frontend_connect_url,
            &public_backend_url,
            &invite_token,
        );

        {
            let mut active = self.active_share.write().await;
            *active = Some(ActiveShare {
                provider,
                public_backend_url: public_backend_url.clone(),
                connect_url: connect_url.clone(),
                invite_hash,
                invite_expires_at: expires_at,
                invite_used: false,
                pin_hash: pin_hash.clone(),
                pin_failures: 0,
                started_at: Utc::now(),
            });
        }

        {
            let mut tunnel = self.tunnel_child.lock().await;
            *tunnel = Some(child);
        }

        Ok(ShareStartResult {
            connect_url,
            public_backend_url,
            expires_at,
            pin_required: pin_hash.is_some(),
            provider: provider.as_str().to_string(),
            host_id: self.host_id.clone(),
        })
    }

    pub async fn stop_share(&self) -> Result<(), RemoteError> {
        {
            let mut tunnel = self.tunnel_child.lock().await;
            if let Some(child) = tunnel.as_mut() {
                let _ = child.kill().await;
                let _ = child.wait().await;
            }
            *tunnel = None;
        }

        let mut active = self.active_share.write().await;
        *active = None;
        Ok(())
    }

    pub async fn status(&self) -> ShareStatus {
        self.sync_share_from_process().await;

        let active = self.active_share.read().await;
        if let Some(share) = active.as_ref() {
            ShareStatus {
                active: true,
                provider: Some(share.provider.as_str().to_string()),
                public_backend_url: Some(share.public_backend_url.clone()),
                connect_url: Some(share.connect_url.clone()),
                expires_at: Some(share.invite_expires_at),
                pin_required: share.pin_hash.is_some(),
                started_at: Some(share.started_at),
                host_id: self.host_id.clone(),
            }
        } else {
            ShareStatus {
                active: false,
                provider: None,
                public_backend_url: None,
                connect_url: None,
                expires_at: None,
                pin_required: false,
                started_at: None,
                host_id: self.host_id.clone(),
            }
        }
    }

    pub async fn invite_bootstrap(
        &self,
        invite_token: &str,
    ) -> Result<InviteBootstrapResult, RemoteError> {
        self.sync_share_from_process().await;

        let hash = TokenStore::hash_token(invite_token);
        let active = self.active_share.read().await;
        let share = active.as_ref().ok_or(RemoteError::NotActive)?;

        validate_invite(share, &hash)?;

        Ok(InviteBootstrapResult {
            host_id: self.host_id.clone(),
            pin_required: share.pin_hash.is_some(),
            expires_at: share.invite_expires_at,
        })
    }

    pub async fn invite_exchange(
        &self,
        invite_token: &str,
        pin: Option<&str>,
        trusted_device_token: Option<&str>,
    ) -> Result<InviteExchangeResult, RemoteError> {
        self.sync_share_from_process().await;

        let hash = TokenStore::hash_token(invite_token);

        let mut trusted_device_response: Option<(String, DateTime<Utc>)> = None;

        {
            let mut active = self.active_share.write().await;
            let share = active.as_mut().ok_or(RemoteError::NotActive)?;

            validate_invite(share, &hash)?;

            if let Some(pin_hash) = share.pin_hash.as_ref() {
                let trusted_ok = trusted_device_token
                    .map(|token| self.verify_trusted_device_token(token))
                    .transpose()?
                    .unwrap_or(false);

                if !trusted_ok {
                    let provided_pin = pin.ok_or(RemoteError::PinRequired)?;
                    if !verify_pin(pin_hash, provided_pin)? {
                        share.pin_failures = share.pin_failures.saturating_add(1);
                        if share.pin_failures >= DEFAULT_PIN_MAX_ATTEMPTS {
                            share.invite_used = true;
                            return Err(RemoteError::PinLocked);
                        }
                        return Err(RemoteError::InvalidPin);
                    }
                    share.pin_failures = 0;
                    trusted_device_response = Some(self.issue_trusted_device_token()?);
                }
            }

            share.invite_used = true;
        }

        let session_token = generate_token();
        let session_hash = TokenStore::hash_token(&session_token);
        self.token_store.add_session_token(session_hash).await;

        Ok(InviteExchangeResult {
            session_token,
            trusted_device_token: trusted_device_response
                .as_ref()
                .map(|(token, _)| token.clone()),
            trusted_device_expires_at: trusted_device_response.map(|(_, exp)| exp),
        })
    }

    async fn sync_share_from_process(&self) {
        let exited = {
            let mut tunnel = self.tunnel_child.lock().await;
            if let Some(child) = tunnel.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        tracing::warn!("Remote tunnel exited unexpectedly: {}", status);
                        *tunnel = None;
                        true
                    }
                    Ok(None) => false,
                    Err(err) => {
                        tracing::warn!("Failed to inspect remote tunnel process: {}", err);
                        false
                    }
                }
            } else {
                false
            }
        };

        if exited {
            let mut active = self.active_share.write().await;
            *active = None;
        }
    }

    async fn start_tunnel_with_fallback(
        &self,
    ) -> Result<(TunnelProvider, String, Child), RemoteError> {
        let mut errors = Vec::new();

        for (i, provider_name) in self.config.remote.provider_order.iter().enumerate() {
            let provider = match provider_name.as_str() {
                "cloudflared" | "cloudflared_quick" => Some(TunnelProvider::Cloudflared),
                "localhost_run" => Some(TunnelProvider::LocalhostRun),
                _ => None,
            };

            let Some(provider) = provider else {
                continue;
            };

            if i == 0 {
                tracing::info!("Starting tunnel with provider '{}'", provider.as_str());
            } else {
                tracing::info!(
                    "Falling back to provider '{}' after {} failed provider(s)",
                    provider.as_str(),
                    i
                );
            }

            match self.start_provider(provider).await {
                Ok((public_url, child)) => {
                    tracing::info!(
                        "Tunnel established via '{}': {}",
                        provider.as_str(),
                        public_url
                    );
                    return Ok((provider, public_url, child));
                }
                Err(err) => {
                    tracing::warn!(
                        "Remote tunnel provider '{}' failed: {}",
                        provider.as_str(),
                        err
                    );
                    errors.push(format!("{}: {}", provider.as_str(), err));
                }
            }
        }

        if errors.is_empty() {
            return Err(RemoteError::ProviderFailed(
                "no configured provider could be started".to_string(),
            ));
        }

        Err(RemoteError::ProviderFailed(errors.join(" | ")))
    }

    async fn start_provider(
        &self,
        provider: TunnelProvider,
    ) -> Result<(String, Child), anyhow::Error> {
        let local_url = format!("http://127.0.0.1:{}", self.config.port);

        match provider {
            TunnelProvider::Cloudflared => {
                let binary = self.ensure_cloudflared_binary().await?;
                let mut child = Command::new(binary)
                    .arg("tunnel")
                    .arg("--url")
                    .arg(&local_url)
                    .arg("--no-autoupdate")
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()?;

                let url = match wait_for_public_url(&mut child).await {
                    Ok(url) => url,
                    Err(err) => {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        return Err(err);
                    }
                };

                Ok((url, child))
            }
            TunnelProvider::LocalhostRun => {
                let ssh =
                    find_in_path("ssh").ok_or_else(|| anyhow::anyhow!("ssh not found in PATH"))?;
                let remote_spec = format!("80:127.0.0.1:{}", self.config.port);

                let mut child = Command::new(ssh)
                    .arg("-o")
                    .arg("StrictHostKeyChecking=no")
                    .arg("-o")
                    .arg("ServerAliveInterval=30")
                    .arg("-R")
                    .arg(remote_spec)
                    .arg("nokey@localhost.run")
                    .arg("--")
                    .arg("--output")
                    .arg("json")
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()?;

                // Log stderr (SSH banners/warnings) separately
                if let Some(stderr) = child.stderr.take() {
                    spawn_output_reader(stderr, "[localhost.run stderr]");
                }

                let url = match wait_for_localhost_run_url(&mut child).await {
                    Ok(url) => url,
                    Err(err) => {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        return Err(err);
                    }
                };

                Ok((url, child))
            }
        }
    }

    async fn ensure_cloudflared_binary(&self) -> Result<PathBuf, anyhow::Error> {
        if let Some(path) = find_in_path("cloudflared") {
            return Ok(path);
        }

        let managed_binary = self.paths.bin_dir().join("cloudflared");
        if managed_binary.exists() {
            return Ok(managed_binary);
        }

        if !self.config.remote.auto_install_helpers {
            anyhow::bail!("cloudflared not installed and auto installation is disabled");
        }

        install_cloudflared(&managed_binary).await?;
        Ok(managed_binary)
    }

    fn verify_trusted_device_token(&self, token: &str) -> Result<bool, RemoteError> {
        let (payload_b64, sig_b64) = token
            .split_once('.')
            .ok_or(RemoteError::InvalidTrustedDeviceToken)?;

        let signature = URL_SAFE_NO_PAD
            .decode(sig_b64)
            .map_err(|_| RemoteError::InvalidTrustedDeviceToken)?;

        let expected = sign_payload(&self.trusted_device_key, payload_b64);
        if !constant_time_eq(&expected, &signature) {
            return Err(RemoteError::InvalidTrustedDeviceToken);
        }

        let payload_bytes = URL_SAFE_NO_PAD
            .decode(payload_b64)
            .map_err(|_| RemoteError::InvalidTrustedDeviceToken)?;
        let payload: TrustedDevicePayload = serde_json::from_slice(&payload_bytes)
            .map_err(|_| RemoteError::InvalidTrustedDeviceToken)?;

        if payload.host_id != self.host_id {
            return Ok(false);
        }
        if Utc::now().timestamp() > payload.exp {
            return Ok(false);
        }

        Ok(true)
    }

    fn issue_trusted_device_token(&self) -> Result<(String, DateTime<Utc>), RemoteError> {
        let expires_at = Utc::now() + ChronoDuration::days(TRUSTED_DEVICE_DAYS);
        let payload = TrustedDevicePayload {
            host_id: self.host_id.clone(),
            exp: expires_at.timestamp(),
        };

        let payload_json = serde_json::to_vec(&payload)
            .map_err(|e| RemoteError::Internal(anyhow::anyhow!(e.to_string())))?;
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json);
        let signature = sign_payload(&self.trusted_device_key, &payload_b64);
        let signature_b64 = URL_SAFE_NO_PAD.encode(signature);

        Ok((format!("{}.{}", payload_b64, signature_b64), expires_at))
    }
}

fn load_or_create_host_id(paths: &ConfigPaths) -> Result<String, anyhow::Error> {
    let path = paths.host_id_path();
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let id = existing.trim().to_string();
        if !id.is_empty() {
            return Ok(id);
        }
    }

    let id = generate_token();
    std::fs::write(&path, &id)?;
    Ok(id)
}

fn load_or_create_trust_key(paths: &ConfigPaths) -> Result<Vec<u8>, anyhow::Error> {
    let path = paths.trust_key_path();
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let key_hex = existing.trim();
        if !key_hex.is_empty() {
            let decoded = hex::decode(key_hex)?;
            if !decoded.is_empty() {
                return Ok(decoded);
            }
        }
    }

    let raw = generate_token();
    std::fs::write(&path, &raw)?;
    Ok(hex::decode(raw)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_connect_url_without_query() {
        let url = build_connect_url(
            "https://app.example.com/connect",
            "https://backend.com",
            "abc123",
        );
        assert!(url.starts_with("https://app.example.com/connect?"));
        assert!(url.contains("target="));
        assert!(url.contains("&invite=abc123"));
    }

    #[test]
    fn build_connect_url_with_query() {
        let url = build_connect_url(
            "https://app.example.com/connect?foo=bar",
            "https://backend.com",
            "abc123",
        );
        assert!(url.starts_with("https://app.example.com/connect?foo=bar&"));
        assert!(url.contains("target="));
        assert!(url.contains("&invite=abc123"));
    }

    #[test]
    fn build_connect_url_trims_trailing_slash() {
        let url = build_connect_url(
            "https://app.example.com/connect/",
            "https://backend.com",
            "abc123",
        );
        assert!(url.starts_with("https://app.example.com/connect?"));
    }

    #[test]
    fn obfuscate_backend_target_non_empty() {
        let result = obfuscate_backend_target("https://backend.com", "aabbccdd");
        assert!(!result.is_empty());
        assert!(result.contains('.'));
    }

    #[test]
    fn parse_hex_or_bytes_hex() {
        let result = parse_hex_or_bytes("aabb");
        assert_eq!(result, vec![0xaa, 0xbb]);
    }

    #[test]
    fn parse_hex_or_bytes_non_hex() {
        let result = parse_hex_or_bytes("hello!");
        assert_eq!(result, b"hello!");
    }

    #[test]
    fn parse_hex_or_bytes_odd_hex_like_falls_back_to_bytes() {
        let result = parse_hex_or_bytes("abc");
        assert_eq!(result, b"abc");
    }

    #[test]
    fn stream_key_byte_deterministic() {
        let key = vec![0x01, 0x02];
        let nonce = vec![0x03, 0x04];
        let a = stream_key_byte(0, &key, &nonce);
        let b = stream_key_byte(0, &key, &nonce);
        assert_eq!(a, b);
    }

    #[test]
    fn stream_key_byte_wraps_index_over_key_and_nonce() {
        let key = vec![0x10, 0x20];
        let nonce = vec![0x01, 0x02];
        let first = stream_key_byte(0, &key, &nonce);
        let wrapped = stream_key_byte(2, &key, &nonce);
        assert_ne!(first, wrapped);
    }

    #[test]
    fn validate_invite_valid() {
        let share = ActiveShare {
            provider: TunnelProvider::Cloudflared,
            public_backend_url: String::new(),
            connect_url: String::new(),
            invite_hash: "hash123".to_string(),
            invite_expires_at: Utc::now() + ChronoDuration::hours(1),
            invite_used: false,
            pin_hash: None,
            pin_failures: 0,
            started_at: Utc::now(),
        };
        assert!(validate_invite(&share, "hash123").is_ok());
    }

    #[test]
    fn validate_invite_wrong_hash() {
        let share = ActiveShare {
            provider: TunnelProvider::Cloudflared,
            public_backend_url: String::new(),
            connect_url: String::new(),
            invite_hash: "hash123".to_string(),
            invite_expires_at: Utc::now() + ChronoDuration::hours(1),
            invite_used: false,
            pin_hash: None,
            pin_failures: 0,
            started_at: Utc::now(),
        };
        assert!(matches!(
            validate_invite(&share, "wrong"),
            Err(RemoteError::InvalidInvite)
        ));
    }

    #[test]
    fn validate_invite_used() {
        let share = ActiveShare {
            provider: TunnelProvider::Cloudflared,
            public_backend_url: String::new(),
            connect_url: String::new(),
            invite_hash: "hash123".to_string(),
            invite_expires_at: Utc::now() + ChronoDuration::hours(1),
            invite_used: true,
            pin_hash: None,
            pin_failures: 0,
            started_at: Utc::now(),
        };
        assert!(matches!(
            validate_invite(&share, "hash123"),
            Err(RemoteError::InviteUsed)
        ));
    }

    #[test]
    fn validate_invite_expired() {
        let share = ActiveShare {
            provider: TunnelProvider::Cloudflared,
            public_backend_url: String::new(),
            connect_url: String::new(),
            invite_hash: "hash123".to_string(),
            invite_expires_at: Utc::now() - ChronoDuration::hours(1),
            invite_used: false,
            pin_hash: None,
            pin_failures: 0,
            started_at: Utc::now(),
        };
        assert!(matches!(
            validate_invite(&share, "hash123"),
            Err(RemoteError::InviteExpired)
        ));
    }

    #[test]
    fn remote_error_display_strings() {
        assert_eq!(
            RemoteError::NotActive.to_string(),
            "No active remote share session"
        );
        assert_eq!(
            RemoteError::InvalidInvite.to_string(),
            "Invite token is invalid"
        );
        assert_eq!(
            RemoteError::InviteExpired.to_string(),
            "Invite token has expired"
        );
        assert_eq!(
            RemoteError::InviteUsed.to_string(),
            "Invite token has already been used"
        );
        assert_eq!(RemoteError::PinRequired.to_string(), "PIN is required");
        assert_eq!(RemoteError::InvalidPin.to_string(), "PIN is invalid");
        assert_eq!(
            RemoteError::PinLocked.to_string(),
            "Invite token locked after too many invalid PIN attempts"
        );
        assert_eq!(
            RemoteError::InvalidTrustedDeviceToken.to_string(),
            "Trusted device token is invalid"
        );
        assert_eq!(
            RemoteError::ProviderFailed("test".to_string()).to_string(),
            "No tunnel provider available: test"
        );
    }

    #[test]
    fn obfuscate_backend_target_empty_invite_token_returns_empty() {
        // When parse_hex_or_bytes returns an empty vec (empty token string),
        // obfuscate_backend_target must return an empty String rather than panic.
        let result = obfuscate_backend_target("https://backend.com", "");
        assert!(result.is_empty());
    }
}
