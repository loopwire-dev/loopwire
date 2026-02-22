import { useEffect, useRef } from "react";
import { bootstrap } from "../lib/daemon/rest";
import {
	daemonWsConnect,
	daemonWsDisconnect,
	onAgentActivityEvent,
	onDaemonWsReconnect,
} from "../lib/daemon/ws";
import { defaultAgentActivity, useAppStore } from "../stores/app-store";

export function useDaemon() {
	const token = useAppStore((s) => s.token);
	const connected = useAppStore((s) => s.daemonConnected);
	const hydrateWorkspaceSessions = useAppStore(
		(s) => s.hydrateWorkspaceSessions,
	);
	const mergeBackendWorkspaces = useAppStore((s) => s.mergeBackendWorkspaces);
	const setAvailableAgents = useAppStore((s) => s.setAvailableAgents);
	const updateSessionActivity = useAppStore((s) => s.updateSessionActivity);
	const connectedTokenRef = useRef<string | null>(null);
	const hydrateFromDaemon = useRef<(() => Promise<void>) | null>(null);

	hydrateFromDaemon.current = async () => {
		const data = await bootstrap();

		mergeBackendWorkspaces(data.workspaces);
		setAvailableAgents(data.available_agents);

		const running = data.workspaces.flatMap((workspace) =>
			workspace.sessions
				.filter(
					(session) =>
						session.status === "running" || session.status === "restored",
				)
				.map((session) => ({
					...session,
					workspace_id: workspace.id,
				})),
		);
		hydrateWorkspaceSessions(
			running.map((session) => ({
				sessionId: session.session_id,
				agentType: session.agent_type,
				customName: session.custom_name ?? null,
				workspaceId: session.workspace_id,
				pinned: session.pinned ?? false,
				icon: session.icon ?? null,
				sortOrder: session.sort_order ?? null,
				status: session.status,
				resumeFailureReason: session.resume_failure_reason ?? null,
				createdAt: session.created_at,
				activity: session.activity ?? defaultAgentActivity(),
			})),
		);
	};

	useEffect(() => {
		const unsubReconnect = onDaemonWsReconnect(() => {
			void hydrateFromDaemon.current?.().catch(() => {
				// Best effort hydration after reconnect
			});
		});

		return () => {
			unsubReconnect();
		};
	}, []);

	useEffect(() => {
		if (token && token !== connectedTokenRef.current) {
			connectedTokenRef.current = token;
			// hydrateFromDaemon is called via the onReconnect callback (which
			// also fires on the initial connection), so no need to call it here.
			daemonWsConnect();
		} else if (!token && connectedTokenRef.current) {
			connectedTokenRef.current = null;
			daemonWsDisconnect();
		}
		// No cleanup — we manage the lifecycle via the ref
	}, [token]);

	useEffect(() => {
		const unsubActivity = onAgentActivityEvent((payload) => {
			const rawSessionId = payload.session_id;
			if (typeof rawSessionId !== "string") return;
			const rawActivity = payload.activity;
			if (!rawActivity || typeof rawActivity !== "object") return;
			const record = rawActivity as unknown as Record<string, unknown>;
			const phase = record.phase;
			const updatedAt = record.updated_at;
			if (
				phase !== "unknown" &&
				phase !== "awaiting_user" &&
				phase !== "user_input" &&
				phase !== "processing" &&
				phase !== "streaming_output"
			) {
				return;
			}
			if (typeof updatedAt !== "string") return;

			updateSessionActivity(rawSessionId, {
				phase,
				is_idle: record.is_idle === true,
				updated_at: updatedAt,
				last_input_at:
					typeof record.last_input_at === "string"
						? record.last_input_at
						: null,
				last_output_at:
					typeof record.last_output_at === "string"
						? record.last_output_at
						: null,
				reason: typeof record.reason === "string" ? record.reason : "unknown",
			});
		});

		return () => {
			unsubActivity();
		};
	}, [updateSessionActivity]);

	return { connected };
}
