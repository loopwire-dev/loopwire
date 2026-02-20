import { describe, it, expect } from "vitest";
import { toWorkspaceSession, type AgentSession } from "../useAgent";

describe("toWorkspaceSession", () => {
	const baseSession: AgentSession = {
		session_id: "abc-123",
		agent_type: "claude_code",
		workspace_id: "ws-456",
		status: "running",
		created_at: "2025-01-01T00:00:00Z",
	};

	it("maps snake_case fields to camelCase", () => {
		const result = toWorkspaceSession(baseSession);
		expect(result.sessionId).toBe("abc-123");
		expect(result.agentType).toBe("claude_code");
		expect(result.workspaceId).toBe("ws-456");
		expect(result.status).toBe("running");
		expect(result.createdAt).toBe("2025-01-01T00:00:00Z");
	});

	it("defaults customName to null when missing", () => {
		const result = toWorkspaceSession(baseSession);
		expect(result.customName).toBeNull();
	});

	it("passes through customName when provided", () => {
		const result = toWorkspaceSession({
			...baseSession,
			custom_name: "my session",
		});
		expect(result.customName).toBe("my session");
	});

	it("defaults customName to null when explicitly null", () => {
		const result = toWorkspaceSession({
			...baseSession,
			custom_name: null,
		});
		expect(result.customName).toBeNull();
	});

	it("defaults pinned to false when missing", () => {
		const result = toWorkspaceSession(baseSession);
		expect(result.pinned).toBe(false);
	});

	it("passes through pinned when provided", () => {
		const result = toWorkspaceSession({ ...baseSession, pinned: true });
		expect(result.pinned).toBe(true);
	});

	it("defaults icon to null when missing", () => {
		const result = toWorkspaceSession(baseSession);
		expect(result.icon).toBeNull();
	});

	it("passes through icon when provided", () => {
		const result = toWorkspaceSession({
			...baseSession,
			icon: ":rocket:",
		});
		expect(result.icon).toBe(":rocket:");
	});

	it("defaults sortOrder to null when missing", () => {
		const result = toWorkspaceSession(baseSession);
		expect(result.sortOrder).toBeNull();
	});

	it("passes through sortOrder when provided", () => {
		const result = toWorkspaceSession({
			...baseSession,
			sort_order: 5,
		});
		expect(result.sortOrder).toBe(5);
	});

	it("provides default activity when missing", () => {
		const result = toWorkspaceSession(baseSession);
		expect(result.activity).toBeDefined();
		expect(result.activity!.phase).toBe("unknown");
		expect(result.activity!.reason).toBe("frontend_default");
	});

	it("passes through activity when provided", () => {
		const activity = {
			phase: "streaming_output" as const,
			is_idle: false,
			updated_at: "2025-01-01T00:00:00Z",
			last_input_at: null,
			last_output_at: "2025-01-01T00:00:01Z",
			reason: "output_observed",
		};
		const result = toWorkspaceSession({ ...baseSession, activity });
		expect(result.activity).toEqual(activity);
	});
});
