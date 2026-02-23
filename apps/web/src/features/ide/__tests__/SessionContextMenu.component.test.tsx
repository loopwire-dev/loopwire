import { beforeEach, describe, expect, it, vi } from "vitest";

const { useLayoutEffectMock, useStateMock, createPortalMock } = vi.hoisted(
	() => ({
		useLayoutEffectMock: vi.fn(),
		useStateMock: vi.fn(),
		createPortalMock: vi.fn(),
	}),
);

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useLayoutEffect: useLayoutEffectMock,
		useState: useStateMock,
	};
});

vi.mock("react-dom", () => ({
	createPortal: createPortalMock,
}));

describe("SessionContextMenu", () => {
	beforeEach(() => {
		vi.resetModules();
		useLayoutEffectMock.mockReset();
		useStateMock.mockReset();
		createPortalMock.mockReset();

		useLayoutEffectMock.mockImplementation(() => {});
		createPortalMock.mockImplementation((node) => node);
		Object.defineProperty(globalThis, "document", {
			value: { body: {} },
			configurable: true,
		});
	});

	it("renders unpin label for pinned session", async () => {
		useStateMock.mockReturnValue([{ top: 10, left: 20 }, vi.fn()]);
		const onTogglePin = vi.fn();
		const { SessionContextMenu } = await import(
			"../components/SessionContextMenu"
		);
		const node = SessionContextMenu({
			pinned: true,
			anchorRef: {
				current: {
					getBoundingClientRect: () => ({ left: 0, bottom: 0 }),
				},
			} as never,
			onTogglePin,
			onRename: vi.fn(),
			onSetIcon: vi.fn(),
			onDelete: vi.fn(),
		});
		if (!node) {
			throw new Error("Expected SessionContextMenu to render");
		}
		const pinBtn = node.props.children[0];
		expect(pinBtn.props.children[1]).toBe("Unpin");
		pinBtn.props.onClick({ stopPropagation: vi.fn() });
		expect(onTogglePin).toHaveBeenCalledTimes(1);
	});

	it("returns null without position", async () => {
		useStateMock.mockReturnValue([null, vi.fn()]);
		const { SessionContextMenu } = await import(
			"../components/SessionContextMenu"
		);
		const node = SessionContextMenu({
			pinned: false,
			anchorRef: { current: null },
			onTogglePin: vi.fn(),
			onRename: vi.fn(),
			onSetIcon: vi.fn(),
			onDelete: vi.fn(),
		});
		expect(node).toBeNull();
	});
});
