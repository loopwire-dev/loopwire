import { describe, expect, it, vi } from "vitest";
import { Select } from "../Select";

describe("Select", () => {
	it("passes value and callback to root", () => {
		const onValueChange = vi.fn();
		const tree = Select({
			value: "a",
			onValueChange,
			options: [
				{ value: "a", label: "A" },
				{ value: "b", label: "B" },
			],
		});
		expect(tree.props.value).toBe("a");
		expect(tree.props.onValueChange).toBe(onValueChange);
	});

	it("supports custom placeholder", () => {
		const tree = Select({
			value: "",
			onValueChange: () => {},
			options: [],
			placeholder: "Pick one",
		});
		expect(tree.props.children).toBeTruthy();
	});
});
