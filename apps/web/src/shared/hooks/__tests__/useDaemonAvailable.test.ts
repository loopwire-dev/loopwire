import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useEffectMock, useStateMock, getDaemonUrlMock, discoverDaemonMock } =
	vi.hoisted(() => ({
		useEffectMock: vi.fn(),
		useStateMock: vi.fn(),
		getDaemonUrlMock: vi.fn(),
		discoverDaemonMock: vi.fn(),
	}));

vi.mock("react", () => ({
	useEffect: useEffectMock,
	useState: useStateMock,
}));

vi.mock("../../lib/runtime/config", () => ({
	getDaemonUrl: getDaemonUrlMock,
}));

vi.mock("../../lib/network/discovery", () => ({
	discoverDaemon: discoverDaemonMock,
}));

class MockWebSocket {
	static instances: MockWebSocket[] = [];
	static throwOnConstruct = false;
	url: string;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;

	constructor(url: string) {
		if (MockWebSocket.throwOnConstruct) {
			throw new Error("socket construct failed");
		}
		this.url = url;
		MockWebSocket.instances.push(this);
	}

	close() {
		this.onclose?.();
	}
}

describe("useDaemonAvailable", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetModules();
		MockWebSocket.instances = [];
		MockWebSocket.throwOnConstruct = false;
		getDaemonUrlMock.mockReset();
		discoverDaemonMock.mockReset();
		useEffectMock.mockReset();
		useStateMock.mockReset();
		useEffectMock.mockImplementation((fn: () => undefined | (() => void)) => {
			fn();
		});
		useStateMock.mockImplementation((initial: unknown) => [initial, vi.fn()]);
		(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
			MockWebSocket;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("opens probe socket from existing daemon URL", async () => {
		getDaemonUrlMock.mockReturnValue("http://localhost:9400");
		const setAvailable = vi.fn();
		useStateMock.mockReturnValue([null, setAvailable]);

		const { useDaemonAvailable } = await import("../useDaemonAvailable");
		useDaemonAvailable();
		const ws = MockWebSocket.instances[0];
		if (!ws) throw new Error("missing probe socket");
		expect(ws.url).toBe("ws://localhost:9400/api/v1/ws?probe=1");
		ws.onopen?.();
		expect(setAvailable).toHaveBeenCalledWith(true);
		ws.onmessage?.({ data: JSON.stringify({ type: "daemon:alive" }) });
		expect(setAvailable).toHaveBeenLastCalledWith(true);
	});

	it("uses discovery when allowed and no configured URL", async () => {
		getDaemonUrlMock.mockReturnValue("");
		discoverDaemonMock.mockResolvedValue("http://192.168.1.22:9400");
		const setAvailable = vi.fn();
		useStateMock.mockReturnValue([null, setAvailable]);

		const { useDaemonAvailable } = await import("../useDaemonAvailable");
		useDaemonAvailable({ allowDiscovery: true });
		await Promise.resolve();
		expect(discoverDaemonMock).toHaveBeenCalledTimes(1);
		const ws = MockWebSocket.instances[0];
		if (!ws) throw new Error("missing probe socket");
		expect(ws.url).toContain("ws://192.168.1.22:9400/api/v1/ws?probe=1");
	});

	it("marks unavailable when neither configured URL nor discovery exists", async () => {
		getDaemonUrlMock.mockReturnValue("");
		discoverDaemonMock.mockResolvedValue(null);
		const setAvailable = vi.fn();
		useStateMock.mockReturnValue([null, setAvailable]);

		const { useDaemonAvailable } = await import("../useDaemonAvailable");
		useDaemonAvailable({ allowDiscovery: true });
		await Promise.resolve();
		expect(setAvailable).toHaveBeenCalledWith(false);
	});

	it("marks unavailable when probe socket cannot be created", async () => {
		getDaemonUrlMock.mockReturnValue("http://localhost:9400");
		MockWebSocket.throwOnConstruct = true;
		const setAvailable = vi.fn();
		useStateMock.mockReturnValue([null, setAvailable]);

		const { useDaemonAvailable } = await import("../useDaemonAvailable");
		useDaemonAvailable();

		expect(setAvailable).toHaveBeenCalledWith(false);
	});

	it("reconnects after socket close and re-opens probe", async () => {
		getDaemonUrlMock.mockReturnValue("http://localhost:9400");
		const setAvailable = vi.fn();
		useStateMock.mockReturnValue([null, setAvailable]);

		const { useDaemonAvailable } = await import("../useDaemonAvailable");
		useDaemonAvailable();
		const ws = MockWebSocket.instances[0];
		if (!ws) throw new Error("missing initial probe socket");

		ws.onopen?.();
		ws.onclose?.();
		expect(setAvailable).toHaveBeenCalledWith(false);
		expect(MockWebSocket.instances).toHaveLength(1);

		vi.advanceTimersByTime(2000);
		await Promise.resolve();
		expect(MockWebSocket.instances).toHaveLength(2);
	});

	it("ignores malformed/non-heartbeat messages and marks down on heartbeat timeout", async () => {
		getDaemonUrlMock.mockReturnValue("http://localhost:9400");
		const setAvailable = vi.fn();
		useStateMock.mockReturnValue([null, setAvailable]);

		const { useDaemonAvailable } = await import("../useDaemonAvailable");
		useDaemonAvailable();
		const ws = MockWebSocket.instances[0];
		if (!ws) throw new Error("missing probe socket");

		ws.onopen?.();
		ws.onmessage?.({ data: new ArrayBuffer(8) });
		ws.onmessage?.({ data: "{invalid json" });
		ws.onmessage?.({ data: JSON.stringify({ type: "other" }) });
		expect(setAvailable).not.toHaveBeenCalledWith(false);

		vi.advanceTimersByTime(9000);
		expect(setAvailable).toHaveBeenCalledWith(false);
	});
});
