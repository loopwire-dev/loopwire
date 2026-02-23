import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useEffectMock,
	useMemoMock,
	useAppStoreMock,
	workspaceStoreKeyForSelectionMock,
	WorkspaceSidebarMock,
	FilesPanelViewMock,
	GitPanelViewMock,
	TerminalMock,
	InlineAgentPickerMock,
} = vi.hoisted(() => ({
	useEffectMock: vi.fn(),
	useMemoMock: vi.fn(),
	useAppStoreMock: vi.fn(),
	workspaceStoreKeyForSelectionMock: vi.fn(),
	WorkspaceSidebarMock: vi.fn(),
	FilesPanelViewMock: vi.fn(),
	GitPanelViewMock: vi.fn(),
	TerminalMock: vi.fn(),
	InlineAgentPickerMock: vi.fn(),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useEffect: useEffectMock,
		useMemo: useMemoMock,
	};
});

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
	workspaceStoreKeyForSelection: workspaceStoreKeyForSelectionMock,
}));

vi.mock("../components/WorkspaceSidebar", () => ({
	WorkspaceSidebar: WorkspaceSidebarMock,
}));

vi.mock("../components/FilesPanelView", () => ({
	FilesPanelView: FilesPanelViewMock,
}));

vi.mock("../components/GitPanelView", () => ({
	GitPanelView: GitPanelViewMock,
}));

vi.mock("../../terminal/components/Terminal", () => ({
	Terminal: TerminalMock,
}));

vi.mock("../../agent/components/InlineAgentPicker", () => ({
	InlineAgentPicker: InlineAgentPickerMock,
}));

describe("WorkspaceView", () => {
	beforeEach(() => {
		vi.resetModules();
		useEffectMock.mockReset();
		useMemoMock.mockReset();
		useAppStoreMock.mockReset();
		workspaceStoreKeyForSelectionMock.mockReset();
		WorkspaceSidebarMock.mockReset();
		FilesPanelViewMock.mockReset();
		GitPanelViewMock.mockReset();
		TerminalMock.mockReset();
		InlineAgentPickerMock.mockReset();
		useEffectMock.mockImplementation(() => {});
		useMemoMock.mockImplementation((factory: () => unknown) => factory());
	});

	it("renders files panel by default", async () => {
		const state = {
			workspacePath: "/repo",
			workspaceId: "w1",
			sessionsByWorkspacePath: {
				key1: [],
			},
			activePanelByWorkspacePath: {},
			setActivePanel: vi.fn(),
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		workspaceStoreKeyForSelectionMock.mockReturnValue("key1");

		const { WorkspaceView } = await import("../components/WorkspaceView");
		const tree = WorkspaceView();
		const content = tree.props.children[2].props.children;

		expect(content.type).toBe(FilesPanelViewMock);
	});

	it("renders git panel when active panel is git", async () => {
		const state = {
			workspacePath: "/repo",
			workspaceId: "w1",
			sessionsByWorkspacePath: {
				key1: [],
			},
			activePanelByWorkspacePath: {
				key1: { kind: "panel", panel: "git" },
			},
			setActivePanel: vi.fn(),
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		workspaceStoreKeyForSelectionMock.mockReturnValue("key1");

		const { WorkspaceView } = await import("../components/WorkspaceView");
		const tree = WorkspaceView();
		const content = tree.props.children[2].props.children;

		expect(content.type).toBe(GitPanelViewMock);
	});

	it("renders terminal for active agent panel", async () => {
		const state = {
			workspacePath: "/repo",
			workspaceId: "w1",
			sessionsByWorkspacePath: {
				key1: [
					{ sessionId: "s1", createdAt: "2025-01-01T00:00:00Z", pinned: false },
				],
			},
			activePanelByWorkspacePath: {
				key1: { kind: "agent", sessionId: "s1" },
			},
			setActivePanel: vi.fn(),
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		workspaceStoreKeyForSelectionMock.mockReturnValue("key1");

		const { WorkspaceView } = await import("../components/WorkspaceView");
		const tree = WorkspaceView();
		const content = tree.props.children[2].props.children;

		expect(content.type).toBe(TerminalMock);
		expect(content.props.sessionId).toBe("s1");
	});

	it("falls back to files panel when active agent no longer exists", async () => {
		const state = {
			workspacePath: "/repo",
			workspaceId: "w1",
			sessionsByWorkspacePath: {
				key1: [],
			},
			activePanelByWorkspacePath: {
				key1: { kind: "agent", sessionId: "missing" },
			},
			setActivePanel: vi.fn(),
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		workspaceStoreKeyForSelectionMock.mockReturnValue("key1");

		const { WorkspaceView } = await import("../components/WorkspaceView");
		const tree = WorkspaceView();
		const content = tree.props.children[2].props.children;

		expect(content.type).toBe(FilesPanelViewMock);
	});
});
