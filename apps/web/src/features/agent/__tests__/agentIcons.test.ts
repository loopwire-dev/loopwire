import { describe, expect, it } from "vitest";
import { getAgentIcon } from "../lib/agentIcons";

describe("agentIcons", () => {
	it("returns icon path for known agents", () => {
		expect(getAgentIcon("claude_code")).toBeTypeOf("string");
		expect(getAgentIcon("codex")).toBeTypeOf("string");
		expect(getAgentIcon("gemini")).toBeTypeOf("string");
	});

	it("returns null for unknown agent", () => {
		expect(getAgentIcon("unknown")).toBeNull();
	});
});
