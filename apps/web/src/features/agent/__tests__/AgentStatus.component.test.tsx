import { describe, expect, it } from "vitest";
import { AgentStatus } from "../components/AgentStatus";

describe("AgentStatus", () => {
	it("renders known agent label and running style", () => {
		const tree = AgentStatus({
			status: "running",
			agentType: "claude_code",
		});
		const statusPill = tree.props.children[0];
		const name = tree.props.children[1];

		expect(statusPill.props.children).toBe("running");
		expect(statusPill.props.className).toContain("emerald");
		expect(name.props.children).toBe("Claude Code");
	});

	it("falls back for unknown status and agent name", () => {
		const tree = AgentStatus({
			status: "mystery",
			agentType: "custom_agent",
		});
		const statusPill = tree.props.children[0];
		const name = tree.props.children[1];

		expect(statusPill.props.className).toContain("zinc");
		expect(name.props.children).toBe("custom_agent");
	});
});
