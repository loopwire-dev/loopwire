import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectMock, disconnectMock, sendMock, onReconnectMock, onMock } =
	vi.hoisted(() => ({
		connectMock: vi.fn(),
		disconnectMock: vi.fn(),
		sendMock: vi.fn(),
		onReconnectMock: vi.fn(),
		onMock: vi.fn(),
	}));

vi.mock("../../network/ws", () => ({
	wsClient: {
		connect: connectMock,
		disconnect: disconnectMock,
		send: sendMock,
		onReconnect: onReconnectMock,
		on: onMock,
	},
}));

import {
	daemonWsConnect,
	daemonWsDisconnect,
	onAgentActivityEvent,
	onDaemonWsEvent,
	onDaemonWsReconnect,
	onGitStatusEvent,
	subscribeGitStatus,
	unsubscribeGitStatus,
} from "../ws";

describe("daemon ws wrappers", () => {
	beforeEach(() => {
		connectMock.mockReset();
		disconnectMock.mockReset();
		sendMock.mockReset();
		onReconnectMock.mockReset();
		onMock.mockReset();
	});

	it("connects and disconnects via shared ws client", () => {
		daemonWsConnect();
		daemonWsDisconnect();
		expect(connectMock).toHaveBeenCalledTimes(1);
		expect(disconnectMock).toHaveBeenCalledTimes(1);
	});

	it("registers reconnect and event handlers", () => {
		const cb = vi.fn();
		onDaemonWsReconnect(cb);
		onDaemonWsEvent("foo", cb);
		expect(onReconnectMock).toHaveBeenCalledWith(cb);
		expect(onMock).toHaveBeenCalledWith("foo", cb);
	});

	it("subscribes and unsubscribes git status with expected options", () => {
		subscribeGitStatus("wid");
		unsubscribeGitStatus("wid");
		expect(sendMock).toHaveBeenNthCalledWith(1, "git:subscribe", {
			workspace_id: "wid",
		});
		expect(sendMock).toHaveBeenNthCalledWith(
			2,
			"git:unsubscribe",
			{ workspace_id: "wid" },
			{ queueWhenDisconnected: false },
		);
	});

	it("validates agent activity payload shape", () => {
		let subscribedHandler: ((envelope: { payload: unknown }) => void) | null =
			null;
		onMock.mockImplementation((type, handler) => {
			if (type === "agent:activity") {
				subscribedHandler = handler as (envelope: { payload: unknown }) => void;
			}
			return () => {};
		});
		const handler = vi.fn();
		onAgentActivityEvent(handler);
		if (!subscribedHandler) throw new Error("missing subscribed handler");
		const callHandler = subscribedHandler as (envelope: {
			payload: unknown;
		}) => void;

		callHandler({ payload: null });
		callHandler({ payload: {} });
		callHandler({
			payload: { session_id: "s1", activity: { phase: "unknown" } },
		});

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({
			session_id: "s1",
			activity: { phase: "unknown" },
		});
	});

	it("validates git status payload shape", () => {
		let subscribedHandler: ((envelope: { payload: unknown }) => void) | null =
			null;
		onMock.mockImplementation((type, handler) => {
			if (type === "git:status") {
				subscribedHandler = handler as (envelope: { payload: unknown }) => void;
			}
			return () => {};
		});
		const handler = vi.fn();
		onGitStatusEvent(handler);
		if (!subscribedHandler) throw new Error("missing subscribed handler");
		const callHandler = subscribedHandler as (envelope: {
			payload: unknown;
		}) => void;

		callHandler({ payload: { workspace_id: "w", files: {} } });
		callHandler({
			payload: { workspace_id: "w", files: {}, ignored_dirs: [] },
		});
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({
			workspace_id: "w",
			files: {},
			ignored_dirs: [],
		});
	});
});
