import { describe, expect, it } from "vitest";
import { AgentActivityIcon } from "../components/AgentActivityIcon";

describe("AgentActivityIcon", () => {
	it("renders expected labels per phase", () => {
		expect(
			AgentActivityIcon({ phase: "awaiting_user" }).props["aria-label"],
		).toBe("Waiting for input");
		expect(AgentActivityIcon({ phase: "user_input" }).props["aria-label"]).toBe(
			"User typing",
		);
		expect(AgentActivityIcon({ phase: "processing" }).props["aria-label"]).toBe(
			"Processing",
		);
		expect(
			AgentActivityIcon({ phase: "streaming_output" }).props["aria-label"],
		).toBe("Streaming output");
	});

	it("falls back to unknown state", () => {
		expect(AgentActivityIcon({ phase: "unknown" }).props["aria-label"]).toBe(
			"Unknown state",
		);
	});
});
