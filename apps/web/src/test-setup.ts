// Vitest setup file — provides browser globals for tests running in Node environment.

const storage: Record<string, string> = {};
const storageMock = {
	getItem: (key: string): string | null => storage[key] ?? null,
	setItem: (key: string, value: string) => { storage[key] = value; },
	removeItem: (key: string) => { delete storage[key]; },
	clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
	get length() { return Object.keys(storage).length; },
	key: (_: number): string | null => null,
};

// Force-replace localStorage and sessionStorage — Node may have stubs that don't work
Object.defineProperty(globalThis, "localStorage", {
	value: storageMock,
	writable: true,
	configurable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
	value: storageMock,
	writable: true,
	configurable: true,
});

// Provide window.location for code that reads URL parameters
if (typeof globalThis.window === "undefined") {
	Object.defineProperty(globalThis, "window", {
		value: {
			location: {
				href: "http://localhost",
				search: "",
				protocol: "http:",
				host: "localhost",
				hostname: "localhost",
			},
		},
		writable: true,
		configurable: true,
	});
} else if (!globalThis.window.location) {
	(globalThis.window as unknown as Record<string, unknown>).location = {
		href: "http://localhost",
		search: "",
		protocol: "http:",
		host: "localhost",
		hostname: "localhost",
	};
}
