import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useStateMock,
	useEffectMock,
	useCallbackMock,
	useRefMock,
	useFileSystemMock,
	useGitStatusMock,
	useAppStoreMock,
	fetchGitDiffFilesMock,
	fsReadMock,
	fsListMock,
	FileTreeNodeMock,
} = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useEffectMock: vi.fn(),
	useCallbackMock: vi.fn(),
	useRefMock: vi.fn(),
	useFileSystemMock: vi.fn(),
	useGitStatusMock: vi.fn(),
	useAppStoreMock: vi.fn(),
	fetchGitDiffFilesMock: vi.fn(),
	fsReadMock: vi.fn(),
	fsListMock: vi.fn(),
	FileTreeNodeMock: vi.fn(),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useState: useStateMock,
		useEffect: useEffectMock,
		useCallback: useCallbackMock,
		useRef: useRefMock,
	};
});

vi.mock("../../../shared/lib/daemon/rest", () => ({
	fsRead: fsReadMock,
	fsList: fsListMock,
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

vi.mock("../hooks/useFileSystem", () => ({
	useFileSystem: useFileSystemMock,
}));

vi.mock("../hooks/useGitStatus", () => ({
	useGitStatus: useGitStatusMock,
}));

vi.mock("../../editor/lib/diffUtils", () => ({
	fetchGitDiffFiles: fetchGitDiffFilesMock,
}));

vi.mock("../components/FileTreeNode", () => ({
	FileTreeNode: FileTreeNodeMock,
}));

function findTreeNodeElement(
	node: unknown,
): { props: Record<string, unknown> } | null {
	if (!node) return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findTreeNodeElement(child);
			if (found) return found;
		}
		return null;
	}
	if (typeof node !== "object") return null;
	const element = node as {
		props?: Record<string, unknown>;
	};
	if (typeof element.props?.onSelect === "function") return element as never;
	return findTreeNodeElement(element.props?.children);
}

describe("FileTree", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useEffectMock.mockReset();
		useCallbackMock.mockReset();
		useRefMock.mockReset();
		useFileSystemMock.mockReset();
		useGitStatusMock.mockReset();
		useAppStoreMock.mockReset();
		fetchGitDiffFilesMock.mockReset();
		fsReadMock.mockReset();
		fsListMock.mockReset();
		FileTreeNodeMock.mockReset();

		useStateMock
			.mockReturnValueOnce([null, vi.fn()])
			.mockReturnValueOnce([false, vi.fn()]);
		useEffectMock.mockImplementation((fn: () => undefined | (() => void)) => {
			fn();
		});
		useCallbackMock.mockImplementation((fn: unknown) => fn);
		useRefMock.mockReturnValue({ current: 0 });
		useFileSystemMock.mockReturnValue({
			entries: [{ name: "logo.svg", kind: "file" }],
			loading: false,
			listDirectory: vi.fn(),
		});
		useGitStatusMock.mockReturnValue({
			getFile: vi.fn(),
			getFolder: vi.fn(),
			isIgnored: vi.fn(),
		});
		fetchGitDiffFilesMock.mockResolvedValue([]);
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					workspaceId: string | null;
					workspacePath: string | null;
					openFilePath: string | null;
					setOpenFile: (
						path: string,
						content: string | null,
						preview: string | null,
					) => void;
				}) => unknown,
			) =>
				selector({
					workspaceId: "w1",
					workspacePath: "/repo",
					openFilePath: null,
					setOpenFile: vi.fn(),
				}),
		);
	});

	it("prefetches git diffs and wires node handlers", async () => {
		const { FileTree } = await import("../components/FileTree");
		const tree = FileTree();

		expect(fetchGitDiffFilesMock).toHaveBeenCalledWith("w1");
		const list = tree.props.children[1];
		const nodeElement = findTreeNodeElement(list);
		if (!nodeElement) throw new Error("missing FileTreeNode element");
		const nodeProps = nodeElement.props as {
			onExpand: (path: string) => Promise<unknown[]>;
		};
		fsListMock.mockResolvedValue([{ name: "x", kind: "file" }]);
		await expect(nodeProps.onExpand("src")).resolves.toEqual([
			{ name: "x", kind: "file" },
		]);
	});

	it("opens SVG files as data URLs", async () => {
		const setOpenFile = vi.fn();
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					workspaceId: string | null;
					workspacePath: string | null;
					openFilePath: string | null;
					setOpenFile: typeof setOpenFile;
				}) => unknown,
			) =>
				selector({
					workspaceId: "w1",
					workspacePath: "/repo",
					openFilePath: null,
					setOpenFile,
				}),
		);
		fsReadMock.mockResolvedValue({
			is_binary: false,
			content: "<svg />",
		});

		const { FileTree } = await import("../components/FileTree");
		const tree = FileTree();
		const list = tree.props.children[1];
		const nodeElement = findTreeNodeElement(list);
		if (!nodeElement) throw new Error("missing FileTreeNode element");
		const nodeProps = nodeElement.props as {
			onSelect: (path: string) => Promise<void>;
		};
		await nodeProps.onSelect("logo.svg");

		expect(setOpenFile).toHaveBeenCalledWith(
			"logo.svg",
			null,
			"data:image/svg+xml;charset=utf-8,%3Csvg%20%2F%3E",
		);
	});
});
