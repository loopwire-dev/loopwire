import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useEffectMock,
	useRefMock,
	fetchGitDiffFilesMock,
	getCachedDiffFilesMock,
	DiffPeekWidgetClassMock,
	getDiffPeekWidgetInstances,
	resetDiffPeekWidgetInstances,
} = vi.hoisted(() => {
	type PeekInstance = {
		openIndex: number | null;
		open: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
	};
	const instances: PeekInstance[] = [];
	class DiffPeekWidgetCtor {
		openIndex: number | null = null;
		open = vi.fn();
		close = vi.fn();
		constructor() {
			instances.push(this);
		}
	}
	return {
		useEffectMock: vi.fn(),
		useRefMock: vi.fn(),
		fetchGitDiffFilesMock: vi.fn(),
		getCachedDiffFilesMock: vi.fn(),
		DiffPeekWidgetClassMock: DiffPeekWidgetCtor,
		getDiffPeekWidgetInstances: () => instances,
		resetDiffPeekWidgetInstances: () => {
			instances.length = 0;
		},
	};
});

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useEffect: useEffectMock,
		useRef: useRefMock,
	};
});

vi.mock("../lib/diffPeekWidget", () => ({
	DiffPeekWidget: DiffPeekWidgetClassMock,
}));

vi.mock("../lib/diffUtils", () => ({
	fetchGitDiffFiles: fetchGitDiffFilesMock,
	getCachedDiffFiles: getCachedDiffFilesMock,
}));

describe("useGitGutter", () => {
	beforeEach(() => {
		vi.resetModules();
		useEffectMock.mockReset();
		useRefMock.mockReset();
		fetchGitDiffFilesMock.mockReset();
		getCachedDiffFilesMock.mockReset();
		resetDiffPeekWidgetInstances();

		useRefMock.mockReturnValue({ current: null });
	});

	it("does nothing without workspace or file", async () => {
		useEffectMock.mockImplementation((fn: () => unknown) => {
			fn();
		});

		const { useGitGutter } = await import("../hooks/useGitGutter");
		useGitGutter(
			null,
			null,
			{ current: null } as never,
			{ current: null } as never,
			false,
		);

		expect(getCachedDiffFilesMock).not.toHaveBeenCalled();
		expect(fetchGitDiffFilesMock).not.toHaveBeenCalled();
	});

	it("applies cached diff decorations, handles gutter click, and cleans up", async () => {
		let cleanup: (() => void) | undefined;
		useEffectMock.mockImplementation((fn: () => unknown) => {
			const result = fn();
			cleanup =
				typeof result === "function" ? (result as () => void) : undefined;
		});

		const setSpy = vi.fn();
		const clearSpy = vi.fn();
		const disposeSpy = vi.fn();
		let mouseHandler: ((event: unknown) => void) | null = null;

		const createDecorationsCollectionMock = vi.fn((_: unknown) => ({
			set: setSpy,
			clear: clearSpy,
		}));
		const onMouseDownMock = vi.fn((handler: (event: unknown) => void) => {
			mouseHandler = handler;
			return { dispose: disposeSpy };
		});
		const editor = {
			getModel: vi.fn(() => ({})),
			createDecorationsCollection: createDecorationsCollectionMock,
			onMouseDown: onMouseDownMock,
		};
		const monaco = {
			editor: {
				MouseTargetType: {
					GUTTER_LINE_DECORATIONS: 2,
				},
			},
		};

		getCachedDiffFilesMock.mockReturnValue([
			{
				path: "src/a.ts",
				hunks: [
					{
						header: "@@ -1 +1 @@",
						lines: [
							{ type: "deletion", content: "-a", oldLine: 1, newLine: null },
							{ type: "addition", content: "+b", oldLine: null, newLine: 1 },
						],
					},
				],
			},
		]);

		const { useGitGutter } = await import("../hooks/useGitGutter");
		useGitGutter(
			"w1",
			"src/a.ts",
			{ current: editor } as never,
			{ current: monaco } as never,
			false,
		);

		expect(getCachedDiffFilesMock).toHaveBeenCalledWith("w1");
		expect(createDecorationsCollectionMock).toHaveBeenCalledTimes(1);
		const createdWith = createDecorationsCollectionMock.mock.calls[0]?.[0] as
			| Array<{ options?: { linesDecorationsClassName?: string } }>
			| undefined;
		expect(createdWith?.[0]?.options?.linesDecorationsClassName).toBe(
			"gutter-modified",
		);
		expect(getDiffPeekWidgetInstances()).toHaveLength(1);

		if (!mouseHandler) {
			throw new Error("Expected gutter mouse handler");
		}
		(mouseHandler as (event: unknown) => void)({
			target: { type: 2, position: { lineNumber: 1 } },
		});
		const peek = getDiffPeekWidgetInstances()[0];
		if (!peek) {
			throw new Error("Expected DiffPeekWidget instance");
		}
		expect(peek.open).toHaveBeenCalledTimes(1);

		if (typeof cleanup === "function") cleanup();
		expect(disposeSpy).toHaveBeenCalledTimes(1);
		expect(clearSpy).toHaveBeenCalledTimes(1);
		expect(peek.close).toHaveBeenCalled();
	});
});
