import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceIcon } from "../components/WorkspaceIcon";

const { isThemeMaskDisabledMock, stripMaskMetadataMock, isEmojiShortcodeMock } =
	vi.hoisted(() => ({
		isThemeMaskDisabledMock: vi.fn(),
		stripMaskMetadataMock: vi.fn(),
		isEmojiShortcodeMock: vi.fn(),
	}));

vi.mock("../../../shared/lib/icon-masking", () => ({
	isThemeMaskDisabled: isThemeMaskDisabledMock,
	stripMaskMetadata: stripMaskMetadataMock,
}));

vi.mock("../lib/workspaceSidebarUtils", () => ({
	isEmojiShortcode: isEmojiShortcodeMock,
}));

describe("WorkspaceIcon", () => {
	beforeEach(() => {
		isThemeMaskDisabledMock.mockReset();
		stripMaskMetadataMock.mockReset();
		isEmojiShortcodeMock.mockReset();
	});

	it("renders folder icon when icon is missing", () => {
		const tree = WorkspaceIcon({ icon: null });
		expect(tree.props.className).toContain("text-muted");
	});

	it("renders shortcode badge", () => {
		isEmojiShortcodeMock.mockReturnValue(true);
		const tree = WorkspaceIcon({ icon: ":rocket:" });
		expect(tree.props.children).toBe(":rocket:");
	});

	it("renders image icon and strips metadata", () => {
		isEmojiShortcodeMock.mockReturnValue(false);
		isThemeMaskDisabledMock.mockReturnValue(false);
		stripMaskMetadataMock.mockReturnValue("data:image/png;base64,AAAA");
		const tree = WorkspaceIcon({ icon: "data:image/png;base64,masked" });
		const img = tree.props.children;
		expect(stripMaskMetadataMock).toHaveBeenCalled();
		expect(img.props.src).toBe("data:image/png;base64,AAAA");
		expect(img.props.className).toContain("grayscale");
	});

	it("renders plain icon text fallback", () => {
		isEmojiShortcodeMock.mockReturnValue(false);
		const tree = WorkspaceIcon({ icon: "A" });
		expect(tree.props.children).toBe("A");
	});
});
