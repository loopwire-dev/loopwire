import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useCallbackMock,
	useEffectMock,
	useMemoMock,
	useRefMock,
	useStateMock,
	useAppStoreMock,
	fetchGitDiffMock,
	parseUnifiedPatchMock,
	isNotGitRepoErrorMock,
	buildUnifiedLinesMock,
} = vi.hoisted(() => ({
	useCallbackMock: vi.fn(),
	useEffectMock: vi.fn(),
	useMemoMock: vi.fn(),
	useRefMock: vi.fn(),
	useStateMock: vi.fn(),
	useAppStoreMock: vi.fn(),
	fetchGitDiffMock: vi.fn(),
	parseUnifiedPatchMock: vi.fn(),
	isNotGitRepoErrorMock: vi.fn(),
	buildUnifiedLinesMock: vi.fn(),
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
}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	fsReadMany: vi.fn(),
	isNotGitRepoError: isNotGitRepoErrorMock,
}));

vi.mock("../../editor/lib/diffUtils", () => ({
	fetchGitDiff: fetchGitDiffMock,
	parseUnifiedPatch: parseUnifiedPatchMock,
}));

vi.mock("../lib/gitDiffUnifiedLines", () => ({
	buildUnifiedLines: buildUnifiedLinesMock,
	lineBackground: () => "",
	splitLineMarker: () => ({ marker: "", markerClass: "" }),
	stripMarker: (value: string) => value,
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

function findInputByPlaceholder(
	tree: unknown,
	placeholder: string,
): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		const props = node.props as Record<string, unknown> | undefined;
		if (found || node.type !== "input" || !props) return;
		if (props.placeholder === placeholder) found = node;
	});
	return found;
}

describe("GitPanelView", () => {
	beforeEach(() => {
		vi.resetModules();
		useCallbackMock.mockReset();
		useEffectMock.mockReset();
		useMemoMock.mockReset();
		useRefMock.mockReset();
		useStateMock.mockReset();
		useAppStoreMock.mockReset();
		fetchGitDiffMock.mockReset();
		parseUnifiedPatchMock.mockReset();
		isNotGitRepoErrorMock.mockReset();
		buildUnifiedLinesMock.mockReset();

		useCallbackMock.mockImplementation((fn: unknown) => fn);
		useEffectMock.mockImplementation(() => {});
		useMemoMock.mockImplementation((factory: () => unknown) => factory());
		useRefMock.mockReturnValue({ current: null });
		isNotGitRepoErrorMock.mockReturnValue(false);
		buildUnifiedLinesMock.mockReturnValue([]);
		parseUnifiedPatchMock.mockReturnValue([
			{
				path: "src/a.ts",
				status: "modified",
				additions: 1,
				deletions: 1,
				hunks: [],
			},
		]);
	});

	it("switches to unified mode and triggers refresh load", async () => {
		const setLoading = vi.fn();
		const setError = vi.fn();
		const setFiles = vi.fn();
		const setUpdatedAt = vi.fn();
		const setViewMode = vi.fn();
		const state = { workspaceId: "w1" };
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		useStateMock
			.mockReturnValueOnce([
				[
					{
						path: "src/a.ts",
						status: "modified",
						additions: 1,
						deletions: 1,
						hunks: [],
					},
				],
				setFiles,
			])
			.mockReturnValueOnce([false, setLoading])
			.mockReturnValueOnce([null, setError])
			.mockReturnValueOnce(["12:00:00", setUpdatedAt])
			.mockReturnValueOnce(["__all__", vi.fn()])
			.mockReturnValueOnce([{}, vi.fn()])
			.mockReturnValueOnce([{}, vi.fn()])
			.mockReturnValueOnce(["split", setViewMode])
			.mockReturnValueOnce(["", vi.fn()])
			.mockReturnValueOnce([{}, vi.fn()]);
		fetchGitDiffMock.mockResolvedValue({ patch: "@@" });

		const { GitPanelView } = await import("../components/GitPanelView");
		const tree = GitPanelView();

		const unifiedBtn = findButtonByText(tree, "Unified");
		expect(unifiedBtn).toBeTruthy();
		(unifiedBtn?.props as { onClick: () => void }).onClick();
		expect(setViewMode).toHaveBeenCalledWith("unified");

		const refreshBtn = findButtonByAriaLabel(tree, "Refresh");
		expect(refreshBtn).toBeTruthy();
		(refreshBtn?.props as { onClick: () => void }).onClick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(fetchGitDiffMock).toHaveBeenCalledWith("w1", true);
		expect(setLoading).toHaveBeenCalledWith(true);
	});

	it("shows workspace not registered error when workspaceId is missing", async () => {
		const setFiles = vi.fn();
		const setError = vi.fn();
		const state = { workspaceId: null };
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		useStateMock
			.mockReturnValueOnce([[], setFiles])
			.mockReturnValueOnce([false, vi.fn()])
			.mockReturnValueOnce([null, setError])
			.mockReturnValueOnce([null, vi.fn()])
			.mockReturnValueOnce(["__all__", vi.fn()])
			.mockReturnValueOnce([{}, vi.fn()])
			.mockReturnValueOnce([{}, vi.fn()])
			.mockReturnValueOnce(["split", vi.fn()])
			.mockReturnValueOnce(["", vi.fn()])
			.mockReturnValueOnce([{}, vi.fn()]);

		const { GitPanelView } = await import("../components/GitPanelView");
		const tree = GitPanelView();
		const refreshBtn = findButtonByAriaLabel(tree, "Refresh");
		expect(refreshBtn).toBeTruthy();
		(refreshBtn?.props as { onClick: () => void }).onClick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(fetchGitDiffMock).not.toHaveBeenCalled();
		expect(setFiles).toHaveBeenCalledWith([]);
		expect(setError).toHaveBeenCalledWith("Workspace is not registered yet.");
	});

	it("maps not-git-repo refresh errors and updates file filter input", async () => {
		const setError = vi.fn();
		const setFileFilter = vi.fn();
		const state = { workspaceId: "w2" };
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		useStateMock
			.mockReturnValueOnce([
				[
					{
						path: "src/a.ts",
						status: "modified",
						additions: 1,
						deletions: 1,
						hunks: [],
					},
				],
				vi.fn(),
			])
			.mockReturnValueOnce([false, vi.fn()])
			.mockReturnValueOnce([null, setError])
			.mockReturnValueOnce([null, vi.fn()])
			.mockReturnValueOnce(["__all__", vi.fn()])
			.mockReturnValueOnce([{}, vi.fn()])
			.mockReturnValueOnce([{}, vi.fn()])
			.mockReturnValueOnce(["split", vi.fn()])
			.mockReturnValueOnce(["", setFileFilter])
			.mockReturnValueOnce([{}, vi.fn()]);

		isNotGitRepoErrorMock.mockReturnValue(true);
		fetchGitDiffMock.mockRejectedValue(new Error("not a repo"));

		const { GitPanelView } = await import("../components/GitPanelView");
		const tree = GitPanelView();

		const filterInput = findInputByPlaceholder(tree, "Filter files…");
		expect(filterInput).toBeTruthy();
		(
			filterInput?.props as {
				onChange: (event: { target: { value: string } }) => void;
			}
		).onChange({
			target: { value: "src/" },
		});
		expect(setFileFilter).toHaveBeenCalledWith("src/");

		const refreshBtn = findButtonByAriaLabel(tree, "Refresh");
		expect(refreshBtn).toBeTruthy();
		(refreshBtn?.props as { onClick: () => void }).onClick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(setError).toHaveBeenCalledWith(
			"This workspace is not a Git repository.",
		);
	});

	it("renders empty state and toggles collapse-all on visible files", async () => {
		const setCollapsedFileKeys = vi.fn();
		const state = { workspaceId: "w3" };
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		useStateMock
			.mockReturnValueOnce([[], vi.fn()]) // files
			.mockReturnValueOnce([false, vi.fn()]) // loading
			.mockReturnValueOnce([null, vi.fn()]) // error
			.mockReturnValueOnce([null, vi.fn()]) // updatedAt
			.mockReturnValueOnce(["__all__", vi.fn()]) // selectedFileKey
			.mockReturnValueOnce([{ "src/a.ts::0": false }, setCollapsedFileKeys]) // collapsedFileKeys
			.mockReturnValueOnce([{}, vi.fn()]) // collapsedHunkKeys
			.mockReturnValueOnce(["split", vi.fn()]) // viewMode
			.mockReturnValueOnce(["", vi.fn()]) // fileFilter
			.mockReturnValueOnce([{}, vi.fn()]); // unifiedContentByPath

		const { GitPanelView } = await import("../components/GitPanelView");
		const tree = GitPanelView();
		expect(textOf(tree)).toContain("No local changes.");

		const collapseAllBtn = findButtonByAriaLabel(tree, "Collapse all");
		expect(collapseAllBtn).toBeTruthy();
		(collapseAllBtn?.props as { onClick: () => void }).onClick();
		expect(setCollapsedFileKeys).toHaveBeenCalledTimes(1);
	});
});
