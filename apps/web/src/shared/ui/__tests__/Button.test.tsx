import { describe, expect, it } from "vitest";
import { Button } from "../Button";

describe("Button", () => {
	it("applies variant and size classes", () => {
		const tree = Button({
			variant: "danger",
			size: "lg",
			children: "Delete",
		});
		expect(tree.props.className).toContain("bg-red-600");
		expect(tree.props.className).toContain("px-6");
	});

	it("uses default variant and size when omitted", () => {
		const tree = Button({ children: "Ok" });
		expect(tree.props.className).toContain("bg-accent");
		expect(tree.props.className).toContain("px-4");
	});
});
