import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useEffectMock,
	useRefMock,
	bootstrapMock,
	daemonWsConnectMock,
	daemonWsDisconnectMock,
	onDaemonWsReconnectMock,
	onAgentActivityEventMock,
	mergeBackendWorkspacesMock,
	setAvailableAgentsMock,
	hydrateWorkspaceSessionsMock,
	updateSessionActivityMock,
} = vi.hoisted(() => ({
	useEffectMock: vi.fn(),
	useRefMock: vi.fn(),
	bootstrapMock: vi.fn(),
	daemonWsConnectMock: vi.fn(),
	daemonWsDisconnectMock: vi.fn(),
	onDaemonWsReconnectMock: vi.fn(),
	onAgentActivityEventMock: vi.fn(),
	mergeBackendWorkspacesMock: vi.fn(),
	setAvailableAgentsMock: vi.fn(),
	hydrateWorkspaceSessionsMock: vi.fn(),
	updateSessionActivityMock: vi.fn(),
}));

vi.mock("react", () => ({
	useEffect: useEffectMock,
	useRef: useRefMock,
}));

vi.mock("../../lib/daemon/rest", () => ({
	bootstrap: bootstrapMock,
}));

vi.mock("../../lib/daemon/ws", () => ({
	daemonWsConnect: daemonWsConnectMock,
	daemonWsDisconnect: daemonWsDisconnectMock,
	onDaemonWsReconnect: onDaemonWsReconnectMock,
	onAgentActivityEvent: onAgentActivityEventMock,
}));

vi.mock("../../stores/app-store", async () => {
	const actual = await vi.importActual<typeof import("../../stores/app-store")>(
		"../../stores/app-store",
	);
	return {
		...actual,
		useAppStore: (
			selector: (state: {
				token: string;
				daemonConnected: boolean;
				hydrateWorkspaceSessions: typeof hydrateWorkspaceSessionsMock;
				mergeBackendWorkspaces: typeof mergeBackendWorkspacesMock;
				setAvailableAgents: typeof setAvailableAgentsMock;
				updateSessionActivity: typeof updateSessionActivityMock;
			}) => unknown,
		) =>
			selector({
				token: "tok",
				daemonConnected: false,
				hydrateWorkspaceSessions: hydrateWorkspaceSessionsMock,
				mergeBackendWorkspaces: mergeBackendWorkspacesMock,
				setAvailableAgents: setAvailableAgentsMock,
				updateSessionActivity: updateSessionActivityMock,
			}),
	};
});

describe("useDaemon", () => {
	beforeEach(() => {
		vi.resetModules();
		useRefMock.mockReset();
		useEffectMock.mockReset();
		bootstrapMock.mockReset();
		daemonWsConnectMock.mockReset();
		daemonWsDisconnectMock.mockReset();
		onDaemonWsReconnectMock.mockReset();
		onAgentActivityEventMock.mockReset();
		mergeBackendWorkspacesMock.mockReset();
		setAvailableAgentsMock.mockReset();
		hydrateWorkspaceSessionsMock.mockReset();
		updateSessionActivityMock.mockReset();
		useRefMock.mockImplementation((value: unknown) => ({ current: value }));
		useEffectMock.mockImplementation((fn: () => undefined | (() => void)) => {
			fn();
		});
		onDaemonWsReconnectMock.mockImplementation(() => () => {});
		onAgentActivityEventMock.mockImplementation(() => () => {});
	});

	it("connects daemon ws and handles reconnect hydration", async () => {
		let reconnectCb: (() => void) | null = null;
		onDaemonWsReconnectMock.mockImplementation((cb: () => void) => {
			reconnectCb = cb;
			return () => {};
		});
		bootstrapMock.mockResolvedValue({
			workspaces: [
				{
					id: "w1",
					path: "/repo",
					name: "repo",
					pinned: false,
					icon: null,
					sessions: [
						{
							session_id: "s1",
							agent_type: "claude_code",
							workspace_id: "w1",
							status: "running",
							created_at: "2026-01-01T00:00:00Z",
						},
					],
				},
			],
			available_agents: [{ agent_type: "claude_code", installed: true }],
		});
		const { useDaemon } = await import("../useDaemon");
		useDaemon();
		expect(daemonWsConnectMock).toHaveBeenCalledTimes(1);
		if (!reconnectCb) throw new Error("missing reconnect callback");
		await (reconnectCb as () => void)();
		expect(mergeBackendWorkspacesMock).toHaveBeenCalled();
		expect(setAvailableAgentsMock).toHaveBeenCalled();
		expect(hydrateWorkspaceSessionsMock).toHaveBeenCalled();
	});

	it("validates activity payload before updating store", async () => {
		let activityCb: ((payload: unknown) => void) | null = null;
		onAgentActivityEventMock.mockImplementation(
			(cb: (payload: unknown) => void) => {
				activityCb = cb;
				return () => {};
			},
		);
		const { useDaemon } = await import("../useDaemon");
		useDaemon();
		if (!activityCb) throw new Error("missing activity callback");
		const cb = activityCb as (payload: unknown) => void;

		cb({ session_id: 1, activity: {} });
		cb({
			session_id: "s1",
			activity: { phase: "bad", updated_at: "x" },
		});
		cb({
			session_id: "s1",
			activity: {
				phase: "processing",
				updated_at: "2026-01-01T00:00:00Z",
				is_idle: true,
				last_input_at: null,
				last_output_at: null,
				reason: "test",
			},
		});
		expect(updateSessionActivityMock).toHaveBeenCalledTimes(1);
		expect(updateSessionActivityMock).toHaveBeenCalledWith(
			"s1",
			expect.objectContaining({
				phase: "processing",
				is_idle: true,
				reason: "test",
			}),
		);
	});
});
