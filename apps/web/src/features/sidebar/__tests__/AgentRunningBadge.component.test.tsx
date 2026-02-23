import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRunningBadge } from "../components/AgentRunningBadge";

const { getAgentIconMock } = vi.hoisted(() => ({
	getAgentIconMock: vi.fn(),
}));

vi.mock("../../agent/lib/agentIcons", () => ({
	getAgentIcon: getAgentIconMock,
}));

describe("AgentRunningBadge", () => {
	beforeEach(() => {
		getAgentIconMock.mockReset();
	});

	it("returns null when count is zero", () => {
		expect(AgentRunningBadge({ count: 0 })).toBeNull();
	});

	it("renders fallback bot icon when agent icon is missing", () => {
		getAgentIconMock.mockReturnValue(null);
		const tree = AgentRunningBadge({ count: 2, agentType: "unknown" });
		expect(tree?.props.children[1]).toBe(2);
	});

	it("renders agent image icon when available and can hide count", () => {
		getAgentIconMock.mockReturnValue("/icon.svg");
		const tree = AgentRunningBadge({
			count: 3,
			agentType: "codex",
			showCount: false,
		});
		const icon = tree?.props.children[0];
		expect(icon.props.src).toBe("/icon.svg");
		expect(tree?.props.children[1]).toBeNull();
	});
});
