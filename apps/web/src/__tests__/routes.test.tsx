import { describe, expect, it, vi } from "vitest";

vi.mock("../features/auth/components/AuthGuard", () => ({
	AuthGuard: ({ children }: { children: unknown }) => children,
}));
vi.mock("../features/auth/components/AuthPage", () => ({
	AuthPage: () => null,
}));
vi.mock("../features/auth/components/ConnectPage", () => ({
	ConnectPage: () => null,
}));
vi.mock("../shared/layout/AppLayout", () => ({
	AppLayout: () => null,
}));

describe("AppRoutes", () => {
	it("declares auth, connect and fallback routes", async () => {
		const { AppRoutes } = await import("../routes");
		const tree = AppRoutes();
		expect(tree.type).toBeTruthy();

		const children = tree.props.children as Array<{
			props: { path: string; element: { type: unknown; props?: unknown } };
		}>;
		expect(children).toHaveLength(3);
		expect(children[0]?.props.path).toBe("/auth");
		expect(children[1]?.props.path).toBe("/connect");
		expect(children[2]?.props.path).toBe("*");
	});
});
