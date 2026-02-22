import { useCallback, useRef, useState } from "react";
import { sessionScrollback } from "../../shared/lib/daemon/rest";

interface ScrollbackData {
	data: string; // base64-encoded raw PTY bytes
	start_offset: number;
	end_offset: number;
	has_more: boolean;
}

interface UseScrollbackReturn {
	pages: ScrollbackData[];
	loading: boolean;
	hasMore: boolean;
	error: string | null;
	fetchInitial: (sessionId: string) => Promise<void>;
	fetchMore: () => Promise<void>;
	reset: () => void;
}

export function useScrollback(): UseScrollbackReturn {
	const [pages, setPages] = useState<ScrollbackData[]>([]);
	const [loading, setLoading] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const loadingRef = useRef(false);
	const requestedBeforeOffsetsRef = useRef<Set<number>>(new Set());

	const fetchInitial = useCallback(async (sessionId: string) => {
		sessionIdRef.current = sessionId;
		requestedBeforeOffsetsRef.current.clear();
		loadingRef.current = true;
		setLoading(true);
		setError(null);
		setPages([]);
		setHasMore(false);

		try {
			const data = await sessionScrollback(sessionId, {
				maxBytes: 524288,
			});
			setPages([data]);
			setHasMore(data.has_more);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to fetch scrollback",
			);
		} finally {
			loadingRef.current = false;
			setLoading(false);
		}
	}, []);

	const fetchMore = useCallback(async () => {
		const sessionId = sessionIdRef.current;
		if (!sessionId || loadingRef.current) return;

		const firstPage = pages[0];
		if (!firstPage || !firstPage.has_more) return;
		if (requestedBeforeOffsetsRef.current.has(firstPage.start_offset)) return;

		requestedBeforeOffsetsRef.current.add(firstPage.start_offset);
		loadingRef.current = true;
		setLoading(true);
		try {
			const data = await sessionScrollback(sessionId, {
				beforeOffset: firstPage.start_offset,
				maxBytes: 524288,
			});
			const isDuplicate = pages.some(
				(page) =>
					page.start_offset === data.start_offset &&
					page.end_offset === data.end_offset,
			);
			if (isDuplicate) {
				// No pagination progress: stop retry-looping the same cursor.
				setHasMore(false);
				return;
			}
			setPages((prev) => [data, ...prev]);
			setHasMore(data.has_more);
		} catch (err) {
			requestedBeforeOffsetsRef.current.delete(firstPage.start_offset);
			setError(
				err instanceof Error ? err.message : "Failed to fetch more scrollback",
			);
		} finally {
			loadingRef.current = false;
			setLoading(false);
		}
	}, [pages]);

	const reset = useCallback(() => {
		sessionIdRef.current = null;
		loadingRef.current = false;
		requestedBeforeOffsetsRef.current.clear();
		setPages([]);
		setLoading(false);
		setHasMore(false);
		setError(null);
	}, []);

	return { pages, loading, hasMore, error, fetchInitial, fetchMore, reset };
}
