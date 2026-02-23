import { beforeEach, describe, expect, it, vi } from "vitest";

const { registerWorkspaceMock, useAppStoreMock, FolderBrowserMock } =
	vi.hoisted(() => ({
		registerWorkspaceMock: vi.fn(),
		useAppStoreMock: vi.fn(),
		FolderBrowserMock: vi.fn(),
	}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	registerWorkspace: registerWorkspaceMock,
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

vi.mock("../components/FolderBrowser", () => ({
	FolderBrowser: FolderBrowserMock,
}));

function findElement(
	node: unknown,
	predicate: (candidate: {
		type?: unknown;
		props?: Record<string, unknown>;
	}) => boolean,
): { type?: unknown; props?: Record<string, unknown> } | null {
	if (!node || typeof node !== "object") return null;
	const element = node as { type?: unknown; props?: Record<string, unknown> };
	if (predicate(element)) return element;

	const children = element.props?.children;
	if (!children) return null;
	const list = Array.isArray(children) ? children : [children];
	for (const child of list) {
		const found = findElement(child, predicate);
		if (found) return found;
	}
	return null;
}

describe("NewWorkspaceView", () => {
	beforeEach(() => {
		vi.resetModules();
		registerWorkspaceMock.mockReset();
		useAppStoreMock.mockReset();
		FolderBrowserMock.mockReset();
	});

	it("shows browse button when not browsing", async () => {
		const setBrowsingForWorkspace = vi.fn();
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					browsingForWorkspace: boolean;
					addWorkspaceRoot: (path: string) => void;
					setWorkspacePath: (path: string) => void;
					setWorkspace: (path: string, id: string) => void;
					setBrowsingForWorkspace: (value: boolean) => void;
				}) => unknown,
			) =>
				selector({
					browsingForWorkspace: false,
					addWorkspaceRoot: vi.fn(),
					setWorkspacePath: vi.fn(),
					setWorkspace: vi.fn(),
					setBrowsingForWorkspace,
				}),
		);

		const { NewWorkspaceView } = await import("../components/NewWorkspaceView");
		const tree = NewWorkspaceView();
		const button = findElement(
			tree,
			(candidate) =>
				candidate.type === "button" &&
				typeof candidate.props?.onClick === "function",
		);
		if (!button) throw new Error("missing browse button");
		(button.props?.onClick as () => void)();
		expect(setBrowsingForWorkspace).toHaveBeenCalledWith(true);
	});

	it("renders folder browser and handles select/cancel", async () => {
		const addWorkspaceRoot = vi.fn();
		const setWorkspacePath = vi.fn();
		const setWorkspace = vi.fn();
		const setBrowsingForWorkspace = vi.fn();

		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					browsingForWorkspace: boolean;
					addWorkspaceRoot: (path: string) => void;
					setWorkspacePath: (path: string) => void;
					setWorkspace: (path: string, id: string) => void;
					setBrowsingForWorkspace: (value: boolean) => void;
				}) => unknown,
			) =>
				selector({
					browsingForWorkspace: true,
					addWorkspaceRoot,
					setWorkspacePath,
					setWorkspace,
					setBrowsingForWorkspace,
				}),
		);
		registerWorkspaceMock.mockResolvedValue({ workspace_id: "w1" });

		const { NewWorkspaceView } = await import("../components/NewWorkspaceView");
		const tree = NewWorkspaceView();
		const folderBrowserElement = findElement(
			tree,
			(candidate) => candidate.type === FolderBrowserMock,
		);
		if (!folderBrowserElement) throw new Error("missing FolderBrowser");
		const props = folderBrowserElement.props as {
			onSelect: (path: string) => Promise<void>;
			onCancel: () => void;
		};
		await props.onSelect("/repo");
		expect(addWorkspaceRoot).toHaveBeenCalledWith("/repo");
		expect(setWorkspacePath).toHaveBeenCalledWith("/repo");
		expect(setBrowsingForWorkspace).toHaveBeenCalledWith(false);
		expect(setWorkspace).toHaveBeenCalledWith("/repo", "w1");

		props.onCancel();
		expect(setBrowsingForWorkspace).toHaveBeenCalledWith(false);
	});
});
