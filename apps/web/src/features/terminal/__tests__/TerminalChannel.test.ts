import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/lib/runtime/config", () => ({
	getWsBase: () => "ws://daemon.local",
}));

class MockWebSocket {
	static OPEN = 1;
	static CLOSED = 3;
	static instances: MockWebSocket[] = [];

	readyState = 0;
	url: string;
	binaryType = "";
	sent: Array<string | Uint8Array> = [];
	onopen: (() => void) | null = null;
	onclose: ((event: { code: number; reason: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;

	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
	}

	send(msg: string | Uint8Array) {
		this.sent.push(msg);
	}

	close() {
		this.readyState = MockWebSocket.CLOSED;
	}
}

describe("TerminalChannel", () => {
	beforeEach(() => {
		MockWebSocket.instances = [];
		(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
			MockWebSocket;
	});

	it("connects with token/session params and reports connection", async () => {
		const { TerminalChannel } = await import("../channel/TerminalChannel");
		const onConnectionChange = vi.fn();
		const channel = new TerminalChannel({
			sessionId: "session/1",
			token: "t k",
			initialCols: 100,
			initialRows: 30,
			handlers: {
				onConnectionChange,
				onReady: vi.fn(),
				onOutput: vi.fn(),
				onExit: vi.fn(),
				onError: vi.fn(),
			},
		});
		channel.connect();

		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		expect(socket.url).toContain("/api/v1/term/session%2F1?");
		expect(socket.url).toContain("token=t+k");
		expect(socket.url).toContain("cols=100");
		expect(socket.url).toContain("rows=30");

		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();
		expect(onConnectionChange).toHaveBeenCalledWith(true);
	});

	it("sends utf8/bytes/resize only when valid and connected", async () => {
		const { TerminalChannel } = await import("../channel/TerminalChannel");
		const handlers = {
			onConnectionChange: vi.fn(),
			onReady: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onError: vi.fn(),
		};
		const channel = new TerminalChannel({
			sessionId: "sid",
			token: "token",
			handlers,
		});
		channel.connect();

		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");

		expect(channel.sendInputUtf8("hello")).toBe(false);
		expect(channel.sendResize(0, 10)).toBe(false);

		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();
		expect(channel.sendInputUtf8("hello")).toBe(true);
		expect(channel.sendResize(80, 24)).toBe(true);
		expect(channel.sendInputBytes(new Uint8Array([1, 2]))).toBe(true);
		expect(socket.sent.length).toBe(3);
		expect(String(socket.sent[0])).toContain("input_utf8");
		expect(String(socket.sent[1])).toContain("resize");
		const bytes = socket.sent[2] as Uint8Array;
		expect(bytes[0]).toBe(1);
		expect(bytes.slice(1)).toEqual(new Uint8Array([1, 2]));
	});

	it("handles ready/exit/error and malformed frames", async () => {
		const { TerminalChannel } = await import("../channel/TerminalChannel");
		const handlers = {
			onConnectionChange: vi.fn(),
			onReady: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
			onError: vi.fn(),
		};
		const channel = new TerminalChannel({
			sessionId: "sid",
			token: "token",
			handlers,
		});
		channel.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();

		socket.onmessage?.({ data: '{"bad":json}' });
		socket.onmessage?.({ data: JSON.stringify({}) });
		socket.onmessage?.({
			data: JSON.stringify({ type: "ready", session_id: "sid" }),
		});
		socket.onmessage?.({
			data: JSON.stringify({ type: "error", code: "X", message: "boom" }),
		});
		socket.onmessage?.({
			data: JSON.stringify({ type: "exit", session_id: "sid", exit_code: 2 }),
		});
		socket.onmessage?.({ data: new Uint8Array([1, 2, 3]).buffer });

		expect(handlers.onReady).toHaveBeenCalledWith({ sessionId: "sid" });
		expect(handlers.onExit).toHaveBeenCalledWith(2);
		expect(handlers.onError).toHaveBeenCalled();
	});

	it("disconnects and marks not connected", async () => {
		const { TerminalChannel } = await import("../channel/TerminalChannel");
		const onConnectionChange = vi.fn();
		const channel = new TerminalChannel({
			sessionId: "sid",
			token: "token",
			handlers: {
				onConnectionChange,
				onReady: vi.fn(),
				onOutput: vi.fn(),
				onExit: vi.fn(),
				onError: vi.fn(),
			},
		});
		channel.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("missing socket");
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();

		channel.disconnect();
		expect(onConnectionChange).toHaveBeenCalledWith(false);
		expect(socket.readyState).toBe(MockWebSocket.CLOSED);
	});
});
