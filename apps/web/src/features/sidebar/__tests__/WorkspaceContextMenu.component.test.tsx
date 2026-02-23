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

describe("WorkspaceContextMenu", () => {
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

	it("returns null when menu position is not ready", async () => {
		useStateMock.mockReturnValue([null, vi.fn()]);
		const { WorkspaceContextMenu } = await import(
			"../components/WorkspaceContextMenu"
		);
		const node = WorkspaceContextMenu({
			root: { path: "/repo", name: "repo", pinned: false } as never,
			anchorRef: { current: null },
			onTogglePin: vi.fn(),
			onRename: vi.fn(),
			onSetIcon: vi.fn(),
			onDelete: vi.fn(),
		});
		expect(node).toBeNull();
	});

	it("dispatches menu actions and shows pin label", async () => {
		useStateMock.mockReturnValue([{ top: 10, left: 20 }, vi.fn()]);

		const onTogglePin = vi.fn();
		const onRename = vi.fn();
		const onSetIcon = vi.fn();
		const onDelete = vi.fn();

		const { WorkspaceContextMenu } = await import(
			"../components/WorkspaceContextMenu"
		);
		const node = WorkspaceContextMenu({
			root: { path: "/repo", name: "repo", pinned: false } as never,
			anchorRef: {
				current: {
					getBoundingClientRect: () => ({ left: 0, bottom: 0 }),
				},
			} as never,
			onTogglePin,
			onRename,
			onSetIcon,
			onDelete,
		});
		if (!node) {
			throw new Error("Expected WorkspaceContextMenu to render");
		}

		expect(createPortalMock).toHaveBeenCalledTimes(1);
		const pinBtn = node.props.children[0];
		const renameBtn = node.props.children[1];
		const iconBtn = node.props.children[2];
		const deleteBtn = node.props.children[3];

		const stopPropagation = vi.fn();
		pinBtn.props.onClick({ stopPropagation });
		renameBtn.props.onClick({ stopPropagation });
		iconBtn.props.onClick({ stopPropagation });
		deleteBtn.props.onDelete();

		expect(stopPropagation).toHaveBeenCalledTimes(3);
		expect(onTogglePin).toHaveBeenCalledTimes(1);
		expect(onRename).toHaveBeenCalledTimes(1);
		expect(onSetIcon).toHaveBeenCalledTimes(1);
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(pinBtn.props.children[1]).toBe("Pin");
	});
});
