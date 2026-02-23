import { describe, expect, it } from "vitest";
import { LoopwireSpinner } from "../LoopwireSpinner";

describe("LoopwireSpinner", () => {
	it("renders status semantics by default", () => {
		const tree = LoopwireSpinner({ size: 24, label: "Loading data" });
		expect(tree.props.role).toBe("status");
		expect(tree.props["aria-label"]).toBe("Loading data");
		expect(tree.props.style).toEqual({ width: 24, height: 24 });
		expect((tree.props.children as unknown[]).length).toBe(28);
	});

	it("renders decorative mode without status semantics", () => {
		const tree = LoopwireSpinner({ decorative: true });
		expect(tree.props.role).toBeUndefined();
		expect(tree.props["aria-label"]).toBeUndefined();
		expect(tree.props["aria-hidden"]).toBe("true");
	});
});
