import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../shared/lib/api";
import { useAppStore } from "../../shared/stores/app-store";

export interface DirEntry {
	name: string;
	kind: "file" | "directory" | "symlink";
	size: number | null;
	modified: number | null;
}

const fsListInFlight = new Map<string, Promise<DirEntry[]>>();

function fetchFsList(
	workspaceId: string,
	relativePath: string,
): Promise<DirEntry[]> {
	const key = `${workspaceId}::${relativePath}`;
	const existing = fsListInFlight.get(key);
	if (existing) return existing;

	const request = api
		.get<DirEntry[]>("/fs/list", {
			workspace_id: workspaceId,
			relative_path: relativePath,
		})
		.finally(() => {
			fsListInFlight.delete(key);
		});

	fsListInFlight.set(key, request);
	return request;
}

export function useFileSystem() {
	const [entries, setEntries] = useState<DirEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const workspaceId = useAppStore((s) => s.workspaceId);
	const fetchIdRef = useRef(0);

	const fetchRoots = useCallback(async () => {
		const res = await api.get<{ roots: string[] }>("/fs/roots");
		return res.roots;
	}, []);

	const listDirectory = useCallback(
		async (relativePath = ".") => {
			if (!workspaceId) return;
			setLoading(true);
			setError(null);
			try {
				const res = await fetchFsList(workspaceId, relativePath);
				setEntries(res);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Failed to list directory",
				);
			} finally {
				setLoading(false);
			}
		},
		[workspaceId],
	);

	useEffect(() => {
		if (!workspaceId) return;
		const id = ++fetchIdRef.current;

		(async () => {
			setLoading(true);
			setError(null);
			try {
				const res = await fetchFsList(workspaceId, ".");
				if (id !== fetchIdRef.current) return;
				setEntries(res);
			} catch (err) {
				if (id !== fetchIdRef.current) return;
				setError(
					err instanceof Error ? err.message : "Failed to list directory",
				);
			} finally {
				if (id === fetchIdRef.current) setLoading(false);
			}
		})();

		return () => {
			++fetchIdRef.current;
		};
	}, [workspaceId]);

	const readFile = useCallback(
		async (relativePath: string) => {
			if (!workspaceId) return null;
			const res = await api.get<{
				content: string;
				size: number;
				is_binary: boolean;
				binary_content_base64: string | null;
			}>("/fs/read", {
				workspace_id: workspaceId,
				relative_path: relativePath,
			});
			return res;
		},
		[workspaceId],
	);

	return { entries, loading, error, fetchRoots, listDirectory, readFile };
}
