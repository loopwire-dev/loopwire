import { getWsUrl } from "./config";
import { useAppStore } from "../stores/app-store";

export interface WsEnvelope {
  version: number;
  request_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  error: { code: string; message: string; retryable: boolean } | null;
}

type WsHandler = (envelope: WsEnvelope) => void;
type SendOptions = {
  queueWhenDisconnected?: boolean;
};

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<WsHandler>>();
  private pendingRequests = new Map<
    string,
    { resolve: (v: WsEnvelope) => void; reject: (e: Error) => void }
  >();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private onReconnectCallbacks: Array<() => void> = [];
  private pendingSends: string[] = [];

  connect() {
    const token = useAppStore.getState().token;
    if (!token) {
      console.debug("[ws] connect skipped: no token");
      return;
    }

    // Close any existing connection silently
    if (this.ws) {
      const old = this.ws;
      old.onopen = null;
      old.onclose = null;
      old.onerror = null;
      old.onmessage = null;
      old.close();
      this.ws = null;
    }

    const url = `${getWsUrl()}?token=${encodeURIComponent(token)}`;
    console.debug("[ws] connecting to", url.replace(/token=.*/, "token=***"));
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return; // stale
      console.debug("[ws] connected");
      this.reconnectDelay = 1000;
      useAppStore.getState().setDaemonConnected(true);
      for (const msg of this.pendingSends) {
        ws.send(msg);
      }
      this.pendingSends = [];
      for (const cb of this.onReconnectCallbacks) cb();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return; // stale
      const envelope: WsEnvelope = JSON.parse(event.data);

      if (envelope.request_id) {
        const pending = this.pendingRequests.get(envelope.request_id);
        if (pending) {
          this.pendingRequests.delete(envelope.request_id);
          if (envelope.error) {
            pending.reject(new Error(envelope.error.message));
          } else {
            pending.resolve(envelope);
          }
        }
      }

      const typeHandlers = this.handlers.get(envelope.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) handler(envelope);
      }
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return; // stale — don't touch state
      console.debug(
        `[ws] closed (code=${event.code}, reason=${event.reason || "none"})`,
      );
      useAppStore.getState().setDaemonConnected(false);
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      console.debug("[ws] error — closing socket");
      ws.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;

    const token = useAppStore.getState().token;
    if (!token) {
      console.debug("[ws] reconnect skipped: no token");
      return;
    }

    console.debug(
      `[ws] scheduling reconnect in ${this.reconnectDelay}ms`,
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      );
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      const old = this.ws;
      old.onopen = null;
      old.onclose = null;
      old.onerror = null;
      old.onmessage = null;
      old.close();
      this.ws = null;
    }
    this.pendingSends = [];
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error("WebSocket disconnected"));
      this.pendingRequests.delete(requestId);
    }
  }

  send(
    type: string,
    payload: Record<string, unknown>,
    options?: SendOptions,
  ): string {
    const queueWhenDisconnected = options?.queueWhenDisconnected ?? true;
    const requestId = crypto.randomUUID();
    const envelope: WsEnvelope = {
      version: 1,
      request_id: requestId,
      type,
      payload,
      error: null,
    };
    const msg = JSON.stringify(envelope);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else if (queueWhenDisconnected) {
      // Queue until connected
      this.pendingSends.push(msg);
    }
    return requestId;
  }

  sendAndWait(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = 5000,
  ): Promise<WsEnvelope> {
    return new Promise((resolve, reject) => {
      const requestId = this.send(type, payload);
      this.pendingRequests.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error("Request timed out"));
        }
      }, timeoutMs);
    });
  }

  on(type: string, handler: WsHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  onReconnect(callback: () => void): () => void {
    this.onReconnectCallbacks.push(callback);
    return () => {
      this.onReconnectCallbacks = this.onReconnectCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsClient = new WsClient();
