use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use std::net::SocketAddr;

use crate::error::{ApiError, ApiErrorResponse};
use crate::remote::{RemoteError, ShareStartOptions};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ShareStartRequest {
    pub pin: Option<String>,
    pub ttl_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct InviteBootstrapRequest {
    pub invite_token: String,
}

#[derive(Debug, Deserialize)]
pub struct InviteExchangeRequest {
    pub invite_token: String,
    pub pin: Option<String>,
    pub trusted_device_token: Option<String>,
}

pub async fn share_start(
    State(state): State<AppState>,
    Json(body): Json<ShareStartRequest>,
) -> Result<Json<crate::remote::ShareStartResult>, ApiErrorResponse> {
    let response = state
        .remote_access
        .start_share(ShareStartOptions {
            pin: body.pin,
            ttl_seconds: body.ttl_seconds,
        })
        .await
        .map_err(remote_error_to_response)?;

    Ok(Json(response))
}

pub async fn share_stop(State(state): State<AppState>) -> Result<StatusCode, ApiErrorResponse> {
    state
        .remote_access
        .stop_share()
        .await
        .map_err(remote_error_to_response)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn share_status(State(state): State<AppState>) -> Json<crate::remote::ShareStatus> {
    Json(state.remote_access.status().await)
}

pub async fn invite_bootstrap(
    State(state): State<AppState>,
    Json(body): Json<InviteBootstrapRequest>,
) -> Result<Json<crate::remote::InviteBootstrapResult>, ApiErrorResponse> {
    let response = state
        .remote_access
        .invite_bootstrap(&body.invite_token)
        .await
        .map_err(remote_error_to_response)?;

    Ok(Json(response))
}

pub async fn invite_exchange(
    State(state): State<AppState>,
    Json(body): Json<InviteExchangeRequest>,
) -> Result<Json<crate::remote::InviteExchangeResult>, ApiErrorResponse> {
    let response = state
        .remote_access
        .invite_exchange(
            &body.invite_token,
            body.pin.as_deref(),
            body.trusted_device_token.as_deref(),
        )
        .await
        .map_err(remote_error_to_response)?;

    Ok(Json(response))
}

pub async fn local_share_start(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(body): Json<ShareStartRequest>,
) -> Result<Json<crate::remote::ShareStartResult>, ApiErrorResponse> {
    ensure_loopback(addr)?;

    let response = state
        .remote_access
        .start_share(ShareStartOptions {
            pin: body.pin,
            ttl_seconds: body.ttl_seconds,
        })
        .await
        .map_err(remote_error_to_response)?;

    Ok(Json(response))
}

pub async fn local_share_stop(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
) -> Result<StatusCode, ApiErrorResponse> {
    ensure_loopback(addr)?;

    state
        .remote_access
        .stop_share()
        .await
        .map_err(remote_error_to_response)?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn local_share_status(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
) -> Result<Json<crate::remote::ShareStatus>, ApiErrorResponse> {
    ensure_loopback(addr)?;

    Ok(Json(state.remote_access.status().await))
}

fn ensure_loopback(addr: SocketAddr) -> Result<(), ApiErrorResponse> {
    if addr.ip().is_loopback() {
        Ok(())
    } else {
        Err(ApiErrorResponse {
            status: StatusCode::FORBIDDEN,
            error: ApiError::new(
                "FORBIDDEN",
                "This endpoint is only available from the local machine",
            ),
        })
    }
}

fn remote_error_to_response(err: RemoteError) -> ApiErrorResponse {
    match err {
        RemoteError::NotActive => ApiErrorResponse {
            status: StatusCode::NOT_FOUND,
            error: ApiError::new("REMOTE_NOT_ACTIVE", err.to_string()),
        },
        RemoteError::InvalidInvite | RemoteError::InviteExpired | RemoteError::InviteUsed => {
            ApiErrorResponse {
                status: StatusCode::UNAUTHORIZED,
                error: ApiError::invalid_token(),
            }
        }
        RemoteError::PinRequired => ApiErrorResponse {
            status: StatusCode::UNAUTHORIZED,
            error: ApiError::new("PIN_REQUIRED", err.to_string()),
        },
        RemoteError::InvalidPin => ApiErrorResponse {
            status: StatusCode::UNAUTHORIZED,
            error: ApiError::new("INVALID_PIN", err.to_string()),
        },
        RemoteError::PinLocked => ApiErrorResponse {
            status: StatusCode::TOO_MANY_REQUESTS,
            error: ApiError::new("PIN_LOCKED", err.to_string()),
        },
        RemoteError::InvalidTrustedDeviceToken => ApiErrorResponse {
            status: StatusCode::UNAUTHORIZED,
            error: ApiError::new("INVALID_TRUSTED_DEVICE", err.to_string()),
        },
        RemoteError::ProviderFailed(message) => ApiErrorResponse {
            status: StatusCode::SERVICE_UNAVAILABLE,
            error: ApiError::new("REMOTE_PROVIDER_UNAVAILABLE", message),
        },
        RemoteError::Internal(err) => ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(err.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_loopback_passes() {
        let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        assert!(ensure_loopback(addr).is_ok());
    }

    #[test]
    fn ensure_loopback_ipv6_passes() {
        let addr: SocketAddr = "[::1]:8080".parse().unwrap();
        assert!(ensure_loopback(addr).is_ok());
    }

    #[test]
    fn ensure_loopback_non_loopback_fails() {
        let addr: SocketAddr = "192.168.1.1:8080".parse().unwrap();
        let err = ensure_loopback(addr).unwrap_err();
        assert_eq!(err.status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn remote_error_to_response_not_active() {
        let resp = remote_error_to_response(RemoteError::NotActive);
        assert_eq!(resp.status, StatusCode::NOT_FOUND);
    }

    #[test]
    fn remote_error_to_response_invalid_invite() {
        let resp = remote_error_to_response(RemoteError::InvalidInvite);
        assert_eq!(resp.status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn remote_error_to_response_invite_expired() {
        let resp = remote_error_to_response(RemoteError::InviteExpired);
        assert_eq!(resp.status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn remote_error_to_response_invite_used() {
        let resp = remote_error_to_response(RemoteError::InviteUsed);
        assert_eq!(resp.status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn remote_error_to_response_pin_required() {
        let resp = remote_error_to_response(RemoteError::PinRequired);
        assert_eq!(resp.status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn remote_error_to_response_invalid_pin() {
        let resp = remote_error_to_response(RemoteError::InvalidPin);
        assert_eq!(resp.status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn remote_error_to_response_pin_locked() {
        let resp = remote_error_to_response(RemoteError::PinLocked);
        assert_eq!(resp.status, StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn remote_error_to_response_invalid_trusted_device() {
        let resp = remote_error_to_response(RemoteError::InvalidTrustedDeviceToken);
        assert_eq!(resp.status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn remote_error_to_response_provider_failed() {
        let resp =
            remote_error_to_response(RemoteError::ProviderFailed("no providers".to_string()));
        assert_eq!(resp.status, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn remote_error_to_response_internal() {
        let resp =
            remote_error_to_response(RemoteError::Internal(anyhow::anyhow!("something broke")));
        assert_eq!(resp.status, StatusCode::INTERNAL_SERVER_ERROR);
    }
}
