// Auto-generated from backend schema — do not edit manually

export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_TOKEN"
  | "TOKEN_ALREADY_USED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR"
  | "WORKSPACE_PATH_TRAVERSAL"
  | "WORKSPACE_SYMLINK_ESCAPE"
  | "WORKSPACE_NOT_REGISTERED"
  | "FS_IO_ERROR"
  | "INVALID_WORKSPACE"
  | "INVALID_MESSAGE"
  | "INVALID_PAYLOAD"
  | "SESSION_NOT_FOUND"
  | "PTY_WRITE_ERROR"
  | "PTY_RESIZE_ERROR"
  | "FS_WATCH_ERROR"
  | "UNKNOWN_MESSAGE_TYPE"
  | "UNKNOWN";

export function isRetryableError(code: ErrorCode): boolean {
  return code === "INTERNAL_ERROR";
}
