import { describe, expect, it } from "vitest";
import {
	defaultWorkspaceName,
	isActiveStatus,
	loadSidebarCompact,
	normalizeWorkspaceIcon,
	normalizeWorkspaceId,
	normalizeWorkspacePath,
	resolveWorkspaceStoreKeyFromPath,
	workspaceStoreKey,
	workspaceStoreKeyForSelection,
} from "../app-store-utils";

describe("app-store-utils", () => {
	it("normalizes workspace identifiers and keys", () => {
		expect(normalizeWorkspaceId("  abc  ")).toBe("abc");
		expect(normalizeWorkspaceId("   ")).toBeNull();
		expect(workspaceStoreKey("abc")).toBe("id:abc");
		expect(workspaceStoreKeyForSelection("abc", "/tmp/demo")).toBe("id:abc");
	});

	it("normalizes workspace paths and default names", () => {
		expect(normalizeWorkspacePath("/tmp/demo///")).toBe("/tmp/demo");
		expect(normalizeWorkspacePath("/")).toBe("/");
		expect(defaultWorkspaceName("/tmp/demo")).toBe("demo");
	});

	it("resolves workspace key from path", () => {
		expect(
			resolveWorkspaceStoreKeyFromPath("/tmp/demo/", [
				{ id: "abc", path: "/tmp/demo" },
			]),
		).toBe("id:abc");
		expect(resolveWorkspaceStoreKeyFromPath("/tmp/none", [])).toBeNull();
	});

	it("normalizes workspace icons and active status", () => {
		expect(normalizeWorkspaceIcon(":SMILE:")).toBe(":smile:");
		expect(normalizeWorkspaceIcon(" AB ")).toBe("AB");
		expect(normalizeWorkspaceIcon("data:image/png;base64,abcd")).toBe(
			"data:image/png;base64,abcd",
		);
		expect(normalizeWorkspaceIcon("")).toBeNull();
		expect(isActiveStatus("running")).toBe(true);
		expect(isActiveStatus("restored")).toBe(true);
		expect(isActiveStatus("stopped")).toBe(false);
	});

	it("loads sidebar compact flag from storage", () => {
		localStorage.setItem("loopwire_sidebar_compact", "true");
		expect(loadSidebarCompact()).toBe(true);
		localStorage.setItem("loopwire_sidebar_compact", "false");
		expect(loadSidebarCompact()).toBe(false);
	});
});
