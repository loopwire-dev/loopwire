export interface AgentSessionResponse {
	session_id: string;
	agent_type: string;
	custom_name?: string | null;
	workspace_path: string;
	status: string;
	created_at: string;
}

export function normalizePath(path: string): string {
	return path === "/" ? "/" : path.replace(/\/+$/, "");
}

export function isEmojiShortcode(value: string): boolean {
	return /^:[a-z0-9_+-]{1,64}:$/i.test(value.trim());
}
