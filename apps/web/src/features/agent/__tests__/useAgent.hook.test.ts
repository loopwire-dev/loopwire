import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	startAgentSessionMock,
	stopAgentSessionMock,
	renameAgentSessionMock,
	updateAgentSessionSettingsMock,
	useStateMock,
} = vi.hoisted(() => ({
	startAgentSessionMock: vi.fn(),
	stopAgentSessionMock: vi.fn(),
	renameAgentSessionMock: vi.fn(),
	updateAgentSessionSettingsMock: vi.fn(),
	useStateMock: vi.fn(),
}));

vi.mock("react", () => ({
	useState: useStateMock,
	useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	startAgentSession: startAgentSessionMock,
	stopAgentSession: stopAgentSessionMock,
	renameAgentSession: renameAgentSessionMock,
	updateAgentSessionSettings: updateAgentSessionSettingsMock,
}));

const upsertWorkspaceSessionMock = vi.fn();
const removeWorkspaceSessionMock = vi.fn();
const attachWorkspaceSessionMock = vi.fn();
const setActivePanelMock = vi.fn();
const setWorkspaceMock = vi.fn();
type MockAppState = {
	upsertWorkspaceSession: typeof upsertWorkspaceSessionMock;
	removeWorkspaceSession: typeof removeWorkspaceSessionMock;
	attachWorkspaceSession: typeof attachWorkspaceSessionMock;
	setActivePanel: typeof setActivePanelMock;
	setWorkspace: typeof setWorkspaceMock;
};

vi.mock("../../../shared/stores/app-store", async () => {
	const actual = await vi.importActual<
		typeof import("../../../shared/stores/app-store")
	>("../../../shared/stores/app-store");
	return {
		...actual,
		useAppStore: (selector: (state: MockAppState) => unknown) =>
			selector({
				upsertWorkspaceSession: upsertWorkspaceSessionMock,
				removeWorkspaceSession: removeWorkspaceSessionMock,
				attachWorkspaceSession: attachWorkspaceSessionMock,
				setActivePanel: setActivePanelMock,
				setWorkspace: setWorkspaceMock,
			}),
	};
});

import { useAgent } from "../hooks/useAgent";

describe("useAgent hook logic", () => {
	beforeEach(() => {
		startAgentSessionMock.mockReset();
		stopAgentSessionMock.mockReset();
		renameAgentSessionMock.mockReset();
		updateAgentSessionSettingsMock.mockReset();
		upsertWorkspaceSessionMock.mockReset();
		removeWorkspaceSessionMock.mockReset();
		attachWorkspaceSessionMock.mockReset();
		setActivePanelMock.mockReset();
		setWorkspaceMock.mockReset();
		useStateMock.mockReset();
		useStateMock.mockReturnValue([false, vi.fn()]);
	});

	it("startSession maps response into store actions", async () => {
		startAgentSessionMock.mockResolvedValue({
			session_id: "s1",
			agent_type: "claude_code",
			custom_name: "  name  ",
			workspace_id: "w1",
			status: "running",
			created_at: "2026-01-01T00:00:00Z",
		});
		const { startSession } = useAgent();
		await startSession("claude_code", "/repo");

		expect(startAgentSessionMock).toHaveBeenCalledWith("claude_code", "/repo");
		expect(upsertWorkspaceSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "s1",
				agentType: "claude_code",
				customName: "name",
				workspaceId: "w1",
			}),
		);
		expect(attachWorkspaceSessionMock).toHaveBeenCalledWith(
			"/repo",
			"s1",
			"w1",
		);
		expect(setActivePanelMock).toHaveBeenCalledWith("/repo", {
			kind: "agent",
			sessionId: "s1",
		});
		expect(setWorkspaceMock).toHaveBeenCalledWith("/repo", "w1");
	});

	it("stop/rename/update delegate to rest api and store", async () => {
		const { stopSession, renameSession, updateSessionSettings } = useAgent();
		await stopSession("s1");
		expect(stopAgentSessionMock).toHaveBeenCalledWith("s1");
		expect(removeWorkspaceSessionMock).toHaveBeenCalledWith("s1");

		await renameSession("s1", "new");
		expect(renameAgentSessionMock).toHaveBeenCalledWith("s1", "new");

		await updateSessionSettings("s1", { pinned: true, sort_order: 2 });
		expect(updateAgentSessionSettingsMock).toHaveBeenCalledWith("s1", {
			pinned: true,
			sort_order: 2,
		});
	});
});
