import type { AgentActivity } from "../../stores/app-store";
import { type WsEnvelope, wsClient } from "../network/ws";

export interface AgentActivityEventPayload {
	session_id: string;
	activity: AgentActivity;
}

export interface GitStatusEventPayload {
	workspace_id: string;
	files: Record<
		string,
		{ status: string; additions?: number; deletions?: number }
	>;
	ignored_dirs: string[];
}

const gitSubscriptionRefs = new Map<string, number>();

/** Opens the authenticated daemon WS channel. */
export function daemonWsConnect() {
	wsClient.connect();
}

/** Closes the daemon WS channel and clears pending reconnects. */
export function daemonWsDisconnect() {
	wsClient.disconnect();
	gitSubscriptionRefs.clear();
}

/** Registers a callback fired whenever the WS client reconnects. */
export function onDaemonWsReconnect(callback: () => void) {
	return wsClient.onReconnect(callback);
}

/** Subscribes to a raw daemon WS envelope by event type. */
export function onDaemonWsEvent(
	type: string,
	handler: (envelope: WsEnvelope) => void,
) {
	return wsClient.on(type, handler);
}

/** Subscribes to strongly-typed `agent:activity` daemon events. */
export function onAgentActivityEvent(
	handler: (payload: AgentActivityEventPayload) => void,
) {
	return wsClient.on("agent:activity", (envelope) => {
		const payload = envelope.payload as Partial<AgentActivityEventPayload>;
		if (!payload || typeof payload !== "object") return;
		if (typeof payload.session_id !== "string") return;
		if (!payload.activity || typeof payload.activity !== "object") return;
		handler({
			session_id: payload.session_id,
			activity: payload.activity as AgentActivity,
		});
	});
}

/** Sends a `git:subscribe` command for a workspace. */
export function subscribeGitStatus(workspaceId: string) {
	const refs = gitSubscriptionRefs.get(workspaceId) ?? 0;
	gitSubscriptionRefs.set(workspaceId, refs + 1);
	if (refs > 0) return;
	wsClient.send("git:subscribe", { workspace_id: workspaceId });
}

/** Re-sends `git:subscribe` without changing local subscriber refcounts. */
export function resubscribeGitStatus(workspaceId: string) {
	if ((gitSubscriptionRefs.get(workspaceId) ?? 0) <= 0) return;
	wsClient.send("git:subscribe", { workspace_id: workspaceId });
}

/** Sends a `git:unsubscribe` command for a workspace. */
export function unsubscribeGitStatus(workspaceId: string) {
	const refs = gitSubscriptionRefs.get(workspaceId) ?? 0;
	if (refs <= 1) {
		gitSubscriptionRefs.delete(workspaceId);
	} else {
		gitSubscriptionRefs.set(workspaceId, refs - 1);
		return;
	}
	wsClient.send(
		"git:unsubscribe",
		{ workspace_id: workspaceId },
		{ queueWhenDisconnected: false },
	);
}

/** Subscribes to strongly-typed `git:status` daemon events. */
export function onGitStatusEvent(
	handler: (payload: GitStatusEventPayload) => void,
) {
	return wsClient.on("git:status", (envelope) => {
		const payload = envelope.payload as Partial<GitStatusEventPayload>;
		if (!payload || typeof payload !== "object") return;
		if (typeof payload.workspace_id !== "string") return;
		if (!payload.files || typeof payload.files !== "object") return;
		if (!Array.isArray(payload.ignored_dirs)) return;
		handler(payload as GitStatusEventPayload);
	});
}
