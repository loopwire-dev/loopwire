import type { AgentActivity, AvailableAgent } from "../../stores/app-store";
import { ApiError, get, post } from "./http";

export interface AgentSessionDto {
	session_id: string;
	agent_type: string;
	custom_name?: string | null;
	workspace_id: string;
	pinned?: boolean;
	icon?: string | null;
	sort_order?: number | null;
	status: string;
	resume_failure_reason?: string | null;
	created_at: string;
	activity?: AgentActivity;
}

export interface BootstrapWorkspaceEntryDto {
	id: string;
	path: string;
	name: string;
	pinned: boolean;
	icon: string | null;
	sessions: AgentSessionDto[];
}

export interface BootstrapResponseDto {
	workspaces: BootstrapWorkspaceEntryDto[];
	available_agents: AvailableAgent[];
}

export interface ShareStatusDto {
	active: boolean;
	connect_url: string | null;
	expires_at: string | null;
	pin_required: boolean;
	provider: string | null;
}

export interface ShareStartResponseDto {
	connect_url: string;
	expires_at: string;
	pin_required: boolean;
	provider: string;
}

export interface InviteBootstrapResponseDto {
	host_id: string;
	pin_required: boolean;
	expires_at: string;
}

export interface InviteExchangeResponseDto {
	session_token: string;
	trusted_device_token?: string;
	trusted_device_expires_at?: string;
}

export interface ScrollbackDto {
	data: string;
	start_offset: number;
	end_offset: number;
	has_more: boolean;
}

export interface DirEntryDto {
	name: string;
	kind: "file" | "directory" | "symlink";
	size: number | null;
	modified: number | null;
}

export interface FsReadResponseDto {
	content: string;
	size: number;
	is_binary: boolean;
	binary_content_base64: string | null;
}

export interface FsReadManyResponseDto {
	files: Record<
		string,
		{
			content: string;
			size: number;
			is_binary: boolean;
		}
	>;
}

export interface GitStatusResponseDto {
	files: Record<
		string,
		{ status: string; additions?: number; deletions?: number }
	>;
	ignored_dirs: string[];
}

export interface GitDiffResponseDto {
	patch: string;
}

export interface HealthResponseDto {
	version: string;
	hostname: string;
	os: string;
	arch: string;
	uptime_secs: number;
}

/** Fetches daemon health metadata. */
export function health() {
	return get<HealthResponseDto>("/health");
}

/** Loads bootstrap payload used to hydrate web state. */
export function bootstrap() {
	return get<BootstrapResponseDto>("/bootstrap");
}

/** Exchanges a bootstrap token for a session token. */
export function authExchange(bootstrapToken: string) {
	return post<{ session_token: string }>("/auth/exchange", {
		bootstrap_token: bootstrapToken,
	});
}

/** Rotates the current session token. */
export function authRotate() {
	return post<{ session_token: string }>("/auth/rotate");
}

/** Revokes the current session token. */
export function authRevoke() {
	return post<void>("/auth/revoke");
}

/** Validates invite token metadata before exchange. */
export function inviteBootstrap(inviteToken: string) {
	return post<InviteBootstrapResponseDto>("/remote/invite/bootstrap", {
		invite_token: inviteToken,
	});
}

/** Exchanges invite credentials for a session token. */
export function inviteExchange(args: {
	invite_token: string;
	pin: string | null;
	trusted_device_token: string | null;
}) {
	return post<InviteExchangeResponseDto>("/remote/invite/exchange", args);
}

/** Returns remote share status for current daemon session. */
export function remoteShareStatus() {
	return get<ShareStatusDto>("/remote/share/status");
}

/** Starts remote sharing, optionally protected by PIN. */
export function remoteShareStart(pin?: string) {
	return post<ShareStartResponseDto>("/remote/share/start", {
		pin: pin?.trim() || undefined,
	});
}

/** Stops an active remote share session. */
export function remoteShareStop() {
	return post<void>("/remote/share/stop");
}

/** Starts a new agent session for a workspace path. */
export function startAgentSession(agentType: string, workspacePath: string) {
	return post<AgentSessionDto>("/agents/sessions", {
		agent_type: agentType,
		workspace_path: workspacePath,
	});
}

/** Stops a running agent session. */
export function stopAgentSession(sessionId: string) {
	return post<void>(`/agents/sessions/${sessionId}/stop`);
}

/** Renames an existing agent session. */
export function renameAgentSession(
	sessionId: string,
	customName: string | null,
) {
	return post<void>(`/agents/sessions/${sessionId}/rename`, {
		custom_name: customName,
	});
}

/** Updates session UI settings such as pin/icon/order. */
export function updateAgentSessionSettings(
	sessionId: string,
	settings: {
		pinned?: boolean;
		icon?: string | null;
		sort_order?: number | null;
	},
) {
	return post<void>(`/agents/sessions/${sessionId}/settings`, settings);
}

/** Uploads an attachment to a terminal session and returns server path. */
export function attachToSession(
	sessionId: string,
	data: string,
	filename: string,
) {
	return post<{ path: string }>(`/agents/sessions/${sessionId}/attach`, {
		data,
		filename,
	});
}

/** Fetches scrollback bytes for a session with optional pagination cursor. */
export function sessionScrollback(
	sessionId: string,
	options: { maxBytes?: number; beforeOffset?: number } = {},
) {
	const params: Record<string, string> = {};
	if (typeof options.maxBytes === "number") {
		params.max_bytes = String(options.maxBytes);
	}
	if (typeof options.beforeOffset === "number") {
		params.before_offset = String(options.beforeOffset);
	}

	return get<ScrollbackDto>(`/agents/sessions/${sessionId}/scrollback`, params);
}

/** Registers a workspace root path on the daemon. */
export function registerWorkspace(path: string) {
	return post<{ workspace_id: string }>("/workspaces/register", { path });
}

/** Removes a previously registered workspace root path. */
export function removeWorkspace(path: string) {
	return post<void>("/workspaces/remove", { path });
}

/** Updates persisted workspace settings. */
export function updateWorkspaceSettings(entry: {
	path: string;
	name?: string;
	pinned?: boolean;
	icon?: string | null;
}) {
	return post<void>("/workspaces/settings", entry);
}

/** Lists daemon-visible filesystem roots. */
export function fsRoots() {
	return get<{ roots: string[] }>("/fs/roots");
}

/** Browses a host directory outside registered workspace context. */
export function fsBrowse(path: string) {
	return get<DirEntryDto[]>("/fs/browse", { path });
}

/** Lists entries in a workspace-relative directory. */
export function fsList(workspaceId: string, relativePath: string) {
	return get<DirEntryDto[]>("/fs/list", {
		workspace_id: workspaceId,
		relative_path: relativePath,
	});
}

/** Reads a file from workspace-relative path. */
export function fsRead(
	workspaceId: string,
	relativePath: string,
	options: { includeBinary?: boolean } = {},
) {
	return get<FsReadResponseDto>("/fs/read", {
		workspace_id: workspaceId,
		relative_path: relativePath,
		...(options.includeBinary ? { include_binary: "true" } : {}),
	});
}

/** Reads many files from workspace-relative paths in a single call. */
export function fsReadMany(workspaceId: string, relativePaths: string[]) {
	return post<FsReadManyResponseDto>("/fs/read_many", {
		workspace_id: workspaceId,
		relative_paths: relativePaths,
	});
}

/** Returns git status for a workspace. */
export function gitStatus(workspaceId: string) {
	return get<GitStatusResponseDto>("/git/status", {
		workspace_id: workspaceId,
	});
}

/** Returns unified git patch for a workspace. */
export function gitDiff(workspaceId: string, force = false) {
	return get<GitDiffResponseDto>("/git/diff", {
		workspace_id: workspaceId,
		...(force ? { force: "true" } : {}),
	});
}

/** True when an API error maps to daemon NOT_GIT_REPO code. */
export function isNotGitRepoError(error: unknown): boolean {
	return error instanceof ApiError && error.code === "NOT_GIT_REPO";
}
