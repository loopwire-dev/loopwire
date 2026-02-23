import { describe, expect, it, vi } from "vitest";

const { useAppStoreMock } = vi.hoisted(() => ({
	useAppStoreMock: vi.fn(),
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

describe("useEditor", () => {
	it("maps store values and computes file extension", async () => {
		const clearOpenFile = vi.fn();
		const state = {
			openFilePath: "/repo/src/main.tsx",
			openFileContent: "const x = 1;",
			openFileImageSrc: null,
			clearOpenFile,
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);

		const { useEditor } = await import("../hooks/useEditor");
		const result = useEditor();

		expect(result.filePath).toBe("/repo/src/main.tsx");
		expect(result.content).toBe("const x = 1;");
		expect(result.imageSrc).toBeNull();
		expect(result.extension).toBe("tsx");
		result.close();
		expect(clearOpenFile).toHaveBeenCalledTimes(1);
	});
});
