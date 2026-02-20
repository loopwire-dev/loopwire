use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use serde::{Deserialize, Serialize};

use crate::auth::{extract_bearer_from_headers, generate_token, TokenStore};
use crate::error::{ApiError, ApiErrorResponse};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ExchangeRequest {
    pub bootstrap_token: String,
}

#[derive(Serialize)]
pub struct ExchangeResponse {
    pub session_token: String,
}

#[derive(Serialize)]
pub struct BootstrapResponse {
    pub status: String,
    pub version: String,
}

#[derive(Serialize)]
pub struct RotateResponse {
    pub session_token: String,
}

pub async fn bootstrap(State(state): State<AppState>) -> Json<BootstrapResponse> {
    Json(BootstrapResponse {
        status: "ready".to_string(),
        version: state.version.to_string(),
    })
}

pub async fn exchange(
    State(state): State<AppState>,
    Json(body): Json<ExchangeRequest>,
) -> Result<Json<ExchangeResponse>, ApiErrorResponse> {
    // Validate bootstrap token
    if !state
        .token_store
        .validate_bootstrap(&body.bootstrap_token)
        .await
    {
        return Err(ApiErrorResponse {
            status: StatusCode::UNAUTHORIZED,
            error: ApiError::invalid_token(),
        });
    }

    // Consume (single-use)
    if !state.token_store.consume_bootstrap().await {
        return Err(ApiErrorResponse {
            status: StatusCode::CONFLICT,
            error: ApiError::token_already_used(),
        });
    }

    // Generate session token
    let session_token = generate_token();
    let session_hash = TokenStore::hash_token(&session_token);
    state.token_store.add_session_token(session_hash).await;

    Ok(Json(ExchangeResponse { session_token }))
}

pub async fn rotate(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<RotateResponse>, ApiErrorResponse> {
    let token = extract_bearer_from_headers(&headers).ok_or_else(|| ApiErrorResponse {
        status: StatusCode::UNAUTHORIZED,
        error: ApiError::unauthorized(),
    })?;

    // Revoke old token
    state
        .token_store
        .rotate_session(&token)
        .await
        .ok_or_else(|| ApiErrorResponse {
            status: StatusCode::UNAUTHORIZED,
            error: ApiError::invalid_token(),
        })?;

    // Issue new one
    let new_token = generate_token();
    let new_hash = TokenStore::hash_token(&new_token);
    state.token_store.add_session_token(new_hash).await;

    Ok(Json(RotateResponse {
        session_token: new_token,
    }))
}

pub async fn revoke(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiErrorResponse> {
    let token = extract_bearer_from_headers(&headers).ok_or_else(|| ApiErrorResponse {
        status: StatusCode::UNAUTHORIZED,
        error: ApiError::unauthorized(),
    })?;

    state.token_store.revoke_session(&token).await;
    Ok(StatusCode::NO_CONTENT)
}
