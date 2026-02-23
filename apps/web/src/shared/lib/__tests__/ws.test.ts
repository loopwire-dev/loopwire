import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setDaemonConnectedMock = vi.fn();
let tokenValue: string | null = null;

vi.mock("../../stores/app-store", () => ({
	useAppStore: {
		getState: () => ({
			token: tokenValue,
			setDaemonConnected: setDaemonConnectedMock,
		}),
	},
}));

vi.mock("../runtime/config", () => ({
	getWsUrl: () => "ws://daemon.test/api/v1/ws",
}));

class MockWebSocket {
	static OPEN = 1;
	static CLOSED = 3;
	static instances: MockWebSocket[] = [];

	readyState = 0;
	url: string;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onclose: ((event: { code: number; reason: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;

	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
	}

	send(msg: string) {
		this.sent.push(msg);
	}

	close() {
		this.readyState = MockWebSocket.CLOSED;
	}
}

describe("ws client", () => {
	beforeEach(() => {
		setDaemonConnectedMock.mockReset();
		tokenValue = null;
		MockWebSocket.instances = [];
		(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
			MockWebSocket;
		vi.stubGlobal("crypto", { randomUUID: () => "req-1" });
		vi.useRealTimers();
	});

	afterEach(async () => {
		const { wsClient } = await import("../network/ws");
		wsClient.disconnect();
	});

	it("skips connect without token", async () => {
		const { wsClient } = await import("../network/ws");
		wsClient.connect();
		expect(MockWebSocket.instances).toHaveLength(0);
	});

	it("connects and flushes queued sends on open", async () => {
		tokenValue = "abc token";
		const { wsClient } = await import("../network/ws");
		wsClient.send("ping", { ok: true });
		wsClient.connect();

		expect(MockWebSocket.instances).toHaveLength(1);
		const socket = MockWebSocket.instances[0];
		expect(socket?.url).toContain("token=abc%20token");

		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();

		expect(setDaemonConnectedMock).toHaveBeenCalledWith(true);
		expect(socket.sent).toHaveLength(1);
		expect(socket.sent[0]).toContain('"type":"ping"');
	});

	it("resolves sendAndWait on matching response envelope", async () => {
		tokenValue = "abc";
		const { wsClient } = await import("../network/ws");
		wsClient.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();

		const promise = wsClient.sendAndWait("hello", { v: 1 });
		socket.onmessage?.({
			data: JSON.stringify({
				version: 1,
				request_id: "req-1",
				type: "hello",
				payload: { ok: true },
				error: null,
			}),
		});
		await expect(promise).resolves.toMatchObject({
			type: "hello",
		});
	});

	it("rejects sendAndWait on timeout", async () => {
		vi.useFakeTimers();
		tokenValue = "abc";
		const { wsClient } = await import("../network/ws");
		wsClient.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();

		const pending = wsClient.sendAndWait("slow", {}, 10);
		vi.advanceTimersByTime(20);
		await expect(pending).rejects.toThrow("Request timed out");
	});

	it("rejects pending request when envelope has error", async () => {
		tokenValue = "abc";
		const { wsClient } = await import("../network/ws");
		wsClient.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();

		const promise = wsClient.sendAndWait("hello", { v: 1 });
		socket.onmessage?.({
			data: JSON.stringify({
				version: 1,
				request_id: "req-1",
				type: "hello",
				payload: {},
				error: { code: "BAD", message: "bad request", retryable: false },
			}),
		});

		await expect(promise).rejects.toThrow("bad request");
	});

	it("calls typed handlers and supports unsubscribe", async () => {
		tokenValue = "abc";
		const { wsClient } = await import("../network/ws");
		const handler = vi.fn();
		const off = wsClient.on("evt", handler);

		wsClient.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();

		const envelope = {
			version: 1,
			request_id: null,
			type: "evt",
			payload: { a: 1 },
			error: null,
		};
		socket.onmessage?.({ data: JSON.stringify(envelope) });
		expect(handler).toHaveBeenCalledWith(envelope);

		off();
		socket.onmessage?.({ data: JSON.stringify(envelope) });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("does not queue send when queueWhenDisconnected is false", async () => {
		tokenValue = "abc";
		const { wsClient } = await import("../network/ws");
		wsClient.send("noqueue", { ok: true }, { queueWhenDisconnected: false });
		wsClient.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();
		expect(socket.sent).toHaveLength(0);
	});

	it("schedules reconnect on close and triggers onReconnect callback", async () => {
		vi.useFakeTimers();
		tokenValue = "abc";
		const { wsClient } = await import("../network/ws");
		const onReconnect = vi.fn();
		wsClient.onReconnect(onReconnect);
		wsClient.connect();
		const first = MockWebSocket.instances[0];
		if (!first) throw new Error("missing socket");
		first.readyState = MockWebSocket.OPEN;
		first.onopen?.();
		expect(onReconnect).toHaveBeenCalledTimes(1);
		expect(wsClient.connected).toBe(true);

		first.onclose?.({ code: 1006, reason: "drop" });
		expect(setDaemonConnectedMock).toHaveBeenCalledWith(false);

		vi.advanceTimersByTime(1000);
		expect(MockWebSocket.instances).toHaveLength(2);
		const second = MockWebSocket.instances[1];
		if (!second) throw new Error("missing reconnect socket");
		second.readyState = MockWebSocket.OPEN;
		second.onopen?.();
		expect(onReconnect).toHaveBeenCalledTimes(2);
	});

	it("disconnect rejects pending requests", async () => {
		tokenValue = "abc";
		const { wsClient } = await import("../network/ws");
		wsClient.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();

		const pending = wsClient.sendAndWait("later", {}, 1000);
		wsClient.disconnect();
		await expect(pending).rejects.toThrow("WebSocket disconnected");
	});

	it("skips reconnect when token is missing after close", async () => {
		vi.useFakeTimers();
		tokenValue = "abc";
		const { wsClient } = await import("../network/ws");
		wsClient.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();

		tokenValue = null;
		socket.onclose?.({ code: 1006, reason: "drop" });
		vi.advanceTimersByTime(2000);
		expect(MockWebSocket.instances).toHaveLength(1);
	});
});
