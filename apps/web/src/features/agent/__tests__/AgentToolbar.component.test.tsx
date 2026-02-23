import { beforeEach, describe, expect, it, vi } from "vitest";

const { useAgentMock, AgentStatusMock } = vi.hoisted(() => ({
	useAgentMock: vi.fn(),
	AgentStatusMock: vi.fn(),
}));

vi.mock("../hooks/useAgent", () => ({
	useAgent: useAgentMock,
}));

vi.mock("../components/AgentStatus", () => ({
	AgentStatus: AgentStatusMock,
}));

describe("AgentToolbar", () => {
	beforeEach(() => {
		vi.resetModules();
		useAgentMock.mockReset();
		AgentStatusMock.mockReset();
	});

	it("calls stopSession on stop click", async () => {
		const stopSession = vi.fn().mockResolvedValue(undefined);
		useAgentMock.mockReturnValue({ stopSession });

		const { AgentToolbar } = await import("../components/AgentToolbar");
		const tree = AgentToolbar({
			session: {
				sessionId: "s1",
				status: "running",
				agentType: "codex",
			} as never,
		});
		const stopButton = tree.props.children[1];

		await stopButton.props.onClick();
		expect(stopSession).toHaveBeenCalledWith("s1");
	});

	it("swallows stop errors", async () => {
		const stopSession = vi.fn().mockRejectedValue(new Error("nope"));
		useAgentMock.mockReturnValue({ stopSession });

		const { AgentToolbar } = await import("../components/AgentToolbar");
		const tree = AgentToolbar({
			session: {
				sessionId: "s1",
				status: "running",
				agentType: "codex",
			} as never,
		});
		const stopButton = tree.props.children[1];
		await expect(stopButton.props.onClick()).resolves.toBeUndefined();
	});
});
