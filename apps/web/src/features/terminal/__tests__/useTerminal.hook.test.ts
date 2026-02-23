import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useRefMock,
	useStateMock,
	useEffectMock,
	useCallbackMock,
	useAppStoreMock,
} = vi.hoisted(() => ({
	useRefMock: vi.fn(),
	useStateMock: vi.fn(),
	useEffectMock: vi.fn(),
	useCallbackMock: vi.fn(),
	useAppStoreMock: vi.fn(),
}));

vi.mock("@xterm/addon-fit", () => ({
	FitAddon: class {
		fit = vi.fn();
	},
}));
vi.mock("@xterm/addon-serialize", () => ({ SerializeAddon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {} }));
vi.mock("@xterm/xterm", () => ({
	Terminal: class {},
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("react", () => ({
	useRef: useRefMock,
	useState: useStateMock,
	useEffect: useEffectMock,
	useCallback: useCallbackMock,
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (s: { token: string | null }) => unknown) =>
		useAppStoreMock(selector),
}));

describe("useTerminal hook shell", () => {
	beforeEach(() => {
		vi.resetModules();
		useRefMock.mockReset();
		useStateMock.mockReset();
		useEffectMock.mockReset();
		useCallbackMock.mockReset();
		useAppStoreMock.mockReset();

		useCallbackMock.mockImplementation((fn: unknown) => fn);
		useEffectMock.mockImplementation((fn: () => undefined | (() => void)) =>
			fn(),
		);
	});

	it("sets loading from sessionId and returns false sendInput when no channel", async () => {
		const setLoading = vi.fn();
		const setConnectionError = vi.fn();
		useStateMock
			.mockReturnValueOnce([false, setLoading])
			.mockReturnValueOnce([null, setConnectionError])
			.mockReturnValueOnce([null, vi.fn()]);

		useRefMock
			.mockReturnValueOnce({ current: null }) // containerRef
			.mockReturnValueOnce({ current: null }) // channelRef
			.mockReturnValueOnce({ current: null }) // viewportRef
			.mockReturnValueOnce({
				current: { setTerminal: vi.fn(), dispose: vi.fn() },
			}) // paging
			.mockReturnValueOnce({ current: undefined }) // onScrollPastTopRef
			.mockReturnValueOnce({ current: false }); // gotFirstOutputRef

		useAppStoreMock.mockImplementation(
			(selector: (s: { token: string | null }) => unknown) =>
				selector({ token: null }),
		);

		const { useTerminal } = await import("../hooks/useTerminal");
		const hook = useTerminal("sess-1", "dark");
		expect(setLoading).toHaveBeenCalledWith(true);
		expect(hook.sendInput("x")).toBe(false);
	});

	it("applies theme to existing terminal and surfaces auth error without token", async () => {
		const setLoading = vi.fn();
		const setConnectionError = vi.fn();
		const terminal = {
			options: { theme: null },
			cols: 0,
			rows: 0,
			reset: vi.fn(),
			focus: vi.fn(),
			writeln: vi.fn(),
		};

		useStateMock
			.mockReturnValueOnce([false, setLoading])
			.mockReturnValueOnce([null, setConnectionError])
			.mockReturnValueOnce([terminal, vi.fn()]);

		useRefMock
			.mockReturnValueOnce({ current: null }) // containerRef
			.mockReturnValueOnce({ current: null }) // channelRef
			.mockReturnValueOnce({ current: null }) // viewportRef
			.mockReturnValueOnce({
				current: { setTerminal: vi.fn(), reset: vi.fn() },
			}) // paging
			.mockReturnValueOnce({ current: undefined }) // onScrollPastTopRef
			.mockReturnValueOnce({ current: false }); // gotFirstOutputRef

		useAppStoreMock.mockImplementation(
			(selector: (s: { token: string | null }) => unknown) =>
				selector({ token: null }),
		);

		const { useTerminal } = await import("../hooks/useTerminal");
		useTerminal("sess-2", "light");

		expect(setConnectionError).toHaveBeenCalledWith(
			"Not authenticated. Reconnect to Loopwire.",
		);
		expect(terminal.options.theme).toEqual({
			background: "#ffffff",
			foreground: "#333333",
			cursor: "#000000",
			selectionBackground: "#add6ff",
		});
	});
});
