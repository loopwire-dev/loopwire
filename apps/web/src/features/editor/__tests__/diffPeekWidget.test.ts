// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GutterRange } from "../hooks/useGitGutter";
import { DiffPeekWidget } from "../lib/diffPeekWidget";

type ZoneAccessor = {
	addZone: ReturnType<typeof vi.fn>;
	removeZone: ReturnType<typeof vi.fn>;
};

function createEditorMock() {
	const root = document.createElement("div");
	const overflowGuard = document.createElement("div");
	overflowGuard.className = "overflow-guard";
	root.appendChild(overflowGuard);

	const zoneAccessor: ZoneAccessor = {
		addZone: vi.fn().mockReturnValue("zone-1"),
		removeZone: vi.fn(),
	};
	const changeViewZones = vi.fn((cb: (accessor: ZoneAccessor) => void) =>
		cb(zoneAccessor),
	);
	const scrollDispose = vi.fn();
	const layoutDispose = vi.fn();
	const onDidScrollChange = vi.fn().mockReturnValue({ dispose: scrollDispose });
	const onDidLayoutChange = vi.fn().mockReturnValue({ dispose: layoutDispose });
	const revealLineInCenter = vi.fn();
	const getDomNode = vi.fn().mockReturnValue(root);
	const getLayoutInfo = vi.fn().mockReturnValue({
		contentLeft: 40,
		contentWidth: 600,
		verticalScrollbarWidth: 12,
	});
	const getTopForLineNumber = vi.fn().mockReturnValue(300);
	const getScrollTop = vi.fn().mockReturnValue(100);

	const editor = {
		changeViewZones,
		onDidScrollChange,
		onDidLayoutChange,
		revealLineInCenter,
		getDomNode,
		getLayoutInfo,
		getTopForLineNumber,
		getScrollTop,
	};

	return {
		editor,
		overflowGuard,
		zoneAccessor,
		scrollDispose,
		layoutDispose,
		revealLineInCenter,
		getTopForLineNumber,
	};
}

const ranges: GutterRange[] = [
	{
		kind: "modified",
		startLine: 3,
		endLine: 4,
		content: { oldLines: ["old-a"], newLines: ["new-a"] },
	},
	{
		kind: "added",
		startLine: 10,
		endLine: 10,
		content: { oldLines: [], newLines: ["new-b"] },
	},
];

describe("DiffPeekWidget", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("opens widget, renders diff rows, and closes with cleanup", () => {
		const {
			editor,
			overflowGuard,
			zoneAccessor,
			scrollDispose,
			layoutDispose,
			revealLineInCenter,
			getTopForLineNumber,
		} = createEditorMock();

		const widget = new DiffPeekWidget(editor as never, false);
		widget.open(ranges, 0);

		expect(widget.openIndex).toBe(0);
		expect(zoneAccessor.addZone).toHaveBeenCalledTimes(1);
		expect(revealLineInCenter).toHaveBeenCalledWith(3);
		expect(getTopForLineNumber).toHaveBeenCalledWith(5);

		const overlay = overflowGuard.querySelector(".diff-peek-widget");
		expect(overlay).toBeTruthy();
		expect(overlay?.textContent).toContain("Modified");
		expect(overlay?.textContent).toContain("1 of 2 changes");
		expect(overlay?.textContent).toContain("old-a");
		expect(overlay?.textContent).toContain("new-a");

		widget.close();
		expect(widget.openIndex).toBeNull();
		expect(scrollDispose).toHaveBeenCalledTimes(1);
		expect(layoutDispose).toHaveBeenCalledTimes(1);
		expect(zoneAccessor.removeZone).toHaveBeenCalledWith("zone-1");
		expect(overflowGuard.querySelector(".diff-peek-widget")).toBeNull();
	});

	it("navigates with header buttons and blocks out-of-range navigation", () => {
		const { editor, overflowGuard } = createEditorMock();
		const widget = new DiffPeekWidget(editor as never, false);
		widget.open(ranges, 0);

		const nextButton = overflowGuard.querySelectorAll("button")[1];
		expect(nextButton).toBeTruthy();
		(nextButton as HTMLButtonElement).click();

		expect(widget.openIndex).toBe(1);
		const prevAfterSecondOpen = overflowGuard.querySelectorAll("button")[0];
		expect((prevAfterSecondOpen as HTMLButtonElement).disabled).toBe(false);

		const nextAfterSecondOpen = overflowGuard.querySelectorAll("button")[1];
		expect((nextAfterSecondOpen as HTMLButtonElement).disabled).toBe(true);
		(nextAfterSecondOpen as HTMLButtonElement).click();
		expect(widget.openIndex).toBe(1);
	});

	it("renders empty fallback and clears index for invalid range", () => {
		const { editor, overflowGuard, zoneAccessor } = createEditorMock();
		const widget = new DiffPeekWidget(editor as never, true);
		const emptyRanges: GutterRange[] = [
			{
				kind: "deleted",
				startLine: 7,
				endLine: 7,
				content: { oldLines: [], newLines: [] },
			},
		];

		widget.open(emptyRanges, 0);
		expect(overflowGuard.textContent).toContain("(no content)");

		widget.open(emptyRanges, 99);
		expect(widget.openIndex).toBeNull();
		expect(zoneAccessor.addZone).toHaveBeenCalledTimes(1);
	});
});
