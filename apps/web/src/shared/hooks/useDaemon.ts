import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import {
	type AgentActivity,
	type AvailableAgent,
	defaultAgentActivity,
	useAppStore,
} from "../stores/app-store";

interface AgentSessionResponse {
	session_id: string;
	agent_type: string;
	custom_name?: string | null;
	pinned?: boolean;
	icon?: string | null;
	sort_order?: number | null;
	status: string;
	resume_failure_reason?: string | null;
	created_at: string;
	activity?: AgentActivity;
}

interface BootstrapWorkspaceEntry {
	id: string;
	path: string;
	name: string;
	pinned: boolean;
	icon: string | null;
	sessions: AgentSessionResponse[];
}

interface BootstrapResponse {
	workspaces: BootstrapWorkspaceEntry[];
	available_agents: AvailableAgent[];
}

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
		const data = await api.get<BootstrapResponse>("/bootstrap");

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
		const unsubReconnect = wsClient.onReconnect(() => {
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
			wsClient.connect();
		} else if (!token && connectedTokenRef.current) {
			connectedTokenRef.current = null;
			wsClient.disconnect();
		}
		// No cleanup — we manage the lifecycle via the ref
	}, [token]);

	useEffect(() => {
		const unsubActivity = wsClient.on("agent:activity", (env) => {
			const rawSessionId = env.payload.session_id;
			if (typeof rawSessionId !== "string") return;
			const rawActivity = env.payload.activity;
			if (!rawActivity || typeof rawActivity !== "object") return;
			const record = rawActivity as Record<string, unknown>;
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
