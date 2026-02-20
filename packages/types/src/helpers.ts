import type { AgentStatus, AgentType } from "./generated/agent";
import type { ErrorCode } from "./generated/errors";

export function agentDisplayName(type: AgentType): string {
  switch (type) {
    case "claude_code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
  }
  return "Unknown Agent";
}

export function statusColor(
  status: AgentStatus,
): "green" | "yellow" | "red" | "gray" {
  switch (status) {
    case "running":
      return "green";
    case "starting":
      return "yellow";
    case "failed":
      return "red";
    case "stopped":
      return "gray";
  }
  return "gray";
}

export function isErrorCode(code: string): code is ErrorCode {
  const validCodes: Set<string> = new Set([
    "UNAUTHORIZED",
    "INVALID_TOKEN",
    "TOKEN_ALREADY_USED",
    "NOT_FOUND",
    "INTERNAL_ERROR",
    "WORKSPACE_PATH_TRAVERSAL",
    "WORKSPACE_SYMLINK_ESCAPE",
    "WORKSPACE_NOT_REGISTERED",
    "FS_IO_ERROR",
    "INVALID_WORKSPACE",
    "INVALID_MESSAGE",
    "INVALID_PAYLOAD",
    "SESSION_NOT_FOUND",
    "PTY_WRITE_ERROR",
    "PTY_RESIZE_ERROR",
    "FS_WATCH_ERROR",
    "UNKNOWN_MESSAGE_TYPE",
    "UNKNOWN",
  ]);
  return validCodes.has(code);
}
