import { beforeEach, describe, expect, it, vi } from "vitest";

const { useAppStoreMock, NavigateMock } = vi.hoisted(() => ({
	useAppStoreMock: vi.fn(),
	NavigateMock: vi.fn(),
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

vi.mock("react-router-dom", () => ({
	Navigate: NavigateMock,
}));

describe("AuthGuard", () => {
	beforeEach(() => {
		vi.resetModules();
		useAppStoreMock.mockReset();
		NavigateMock.mockReset();
	});

	it("returns null while token exchange is in progress", async () => {
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					token: string | null;
					exchangingToken: boolean;
				}) => unknown,
			) => selector({ token: null, exchangingToken: true }),
		);
		const { AuthGuard } = await import("../components/AuthGuard");
		expect(AuthGuard({ children: "child" })).toBeNull();
	});

	it("redirects to /auth when no token", async () => {
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					token: string | null;
					exchangingToken: boolean;
				}) => unknown,
			) => selector({ token: null, exchangingToken: false }),
		);
		const { AuthGuard } = await import("../components/AuthGuard");
		const tree = AuthGuard({ children: "child" });
		expect(tree?.type).toBe(NavigateMock);
		expect(tree?.props.to).toBe("/auth");
		expect(tree?.props.replace).toBe(true);
	});

	it("renders children when token exists", async () => {
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					token: string | null;
					exchangingToken: boolean;
				}) => unknown,
			) => selector({ token: "sess", exchangingToken: false }),
		);
		const { AuthGuard } = await import("../components/AuthGuard");
		const tree = AuthGuard({ children: "child" });
		expect(tree?.props.children).toBe("child");
	});
});
