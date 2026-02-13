use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::Response;
use base64::Engine;
use serde::Deserialize;
use std::collections::HashSet;
use std::pin::Pin;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::state::AppState;
use crate::ws::messages::WsEnvelope;
use lw_agent::AgentStatus;

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
}

pub async fn ws_upgrade(
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, axum::http::StatusCode> {
    tracing::info!("WebSocket upgrade request received");

    // Authenticate via query param token
    let token = match query.token {
        Some(t) => t,
        None => {
            tracing::warn!("WebSocket upgrade rejected: no token provided");
            return Err(axum::http::StatusCode::UNAUTHORIZED);
        }
    };

    if !state.token_store.validate_session(&token).await {
        let prefix: String = token.chars().take(8).collect();
        tracing::warn!(
            "WebSocket upgrade rejected: invalid token (prefix: {}...)",
            prefix
        );
        return Err(axum::http::StatusCode::UNAUTHORIZED);
    }

    tracing::info!("WebSocket upgrade accepted");
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state)))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    tracing::info!("WebSocket connection established");

    let mut subscribed_pty: HashSet<Uuid> = HashSet::new();
    let mut pty_receivers: Vec<(Uuid, broadcast::Receiver<Vec<u8>>)> = Vec::new();
    let mut exit_receivers: Vec<(Uuid, broadcast::Receiver<Option<u32>>)> = Vec::new();

    loop {
        // Build a select over: incoming messages + all PTY outputs + exit events
        tokio::select! {
            // Handle incoming WebSocket messages
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let envelope: WsEnvelope = match serde_json::from_str(&text) {
                            Ok(e) => e,
                            Err(e) => {
                                let err = WsEnvelope::error(None, "INVALID_MESSAGE", &e.to_string(), false);
                                let _ = socket.send(Message::Text(serde_json::to_string(&err).unwrap().into())).await;
                                continue;
                            }
                        };
                        handle_client_message(
                            &mut socket,
                            &state,
                            &envelope,
                            &mut subscribed_pty,
                            &mut pty_receivers,
                            &mut exit_receivers,
                        )
                        .await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!("WebSocket connection closed");
                        break;
                    }
                    _ => continue,
                }
            }

            // Forward PTY output to client
            output = recv_any_pty(&mut pty_receivers) => {
                let (session_id, result) = output;
                match result {
                    Ok(data) => {
                        let msg = WsEnvelope::pty_output(session_id, &data);
                        let text = serde_json::to_string(&msg).unwrap();
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("PTY subscriber lagged by {} messages", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        // Session ended
                    }
                }
            }

            // Forward PTY exits to client
            exit_event = recv_any_exit(&mut exit_receivers) => {
                let (session_id, result) = exit_event;
                match result {
                    Ok(code) => {
                        let should_forward_exit = match state.agent_manager.get_handle(&session_id).await {
                            Some(handle) => handle.status != AgentStatus::Running,
                            None => true,
                        };
                        if !should_forward_exit {
                            continue;
                        }
                        let msg = WsEnvelope::pty_exit(session_id, code);
                        let text = serde_json::to_string(&msg).unwrap();
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("PTY exit subscriber lagged by {} messages", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        // Session exit channel closed
                    }
                }
            }
        }
    }
}

/// Awaits the next PTY output from any of the subscribed receivers.
/// If there are no receivers, this future never resolves (pends forever),
/// which is correct behavior inside `tokio::select!`.
async fn recv_any_pty(
    receivers: &mut Vec<(Uuid, broadcast::Receiver<Vec<u8>>)>,
) -> (Uuid, Result<Vec<u8>, broadcast::error::RecvError>) {
    if receivers.is_empty() {
        return std::future::pending().await;
    }
    let futs: Vec<
        Pin<
            Box<
                dyn std::future::Future<
                        Output = (Uuid, Result<Vec<u8>, broadcast::error::RecvError>),
                    > + Send
                    + '_,
            >,
        >,
    > = receivers
        .iter_mut()
        .map(|(id, rx)| {
            let id = *id;
            Box::pin(async move { (id, rx.recv().await) })
                as Pin<Box<dyn std::future::Future<Output = _> + Send + '_>>
        })
        .collect();
    let (result, _, _) = futures::future::select_all(futs).await;
    result
}

/// Awaits the next PTY exit event from any of the subscribed receivers.
async fn recv_any_exit(
    receivers: &mut Vec<(Uuid, broadcast::Receiver<Option<u32>>)>,
) -> (Uuid, Result<Option<u32>, broadcast::error::RecvError>) {
    if receivers.is_empty() {
        return std::future::pending().await;
    }
    let futs: Vec<
        Pin<
            Box<
                dyn std::future::Future<
                        Output = (Uuid, Result<Option<u32>, broadcast::error::RecvError>),
                    > + Send
                    + '_,
            >,
        >,
    > = receivers
        .iter_mut()
        .map(|(id, rx)| {
            let id = *id;
            Box::pin(async move { (id, rx.recv().await) })
                as Pin<Box<dyn std::future::Future<Output = _> + Send + '_>>
        })
        .collect();
    let (result, _, _) = futures::future::select_all(futs).await;
    result
}

async fn handle_client_message(
    socket: &mut WebSocket,
    state: &AppState,
    envelope: &WsEnvelope,
    subscribed: &mut HashSet<Uuid>,
    pty_receivers: &mut Vec<(Uuid, broadcast::Receiver<Vec<u8>>)>,
    exit_receivers: &mut Vec<(Uuid, broadcast::Receiver<Option<u32>>)>,
) {
    let request_id = envelope.request_id.clone();

    match envelope.msg_type.as_str() {
        "pty:subscribe" => {
            let session_id = match extract_session_id(&envelope.payload) {
                Some(id) => id,
                None => {
                    send_error(socket, request_id, "INVALID_PAYLOAD", "Missing session_id").await;
                    return;
                }
            };

            let had_existing_pty = state.pty_manager.get(&session_id).await.is_ok();
            match state.agent_manager.ensure_pty_attached(&session_id).await {
                Ok(session) => {
                    if subscribed.insert(session_id) {
                        let rx = session.subscribe();
                        pty_receivers.push((session_id, rx));
                        let exit_rx = session.subscribe_exit();
                        exit_receivers.push((session_id, exit_rx));

                        if had_existing_pty {
                            let replay_start = WsEnvelope::pty_replay_start(session_id);
                            let _ = socket
                                .send(Message::Text(
                                    serde_json::to_string(&replay_start).unwrap().into(),
                                ))
                                .await;

                            let replay = session.output_snapshot();
                            if !replay.is_empty() {
                                let replay_msg = WsEnvelope::pty_output(session_id, &replay);
                                let _ = socket
                                    .send(Message::Text(
                                        serde_json::to_string(&replay_msg).unwrap().into(),
                                    ))
                                    .await;
                            }

                            let replay_end = WsEnvelope::pty_replay_end(session_id);
                            let _ = socket
                                .send(Message::Text(
                                    serde_json::to_string(&replay_end).unwrap().into(),
                                ))
                                .await;
                        }

                        let ack = WsEnvelope::pty_subscribed(session_id)
                            .with_request_id(request_id.clone());
                        let _ = socket
                            .send(Message::Text(serde_json::to_string(&ack).unwrap().into()))
                            .await;
                    } else {
                        let ack =
                            WsEnvelope::pty_subscribed(session_id).with_request_id(request_id);
                        let _ = socket
                            .send(Message::Text(serde_json::to_string(&ack).unwrap().into()))
                            .await;
                    }
                }
                Err(_) => {
                    send_error(
                        socket,
                        request_id,
                        "SESSION_NOT_FOUND",
                        "PTY session not found",
                    )
                    .await;
                }
            }
        }

        "pty:input" => {
            let session_id = match extract_session_id(&envelope.payload) {
                Some(id) => id,
                None => {
                    send_error(socket, request_id, "INVALID_PAYLOAD", "Missing session_id").await;
                    return;
                }
            };
            let data = envelope.payload["data"].as_str().unwrap_or("");
            let data_b64 = envelope.payload["data_b64"].as_str();

            let bytes = if let Some(b64) = data_b64 {
                match base64::engine::general_purpose::STANDARD.decode(b64) {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        send_error(socket, request_id, "INVALID_PAYLOAD", "Invalid data_b64").await;
                        return;
                    }
                }
            } else {
                data.as_bytes().to_vec()
            };

            match state.pty_manager.get(&session_id).await {
                Ok(session) => {
                    if let Err(e) = session.write(&bytes).await {
                        send_error(socket, request_id, "PTY_WRITE_ERROR", &e.to_string()).await;
                    }
                }
                Err(_) => {
                    send_error(
                        socket,
                        request_id,
                        "SESSION_NOT_FOUND",
                        "PTY session not found",
                    )
                    .await;
                }
            }
        }

        "pty:ready" => {
            let session_id = match extract_session_id(&envelope.payload) {
                Some(id) => id,
                None => {
                    send_error(socket, request_id, "INVALID_PAYLOAD", "Missing session_id").await;
                    return;
                }
            };

            match state.pty_manager.get(&session_id).await {
                Ok(_) => {
                    let ack = WsEnvelope::pty_ready(session_id).with_request_id(request_id);
                    let _ = socket
                        .send(Message::Text(serde_json::to_string(&ack).unwrap().into()))
                        .await;
                }
                Err(_) => {
                    send_error(
                        socket,
                        request_id,
                        "SESSION_NOT_FOUND",
                        "PTY session not found",
                    )
                    .await;
                }
            }
        }

        "pty:resize" => {
            let session_id = match extract_session_id(&envelope.payload) {
                Some(id) => id,
                None => {
                    send_error(socket, request_id, "INVALID_PAYLOAD", "Missing session_id").await;
                    return;
                }
            };
            let cols = envelope.payload["cols"].as_u64().unwrap_or(80) as u16;
            let rows = envelope.payload["rows"].as_u64().unwrap_or(24) as u16;

            match state.pty_manager.get(&session_id).await {
                Ok(session) => {
                    if let Err(e) = session.resize(cols, rows).await {
                        send_error(socket, request_id, "PTY_RESIZE_ERROR", &e.to_string()).await;
                    }
                }
                Err(_) => {
                    send_error(
                        socket,
                        request_id,
                        "SESSION_NOT_FOUND",
                        "PTY session not found",
                    )
                    .await;
                }
            }
        }

        "pty:unsubscribe" => {
            let session_id = match extract_session_id(&envelope.payload) {
                Some(id) => id,
                None => return,
            };
            subscribed.remove(&session_id);
            pty_receivers.retain(|(id, _)| *id != session_id);
            exit_receivers.retain(|(id, _)| *id != session_id);
        }

        "fs:watch" => {
            let workspace_id = envelope.payload["workspace_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok());
            let relative_path = envelope.payload["relative_path"].as_str().unwrap_or(".");

            if let Some(wid) = workspace_id {
                if let Ok(root) = state.workspace_registry.get_root(&wid).await {
                    match state.fs_watcher.watch(wid, &root, relative_path).await {
                        Ok(_rx) => {
                            // FS events would be forwarded in a real implementation
                            tracing::info!("Watching {}/{}", wid, relative_path);
                        }
                        Err(e) => {
                            send_error(socket, request_id, "FS_WATCH_ERROR", &e.to_string()).await;
                        }
                    }
                } else {
                    send_error(
                        socket,
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

        _ => {
            send_error(
                socket,
                request_id,
                "UNKNOWN_MESSAGE_TYPE",
                &format!("Unknown message type: {}", envelope.msg_type),
            )
            .await;
        }
    }
}

fn extract_session_id(payload: &serde_json::Value) -> Option<Uuid> {
    payload["session_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
}


async fn send_error(socket: &mut WebSocket, request_id: Option<String>, code: &str, message: &str) {
    let err = WsEnvelope::error(request_id, code, message, false);
    let _ = socket
        .send(Message::Text(serde_json::to_string(&err).unwrap().into()))
        .await;
}
