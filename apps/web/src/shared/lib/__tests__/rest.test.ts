import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMock, postMock, MockApiError } = vi.hoisted(() => {
	const getMock = vi.fn();
	const postMock = vi.fn();
	class MockApiError extends Error {
		code: string;
		constructor(code: string) {
			super(code);
			this.code = code;
		}
	}
	return { getMock, postMock, MockApiError };
});

vi.mock("../daemon/http", () => ({
	get: getMock,
	post: postMock,
	ApiError: MockApiError,
}));

import {
	authExchange,
	fsRead,
	gitDiff,
	isNotGitRepoError,
	remoteShareStart,
	sessionScrollback,
} from "../daemon/rest";

describe("daemon rest wrappers", () => {
	beforeEach(() => {
		getMock.mockReset();
		postMock.mockReset();
	});

	it("passes trimmed pin for remote share start", () => {
		remoteShareStart(" 1234 ");
		expect(postMock).toHaveBeenCalledWith("/remote/share/start", {
			pin: "1234",
		});
	});

	it("omits pin when empty", () => {
		remoteShareStart("   ");
		expect(postMock).toHaveBeenCalledWith("/remote/share/start", {
			pin: undefined,
		});
	});

	it("builds scrollback query params", () => {
		sessionScrollback("sid", { maxBytes: 1024, beforeOffset: 99 });
		expect(getMock).toHaveBeenCalledWith("/agents/sessions/sid/scrollback", {
			max_bytes: "1024",
			before_offset: "99",
		});
	});

	it("includes optional fs include_binary flag", () => {
		fsRead("wid", "file.txt", { includeBinary: true });
		expect(getMock).toHaveBeenCalledWith("/fs/read", {
			workspace_id: "wid",
			relative_path: "file.txt",
			include_binary: "true",
		});
	});

	it("adds force when requesting git diff with force=true", () => {
		gitDiff("wid", true);
		expect(getMock).toHaveBeenCalledWith("/git/diff", {
			workspace_id: "wid",
			force: "true",
		});
	});

	it("maps auth exchange payload", () => {
		authExchange("bootstrap-token");
		expect(postMock).toHaveBeenCalledWith("/auth/exchange", {
			bootstrap_token: "bootstrap-token",
		});
	});

	it("does not send force query by default for gitDiff", () => {
		gitDiff("wid");
		expect(getMock).toHaveBeenCalledWith("/git/diff", { workspace_id: "wid" });
	});

	it("builds scrollback with empty options", () => {
		sessionScrollback("sid");
		expect(getMock).toHaveBeenCalledWith("/agents/sessions/sid/scrollback", {});
	});

	it("recognizes NOT_GIT_REPO errors", () => {
		expect(isNotGitRepoError(new MockApiError("NOT_GIT_REPO"))).toBe(true);
		expect(isNotGitRepoError(new MockApiError("OTHER"))).toBe(false);
		expect(isNotGitRepoError(new Error("NOT_GIT_REPO"))).toBe(false);
	});
});
