import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useEffectMock,
	useStateMock,
	useThemeMock,
	useAppStoreMock,
	DialogMock,
} = vi.hoisted(() => ({
	useEffectMock: vi.fn(),
	useStateMock: vi.fn(),
	useThemeMock: vi.fn(),
	useAppStoreMock: vi.fn(),
	DialogMock: vi.fn(),
}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useEffect: useEffectMock,
		useState: useStateMock,
	};
});

vi.mock("next-themes", () => ({
	useTheme: useThemeMock,
}));

vi.mock("../../stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

vi.mock("../../lib/daemon/rest", () => ({
	health: vi.fn(),
	remoteShareStart: vi.fn(),
	remoteShareStatus: vi.fn(),
	remoteShareStop: vi.fn(),
}));

vi.mock("../../ui/Dialog", () => ({
	Dialog: DialogMock,
}));

function visit(node: unknown, fn: (value: Record<string, unknown>) => void) {
	if (!node || typeof node !== "object") return;
	const value = node as Record<string, unknown>;
	fn(value);
	const props = value.props as Record<string, unknown> | undefined;
	const children = props?.children;
	if (Array.isArray(children)) {
		for (const child of children) visit(child, fn);
	} else {
		visit(children, fn);
	}
}

function textOf(node: unknown): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (!node || typeof node !== "object") return "";
	const props = (node as Record<string, unknown>).props as
		| Record<string, unknown>
		| undefined;
	const children = props?.children;
	if (Array.isArray(children)) return children.map(textOf).join("");
	return textOf(children);
}

function findButtonByText(
	tree: unknown,
	label: string,
): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		if (found || node.type !== "button") return;
		if (textOf(node).includes(label)) found = node;
	});
	return found;
}

function findFunctionElementByName(
	tree: unknown,
	name: string,
): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		if (found || typeof node.type !== "function") return;
		if ((node.type as { name?: string }).name === name) found = node;
	});
	return found;
}

describe("SettingsDialog", () => {
	beforeEach(() => {
		vi.resetModules();
		useEffectMock.mockReset();
		useStateMock.mockReset();
		useThemeMock.mockReset();
		useAppStoreMock.mockReset();
		DialogMock.mockReset();

		useEffectMock.mockImplementation(() => {});
		DialogMock.mockImplementation(
			(props: { children: unknown }) => props.children,
		);
	});

	it("renders general section and handles theme + section switch", async () => {
		const setSettingsOpen = vi.fn();
		const setTheme = vi.fn();
		const setActiveSection = vi.fn();
		useThemeMock.mockReturnValue({ theme: "system", setTheme });
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					settingsOpen: boolean;
					setSettingsOpen: (open: boolean) => void;
					logout: () => void;
				}) => unknown,
			) =>
				selector({
					settingsOpen: true,
					setSettingsOpen,
					logout: vi.fn(),
				}),
		);
		useStateMock
			.mockReturnValueOnce(["general", setActiveSection])
			.mockReturnValueOnce(["1234", vi.fn()])
			.mockReturnValueOnce([false, vi.fn()])
			.mockReturnValueOnce([null, vi.fn()])
			.mockReturnValueOnce([false, vi.fn()])
			.mockReturnValueOnce([null, vi.fn()]);

		const { SettingsDialog } = await import("../SettingsDialog");
		const tree = SettingsDialog();
		expect(tree.props.open).toBe(true);

		const accountBtn = findButtonByText(tree, "Account");
		expect(accountBtn).toBeTruthy();
		(accountBtn?.props as { onClick: () => void }).onClick();
		expect(setActiveSection).toHaveBeenCalledWith("account");

		const generalSectionEl = findFunctionElementByName(tree, "GeneralSection");
		expect(generalSectionEl).toBeTruthy();
		const generalTree = (generalSectionEl?.type as () => unknown)();
		const lightBtn = findButtonByText(generalTree, "Light");
		expect(lightBtn).toBeTruthy();
		(lightBtn?.props as { onClick: () => void }).onClick();
		expect(setTheme).toHaveBeenCalledWith("light");
	});

	it("renders account section and logs out", async () => {
		const logout = vi.fn();
		const setSettingsOpen = vi.fn();
		useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					settingsOpen: boolean;
					setSettingsOpen: (open: boolean) => void;
					logout: () => void;
				}) => unknown,
			) => selector({ settingsOpen: true, setSettingsOpen, logout }),
		);
		useStateMock.mockReturnValueOnce(["account", vi.fn()]).mockReturnValueOnce([
			{
				hostname: "devbox",
				os: "darwin",
				arch: "arm64",
				version: "1.0.0",
				uptime_secs: 3600,
			},
			vi.fn(),
		]);

		const { SettingsDialog } = await import("../SettingsDialog");
		const tree = SettingsDialog();
		const accountSectionEl = findFunctionElementByName(tree, "AccountSection");
		expect(accountSectionEl).toBeTruthy();
		const accountTree = (accountSectionEl?.type as () => unknown)();
		const logoutBtn = findButtonByText(accountTree, "Log out");
		expect(logoutBtn).toBeTruthy();
		(logoutBtn?.props as { onClick: () => void }).onClick();
		expect(logout).toHaveBeenCalledTimes(1);
		expect(setSettingsOpen).toHaveBeenCalledWith(false);
	});
});
