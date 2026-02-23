import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useRefMock,
	useEffectMock,
	useCallbackMock,
	useScrollbackMock,
	decideWheelMock,
	binaryStringToBytesMock,
} = vi.hoisted(() => ({
	useRefMock: vi.fn(),
	useEffectMock: vi.fn(),
	useCallbackMock: vi.fn(),
	useScrollbackMock: vi.fn(),
	decideWheelMock: vi.fn(),
	binaryStringToBytesMock: vi.fn(),
}));

class MockXTerm {
	static instances: MockXTerm[] = [];
	options: Record<string, unknown>;
	element: { querySelector: (selector: string) => unknown };
	loadAddon = vi.fn();
	open = vi.fn();
	reset = vi.fn();
	write = vi.fn();
	scrollToTop = vi.fn();
	dispose = vi.fn();

	constructor(options: Record<string, unknown>) {
		this.options = options;
		const viewport = { scrollTop: 0, scrollHeight: 100, clientHeight: 50 };
		this.element = {
			querySelector: (selector: string) =>
				selector === ".xterm-viewport" ? viewport : null,
		};
		MockXTerm.instances.push(this);
	}
}

class MockFitAddon {
	fit = vi.fn();
}

vi.mock("react", () => ({
	useRef: useRefMock,
	useEffect: useEffectMock,
	useCallback: useCallbackMock,
}));

vi.mock("@xterm/xterm", () => ({
	Terminal: MockXTerm,
}));
vi.mock("@xterm/addon-fit", () => ({
	FitAddon: MockFitAddon,
}));
vi.mock("@xterm/addon-webgl", () => ({
	WebglAddon: class {},
}));

vi.mock("../../../shared/ui/LoopwireSpinner", () => ({
	LoopwireSpinner: () => null,
}));

vi.mock("../hooks/useScrollback", () => ({
	useScrollback: useScrollbackMock,
}));

vi.mock("../lib/scrollbackWheelPolicy", () => ({
	decideScrollbackWheelAction: decideWheelMock,
}));

vi.mock("../channel/TerminalPagingController", () => ({
	binaryStringToBytes: binaryStringToBytesMock,
}));

describe("ScrollbackOverlay component shell", () => {
	beforeEach(() => {
		vi.resetModules();
		MockXTerm.instances = [];
		useRefMock.mockReset();
		useEffectMock.mockReset();
		useCallbackMock.mockReset();
		useScrollbackMock.mockReset();
		decideWheelMock.mockReset();
		binaryStringToBytesMock.mockReset();

		vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
			fn(0);
			return 1;
		});
		vi.stubGlobal(
			"atob",
			vi.fn(() => "decoded"),
		);
		vi.stubGlobal("window", {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		});
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);

		useCallbackMock.mockImplementation((fn: unknown) => fn);
		useEffectMock.mockImplementation((fn: () => undefined | (() => void)) =>
			fn(),
		);
		binaryStringToBytesMock.mockImplementation(() => new Uint8Array([1, 2, 3]));
		decideWheelMock.mockReturnValue({
			nextLatch: false,
			shouldFetchMore: false,
			shouldCheckDismiss: false,
		});
	});

	it("fetches initial scrollback and writes pages into terminal", async () => {
		const fetchInitial = vi.fn();
		const fetchMore = vi.fn();
		const reset = vi.fn();
		useScrollbackMock.mockReturnValue({
			pages: [
				{ data: "AAAA", start_offset: 0, end_offset: 1, has_more: true },
				{ data: "BBBB", start_offset: 2, end_offset: 3, has_more: false },
			],
			loading: false,
			hasMore: true,
			error: null,
			fetchInitial,
			fetchMore,
			reset,
		});

		const container = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		};
		useRefMock
			.mockReturnValueOnce({ current: container })
			.mockReturnValueOnce({ current: null })
			.mockReturnValueOnce({ current: null })
			.mockReturnValueOnce({ current: false });

		const onDismiss = vi.fn();
		const { ScrollbackOverlay } = await import(
			"../components/ScrollbackOverlay"
		);
		ScrollbackOverlay({ sessionId: "s1", theme: "dark", onDismiss });

		expect(fetchInitial).toHaveBeenCalledWith("s1");
		expect(MockXTerm.instances).toHaveLength(1);
		const term = MockXTerm.instances[0];
		if (!term) throw new Error("missing terminal instance");
		expect(term.reset).toHaveBeenCalledTimes(1);
		expect(term.write).toHaveBeenCalledTimes(2);
		expect(term.scrollToTop).toHaveBeenCalledTimes(1);
	});

	it("handles wheel decisions and escape key", async () => {
		const fetchInitial = vi.fn();
		const fetchMore = vi.fn();
		const reset = vi.fn();
		useScrollbackMock.mockReturnValue({
			pages: [{ data: "AAAA", start_offset: 0, end_offset: 1, has_more: true }],
			loading: false,
			hasMore: true,
			error: null,
			fetchInitial,
			fetchMore,
			reset,
		});

		const keydownHandlers: Array<(e: KeyboardEvent) => void> = [];
		(
			window.addEventListener as unknown as ReturnType<typeof vi.fn>
		).mockImplementation(
			(type: string, handler: (e: KeyboardEvent) => void) => {
				if (type === "keydown") keydownHandlers.push(handler);
			},
		);

		useRefMock
			.mockReturnValueOnce({
				current: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
			})
			.mockReturnValueOnce({ current: null })
			.mockReturnValueOnce({ current: null })
			.mockReturnValueOnce({ current: false });

		decideWheelMock.mockReturnValue({
			nextLatch: true,
			shouldFetchMore: true,
			shouldCheckDismiss: false,
		});

		const onDismiss = vi.fn();
		const { ScrollbackOverlay } = await import(
			"../components/ScrollbackOverlay"
		);
		const tree = ScrollbackOverlay({
			sessionId: "s1",
			theme: "dark",
			onDismiss,
		}) as ReactElement<{
			children: unknown[];
		}>;

		const wheelContainer = tree.props.children[2];
		if (
			!wheelContainer ||
			typeof wheelContainer !== "object" ||
			!("props" in wheelContainer)
		) {
			throw new Error("missing wheel container");
		}
		(
			wheelContainer as {
				props: { onWheel: (event: { deltaY: number }) => void };
			}
		).props.onWheel({ deltaY: -1 });
		expect(fetchMore).toHaveBeenCalledTimes(1);

		keydownHandlers[0]?.({
			key: "Escape",
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);
		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(window.addEventListener).toHaveBeenCalled();
	});
});
