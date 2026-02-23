import { beforeEach, describe, expect, it, vi } from "vitest";

const { useStateMock, useNavigateMock, authExchangeMock, useAppStoreMock } =
	vi.hoisted(() => ({
		useStateMock: vi.fn(),
		useNavigateMock: vi.fn(),
		authExchangeMock: vi.fn(),
		useAppStoreMock: vi.fn(),
	}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return { ...actual, useState: useStateMock };
});

vi.mock("react-router-dom", () => ({
	useNavigate: useNavigateMock,
}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	authExchange: authExchangeMock,
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

describe("AuthPage", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useNavigateMock.mockReset();
		authExchangeMock.mockReset();
		useAppStoreMock.mockReset();
	});

	it("exchanges token and navigates on success", async () => {
		const setToken = vi.fn();
		const navigate = vi.fn();
		const setError = vi.fn();
		const setLoading = vi.fn();

		useNavigateMock.mockReturnValue(navigate);
		useAppStoreMock.mockImplementation(
			(selector: (state: { setToken: (token: string) => void }) => unknown) =>
				selector({ setToken }),
		);
		useStateMock
			.mockReturnValueOnce(["bootstrap-token", vi.fn()])
			.mockReturnValueOnce([null, setError])
			.mockReturnValueOnce([false, setLoading]);
		authExchangeMock.mockResolvedValue({ session_token: "session-token" });

		const { AuthPage } = await import("../components/AuthPage");
		const tree = AuthPage();
		const form = tree.props.children.props.children[2];

		await form.props.onSubmit({ preventDefault: vi.fn() });

		expect(authExchangeMock).toHaveBeenCalledWith("bootstrap-token");
		expect(setToken).toHaveBeenCalledWith("session-token");
		expect(navigate).toHaveBeenCalledWith("/");
		expect(setLoading).toHaveBeenCalledWith(false);
	});

	it("sets error on exchange failure", async () => {
		const navigate = vi.fn();
		const setError = vi.fn();
		const setLoading = vi.fn();

		useNavigateMock.mockReturnValue(navigate);
		useAppStoreMock.mockImplementation(
			(selector: (state: { setToken: (token: string) => void }) => unknown) =>
				selector({ setToken: vi.fn() }),
		);
		useStateMock
			.mockReturnValueOnce(["bad-token", vi.fn()])
			.mockReturnValueOnce([null, setError])
			.mockReturnValueOnce([false, setLoading]);
		authExchangeMock.mockRejectedValue(new Error("boom"));

		const { AuthPage } = await import("../components/AuthPage");
		const tree = AuthPage();
		const form = tree.props.children.props.children[2];

		await form.props.onSubmit({ preventDefault: vi.fn() });

		expect(setError).toHaveBeenCalledWith("boom");
		expect(navigate).not.toHaveBeenCalled();
		expect(setLoading).toHaveBeenCalledWith(false);
	});
});
