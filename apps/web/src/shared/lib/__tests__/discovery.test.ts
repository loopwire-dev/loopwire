import { beforeEach, describe, expect, it, vi } from "vitest";

function setLocation(url: string) {
	const parsed = new URL(url);
	Object.defineProperty(window, "location", {
		value: {
			href: parsed.toString(),
			hostname: parsed.hostname,
			host: parsed.host,
			protocol: parsed.protocol,
		},
		writable: true,
		configurable: true,
	});
}

function okResponse(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		json: vi.fn().mockResolvedValue(body),
	} as unknown as Response;
}

describe("discoverDaemon", () => {
	beforeEach(() => {
		vi.resetModules();
		sessionStorage.clear();
		setLocation("http://localhost:5173/");
	});

	it("returns cached URL when healthy", async () => {
		sessionStorage.setItem("loopwire_discovered_url", "http://localhost:9400");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(okResponse({ status: "ok", version: "x" })),
		);
		const { discoverDaemon } = await import("../network/discovery");
		await expect(discoverDaemon()).resolves.toBe("http://localhost:9400");
	});

	it("clears bad cache and discovers a working candidate", async () => {
		sessionStorage.setItem("loopwire_discovered_url", "http://bad:9400");
		const fetchMock = vi.fn(async (url: string) => {
			if (url.startsWith("http://127.0.0.1:9400")) {
				return okResponse({ status: "ok", version: "x" });
			}
			throw new Error("down");
		});
		vi.stubGlobal("fetch", fetchMock);
		const { discoverDaemon } = await import("../network/discovery");
		await expect(discoverDaemon()).resolves.toBe("http://127.0.0.1:9400");
		expect(sessionStorage.getItem("loopwire_discovered_url")).toBe(
			"http://127.0.0.1:9400",
		);
	});

	it("includes LAN host candidate and returns null when all probes fail", async () => {
		setLocation("http://192.168.1.20:5173/");
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("nope")));
		const { discoverDaemon } = await import("../network/discovery");
		await expect(discoverDaemon(9400)).resolves.toBeNull();
	});
});
