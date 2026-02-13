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
  | "pty:ready"
  | "pty:input"
  | "pty:resize"
  | "pty:unsubscribe"
  | "fs:watch"
  | "fs:unwatch";

export type WsServerMessageType =
  | "pty:subscribed"
  | "pty:ready"
  | "pty:replay_start"
  | "pty:replay_end"
  | "pty:output"
  | "pty:exit"
  | "fs:change"
  | "quota:update"
  | "error";

export type WsMessageType = WsClientMessageType | WsServerMessageType;

export interface PtySubscribePayload {
  session_id: string;
}

export interface PtyInputPayload {
  session_id: string;
  data: string;
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
}

export interface PtyExitPayload {
  session_id: string;
  exit_code: number | null;
}

export interface FsChangePayload {
  event: "create" | "modify" | "delete" | "rename";
  path: string;
}

export interface QuotaUpdatePayload {
  session_id: string;
  usage: {
    tokens_in: number;
    tokens_out: number;
    cost_usd: number | null;
    source_confidence: "authoritative" | "estimated";
  };
}
