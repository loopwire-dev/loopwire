use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct WsEnvelope {
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WsError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WsError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl WsEnvelope {
    pub fn new(msg_type: &str, payload: serde_json::Value) -> Self {
        Self {
            version: 1,
            request_id: None,
            msg_type: msg_type.to_string(),
            payload,
            error: None,
        }
    }

    pub fn with_request_id(mut self, id: Option<String>) -> Self {
        self.request_id = id;
        self
    }

    pub fn error(request_id: Option<String>, code: &str, message: &str, retryable: bool) -> Self {
        Self {
            version: 1,
            request_id,
            msg_type: "error".to_string(),
            payload: serde_json::Value::Null,
            error: Some(WsError {
                code: code.to_string(),
                message: message.to_string(),
                retryable,
            }),
        }
    }

    pub fn pty_output(session_id: Uuid, data: &[u8]) -> Self {
        Self::new(
            "pty:output",
            serde_json::json!({
                "session_id": session_id.to_string(),
                "data": base64_encode(data),
            }),
        )
    }

    pub fn pty_subscribed(session_id: Uuid) -> Self {
        Self::new(
            "pty:subscribed",
            serde_json::json!({
                "session_id": session_id.to_string(),
            }),
        )
    }

    pub fn pty_replay_start(session_id: Uuid) -> Self {
        Self::new(
            "pty:replay_start",
            serde_json::json!({
                "session_id": session_id.to_string(),
            }),
        )
    }

    pub fn pty_replay_end(session_id: Uuid) -> Self {
        Self::new(
            "pty:replay_end",
            serde_json::json!({
                "session_id": session_id.to_string(),
            }),
        )
    }

    pub fn pty_ready(session_id: Uuid) -> Self {
        Self::new(
            "pty:ready",
            serde_json::json!({
                "session_id": session_id.to_string(),
            }),
        )
    }

    pub fn pty_exit(session_id: Uuid, exit_code: Option<u32>) -> Self {
        Self::new(
            "pty:exit",
            serde_json::json!({
                "session_id": session_id.to_string(),
                "exit_code": exit_code,
            }),
        )
    }

    pub fn fs_change(event_kind: &str, path: &str) -> Self {
        Self::new(
            "fs:change",
            serde_json::json!({
                "event": event_kind,
                "path": path,
            }),
        )
    }

    pub fn quota_update(session_id: Uuid, usage: serde_json::Value) -> Self {
        Self::new(
            "quota:update",
            serde_json::json!({
                "session_id": session_id.to_string(),
                "usage": usage,
            }),
        )
    }
}

fn base64_encode(data: &[u8]) -> String {
    use std::io::Write;
    let mut buf = Vec::new();
    let mut encoder = Base64Encoder::new(&mut buf);
    encoder.write_all(data).unwrap();
    encoder.finish();
    String::from_utf8(buf).unwrap()
}

// Simple base64 encoder (no external dependency needed)
struct Base64Encoder<'a> {
    out: &'a mut Vec<u8>,
}

impl<'a> Base64Encoder<'a> {
    fn new(out: &'a mut Vec<u8>) -> Self {
        Self { out }
    }
    fn finish(self) {}
}

impl<'a> std::io::Write for Base64Encoder<'a> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i + 2 < buf.len() {
            let n = ((buf[i] as u32) << 16) | ((buf[i + 1] as u32) << 8) | (buf[i + 2] as u32);
            self.out.push(CHARS[((n >> 18) & 63) as usize]);
            self.out.push(CHARS[((n >> 12) & 63) as usize]);
            self.out.push(CHARS[((n >> 6) & 63) as usize]);
            self.out.push(CHARS[(n & 63) as usize]);
            i += 3;
        }
        let remaining = buf.len() - i;
        if remaining == 2 {
            let n = ((buf[i] as u32) << 16) | ((buf[i + 1] as u32) << 8);
            self.out.push(CHARS[((n >> 18) & 63) as usize]);
            self.out.push(CHARS[((n >> 12) & 63) as usize]);
            self.out.push(CHARS[((n >> 6) & 63) as usize]);
            self.out.push(b'=');
        } else if remaining == 1 {
            let n = (buf[i] as u32) << 16;
            self.out.push(CHARS[((n >> 18) & 63) as usize]);
            self.out.push(CHARS[((n >> 12) & 63) as usize]);
            self.out.push(b'=');
            self.out.push(b'=');
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
