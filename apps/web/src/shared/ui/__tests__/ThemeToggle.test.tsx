import { beforeEach, describe, expect, it, vi } from "vitest";

const { useThemeMock, getNextThemeMock } = vi.hoisted(() => ({
	useThemeMock: vi.fn(),
	getNextThemeMock: vi.fn(),
}));

vi.mock("next-themes", () => ({
	useTheme: useThemeMock,
}));

vi.mock("../../lib/runtime/theme", () => ({
	getNextTheme: getNextThemeMock,
}));

describe("ThemeToggle", () => {
	beforeEach(() => {
		vi.resetModules();
		useThemeMock.mockReset();
		getNextThemeMock.mockReset();
	});

	it("cycles to the next theme when clicked", async () => {
		const setTheme = vi.fn();
		useThemeMock.mockReturnValue({ theme: "dark", setTheme });
		getNextThemeMock.mockReturnValue("light");

		const { ThemeToggle } = await import("../ThemeToggle");
		const tree = ThemeToggle();

		expect(tree.props.title).toBe("Theme: dark");
		tree.props.onClick();
		expect(getNextThemeMock).toHaveBeenCalledWith("dark");
		expect(setTheme).toHaveBeenCalledWith("light");
	});

	it("falls back to system theme label when theme is nullish", async () => {
		const setTheme = vi.fn();
		useThemeMock.mockReturnValue({ theme: null, setTheme });
		getNextThemeMock.mockReturnValue("dark");

		const { ThemeToggle } = await import("../ThemeToggle");
		const tree = ThemeToggle();

		tree.props.onClick();
		expect(getNextThemeMock).toHaveBeenCalledWith("system");
		expect(setTheme).toHaveBeenCalledWith("dark");
	});
});
