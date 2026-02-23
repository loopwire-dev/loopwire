import { useEffect, useState } from "react";
import { discoverDaemon } from "../lib/network/discovery";
import { getDaemonUrl } from "../lib/runtime/config";

const PROBE_QUERY = "probe=1";
const HEARTBEAT_TIMEOUT_MS = 9000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;
const DISCOVERY_RETRY_MS = 3000;

interface UseDaemonAvailableOptions {
	allowDiscovery?: boolean;
}

function toProbeWsUrl(daemonUrl: string): string {
	return `${daemonUrl.replace(/^http/i, "ws")}/api/v1/ws?${PROBE_QUERY}`;
}

/**
 * Continuously monitors daemon availability.
 *
 *  - `null`  — initial probe in progress
 *  - `true`  — daemon is reachable
 *  - `false` — daemon is not reachable
 *
 * Uses a lightweight probe WebSocket that receives server heartbeats.
 * This avoids repeated HTTP health polling while still detecting both
 * daemon recovery and daemon loss.
 */
export function useDaemonAvailable(
	options: UseDaemonAvailableOptions = {},
): boolean | null {
	const { allowDiscovery = false } = options;
	const [available, setAvailable] = useState<boolean | null>(null);

	useEffect(() => {
		let cancelled = false;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
		let reconnectDelayMs = RECONNECT_BASE_MS;
		let probeSocket: WebSocket | null = null;

		const clearHeartbeatTimer = () => {
			if (!heartbeatTimer) return;
			clearTimeout(heartbeatTimer);
			heartbeatTimer = null;
		};

		const armHeartbeatTimeout = () => {
			clearHeartbeatTimer();
			heartbeatTimer = setTimeout(() => {
				if (cancelled) return;
				setAvailable(false);
				probeSocket?.close();
			}, HEARTBEAT_TIMEOUT_MS);
		};

		const scheduleReconnect = (delayMs: number) => {
			if (cancelled || reconnectTimer) return;
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				void connectProbe();
			}, delayMs);
		};

		const handleProbeClosed = () => {
			setAvailable(false);
			clearHeartbeatTimer();
			reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
			scheduleReconnect(reconnectDelayMs);
		};

		const connectProbe = async () => {
			if (cancelled) return;

			const existingUrl = getDaemonUrl();
			const daemonUrl =
				existingUrl || (allowDiscovery ? await discoverDaemon() : null);
			if (cancelled) return;

			if (!daemonUrl) {
				setAvailable(false);
				if (allowDiscovery) {
					scheduleReconnect(DISCOVERY_RETRY_MS);
				}
				return;
			}

			let ws: WebSocket;
			try {
				ws = new WebSocket(toProbeWsUrl(daemonUrl));
			} catch {
				handleProbeClosed();
				return;
			}

			probeSocket = ws;

			ws.onopen = () => {
				if (cancelled || probeSocket !== ws) return;
				setAvailable(true);
				reconnectDelayMs = RECONNECT_BASE_MS;
				armHeartbeatTimeout();
			};

			ws.onmessage = (event) => {
				if (cancelled || probeSocket !== ws) return;
				if (typeof event.data !== "string") return;
				try {
					const envelope = JSON.parse(event.data) as {
						type?: unknown;
						payload?: Record<string, unknown>;
					};
					if (envelope.type === "daemon:alive") {
						setAvailable(true);
						armHeartbeatTimeout();
					}
				} catch {
					// Ignore malformed messages and keep waiting for next heartbeat.
				}
			};

			ws.onerror = () => {
				if (cancelled || probeSocket !== ws) return;
				ws.close();
			};

			ws.onclose = () => {
				if (cancelled || probeSocket !== ws) return;
				probeSocket = null;
				handleProbeClosed();
			};
		};

		void connectProbe();

		return () => {
			cancelled = true;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			clearHeartbeatTimer();
			if (probeSocket) {
				const ws = probeSocket;
				ws.onopen = null;
				ws.onmessage = null;
				ws.onerror = null;
				ws.onclose = null;
				ws.close();
				probeSocket = null;
			}
		};
	}, [allowDiscovery]);

	return available;
}
