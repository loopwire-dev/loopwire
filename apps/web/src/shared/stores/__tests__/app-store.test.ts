import { describe, it, expect } from "vitest";
import {
	defaultAgentActivity,
	workspaceStoreKeyForSelection,
} from "../app-store";

// ── defaultAgentActivity ─────────────────────────────────────────────

describe("defaultAgentActivity", () => {
	it("returns unknown phase", () => {
		const activity = defaultAgentActivity();
		expect(activity.phase).toBe("unknown");
	});

	it("returns is_idle false", () => {
		const activity = defaultAgentActivity();
		expect(activity.is_idle).toBe(false);
	});

	it("has null timestamps", () => {
		const activity = defaultAgentActivity();
		expect(activity.last_input_at).toBeNull();
		expect(activity.last_output_at).toBeNull();
	});

	it("has frontend_default reason", () => {
		const activity = defaultAgentActivity();
		expect(activity.reason).toBe("frontend_default");
	});

	it("has valid ISO date for updated_at", () => {
		const activity = defaultAgentActivity();
		expect(() => new Date(activity.updated_at)).not.toThrow();
		expect(new Date(activity.updated_at).getTime()).not.toBeNaN();
	});

	it("returns a new object each call", () => {
		const a = defaultAgentActivity();
		const b = defaultAgentActivity();
		expect(a).not.toBe(b);
		expect(a).toEqual(
			expect.objectContaining({
				phase: "unknown",
				is_idle: false,
				reason: "frontend_default",
			}),
		);
	});
});

// ── workspaceStoreKeyForSelection ────────────────────────────────────

describe("workspaceStoreKeyForSelection", () => {
	it("returns id-prefixed key for valid workspace ID", () => {
		expect(workspaceStoreKeyForSelection("ws-123", "/tmp")).toBe(
			"id:ws-123",
		);
	});

	it("returns id-prefixed key for UUID workspace ID", () => {
		const uuid = "550e8400-e29b-41d4-a716-446655440000";
		expect(workspaceStoreKeyForSelection(uuid, "/home/user/project")).toBe(
			`id:${uuid}`,
		);
	});

	it("returns null for null workspace ID", () => {
		expect(workspaceStoreKeyForSelection(null, "/tmp")).toBeNull();
	});

	it("returns null for undefined workspace ID", () => {
		expect(workspaceStoreKeyForSelection(undefined, "/tmp")).toBeNull();
	});

	it("returns null for empty string workspace ID", () => {
		expect(workspaceStoreKeyForSelection("", "/tmp")).toBeNull();
	});

	it("returns null for whitespace-only workspace ID", () => {
		expect(workspaceStoreKeyForSelection("   ", "/tmp")).toBeNull();
	});

	it("trims workspace ID whitespace", () => {
		expect(workspaceStoreKeyForSelection("  ws-123  ", "/tmp")).toBe(
			"id:ws-123",
		);
	});

	it("ignores workspace path parameter", () => {
		expect(workspaceStoreKeyForSelection("ws-1", null)).toBe("id:ws-1");
		expect(workspaceStoreKeyForSelection("ws-1", undefined)).toBe(
			"id:ws-1",
		);
	});
});
