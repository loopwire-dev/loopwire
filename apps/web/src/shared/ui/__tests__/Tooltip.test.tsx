import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Tooltip } from "../Tooltip";

describe("Tooltip", () => {
	it("returns children directly when content is empty/whitespace", () => {
		const child = "child";
		expect(Tooltip({ content: "   ", children: child })).toBe(child);
	});

	it("renders tooltip primitives when content is present", () => {
		const tree = Tooltip({
			content: "Info",
			children: "child",
		}) as ReactElement<{ children: unknown }>;
		expect(tree).toBeTruthy();
		expect(tree.props.children).toBeTruthy();
	});
});
