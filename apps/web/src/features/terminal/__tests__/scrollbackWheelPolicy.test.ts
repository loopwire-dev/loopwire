import { describe, expect, it } from "vitest";
import { decideScrollbackWheelAction } from "../lib/scrollbackWheelPolicy";

describe("decideScrollbackWheelAction", () => {
	it("resets latch and checks dismiss on downward wheel", () => {
		expect(
			decideScrollbackWheelAction({
				deltaY: 10,
				hasMore: true,
				loading: false,
				viewportScrollTop: 5,
				latchActive: true,
			}),
		).toEqual({
			nextLatch: false,
			shouldFetchMore: false,
			shouldCheckDismiss: true,
		});
	});

	it("does nothing when cannot load older", () => {
		expect(
			decideScrollbackWheelAction({
				deltaY: -1,
				hasMore: false,
				loading: false,
				viewportScrollTop: 0,
				latchActive: false,
			}),
		).toEqual({
			nextLatch: false,
			shouldFetchMore: false,
			shouldCheckDismiss: false,
		});

		expect(
			decideScrollbackWheelAction({
				deltaY: -1,
				hasMore: true,
				loading: true,
				viewportScrollTop: 0,
				latchActive: true,
			}),
		).toEqual({
			nextLatch: true,
			shouldFetchMore: false,
			shouldCheckDismiss: false,
		});
	});

	it("fetches older once at top with upward wheel", () => {
		expect(
			decideScrollbackWheelAction({
				deltaY: -1,
				hasMore: true,
				loading: false,
				viewportScrollTop: 0,
				latchActive: false,
			}),
		).toEqual({
			nextLatch: true,
			shouldFetchMore: true,
			shouldCheckDismiss: false,
		});
	});

	it("does not refetch while latch is active", () => {
		expect(
			decideScrollbackWheelAction({
				deltaY: -1,
				hasMore: true,
				loading: false,
				viewportScrollTop: 0,
				latchActive: true,
			}),
		).toEqual({
			nextLatch: true,
			shouldFetchMore: false,
			shouldCheckDismiss: false,
		});
	});
});
