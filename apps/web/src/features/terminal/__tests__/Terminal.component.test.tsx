import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useStateMock,
	useMemoMock,
	useEffectMock,
	useCallbackMock,
	useRefMock,
	useThemeMock,
	useAppStoreMock,
	useTerminalMock,
	attachToSessionMock,
} = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useMemoMock: vi.fn(),
	useEffectMock: vi.fn(),
	useCallbackMock: vi.fn(),
	useRefMock: vi.fn(),
	useThemeMock: vi.fn(),
	useAppStoreMock: vi.fn(),
	useTerminalMock: vi.fn(),
	attachToSessionMock: vi.fn(),
}));

vi.mock("react", () => ({
	useState: useStateMock,
	useMemo: useMemoMock,
	useEffect: useEffectMock,
	useCallback: useCallbackMock,
	useRef: useRefMock,
}));

vi.mock("next-themes", () => ({
	useTheme: useThemeMock,
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (s: unknown) => unknown) => useAppStoreMock(selector),
}));

vi.mock("../hooks/useTerminal", () => ({
	useTerminal: useTerminalMock,
}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	attachToSession: attachToSessionMock,
}));

vi.mock("lucide-react", () => ({
	AlertTriangle: () => null,
}));

vi.mock("../../../shared/ui/LoopwireSpinner", () => ({
	LoopwireSpinner: () => null,
}));

vi.mock("../components/ScrollbackOverlay", () => ({
	ScrollbackOverlay: () => null,
}));

function setupBaseMocks() {
	useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
	useMemoMock.mockImplementation((fn: () => unknown) => fn());
	useEffectMock.mockImplementation((fn: () => undefined | (() => void)) =>
		fn(),
	);
	useCallbackMock.mockImplementation((fn: unknown) => fn);
	useAppStoreMock.mockImplementation(
		(
			selector: (s: {
				sessionsByWorkspacePath: Record<
					string,
					Array<{ sessionId: string; resumeFailureReason?: string }>
				>;
			}) => unknown,
		) =>
			selector({
				sessionsByWorkspacePath: {
					"/w": [{ sessionId: "s1", resumeFailureReason: "resume failed" }],
				},
			}),
	);
}

describe("Terminal component shell", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useMemoMock.mockReset();
		useEffectMock.mockReset();
		useCallbackMock.mockReset();
		useRefMock.mockReset();
		useThemeMock.mockReset();
		useAppStoreMock.mockReset();
		useTerminalMock.mockReset();
		attachToSessionMock.mockReset();
		setupBaseMocks();
	});

	it("renders with handlers and drag-over toggles state", async () => {
		const setShowScrollback = vi.fn();
		const setDismissedWarning = vi.fn();
		const setIsDragOver = vi.fn();
		useStateMock
			.mockReturnValueOnce([false, setShowScrollback])
			.mockReturnValueOnce([false, setDismissedWarning])
			.mockReturnValueOnce([false, setIsDragOver]);
		useRefMock.mockReturnValue({ current: null });
		useTerminalMock.mockReturnValue({
			ref: { current: null },
			isLoading: true,
			connectionError: "oops",
			sendInput: vi.fn(),
		});

		const { Terminal } = await import("../components/Terminal");
		const tree = Terminal({ sessionId: "s1" }) as ReactElement<{
			className: string;
			onDragOver: (event: unknown) => void;
		}>;

		expect(tree.props.className).toContain("relative");
		const dragEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: { types: ["Files"] },
		};
		tree.props.onDragOver(dragEvent);
		expect(setIsDragOver).toHaveBeenCalledWith(true);
	});

	it("drops non-image files without upload", async () => {
		const setIsDragOver = vi.fn();
		useStateMock
			.mockReturnValueOnce([false, vi.fn()])
			.mockReturnValueOnce([false, vi.fn()])
			.mockReturnValueOnce([false, setIsDragOver]);
		useRefMock.mockReturnValue({ current: null });
		useTerminalMock.mockReturnValue({
			ref: { current: null },
			isLoading: false,
			connectionError: null,
			sendInput: vi.fn(),
		});

		const { Terminal } = await import("../components/Terminal");
		const tree = Terminal({ sessionId: "s1" }) as ReactElement<{
			onDrop: (event: unknown) => Promise<void>;
		}>;

		await tree.props.onDrop({
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: { files: [{ type: "text/plain", name: "a.txt" }] },
		});
		expect(setIsDragOver).toHaveBeenCalledWith(false);
		expect(attachToSessionMock).not.toHaveBeenCalled();
	});

	it("drops image files and sends returned attachment path", async () => {
		const sendInput = vi.fn();
		useStateMock
			.mockReturnValueOnce([false, vi.fn()])
			.mockReturnValueOnce([false, vi.fn()])
			.mockReturnValueOnce([false, vi.fn()]);
		useRefMock.mockReturnValue({ current: null });
		useTerminalMock.mockReturnValue({
			ref: { current: null },
			isLoading: false,
			connectionError: null,
			sendInput,
		});
		attachToSessionMock.mockResolvedValue({ path: "/tmp/img.png" });

		class FakeFileReader {
			result: string | null = "data:image/png;base64,AAAA";
			error: Error | null = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			readAsDataURL() {
				this.onload?.();
			}
		}
		vi.stubGlobal("FileReader", FakeFileReader as unknown as typeof FileReader);

		const { Terminal } = await import("../components/Terminal");
		const tree = Terminal({ sessionId: "s1" }) as ReactElement<{
			onDrop: (event: unknown) => Promise<void>;
		}>;

		await tree.props.onDrop({
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: {
				files: [{ type: "image/png", name: "img.png" }],
			},
		});

		expect(attachToSessionMock).toHaveBeenCalledWith("s1", "AAAA", "img.png");
		expect(sendInput).toHaveBeenCalledWith("/tmp/img.png");
	});
});
