import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useStateMock,
	useEffectMock,
	useRefMock,
	getFileIconSrcMock,
	getFolderIconSrcMock,
} = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useEffectMock: vi.fn(),
	useRefMock: vi.fn(),
	getFileIconSrcMock: vi.fn(),
	getFolderIconSrcMock: vi.fn(),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useState: useStateMock,
		useEffect: useEffectMock,
		useRef: useRefMock,
	};
});

vi.mock("../lib/vscodeIcons", () => ({
	getFileIconSrc: getFileIconSrcMock,
	getFolderIconSrc: getFolderIconSrcMock,
}));

describe("FileTreeNode", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useEffectMock.mockReset();
		useRefMock.mockReset();
		getFileIconSrcMock.mockReset();
		getFolderIconSrcMock.mockReset();
		useEffectMock.mockImplementation(() => {});
		useRefMock.mockReturnValue({ current: null });
		getFileIconSrcMock.mockReturnValue("/file.svg");
		getFolderIconSrcMock.mockReturnValue("/folder.svg");
	});

	it("selects file entries on click", async () => {
		const setExpanded = vi.fn();
		const setChildren = vi.fn();
		const setHasLoadedChildren = vi.fn();
		const onSelect = vi.fn();

		useStateMock
			.mockReturnValueOnce([false, setExpanded])
			.mockReturnValueOnce([[], setChildren])
			.mockReturnValueOnce([false, setHasLoadedChildren]);

		const { FileTreeNode } = await import("../components/FileTreeNode");
		const tree = FileTreeNode({
			entry: { name: "a.ts", kind: "file" },
			path: "src",
			selectedPath: null,
			onSelect,
			onExpand: vi.fn(),
			gitStatus: {
				isIgnored: vi.fn().mockReturnValue(false),
				getFile: vi.fn().mockReturnValue(null),
				getFolder: vi.fn().mockReturnValue("clean"),
			},
			treeCommand: null,
		} as never);

		const button = tree.props.children[0];
		await button.props.onClick();
		expect(onSelect).toHaveBeenCalledWith("src/a.ts");
		expect(setExpanded).not.toHaveBeenCalled();
		expect(setChildren).not.toHaveBeenCalled();
		expect(setHasLoadedChildren).not.toHaveBeenCalled();
	});

	it("expands directory and loads children on click", async () => {
		const setExpanded = vi.fn();
		const setChildren = vi.fn();
		const setHasLoadedChildren = vi.fn();
		const onExpand = vi
			.fn()
			.mockResolvedValue([{ name: "nested", kind: "file" }]);

		useStateMock
			.mockReturnValueOnce([false, setExpanded])
			.mockReturnValueOnce([[], setChildren])
			.mockReturnValueOnce([false, setHasLoadedChildren]);

		const { FileTreeNode } = await import("../components/FileTreeNode");
		const tree = FileTreeNode({
			entry: { name: "src", kind: "directory" },
			path: "",
			selectedPath: null,
			onSelect: vi.fn(),
			onExpand,
			gitStatus: {
				isIgnored: vi.fn().mockReturnValue(false),
				getFile: vi.fn().mockReturnValue(null),
				getFolder: vi.fn().mockReturnValue("clean"),
			},
			treeCommand: null,
		} as never);

		const button = tree.props.children[0];
		await button.props.onClick();
		expect(onExpand).toHaveBeenCalledWith("src");
		expect(setChildren).toHaveBeenCalledWith([
			{ name: "nested", kind: "file" },
		]);
		expect(setHasLoadedChildren).toHaveBeenCalledWith(true);
		expect(setExpanded).toHaveBeenCalledWith(true);
	});

	it("handles keyboard navigation and collapse behavior", async () => {
		const setExpanded = vi.fn();
		const onExpand = vi
			.fn()
			.mockResolvedValue([{ name: "first", kind: "file" }]);
		useStateMock
			.mockReturnValueOnce([true, setExpanded])
			.mockReturnValueOnce([[{ name: "first", kind: "file" }], vi.fn()])
			.mockReturnValueOnce([true, vi.fn()]);

		const { FileTreeNode } = await import("../components/FileTreeNode");
		const tree = FileTreeNode({
			entry: { name: "src", kind: "directory" },
			path: "",
			selectedPath: null,
			onSelect: vi.fn(),
			onExpand,
			gitStatus: {
				isIgnored: vi.fn().mockReturnValue(false),
				getFile: vi.fn().mockReturnValue(null),
				getFolder: vi.fn().mockReturnValue("modified"),
			},
			treeCommand: null,
		} as never);

		const button = tree.props.children[0];
		const focusA = vi.fn();
		const focusB = vi.fn();
		const nodes = [
			{ dataset: { path: "src" }, focus: focusA },
			{ dataset: { path: "src/first" }, focus: focusB },
		];
		const treeEl = {
			querySelectorAll: vi.fn().mockReturnValue(nodes),
		};
		const currentTarget = {
			dataset: { path: "src" },
			closest: vi.fn().mockReturnValue(treeEl),
		};

		const preventDefaultDown = vi.fn();
		await button.props.onKeyDown({
			key: "ArrowDown",
			preventDefault: preventDefaultDown,
			currentTarget,
		});
		expect(preventDefaultDown).toHaveBeenCalledTimes(1);
		expect(focusB).toHaveBeenCalledTimes(1);

		const preventDefaultUp = vi.fn();
		await button.props.onKeyDown({
			key: "ArrowUp",
			preventDefault: preventDefaultUp,
			currentTarget,
		});
		expect(preventDefaultUp).toHaveBeenCalledTimes(1);

		const preventDefaultRight = vi.fn();
		await button.props.onKeyDown({
			key: "ArrowRight",
			preventDefault: preventDefaultRight,
			currentTarget,
		});
		expect(preventDefaultRight).toHaveBeenCalledTimes(1);
		expect(focusB).toHaveBeenCalledTimes(2);
		expect(onExpand).not.toHaveBeenCalled();

		const preventDefaultLeft = vi.fn();
		await button.props.onKeyDown({
			key: "ArrowLeft",
			preventDefault: preventDefaultLeft,
			currentTarget,
		});
		expect(preventDefaultLeft).toHaveBeenCalledTimes(1);
		expect(setExpanded).toHaveBeenCalledWith(false);
	});
});
