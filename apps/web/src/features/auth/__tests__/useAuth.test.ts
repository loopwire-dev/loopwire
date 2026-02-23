import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useEffectMock,
	useRefMock,
	useNavigateMock,
	authExchangeMock,
	authRevokeMock,
	authRotateMock,
	useAppStoreMock,
	logoutStoreMock,
	setTokenMock,
	setExchangingTokenMock,
} = vi.hoisted(() => ({
	useEffectMock: vi.fn(),
	useRefMock: vi.fn(),
	useNavigateMock: vi.fn(),
	authExchangeMock: vi.fn(),
	authRevokeMock: vi.fn(),
	authRotateMock: vi.fn(),
	useAppStoreMock: vi.fn(),
	logoutStoreMock: vi.fn(),
	setTokenMock: vi.fn(),
	setExchangingTokenMock: vi.fn(),
}));

let storeState = {
	token: null as string | null,
	exchangingToken: false,
	setToken: setTokenMock,
	setExchangingToken: setExchangingTokenMock,
};

const mockedWindow = {
	location: {
		pathname: "/",
		search: "",
		hash: "",
		href: "http://localhost/",
	},
	history: {
		replaceState: vi.fn(),
	},
};

vi.mock("react", () => ({
	useEffect: useEffectMock,
	useRef: useRefMock,
}));

vi.mock("react-router-dom", () => ({
	useNavigate: () => useNavigateMock,
}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	authExchange: authExchangeMock,
	authRevoke: authRevokeMock,
	authRotate: authRotateMock,
}));

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: Object.assign(
		(selector: (s: typeof storeState) => unknown) => useAppStoreMock(selector),
		{
			getState: () => ({ logout: logoutStoreMock }),
		},
	),
}));

describe("useAuth", () => {
	const setUrl = (url: string) => {
		const parsed = new URL(url, "http://localhost");
		mockedWindow.location.pathname = parsed.pathname;
		mockedWindow.location.search = parsed.search;
		mockedWindow.location.hash = parsed.hash;
		mockedWindow.location.href = parsed.toString();
	};

	beforeEach(() => {
		vi.resetModules();
		useEffectMock.mockReset();
		useRefMock.mockReset();
		useNavigateMock.mockReset();
		authExchangeMock.mockReset();
		authRevokeMock.mockReset();
		authRotateMock.mockReset();
		useAppStoreMock.mockReset();
		logoutStoreMock.mockReset();
		setTokenMock.mockReset();
		setExchangingTokenMock.mockReset();
		storeState = {
			token: null,
			exchangingToken: false,
			setToken: setTokenMock,
			setExchangingToken: setExchangingTokenMock,
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof storeState) => unknown) => selector(storeState),
		);
		useEffectMock.mockImplementation((fn: () => void) => fn());
		useRefMock.mockImplementation((value: unknown) => ({ current: value }));
		mockedWindow.history.replaceState.mockReset();
		vi.stubGlobal("window", mockedWindow);
		setUrl("/");
	});

	it("waits for daemon before exchanging bootstrap token", async () => {
		setUrl("/?token=boot");
		const { useAuth } = await import("../hooks/useAuth");
		useAuth({ daemonAvailable: false });
		expect(setExchangingTokenMock).toHaveBeenCalledWith(true);
		expect(authExchangeMock).not.toHaveBeenCalled();
	});

	it("exchanges bootstrap token and navigates from /auth", async () => {
		setUrl("/auth?token=boot");
		authExchangeMock.mockResolvedValue({ session_token: "sess-1" });
		const { useAuth } = await import("../hooks/useAuth");
		useAuth({ daemonAvailable: true });
		await Promise.resolve();
		expect(authExchangeMock).toHaveBeenCalledWith("boot");
		expect(setTokenMock).toHaveBeenCalledWith("sess-1");
		expect(useNavigateMock).toHaveBeenCalledWith("/");
	});

	it("navigates to auth when unauthenticated and no bootstrap token", async () => {
		setUrl("/");
		const { useAuth } = await import("../hooks/useAuth");
		useAuth({ daemonAvailable: true });
		expect(useNavigateMock).toHaveBeenCalledWith("/auth");
	});

	it("logout revokes then clears local store and navigates", async () => {
		authRevokeMock.mockResolvedValue(undefined);
		const { useAuth } = await import("../hooks/useAuth");
		const hook = useAuth({ daemonAvailable: true });
		await hook.logout();
		expect(authRevokeMock).toHaveBeenCalledTimes(1);
		expect(logoutStoreMock).toHaveBeenCalledTimes(1);
		expect(useNavigateMock).toHaveBeenCalledWith("/auth");
	});

	it("rotate updates token from daemon response", async () => {
		authRotateMock.mockResolvedValue({ session_token: "rotated" });
		const { useAuth } = await import("../hooks/useAuth");
		const hook = useAuth({ daemonAvailable: true });
		await hook.rotate();
		expect(setTokenMock).toHaveBeenCalledWith("rotated");
	});
});
