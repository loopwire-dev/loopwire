import { describe, expect, it } from "vitest";
import {
	findResumeFailureReason,
	getBase64FromDataUrl,
	isSupportedTerminalImageType,
	pickSupportedImageFileFromClipboard,
	pickSupportedImageFileFromFiles,
} from "../lib/terminalUtils";

function file(name: string, type: string): File {
	return { name, type } as File;
}

describe("terminalUtils", () => {
	it("finds resume failure reason for selected session", () => {
		const sessions = {
			"/a": [
				{ sessionId: "s1" },
				{ sessionId: "s2", resumeFailureReason: "x" },
			],
			"/b": [{ sessionId: "s3", resumeFailureReason: "y" }],
		};
		expect(findResumeFailureReason(sessions, "s2")).toBe("x");
		expect(findResumeFailureReason(sessions, "s3")).toBe("y");
		expect(findResumeFailureReason(sessions, "s4")).toBeNull();
	});

	it("recognizes supported image types", () => {
		expect(isSupportedTerminalImageType("image/png")).toBe(true);
		expect(isSupportedTerminalImageType("image/webp")).toBe(true);
		expect(isSupportedTerminalImageType("text/plain")).toBe(false);
	});

	it("picks supported file from file list", () => {
		const files = [file("a.txt", "text/plain"), file("b.png", "image/png")];
		expect(pickSupportedImageFileFromFiles(files)).toEqual(files[1]);
		expect(
			pickSupportedImageFileFromFiles([file("a.txt", "text/plain")]),
		).toBeNull();
	});

	it("picks supported file from clipboard files then items", () => {
		const png = file("a.png", "image/png");
		const txt = file("a.txt", "text/plain");
		const itemFile = file("b.webp", "image/webp");
		const items = [
			{
				kind: "string",
				type: "text/plain",
				getAsFile: () => null,
			},
			{
				kind: "file",
				type: "image/webp",
				getAsFile: () => itemFile,
			},
		];
		expect(
			pickSupportedImageFileFromClipboard([txt, png], items as never),
		).toEqual(png);
		expect(pickSupportedImageFileFromClipboard([txt], items as never)).toEqual(
			itemFile,
		);
		expect(
			pickSupportedImageFileFromClipboard([txt], [
				{ kind: "file", type: "text/plain", getAsFile: () => txt },
			] as never),
		).toBeNull();
	});

	it("extracts base64 from data URL", () => {
		expect(getBase64FromDataUrl("data:image/png;base64,AAAA")).toBe("AAAA");
		expect(getBase64FromDataUrl("not-a-data-url")).toBeNull();
	});
});
