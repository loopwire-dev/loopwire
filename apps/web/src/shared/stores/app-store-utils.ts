export interface WorkspaceRootLike {
	id?: string;
	path: string;
}

const SIDEBAR_COMPACT_KEY = "loopwire_sidebar_compact";

export function loadSidebarCompact(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_COMPACT_KEY) === "true";
	} catch {
		return false;
	}
}

export function defaultWorkspaceName(path: string): string {
	return path.split("/").filter(Boolean).pop() ?? path;
}

export function normalizeWorkspacePath(path: string): string {
	return path === "/" ? "/" : path.replace(/\/+$/, "");
}

export function normalizeWorkspaceId(
	workspaceId: string | null | undefined,
): string | null {
	if (typeof workspaceId !== "string") return null;
	const trimmed = workspaceId.trim();
	return trimmed || null;
}

export function workspaceStoreKey(
	workspaceId: string | null | undefined,
): string | null {
	const normalizedId = normalizeWorkspaceId(workspaceId);
	if (normalizedId) return `id:${normalizedId}`;
	return null;
}

export function resolveWorkspaceStoreKeyFromPath(
	workspacePath: string,
	roots: WorkspaceRootLike[],
): string | null {
	const normalizedPath = normalizeWorkspacePath(workspacePath);
	const matchedRoot = roots.find(
		(root) => normalizeWorkspacePath(root.path) === normalizedPath,
	);
	return workspaceStoreKey(matchedRoot?.id ?? null);
}

export function workspaceStoreKeyForSelection(
	workspaceId: string | null | undefined,
	_workspacePath: string | null | undefined,
): string | null {
	return workspaceStoreKey(workspaceId);
}

export function normalizeWorkspaceIcon(
	icon: string | null | undefined,
): string | null {
	if (typeof icon !== "string") return null;
	const trimmed = icon.trim();
	if (!trimmed) return null;
	if (/^data:image\//i.test(trimmed)) {
		return trimmed;
	}
	if (/^:[a-z0-9_+-]{1,64}:$/i.test(trimmed)) {
		return trimmed.toLowerCase();
	}
	return [...trimmed].slice(0, 2).join("");
}

export function isActiveStatus(status: string): boolean {
	return status === "running" || status === "restored";
}
