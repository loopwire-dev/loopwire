import { describe, expect, it } from "vitest";
import { isEmojiShortcode } from "../lib/workspaceSidebarUtils";

describe("isEmojiShortcode", () => {
	it("matches simple shortcodes", () => {
		expect(isEmojiShortcode(":smile:")).toBe(true);
		expect(isEmojiShortcode(":rocket:")).toBe(true);
		expect(isEmojiShortcode(":thumbs_up:")).toBe(true);
	});

	it("matches shortcodes with numbers", () => {
		expect(isEmojiShortcode(":100:")).toBe(true);
		expect(isEmojiShortcode(":1st_place:")).toBe(true);
	});

	it("matches shortcodes with hyphens and plus", () => {
		expect(isEmojiShortcode(":heavy-check:")).toBe(true);
		expect(isEmojiShortcode(":+1:")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(isEmojiShortcode(":Smile:")).toBe(true);
		expect(isEmojiShortcode(":ROCKET:")).toBe(true);
	});

	it("trims whitespace", () => {
		expect(isEmojiShortcode("  :smile:  ")).toBe(true);
	});

	it("rejects empty colons", () => {
		expect(isEmojiShortcode("::")).toBe(false);
	});

	it("rejects strings without colons", () => {
		expect(isEmojiShortcode("smile")).toBe(false);
	});

	it("rejects strings with only opening colon", () => {
		expect(isEmojiShortcode(":smile")).toBe(false);
	});

	it("rejects strings with only closing colon", () => {
		expect(isEmojiShortcode("smile:")).toBe(false);
	});

	it("rejects strings with spaces inside", () => {
		expect(isEmojiShortcode(":hello world:")).toBe(false);
	});

	it("rejects overly long shortcodes (>64 chars)", () => {
		const long = `:${"a".repeat(65)}:`;
		expect(isEmojiShortcode(long)).toBe(false);
	});

	it("accepts exactly 64 char shortcodes", () => {
		const exact = `:${"a".repeat(64)}:`;
		expect(isEmojiShortcode(exact)).toBe(true);
	});
});
