use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use lw_config::DaemonConfig;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::{ApiError, ApiErrorResponse};

pub struct TokenStore {
    bootstrap_token_hash: RwLock<Option<String>>,
    session_token_hashes: Arc<RwLock<HashSet<String>>>,
}

impl TokenStore {
    pub fn new(bootstrap_token_hash: String) -> Self {
        let sessions = load_session_hashes();
        Self {
            bootstrap_token_hash: RwLock::new(Some(bootstrap_token_hash)),
            session_token_hashes: Arc::new(RwLock::new(sessions)),
        }
    }

    pub fn hash_token(token: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        hex::encode(hasher.finalize())
    }

    pub async fn validate_bootstrap(&self, token: &str) -> bool {
        let hash = Self::hash_token(token);
        let stored = self.bootstrap_token_hash.read().await;
        stored.as_deref() == Some(&hash)
    }

    pub async fn consume_bootstrap(&self) -> bool {
        let mut stored = self.bootstrap_token_hash.write().await;
        if stored.is_some() {
            *stored = None;
            true
        } else {
            false
        }
    }

    pub async fn add_session_token(&self, token_hash: String) {
        self.session_token_hashes.write().await.insert(token_hash);
        self.persist_sessions().await;
    }

    pub async fn validate_session(&self, token: &str) -> bool {
        let hash = Self::hash_token(token);
        self.session_token_hashes.read().await.contains(&hash)
    }

    pub async fn revoke_session(&self, token: &str) -> bool {
        let hash = Self::hash_token(token);
        let removed = self.session_token_hashes.write().await.remove(&hash);
        if removed {
            self.persist_sessions().await;
        }
        removed
    }

    pub async fn rotate_session(&self, old_token: &str) -> Option<()> {
        let old_hash = Self::hash_token(old_token);
        let mut tokens = self.session_token_hashes.write().await;
        if tokens.remove(&old_hash) {
            drop(tokens);
            self.persist_sessions().await;
            Some(())
        } else {
            None
        }
    }

    pub async fn set_bootstrap_hash(&self, hash: String) {
        *self.bootstrap_token_hash.write().await = Some(hash);
    }

    async fn persist_sessions(&self) {
        let hashes = self.session_token_hashes.read().await;
        let content = hashes.iter().cloned().collect::<Vec<_>>().join("\n");
        let path = DaemonConfig::sessions_path();
        if let Err(e) = std::fs::write(&path, content) {
            tracing::warn!("Failed to persist session hashes: {}", e);
        }
    }
}

fn load_session_hashes() -> HashSet<String> {
    let path = DaemonConfig::sessions_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => content
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect(),
        Err(_) => HashSet::new(),
    }
}

/// Load or generate a bootstrap token. Returns (plaintext_token, hash).
pub fn load_or_create_bootstrap_token() -> (String, String) {
    let path = DaemonConfig::token_path();
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let token = existing.trim().to_string();
        if !token.is_empty() {
            let hash = TokenStore::hash_token(&token);
            return (token, hash);
        }
    }
    let token = generate_token();
    let _ = std::fs::write(&path, &token);
    let hash = TokenStore::hash_token(&token);
    (token, hash)
}

/// Generate a new bootstrap token, overwriting any existing one.
pub fn regenerate_bootstrap_token() -> String {
    let token = generate_token();
    let path = DaemonConfig::token_path();
    let _ = std::fs::write(&path, &token);
    token
}

fn generate_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

pub fn extract_bearer_token(req: &Request) -> Option<String> {
    req.headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

pub async fn auth_middleware(
    state: axum::extract::State<crate::state::AppState>,
    req: Request,
    next: Next,
) -> Result<Response, ApiErrorResponse> {
    let token = extract_bearer_token(&req).ok_or_else(|| ApiErrorResponse {
        status: StatusCode::UNAUTHORIZED,
        error: ApiError::unauthorized(),
    })?;

    if !state.token_store.validate_session(&token).await {
        return Err(ApiErrorResponse {
            status: StatusCode::UNAUTHORIZED,
            error: ApiError::invalid_token(),
        });
    }

    Ok(next.run(req).await)
}
