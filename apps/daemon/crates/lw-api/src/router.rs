use axum::http::HeaderValue;
use axum::middleware;
use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::auth::auth_middleware;
use crate::rest::{agent, auth, bootstrap, git, health, remote, workspace};
use crate::state::AppState;
use crate::ws::handler::ws_upgrade;
use crate::ws::terminal::term_ws_upgrade;

fn is_private_network_origin(origin: &str) -> bool {
    // Extract host from origin like "http://192.168.1.5:9400"
    let host = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .unwrap_or(origin);
    let host = host.split(':').next().unwrap_or(host);

    // Check .local mDNS hostnames
    if host.ends_with(".local") {
        return true;
    }

    // Check private IPv4 ranges
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        let octets = ip.octets();
        return octets[0] == 10
            || (octets[0] == 172 && (16..=31).contains(&octets[1]))
            || (octets[0] == 192 && octets[1] == 168)
            || octets[0] == 127;
    }

    // localhost variants
    host == "localhost"
}

pub fn build_router(state: AppState) -> Router {
    let lan_enabled = state.config.lan.enabled && !state.config.host.is_loopback();
    let frontend_origin = state.config.frontend_url.clone();

    let mut static_origins: Vec<HeaderValue> = Vec::new();
    for origin in std::iter::once(frontend_origin).chain(state.config.allowed_origins.clone()) {
        if let Ok(value) = origin.parse() {
            static_origins.push(value);
        }
    }

    if static_origins.is_empty() {
        if let Ok(fallback) = state.config.frontend_url.parse() {
            static_origins.push(fallback);
        }
    }

    let allow_origin = if lan_enabled {
        AllowOrigin::predicate(move |origin, _| {
            if static_origins.iter().any(|o| o == origin) {
                return true;
            }
            if let Ok(s) = origin.to_str() {
                return is_private_network_origin(s);
            }
            false
        })
    } else {
        AllowOrigin::predicate(move |origin, _| static_origins.iter().any(|o| o == origin))
    };

    let cors = CorsLayer::new()
        .allow_origin(allow_origin)
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
        .route("/api/v1/auth/exchange", post(auth::exchange))
        .route(
            "/api/v1/remote/invite/bootstrap",
            post(remote::invite_bootstrap),
        )
        .route(
            "/api/v1/remote/invite/exchange",
            post(remote::invite_exchange),
        )
        .route(
            "/api/v1/remote/share/local/start",
            post(remote::local_share_start),
        )
        .route(
            "/api/v1/remote/share/local/stop",
            post(remote::local_share_stop),
        )
        .route(
            "/api/v1/remote/share/local/status",
            get(remote::local_share_status),
        );

    // Protected routes (auth required)
    let protected_routes = Router::new()
        .route("/api/v1/bootstrap", get(bootstrap::bootstrap))
        .route("/api/v1/auth/rotate", post(auth::rotate))
        .route("/api/v1/auth/revoke", post(auth::revoke))
        .route("/api/v1/remote/share/start", post(remote::share_start))
        .route("/api/v1/remote/share/stop", post(remote::share_stop))
        .route("/api/v1/remote/share/status", get(remote::share_status))
        .route("/api/v1/fs/roots", get(workspace::roots))
        .route("/api/v1/fs/browse", get(workspace::browse))
        .route("/api/v1/fs/list", get(workspace::list))
        .route("/api/v1/fs/read", get(workspace::read))
        .route("/api/v1/fs/read_many", post(workspace::read_many))
        .route("/api/v1/git/diff", get(git::diff))
        .route("/api/v1/git/status", get(git::status))
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
            "/api/v1/agents/sessions/{id}/rename",
            post(agent::rename_session),
        )
        .route(
            "/api/v1/agents/sessions/{id}/settings",
            post(agent::update_session_settings),
        )
        .route(
            "/api/v1/agents/sessions/{id}/attach",
            post(agent::attach_to_session),
        )
        .route(
            "/api/v1/agents/sessions/{id}/scrollback",
            get(agent::session_scrollback),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    // WebSocket route (auth via query param)
    let ws_routes = Router::new()
        .route("/api/v1/ws", get(ws_upgrade))
        .route("/api/v1/term/{session_id}", get(term_ws_upgrade));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .merge(ws_routes)
        .layer(cors)
        .layer(TraceLayer::new_for_http().make_span_with(
            |request: &axum::http::Request<axum::body::Body>| {
                tracing::info_span!(
                    "http_request",
                    method = %request.method(),
                    uri = %request.uri()
                )
            },
        ))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_private_network_origin_localhost() {
        assert!(is_private_network_origin("http://localhost:3000"));
    }

    #[test]
    fn is_private_network_origin_127() {
        assert!(is_private_network_origin("http://127.0.0.1:9400"));
        assert!(is_private_network_origin("http://127.0.0.2:80"));
    }

    #[test]
    fn is_private_network_origin_10() {
        assert!(is_private_network_origin("http://10.0.0.1:8080"));
        assert!(is_private_network_origin("http://10.255.255.255"));
    }

    #[test]
    fn is_private_network_origin_172() {
        assert!(is_private_network_origin("http://172.16.0.1:443"));
        assert!(is_private_network_origin("http://172.31.255.255"));
        assert!(!is_private_network_origin("http://172.15.0.1"));
        assert!(!is_private_network_origin("http://172.32.0.1"));
    }

    #[test]
    fn is_private_network_origin_192_168() {
        assert!(is_private_network_origin("http://192.168.1.100:3000"));
        assert!(is_private_network_origin("https://192.168.0.1"));
    }

    #[test]
    fn is_private_network_origin_local_mdns() {
        assert!(is_private_network_origin("http://myhost.local:9400"));
    }

    #[test]
    fn is_private_network_origin_public_ips() {
        assert!(!is_private_network_origin("http://8.8.8.8"));
        assert!(!is_private_network_origin("https://1.1.1.1:443"));
        assert!(!is_private_network_origin("http://203.0.113.1"));
    }

    #[test]
    fn is_private_network_origin_public_domain() {
        assert!(!is_private_network_origin("https://example.com"));
    }
}
