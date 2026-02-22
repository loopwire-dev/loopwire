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

    pub fn pty_replay_start(
        session_id: Uuid,
        start_offset: usize,
        end_offset: usize,
        has_more: bool,
    ) -> Self {
        Self::new(
            "pty:replay_start",
            serde_json::json!({
                "session_id": session_id.to_string(),
                "start_offset": usize_to_u64(start_offset),
                "end_offset": usize_to_u64(end_offset),
                "has_more": has_more,
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

    pub fn pty_history(
        session_id: Uuid,
        data: &[u8],
        start_offset: usize,
        end_offset: usize,
        has_more: bool,
    ) -> Self {
        Self::new(
            "pty:history",
            serde_json::json!({
                "session_id": session_id.to_string(),
                "data": base64_encode(data),
                "start_offset": usize_to_u64(start_offset),
                "end_offset": usize_to_u64(end_offset),
                "has_more": has_more,
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

    pub fn agent_activity(session_id: Uuid, activity: serde_json::Value) -> Self {
        Self::new(
            "agent:activity",
            serde_json::json!({
                "session_id": session_id.to_string(),
                "activity": activity,
            }),
        )
    }

    pub fn git_status(workspace_id: Uuid, response: serde_json::Value) -> Self {
        Self::new(
            "git:status",
            serde_json::json!({
                "workspace_id": workspace_id.to_string(),
                "files": response["files"],
                "ignored_dirs": response["ignored_dirs"],
            }),
        )
    }

    pub fn daemon_alive() -> Self {
        let ts_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .ok()
            .and_then(|ms| u64::try_from(ms).ok())
            .unwrap_or(0);
        Self::new(
            "daemon:alive",
            serde_json::json!({
                "ts_ms": ts_ms,
            }),
        )
    }
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn usize_to_u64(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_envelope_new() {
        let env = WsEnvelope::new("test", serde_json::json!({"key": "val"}));
        assert_eq!(env.version, 1);
        assert_eq!(env.msg_type, "test");
        assert!(env.request_id.is_none());
        assert!(env.error.is_none());
    }

    #[test]
    fn ws_envelope_with_request_id() {
        let env = WsEnvelope::new("test", serde_json::Value::Null)
            .with_request_id(Some("req-1".to_string()));
        assert_eq!(env.request_id, Some("req-1".to_string()));
    }

    #[test]
    fn ws_envelope_error() {
        let env = WsEnvelope::error(Some("req-2".to_string()), "ERR", "fail", true);
        assert_eq!(env.msg_type, "error");
        assert!(env.error.is_some());
        let err = env.error.unwrap();
        assert_eq!(err.code, "ERR");
        assert_eq!(err.message, "fail");
        assert!(err.retryable);
    }

    #[test]
    fn pty_output_base64() {
        let id = Uuid::nil();
        let env = WsEnvelope::pty_output(id, b"hello");
        assert_eq!(env.msg_type, "pty:output");
        assert_eq!(env.payload["data"], "aGVsbG8=");
    }

    #[test]
    fn pty_subscribed() {
        let id = Uuid::nil();
        let env = WsEnvelope::pty_subscribed(id);
        assert_eq!(env.msg_type, "pty:subscribed");
        assert_eq!(env.payload["session_id"], id.to_string());
    }

    #[test]
    fn pty_replay_start() {
        let env = WsEnvelope::pty_replay_start(Uuid::nil(), 12, 34, true);
        assert_eq!(env.msg_type, "pty:replay_start");
        assert_eq!(env.payload["start_offset"], 12);
        assert_eq!(env.payload["end_offset"], 34);
        assert_eq!(env.payload["has_more"], true);
    }

    #[test]
    fn pty_replay_end() {
        let env = WsEnvelope::pty_replay_end(Uuid::nil());
        assert_eq!(env.msg_type, "pty:replay_end");
    }

    #[test]
    fn pty_ready() {
        let env = WsEnvelope::pty_ready(Uuid::nil());
        assert_eq!(env.msg_type, "pty:ready");
    }

    #[test]
    fn pty_exit() {
        let env = WsEnvelope::pty_exit(Uuid::nil(), Some(0));
        assert_eq!(env.msg_type, "pty:exit");
        assert_eq!(env.payload["exit_code"], 0);
    }

    #[test]
    fn pty_history() {
        let env = WsEnvelope::pty_history(Uuid::nil(), b"abc", 1, 4, true);
        assert_eq!(env.msg_type, "pty:history");
        assert_eq!(env.payload["data"], "YWJj");
        assert_eq!(env.payload["start_offset"], 1);
        assert_eq!(env.payload["end_offset"], 4);
        assert_eq!(env.payload["has_more"], true);
    }

    #[test]
    fn fs_change() {
        let env = WsEnvelope::fs_change("modify", "/tmp/file.txt");
        assert_eq!(env.msg_type, "fs:change");
        assert_eq!(env.payload["event"], "modify");
        assert_eq!(env.payload["path"], "/tmp/file.txt");
    }

    #[test]
    fn agent_activity() {
        let env = WsEnvelope::agent_activity(Uuid::nil(), serde_json::json!({"status": "running"}));
        assert_eq!(env.msg_type, "agent:activity");
    }

    #[test]
    fn daemon_alive() {
        let env = WsEnvelope::daemon_alive();
        assert_eq!(env.msg_type, "daemon:alive");
        assert!(env.payload["ts_ms"].as_u64().unwrap() > 0);
    }

    #[test]
    fn base64_encode_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn serde_roundtrip() {
        let env = WsEnvelope::new("test", serde_json::json!({"key": 42}))
            .with_request_id(Some("r1".to_string()));
        let json = serde_json::to_string(&env).unwrap();
        let parsed: WsEnvelope = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.msg_type, "test");
        assert_eq!(parsed.request_id, Some("r1".to_string()));
        assert_eq!(parsed.payload["key"], 42);
    }
}
