// Auto-generated from backend schema — do not edit manually

export type AgentType = "claude_code" | "codex" | "gemini";

export type AgentStatus = "starting" | "running" | "stopped" | "failed";

export interface AvailableAgent {
  agent_type: AgentType;
  name: string;
  installed: boolean;
  version: string | null;
}

export interface AgentHandle {
  session_id: string;
  agent_type: AgentType;
  workspace_path: string;
  status: AgentStatus;
  created_at: string;
}

export interface CreateSessionRequest {
  agent_type: AgentType;
  workspace_path: string;
}

export interface CreateSessionResponse {
  session_id: string;
  agent_type: AgentType;
  workspace_path: string;
  status: AgentStatus;
}
