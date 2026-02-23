import { describe, expect, it } from "vitest";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
	it("renders default empty workspace message", () => {
		const tree = EmptyState();
		const message = tree.props.children.props.children.props.children;
		expect(message).toContain("No workspace open");
	});
});
