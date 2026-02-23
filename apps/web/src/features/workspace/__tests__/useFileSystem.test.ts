import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useStateMock,
	useRefMock,
	useEffectMock,
	useCallbackMock,
	fsRootsMock,
	fsListMock,
	fsReadMock,
	useAppStoreMock,
} = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useRefMock: vi.fn(),
	useEffectMock: vi.fn(),
	useCallbackMock: vi.fn(),
	fsRootsMock: vi.fn(),
	fsListMock: vi.fn(),
	fsReadMock: vi.fn(),
	useAppStoreMock: vi.fn(),
}));

let workspaceIdValue: string | null = "w1";

vi.mock("react", () => ({
	useState: useStateMock,
	useRef: useRefMock,
	useEffect: useEffectMock,
	useCallback: useCallbackMock,
}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	fsRoots: fsRootsMock,
	fsList: fsListMock,
	fsRead: fsReadMock,
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (s: { workspaceId: string | null }) => unknown) =>
		useAppStoreMock(selector),
}));

function mockHookState(values: unknown[]) {
	const setters = [vi.fn(), vi.fn(), vi.fn()];
	let idx = 0;
	useStateMock.mockImplementation((initial: unknown) => {
		const value = idx < values.length ? values[idx] : initial;
		const setter = setters[idx] ?? vi.fn();
		idx += 1;
		return [value, setter];
	});
	return {
		setEntries: setters[0],
		setLoading: setters[1],
		setError: setters[2],
	};
}

describe("useFileSystem", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useRefMock.mockReset();
		useEffectMock.mockReset();
		useCallbackMock.mockReset();
		fsRootsMock.mockReset();
		fsListMock.mockReset();
		fsReadMock.mockReset();
		useAppStoreMock.mockReset();
		workspaceIdValue = "w1";

		useRefMock.mockImplementation((value: unknown) => ({ current: value }));
		useCallbackMock.mockImplementation((fn: unknown) => fn);
		useEffectMock.mockImplementation((fn: () => undefined | (() => void)) =>
			fn(),
		);
		useAppStoreMock.mockImplementation(
			(selector: (s: { workspaceId: string | null }) => unknown) =>
				selector({ workspaceId: workspaceIdValue }),
		);
	});

	it("loads initial directory for workspace on mount", async () => {
		const state = mockHookState([[], false, null]);
		const entries = [
			{ name: "src", kind: "directory", size: null, modified: 1 },
		];
		fsListMock.mockResolvedValue(entries);

		const { useFileSystem } = await import("../hooks/useFileSystem");
		useFileSystem();
		await vi.waitFor(() => {
			expect(state.setLoading).toHaveBeenCalledWith(false);
		});

		expect(fsListMock).toHaveBeenCalledWith("w1", ".");
		expect(state.setLoading).toHaveBeenCalledWith(true);
		expect(state.setEntries).toHaveBeenCalledWith(entries);
	});

	it("listDirectory updates entries and handles errors", async () => {
		const state = mockHookState([[], false, null]);
		fsListMock
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ name: "a.ts", kind: "file", size: 2, modified: 9 },
			])
			.mockRejectedValueOnce(new Error("nope"));

		const { useFileSystem } = await import("../hooks/useFileSystem");
		const hook = useFileSystem();
		await Promise.resolve();
		await hook.listDirectory("src");
		expect(fsListMock).toHaveBeenCalledWith("w1", "src");
		expect(state.setEntries).toHaveBeenCalledWith([
			{ name: "a.ts", kind: "file", size: 2, modified: 9 },
		]);

		await hook.listDirectory("bad");
		expect(state.setError).toHaveBeenCalledWith("nope");
	});

	it("fetchRoots returns daemon roots", async () => {
		mockHookState([[], false, null]);
		fsListMock.mockResolvedValue([]);
		fsRootsMock.mockResolvedValue({ roots: ["/", "/tmp"] });

		const { useFileSystem } = await import("../hooks/useFileSystem");
		const hook = useFileSystem();
		await Promise.resolve();
		await expect(hook.fetchRoots()).resolves.toEqual(["/", "/tmp"]);
	});

	it("readFile calls daemon fsRead only when workspace exists", async () => {
		mockHookState([[], false, null]);
		fsListMock.mockResolvedValue([]);
		fsReadMock.mockResolvedValue({ content: "x" });

		const { useFileSystem } = await import("../hooks/useFileSystem");
		const hook = useFileSystem();
		await Promise.resolve();
		await hook.readFile("file.txt");
		expect(fsReadMock).toHaveBeenCalledWith("w1", "file.txt");

		workspaceIdValue = null;
		const second = useFileSystem();
		await expect(second.readFile("file.txt")).resolves.toBeNull();
	});
});
