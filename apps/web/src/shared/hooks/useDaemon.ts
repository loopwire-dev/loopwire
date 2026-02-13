import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/app-store";
import { wsClient } from "../lib/ws";
import { ApiError, api } from "../lib/api";

interface AgentSessionResponse {
  session_id: string;
  agent_type: string;
  custom_name?: string | null;
  workspace_path: string;
  status: string;
  created_at: string;
}

interface AgentSessionStatusResponse {
  status: string;
}

const sessionStatusInFlight = new Map<string, Promise<boolean>>();
const sessionStatusCache = new Map<string, { value: boolean; ts: number }>();
const SESSION_STATUS_CACHE_MS = 1000;
const pendingExitChecks = new Set<string>();

async function isSessionStillRunning(sessionId: string): Promise<boolean> {
  const now = Date.now();
  const cached = sessionStatusCache.get(sessionId);
  if (cached && now - cached.ts < SESSION_STATUS_CACHE_MS) {
    return cached.value;
  }

  const existing = sessionStatusInFlight.get(sessionId);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    let value = true;
    try {
      const session = await api.get<AgentSessionStatusResponse>(`/agents/sessions/${sessionId}`);
      value = session.status === "running";
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        value = false;
      } else {
        value = true;
      }
    }
    sessionStatusCache.set(sessionId, { value, ts: Date.now() });
    return value;
  })();

  sessionStatusInFlight.set(sessionId, request);
  try {
    return await request;
  } finally {
    sessionStatusInFlight.delete(sessionId);
  }
}

export function useDaemon() {
  const token = useAppStore((s) => s.token);
  const connected = useAppStore((s) => s.daemonConnected);
  const hydrateWorkspaceSessions = useAppStore((s) => s.hydrateWorkspaceSessions);
  const addWorkspaceRoot = useAppStore((s) => s.addWorkspaceRoot);
  const removeSessionById = useAppStore((s) => s.removeSessionById);
  const connectedTokenRef = useRef<string | null>(null);
  const hydrateFromDaemon = useRef<(() => Promise<void>) | null>(null);

  hydrateFromDaemon.current = async () => {
    const sessions = await api.get<AgentSessionResponse[]>("/agents/sessions");
    const running = sessions.filter((session) => session.status === "running");
    hydrateWorkspaceSessions(
      running.map((session) => ({
        sessionId: session.session_id,
        agentType: session.agent_type,
        customName: session.custom_name ?? null,
        status: session.status,
        workspacePath: session.workspace_path,
        createdAt: session.created_at,
      })),
    );
    for (const session of running) {
      addWorkspaceRoot(session.workspace_path);
    }
  };

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
  }, [addWorkspaceRoot, hydrateWorkspaceSessions, token]);

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
    const unsubExit = wsClient.on("pty:exit", (env) => {
      const rawSessionId = env.payload.session_id;
      if (typeof rawSessionId !== "string") return;
      if (pendingExitChecks.has(rawSessionId)) return;
      pendingExitChecks.add(rawSessionId);
      void (async () => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const firstCheck = await isSessionStillRunning(rawSessionId);
          if (firstCheck) return;

          await new Promise((resolve) => setTimeout(resolve, 400));
          const secondCheck = await isSessionStillRunning(rawSessionId);
          if (!secondCheck) {
            removeSessionById(rawSessionId);
          }
        } finally {
          pendingExitChecks.delete(rawSessionId);
        }
      })();
    });
    return () => {
      unsubExit();
    };
  }, [removeSessionById]);

  useEffect(() => {
    return () => {
      pendingExitChecks.clear();
    };
  }, []);

  return { connected };
}
