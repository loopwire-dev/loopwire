import { describe, expect, it } from "vitest";
import {
	parseHunkHeader,
	parseUnifiedPatch,
	stripDiffPath,
} from "../lib/diffUtils";

// ── stripDiffPath ────────────────────────────────────────────────────

describe("stripDiffPath", () => {
	it("strips a/ prefix", () => {
		expect(stripDiffPath("a/src/main.ts")).toBe("src/main.ts");
	});

	it("strips b/ prefix", () => {
		expect(stripDiffPath("b/src/main.ts")).toBe("src/main.ts");
	});

	it("returns path as-is without a/ or b/ prefix", () => {
		expect(stripDiffPath("src/main.ts")).toBe("src/main.ts");
	});

	it("returns null for /dev/null", () => {
		expect(stripDiffPath("/dev/null")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(stripDiffPath("")).toBeNull();
	});

	it("handles tab-separated fields (takes first)", () => {
		expect(stripDiffPath("a/file.ts\t100644")).toBe("file.ts");
	});

	it("trims whitespace", () => {
		expect(stripDiffPath("  a/file.ts  ")).toBe("file.ts");
	});

	it("handles root-level file with a/ prefix", () => {
		expect(stripDiffPath("a/README.md")).toBe("README.md");
	});
});

// ── parseHunkHeader ──────────────────────────────────────────────────

describe("parseHunkHeader", () => {
	it("parses basic hunk header", () => {
		expect(parseHunkHeader("@@ -1,5 +1,7 @@")).toEqual({
			oldStart: 1,
			newStart: 1,
		});
	});

	it("parses hunk header with different line numbers", () => {
		expect(parseHunkHeader("@@ -10,3 +20,5 @@")).toEqual({
			oldStart: 10,
			newStart: 20,
		});
	});

	it("parses hunk header without count", () => {
		expect(parseHunkHeader("@@ -1 +1 @@")).toEqual({
			oldStart: 1,
			newStart: 1,
		});
	});

	it("parses hunk header with context after @@", () => {
		expect(parseHunkHeader("@@ -5,10 +5,12 @@ function foo() {")).toEqual({
			oldStart: 5,
			newStart: 5,
		});
	});

	it("parses hunk with large line numbers", () => {
		expect(parseHunkHeader("@@ -1000,50 +2000,60 @@")).toEqual({
			oldStart: 1000,
			newStart: 2000,
		});
	});

	it("returns null for non-hunk line", () => {
		expect(parseHunkHeader("not a hunk header")).toBeNull();
	});

	it("returns null for malformed hunk", () => {
		expect(parseHunkHeader("@@ garbage @@")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseHunkHeader("")).toBeNull();
	});
});

// ── parseUnifiedPatch ────────────────────────────────────────────────

describe("parseUnifiedPatch", () => {
	it("returns empty array for empty patch", () => {
		expect(parseUnifiedPatch("")).toEqual([]);
	});

	it("returns empty array for whitespace-only patch", () => {
		expect(parseUnifiedPatch("   \n  \n  ")).toEqual([]);
	});

	it("parses a simple modified file", () => {
		const patch = [
			"diff --git a/file.ts b/file.ts",
			"--- a/file.ts",
			"+++ b/file.ts",
			"@@ -1,3 +1,3 @@",
			" line1",
			"-old line",
			"+new line",
			" line3",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		expect(files).toHaveLength(1);
		expect(files[0]?.path).toBe("file.ts");
		expect(files[0]?.status).toBe("modified");
		expect(files[0]?.additions).toBe(1);
		expect(files[0]?.deletions).toBe(1);
		expect(files[0]?.hunks).toHaveLength(1);
		expect(files[0]?.hunks[0]?.lines).toHaveLength(4);
	});

	it("parses a new file", () => {
		const patch = [
			"diff --git a/new.ts b/new.ts",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/new.ts",
			"@@ -0,0 +1,2 @@",
			"+line 1",
			"+line 2",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		expect(files).toHaveLength(1);
		expect(files[0]?.path).toBe("new.ts");
		expect(files[0]?.status).toBe("added");
		expect(files[0]?.additions).toBe(2);
		expect(files[0]?.deletions).toBe(0);
	});

	it("parses a deleted file", () => {
		const patch = [
			"diff --git a/old.ts b/old.ts",
			"deleted file mode 100644",
			"--- a/old.ts",
			"+++ /dev/null",
			"@@ -1,2 +0,0 @@",
			"-line 1",
			"-line 2",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		expect(files).toHaveLength(1);
		expect(files[0]?.path).toBe("old.ts");
		expect(files[0]?.status).toBe("deleted");
		expect(files[0]?.deletions).toBe(2);
		expect(files[0]?.additions).toBe(0);
	});

	it("parses a renamed file", () => {
		const patch = [
			"diff --git a/old-name.ts b/new-name.ts",
			"rename from old-name.ts",
			"rename to new-name.ts",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		expect(files).toHaveLength(1);
		expect(files[0]?.path).toBe("new-name.ts");
		expect(files[0]?.status).toBe("renamed");
		expect(files[0]?.oldPath).toBe("old-name.ts");
		expect(files[0]?.newPath).toBe("new-name.ts");
	});

	it("parses multiple files in a single patch", () => {
		const patch = [
			"diff --git a/file1.ts b/file1.ts",
			"--- a/file1.ts",
			"+++ b/file1.ts",
			"@@ -1,1 +1,1 @@",
			"-old",
			"+new",
			"diff --git a/file2.ts b/file2.ts",
			"--- a/file2.ts",
			"+++ b/file2.ts",
			"@@ -1,1 +1,2 @@",
			" existing",
			"+added",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		expect(files).toHaveLength(2);
		expect(files[0]?.path).toBe("file1.ts");
		expect(files[1]?.path).toBe("file2.ts");
	});

	it("tracks line numbers correctly", () => {
		const patch = [
			"diff --git a/file.ts b/file.ts",
			"--- a/file.ts",
			"+++ b/file.ts",
			"@@ -5,4 +5,5 @@",
			" context",
			"-deleted",
			"+added1",
			"+added2",
			" more context",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		const lines = files[0]?.hunks[0]?.lines ?? [];

		expect(lines[0]?.type).toBe("context");
		expect(lines[0]?.oldLine).toBe(5);
		expect(lines[0]?.newLine).toBe(5);

		expect(lines[1]?.type).toBe("deletion");
		expect(lines[1]?.oldLine).toBe(6);
		expect(lines[1]?.newLine).toBeNull();

		expect(lines[2]?.type).toBe("addition");
		expect(lines[2]?.oldLine).toBeNull();
		expect(lines[2]?.newLine).toBe(6);

		expect(lines[3]?.type).toBe("addition");
		expect(lines[3]?.newLine).toBe(7);

		expect(lines[4]?.type).toBe("context");
		expect(lines[4]?.oldLine).toBe(7);
		expect(lines[4]?.newLine).toBe(8);
	});

	it("handles multiple hunks in one file", () => {
		const patch = [
			"diff --git a/file.ts b/file.ts",
			"--- a/file.ts",
			"+++ b/file.ts",
			"@@ -1,3 +1,3 @@",
			" line1",
			"-old1",
			"+new1",
			" line3",
			"@@ -10,3 +10,3 @@",
			" line10",
			"-old2",
			"+new2",
			" line12",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		expect(files).toHaveLength(1);
		expect(files[0]?.hunks).toHaveLength(2);
		expect(files[0]?.additions).toBe(2);
		expect(files[0]?.deletions).toBe(2);
	});

	it("preserves hunk header", () => {
		const patch = [
			"diff --git a/file.ts b/file.ts",
			"--- a/file.ts",
			"+++ b/file.ts",
			"@@ -1,3 +1,3 @@ function example() {",
			" line1",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		expect(files[0]?.hunks[0]?.header).toBe(
			"@@ -1,3 +1,3 @@ function example() {",
		);
	});

	it("handles 'No newline at end of file' marker", () => {
		const patch = [
			"diff --git a/file.ts b/file.ts",
			"--- a/file.ts",
			"+++ b/file.ts",
			"@@ -1,1 +1,1 @@",
			"-old",
			"\\ No newline at end of file",
			"+new",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		const lines = files[0]?.hunks[0]?.lines ?? [];
		const noNewline = lines.find(
			(l) => l.content === "\\ No newline at end of file",
		);
		expect(noNewline).toBeDefined();
		expect(noNewline?.type).toBe("context");
		expect(noNewline?.oldLine).toBeNull();
		expect(noNewline?.newLine).toBeNull();
	});

	it("detects added file from null oldPath", () => {
		const patch = [
			"diff --git a/new.ts b/new.ts",
			"--- /dev/null",
			"+++ b/new.ts",
			"@@ -0,0 +1,1 @@",
			"+content",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		expect(files[0]?.status).toBe("added");
		expect(files[0]?.oldPath).toBeNull();
	});

	it("detects deleted file from null newPath", () => {
		const patch = [
			"diff --git a/old.ts b/old.ts",
			"--- a/old.ts",
			"+++ /dev/null",
			"@@ -1,1 +0,0 @@",
			"-content",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		expect(files[0]?.status).toBe("deleted");
		expect(files[0]?.newPath).toBeNull();
	});

	it("deletion lines include anchorNewLine", () => {
		const patch = [
			"diff --git a/file.ts b/file.ts",
			"--- a/file.ts",
			"+++ b/file.ts",
			"@@ -1,2 +1,1 @@",
			"-removed",
			" kept",
		].join("\n");

		const files = parseUnifiedPatch(patch);
		const deletion = files[0]?.hunks[0]?.lines[0];
		expect(deletion).toBeDefined();
		if (!deletion) {
			return;
		}
		expect(deletion.type).toBe("deletion");
		expect(deletion.anchorNewLine).toBe(1);
	});
});
