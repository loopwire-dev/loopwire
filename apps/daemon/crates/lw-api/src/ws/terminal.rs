use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Deserialize;
use uuid::Uuid;

use crate::state::AppState;

const TERM_WIRE_VERSION: u8 = 1;
const TERM_FRAME_HISTORY: u8 = 1;
const TERM_FRAME_LIVE: u8 = 2;
const TERM_INPUT_BYTES_OPCODE: u8 = 1;

#[derive(Debug, Deserialize)]
pub struct TermWsQuery {
    pub token: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum TermClientCommand {
    Resize { cols: u16, rows: u16 },
    InputUtf8 { data: String },
}

pub async fn term_ws_upgrade(
    State(state): State<AppState>,
    Path(session_id): Path<Uuid>,
    Query(query): Query<TermWsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, StatusCode> {
    let token = query.token.ok_or(StatusCode::UNAUTHORIZED)?;
    if !state.token_store.validate_session(&token).await {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let session = state
        .agent_manager
        .ensure_pty_attached(&session_id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    if let (Some(cols), Some(rows)) = (query.cols, query.rows) {
        if cols > 0 && rows > 0 {
            if let Err(err) = session.resize(cols, rows).await {
                tracing::warn!(
                    session_id = %session_id,
                    cols,
                    rows,
                    "initial terminal resize failed: {}",
                    err
                );
            }
        }
    }

    Ok(ws.on_upgrade(move |socket| handle_terminal_socket(socket, state, session_id, session)))
}

async fn handle_terminal_socket(
    mut socket: WebSocket,
    state: AppState,
    session_id: Uuid,
    session: std::sync::Arc<lw_pty::PtySession>,
) {
    let mut output_rx = session.subscribe();
    let mut exit_rx = session.subscribe_exit();
    let mut seq: u64 = 0;

    if send_json(
        &mut socket,
        serde_json::json!({
            "type": "ready",
            "session_id": session_id.to_string(),
        }),
    )
    .await
    .is_err()
    {
        return;
    }

    let chunks = session.output_snapshot_chunked(64 * 1024);
    for chunk in &chunks {
        if send_binary_frame(
            &mut socket,
            encode_binary_frame(session_id, TERM_FRAME_HISTORY, seq, chunk),
        )
        .await
        .is_err()
        {
            return;
        }
        seq = seq.saturating_add(1);
    }

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let cmd = serde_json::from_str::<TermClientCommand>(&text);
                        match cmd {
                            Ok(TermClientCommand::Resize { cols, rows }) => {
                                if cols > 0 && rows > 0 {
                                    if let Err(err) = session.resize(cols, rows).await {
                                        if send_protocol_error(
                                            &mut socket,
                                            "PTY_RESIZE_ERROR",
                                            &err.to_string(),
                                            true,
                                        )
                                        .await
                                        .is_err()
                                        {
                                            break;
                                        }
                                    }
                                }
                            }
                            Ok(TermClientCommand::InputUtf8 { data }) => {
                                if write_input_bytes(&state, session_id, data.as_bytes(), &mut socket).await.is_err() {
                                    break;
                                }
                            }
                            Err(err) => {
                                if send_protocol_error(
                                    &mut socket,
                                    "INVALID_COMMAND",
                                    &format!("invalid terminal command: {}", err),
                                    false,
                                )
                                .await
                                .is_err()
                                {
                                    break;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if bytes.is_empty() {
                            if send_protocol_error(
                                &mut socket,
                                "INVALID_BINARY_FRAME",
                                "empty binary frame",
                                false,
                            )
                            .await
                            .is_err()
                            {
                                break;
                            }
                            continue;
                        }
                        let opcode = bytes[0];
                        match opcode {
                            TERM_INPUT_BYTES_OPCODE => {
                                if write_input_bytes(&state, session_id, &bytes[1..], &mut socket).await.is_err() {
                                    break;
                                }
                            }
                            _ => {
                                if send_protocol_error(
                                    &mut socket,
                                    "INVALID_BINARY_FRAME",
                                    "unknown binary opcode",
                                    false,
                                )
                                .await
                                .is_err()
                                {
                                    break;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            output = output_rx.recv() => {
                match output {
                    Ok(data) => {
                        if send_binary_frame(
                            &mut socket,
                            encode_binary_frame(session_id, TERM_FRAME_LIVE, seq, &data),
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                        seq = seq.saturating_add(1);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(
                            session_id = %session_id,
                            skipped,
                            "terminal output receiver lagged"
                        );
                        // Notify the client so it can reconnect and re-sync
                        // from the disk log instead of showing garbled output.
                        if send_protocol_error(
                            &mut socket,
                            "OUTPUT_LAGGED",
                            &format!("{} output frames were dropped, reconnect to re-sync", skipped),
                            true,
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
            exit = exit_rx.recv() => {
                match exit {
                    Ok(exit_code) => {
                        let _ = send_json(
                            &mut socket,
                            serde_json::json!({
                                "type": "exit",
                                "session_id": session_id.to_string(),
                                "exit_code": exit_code,
                            }),
                        )
                        .await;
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(
                            session_id = %session_id,
                            skipped,
                            "terminal exit receiver lagged"
                        );
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
        }
    }
}

async fn write_input_bytes(
    state: &AppState,
    session_id: Uuid,
    bytes: &[u8],
    socket: &mut WebSocket,
) -> Result<(), ()> {
    match state.agent_manager.input_session(&session_id, bytes).await {
        Ok(()) => Ok(()),
        Err(err) => {
            let message = err.to_string();
            let code = if message.contains("Session not found") || message.contains("not running") {
                "SESSION_NOT_FOUND"
            } else {
                "PTY_WRITE_ERROR"
            };
            send_protocol_error(socket, code, &message, true)
                .await
                .map_err(|_| ())
        }
    }
}

async fn send_protocol_error(
    socket: &mut WebSocket,
    code: &str,
    message: &str,
    retryable: bool,
) -> Result<(), axum::Error> {
    send_json(
        socket,
        serde_json::json!({
            "type": "error",
            "code": code,
            "message": message,
            "retryable": retryable,
        }),
    )
    .await
}

async fn send_json(socket: &mut WebSocket, payload: serde_json::Value) -> Result<(), axum::Error> {
    socket.send(Message::Text(payload.to_string().into())).await
}

async fn send_binary_frame(socket: &mut WebSocket, frame: Vec<u8>) -> Result<(), axum::Error> {
    socket.send(Message::Binary(frame.into())).await
}

fn encode_binary_frame(session_id: Uuid, frame_kind: u8, seq: u64, payload: &[u8]) -> Vec<u8> {
    let payload_len = payload.len().min(u32::MAX as usize);
    let payload_len_u32 = payload_len as u32;

    let mut out = Vec::with_capacity(30 + payload_len);
    out.push(TERM_WIRE_VERSION);
    out.push(frame_kind);
    out.extend_from_slice(session_id.as_bytes());
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&payload_len_u32.to_le_bytes());
    out.extend_from_slice(&payload[..payload_len]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn encode_binary_frame_header_layout() {
        let session_id = Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap();
        let payload = b"hello";
        let frame = encode_binary_frame(session_id, TERM_FRAME_LIVE, 42, payload);

        assert_eq!(frame.len(), 30 + payload.len());
        // Version byte
        assert_eq!(frame[0], TERM_WIRE_VERSION);
        // Frame kind
        assert_eq!(frame[1], TERM_FRAME_LIVE);
        // Session ID (bytes 2..18)
        assert_eq!(&frame[2..18], session_id.as_bytes());
        // Sequence number (bytes 18..26, little-endian u64)
        assert_eq!(u64::from_le_bytes(frame[18..26].try_into().unwrap()), 42);
        // Payload length (bytes 26..30, little-endian u32)
        assert_eq!(
            u32::from_le_bytes(frame[26..30].try_into().unwrap()),
            payload.len() as u32
        );
        // Payload
        assert_eq!(&frame[30..], payload);
    }

    #[test]
    fn encode_binary_frame_kinds() {
        let id = Uuid::nil();
        for (kind, expected) in [(TERM_FRAME_HISTORY, 1u8), (TERM_FRAME_LIVE, 2u8)] {
            let frame = encode_binary_frame(id, kind, 0, b"");
            assert_eq!(frame[1], expected);
        }
    }

    #[test]
    fn encode_binary_frame_empty_payload() {
        let id = Uuid::nil();
        let frame = encode_binary_frame(id, TERM_FRAME_HISTORY, 0, b"");
        assert_eq!(frame.len(), 30);
        assert_eq!(u32::from_le_bytes(frame[26..30].try_into().unwrap()), 0);
    }

    #[test]
    fn encode_binary_frame_seq_zero_and_max() {
        let id = Uuid::nil();
        let frame0 = encode_binary_frame(id, TERM_FRAME_LIVE, 0, b"x");
        assert_eq!(u64::from_le_bytes(frame0[18..26].try_into().unwrap()), 0);

        let frame_max = encode_binary_frame(id, TERM_FRAME_LIVE, u64::MAX, b"x");
        assert_eq!(
            u64::from_le_bytes(frame_max[18..26].try_into().unwrap()),
            u64::MAX
        );
    }
}
