import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useEffectMock,
	useStateMock,
	useAppStoreMock,
	getStateMock,
	workspaceStoreKeyForSelectionMock,
	removeWorkspaceApiMock,
	updateWorkspaceSettingsMock,
	TooltipMock,
	IconPickerDialogMock,
	WorkspaceItemMock,
} = vi.hoisted(() => ({
	useEffectMock: vi.fn(),
	useStateMock: vi.fn(),
	useAppStoreMock: vi.fn(),
	getStateMock: vi.fn(),
	workspaceStoreKeyForSelectionMock: vi.fn(),
	removeWorkspaceApiMock: vi.fn(),
	updateWorkspaceSettingsMock: vi.fn(),
	TooltipMock: vi.fn(),
	IconPickerDialogMock: vi.fn(),
	WorkspaceItemMock: vi.fn(() => null),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useEffect: useEffectMock,
		useState: useStateMock,
	};
});

vi.mock("../../../shared/stores/app-store", () => {
	const useAppStore = (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector);
	const useAppStoreWithGetState = Object.assign(useAppStore, {
		getState: getStateMock,
	});
	return {
		useAppStore: useAppStoreWithGetState,
		workspaceStoreKeyForSelection: workspaceStoreKeyForSelectionMock,
	};
});

vi.mock("../../../shared/lib/daemon/rest", () => ({
	removeWorkspace: removeWorkspaceApiMock,
	updateWorkspaceSettings: updateWorkspaceSettingsMock,
}));

vi.mock("../../../shared/ui/Tooltip", () => ({
	Tooltip: TooltipMock,
}));

vi.mock("./WorkspaceItem", () => ({
	WorkspaceItem: WorkspaceItemMock,
}));

vi.mock("./IconPickerDialog", () => ({
	IconPickerDialog: IconPickerDialogMock,
}));

vi.mock("../../../shared/layout/SettingsDialog", () => ({
	SettingsDialog: () => null,
}));

vi.mock("../../landing/components/LoopwireLogo", () => ({
	LoopwireLogo: () => null,
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
	label: string,
): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		if (found || node.type !== "button") return;
		if (textOf(node).includes(label)) found = node;
	});
	return found;
}

function findMainSidebarDiv(tree: unknown): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		const props = node.props as Record<string, unknown> | undefined;
		if (
			!found &&
			node.type === "div" &&
			props &&
			typeof props.onClickCapture === "function" &&
			typeof props.onMouseMove === "function"
		) {
			found = node;
		}
	});
	return found;
}

function findIconPickerNode(tree: unknown): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		const props = node.props as Record<string, unknown> | undefined;
		if (
			!found &&
			props &&
			typeof props.onConfirm === "function" &&
			typeof props.onClose === "function"
		) {
			found = node;
		}
	});
	return found;
}

describe("AppSidebar", () => {
	beforeEach(() => {
		vi.resetModules();
		useEffectMock.mockReset();
		useStateMock.mockReset();
		useAppStoreMock.mockReset();
		getStateMock.mockReset();
		workspaceStoreKeyForSelectionMock.mockReset();
		removeWorkspaceApiMock.mockReset();
		updateWorkspaceSettingsMock.mockReset();
		TooltipMock.mockReset();
		IconPickerDialogMock.mockReset();
		WorkspaceItemMock.mockReset();

		useEffectMock.mockImplementation(() => {});
		useStateMock.mockImplementation((initial: unknown) => [initial, vi.fn()]);
		TooltipMock.mockImplementation(({ children }) => children);
		IconPickerDialogMock.mockImplementation(() => null);
		Object.defineProperty(globalThis, "Element", {
			value: class {},
			configurable: true,
		});
		Object.defineProperty(globalThis, "Node", {
			value: class {},
			configurable: true,
		});
		removeWorkspaceApiMock.mockResolvedValue(undefined);
		updateWorkspaceSettingsMock.mockResolvedValue(undefined);
		workspaceStoreKeyForSelectionMock.mockReturnValue("wk");
	});

	it("triggers new workspace and settings actions", async () => {
		const setBrowsingForWorkspace = vi.fn();
		const setSettingsOpen = vi.fn();
		const state = {
			workspaceRoots: [],
			workspacePath: "/repo",
			browsingForWorkspace: false,
			setBrowsingForWorkspace,
			setWorkspacePath: vi.fn(),
			removeWorkspaceRoot: vi.fn(),
			setWorkspacePinned: vi.fn(),
			renameWorkspaceRoot: vi.fn(),
			setWorkspaceIcon: vi.fn(),
			reorderWorkspaceRoots: vi.fn(),
			clearWorkspace: vi.fn(),
			sidebarCompact: false,
			toggleSidebarCompact: vi.fn(),
			setSettingsOpen,
			setWorkspace: vi.fn(),
			attachWorkspaceSession: vi.fn(),
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		getStateMock.mockReturnValue({
			workspaceRoots: [],
			sessionsByWorkspacePath: {},
		});

		const { AppSidebar } = await import("../components/AppSidebar");
		const tree = AppSidebar();

		const newWorkspaceBtn = findButtonByText(tree, "New Workspace");
		const settingsBtn = findButtonByText(tree, "Settings");
		expect(newWorkspaceBtn).toBeTruthy();
		expect(settingsBtn).toBeTruthy();
		if (!newWorkspaceBtn || !settingsBtn)
			throw new Error("Expected sidebar buttons");

		(newWorkspaceBtn.props as { onClick: () => void }).onClick();
		(settingsBtn.props as { onClick: () => void }).onClick();

		expect(setBrowsingForWorkspace).toHaveBeenCalledWith(true);
		expect(setSettingsOpen).toHaveBeenCalledWith(true);
	});

	it("toggles compact mode from sidebar capture and syncs icon confirm", async () => {
		const toggleSidebarCompact = vi.fn();
		const setWorkspaceIcon = vi.fn();
		const state = {
			workspaceRoots: [{ path: "/repo", name: "repo", pinned: false }],
			workspacePath: "/repo",
			browsingForWorkspace: false,
			setBrowsingForWorkspace: vi.fn(),
			setWorkspacePath: vi.fn(),
			removeWorkspaceRoot: vi.fn(),
			setWorkspacePinned: vi.fn(),
			renameWorkspaceRoot: vi.fn(),
			setWorkspaceIcon,
			reorderWorkspaceRoots: vi.fn(),
			clearWorkspace: vi.fn(),
			sidebarCompact: true,
			toggleSidebarCompact,
			setSettingsOpen: vi.fn(),
			setWorkspace: vi.fn(),
			attachWorkspaceSession: vi.fn(),
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		getStateMock.mockReturnValue({
			workspaceRoots: state.workspaceRoots,
			sessionsByWorkspacePath: {},
		});

		const { AppSidebar } = await import("../components/AppSidebar");
		const tree = AppSidebar();
		const mainDiv = findMainSidebarDiv(tree);
		expect(mainDiv).toBeTruthy();
		if (!mainDiv) throw new Error("Expected main sidebar container");

		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		(
			mainDiv.props as { onClickCapture: (event: unknown) => void }
		).onClickCapture({
			target: null,
			preventDefault,
			stopPropagation,
		});
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect(toggleSidebarCompact).toHaveBeenCalledTimes(1);

		const pickerNode = findIconPickerNode(tree);
		expect(pickerNode).toBeTruthy();
		const pickerProps = pickerNode?.props as {
			onConfirm: (path: string, icon: string | null) => void;
		};
		pickerProps.onConfirm("/repo", "😀");
		expect(setWorkspaceIcon).toHaveBeenCalledWith("/repo", "😀");
		expect(updateWorkspaceSettingsMock).toHaveBeenCalledWith({
			path: "/repo",
			icon: "😀",
		});
	});

	it("expands sidebar from header button when compact", async () => {
		const toggleSidebarCompact = vi.fn();
		const state = {
			workspaceRoots: [],
			workspacePath: "/repo",
			browsingForWorkspace: false,
			setBrowsingForWorkspace: vi.fn(),
			setWorkspacePath: vi.fn(),
			removeWorkspaceRoot: vi.fn(),
			setWorkspacePinned: vi.fn(),
			renameWorkspaceRoot: vi.fn(),
			setWorkspaceIcon: vi.fn(),
			reorderWorkspaceRoots: vi.fn(),
			clearWorkspace: vi.fn(),
			sidebarCompact: true,
			toggleSidebarCompact,
			setSettingsOpen: vi.fn(),
			setWorkspace: vi.fn(),
			attachWorkspaceSession: vi.fn(),
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		getStateMock.mockReturnValue({
			workspaceRoots: [],
			sessionsByWorkspacePath: {},
		});

		const { AppSidebar } = await import("../components/AppSidebar");
		const tree = AppSidebar();
		const expandBtn = findButtonByText(tree, "");
		// Header expand button is compact-only and labeled.
		let headerExpandNode: Record<string, unknown> | null = null;
		visit(tree, (node) => {
			const props = node.props as Record<string, unknown> | undefined;
			if (
				!headerExpandNode &&
				node.type === "button" &&
				props?.["aria-label"] === "Expand sidebar"
			) {
				headerExpandNode = node;
			}
		});
		expect(expandBtn || headerExpandNode).toBeTruthy();
		if (!headerExpandNode) throw new Error("Expected expand button");
		const headerExpand = headerExpandNode as {
			props: { onClick: () => void };
		};
		headerExpand.props.onClick();
		expect(toggleSidebarCompact).toHaveBeenCalledTimes(1);
	});
});
