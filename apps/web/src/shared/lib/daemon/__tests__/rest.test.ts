import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../http";
import {
	attachToSession,
	authExchange,
	authRevoke,
	authRotate,
	bootstrap,
	fsBrowse,
	fsList,
	fsRead,
	fsReadMany,
	fsRoots,
	gitDiff,
	gitStatus,
	health,
	inviteBootstrap,
	inviteExchange,
	isNotGitRepoError,
	registerWorkspace,
	remoteShareStart,
	remoteShareStatus,
	remoteShareStop,
	removeWorkspace,
	renameAgentSession,
	sessionScrollback,
	startAgentSession,
	stopAgentSession,
	updateAgentSessionSettings,
	updateWorkspaceSettings,
} from "../rest";

const { getMock, postMock } = vi.hoisted(() => ({
	getMock: vi.fn(),
	postMock: vi.fn(),
}));

vi.mock("../http", async () => {
	const actual = await vi.importActual<typeof import("../http")>("../http");
	return {
		...actual,
		get: getMock,
		post: postMock,
	};
});

describe("daemon rest client", () => {
	it("builds GET endpoints and query params", () => {
		health();
		bootstrap();
		remoteShareStatus();
		fsRoots();
		fsBrowse("/tmp");
		fsList("w1", "src");
		fsRead("w1", "a.txt");
		fsRead("w1", "a.bin", { includeBinary: true });
		gitStatus("w1");
		gitDiff("w1");
		gitDiff("w1", true);
		sessionScrollback("s1");
		sessionScrollback("s1", { maxBytes: 10, beforeOffset: 20 });

		expect(getMock).toHaveBeenCalledWith("/health");
		expect(getMock).toHaveBeenCalledWith("/bootstrap");
		expect(getMock).toHaveBeenCalledWith("/remote/share/status");
		expect(getMock).toHaveBeenCalledWith("/fs/roots");
		expect(getMock).toHaveBeenCalledWith("/fs/browse", { path: "/tmp" });
		expect(getMock).toHaveBeenCalledWith("/fs/list", {
			workspace_id: "w1",
			relative_path: "src",
		});
		expect(getMock).toHaveBeenCalledWith("/fs/read", {
			workspace_id: "w1",
			relative_path: "a.txt",
		});
		expect(getMock).toHaveBeenCalledWith("/fs/read", {
			workspace_id: "w1",
			relative_path: "a.bin",
			include_binary: "true",
		});
		expect(getMock).toHaveBeenCalledWith("/git/status", { workspace_id: "w1" });
		expect(getMock).toHaveBeenCalledWith("/git/diff", { workspace_id: "w1" });
		expect(getMock).toHaveBeenCalledWith("/git/diff", {
			workspace_id: "w1",
			force: "true",
		});
		expect(getMock).toHaveBeenCalledWith("/agents/sessions/s1/scrollback", {});
		expect(getMock).toHaveBeenCalledWith("/agents/sessions/s1/scrollback", {
			max_bytes: "10",
			before_offset: "20",
		});
	});

	it("builds POST endpoints and payloads", () => {
		authExchange("boot");
		authRotate();
		authRevoke();
		inviteBootstrap("inv");
		inviteExchange({
			invite_token: "inv",
			pin: "1234",
			trusted_device_token: null,
		});
		remoteShareStart();
		remoteShareStart(" 1234 ");
		remoteShareStop();
		startAgentSession("claude", "/repo");
		stopAgentSession("s1");
		renameAgentSession("s1", "my session");
		updateAgentSessionSettings("s1", { pinned: true, icon: "rocket" });
		attachToSession("s1", "abc", "file.txt");
		registerWorkspace("/repo");
		removeWorkspace("/repo");
		updateWorkspaceSettings({
			path: "/repo",
			name: "Repo",
			pinned: true,
			icon: "code",
		});
		fsReadMany("w1", ["a.ts", "b.ts"]);

		expect(postMock).toHaveBeenCalledWith("/auth/exchange", {
			bootstrap_token: "boot",
		});
		expect(postMock).toHaveBeenCalledWith("/auth/rotate");
		expect(postMock).toHaveBeenCalledWith("/auth/revoke");
		expect(postMock).toHaveBeenCalledWith("/remote/invite/bootstrap", {
			invite_token: "inv",
		});
		expect(postMock).toHaveBeenCalledWith("/remote/invite/exchange", {
			invite_token: "inv",
			pin: "1234",
			trusted_device_token: null,
		});
		expect(postMock).toHaveBeenCalledWith("/remote/share/start", {
			pin: undefined,
		});
		expect(postMock).toHaveBeenCalledWith("/remote/share/start", {
			pin: "1234",
		});
		expect(postMock).toHaveBeenCalledWith("/remote/share/stop");
		expect(postMock).toHaveBeenCalledWith("/agents/sessions", {
			agent_type: "claude",
			workspace_path: "/repo",
		});
		expect(postMock).toHaveBeenCalledWith("/agents/sessions/s1/stop");
		expect(postMock).toHaveBeenCalledWith("/agents/sessions/s1/rename", {
			custom_name: "my session",
		});
		expect(postMock).toHaveBeenCalledWith("/agents/sessions/s1/settings", {
			pinned: true,
			icon: "rocket",
		});
		expect(postMock).toHaveBeenCalledWith("/agents/sessions/s1/attach", {
			data: "abc",
			filename: "file.txt",
		});
		expect(postMock).toHaveBeenCalledWith("/workspaces/register", {
			path: "/repo",
		});
		expect(postMock).toHaveBeenCalledWith("/workspaces/remove", {
			path: "/repo",
		});
		expect(postMock).toHaveBeenCalledWith("/workspaces/settings", {
			path: "/repo",
			name: "Repo",
			pinned: true,
			icon: "code",
		});
		expect(postMock).toHaveBeenCalledWith("/fs/read_many", {
			workspace_id: "w1",
			relative_paths: ["a.ts", "b.ts"],
		});
	});

	it("recognizes NOT_GIT_REPO errors", () => {
		expect(isNotGitRepoError(new ApiError("NOT_GIT_REPO", "x", 400))).toBe(
			true,
		);
		expect(isNotGitRepoError(new ApiError("OTHER", "x", 400))).toBe(false);
		expect(isNotGitRepoError(new Error("x"))).toBe(false);
	});
});
