interface WheelDecisionArgs {
	deltaY: number;
	hasMore: boolean;
	loading: boolean;
	viewportScrollTop: number;
	latchActive: boolean;
}

interface WheelDecision {
	nextLatch: boolean;
	shouldFetchMore: boolean;
	shouldCheckDismiss: boolean;
}

export function decideScrollbackWheelAction(
	args: WheelDecisionArgs,
): WheelDecision {
	const { deltaY, hasMore, loading, viewportScrollTop, latchActive } = args;

	if (deltaY > 0) {
		return {
			nextLatch: false,
			shouldFetchMore: false,
			shouldCheckDismiss: true,
		};
	}

	if (!hasMore || loading) {
		return {
			nextLatch: latchActive,
			shouldFetchMore: false,
			shouldCheckDismiss: false,
		};
	}

	if (viewportScrollTop === 0 && deltaY < 0 && !latchActive) {
		return {
			nextLatch: true,
			shouldFetchMore: true,
			shouldCheckDismiss: false,
		};
	}

	return {
		nextLatch: latchActive,
		shouldFetchMore: false,
		shouldCheckDismiss: false,
	};
}
