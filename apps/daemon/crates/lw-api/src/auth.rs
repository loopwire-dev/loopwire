use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use lw_config::ConfigPaths;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::{ApiError, ApiErrorResponse};

pub struct TokenStore {
    bootstrap_token_hash: RwLock<Option<String>>,
    session_token_hashes: Arc<RwLock<HashSet<String>>>,
    paths: ConfigPaths,
}

impl TokenStore {
    pub fn new(bootstrap_token_hash: String, paths: ConfigPaths) -> Self {
        let sessions = load_session_hashes(&paths);
        Self {
            bootstrap_token_hash: RwLock::new(Some(bootstrap_token_hash)),
            session_token_hashes: Arc::new(RwLock::new(sessions)),
            paths,
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
        let path = self.paths.sessions_path();
        if let Err(e) = std::fs::write(&path, content) {
            tracing::warn!("Failed to persist session hashes: {}", e);
        }
    }
}

fn load_session_hashes(paths: &ConfigPaths) -> HashSet<String> {
    let path = paths.sessions_path();
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
pub fn load_or_create_bootstrap_token(paths: &ConfigPaths) -> (String, String) {
    let path = paths.token_path();
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
pub fn regenerate_bootstrap_token(paths: &ConfigPaths) -> String {
    let token = generate_token();
    let path = paths.token_path();
    let _ = std::fs::write(&path, &token);
    token
}

pub fn generate_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

pub fn extract_bearer_from_headers(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

pub fn extract_bearer_token(req: &Request) -> Option<String> {
    extract_bearer_from_headers(req.headers())
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn hash_token_deterministic() {
        let h1 = TokenStore::hash_token("test");
        let h2 = TokenStore::hash_token("test");
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_token_known_vector() {
        // SHA-256 of "test"
        let hash = TokenStore::hash_token("test");
        assert_eq!(
            hash,
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        );
    }

    #[test]
    fn generate_token_length_and_hex() {
        let token = generate_token();
        assert_eq!(token.len(), 64); // 32 bytes = 64 hex chars
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generate_token_unique() {
        let t1 = generate_token();
        let t2 = generate_token();
        assert_ne!(t1, t2);
    }

    #[test]
    fn extract_bearer_from_headers_valid() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer my-token".parse().unwrap());
        assert_eq!(
            extract_bearer_from_headers(&headers),
            Some("my-token".to_string())
        );
    }

    #[test]
    fn extract_bearer_from_headers_missing() {
        let headers = HeaderMap::new();
        assert_eq!(extract_bearer_from_headers(&headers), None);
    }

    #[test]
    fn extract_bearer_from_headers_malformed() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Basic abc123".parse().unwrap());
        assert_eq!(extract_bearer_from_headers(&headers), None);
    }

    #[test]
    fn extract_bearer_token_from_request() {
        let req = Request::builder()
            .header("authorization", "Bearer req-token")
            .body(axum::body::Body::empty())
            .unwrap();
        assert_eq!(extract_bearer_token(&req), Some("req-token".to_string()));
    }

    #[test]
    fn extract_bearer_token_missing_header() {
        let req = Request::builder().body(axum::body::Body::empty()).unwrap();
        assert_eq!(extract_bearer_token(&req), None);
    }

    fn make_token_store() -> (tempfile::TempDir, TokenStore) {
        let dir = tempfile::tempdir().unwrap();
        let paths = ConfigPaths::with_base(dir.path().to_path_buf());
        std::fs::create_dir_all(dir.path()).unwrap();
        let bootstrap_hash = TokenStore::hash_token("bootstrap-secret");
        let store = TokenStore::new(bootstrap_hash, paths);
        (dir, store)
    }

    #[tokio::test]
    async fn bootstrap_validate_and_consume_lifecycle() {
        let (_dir, store) = make_token_store();
        assert!(store.validate_bootstrap("bootstrap-secret").await);
        assert!(store.consume_bootstrap().await);
        // Second consume fails
        assert!(!store.consume_bootstrap().await);
    }

    #[tokio::test]
    async fn session_add_validate_revoke_lifecycle() {
        let (_dir, store) = make_token_store();
        let token = "session-token-123";
        let hash = TokenStore::hash_token(token);
        store.add_session_token(hash).await;
        assert!(store.validate_session(token).await);
        assert!(store.revoke_session(token).await);
        assert!(!store.validate_session(token).await);
    }

    #[tokio::test]
    async fn rotate_session_removes_old_hash() {
        let (_dir, store) = make_token_store();
        let old_token = "old-token";
        let old_hash = TokenStore::hash_token(old_token);
        store.add_session_token(old_hash).await;
        assert!(store.validate_session(old_token).await);
        let result = store.rotate_session(old_token).await;
        assert!(result.is_some());
        assert!(!store.validate_session(old_token).await);
    }

    #[tokio::test]
    async fn rotate_session_nonexistent_returns_none() {
        let (_dir, store) = make_token_store();
        let result = store.rotate_session("nonexistent-token").await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn consumed_bootstrap_rejects_validation() {
        let (_dir, store) = make_token_store();
        store.consume_bootstrap().await;
        assert!(!store.validate_bootstrap("bootstrap-secret").await);
    }
}
