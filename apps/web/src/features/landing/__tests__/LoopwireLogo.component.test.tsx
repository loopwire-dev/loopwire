import { describe, expect, it } from "vitest";
import { LoopwireLogo } from "../components/LoopwireLogo";

describe("LoopwireLogo", () => {
	it("renders with defaults", () => {
		const tree = LoopwireLogo({});
		expect(tree.props.alt).toBe("Loopwire");
		expect(tree.props.width).toBe(24);
		expect(tree.props.className).toContain("dark:invert");
	});

	it("applies size/mode/className", () => {
		const tree = LoopwireLogo({
			size: 40,
			mode: "dark",
			className: "extra",
		});
		expect(tree.props.width).toBe(40);
		expect(tree.props.height).toBe(40);
		expect(tree.props.className).toContain("invert");
		expect(tree.props.className).toContain("extra");
	});
});
