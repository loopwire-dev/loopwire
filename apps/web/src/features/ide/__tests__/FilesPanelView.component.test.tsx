import { beforeEach, describe, expect, it, vi } from "vitest";

const { useAppStoreMock, CodeEditorMock, FileTreeMock } = vi.hoisted(() => ({
	useAppStoreMock: vi.fn(),
	CodeEditorMock: vi.fn(),
	FileTreeMock: vi.fn(),
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

vi.mock("../../editor/components/CodeEditor", () => ({
	CodeEditor: CodeEditorMock,
}));

vi.mock("../../workspace/components/FileTree", () => ({
	FileTree: FileTreeMock,
}));

describe("FilesPanelView", () => {
	beforeEach(() => {
		vi.resetModules();
		useAppStoreMock.mockReset();
		CodeEditorMock.mockReset();
		FileTreeMock.mockReset();
	});

	it("shows empty message when no file is selected", async () => {
		useAppStoreMock.mockImplementation(
			(selector: (state: { openFilePath: string | null }) => unknown) =>
				selector({ openFilePath: null }),
		);
		const { FilesPanelView } = await import("../components/FilesPanelView");
		const tree = FilesPanelView();
		const panelGroup = tree.props.children;
		const rightPanel = panelGroup.props.children[2];
		const content = rightPanel.props.children.props.children;
		expect(content.props.children).toContain("Select a file to preview");
	});

	it("renders CodeEditor when file is selected", async () => {
		useAppStoreMock.mockImplementation(
			(selector: (state: { openFilePath: string | null }) => unknown) =>
				selector({ openFilePath: "src/a.ts" }),
		);
		const { FilesPanelView } = await import("../components/FilesPanelView");
		const tree = FilesPanelView();
		const panelGroup = tree.props.children;
		const rightPanel = panelGroup.props.children[2];
		const content = rightPanel.props.children.props.children;
		expect(content.type).toBe(CodeEditorMock);
	});
});
