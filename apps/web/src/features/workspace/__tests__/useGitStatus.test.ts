import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useStateMock,
	useRefMock,
	useEffectMock,
	useMemoMock,
	gitStatusMock,
	isNotGitRepoErrorMock,
	subscribeGitStatusMock,
	unsubscribeGitStatusMock,
	onGitStatusEventMock,
	onDaemonWsReconnectMock,
} = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useRefMock: vi.fn(),
	useEffectMock: vi.fn(),
	useMemoMock: vi.fn(),
	gitStatusMock: vi.fn(),
	isNotGitRepoErrorMock: vi.fn(),
	subscribeGitStatusMock: vi.fn(),
	unsubscribeGitStatusMock: vi.fn(),
	onGitStatusEventMock: vi.fn(),
	onDaemonWsReconnectMock: vi.fn(),
}));

vi.mock("react", () => ({
	useState: useStateMock,
	useRef: useRefMock,
	useEffect: useEffectMock,
	useMemo: useMemoMock,
}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	gitStatus: gitStatusMock,
	isNotGitRepoError: isNotGitRepoErrorMock,
}));

vi.mock("../../../shared/lib/daemon/ws", () => ({
	subscribeGitStatus: subscribeGitStatusMock,
	unsubscribeGitStatus: unsubscribeGitStatusMock,
	onGitStatusEvent: onGitStatusEventMock,
	onDaemonWsReconnect: onDaemonWsReconnectMock,
}));

function mockStates(values: unknown[]) {
	const setters = [vi.fn(), vi.fn()];
	let idx = 0;
	useStateMock.mockImplementation((initial: unknown) => {
		const value =
			idx < values.length
				? values[idx]
				: typeof initial === "function"
					? (initial as () => unknown)()
					: initial;
		const setter = setters[idx] ?? vi.fn();
		idx += 1;
		return [value, setter];
	});
	return { setData: setters[0], setLoaded: setters[1] };
}

describe("useGitStatus", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useRefMock.mockReset();
		useEffectMock.mockReset();
		useMemoMock.mockReset();
		gitStatusMock.mockReset();
		isNotGitRepoErrorMock.mockReset();
		subscribeGitStatusMock.mockReset();
		unsubscribeGitStatusMock.mockReset();
		onGitStatusEventMock.mockReset();
		onDaemonWsReconnectMock.mockReset();

		useRefMock.mockImplementation((value: unknown) => ({ current: value }));
		useMemoMock.mockImplementation((fn: () => unknown) => fn());
		useEffectMock.mockImplementation((fn: () => undefined | (() => void)) =>
			fn(),
		);
		onGitStatusEventMock.mockImplementation(() => () => {});
		onDaemonWsReconnectMock.mockImplementation(() => () => {});
	});

	it("returns empty status when workspaceId is null", async () => {
		mockStates([null, false]);
		const { useGitStatus } = await import("../hooks/useGitStatus");
		const status = useGitStatus(null);

		expect(status.loaded).toBe(false);
		expect(status.isGitRepo).toBe(false);
		expect(status.getFile("a")).toBeNull();
		expect(status.getFolder("src")).toBe("clean");
		expect(status.isIgnored("node_modules/a")).toBe(false);
	});

	it("fetches, subscribes, and unsubscribes for workspace", async () => {
		const state = mockStates([null, false]);
		const offStatus = vi.fn();
		const offReconnect = vi.fn();
		let reconnectHandler: (() => void) | null = null;

		gitStatusMock.mockResolvedValue({
			files: {},
			ignored_dirs: [],
		});
		onGitStatusEventMock.mockImplementation(() => offStatus);
		onDaemonWsReconnectMock.mockImplementation((cb: () => void) => {
			reconnectHandler = cb;
			return offReconnect;
		});

		const { useGitStatus } = await import("../hooks/useGitStatus");
		useGitStatus("w1");
		await vi.waitFor(() => {
			expect(state.setLoaded).toHaveBeenCalledWith(true);
		});

		expect(gitStatusMock).toHaveBeenCalledWith("w1");
		expect(subscribeGitStatusMock).toHaveBeenCalledWith("w1");
		expect(state.setData).toHaveBeenCalledWith({ files: {}, ignored_dirs: [] });

		if (!reconnectHandler) throw new Error("missing reconnect handler");
		(reconnectHandler as () => void)();
		expect(subscribeGitStatusMock).toHaveBeenCalledTimes(2);

		// cleanup returned by effect mock
		const cleanup = useEffectMock.mock.results.at(-1)?.value as () => void;
		cleanup();
		expect(offStatus).toHaveBeenCalledTimes(1);
		expect(offReconnect).toHaveBeenCalledTimes(1);
		expect(unsubscribeGitStatusMock).toHaveBeenCalledWith("w1");
	});

	it("maps file and folder statuses and ignored paths", async () => {
		gitStatusMock.mockResolvedValue({ files: {}, ignored_dirs: [] });
		mockStates([
			{
				files: {
					"src/a.ts": { status: "modified", additions: 3, deletions: 1 },
					"src/nested/b.ts": { status: "added" },
					"docs/readme.md": { status: "deleted" },
				},
				ignored_dirs: ["node_modules", ".git"],
			},
			true,
		]);

		const { useGitStatus } = await import("../hooks/useGitStatus");
		const status = useGitStatus("w1");

		expect(status.loaded).toBe(true);
		expect(status.isGitRepo).toBe(true);
		expect(status.getFile("src/a.ts")).toEqual({
			status: "modified",
			additions: 3,
			deletions: 1,
		});
		expect(status.getFolder("src")).toBe("modified");
		expect(status.getFolder("src/nested")).toBe("added");
		expect(status.getFolder("docs")).toBe("deleted");
		expect(status.getFolder("unknown")).toBe("clean");
		expect(status.isIgnored("node_modules/pkg/x")).toBe(true);
		expect(status.isIgnored("src/a.ts")).toBe(false);
	});

	it("treats non-git repo fetch error as loaded null data", async () => {
		const state = mockStates([null, false]);
		gitStatusMock.mockRejectedValue(new Error("not repo"));
		isNotGitRepoErrorMock.mockReturnValue(true);

		const { useGitStatus } = await import("../hooks/useGitStatus");
		useGitStatus("w1");
		await vi.waitFor(() => {
			expect(isNotGitRepoErrorMock).toHaveBeenCalled();
		});

		expect(state.setData).toHaveBeenCalledWith(null);
		expect(state.setLoaded).toHaveBeenCalledWith(true);
	});
});
