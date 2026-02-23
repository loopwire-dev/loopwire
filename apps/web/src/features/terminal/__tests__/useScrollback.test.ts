import { beforeEach, describe, expect, it, vi } from "vitest";

const { useStateMock, useRefMock, useCallbackMock, sessionScrollbackMock } =
	vi.hoisted(() => ({
		useStateMock: vi.fn(),
		useRefMock: vi.fn(),
		useCallbackMock: vi.fn(),
		sessionScrollbackMock: vi.fn(),
	}));

vi.mock("react", () => ({
	useState: useStateMock,
	useRef: useRefMock,
	useCallback: useCallbackMock,
}));

vi.mock("../../../shared/lib/daemon/rest", () => ({
	sessionScrollback: sessionScrollbackMock,
}));

function mockHookState(values: unknown[]) {
	const setters = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
	let idx = 0;
	useStateMock.mockImplementation((initial: unknown) => {
		const value = idx < values.length ? values[idx] : initial;
		const setter = setters[idx] ?? vi.fn();
		idx += 1;
		return [value, setter];
	});
	return {
		setPages: setters[0],
		setLoading: setters[1],
		setHasMore: setters[2],
		setError: setters[3],
	};
}

describe("useScrollback", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useRefMock.mockReset();
		useCallbackMock.mockReset();
		sessionScrollbackMock.mockReset();
		useRefMock.mockImplementation((value: unknown) => ({ current: value }));
		useCallbackMock.mockImplementation((fn: unknown) => fn);
	});

	it("fetchInitial loads first page and updates state", async () => {
		const state = mockHookState([[], false, false, null]);
		sessionScrollbackMock.mockResolvedValue({
			data: "abc",
			start_offset: 0,
			end_offset: 10,
			has_more: true,
		});

		const { useScrollback } = await import("../hooks/useScrollback");
		const hook = useScrollback();
		await hook.fetchInitial("s1");

		expect(sessionScrollbackMock).toHaveBeenCalledWith("s1", {
			maxBytes: 524288,
		});
		expect(state.setLoading).toHaveBeenCalledWith(true);
		expect(state.setLoading).toHaveBeenLastCalledWith(false);
		expect(state.setError).toHaveBeenCalledWith(null);
		expect(state.setPages).toHaveBeenCalledWith([]);
		expect(state.setPages).toHaveBeenCalledWith([
			{ data: "abc", start_offset: 0, end_offset: 10, has_more: true },
		]);
		expect(state.setHasMore).toHaveBeenCalledWith(true);
	});

	it("fetchInitial stores message when request fails", async () => {
		const state = mockHookState([[], false, false, null]);
		sessionScrollbackMock.mockRejectedValue(new Error("boom"));

		const { useScrollback } = await import("../hooks/useScrollback");
		const hook = useScrollback();
		await hook.fetchInitial("s1");

		expect(state.setError).toHaveBeenCalledWith("boom");
		expect(state.setLoading).toHaveBeenLastCalledWith(false);
	});

	it("fetchMore returns early when no active session", async () => {
		mockHookState([[], false, false, null]);
		const { useScrollback } = await import("../hooks/useScrollback");
		const hook = useScrollback();
		await hook.fetchMore();
		expect(sessionScrollbackMock).not.toHaveBeenCalled();
	});

	it("fetchMore appends non-duplicate page", async () => {
		const firstPage = {
			data: "old",
			start_offset: 100,
			end_offset: 200,
			has_more: true,
		};
		const state = mockHookState([[firstPage], false, true, null]);
		sessionScrollbackMock
			.mockResolvedValueOnce(firstPage)
			.mockResolvedValueOnce({
				data: "older",
				start_offset: 0,
				end_offset: 99,
				has_more: false,
			});

		const { useScrollback } = await import("../hooks/useScrollback");
		const hook = useScrollback();
		await hook.fetchInitial("s1");
		await hook.fetchMore();

		expect(sessionScrollbackMock).toHaveBeenNthCalledWith(2, "s1", {
			beforeOffset: 100,
			maxBytes: 524288,
		});
		expect(state.setPages).toHaveBeenCalledWith(expect.any(Function));
		expect(state.setHasMore).toHaveBeenCalledWith(false);
	});
});
