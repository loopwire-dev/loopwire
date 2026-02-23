import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRootMock, renderMock, getElementByIdMock } = vi.hoisted(() => ({
	createRootMock: vi.fn(),
	renderMock: vi.fn(),
	getElementByIdMock: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
	createRoot: createRootMock,
}));

vi.mock("../App", () => ({
	App: () => null,
}));

describe("main bootstrap", () => {
	beforeEach(() => {
		vi.resetModules();
		createRootMock.mockReset();
		renderMock.mockReset();
		getElementByIdMock.mockReset();
		createRootMock.mockReturnValue({ render: renderMock });
		Object.defineProperty(globalThis, "document", {
			value: { getElementById: getElementByIdMock },
			configurable: true,
			writable: true,
		});
	});

	it("creates root and renders app tree when #root exists", async () => {
		getElementByIdMock.mockReturnValue({ id: "root" });

		await import("../main");

		expect(getElementByIdMock).toHaveBeenCalledWith("root");
		expect(createRootMock).toHaveBeenCalledTimes(1);
		expect(renderMock).toHaveBeenCalledTimes(1);
	});

	it("throws when #root is missing", async () => {
		getElementByIdMock.mockReturnValue(null);
		await expect(import("../main")).rejects.toThrow(
			"Root element #root was not found",
		);
	});
});
