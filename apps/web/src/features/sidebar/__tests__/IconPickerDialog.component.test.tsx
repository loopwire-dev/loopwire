import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useCallbackMock,
	useEffectMock,
	useRefMock,
	useStateMock,
	useThemeMock,
	DialogMock,
} = vi.hoisted(() => ({
	useCallbackMock: vi.fn(),
	useEffectMock: vi.fn(),
	useRefMock: vi.fn(),
	useStateMock: vi.fn(),
	useThemeMock: vi.fn(),
	DialogMock: vi.fn(),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useCallback: useCallbackMock,
		useEffect: useEffectMock,
		useRef: useRefMock,
		useState: useStateMock,
	};
});

vi.mock("next-themes", () => ({
	useTheme: useThemeMock,
}));

vi.mock("../../../shared/ui/Dialog", () => ({
	Dialog: DialogMock,
}));

vi.mock("emoji-picker-react", () => ({
	default: () => null,
	Theme: { DARK: "dark", LIGHT: "light" },
	SkinTonePickerLocation: { SEARCH: "search" },
	SuggestionMode: { RECENT: "recent" },
}));

vi.mock("react-easy-crop", () => ({
	default: () => null,
}));

vi.mock("../../../shared/lib/icon-masking", () => ({
	isThemeMaskDisabled: () => false,
	withThemeMask: (value: string) => value,
}));

vi.mock("../components/WorkspaceIcon", () => ({
	WorkspaceIcon: () => null,
}));

function visit(node: unknown, fn: (value: Record<string, unknown>) => void) {
	if (!node || typeof node !== "object") return;
	const value = node as Record<string, unknown>;
	fn(value);
	const props = value.props as Record<string, unknown> | undefined;
	const children = props?.children;
	if (Array.isArray(children)) {
		for (const child of children) visit(child, fn);
	} else {
		visit(children, fn);
	}
}

function textOf(node: unknown): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (!node || typeof node !== "object") return "";
	const props = (node as Record<string, unknown>).props as
		| Record<string, unknown>
		| undefined;
	const children = props?.children;
	if (Array.isArray(children)) return children.map(textOf).join("");
	return textOf(children);
}

function findButtonByText(
	tree: unknown,
	label: string,
): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		if (found || node.type !== "button") return;
		if (textOf(node).includes(label)) found = node;
	});
	return found;
}

describe("IconPickerDialog", () => {
	beforeEach(() => {
		vi.resetModules();
		useCallbackMock.mockReset();
		useEffectMock.mockReset();
		useRefMock.mockReset();
		useStateMock.mockReset();
		useThemeMock.mockReset();
		DialogMock.mockReset();

		useCallbackMock.mockImplementation((fn: unknown) => fn);
		useEffectMock.mockImplementation(() => {});
		useRefMock.mockReturnValue({ current: null });
		useThemeMock.mockReturnValue({ resolvedTheme: "light" });
		DialogMock.mockImplementation(
			(props: { children: unknown }) => props.children,
		);
	});

	it("clears icon and confirms selected workspace icon", async () => {
		const setIconDraft = vi.fn();
		useStateMock
			.mockReturnValueOnce(["😀", setIconDraft])
			.mockReturnValueOnce([0, vi.fn()])
			.mockReturnValueOnce([null, vi.fn()])
			.mockReturnValueOnce([{ x: 0, y: 0 }, vi.fn()])
			.mockReturnValueOnce([1, vi.fn()])
			.mockReturnValueOnce([null, vi.fn()])
			.mockReturnValueOnce([true, vi.fn()]);

		const onConfirm = vi.fn();
		const { IconPickerDialog } = await import("../components/IconPickerDialog");
		const tree = IconPickerDialog({
			workspace: {
				path: "/repo",
				name: "repo",
				icon: "😀",
				pinned: false,
			} as never,
			onConfirm,
			onClose: vi.fn(),
		});

		const clearBtn = findButtonByText(tree, "Clear");
		const confirmBtn = findButtonByText(tree, "Confirm");
		expect(clearBtn).toBeTruthy();
		expect(confirmBtn).toBeTruthy();
		if (!clearBtn || !confirmBtn)
			throw new Error("Expected dialog action buttons");

		(clearBtn.props as { onClick: () => void }).onClick();
		(confirmBtn.props as { onClick: () => void }).onClick();

		expect(setIconDraft).toHaveBeenCalledWith("");
		expect(onConfirm).toHaveBeenCalledWith("/repo", "😀");
	});

	it("closes dialog and resets crop state on close", async () => {
		const setCropImageSrc = vi.fn();
		const setCrop = vi.fn();
		const setZoom = vi.fn();
		const setCroppedAreaPixels = vi.fn();
		useStateMock
			.mockReturnValueOnce(["😀", vi.fn()])
			.mockReturnValueOnce([0, vi.fn()])
			.mockReturnValueOnce(["data:image/png;base64,abc", setCropImageSrc])
			.mockReturnValueOnce([{ x: 5, y: 6 }, setCrop])
			.mockReturnValueOnce([2, setZoom])
			.mockReturnValueOnce([
				{ x: 1, y: 1, width: 2, height: 2 },
				setCroppedAreaPixels,
			])
			.mockReturnValueOnce([true, vi.fn()]);

		const onClose = vi.fn();
		const { IconPickerDialog } = await import("../components/IconPickerDialog");
		const tree = IconPickerDialog({
			workspace: {
				path: "/repo",
				name: "repo",
				icon: "😀",
				pinned: false,
			} as never,
			onConfirm: vi.fn(),
			onClose,
		});

		const onOpenChange = (
			tree.props as { onOpenChange: (open: boolean) => void }
		).onOpenChange;
		onOpenChange(false);
		expect(setCropImageSrc).toHaveBeenCalledWith(null);
		expect(setCrop).toHaveBeenCalledWith({ x: 0, y: 0 });
		expect(setZoom).toHaveBeenCalledWith(1);
		expect(setCroppedAreaPixels).toHaveBeenCalledWith(null);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
