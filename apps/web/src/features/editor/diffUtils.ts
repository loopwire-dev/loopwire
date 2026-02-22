import { api } from "../../shared/lib/api";

export type DiffLineType = "context" | "addition" | "deletion";

export interface DiffLine {
	type: DiffLineType;
	content: string;
	oldLine: number | null;
	newLine: number | null;
	anchorNewLine?: number | null;
}

export interface DiffHunk {
	header: string;
	lines: DiffLine[];
}

export interface DiffFile {
	path: string;
	oldPath: string | null;
	newPath: string | null;
	status: "modified" | "added" | "deleted" | "renamed";
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

export interface GitDiffResponse {
	patch: string;
}

const GIT_DIFF_CLIENT_CACHE_TTL_MS = 5000;

interface CachedGitDiff {
	patch: string;
	files: DiffFile[];
	expiresAt: number;
}

const gitDiffClientCache = new Map<string, CachedGitDiff>();
const gitDiffClientInFlight = new Map<string, Promise<DiffFile[]>>();

/**
 * Returns cached parsed DiffFile[] synchronously, or null if no valid cache.
 * This avoids the async microtask delay so decorations can render immediately.
 */
export function getCachedDiffFiles(workspaceId: string): DiffFile[] | null {
	const cached = gitDiffClientCache.get(workspaceId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.files;
	}
	return null;
}

/**
 * Fetches git diff, parses the patch, caches both raw and parsed results.
 * Returns the parsed DiffFile[] directly (not the raw response).
 */
export async function fetchGitDiffFiles(
	workspaceId: string,
	force = false,
): Promise<DiffFile[]> {
	if (!force) {
		const cached = getCachedDiffFiles(workspaceId);
		if (cached) return cached;
		const inFlight = gitDiffClientInFlight.get(workspaceId);
		if (inFlight) return inFlight;
	}

	const promise = api
		.get<GitDiffResponse>("/git/diff", {
			workspace_id: workspaceId,
			...(force ? { force: "true" } : {}),
		})
		.then((response) => {
			const files = parseUnifiedPatch(response.patch);
			gitDiffClientCache.set(workspaceId, {
				patch: response.patch,
				files,
				expiresAt: Date.now() + GIT_DIFF_CLIENT_CACHE_TTL_MS,
			});
			return files;
		})
		.finally(() => {
			gitDiffClientInFlight.delete(workspaceId);
		});

	gitDiffClientInFlight.set(workspaceId, promise);
	return promise;
}

/**
 * Legacy wrapper: fetches diff and returns the raw GitDiffResponse.
 * Warms the parsed cache as a side-effect.
 */
export async function fetchGitDiff(
	workspaceId: string,
	force = false,
): Promise<GitDiffResponse> {
	await fetchGitDiffFiles(workspaceId, force);
	const cached = gitDiffClientCache.get(workspaceId);
	return { patch: cached?.patch ?? "" };
}

export function stripDiffPath(raw: string): string | null {
	const trimmed = raw.split("\t")[0]?.trim() ?? "";
	if (!trimmed || trimmed === "/dev/null") return null;
	if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
		return trimmed.slice(2);
	}
	return trimmed;
}

export function parseHunkHeader(
	header: string,
): { oldStart: number; newStart: number } | null {
	const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
	if (!match) return null;
	const oldStartRaw = match[1];
	const newStartRaw = match[2];
	if (!oldStartRaw || !newStartRaw) return null;
	return {
		oldStart: Number.parseInt(oldStartRaw, 10),
		newStart: Number.parseInt(newStartRaw, 10),
	};
}

export function parseUnifiedPatch(patch: string): DiffFile[] {
	if (!patch.trim()) return [];
	const lines = patch.split("\n");
	const files: DiffFile[] = [];

	let currentFile: DiffFile | null = null;
	let currentHunk: DiffHunk | null = null;
	let oldCursor = 0;
	let newCursor = 0;

	const pushCurrentFile = () => {
		if (!currentFile) return;
		if (!currentFile.path) {
			currentFile.path =
				currentFile.newPath ?? currentFile.oldPath ?? "Unknown file";
		}
		if (currentFile.oldPath === null && currentFile.newPath !== null) {
			currentFile.status = "added";
		}
		if (currentFile.newPath === null && currentFile.oldPath !== null) {
			currentFile.status = "deleted";
		}
		files.push(currentFile);
		currentFile = null;
		currentHunk = null;
	};

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			pushCurrentFile();
			const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
			currentFile = {
				path: match?.[2] ?? match?.[1] ?? "Unknown file",
				oldPath: match?.[1] ?? null,
				newPath: match?.[2] ?? null,
				status: "modified",
				additions: 0,
				deletions: 0,
				hunks: [],
			};
			currentHunk = null;
			continue;
		}

		if (!currentFile) continue;

		if (!currentHunk && line.startsWith("new file mode ")) {
			currentFile.status = "added";
			continue;
		}
		if (!currentHunk && line.startsWith("deleted file mode ")) {
			currentFile.status = "deleted";
			continue;
		}
		if (!currentHunk && line.startsWith("rename from ")) {
			currentFile.status = "renamed";
			currentFile.oldPath = line.slice("rename from ".length).trim();
			continue;
		}
		if (!currentHunk && line.startsWith("rename to ")) {
			currentFile.status = "renamed";
			currentFile.newPath = line.slice("rename to ".length).trim();
			currentFile.path = currentFile.newPath ?? currentFile.path;
			continue;
		}
		if (!currentHunk && line.startsWith("--- ")) {
			currentFile.oldPath = stripDiffPath(line.slice(4));
			continue;
		}
		if (!currentHunk && line.startsWith("+++ ")) {
			currentFile.newPath = stripDiffPath(line.slice(4));
			currentFile.path =
				currentFile.newPath ?? currentFile.oldPath ?? currentFile.path;
			continue;
		}
		if (line.startsWith("@@")) {
			const parsed = parseHunkHeader(line);
			if (parsed) {
				oldCursor = parsed.oldStart;
				newCursor = parsed.newStart;
			}
			currentHunk = {
				header: line,
				lines: [],
			};
			currentFile.hunks.push(currentHunk);
			continue;
		}

		if (!currentHunk) continue;

		if (line.startsWith("+")) {
			currentHunk.lines.push({
				type: "addition",
				content: line,
				oldLine: null,
				newLine: newCursor,
			});
			currentFile.additions += 1;
			newCursor += 1;
			continue;
		}

		if (line.startsWith("-")) {
			currentHunk.lines.push({
				type: "deletion",
				content: line,
				oldLine: oldCursor,
				newLine: null,
				anchorNewLine: newCursor,
			});
			currentFile.deletions += 1;
			oldCursor += 1;
			continue;
		}

		if (line.startsWith(" ")) {
			currentHunk.lines.push({
				type: "context",
				content: line,
				oldLine: oldCursor,
				newLine: newCursor,
			});
			oldCursor += 1;
			newCursor += 1;
			continue;
		}

		if (line.startsWith("\\ No newline at end of file")) {
			currentHunk.lines.push({
				type: "context",
				content: line,
				oldLine: null,
				newLine: null,
			});
		}
	}

	pushCurrentFile();
	return files;
}
