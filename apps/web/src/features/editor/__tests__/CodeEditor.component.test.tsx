import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useStateMock,
	useEffectMock,
	useCallbackMock,
	useRefMock,
	useThemeMock,
	useEditorMock,
	useGitGutterMock,
	EditorMock,
} = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useEffectMock: vi.fn(),
	useCallbackMock: vi.fn(),
	useRefMock: vi.fn(),
	useThemeMock: vi.fn(),
	useEditorMock: vi.fn(),
	useGitGutterMock: vi.fn(),
	EditorMock: vi.fn(() => null),
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

vi.mock("next-themes", () => ({ useTheme: useThemeMock }));
vi.mock("../hooks/useEditor", () => ({ useEditor: useEditorMock }));
vi.mock("../hooks/useGitGutter", () => ({ useGitGutter: useGitGutterMock }));
vi.mock("@monaco-editor/react", () => ({ default: EditorMock }));
vi.mock("react-markdown", () => ({ default: () => null }));
vi.mock("remark-gfm", () => ({ default: {} }));
vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: { workspaceId: string | null }) => unknown) =>
		selector({ workspaceId: "w1" }),
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

function findButtonByAriaLabel(
	tree: unknown,
	label: string,
): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		const props = node.props as Record<string, unknown> | undefined;
		if (found || node.type !== "button" || !props) return;
		if (props["aria-label"] === label) found = node;
	});
	return found;
}

function findNodeByType(
	tree: unknown,
	type: unknown,
): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		if (!found && node.type === type) found = node;
	});
	return found;
}

describe("CodeEditor", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useEffectMock.mockReset();
		useCallbackMock.mockReset();
		useRefMock.mockReset();
		useThemeMock.mockReset();
		useEditorMock.mockReset();
		useGitGutterMock.mockReset();
		EditorMock.mockReset();

		useStateMock.mockImplementation((initial: unknown) => [initial, vi.fn()]);
		useEffectMock.mockImplementation(() => {});
		useCallbackMock.mockImplementation((fn: unknown) => fn);
		useRefMock.mockReturnValue({ current: null });
		useThemeMock.mockReturnValue({ resolvedTheme: "light" });
	});

	it("toggles markdown preview and closes file", async () => {
		const close = vi.fn();
		const setPreviewMode = vi.fn();
		useStateMock.mockReturnValue([false, setPreviewMode]);
		useEditorMock.mockReturnValue({
			filePath: "/repo/README.md",
			content: "# hello",
			imageSrc: null,
			extension: "md",
			close,
		});

		const { CodeEditor } = await import("../components/CodeEditor");
		const tree = CodeEditor();

		const previewBtn = findButtonByAriaLabel(tree, "Show preview");
		const closeBtn = findButtonByAriaLabel(tree, "Close file");
		expect(previewBtn).toBeTruthy();
		expect(closeBtn).toBeTruthy();
		if (!previewBtn || !closeBtn) {
			throw new Error("Expected preview and close buttons");
		}

		(previewBtn.props as { onClick: () => void }).onClick();
		expect(setPreviewMode).toHaveBeenCalled();
		(closeBtn.props as { onClick: () => void }).onClick();
		expect(close).toHaveBeenCalledTimes(1);
		expect(useGitGutterMock).toHaveBeenCalled();
	});

	it("returns null when no file is open", async () => {
		useEditorMock.mockReturnValue({
			filePath: null,
			content: null,
			imageSrc: null,
			extension: "",
			close: vi.fn(),
		});
		const { CodeEditor } = await import("../components/CodeEditor");
		expect(CodeEditor()).toBeNull();
		expect(useGitGutterMock).toHaveBeenCalledWith(
			"w1",
			null,
			expect.anything(),
			expect.anything(),
			false,
		);
	});

	it("passes editor props with dark theme and mapped language", async () => {
		useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
		useEditorMock.mockReturnValue({
			filePath: "/repo/Dockerfile",
			content: "FROM alpine",
			imageSrc: null,
			extension: "",
			close: vi.fn(),
		});

		const { CodeEditor } = await import("../components/CodeEditor");
		const tree = CodeEditor();
		const editorNode = findNodeByType(tree, EditorMock);
		expect(editorNode).toBeTruthy();
		const props = editorNode?.props as
			| { language?: string; theme?: string; path?: string; value?: string }
			| undefined;
		expect(props?.language).toBe("dockerfile");
		expect(props?.theme).toBe("vs-dark");
		expect(props?.path).toBe("/repo/Dockerfile");
		expect(props?.value).toBe("FROM alpine");
	});

	it("renders image mode and disables git gutter file path", async () => {
		useEditorMock.mockReturnValue({
			filePath: "/repo/image.png",
			content: null,
			imageSrc: "data:image/png;base64,abc",
			extension: "png",
			close: vi.fn(),
		});

		const { CodeEditor } = await import("../components/CodeEditor");
		const tree = CodeEditor() as { props?: { children?: unknown } } | null;
		expect(tree).toBeTruthy();
		expect(EditorMock).not.toHaveBeenCalled();
		expect(useGitGutterMock).toHaveBeenCalledWith(
			"w1",
			null,
			expect.anything(),
			expect.anything(),
			false,
		);
	});

	it("shows source toggle label when markdown preview mode is active", async () => {
		const close = vi.fn();
		const setPreviewMode = vi.fn();
		useStateMock.mockReturnValue([true, setPreviewMode]);
		useEditorMock.mockReturnValue({
			filePath: "/repo/README.md",
			content: "# hello",
			imageSrc: null,
			extension: "md",
			close,
		});

		const { CodeEditor } = await import("../components/CodeEditor");
		const tree = CodeEditor();
		const sourceBtn = findButtonByAriaLabel(tree, "Show source");
		expect(sourceBtn).toBeTruthy();
	});
});
