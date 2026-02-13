import { useState, useCallback } from "react";
import { api } from "../../shared/lib/api";
import { useAppStore, type WorkspaceSession } from "../../shared/stores/app-store";

export interface AvailableAgent {
  agent_type: string;
  name: string;
  installed: boolean;
  version: string | null;
}

export interface AgentSession {
  session_id: string;
  agent_type: string;
  custom_name?: string | null;
  workspace_path: string;
  status: string;
  created_at: string;
}

export function toWorkspaceSession(session: AgentSession): WorkspaceSession {
  return {
    sessionId: session.session_id,
    agentType: session.agent_type,
    customName: session.custom_name ?? null,
    workspacePath: session.workspace_path,
    status: session.status,
    createdAt: session.created_at,
  };
}

export function useAgent() {
  const [agents, setAgents] = useState<AvailableAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const upsertWorkspaceSession = useAppStore((s) => s.upsertWorkspaceSession);
  const removeWorkspaceSession = useAppStore((s) => s.removeWorkspaceSession);
  const attachWorkspaceSession = useAppStore((s) => s.attachWorkspaceSession);
  const setWorkspace = useAppStore((s) => s.setWorkspace);

  const fetchAgents = useCallback(async () => {
    const res = await api.get<AvailableAgent[]>("/agents/available");
    setAgents(res);
    return res;
  }, []);

  const fetchSessions = useCallback(async () => {
    return await api.get<AgentSession[]>("/agents/sessions");
  }, []);

  const startSession = useCallback(
    async (agentType: string, workspacePath: string, customName?: string) => {
      setLoading(true);
      try {
        const res = await api.post<{
          session_id: string;
          workspace_id: string;
          agent_type: string;
          custom_name?: string | null;
          workspace_path: string;
          status: string;
        }>("/agents/sessions", {
          agent_type: agentType,
          custom_name: customName,
          workspace_path: workspacePath,
        });

        upsertWorkspaceSession({
          sessionId: res.session_id,
          agentType: res.agent_type,
          customName: (res.custom_name ?? customName ?? "").trim() || null,
          workspacePath: res.workspace_path,
          status: res.status,
          createdAt: new Date().toISOString(),
        });
        attachWorkspaceSession(workspacePath, res.session_id);
        setWorkspace(workspacePath, res.workspace_id);
        return res;
      } finally {
        setLoading(false);
      }
    },
    [attachWorkspaceSession, setWorkspace, upsertWorkspaceSession],
  );

  const stopSession = useCallback(
    async (sessionId: string, workspacePath: string) => {
      await api.post(`/agents/sessions/${sessionId}/stop`);
      removeWorkspaceSession(workspacePath, sessionId);
    },
    [removeWorkspaceSession],
  );

  return {
    agents,
    loading,
    fetchAgents,
    fetchSessions,
    startSession,
    stopSession,
  };
}
