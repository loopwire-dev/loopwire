import { describe, expect, it } from "vitest";
import {
	getSingleSessionId,
	isInteractiveSidebarTarget,
	shouldCloseWorkspaceMenu,
} from "../lib/appSidebarLogic";

describe("appSidebarLogic", () => {
	it("returns single session id only when exactly one session exists", () => {
		expect(getSingleSessionId([])).toBeNull();
		expect(getSingleSessionId([{ sessionId: "s1" }, { sessionId: "s2" }])).toBe(
			null,
		);
		expect(getSingleSessionId([{ sessionId: "s1" }])).toBe("s1");
		expect(getSingleSessionId([{ sessionId: null }])).toBeNull();
	});

	it("detects menu targets for close behavior", () => {
		const outside = { closest: () => null };
		const inContainer = {
			closest: (selector: string) =>
				selector === "[data-workspace-menu-container='true']" ? {} : null,
		};
		const inMenu = {
			closest: (selector: string) =>
				selector === "[data-workspace-menu='true']" ? {} : null,
		};

		expect(shouldCloseWorkspaceMenu(outside as never)).toBe(true);
		expect(shouldCloseWorkspaceMenu(inContainer as never)).toBe(false);
		expect(shouldCloseWorkspaceMenu(inMenu as never)).toBe(false);
	});

	it("detects interactive sidebar targets via closest matcher", () => {
		const interactive = {
			closest: (selector: string) => (selector.includes("button") ? {} : null),
		};
		const nonInteractive = {
			closest: () => null,
		};
		const viaParent = {
			parentElement: interactive,
		};

		expect(isInteractiveSidebarTarget(interactive as never)).toBe(true);
		expect(isInteractiveSidebarTarget(nonInteractive as never)).toBe(false);
		expect(isInteractiveSidebarTarget(viaParent as never)).toBe(true);
		expect(isInteractiveSidebarTarget(null)).toBe(false);
	});
});
