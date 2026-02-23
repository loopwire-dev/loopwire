import { describe, expect, it } from "vitest";
import { getNextTheme } from "../theme";

describe("getNextTheme", () => {
	it("cycles system -> light -> dark -> system", () => {
		expect(getNextTheme("system")).toBe("light");
		expect(getNextTheme("light")).toBe("dark");
		expect(getNextTheme("dark")).toBe("system");
	});
});
