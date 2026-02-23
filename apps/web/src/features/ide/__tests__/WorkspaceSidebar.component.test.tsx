import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useCallbackMock,
	useEffectMock,
	useMemoMock,
	useRefMock,
	useStateMock,
	useAppStoreMock,
	workspaceStoreKeyForSelectionMock,
	useGitStatusMock,
	useAgentMock,
	getAgentIconMock,
	AgentActivityIconMock,
	SessionContextMenuMock,
	SessionIconPickerDialogMock,
	isThemeMaskDisabledMock,
	stripMaskMetadataMock,
} = vi.hoisted(() => ({
	useCallbackMock: vi.fn(),
	useEffectMock: vi.fn(),
	useMemoMock: vi.fn(),
	useRefMock: vi.fn(),
	useStateMock: vi.fn(),
	useAppStoreMock: vi.fn(),
	workspaceStoreKeyForSelectionMock: vi.fn(),
	useGitStatusMock: vi.fn(),
	useAgentMock: vi.fn(),
	getAgentIconMock: vi.fn(),
	AgentActivityIconMock: vi.fn(),
	SessionContextMenuMock: vi.fn(),
	SessionIconPickerDialogMock: vi.fn(),
	isThemeMaskDisabledMock: vi.fn(),
	stripMaskMetadataMock: vi.fn(),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useCallback: useCallbackMock,
		useEffect: useEffectMock,
		useMemo: useMemoMock,
		useRef: useRefMock,
		useState: useStateMock,
	};
});

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
	workspaceStoreKeyForSelection: workspaceStoreKeyForSelectionMock,
}));

vi.mock("../../workspace/hooks/useGitStatus", () => ({
	useGitStatus: useGitStatusMock,
}));

vi.mock("../../agent/hooks/useAgent", () => ({
	useAgent: useAgentMock,
}));

vi.mock("../../agent/lib/agentIcons", () => ({
	getAgentIcon: getAgentIconMock,
}));

vi.mock("../../agent/components/AgentActivityIcon", () => ({
	AgentActivityIcon: AgentActivityIconMock,
}));

vi.mock("./SessionContextMenu", () => ({
	SessionContextMenu: SessionContextMenuMock,
}));

vi.mock("./SessionIconPickerDialog", () => ({
	SessionIconPickerDialog: SessionIconPickerDialogMock,
}));

vi.mock("../../../shared/lib/icon-masking", () => ({
	isThemeMaskDisabled: isThemeMaskDisabledMock,
	stripMaskMetadata: stripMaskMetadataMock,
}));

function visit(node: unknown, fn: (value: Record<string, unknown>) => void) {
	if (!node || typeof node !== "object") return;
	const value = node as Record<string, unknown>;
	fn(value);
	const props = value.props as Record<string, unknown> | undefined;
	const children = props?.children;
	if (Array.isArray(children)) {
		for (const child of children) visit(child, fn);
	} else {
		visit(children, fn);
	}
}

function textOf(node: unknown): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (!node || typeof node !== "object") return "";
	const props = (node as Record<string, unknown>).props as
		| Record<string, unknown>
		| undefined;
	const children = props?.children;
	if (Array.isArray(children)) return children.map(textOf).join("");
	return textOf(children);
}

function findButtonByText(
	tree: unknown,
	text: string,
): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		const props = node.props as Record<string, unknown> | undefined;
		if (found || node.type !== "button" || !props) return;
		if (textOf(node).includes(text)) found = node;
	});
	return found;
}

describe("WorkspaceSidebar", () => {
	beforeEach(() => {
		vi.resetModules();
		useCallbackMock.mockReset();
		useEffectMock.mockReset();
		useMemoMock.mockReset();
		useRefMock.mockReset();
		useStateMock.mockReset();
		useAppStoreMock.mockReset();
		workspaceStoreKeyForSelectionMock.mockReset();
		useGitStatusMock.mockReset();
		useAgentMock.mockReset();
		getAgentIconMock.mockReset();
		AgentActivityIconMock.mockReset();
		SessionContextMenuMock.mockReset();
		SessionIconPickerDialogMock.mockReset();
		isThemeMaskDisabledMock.mockReset();
		stripMaskMetadataMock.mockReset();

		useCallbackMock.mockImplementation((fn: unknown) => fn);
		useMemoMock.mockImplementation((factory: () => unknown) => factory());
		useRefMock.mockReturnValue({ current: null });
		useStateMock.mockImplementation((initial: unknown) => [initial, vi.fn()]);
		useEffectMock.mockImplementation(() => {});
		workspaceStoreKeyForSelectionMock.mockReturnValue("w:key");
		useAgentMock.mockReturnValue({
			stopSession: vi.fn().mockResolvedValue(undefined),
			renameSession: vi.fn().mockResolvedValue(undefined),
			updateSessionSettings: vi.fn().mockResolvedValue(undefined),
		});
		getAgentIconMock.mockReturnValue("/agent.svg");
		isThemeMaskDisabledMock.mockReturnValue(false);
		stripMaskMetadataMock.mockImplementation((value: string) => value);
	});

	it("selects files, git, agent and new-agent panels", async () => {
		const setActivePanel = vi.fn();
		const state = {
			workspacePath: "/repo",
			workspaceId: "w1",
			setActivePanel,
			reorderWorkspaceSession: vi.fn(),
			renameSessionCustomName: vi.fn(),
			updateSessionSettings: vi.fn(),
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		useGitStatusMock.mockReturnValue({ loaded: true, isGitRepo: true });

		const { WorkspaceSidebar } = await import("../components/WorkspaceSidebar");
		const tree = WorkspaceSidebar({
			sessions: [
				{
					sessionId: "s1",
					agentType: "codex",
					createdAt: "2025-01-01T00:00:00Z",
					pinned: false,
					activity: { phase: "running" },
				},
			] as never,
			activePanel: { kind: "panel", panel: "files" },
		});

		const diffBtn = findButtonByText(tree, "Diff");
		const filesBtn = findButtonByText(tree, "Files");
		const newAgentBtn = findButtonByText(tree, "New Agent");

		expect(diffBtn).toBeTruthy();
		expect(filesBtn).toBeTruthy();
		expect(newAgentBtn).toBeTruthy();
		if (!diffBtn || !filesBtn || !newAgentBtn) {
			throw new Error("Expected sidebar buttons to be present");
		}

		(diffBtn.props as { onClick: () => void }).onClick();
		(filesBtn.props as { onClick: () => void }).onClick();
		(newAgentBtn.props as { onClick: () => void }).onClick();

		expect(setActivePanel).toHaveBeenCalledWith("/repo", {
			kind: "panel",
			panel: "git",
		});
		expect(setActivePanel).toHaveBeenCalledWith("/repo", {
			kind: "panel",
			panel: "files",
		});
		expect(setActivePanel).toHaveBeenCalledWith("/repo", { kind: "new-agent" });
	});

	it("falls back from git panel when repo is not git", async () => {
		const setActivePanel = vi.fn();
		const state = {
			workspacePath: "/repo",
			workspaceId: "w1",
			setActivePanel,
			reorderWorkspaceSession: vi.fn(),
			renameSessionCustomName: vi.fn(),
			updateSessionSettings: vi.fn(),
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		useGitStatusMock.mockReturnValue({ loaded: true, isGitRepo: false });
		useEffectMock.mockImplementation((fn: () => unknown) => {
			fn();
		});

		const { WorkspaceSidebar } = await import("../components/WorkspaceSidebar");
		WorkspaceSidebar({
			sessions: [],
			activePanel: { kind: "panel", panel: "git" },
		});

		expect(setActivePanel).toHaveBeenCalledWith("/repo", {
			kind: "panel",
			panel: "files",
		});
	});
});
