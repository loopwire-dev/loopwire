import { describe, expect, it, vi } from "vitest";
import {
	createTerminalChannelHandlers,
	createTerminalWheelHandler,
} from "../lib/terminalEventHandlers";

function makeTerminal() {
	return {
		cols: 80,
		rows: 24,
		options: { fontSize: 10, lineHeight: 1.5 },
		reset: vi.fn(),
		focus: vi.fn(),
		writeln: vi.fn(),
	};
}

describe("terminalEventHandlers wheel", () => {
	it("returns false when viewport is missing", () => {
		const terminal = makeTerminal();
		const event = {
			deltaMode: 0,
			deltaY: 10,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		};
		const handler = createTerminalWheelHandler({ viewport: null, terminal });
		expect(handler(event)).toBe(false);
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it("triggers scroll-past-top on negative delta at top", () => {
		const terminal = makeTerminal();
		const onScrollPastTop = vi.fn();
		const viewport = { scrollHeight: 1000, clientHeight: 500, scrollTop: 0 };
		const event = {
			deltaMode: 1,
			deltaY: -1,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		};
		const handler = createTerminalWheelHandler({
			viewport,
			terminal,
			onScrollPastTop,
		});
		handler(event);
		expect(onScrollPastTop).toHaveBeenCalledTimes(1);
		expect(viewport.scrollTop).toBe(0);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
	});

	it("scrolls viewport with computed delta", () => {
		const terminal = makeTerminal();
		const viewport = { scrollHeight: 1000, clientHeight: 500, scrollTop: 20 };
		const event = {
			deltaMode: 2,
			deltaY: 1,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		};
		const handler = createTerminalWheelHandler({ viewport, terminal });
		handler(event);
		expect(viewport.scrollTop).toBe(520);
	});
});

describe("terminalEventHandlers channel handlers", () => {
	it("applies ready/output/exit/error behavior", () => {
		const terminal = makeTerminal();
		const paging = {
			reset: vi.fn(),
			checkSequence: vi.fn(),
			processFrame: vi.fn(),
		};
		const setIsLoading = vi.fn();
		const setConnectionError = vi.fn();
		const sendResize = vi.fn();
		const gotFirstOutputRef = { current: false };
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const handlers = createTerminalChannelHandlers({
			sessionId: "s1",
			terminal,
			paging: paging as never,
			sendResize,
			setIsLoading,
			setConnectionError,
			gotFirstOutputRef,
		});

		handlers.onConnectionChange(false);
		expect(setIsLoading).toHaveBeenCalledWith(true);
		expect(paging.reset).toHaveBeenCalledTimes(1);

		handlers.onReady({ sessionId: "other" });
		expect(terminal.reset).not.toHaveBeenCalled();

		handlers.onReady({ sessionId: "s1" });
		expect(terminal.reset).toHaveBeenCalledTimes(1);
		expect(terminal.focus).toHaveBeenCalledTimes(1);
		expect(setConnectionError).toHaveBeenCalledWith(null);
		expect(sendResize).toHaveBeenCalledWith(80, 24);

		handlers.onOutput(
			{ sessionId: "other", seq: 1 },
			"live",
			new Uint8Array([1]),
		);
		expect(paging.checkSequence).not.toHaveBeenCalled();

		handlers.onOutput(
			{ sessionId: "s1", seq: 2 },
			"history",
			new Uint8Array([2]),
		);
		expect(gotFirstOutputRef.current).toBe(true);
		expect(setIsLoading).toHaveBeenCalledWith(false);
		expect(paging.checkSequence).toHaveBeenCalledWith(2);
		expect(paging.processFrame).toHaveBeenCalledWith(
			"history",
			new Uint8Array([2]),
		);

		handlers.onExit(9);
		expect(setConnectionError).toHaveBeenCalledWith("Process exited (code 9).");

		handlers.onError("boom");
		expect(paging.reset).toHaveBeenCalledTimes(3);
		expect(setConnectionError).toHaveBeenCalledWith("boom");
		expect(terminal.writeln).toHaveBeenCalledWith("\r\n[terminal] boom");
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
