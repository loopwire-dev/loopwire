import { describe, expect, it, vi } from "vitest";
import { Dialog } from "../Dialog";

describe("Dialog", () => {
	it("renders header by default", () => {
		const onOpenChange = vi.fn();
		const tree = Dialog({
			open: true,
			onOpenChange,
			title: "Settings",
			children: "body",
		});
		expect(tree.props.open).toBe(true);
		expect(tree.props.onOpenChange).toBe(onOpenChange);
	});

	it("supports headerless mode", () => {
		const tree = Dialog({
			open: true,
			onOpenChange: () => {},
			title: "Title",
			showHeader: false,
			children: "body",
		});
		expect(tree.props.children).toBeTruthy();
	});
});
