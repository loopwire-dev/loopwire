import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useStateMock,
	useEffectMock,
	useCallbackMock,
	useRefMock,
	fsBrowseMock,
	fsRootsMock,
} = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useEffectMock: vi.fn(),
	useCallbackMock: vi.fn(),
	useRefMock: vi.fn(),
	fsBrowseMock: vi.fn(),
	fsRootsMock: vi.fn(),
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
	fsBrowse: fsBrowseMock,
	fsRoots: fsRootsMock,
}));

describe("FolderBrowser", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useEffectMock.mockReset();
		useCallbackMock.mockReset();
		useRefMock.mockReset();
		fsBrowseMock.mockReset();
		fsRootsMock.mockReset();

		useEffectMock.mockImplementation(() => {});
		useCallbackMock.mockImplementation((fn: unknown) => fn);
		useRefMock.mockReturnValue({ current: 0 });
	});

	it("calls cancel/select and toggles hidden flag", async () => {
		const setShowHidden = vi.fn();
		const onCancel = vi.fn();
		const onSelect = vi.fn();

		useStateMock
			.mockReturnValueOnce(["/repo", vi.fn()])
			.mockReturnValueOnce([
				[
					{ name: ".git", kind: "directory" },
					{ name: "src", kind: "directory" },
				],
				vi.fn(),
			])
			.mockReturnValueOnce([false, vi.fn()])
			.mockReturnValueOnce([null, vi.fn()])
			.mockReturnValueOnce([false, setShowHidden]);

		const { FolderBrowser } = await import("../components/FolderBrowser");
		const tree = FolderBrowser({ onCancel, onSelect });
		const footer = tree.props.children[2];
		const controls = footer.props.children[1].props.children;
		const cancelBtn = controls[0];
		const selectBtn = controls[1];
		cancelBtn.props.onClick();
		selectBtn.props.onClick();

		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith("/repo");

		const header = tree.props.children[0];
		const hiddenToggle = header.props.children[1].props.children[0];
		hiddenToggle.props.onChange({ target: { checked: true } });
		expect(setShowHidden).toHaveBeenCalledWith(true);
	});

	it("loads roots on mount when initialPath is '~' and supports navigation", async () => {
		let effectCleanup: (() => void) | undefined;
		useEffectMock.mockImplementation((fn: () => unknown) => {
			const result = fn();
			effectCleanup =
				typeof result === "function" ? (result as () => void) : undefined;
		});
		const setEntries = vi.fn();
		const setCurrentPath = vi.fn();
		const setLoading = vi.fn();
		const setError = vi.fn();
		const ref = { current: 0 };
		useRefMock.mockReturnValue(ref);
		useStateMock
			.mockReturnValueOnce(["/repo/work", setCurrentPath])
			.mockReturnValueOnce([
				[
					{ name: "src", kind: "directory" },
					{ name: ".git", kind: "directory" },
				],
				setEntries,
			])
			.mockReturnValueOnce([false, setLoading])
			.mockReturnValueOnce([null, setError])
			.mockReturnValueOnce([false, vi.fn()]);
		fsRootsMock.mockResolvedValue({ roots: ["/", "/repo"] });
		fsBrowseMock.mockResolvedValue([{ name: "apps", kind: "directory" }]);

		const { FolderBrowser } = await import("../components/FolderBrowser");
		FolderBrowser({
			initialPath: "~",
			onCancel: vi.fn(),
			onSelect: vi.fn(),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(fsRootsMock).toHaveBeenCalledTimes(1);
		expect(fsBrowseMock).toHaveBeenCalledWith("/repo");
		expect(setEntries).toHaveBeenCalledWith([
			{ name: "apps", kind: "directory" },
		]);
		expect(setCurrentPath).toHaveBeenCalledWith("/repo");
		expect(setLoading).toHaveBeenCalledWith(true);
		expect(setLoading).toHaveBeenCalledWith(false);
		expect(setError).toHaveBeenCalledWith(null);

		if (effectCleanup) effectCleanup();
		expect(ref.current).toBe(2);
	});
});
