use axum::middleware;
use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::auth::auth_middleware;
use crate::rest::{agent, auth, health, quota, workspace};
use crate::state::AppState;
use crate::ws::handler::ws_upgrade;

pub fn build_router(state: AppState) -> Router {
    let frontend_origin = state.config.frontend_url.clone();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::exact(
            frontend_origin
                .parse()
                .unwrap_or_else(|_| "http://localhost:5173".parse().unwrap()),
        ))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
        ])
        .allow_credentials(true);

    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/api/v1/health", get(health::health))
        .route("/api/v1/auth/bootstrap", post(auth::bootstrap))
        .route("/api/v1/auth/exchange", post(auth::exchange));

    // Protected routes (auth required)
    let protected_routes = Router::new()
        .route("/api/v1/auth/rotate", post(auth::rotate))
        .route("/api/v1/auth/revoke", post(auth::revoke))
        .route("/api/v1/fs/roots", get(workspace::roots))
        .route("/api/v1/fs/browse", get(workspace::browse))
        .route("/api/v1/fs/list", get(workspace::list))
        .route("/api/v1/fs/read", get(workspace::read))
        .route("/api/v1/workspaces", get(workspace::list_workspaces))
        .route("/api/v1/workspaces/register", post(workspace::register))
        .route(
            "/api/v1/workspaces/settings",
            post(workspace::update_workspace_settings),
        )
        .route(
            "/api/v1/workspaces/remove",
            post(workspace::remove_workspace),
        )
        .route("/api/v1/agents/available", get(agent::available))
        .route("/api/v1/agents/sessions", get(agent::list_sessions))
        .route("/api/v1/agents/sessions", post(agent::create_session))
        .route("/api/v1/agents/sessions/{id}", get(agent::get_session))
        .route(
            "/api/v1/agents/sessions/{id}/stop",
            post(agent::stop_session),
        )
        .route(
            "/api/v1/agents/sessions/{id}/resize",
            post(agent::resize_session),
        )
        .route(
            "/api/v1/agents/sessions/{id}/input",
            post(agent::input_session),
        )
        .route("/api/v1/quota/local", get(quota::local_usage))
        .route("/api/v1/quota/provider", get(quota::provider_usage))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    // WebSocket route (auth via query param)
    let ws_routes = Router::new().route("/api/v1/ws", get(ws_upgrade));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .merge(ws_routes)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
