// Auto-generated from backend schema — do not edit manually

export interface WsEnvelope {
  version: number;
  request_id: string | null;
  type: WsMessageType;
  payload: Record<string, unknown>;
  error: WsError | null;
}

export interface WsError {
  code: string;
  message: string;
  retryable: boolean;
}

export type WsClientMessageType =
  | "pty:subscribe"
  | "pty:history"
  | "pty:ready"
  | "pty:input"
  | "pty:resize"
  | "pty:unsubscribe"
  | "fs:watch"
  | "fs:unwatch"
  | "git:subscribe"
  | "git:unsubscribe";

export type WsServerMessageType =
  | "daemon:alive"
  | "pty:subscribed"
  | "pty:ready"
  | "pty:replay_start"
  | "pty:replay_end"
  | "pty:output"
  | "pty:history"
  | "pty:exit"
  | "agent:activity"
  | "fs:change"
  | "git:status"

  | "error";

export type WsMessageType = WsClientMessageType | WsServerMessageType;

export interface PtySubscribePayload {
  session_id: string;
}

export interface PtyInputPayload {
  session_id: string;
  data: string;
}

export interface PtyHistoryRequestPayload {
  session_id: string;
  before?: number;
  max_bytes?: number;
}

export interface PtyResizePayload {
  session_id: string;
  cols: number;
  rows: number;
}

export interface PtyOutputPayload {
  session_id: string;
  data: string;
}

export interface PtyReplayBoundaryPayload {
  session_id: string;
  start_offset?: number;
  end_offset?: number;
  has_more?: boolean;
}

export interface PtyHistoryPayload {
  session_id: string;
  data: string;
  start_offset: number;
  end_offset: number;
  has_more: boolean;
}

export interface PtyExitPayload {
  session_id: string;
  exit_code: number | null;
}

export interface DaemonAlivePayload {
  ts_ms: number;
}

export interface AgentActivityPayload {
  session_id: string;
  activity: {
    phase: "unknown" | "awaiting_user" | "processing" | "streaming_output";
    is_idle: boolean;
    updated_at: string;
    last_input_at: string | null;
    last_output_at: string | null;
    reason: string;
  };
}

export interface FsChangePayload {
  event: "create" | "modify" | "delete" | "rename";
  path: string;
}

export interface GitStatusPayload {
  workspace_id: string;
  files: Record<string, { status: string; additions?: number; deletions?: number }>;
  ignored_dirs: string[];
}
