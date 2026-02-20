import { getWsBase } from "../../shared/lib/config";

const TERM_WIRE_VERSION = 1;
const TERM_FRAME_HEADER_SIZE = 30;
const TERM_FRAME_HISTORY = 1;
const TERM_FRAME_LIVE = 2;
const TERM_INPUT_BYTES_OPCODE = 1;
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export interface TerminalReadyEvent {
  sessionId: string;
}

export type TerminalOutputKind = "history" | "live";

export interface TerminalOutputFrameMeta {
  sessionId: string;
  seq: number;
}

interface TermReadyPayload {
  type: "ready";
  session_id: string;
}

interface TermExitPayload {
  type: "exit";
  session_id: string;
  exit_code: number | null;
}

interface TermErrorPayload {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
}

type TermServerEvent = TermReadyPayload | TermExitPayload | TermErrorPayload;

export interface TerminalChannelHandlers {
  onConnectionChange?: (connected: boolean) => void;
  onReady: (event: TerminalReadyEvent) => void;
  onOutput: (
    meta: TerminalOutputFrameMeta,
    kind: TerminalOutputKind,
    bytes: Uint8Array,
  ) => void;
  onExit: (exitCode: number | null) => void;
  onError: (message: string) => void;
}

export interface TerminalChannelOptions {
  sessionId: string;
  token: string;
  initialCols?: number;
  initialRows?: number;
  handlers: TerminalChannelHandlers;
}

interface ParsedFrame {
  sessionId: string;
  seq: number;
  kind: TerminalOutputKind;
  payload: Uint8Array;
}

export class TerminalChannel {
  private readonly sessionId: string;
  private readonly token: string;
  private readonly handlers: TerminalChannelHandlers;
  private readonly initialCols?: number;
  private readonly initialRows?: number;
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  private shouldReconnect = true;
  private hasConnected = false;
  private exitReconnectsLeft = 1;

  constructor(options: TerminalChannelOptions) {
    this.sessionId = options.sessionId;
    this.token = options.token;
    this.initialCols = options.initialCols;
    this.initialRows = options.initialRows;
    this.handlers = options.handlers;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.hasConnected = false;
    this.openSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
    }
    this.handlers.onConnectionChange?.(false);
  }

  sendInputUtf8(data: string): boolean {
    return this.sendJson({
      type: "input_utf8",
      data,
    });
  }

  sendInputBytes(bytes: Uint8Array): boolean {
    if (!this.isOpen()) return false;
    const frame = new Uint8Array(1 + bytes.length);
    frame[0] = TERM_INPUT_BYTES_OPCODE;
    frame.set(bytes, 1);
    this.ws?.send(frame);
    return true;
  }

  sendResize(cols: number, rows: number): boolean {
    if (cols <= 0 || rows <= 0) return false;
    return this.sendJson({
      type: "resize",
      cols,
      rows,
    });
  }

  private openSocket(): void {
    if (!this.shouldReconnect) return;

    const params = new URLSearchParams({
      token: this.token,
    });
    if (typeof this.initialCols === "number" && this.initialCols > 0) {
      params.set("cols", String(this.initialCols));
    }
    if (typeof this.initialRows === "number" && this.initialRows > 0) {
      params.set("rows", String(this.initialRows));
    }

    const url = `${getWsBase()}/api/v1/term/${encodeURIComponent(this.sessionId)}?${params.toString()}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.hasConnected = true;
      this.reconnectDelayMs = RECONNECT_INITIAL_MS;
      this.handlers.onConnectionChange?.(true);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handlers.onConnectionChange?.(false);
      if (!this.hasConnected) {
        this.handlers.onError(
          `Unable to connect to terminal (close code ${event.code || 0}).`,
        );
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      ws.close();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      if (typeof event.data === "string") {
        this.handleTextEvent(event.data);
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        this.handleBinaryEvent(new Uint8Array(event.data));
      }
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) return;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
      this.openSocket();
    }, this.reconnectDelayMs);
  }

  private handleTextEvent(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.handlers.onError("Invalid terminal server JSON frame");
      return;
    }

    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      this.handlers.onError("Malformed terminal server message");
      return;
    }

    const event = parsed as TermServerEvent;
    if (event.type === "ready") {
      this.handlers.onReady({
        sessionId: event.session_id,
      });
      return;
    }

    if (event.type === "exit") {
      this.handlers.onExit(event.exit_code);
      // Allow one auto-reconnect after exit so the backend can
      // fall back to a fresh session.  After that, stop.
      if (this.exitReconnectsLeft <= 0) {
        this.shouldReconnect = false;
      } else {
        this.exitReconnectsLeft -= 1;
      }
      return;
    }

    if (event.type === "error") {
      this.handlers.onError(event.message || event.code || "Terminal channel error");
      return;
    }
  }

  private handleBinaryEvent(frame: Uint8Array): void {
    const parsed = parseOutputFrame(frame);
    if (!parsed) {
      this.handlers.onError("Invalid terminal binary frame");
      return;
    }
    this.handlers.onOutput(
      { sessionId: parsed.sessionId, seq: parsed.seq },
      parsed.kind,
      parsed.payload,
    );
  }

  private sendJson(payload: Record<string, unknown>): boolean {
    if (!this.isOpen()) return false;
    this.ws?.send(JSON.stringify(payload));
    return true;
  }

  private isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

function parseOutputFrame(frame: Uint8Array): ParsedFrame | null {
  if (frame.length < TERM_FRAME_HEADER_SIZE) return null;
  if (frame[0] !== TERM_WIRE_VERSION) return null;

  const kindCode = frame[1];
  const kind =
    kindCode === TERM_FRAME_HISTORY
      ? "history"
      : kindCode === TERM_FRAME_LIVE
        ? "live"
        : null;
  if (!kind) return null;

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const sessionId = formatUuid(frame.subarray(2, 18));
  const seq = decodeUint64LeToSafeNumber(view, 18);
  if (seq === null) return null;
  const payloadLength = view.getUint32(26, true);
  if (TERM_FRAME_HEADER_SIZE + payloadLength > frame.length) {
    return null;
  }

  const payload = frame.slice(
    TERM_FRAME_HEADER_SIZE,
    TERM_FRAME_HEADER_SIZE + payloadLength,
  );

  return { sessionId, seq, kind, payload };
}

function decodeUint64LeToSafeNumber(view: DataView, offset: number): number | null {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  const value = hi * 2 ** 32 + lo;
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

function formatUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) return "";
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
