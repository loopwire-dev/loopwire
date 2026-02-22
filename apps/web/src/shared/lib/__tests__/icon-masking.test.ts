import { describe, expect, it } from "vitest";
import {
	isDataImageUrl,
	isThemeMaskDisabled,
	stripMaskMetadata,
	withThemeMask,
} from "../icon-masking";

// ── isDataImageUrl ───────────────────────────────────────────────────

describe("isDataImageUrl", () => {
	it("returns true for PNG data URL", () => {
		expect(isDataImageUrl("data:image/png;base64,abc")).toBe(true);
	});

	it("returns true for SVG data URL", () => {
		expect(isDataImageUrl("data:image/svg+xml;base64,abc")).toBe(true);
	});

	it("returns true case-insensitively", () => {
		expect(isDataImageUrl("Data:Image/PNG;base64,abc")).toBe(true);
	});

	it("returns false for non-image data URL", () => {
		expect(isDataImageUrl("data:text/plain;base64,abc")).toBe(false);
	});

	it("returns false for regular URL", () => {
		expect(isDataImageUrl("https://example.com/image.png")).toBe(false);
	});

	it("returns false for null", () => {
		expect(isDataImageUrl(null)).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isDataImageUrl(undefined)).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isDataImageUrl("")).toBe(false);
	});
});

// ── isThemeMaskDisabled ──────────────────────────────────────────────

describe("isThemeMaskDisabled", () => {
	it("returns true when lw-mask=none is present", () => {
		expect(isThemeMaskDisabled("data:image/png;lw-mask=none;base64,abc")).toBe(
			true,
		);
	});

	it("returns false when no mask flag", () => {
		expect(isThemeMaskDisabled("data:image/png;base64,abc")).toBe(false);
	});

	it("returns false for lw-mask=theme", () => {
		expect(isThemeMaskDisabled("data:image/png;lw-mask=theme;base64,abc")).toBe(
			false,
		);
	});

	it("returns false for non-data URL", () => {
		expect(isThemeMaskDisabled("https://example.com/img.png")).toBe(false);
	});

	it("returns false for null", () => {
		expect(isThemeMaskDisabled(null)).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isThemeMaskDisabled(undefined)).toBe(false);
	});
});

// ── stripMaskMetadata ────────────────────────────────────────────────

describe("stripMaskMetadata", () => {
	it("removes lw-mask=none flag", () => {
		const input = "data:image/png;lw-mask=none;base64,abc";
		expect(stripMaskMetadata(input)).toBe("data:image/png;base64,abc");
	});

	it("removes lw-mask=theme flag", () => {
		const input = "data:image/png;lw-mask=theme;base64,abc";
		expect(stripMaskMetadata(input)).toBe("data:image/png;base64,abc");
	});

	it("returns non-data URLs unchanged", () => {
		expect(stripMaskMetadata("https://example.com")).toBe(
			"https://example.com",
		);
	});

	it("returns data URL without mask flag unchanged", () => {
		const input = "data:image/png;base64,abc";
		expect(stripMaskMetadata(input)).toBe(input);
	});

	it("handles case-insensitive flag", () => {
		const input = "data:image/png;LW-MASK=NONE;base64,abc";
		expect(stripMaskMetadata(input)).toBe("data:image/png;base64,abc");
	});
});

// ── withThemeMask ────────────────────────────────────────────────────

describe("withThemeMask", () => {
	it("removes mask flag when enabled=true", () => {
		const input = "data:image/png;lw-mask=none;base64,abc";
		expect(withThemeMask(input, true)).toBe("data:image/png;base64,abc");
	});

	it("adds lw-mask=none before ;base64 when enabled=false", () => {
		const input = "data:image/png;base64,abc";
		expect(withThemeMask(input, false)).toBe(
			"data:image/png;lw-mask=none;base64,abc",
		);
	});

	it("replaces existing theme flag with none when enabled=false", () => {
		const input = "data:image/png;lw-mask=theme;base64,abc";
		expect(withThemeMask(input, false)).toBe(
			"data:image/png;lw-mask=none;base64,abc",
		);
	});

	it("is idempotent for enabled=true on clean URL", () => {
		const input = "data:image/png;base64,abc";
		expect(withThemeMask(input, true)).toBe(input);
	});

	it("returns non-data URLs unchanged", () => {
		expect(withThemeMask("not-a-data-url", true)).toBe("not-a-data-url");
		expect(withThemeMask("not-a-data-url", false)).toBe("not-a-data-url");
	});

	it("appends flag at end if no ;base64 marker", () => {
		const input = "data:image/svg+xml,<svg></svg>";
		const result = withThemeMask(input, false);
		expect(result).toBe("data:image/svg+xml;lw-mask=none,<svg></svg>");
	});
});
