import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiBaseMock, logoutMock, getStateMock } = vi.hoisted(() => {
	const getApiBaseMock = vi.fn(() => "http://daemon.test/api/v1");
	const logoutMock = vi.fn();
	const getStateMock = vi.fn(() => ({
		token: "tok-123",
		logout: logoutMock,
	}));
	return { getApiBaseMock, logoutMock, getStateMock };
});

vi.mock("../../runtime/config", () => ({
	getApiBase: getApiBaseMock,
}));

vi.mock("../../../stores/app-store", () => ({
	useAppStore: {
		getState: getStateMock,
	},
}));

import { ApiError, get, post } from "../http";

function makeResponse(options: {
	ok: boolean;
	status: number;
	statusText?: string;
	json: unknown;
}): Response {
	return {
		ok: options.ok,
		status: options.status,
		statusText: options.statusText ?? "",
		json: vi.fn().mockResolvedValue(options.json),
	} as unknown as Response;
}

describe("daemon http helpers", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		logoutMock.mockReset();
		getApiBaseMock.mockClear();
		getStateMock.mockImplementation(() => ({
			token: "tok-123",
			logout: logoutMock,
		}));
	});

	it("sends GET with auth header and query params", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			makeResponse({
				ok: true,
				status: 200,
				json: { ok: true },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await get<{ ok: boolean }>("/health", { a: "1", b: "2" });
		expect(result).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledWith(
			"http://daemon.test/api/v1/health?a=1&b=2",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer tok-123",
				}),
			}),
		);
	});

	it("sends POST JSON body and handles 204", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			makeResponse({
				ok: true,
				status: 204,
				json: {},
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await post<void>("/x", { a: 1 });
		expect(result).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledWith(
			"http://daemon.test/api/v1/x",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ a: 1 }),
			}),
		);
	});

	it("throws ApiError and logs out for session-invalid 401", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			makeResponse({
				ok: false,
				status: 401,
				json: { code: "INVALID_SESSION", message: "bad" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(get("/x")).rejects.toMatchObject({
			name: "ApiError",
			code: "INVALID_SESSION",
			status: 401,
			message: "bad",
		});
		expect(logoutMock).toHaveBeenCalledTimes(1);
	});

	it("does not logout for NON_SESSION_AUTH_CODES", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			makeResponse({
				ok: false,
				status: 401,
				json: { code: "PIN_REQUIRED", message: "pin" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(get("/x")).rejects.toBeInstanceOf(ApiError);
		expect(logoutMock).not.toHaveBeenCalled();
	});

	it("falls back to statusText when error body is not json", async () => {
		const badJson = {
			ok: false,
			status: 500,
			statusText: "Server Err",
			json: vi.fn().mockRejectedValue(new Error("no json")),
		} as unknown as Response;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(badJson));

		await expect(post("/x")).rejects.toMatchObject({
			message: "Server Err",
			code: "UNKNOWN",
			status: 500,
		});
	});
});
