// Auto-generated from backend schema — do not edit manually

export type AgentType = "claude_code" | "codex" | "gemini";

export type AgentStatus = "starting" | "running" | "stopped" | "failed" | "restored";
export type ResumabilityStatus = "resumable" | "unresumable";

export type AgentActivityPhase =
  | "unknown"
  | "awaiting_user"
  | "user_input"
  | "processing"
  | "streaming_output";

export interface AgentActivity {
  phase: AgentActivityPhase;
  is_idle: boolean;
  updated_at: string;
  last_input_at: string | null;
  last_output_at: string | null;
  reason: string;
}

export interface AvailableAgent {
  agent_type: AgentType;
  name: string;
  installed: boolean;
  version: string | null;
}

export interface AgentHandle {
  session_id: string;
  agent_type: AgentType;
  conversation_id?: string | null;
  custom_name?: string | null;
  pinned?: boolean;
  icon?: string | null;
  sort_order?: number | null;
  workspace_path: string;
  status: AgentStatus;
  resumability_status: ResumabilityStatus;
  resume_failure_reason?: string | null;
  recovered_from_previous: boolean;
  created_at: string;
  activity: AgentActivity;
}

export interface CreateSessionRequest {
  agent_type: AgentType;
  custom_name?: string | null;
  workspace_path: string;
}

export interface CreateSessionResponse {
  session_id: string;
  workspace_id: string;
  agent_type: AgentType;
  conversation_id?: string | null;
  custom_name?: string | null;
  pinned?: boolean;
  icon?: string | null;
  sort_order?: number | null;
  status: AgentStatus;
  resumability_status: ResumabilityStatus;
  resume_failure_reason?: string | null;
  recovered_from_previous: boolean;
  created_at: string;
  activity: AgentActivity;
}
