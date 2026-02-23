import { beforeEach, describe, expect, it, vi } from "vitest";

const { useThemeMock } = vi.hoisted(() => ({
	useThemeMock: vi.fn(),
}));

vi.mock("next-themes", () => ({
	useTheme: useThemeMock,
}));

type ElementLike = {
	type?: unknown;
	props?: {
		children?: unknown;
		[key: string]: unknown;
	};
};

function asElementLike(node: unknown): ElementLike | null {
	if (!node || typeof node !== "object") return null;
	return node as ElementLike;
}

function visit(node: unknown, fn: (value: ElementLike) => void) {
	if (!node || typeof node !== "object") return;
	const element = asElementLike(node);
	if (!element) return;
	fn(element);
	const children = element.props?.children;
	if (Array.isArray(children)) {
		for (const child of children) visit(child, fn);
	} else {
		visit(children, fn);
	}
}

function nodeText(node: unknown): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	const element = asElementLike(node);
	if (!element) return "";
	const children = element.props?.children;
	if (Array.isArray(children)) return children.map(nodeText).join("");
	return nodeText(children);
}

function findElement(
	root: unknown,
	predicate: (value: ElementLike) => boolean,
): ElementLike | null {
	let match: ElementLike | null = null;
	visit(root, (value) => {
		if (!match && predicate(value)) match = value;
	});
	return match;
}

function getProp(element: ElementLike | null, key: string): unknown {
	return element?.props?.[key];
}

function click(element: ElementLike | null) {
	const onClick = getProp(element, "onClick");
	if (typeof onClick === "function") {
		onClick();
	}
}

describe("LandingPage", () => {
	beforeEach(() => {
		vi.resetModules();
		useThemeMock.mockReset();
		vi.useFakeTimers();
		Object.defineProperty(globalThis, "navigator", {
			value: {
				clipboard: {
					writeText: vi.fn().mockResolvedValue(undefined),
				},
			},
			configurable: true,
		});
	});

	it("toggles theme and starts discovery", async () => {
		const setTheme = vi.fn();
		const onEnableDiscovery = vi.fn();
		useThemeMock.mockReturnValue({ resolvedTheme: "dark", setTheme });

		const { LandingPage } = await import("../components/LandingPage");
		const tree = LandingPage({
			discoveryEnabled: false,
			onEnableDiscovery,
		});

		const themeButton = findElement(
			tree,
			(node) =>
				node?.type === "button" &&
				node?.props?.["aria-label"] === "Switch to light mode",
		);
		expect(themeButton).toBeTruthy();
		click(themeButton);
		expect(setTheme).toHaveBeenCalledWith("light");

		const scanButton = findElement(
			tree,
			(node) =>
				typeof node?.props?.onClick === "function" &&
				node?.props?.disabled === false &&
				nodeText(node).includes("Scan for machine"),
		);
		expect(scanButton).toBeTruthy();
		click(scanButton);
		expect(onEnableDiscovery).toHaveBeenCalledTimes(1);

		vi.runAllTimers();
	});

	it("shows scanning state when discovery is enabled", async () => {
		useThemeMock.mockReturnValue({ resolvedTheme: "light", setTheme: vi.fn() });

		const { LandingPage } = await import("../components/LandingPage");
		const tree = LandingPage({
			discoveryEnabled: true,
			onEnableDiscovery: vi.fn(),
		});

		const scanButton = findElement(
			tree,
			(node) =>
				node?.props?.disabled === true &&
				nodeText(node).includes("Scanning for machine..."),
		);

		expect(scanButton).toBeTruthy();
	});
});
