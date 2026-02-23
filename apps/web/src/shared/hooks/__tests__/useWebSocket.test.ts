import { beforeEach, describe, expect, it, vi } from "vitest";

const { useEffectMock, onDaemonWsEventMock } = vi.hoisted(() => ({
	useEffectMock: vi.fn(),
	onDaemonWsEventMock: vi.fn(),
}));

vi.mock("react", () => ({
	useEffect: useEffectMock,
}));

vi.mock("../../lib/daemon/ws", () => ({
	onDaemonWsEvent: onDaemonWsEventMock,
}));

describe("useWebSocket", () => {
	beforeEach(() => {
		useEffectMock.mockReset();
		onDaemonWsEventMock.mockReset();
	});

	it("subscribes daemon ws event and returns cleanup", async () => {
		const cleanup = vi.fn();
		onDaemonWsEventMock.mockReturnValue(cleanup);
		useEffectMock.mockImplementation((fn: () => () => void) => fn());

		const { useWebSocket } = await import("../useWebSocket");
		const handler = vi.fn();
		const returnedCleanup = useWebSocket("terminal:output", handler);

		expect(onDaemonWsEventMock).toHaveBeenCalledWith(
			"terminal:output",
			handler,
		);
		expect(returnedCleanup).toBeUndefined();
		expect(cleanup).not.toHaveBeenCalled();
	});
});
