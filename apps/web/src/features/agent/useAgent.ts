import { useCallback, useState } from "react";
import {
	renameAgentSession,
	startAgentSession,
	stopAgentSession,
	updateAgentSessionSettings,
} from "../../shared/lib/daemon/rest";
import {
	type AgentActivity,
	type WorkspaceSession,
	defaultAgentActivity,
	useAppStore,
} from "../../shared/stores/app-store";

export interface AgentSession {
	session_id: string;
	agent_type: string;
	custom_name?: string | null;
	workspace_id: string;
	pinned?: boolean;
	icon?: string | null;
	sort_order?: number | null;
	status: string;
	created_at: string;
	activity?: AgentActivity;
}

export function toWorkspaceSession(session: AgentSession): WorkspaceSession {
	return {
		sessionId: session.session_id,
		agentType: session.agent_type,
		customName: session.custom_name ?? null,
		workspaceId: session.workspace_id,
		pinned: session.pinned ?? false,
		icon: session.icon ?? null,
		sortOrder: session.sort_order ?? null,
		status: session.status,
		createdAt: session.created_at,
		activity: session.activity ?? defaultAgentActivity(),
	};
}

export function useAgent() {
	const [loading, setLoading] = useState(false);
	const upsertWorkspaceSession = useAppStore((s) => s.upsertWorkspaceSession);
	const removeWorkspaceSession = useAppStore((s) => s.removeWorkspaceSession);
	const attachWorkspaceSession = useAppStore((s) => s.attachWorkspaceSession);
	const setActivePanel = useAppStore((s) => s.setActivePanel);
	const setWorkspace = useAppStore((s) => s.setWorkspace);

	const startSession = useCallback(
		async (agentType: string, workspacePath: string) => {
			setLoading(true);
			try {
				const res = await startAgentSession(agentType, workspacePath);

				upsertWorkspaceSession({
					sessionId: res.session_id,
					agentType: res.agent_type,
					customName: (res.custom_name ?? "").trim() || null,
					workspaceId: res.workspace_id,
					status: res.status,
					createdAt: res.created_at,
					activity: res.activity ?? defaultAgentActivity(),
				});
				attachWorkspaceSession(workspacePath, res.session_id, res.workspace_id);
				setActivePanel(workspacePath, {
					kind: "agent",
					sessionId: res.session_id,
				});
				setWorkspace(workspacePath, res.workspace_id);
				return res;
			} finally {
				setLoading(false);
			}
		},
		[
			attachWorkspaceSession,
			setActivePanel,
			setWorkspace,
			upsertWorkspaceSession,
		],
	);

	const stopSession = useCallback(
		async (sessionId: string) => {
			await stopAgentSession(sessionId);
			removeWorkspaceSession(sessionId);
		},
		[removeWorkspaceSession],
	);

	const renameSession = useCallback(
		async (sessionId: string, customName: string | null) => {
			await renameAgentSession(sessionId, customName);
		},
		[],
	);

	const updateSessionSettings = useCallback(
		async (
			sessionId: string,
			settings: {
				pinned?: boolean;
				icon?: string | null;
				sort_order?: number | null;
			},
		) => {
			await updateAgentSessionSettings(sessionId, settings);
		},
		[],
	);

	return {
		loading,
		startSession,
		stopSession,
		renameSession,
		updateSessionSettings,
	};
}
