import type { Terminal as XTerm } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	TerminalPagingController,
	binaryStringToBytes,
	inputStringToBytes,
} from "../TerminalPagingController";

// Minimal XTerm mock
function createMockTerminal(autoCallback = true) {
	const writes: Array<{ data: unknown; cb?: () => void }> = [];
	return {
		writes,
		write(data: unknown, cb?: () => void) {
			writes.push({ data, cb });
			if (autoCallback && cb) cb();
		},
		reset: vi.fn(),
	};
}

describe("TerminalPagingController", () => {
	let controller: TerminalPagingController;
	let mockTerm: ReturnType<typeof createMockTerminal>;

	beforeEach(() => {
		controller = new TerminalPagingController();
		mockTerm = createMockTerminal();
		controller.setTerminal(mockTerm as unknown as XTerm);
	});

	it("starts with input not suppressed", () => {
		expect(controller.isInputSuppressed).toBe(false);
	});

	it("processFrame history writes bytes to terminal and suppresses input", () => {
		const term = createMockTerminal(false);
		controller.setTerminal(term as unknown as XTerm);

		const bytes = new Uint8Array([72, 101, 108, 108, 111]);
		controller.processFrame("history", bytes);

		expect(term.writes.length).toBe(1);
		expect(term.writes[0]?.data).toBe(bytes);
		expect(controller.isInputSuppressed).toBe(true);

		// Simulate write callback completing
		term.writes[0]?.cb?.();
		expect(controller.isInputSuppressed).toBe(false);
	});

	it("processFrame live writes bytes directly", () => {
		const bytes = new Uint8Array([65, 66, 67]);
		controller.processFrame("live", bytes);
		expect(mockTerm.writes.length).toBe(1);
		expect(mockTerm.writes[0]?.data).toBe(bytes);
	});

	it("live frames queue during history write and drain after", () => {
		const term = createMockTerminal(false);
		controller.setTerminal(term as unknown as XTerm);

		// Start a history write (callback not auto-called)
		controller.processFrame("history", new Uint8Array([1]));
		expect(term.writes.length).toBe(1);

		// Live frames should be queued
		const liveBytes1 = new Uint8Array([2, 3]);
		const liveBytes2 = new Uint8Array([4, 5]);
		controller.processFrame("live", liveBytes1);
		controller.processFrame("live", liveBytes2);
		expect(term.writes.length).toBe(1); // still only the history write

		// Complete the history write — queued live frames should drain
		term.writes[0]?.cb?.();
		expect(term.writes.length).toBe(3); // history + 2 live
	});

	it("reset clears state", () => {
		const term = createMockTerminal(false);
		controller.setTerminal(term as unknown as XTerm);

		controller.processFrame("history", new Uint8Array([1]));
		expect(controller.isInputSuppressed).toBe(true);

		controller.reset();
		expect(controller.isInputSuppressed).toBe(false);
	});

	it("checkSequence detects non-monotonic sequences", () => {
		const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
		controller.checkSequence(5);
		controller.checkSequence(3); // non-monotonic
		expect(spy).toHaveBeenCalledWith(
			"[terminal] non-monotonic frame sequence",
			"prev=",
			5,
			"curr=",
			3,
		);
		spy.mockRestore();
	});

	it("checkSequence accepts monotonic sequences silently", () => {
		const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
		controller.checkSequence(1);
		controller.checkSequence(2);
		controller.checkSequence(3);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("dispose clears state and terminal reference", () => {
		controller.processFrame("live", new Uint8Array([1]));
		controller.dispose();
		expect(controller.isInputSuppressed).toBe(false);

		// After dispose, processFrame should be a no-op (terminal is null)
		controller.processFrame("live", new Uint8Array([2]));
		// Only the one write before dispose
		expect(mockTerm.writes.length).toBe(1);
	});
});

describe("binaryStringToBytes", () => {
	it("converts ASCII string to bytes", () => {
		const result = binaryStringToBytes("ABC");
		expect(result).toEqual(new Uint8Array([65, 66, 67]));
	});

	it("masks high bytes", () => {
		const result = binaryStringToBytes("\u0100");
		expect(result[0]).toBe(0); // 0x100 & 0xff = 0
	});
});

describe("inputStringToBytes", () => {
	it("uses binary conversion for single-byte strings", () => {
		const result = inputStringToBytes("hello");
		expect(result).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
	});

	it("uses TextEncoder for multi-byte strings", () => {
		const result = inputStringToBytes("hello \u{1F600}");
		const expected = new TextEncoder().encode("hello \u{1F600}");
		expect(result).toEqual(expected);
	});
});
