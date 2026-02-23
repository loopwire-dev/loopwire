import { beforeEach, describe, expect, it, vi } from "vitest";

const discoverDaemonMock = vi.fn<() => Promise<string | null>>();

vi.mock("../network/discovery", () => ({
	discoverDaemon: discoverDaemonMock,
}));

function setLocationHref(href: string) {
	Object.defineProperty(window, "location", {
		value: {
			href,
			search: new URL(href).search,
			protocol: new URL(href).protocol,
			host: new URL(href).host,
			hostname: new URL(href).hostname,
		},
		writable: true,
		configurable: true,
	});
}

describe("config helpers", () => {
	beforeEach(() => {
		vi.resetModules();
		sessionStorage.clear();
		discoverDaemonMock.mockReset();
		setLocationHref("http://localhost/");
	});

	it("reads backend override from query and builds API/WS URLs", async () => {
		setLocationHref("http://localhost/?backend=http://127.0.0.1:9400");
		const mod = await import("../runtime/config");
		expect(mod.getDaemonUrl()).toBe("http://127.0.0.1:9400");
		expect(mod.getApiBase()).toBe("http://127.0.0.1:9400/api/v1");
		expect(mod.getWsUrl()).toBe("ws://127.0.0.1:9400/api/v1/ws");
	});

	it("supports manual discovery toggle", async () => {
		const mod = await import("../runtime/config");
		expect(mod.isManualDiscoveryEnabled()).toBe(false);
		mod.enableManualDiscovery();
		expect(mod.isManualDiscoveryEnabled()).toBe(true);
	});

	it("stores discovered URL when discovery is enabled", async () => {
		discoverDaemonMock.mockResolvedValue("http://192.168.1.12:9400");
		const mod = await import("../runtime/config");
		mod.enableManualDiscovery();
		await mod.initDaemonDiscovery();
		expect(discoverDaemonMock).toHaveBeenCalledTimes(1);
		expect(mod.getDaemonUrl()).toBe("http://192.168.1.12:9400");
	});

	it("returns empty daemon URL when no source is available", async () => {
		const mod = await import("../runtime/config");
		expect(mod.getDaemonUrl()).toBe("");
	});
});
