import { describe, expect, it, vi } from "vitest";

const {
	getIconForFileMock,
	getIconForFolderMock,
	getIconForOpenFolderMock,
	DEFAULT_FILE_MOCK,
} = vi.hoisted(() => ({
	getIconForFileMock: vi.fn(),
	getIconForFolderMock: vi.fn(),
	getIconForOpenFolderMock: vi.fn(),
	DEFAULT_FILE_MOCK: "default_file.svg",
}));

vi.mock("vscode-icons-js", () => ({
	DEFAULT_FILE: DEFAULT_FILE_MOCK,
	getIconForFile: getIconForFileMock,
	getIconForFolder: getIconForFolderMock,
	getIconForOpenFolder: getIconForOpenFolderMock,
}));

describe("vscodeIcons", () => {
	it("builds file icon src and falls back to default icon", async () => {
		getIconForFileMock.mockReturnValueOnce("ts.svg").mockReturnValueOnce(null);
		const { getFileIconSrc } = await import("../vscodeIcons");
		expect(getFileIconSrc("index.ts")).toContain("/ts.svg");
		expect(getFileIconSrc("README")).toContain(`/${DEFAULT_FILE_MOCK}`);
	});

	it("builds folder icon src using open/closed variant", async () => {
		getIconForFolderMock.mockReturnValue("folder.svg");
		getIconForOpenFolderMock.mockReturnValue("folder-open.svg");
		const { getFolderIconSrc } = await import("../vscodeIcons");
		expect(getFolderIconSrc("src", false)).toContain("/folder.svg");
		expect(getFolderIconSrc("src", true)).toContain("/folder-open.svg");
	});
});
