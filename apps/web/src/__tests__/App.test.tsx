import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useStateMock,
	useAuthMock,
	useDaemonAvailableMock,
	enableManualDiscoveryMock,
	isManualDiscoveryEnabledMock,
	LandingPageMock,
	AppRoutesMock,
} = vi.hoisted(() => ({
	useStateMock: vi.fn(),
	useAuthMock: vi.fn(),
	useDaemonAvailableMock: vi.fn(),
	enableManualDiscoveryMock: vi.fn(),
	isManualDiscoveryEnabledMock: false,
	LandingPageMock: vi.fn(),
	AppRoutesMock: vi.fn(),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useState: useStateMock,
	};
});

vi.mock("../features/auth/hooks/useAuth", () => ({
	useAuth: useAuthMock,
}));

vi.mock("../shared/hooks/useDaemonAvailable", () => ({
	useDaemonAvailable: useDaemonAvailableMock,
}));

vi.mock("../shared/lib/runtime/config", () => ({
	enableManualDiscovery: enableManualDiscoveryMock,
	isManualDiscoveryEnabled: isManualDiscoveryEnabledMock,
}));

vi.mock("../features/landing/components/LandingPage", () => ({
	LandingPage: LandingPageMock,
}));

vi.mock("../routes", () => ({
	AppRoutes: AppRoutesMock,
}));

describe("App", () => {
	const setLocation = (value: Partial<Location>) => {
		Object.defineProperty(window, "location", {
			value: {
				...window.location,
				pathname: "/",
				search: "",
				hash: "",
				...value,
			},
			writable: true,
			configurable: true,
		});
	};

	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useAuthMock.mockReset();
		useDaemonAvailableMock.mockReset();
		enableManualDiscoveryMock.mockReset();
		LandingPageMock.mockReset();
		AppRoutesMock.mockReset();

		useStateMock.mockReturnValue([false, vi.fn()]);
		useDaemonAvailableMock.mockReturnValue(true);
		setLocation({});
	});

	it("returns null while daemon availability probe is in progress", async () => {
		useDaemonAvailableMock.mockReturnValue(null);
		const { App } = await import("../App");
		expect(App()).toBeNull();
		expect(useAuthMock).toHaveBeenCalledWith({ daemonAvailable: null });
	});

	it("renders landing page when daemon is unreachable on app routes", async () => {
		useDaemonAvailableMock.mockReturnValue(false);
		setLocation({ pathname: "/workspace", search: "?token=abc" });

		const { App } = await import("../App");
		const tree = App();
		expect(tree).toBeTruthy();
		expect(useAuthMock).toHaveBeenCalledWith({ daemonAvailable: false });
		expect(tree?.type).toBe(LandingPageMock);
		expect(tree?.props.arrivedViaTokenLink).toBe(true);
		expect(tree?.props.discoveryEnabled).toBe(false);
	});

	it("extracts bootstrap token from hash query", async () => {
		useDaemonAvailableMock.mockReturnValue(false);
		setLocation({
			pathname: "/workspace",
			search: "",
			hash: "#/x?token=fromhash",
		});

		const { App } = await import("../App");
		const tree = App();
		expect(tree?.props.arrivedViaTokenLink).toBe(true);
	});

	it("does not show landing page on auth routes even when daemon is down", async () => {
		useDaemonAvailableMock.mockReturnValue(false);
		setLocation({ pathname: "/auth", search: "", hash: "" });

		const { App } = await import("../App");
		const tree = App();
		expect(tree?.type).toBe("div");
		expect(tree?.props.children.type).toBe(AppRoutesMock);
	});

	it("enables manual discovery via landing page callback", async () => {
		const setManualDiscoveryEnabled = vi.fn();
		useStateMock.mockReturnValue([false, setManualDiscoveryEnabled]);
		useDaemonAvailableMock.mockReturnValue(false);

		setLocation({ pathname: "/workspace" });

		const { App } = await import("../App");
		const tree = App();
		tree?.props.onEnableDiscovery();
		expect(enableManualDiscoveryMock).toHaveBeenCalledTimes(1);
		expect(setManualDiscoveryEnabled).toHaveBeenCalledWith(true);
	});
});
