import { useEffect, useMemo, useRef, useState } from "react";
import {
	type GitStatusResponseDto,
	gitStatus,
	isNotGitRepoError,
} from "../../shared/lib/daemon/rest";
import {
	onDaemonWsReconnect,
	onGitStatusEvent,
	subscribeGitStatus,
	unsubscribeGitStatus,
} from "../../shared/lib/daemon/ws";

type FileStatus =
	| "added"
	| "modified"
	| "deleted"
	| "untracked"
	| "renamed"
	| "ignored"
	| "clean";

interface GitFileInfo {
	status: FileStatus;
	additions?: number;
	deletions?: number;
}

const STATUS_SEVERITY: Record<FileStatus, number> = {
	modified: 6,
	deleted: 5,
	added: 4,
	untracked: 3,
	renamed: 2,
	ignored: 1,
	clean: 0,
};

function worstStatus(a: FileStatus, b: FileStatus): FileStatus {
	return STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b;
}

export interface GitStatusMap {
	getFile(path: string): GitFileInfo | null;
	getFolder(dirPath: string): FileStatus;
	isIgnored(path: string): boolean;
	isGitRepo: boolean;
	loaded: boolean;
}

const EMPTY_STATUS: GitStatusMap = {
	getFile: () => null,
	getFolder: () => "clean",
	isIgnored: () => false,
	isGitRepo: false,
	loaded: false,
};

const gitStatusCache = new Map<string, GitStatusResponseDto>();

function fetchGitStatus(wid: string): Promise<GitStatusResponseDto | null> {
	return gitStatus(wid)
		.then((res) => {
			gitStatusCache.set(wid, res);
			return res;
		})
		.catch((err) => {
			if (isNotGitRepoError(err)) return null;
			return null;
		});
}

export function useGitStatus(workspaceId: string | null): GitStatusMap {
	// Seed state from module-level cache so colors render immediately on re-mount
	const [data, setData] = useState<GitStatusResponseDto | null>(() =>
		workspaceId ? (gitStatusCache.get(workspaceId) ?? null) : null,
	);
	const [loaded, setLoaded] = useState(
		() => !!(workspaceId && gitStatusCache.has(workspaceId)),
	);
	const fetchIdRef = useRef(0);

	useEffect(() => {
		if (!workspaceId) {
			setData(null);
			setLoaded(false);
			return;
		}

		const id = ++fetchIdRef.current;

		// Apply from cache immediately if available (covers workspace switches)
		const cached = gitStatusCache.get(workspaceId);
		if (cached) {
			setData(cached);
			setLoaded(true);
		}

		// Initial REST fetch for immediate data
		fetchGitStatus(workspaceId).then((res) => {
			if (id !== fetchIdRef.current) return; // stale
			setData(res);
			setLoaded(true);
		});

		// Subscribe to git status updates over WS
		subscribeGitStatus(workspaceId);

		// Listen for git:status push messages
		const offStatus = onGitStatusEvent((payload) => {
			if (id !== fetchIdRef.current) return;
			if (payload.workspace_id !== workspaceId) return;
			const response: GitStatusResponseDto = {
				files: payload.files,
				ignored_dirs: payload.ignored_dirs,
			};
			gitStatusCache.set(workspaceId, response);
			setData(response);
			setLoaded(true);
		});

		// Re-subscribe on WS reconnect
		const offReconnect = onDaemonWsReconnect(() => {
			if (id !== fetchIdRef.current) return;
			subscribeGitStatus(workspaceId);
		});

		return () => {
			++fetchIdRef.current; // invalidate pending callbacks
			offStatus();
			offReconnect();
			unsubscribeGitStatus(workspaceId);
		};
	}, [workspaceId]);

	return useMemo(() => {
		if (!loaded || !data) return EMPTY_STATUS;

		const fileMap = new Map<string, GitFileInfo>();
		for (const [path, info] of Object.entries(data.files)) {
			fileMap.set(path, {
				status: info.status as FileStatus,
				additions: info.additions ?? undefined,
				deletions: info.deletions ?? undefined,
			});
		}

		// Pre-compute folder statuses by walking each changed file's path segments upward
		const folderMap = new Map<string, FileStatus>();
		for (const [path, info] of fileMap) {
			const segments = path.split("/");
			for (let i = 1; i < segments.length; i++) {
				const dir = segments.slice(0, i).join("/");
				const current = folderMap.get(dir) ?? "clean";
				folderMap.set(dir, worstStatus(current, info.status));
			}
		}

		const ignoredDirs = data.ignored_dirs;

		return {
			getFile(path: string): GitFileInfo | null {
				return fileMap.get(path) ?? null;
			},
			getFolder(dirPath: string): FileStatus {
				return folderMap.get(dirPath) ?? "clean";
			},
			isIgnored(path: string): boolean {
				if (ignoredDirs.length === 0) return false;
				for (const dir of ignoredDirs) {
					if (path === dir || path.startsWith(`${dir}/`)) return true;
				}
				return false;
			},
			isGitRepo: true,
			loaded: true,
		};
	}, [loaded, data]);
}
