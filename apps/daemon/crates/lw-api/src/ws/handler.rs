use std::collections::HashMap;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::Response;
use serde::Deserialize;
use tokio::task::JoinHandle;
use tokio::time::{Duration, MissedTickBehavior};
use uuid::Uuid;

use crate::rest::git::compute_git_status;
use crate::state::AppState;
use crate::ws::messages::WsEnvelope;

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
    pub probe: Option<String>,
}

pub async fn ws_upgrade(
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, axum::http::StatusCode> {
    tracing::info!("WebSocket upgrade request received");

    let authenticated = if let Some(token) = query.token {
        if !state.token_store.validate_session(&token).await {
            let prefix: String = token.chars().take(8).collect();
            tracing::warn!(
                "WebSocket upgrade rejected: invalid token (prefix: {}...)",
                prefix
            );
            return Err(axum::http::StatusCode::UNAUTHORIZED);
        }
        true
    } else if query
        .probe
        .as_deref()
        .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
    {
        false
    } else {
        tracing::warn!("WebSocket upgrade rejected: no token provided");
        return Err(axum::http::StatusCode::UNAUTHORIZED);
    };

    tracing::info!(
        "WebSocket upgrade accepted (authenticated={})",
        authenticated
    );
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, authenticated)))
}

async fn handle_socket(socket: WebSocket, state: AppState, authenticated: bool) {
    use futures::{SinkExt, StreamExt};

    tracing::info!("WebSocket connection established");

    let (mut ws_tx, mut ws_rx) = socket.split();
    let (msg_tx, mut msg_rx) = tokio::sync::mpsc::channel::<Message>(256);

    // Forward mpsc → websocket sink
    let send_task = tokio::spawn(async move {
        while let Some(msg) = msg_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut activity_rx = state.agent_manager.subscribe_activity();
    let mut alive_tick = tokio::time::interval(Duration::from_secs(3));
    alive_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    // Track per-connection git subscription tasks
    let mut git_subs: HashMap<Uuid, JoinHandle<()>> = HashMap::new();

    loop {
        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let envelope: WsEnvelope = match serde_json::from_str(&text) {
                            Ok(envelope) => envelope,
                            Err(err) => {
                                let response = WsEnvelope::error(None, "INVALID_MESSAGE", &err.to_string(), false);
                                let _ = msg_tx
                                    .send(Message::Text(serde_json::to_string(&response).unwrap().into()))
                                    .await;
                                continue;
                            }
                        };

                        handle_client_message(&msg_tx, &state, authenticated, &envelope, &mut git_subs).await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!("WebSocket connection closed");
                        break;
                    }
                    Some(Ok(_)) => continue,
                    Some(Err(_)) => break,
                }
            }
            activity_event = activity_rx.recv() => {
                match activity_event {
                    Ok(event) => {
                        if let Ok(activity) = serde_json::to_value(event.activity) {
                            let message = WsEnvelope::agent_activity(event.session_id, activity);
                            let text = serde_json::to_string(&message).unwrap();
                            if msg_tx.send(Message::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("Activity subscriber lagged by {} messages", n);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
            _ = alive_tick.tick() => {
                let alive = WsEnvelope::daemon_alive();
                let text = serde_json::to_string(&alive).unwrap();
                if msg_tx.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        }
    }

    // Clean up all git subscriptions on disconnect
    for (_, handle) in git_subs.drain() {
        handle.abort();
    }
    drop(msg_tx);
    let _ = send_task.await;
}

async fn handle_client_message(
    tx: &tokio::sync::mpsc::Sender<Message>,
    state: &AppState,
    authenticated: bool,
    envelope: &WsEnvelope,
    git_subs: &mut HashMap<Uuid, JoinHandle<()>>,
) {
    let request_id = envelope.request_id.clone();
    if !authenticated {
        send_error(tx, request_id, "UNAUTHORIZED", "Authentication required").await;
        return;
    }

    match envelope.msg_type.as_str() {
        "fs:watch" => {
            let workspace_id = envelope.payload["workspace_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok());
            let relative_path = envelope.payload["relative_path"].as_str().unwrap_or(".");

            if let Some(wid) = workspace_id {
                if let Ok(root) = state.workspace_registry.get_root(&wid).await {
                    match state.fs_watcher.watch(wid, &root, relative_path).await {
                        Ok(_rx) => {
                            tracing::info!("Watching {}/{}", wid, relative_path);
                        }
                        Err(err) => {
                            send_error(tx, request_id, "FS_WATCH_ERROR", &err.to_string()).await;
                        }
                    }
                } else {
                    send_error(
                        tx,
                        request_id,
                        "WORKSPACE_NOT_REGISTERED",
                        "Workspace not found",
                    )
                    .await;
                }
            }
        }

        "fs:unwatch" => {
            let workspace_id = envelope.payload["workspace_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok());
            let relative_path = envelope.payload["relative_path"].as_str().unwrap_or(".");

            if let Some(wid) = workspace_id {
                state.fs_watcher.unwatch(wid, relative_path).await;
            }
        }

        "git:subscribe" => {
            let workspace_id = envelope.payload["workspace_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok());

            let Some(wid) = workspace_id else {
                send_error(tx, request_id, "INVALID_PAYLOAD", "Missing workspace_id").await;
                return;
            };

            // Tear down existing subscription for this workspace if any
            if let Some(handle) = git_subs.remove(&wid) {
                handle.abort();
            }

            let root = match state.workspace_registry.get_root(&wid).await {
                Ok(r) => r,
                Err(_) => {
                    send_error(
                        tx,
                        request_id,
                        "WORKSPACE_NOT_REGISTERED",
                        "Workspace not found",
                    )
                    .await;
                    return;
                }
            };

            let mut fs_rx = match state.fs_watcher.watch(wid, &root, ".").await {
                Ok(rx) => rx,
                Err(err) => {
                    send_error(tx, request_id, "FS_WATCH_ERROR", &err.to_string()).await;
                    return;
                }
            };

            let tx_clone = tx.clone();
            let root_clone = root.clone();
            let handle = tokio::spawn(async move {
                const DEBOUNCE: Duration = Duration::from_millis(500);
                loop {
                    // Wait for the first fs event
                    match fs_rx.recv().await {
                        Ok(_) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    }

                    // Debounce: drain further events for 500ms
                    tokio::time::sleep(DEBOUNCE).await;
                    while fs_rx.try_recv().is_ok() {}

                    // Compute git status on a blocking thread
                    let root = root_clone.clone();
                    let result =
                        tokio::task::spawn_blocking(move || compute_git_status(&root)).await;

                    let response = match result {
                        Ok(Ok(resp)) => resp,
                        Ok(Err(e)) => {
                            tracing::debug!("git status computation failed: {}", e.error.message);
                            continue;
                        }
                        Err(_) => continue,
                    };

                    let value = match serde_json::to_value(&response) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let msg = WsEnvelope::git_status(wid, value);
                    let text = serde_json::to_string(&msg).unwrap();
                    if tx_clone.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
            });

            git_subs.insert(wid, handle);
            tracing::info!("Git subscription started for workspace {}", wid);
        }

        "git:unsubscribe" => {
            let workspace_id = envelope.payload["workspace_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok());

            if let Some(wid) = workspace_id {
                if let Some(handle) = git_subs.remove(&wid) {
                    handle.abort();
                    tracing::info!("Git subscription stopped for workspace {}", wid);
                }
            }
        }

        _ => {
            send_error(
                tx,
                request_id,
                "UNKNOWN_MESSAGE_TYPE",
                &format!("Unknown message type: {}", envelope.msg_type),
            )
            .await;
        }
    }
}

async fn send_error(
    tx: &tokio::sync::mpsc::Sender<Message>,
    request_id: Option<String>,
    code: &str,
    message: &str,
) {
    let response = WsEnvelope::error(request_id, code, message, false);
    let _ = tx
        .send(Message::Text(
            serde_json::to_string(&response).unwrap().into(),
        ))
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_query_deserialize_both_fields() {
        let query: WsQuery = serde_json::from_str(r#"{"token": "abc123", "probe": "1"}"#).unwrap();
        assert_eq!(query.token, Some("abc123".to_string()));
        assert_eq!(query.probe, Some("1".to_string()));
    }

    #[test]
    fn ws_query_deserialize_token_only() {
        let query: WsQuery = serde_json::from_str(r#"{"token": "abc123"}"#).unwrap();
        assert_eq!(query.token, Some("abc123".to_string()));
        assert!(query.probe.is_none());
    }

    #[test]
    fn ws_query_deserialize_probe_only() {
        let query: WsQuery = serde_json::from_str(r#"{"probe": "true"}"#).unwrap();
        assert!(query.token.is_none());
        assert_eq!(query.probe, Some("true".to_string()));
    }

    #[test]
    fn ws_query_deserialize_empty() {
        let query: WsQuery = serde_json::from_str(r#"{}"#).unwrap();
        assert!(query.token.is_none());
        assert!(query.probe.is_none());
    }

    #[test]
    fn ws_query_probe_value_check() {
        // Mirrors the authentication logic in ws_upgrade
        let probe_true = Some("1".to_string());
        assert!(probe_true
            .as_deref()
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true")));

        let probe_true2 = Some("TRUE".to_string());
        assert!(probe_true2
            .as_deref()
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true")));

        let probe_false = Some("0".to_string());
        assert!(!probe_false
            .as_deref()
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true")));

        let probe_none: Option<String> = None;
        assert!(!probe_none
            .as_deref()
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true")));
    }
}
