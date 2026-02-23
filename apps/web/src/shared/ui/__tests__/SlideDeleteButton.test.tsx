import { beforeEach, describe, expect, it, vi } from "vitest";

const { useStateMock, useRefMock } = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useRefMock: vi.fn(),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useState: useStateMock,
		useRef: useRefMock,
	};
});

type ElementLike = {
	type: unknown;
	props?: Record<string, unknown>;
};

function findElement(
	node: unknown,
	predicate: (element: ElementLike) => boolean,
): ElementLike | null {
	if (!node || typeof node !== "object") return null;
	const element = node as ElementLike;
	if (predicate(element)) return element;
	const children = element.props?.children;
	if (!children) return null;
	const list = Array.isArray(children) ? children : [children];
	for (const child of list) {
		const found = findElement(child, predicate);
		if (found) return found;
	}
	return null;
}

function hasDeleteLabel(children: unknown): boolean {
	if (children === "Delete") return true;
	if (Array.isArray(children))
		return children.some((child) => hasDeleteLabel(child));
	if (!children || typeof children !== "object") return false;
	return hasDeleteLabel(
		(children as { props?: { children?: unknown } }).props?.children,
	);
}

describe("SlideDeleteButton", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useRefMock.mockReset();
	});

	it("enters confirm mode on delete click", async () => {
		const setConfirmingDelete = vi.fn();
		const setDragOffset = vi.fn();
		const setDragging = vi.fn();
		useStateMock
			.mockReturnValueOnce([false, setConfirmingDelete])
			.mockReturnValueOnce([0, setDragOffset])
			.mockReturnValueOnce([false, setDragging]);
		useRefMock
			.mockReturnValueOnce({ current: null }) // trackRef
			.mockReturnValueOnce({ current: null }) // knobRef
			.mockReturnValueOnce({ current: null }) // pointerIdRef
			.mockReturnValueOnce({ current: 0 }) // dragOffsetRef
			.mockReturnValueOnce({ current: 0 }) // dragStartXRef
			.mockReturnValueOnce({ current: 0 }); // dragStartOffsetRef

		const { SlideDeleteButton } = await import("../SlideDeleteButton");
		const tree = SlideDeleteButton({ onDelete: vi.fn() });
		const deleteButton = findElement(
			tree,
			(el) => el.type === "button" && hasDeleteLabel(el.props?.children),
		);
		if (!deleteButton?.props?.onClick) throw new Error("missing delete button");

		(
			deleteButton.props.onClick as (e: { stopPropagation: () => void }) => void
		)({
			stopPropagation: vi.fn(),
		});

		expect(setConfirmingDelete).toHaveBeenCalledWith(true);
		expect(setDragOffset).toHaveBeenCalledWith(0);
		expect(setDragging).not.toHaveBeenCalled();
	});
});
