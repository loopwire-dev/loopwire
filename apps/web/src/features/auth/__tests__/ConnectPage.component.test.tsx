import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useStateMock,
	useEffectMock,
	useMemoMock,
	useNavigateMock,
	inviteBootstrapMock,
	inviteExchangeMock,
	useAppStoreMock,
} = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useEffectMock: vi.fn(),
	useMemoMock: vi.fn(),
	useNavigateMock: vi.fn(),
	inviteBootstrapMock: vi.fn(),
	inviteExchangeMock: vi.fn(),
	useAppStoreMock: vi.fn(),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useState: useStateMock,
		useEffect: useEffectMock,
		useMemo: useMemoMock,
	};
});

vi.mock("react-router-dom", () => ({
	useNavigate: useNavigateMock,
}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	inviteBootstrap: inviteBootstrapMock,
	inviteExchange: inviteExchangeMock,
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

describe("ConnectPage", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useEffectMock.mockReset();
		useMemoMock.mockReset();
		useNavigateMock.mockReset();
		inviteBootstrapMock.mockReset();
		inviteExchangeMock.mockReset();
		useAppStoreMock.mockReset();

		useEffectMock.mockImplementation((fn: () => undefined | (() => void)) =>
			fn(),
		);
		Object.defineProperty(window, "location", {
			value: { ...window.location, search: "" },
			configurable: true,
			writable: true,
		});
	});

	it("handles missing invite token", async () => {
		const setError = vi.fn();
		const setLoading = vi.fn();

		useNavigateMock.mockReturnValue(vi.fn());
		useAppStoreMock.mockImplementation(
			(selector: (state: { setToken: (token: string) => void }) => unknown) =>
				selector({ setToken: vi.fn() }),
		);
		useMemoMock.mockReturnValue(new URLSearchParams(""));
		useStateMock
			.mockReturnValueOnce([null, vi.fn()]) // hostId
			.mockReturnValueOnce([false, vi.fn()]) // pinRequired
			.mockReturnValueOnce(["", vi.fn()]) // pin
			.mockReturnValueOnce([true, setLoading]) // loading
			.mockReturnValueOnce([false, vi.fn()]) // submitting
			.mockReturnValueOnce([null, setError]); // error

		const { ConnectPage } = await import("../components/ConnectPage");
		ConnectPage();

		expect(setError).toHaveBeenCalledWith(
			"Missing invite token in the connection link.",
		);
		expect(setLoading).toHaveBeenCalledWith(false);
		expect(inviteBootstrapMock).not.toHaveBeenCalled();
	});

	it("auto exchanges when invite is valid and pin is not required", async () => {
		const navigate = vi.fn();
		const setToken = vi.fn();
		const setHostId = vi.fn();
		const setPinRequired = vi.fn();
		const setLoading = vi.fn();
		const setSubmitting = vi.fn();
		const setError = vi.fn();

		useNavigateMock.mockReturnValue(navigate);
		useAppStoreMock.mockImplementation(
			(selector: (state: { setToken: (token: string) => void }) => unknown) =>
				selector({ setToken }),
		);
		useMemoMock.mockReturnValue(new URLSearchParams("invite=abc"));
		useStateMock
			.mockReturnValueOnce([null, setHostId]) // hostId
			.mockReturnValueOnce([false, setPinRequired]) // pinRequired
			.mockReturnValueOnce(["", vi.fn()]) // pin
			.mockReturnValueOnce([true, setLoading]) // loading
			.mockReturnValueOnce([false, setSubmitting]) // submitting
			.mockReturnValueOnce([null, setError]); // error

		inviteBootstrapMock.mockResolvedValue({
			host_id: "host-1",
			pin_required: false,
		});
		inviteExchangeMock.mockResolvedValue({
			session_token: "sess-1",
			trusted_device_token: null,
			trusted_device_expires_at: null,
		});

		const { ConnectPage } = await import("../components/ConnectPage");
		ConnectPage();
		await Promise.resolve();
		await Promise.resolve();

		expect(inviteBootstrapMock).toHaveBeenCalledWith("abc");
		expect(setHostId).toHaveBeenCalledWith("host-1");
		expect(setPinRequired).toHaveBeenCalledWith(false);
		expect(inviteExchangeMock).toHaveBeenCalledWith({
			invite_token: "abc",
			pin: null,
			trusted_device_token: null,
		});
		expect(setToken).toHaveBeenCalledWith("sess-1");
		expect(navigate).toHaveBeenCalledWith("/", { replace: true });
		expect(setSubmitting).toHaveBeenCalledWith(true);
		expect(setError).toHaveBeenCalledWith(null);
	});

	it("uses trusted-device token when pin is required", async () => {
		const navigate = vi.fn();
		const setToken = vi.fn();
		const setHostId = vi.fn();
		const setPinRequired = vi.fn();
		const setSubmitting = vi.fn();
		const setError = vi.fn();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

		localStorage.setItem(
			"loopwire_trusted_devices",
			JSON.stringify({
				"host-2": {
					token: "trusted-abc",
					expiresAt: "2099-01-01T00:00:00.000Z",
				},
			}),
		);

		useNavigateMock.mockReturnValue(navigate);
		useAppStoreMock.mockImplementation(
			(selector: (state: { setToken: (token: string) => void }) => unknown) =>
				selector({ setToken }),
		);
		useMemoMock.mockReturnValue(new URLSearchParams("invite=def"));
		useStateMock
			.mockReturnValueOnce([null, setHostId]) // hostId
			.mockReturnValueOnce([false, setPinRequired]) // pinRequired
			.mockReturnValueOnce(["", vi.fn()]) // pin
			.mockReturnValueOnce([true, vi.fn()]) // loading
			.mockReturnValueOnce([false, setSubmitting]) // submitting
			.mockReturnValueOnce([null, setError]); // error

		inviteBootstrapMock.mockResolvedValue({
			host_id: "host-2",
			pin_required: true,
		});
		inviteExchangeMock.mockResolvedValue({
			session_token: "sess-2",
			trusted_device_token: null,
			trusted_device_expires_at: null,
		});

		const { ConnectPage } = await import("../components/ConnectPage");
		ConnectPage();
		await Promise.resolve();
		await Promise.resolve();

		expect(setHostId).toHaveBeenCalledWith("host-2");
		expect(setPinRequired).toHaveBeenCalledWith(true);
		expect(inviteExchangeMock).toHaveBeenCalledWith({
			invite_token: "def",
			pin: null,
			trusted_device_token: "trusted-abc",
		});
		expect(setToken).toHaveBeenCalledWith("sess-2");
		expect(navigate).toHaveBeenCalledWith("/", { replace: true });
		expect(setSubmitting).toHaveBeenCalledWith(true);
		expect(setError).toHaveBeenCalledWith(null);
		nowSpy.mockRestore();
	});

	it("surfaces exchange errors and stops submitting/loading", async () => {
		const setSubmitting = vi.fn();
		const setLoading = vi.fn();
		const setError = vi.fn();

		useNavigateMock.mockReturnValue(vi.fn());
		useAppStoreMock.mockImplementation(
			(selector: (state: { setToken: (token: string) => void }) => unknown) =>
				selector({ setToken: vi.fn() }),
		);
		useMemoMock.mockReturnValue(new URLSearchParams("invite=ghi"));
		useStateMock
			.mockReturnValueOnce([null, vi.fn()]) // hostId
			.mockReturnValueOnce([false, vi.fn()]) // pinRequired
			.mockReturnValueOnce(["", vi.fn()]) // pin
			.mockReturnValueOnce([true, setLoading]) // loading
			.mockReturnValueOnce([false, setSubmitting]) // submitting
			.mockReturnValueOnce([null, setError]); // error

		inviteBootstrapMock.mockResolvedValue({
			host_id: "host-3",
			pin_required: false,
		});
		inviteExchangeMock.mockRejectedValue(new Error("boom"));

		const { ConnectPage } = await import("../components/ConnectPage");
		ConnectPage();
		await Promise.resolve();
		await Promise.resolve();

		expect(inviteExchangeMock).toHaveBeenCalledWith({
			invite_token: "ghi",
			pin: null,
			trusted_device_token: null,
		});
		expect(setError).toHaveBeenCalledWith("boom");
		expect(setSubmitting).toHaveBeenCalledWith(false);
		expect(setLoading).toHaveBeenCalledWith(false);
	});

	it("requires manual pin when trusted token is expired", async () => {
		const setLoading = vi.fn();
		const setPinRequired = vi.fn();
		const setError = vi.fn();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

		localStorage.setItem(
			"loopwire_trusted_devices",
			JSON.stringify({
				"host-4": {
					token: "expired-token",
					expiresAt: "2000-01-01T00:00:00.000Z",
				},
			}),
		);

		useNavigateMock.mockReturnValue(vi.fn());
		useAppStoreMock.mockImplementation(
			(selector: (state: { setToken: (token: string) => void }) => unknown) =>
				selector({ setToken: vi.fn() }),
		);
		useMemoMock.mockReturnValue(new URLSearchParams("invite=jkl"));
		useStateMock
			.mockReturnValueOnce([null, vi.fn()]) // hostId
			.mockReturnValueOnce([false, setPinRequired]) // pinRequired
			.mockReturnValueOnce(["", vi.fn()]) // pin
			.mockReturnValueOnce([true, setLoading]) // loading
			.mockReturnValueOnce([false, vi.fn()]) // submitting
			.mockReturnValueOnce([null, setError]); // error

		inviteBootstrapMock.mockResolvedValue({
			host_id: "host-4",
			pin_required: true,
		});

		const { ConnectPage } = await import("../components/ConnectPage");
		ConnectPage();
		await Promise.resolve();
		await Promise.resolve();

		expect(setPinRequired).toHaveBeenCalledWith(true);
		expect(inviteExchangeMock).not.toHaveBeenCalled();
		expect(setLoading).toHaveBeenCalledWith(false);
		expect(setError).toHaveBeenCalledWith(null);
		const trustedDevices = localStorage.getItem("loopwire_trusted_devices");
		expect(trustedDevices).not.toContain("expired-token");
		nowSpy.mockRestore();
	});
});
