export const DAEMON_URL =
  import.meta.env.VITE_DAEMON_URL ?? "";

export const API_BASE = DAEMON_URL + "/api/v1";

// Vite 6's dev proxy doesn't reliably forward WebSocket upgrades, so in dev
// mode we connect directly to the daemon. WebSocket isn't subject to CORS.
const wsOrigin = DAEMON_URL
  ? DAEMON_URL.replace(/^http/, "ws")
  : import.meta.env.DEV
    ? "ws://localhost:9400"
    : `ws://${window.location.host}`;

export const WS_URL = wsOrigin + "/api/v1/ws";
