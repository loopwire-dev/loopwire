import { describe, expect, it, vi } from "vitest";
import { setupTerminalChannel } from "../channel/setupTerminalChannel";

class MockChannel {
	static created: MockChannel[] = [];
	options: ConstructorParameters<typeof MockChannel>[0];
	connect = vi.fn();
	disconnect = vi.fn();
	sendResize = vi.fn();

	constructor(options: {
		sessionId: string;
		token: string;
		initialCols?: number;
		initialRows?: number;
		handlers: object;
	}) {
		this.options = options;
		MockChannel.created.push(this);
	}
}

function makeTerminal(cols = 80, rows = 24) {
	return {
		cols,
		rows,
		options: {},
		reset: vi.fn(),
		focus: vi.fn(),
		writeln: vi.fn(),
	};
}

describe("setupTerminalChannel", () => {
	it("returns null when terminal or session is missing", () => {
		const cleanup = setupTerminalChannel({
			sessionId: "",
			token: "tok",
			terminal: null,
			paging: {
				reset: vi.fn(),
				checkSequence: vi.fn(),
				processFrame: vi.fn(),
			} as never,
			gotFirstOutputRef: { current: false },
			channelRef: { current: null },
			setIsLoading: vi.fn(),
			setConnectionError: vi.fn(),
			ChannelClass: MockChannel as never,
		});
		expect(cleanup).toBeNull();
		expect(MockChannel.created).toHaveLength(0);
	});

	it("sets auth error when token is missing", () => {
		const setIsLoading = vi.fn();
		const setConnectionError = vi.fn();
		const cleanup = setupTerminalChannel({
			sessionId: "s1",
			token: null,
			terminal: makeTerminal(),
			paging: {
				reset: vi.fn(),
				checkSequence: vi.fn(),
				processFrame: vi.fn(),
			} as never,
			gotFirstOutputRef: { current: true },
			channelRef: { current: null },
			setIsLoading,
			setConnectionError,
			ChannelClass: MockChannel as never,
		});
		expect(cleanup).toBeNull();
		expect(setIsLoading).toHaveBeenCalledWith(false);
		expect(setConnectionError).toHaveBeenCalledWith(
			"Not authenticated. Reconnect to Loopwire.",
		);
	});

	it("creates channel, connects, and cleans up", () => {
		MockChannel.created = [];
		const setIsLoading = vi.fn();
		const setConnectionError = vi.fn();
		const channelRef = { current: null as unknown as MockChannel | null };
		const gotFirstOutputRef = { current: true };

		const cleanup = setupTerminalChannel({
			sessionId: "s1",
			token: "tok",
			terminal: makeTerminal(120, 40),
			paging: {
				reset: vi.fn(),
				checkSequence: vi.fn(),
				processFrame: vi.fn(),
			} as never,
			gotFirstOutputRef,
			channelRef: channelRef as never,
			setIsLoading,
			setConnectionError,
			ChannelClass: MockChannel as never,
		});

		expect(cleanup).toBeTypeOf("function");
		expect(setIsLoading).toHaveBeenCalledWith(true);
		expect(setConnectionError).toHaveBeenCalledWith(null);
		expect(gotFirstOutputRef.current).toBe(false);
		expect(MockChannel.created).toHaveLength(1);
		const created = MockChannel.created[0];
		if (!created) throw new Error("missing channel instance");
		expect(created.options.initialCols).toBe(120);
		expect(created.options.initialRows).toBe(40);
		expect(created.connect).toHaveBeenCalledTimes(1);
		expect(channelRef.current).toBe(created);

		cleanup?.();
		expect(created.disconnect).toHaveBeenCalledTimes(1);
		expect(channelRef.current).toBeNull();
	});

	it("omits non-positive initial terminal size", () => {
		MockChannel.created = [];
		setupTerminalChannel({
			sessionId: "s1",
			token: "tok",
			terminal: makeTerminal(0, -1),
			paging: {
				reset: vi.fn(),
				checkSequence: vi.fn(),
				processFrame: vi.fn(),
			} as never,
			gotFirstOutputRef: { current: false },
			channelRef: { current: null },
			setIsLoading: vi.fn(),
			setConnectionError: vi.fn(),
			ChannelClass: MockChannel as never,
		});
		const created = MockChannel.created[0];
		if (!created) throw new Error("missing channel instance");
		expect(created.options.initialCols).toBeUndefined();
		expect(created.options.initialRows).toBeUndefined();
	});
});
