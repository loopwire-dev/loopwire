use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::error::{ApiError, ApiErrorResponse};
use crate::state::AppState;
use lw_quota::QuotaData;

#[derive(Deserialize)]
pub struct QuotaQuery {
    pub agent_type: Option<String>,
}

pub async fn local_usage(
    State(state): State<AppState>,
    Query(query): Query<QuotaQuery>,
) -> Result<Json<Vec<QuotaData>>, ApiErrorResponse> {
    let data = state
        .quota_tracker
        .get_local_usage(query.agent_type.as_deref())
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(e.to_string()),
        })?;
    Ok(Json(data))
}

pub async fn provider_usage(
    State(_state): State<AppState>,
    Query(_query): Query<QuotaQuery>,
) -> Result<Json<serde_json::Value>, ApiErrorResponse> {
    // Provider usage is best-effort — return empty on failure
    Ok(Json(serde_json::json!({
        "data": [],
        "source": "provider",
        "source_confidence": "authoritative",
        "available": false,
        "message": "Provider API integration not yet configured"
    })))
}
