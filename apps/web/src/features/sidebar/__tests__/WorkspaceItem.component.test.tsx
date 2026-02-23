import { beforeEach, describe, expect, it, vi } from "vitest";

const { useRefMock, TooltipMock, WorkspaceContextMenuMock, WorkspaceIconMock } =
	vi.hoisted(() => ({
		useRefMock: vi.fn(),
		TooltipMock: vi.fn(),
		WorkspaceContextMenuMock: vi.fn(),
		WorkspaceIconMock: vi.fn(),
	}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useRef: useRefMock,
	};
});

vi.mock("../../../shared/ui/Tooltip", () => ({
	Tooltip: TooltipMock,
}));

vi.mock("../components/WorkspaceContextMenu", () => ({
	WorkspaceContextMenu: WorkspaceContextMenuMock,
}));

vi.mock("../components/WorkspaceIcon", () => ({
	WorkspaceIcon: WorkspaceIconMock,
}));

describe("WorkspaceItem", () => {
	beforeEach(() => {
		vi.resetModules();
		useRefMock.mockReset();
		TooltipMock.mockReset();
		WorkspaceContextMenuMock.mockReset();
		WorkspaceIconMock.mockReset();

		useRefMock.mockReturnValue({ current: null });
		TooltipMock.mockImplementation(({ children }) => children);
	});

	it("activates workspace and opens menu actions", async () => {
		const onActivate = vi.fn();
		const onToggleMenu = vi.fn();
		const onDragStart = vi.fn();
		const onDragEnd = vi.fn();
		const onDragOver = vi.fn();
		const onDragLeave = vi.fn();
		const onDrop = vi.fn();
		const onEditingNameChange = vi.fn();
		const onSubmitRename = vi.fn();
		const onCancelEdit = vi.fn();
		const onTogglePin = vi.fn();
		const onRename = vi.fn();
		const onSetIcon = vi.fn();
		const onDelete = vi.fn();

		const { WorkspaceItem } = await import("../components/WorkspaceItem");
		const tree = WorkspaceItem({
			root: { path: "/repo", name: "repo", pinned: false, icon: null } as never,
			isActive: true,
			compact: false,
			isDragging: false,
			isDragOver: false,
			isEditing: false,
			editingName: "repo",
			onEditingNameChange,
			onSubmitRename,
			onCancelEdit,
			isMenuOpen: true,
			onToggleMenu,
			onActivate,
			onTogglePin,
			onRename,
			onSetIcon,
			onDelete,
			onDragStart,
			onDragEnd,
			onDragOver,
			onDragLeave,
			onDrop,
		});

		expect(tree.props.onDragStart).toBe(onDragStart);
		expect(tree.props.onDragEnd).toBe(onDragEnd);

		const mainButton = tree.props.children.props.children;
		mainButton.props.onClick();
		expect(onActivate).toHaveBeenCalledTimes(1);

		mainButton.props.onKeyDown({
			key: "Enter",
			preventDefault: vi.fn(),
		});
		expect(onActivate).toHaveBeenCalledTimes(2);

		const contentRow = mainButton.props.children[1];
		const menuContainer = contentRow.props.children[2];
		const menuButton = menuContainer.props.children[0];
		const stopPropagation = vi.fn();
		menuButton.props.onClick({ stopPropagation });
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect(onToggleMenu).toHaveBeenCalledTimes(1);
		expect(menuContainer.props.children[1].type).toBe(WorkspaceContextMenuMock);
	});

	it("disables drag handlers in compact mode", async () => {
		const { WorkspaceItem } = await import("../components/WorkspaceItem");
		const tree = WorkspaceItem({
			root: { path: "/repo", name: "repo", pinned: false, icon: null } as never,
			isActive: false,
			compact: true,
			isDragging: false,
			isDragOver: false,
			isEditing: false,
			editingName: "repo",
			onEditingNameChange: vi.fn(),
			onSubmitRename: vi.fn(),
			onCancelEdit: vi.fn(),
			isMenuOpen: false,
			onToggleMenu: vi.fn(),
			onActivate: vi.fn(),
			onTogglePin: vi.fn(),
			onRename: vi.fn(),
			onSetIcon: vi.fn(),
			onDelete: vi.fn(),
			onDragStart: vi.fn(),
			onDragEnd: vi.fn(),
			onDragOver: vi.fn(),
			onDragLeave: vi.fn(),
			onDrop: vi.fn(),
		});

		expect(tree.props.onDragStart).toBeUndefined();
		expect(tree.props.onDrop).toBeUndefined();
	});
});
