import { describe, expect, it } from "vitest";
import type { DiffFile } from "../../editor/lib/diffUtils";
import {
	buildUnifiedLines,
	lineBackground,
	splitLineMarker,
	stripMarker,
} from "../lib/gitDiffUnifiedLines";

describe("unified-lines helpers", () => {
	it("strips known diff markers and preserves other content", () => {
		expect(stripMarker("+hello")).toBe("hello");
		expect(stripMarker("-hello")).toBe("hello");
		expect(stripMarker(" hello")).toBe("hello");
		expect(stripMarker("hello")).toBe("hello");
	});

	it("returns marker style by line type", () => {
		expect(splitLineMarker("addition")).toEqual({
			marker: "+",
			markerClass: "text-green-700 dark:text-green-400",
		});
		expect(splitLineMarker("deletion")).toEqual({
			marker: "-",
			markerClass: "text-red-700 dark:text-red-400",
		});
		expect(splitLineMarker("context")).toEqual({
			marker: "",
			markerClass: "text-muted",
		});
		expect(lineBackground("addition")).toBe("bg-green-500/12");
		expect(lineBackground("deletion")).toBe("bg-red-500/12");
		expect(lineBackground("context")).toBe("bg-surface");
	});

	it("builds unified lines with anchored deletions and additions", () => {
		const file: DiffFile = {
			path: "demo.txt",
			oldPath: "demo.txt",
			newPath: "demo.txt",
			status: "modified",
			additions: 1,
			deletions: 1,
			hunks: [
				{
					header: "@@ -1,2 +1,2 @@",
					lines: [
						{
							type: "deletion",
							content: "-old",
							oldLine: 1,
							newLine: null,
							anchorNewLine: 1,
						},
						{
							type: "addition",
							content: "+new",
							oldLine: null,
							newLine: 1,
						},
					],
				},
			],
		};

		const result = buildUnifiedLines(file, "new\nkeep\n");
		expect(result[0]).toMatchObject({
			type: "deletion",
			oldLine: 1,
			content: "old",
		});
		expect(result[1]).toMatchObject({
			type: "addition",
			lineNumber: 1,
			content: "new",
		});
		expect(result[2]).toMatchObject({
			type: "context",
			lineNumber: 2,
			content: "keep",
		});
	});

	it("handles deletion anchored after final line", () => {
		const file: DiffFile = {
			path: "demo.txt",
			oldPath: "demo.txt",
			newPath: "demo.txt",
			status: "modified",
			additions: 0,
			deletions: 1,
			hunks: [
				{
					header: "@@ -2,1 +2,0 @@",
					lines: [
						{
							type: "deletion",
							content: "-tail",
							oldLine: 2,
							newLine: null,
							anchorNewLine: 2,
						},
					],
				},
			],
		};

		const result = buildUnifiedLines(file, "head\n");
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			type: "context",
			lineNumber: 1,
			content: "head",
		});
		expect(result[1]).toMatchObject({
			type: "deletion",
			oldLine: 2,
			content: "tail",
		});
	});
});
