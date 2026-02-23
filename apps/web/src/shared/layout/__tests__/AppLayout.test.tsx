import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	useDaemonMock,
	useAppStoreMock,
	WorkspaceViewMock,
	NewWorkspaceViewMock,
} = vi.hoisted(() => ({
	useDaemonMock: vi.fn(),
	useAppStoreMock: vi.fn(),
	WorkspaceViewMock: vi.fn(),
	NewWorkspaceViewMock: vi.fn(),
}));

vi.mock("../../hooks/useDaemon", () => ({
	useDaemon: useDaemonMock,
}));

vi.mock("../../stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

vi.mock("../../../features/sidebar/components/AppSidebar", () => ({
	AppSidebar: () => null,
}));

vi.mock("../../../features/ide/components/WorkspaceView", () => ({
	WorkspaceView: WorkspaceViewMock,
}));

vi.mock("../../../features/workspace/components/NewWorkspaceView", () => ({
	NewWorkspaceView: NewWorkspaceViewMock,
}));

describe("AppLayout", () => {
	beforeEach(() => {
		vi.resetModules();
		useDaemonMock.mockReset();
		useAppStoreMock.mockReset();
		WorkspaceViewMock.mockReset();
		NewWorkspaceViewMock.mockReset();
	});

	it("shows workspace view when workspace is selected and not browsing", async () => {
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					browsingForWorkspace: boolean;
					workspacePath: string | null;
				}) => unknown,
			) =>
				selector({
					browsingForWorkspace: false,
					workspacePath: "/repo",
				}),
		);

		const { AppLayout } = await import("../AppLayout");
		const tree = AppLayout();

		expect(useDaemonMock).toHaveBeenCalledTimes(1);
		expect(tree.props.children[1].props.children.type).toBe(WorkspaceViewMock);
	});

	it("shows new workspace view when browsing or workspace is missing", async () => {
		useAppStoreMock.mockImplementation(
			(
				selector: (state: {
					browsingForWorkspace: boolean;
					workspacePath: string | null;
				}) => unknown,
			) =>
				selector({
					browsingForWorkspace: true,
					workspacePath: "/repo",
				}),
		);

		const { AppLayout } = await import("../AppLayout");
		const tree = AppLayout();

		expect(tree.props.children[1].props.children.type).toBe(
			NewWorkspaceViewMock,
		);
	});
});
