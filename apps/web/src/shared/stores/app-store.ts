import { create } from "zustand";

export interface QuotaData {
	session_id: string;
	agent_type: string;
	tokens_in: number;
	tokens_out: number;
	cost_usd: number | null;
	source: string;
	source_confidence: "authoritative" | "estimated";
}

export interface WorkspaceRoot {
	path: string;
	name: string;
	pinned: boolean;
	icon?: string | null;
}

export interface WorkspaceSession {
	sessionId: string;
	agentType: string;
	customName?: string | null;
	status: string;
	workspacePath: string;
	createdAt: string;
}

const TOKEN_KEY = "loopwire_token";
const WORKSPACES_KEY = "loopwire_workspaces";
const SIDEBAR_COMPACT_KEY = "loopwire_sidebar_compact";

function loadSidebarCompact(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_COMPACT_KEY) === "true";
	} catch {
		return false;
	}
}

function defaultWorkspaceName(path: string): string {
	return path.split("/").filter(Boolean).pop() ?? path;
}

function normalizeWorkspacePath(path: string): string {
	return path === "/" ? "/" : path.replace(/\/+$/, "");
}

function normalizeWorkspaceIcon(icon: string | null | undefined): string | null {
	if (typeof icon !== "string") return null;
	const trimmed = icon.trim();
	if (!trimmed) return null;
	if (/^:[a-z0-9_+-]{1,64}:$/i.test(trimmed)) {
		return trimmed.toLowerCase();
	}
	return [...trimmed].slice(0, 2).join("");
}

function mergeSessionsForNormalizedPath(
	sessionsByWorkspacePath: Record<string, WorkspaceSession[]>,
	normalizedPath: string,
): WorkspaceSession[] {
	const merged: WorkspaceSession[] = [];
	for (const [path, sessions] of Object.entries(sessionsByWorkspacePath)) {
		if (normalizeWorkspacePath(path) !== normalizedPath) continue;
		merged.push(...sessions);
	}
	return normalizeWorkspaceSessions(merged);
}

function findActiveSessionIdForNormalizedPath(
	activeByWorkspacePath: Record<string, string | null>,
	normalizedPath: string,
): string | null {
	for (const [path, sessionId] of Object.entries(activeByWorkspacePath)) {
		if (normalizeWorkspacePath(path) !== normalizedPath) continue;
		if (sessionId) return sessionId;
	}
	return null;
}

function normalizeWorkspaceRoots(roots: WorkspaceRoot[]): WorkspaceRoot[] {
	const unique = new Map<string, WorkspaceRoot>();
	for (const root of roots) {
		if (!root?.path) continue;
		if (unique.has(root.path)) continue;
		unique.set(root.path, {
			path: root.path,
			name: root.name?.trim() || defaultWorkspaceName(root.path),
			pinned: Boolean(root.pinned),
			icon: normalizeWorkspaceIcon(root.icon),
		});
	}
	const all = [...unique.values()];
	const pinned = all.filter((r) => r.pinned);
	const unpinned = all.filter((r) => !r.pinned);
	return [...pinned, ...unpinned];
}

function normalizeWorkspaceSessions(
	sessions: WorkspaceSession[],
): WorkspaceSession[] {
	const unique = new Map<string, WorkspaceSession>();
	for (const session of sessions) {
		if (!session.sessionId || session.status !== "running") continue;
		const customName =
			typeof session.customName === "string" ? session.customName.trim() : "";
		unique.set(session.sessionId, {
			...session,
			customName: customName || null,
		});
	}
	return [...unique.values()];
}

function loadWorkspaceRoots(): WorkspaceRoot[] {
	try {
		const raw = localStorage.getItem(WORKSPACES_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				const migrated = parsed
					.map((entry): WorkspaceRoot | null => {
						if (typeof entry === "string") {
							return {
								path: entry,
								name: defaultWorkspaceName(entry),
								pinned: false,
								icon: null,
															};
						}
						if (
							entry &&
							typeof entry === "object" &&
							"path" in entry &&
							typeof entry.path === "string"
						) {
							return {
								path: entry.path,
								name:
									"name" in entry && typeof entry.name === "string"
										? entry.name
										: defaultWorkspaceName(entry.path),
								pinned:
									"pinned" in entry && typeof entry.pinned === "boolean"
										? entry.pinned
										: false,
								icon:
									"icon" in entry && typeof entry.icon === "string"
										? entry.icon
										: null,
							};
						}
						return null;
					})
					.filter((entry): entry is WorkspaceRoot => entry !== null);
				return normalizeWorkspaceRoots(migrated);
			}
		}
	} catch {
		// Corrupted — start fresh
	}
	return [];
}

function persistWorkspaceRoots(roots: WorkspaceRoot[]) {
	localStorage.setItem(WORKSPACES_KEY, JSON.stringify(roots));
}

export interface AppState {
	// Auth
	token: string | null;
	exchangingToken: boolean;
	setExchangingToken: (v: boolean) => void;
	setToken: (token: string) => void;
	logout: () => void;

	// Connection
	daemonConnected: boolean;
	setDaemonConnected: (connected: boolean) => void;

	// Workspace
	workspacePath: string | null;
	workspaceId: string | null;
	setWorkspace: (path: string, id: string) => void;
	setWorkspacePath: (path: string) => void;
	clearWorkspace: () => void;

	// Workspace roots (persisted)
	workspaceRoots: WorkspaceRoot[];
	setWorkspaceRoots: (roots: WorkspaceRoot[]) => void;
	addWorkspaceRoot: (path: string) => void;
	removeWorkspaceRoot: (path: string) => void;
	setWorkspacePinned: (path: string, pinned: boolean) => void;
	renameWorkspaceRoot: (path: string, name: string) => void;
	setWorkspaceIcon: (path: string, icon: string | null) => void;
	reorderWorkspaceRoots: (fromPath: string, toPath: string) => void;
	mergeBackendWorkspaces: (entries: WorkspaceRoot[]) => void;

	// Sidebar UI
	browsingForWorkspace: boolean;
	setBrowsingForWorkspace: (v: boolean) => void;
	sidebarCompact: boolean;
	toggleSidebarCompact: () => void;
	settingsOpen: boolean;
	setSettingsOpen: (v: boolean) => void;

	// Agent sessions scoped by workspace
	sessionsByWorkspacePath: Record<string, WorkspaceSession[]>;
	activeSessionIdByWorkspacePath: Record<string, string | null>;
	setWorkspaceSessions: (path: string, sessions: WorkspaceSession[]) => void;
	hydrateWorkspaceSessions: (sessions: WorkspaceSession[]) => void;
	upsertWorkspaceSession: (session: WorkspaceSession) => void;
	reorderWorkspaceSession: (
		workspacePath: string,
		fromSessionId: string,
		toSessionId: string,
	) => void;
	renameSessionCustomName: (sessionId: string, customName: string | null) => void;
	removeWorkspaceSession: (workspacePath: string, sessionId: string) => void;
	removeSessionById: (sessionId: string) => void;
	attachWorkspaceSession: (workspacePath: string, sessionId: string | null) => void;
	clearAllSessions: () => void;

	// Editor
	openFilePath: string | null;
	openFileContent: string | null;
	setOpenFile: (path: string, content: string) => void;
	clearOpenFile: () => void;

	// Quota
	quotaData: QuotaData[];
	setQuotaData: (data: QuotaData[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
	token: localStorage.getItem(TOKEN_KEY),
	exchangingToken: new URLSearchParams(window.location.search).has("token"),
	setExchangingToken: (v) => set({ exchangingToken: v }),
	setToken: (token) => {
		localStorage.setItem(TOKEN_KEY, token);
		set({ token, exchangingToken: false });
	},
	logout: () => {
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(WORKSPACES_KEY);
		set({
			token: null,
			sessionsByWorkspacePath: {},
			activeSessionIdByWorkspacePath: {},
			workspaceRoots: [],
			workspacePath: null,
			workspaceId: null,
			openFilePath: null,
			openFileContent: null,
			quotaData: [],
			browsingForWorkspace: false,
			settingsOpen: false,
		});
	},

	daemonConnected: false,
	setDaemonConnected: (connected) => set({ daemonConnected: connected }),

	workspacePath: null,
	workspaceId: null,
	setWorkspace: (path, id) => set({ workspacePath: path, workspaceId: id }),
	setWorkspacePath: (path) =>
		set({
			workspacePath: path,
			workspaceId: null,
			openFilePath: null,
			openFileContent: null,
			quotaData: [],
		}),
	clearWorkspace: () =>
		set({
			workspacePath: null,
			workspaceId: null,
			openFilePath: null,
			openFileContent: null,
			quotaData: [],
		}),

	workspaceRoots: loadWorkspaceRoots(),
	setWorkspaceRoots: (roots) => {
		const normalized = normalizeWorkspaceRoots(roots);
		persistWorkspaceRoots(normalized);
		set({ workspaceRoots: normalized });
	},
	addWorkspaceRoot: (path) =>
		set((state) => {
			if (state.workspaceRoots.some((root) => root.path === path)) return state;
			const roots = normalizeWorkspaceRoots([
				...state.workspaceRoots,
				{
					path,
					name: defaultWorkspaceName(path),
					pinned: false,
					icon: null,
									},
			]);
			persistWorkspaceRoots(roots);
			return { workspaceRoots: roots };
		}),
	removeWorkspaceRoot: (path) =>
		set((state) => {
			const roots = state.workspaceRoots.filter((root) => root.path !== path);
			persistWorkspaceRoots(roots);
			return { workspaceRoots: roots };
		}),
	setWorkspacePinned: (path, pinned) =>
		set((state) => {
			const idx = state.workspaceRoots.findIndex((root) => root.path === path);
			if (idx === -1) return state;

			const next = [...state.workspaceRoots];
			const [picked] = next.splice(idx, 1);
			if (!picked) return state;
			if (picked.pinned === pinned) return state;
			picked.pinned = pinned;
			const firstUnpinned = next.findIndex((root) => !root.pinned);
			if (pinned) {
				if (firstUnpinned === -1) {
					next.push(picked);
				} else {
					next.splice(firstUnpinned, 0, picked);
				}
			} else {
				// On unpin, place item at the top of the unpinned section.
				if (firstUnpinned === -1) {
					next.push(picked);
				} else {
					next.splice(firstUnpinned, 0, picked);
				}
			}
			const normalized = normalizeWorkspaceRoots(next);
			persistWorkspaceRoots(normalized);
			return { workspaceRoots: normalized };
		}),
	renameWorkspaceRoot: (path, name) =>
		set((state) => {
			const normalizedName = name.trim();
			if (!normalizedName) return state;
			const roots = state.workspaceRoots.map((root) =>
				root.path === path ? { ...root, name: normalizedName } : root,
			);
			persistWorkspaceRoots(roots);
			return { workspaceRoots: roots };
		}),
	setWorkspaceIcon: (path, icon) =>
		set((state) => {
			const normalizedIcon = normalizeWorkspaceIcon(icon);
			const roots = state.workspaceRoots.map((root) =>
				root.path === path ? { ...root, icon: normalizedIcon } : root,
			);
			persistWorkspaceRoots(roots);
			return { workspaceRoots: roots };
		}),
	reorderWorkspaceRoots: (fromPath, toPath) =>
		set((state) => {
			if (fromPath === toPath) return state;
			const fromIndex = state.workspaceRoots.findIndex(
				(root) => root.path === fromPath,
			);
			const toIndex = state.workspaceRoots.findIndex(
				(root) => root.path === toPath,
			);
			if (fromIndex === -1 || toIndex === -1) return state;

			const fromRoot = state.workspaceRoots[fromIndex];
			const toRoot = state.workspaceRoots[toIndex];
			if (!fromRoot || !toRoot) return state;

			// Keep pinned and unpinned groups separated.
			if (fromRoot.pinned !== toRoot.pinned) return state;

			const next = [...state.workspaceRoots];
			const [moved] = next.splice(fromIndex, 1);
			if (!moved) return state;
			next.splice(toIndex, 0, moved);
			const normalized = normalizeWorkspaceRoots(next);
			persistWorkspaceRoots(normalized);
			return { workspaceRoots: normalized };
		}),

	mergeBackendWorkspaces: (entries) =>
		set(() => {
			// Backend is the sole source of truth.
			const roots = normalizeWorkspaceRoots(
				entries.map((entry) => ({
					path: entry.path,
					name: entry.name?.trim() || defaultWorkspaceName(entry.path),
					pinned: Boolean(entry.pinned),
					icon: normalizeWorkspaceIcon(entry.icon),
				})),
			);
			persistWorkspaceRoots(roots);
			return { workspaceRoots: roots };
		}),

	browsingForWorkspace: false,
	setBrowsingForWorkspace: (v) => set({ browsingForWorkspace: v }),
	sidebarCompact: loadSidebarCompact(),
	toggleSidebarCompact: () =>
		set((state) => {
			const next = !state.sidebarCompact;
			localStorage.setItem(SIDEBAR_COMPACT_KEY, String(next));
			return { sidebarCompact: next };
		}),
	settingsOpen: false,
	setSettingsOpen: (v) => set({ settingsOpen: v }),

	sessionsByWorkspacePath: {},
	activeSessionIdByWorkspacePath: {},
	setWorkspaceSessions: (path, sessions) =>
		set((state) => {
			const normalizedPath = normalizeWorkspacePath(path);
			const normalized = normalizeWorkspaceSessions(sessions);
			const nextSessionsByWorkspacePath = {
				...state.sessionsByWorkspacePath,
			};
			for (const existingPath of Object.keys(nextSessionsByWorkspacePath)) {
				if (normalizeWorkspacePath(existingPath) === normalizedPath) {
					delete nextSessionsByWorkspacePath[existingPath];
				}
			}
			nextSessionsByWorkspacePath[normalizedPath] = normalized;

			const nextActive = {
				...state.activeSessionIdByWorkspacePath,
			};
			for (const existingPath of Object.keys(nextActive)) {
				if (normalizeWorkspacePath(existingPath) === normalizedPath) {
					delete nextActive[existingPath];
				}
			}
			const activeSessionId =
				findActiveSessionIdForNormalizedPath(
					state.activeSessionIdByWorkspacePath,
					normalizedPath,
				) ?? null;
			const activeStillExists = normalized.some(
				(session) => session.sessionId === activeSessionId,
			);
			nextActive[normalizedPath] = activeStillExists ? activeSessionId : null;

			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
				activeSessionIdByWorkspacePath: nextActive,
			};
		}),
	hydrateWorkspaceSessions: (sessions) =>
		set(() => {
			const grouped = sessions.reduce<Record<string, WorkspaceSession[]>>(
				(acc, session) => {
					if (session.status !== "running") return acc;
					const key = normalizeWorkspacePath(session.workspacePath);
					const list = acc[key] ?? [];
					list.push(session);
					acc[key] = list;
					return acc;
				},
				{},
			);

			const sessionsByWorkspacePath = Object.fromEntries(
				Object.entries(grouped).map(([path, groupedSessions]) => [
					path,
					normalizeWorkspaceSessions(groupedSessions),
				]),
			);

			const activeSessionIdByWorkspacePath: Record<string, string | null> = {};
			for (const [path, groupedSessions] of Object.entries(
				sessionsByWorkspacePath,
			)) {
				activeSessionIdByWorkspacePath[path] =
					groupedSessions.length === 1 ? groupedSessions[0]?.sessionId ?? null : null;
			}

			return {
				sessionsByWorkspacePath,
				activeSessionIdByWorkspacePath,
			};
		}),
	upsertWorkspaceSession: (session) =>
		set((state) => {
			if (session.status !== "running") {
				return state;
			}
			const normalizedPath = normalizeWorkspacePath(session.workspacePath);
			const existing = mergeSessionsForNormalizedPath(
				state.sessionsByWorkspacePath,
				normalizedPath,
			);
			const filtered = existing.filter((s) => s.sessionId !== session.sessionId);
			const nextSessions = normalizeWorkspaceSessions([
				...filtered,
				{ ...session, workspacePath: normalizedPath },
			]);
			const nextSessionsByWorkspacePath = {
				...state.sessionsByWorkspacePath,
			};
			for (const existingPath of Object.keys(nextSessionsByWorkspacePath)) {
				if (normalizeWorkspacePath(existingPath) === normalizedPath) {
					delete nextSessionsByWorkspacePath[existingPath];
				}
			}
			nextSessionsByWorkspacePath[normalizedPath] = nextSessions;
			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
			};
		}),
	reorderWorkspaceSession: (workspacePath, fromSessionId, toSessionId) =>
		set((state) => {
			if (fromSessionId === toSessionId) return state;
			const normalizedPath = normalizeWorkspacePath(workspacePath);
			const current = mergeSessionsForNormalizedPath(
				state.sessionsByWorkspacePath,
				normalizedPath,
			);
			const fromIndex = current.findIndex((s) => s.sessionId === fromSessionId);
			const toIndex = current.findIndex((s) => s.sessionId === toSessionId);
			if (fromIndex === -1 || toIndex === -1) return state;

			const next = [...current];
			const [moved] = next.splice(fromIndex, 1);
			if (!moved) return state;
			next.splice(toIndex, 0, moved);

			const nextSessionsByWorkspacePath = {
				...state.sessionsByWorkspacePath,
			};
			for (const existingPath of Object.keys(nextSessionsByWorkspacePath)) {
				if (normalizeWorkspacePath(existingPath) === normalizedPath) {
					delete nextSessionsByWorkspacePath[existingPath];
				}
			}
			nextSessionsByWorkspacePath[normalizedPath] = next;

			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
			};
		}),
	renameSessionCustomName: (sessionId, customName) =>
		set((state) => {
			const trimmedName = customName?.trim() ?? "";
			let changed = false;
			const nextSessionsByWorkspacePath = Object.fromEntries(
				Object.entries(state.sessionsByWorkspacePath).map(([path, sessions]) => {
					let pathChanged = false;
					const nextSessions = sessions.map((session) => {
						if (session.sessionId !== sessionId) return session;
						const normalizedCustomName = trimmedName || null;
						if ((session.customName ?? null) === normalizedCustomName) {
							return session;
						}
						pathChanged = true;
						return {
							...session,
							customName: normalizedCustomName,
						};
					});
					if (pathChanged) {
						changed = true;
					}
					return [path, pathChanged ? nextSessions : sessions];
				}),
			);

			if (!changed) return state;
			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
			};
		}),
	removeWorkspaceSession: (workspacePath, sessionId) =>
		set((state) => {
			const normalizedPath = normalizeWorkspacePath(workspacePath);
			const existing = mergeSessionsForNormalizedPath(
				state.sessionsByWorkspacePath,
				normalizedPath,
			);
			const filtered = existing.filter((s) => s.sessionId !== sessionId);
			const nextSessionsByWorkspacePath = {
				...state.sessionsByWorkspacePath,
			};
			for (const existingPath of Object.keys(nextSessionsByWorkspacePath)) {
				if (normalizeWorkspacePath(existingPath) === normalizedPath) {
					delete nextSessionsByWorkspacePath[existingPath];
				}
			}
			if (filtered.length === 0) {
				delete nextSessionsByWorkspacePath[normalizedPath];
			} else {
				nextSessionsByWorkspacePath[normalizedPath] = filtered;
			}

			const activeId =
				findActiveSessionIdForNormalizedPath(
					state.activeSessionIdByWorkspacePath,
					normalizedPath,
				) ?? null;
			const nextActive = {
				...state.activeSessionIdByWorkspacePath,
			};
			for (const existingPath of Object.keys(nextActive)) {
				if (normalizeWorkspacePath(existingPath) === normalizedPath) {
					delete nextActive[existingPath];
				}
			}
			if (normalizedPath in nextSessionsByWorkspacePath) {
				nextActive[normalizedPath] = activeId === sessionId ? null : activeId;
			}

			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
				activeSessionIdByWorkspacePath: nextActive,
			};
		}),
	removeSessionById: (sessionId) =>
		set((state) => {
			let nextSessionsByWorkspacePath = { ...state.sessionsByWorkspacePath };
			let nextActive = { ...state.activeSessionIdByWorkspacePath };
			for (const [path, sessions] of Object.entries(nextSessionsByWorkspacePath)) {
				if (!sessions.some((s) => s.sessionId === sessionId)) continue;
				const filtered = sessions.filter((s) => s.sessionId !== sessionId);
				if (filtered.length === 0) {
					delete nextSessionsByWorkspacePath[path];
					delete nextActive[path];
				} else {
					nextSessionsByWorkspacePath[path] = filtered;
					if (nextActive[path] === sessionId) {
						nextActive[path] = null;
					}
				}
			}
			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
				activeSessionIdByWorkspacePath: nextActive,
			};
		}),
	attachWorkspaceSession: (workspacePath, sessionId) =>
		set((state) => ({
			activeSessionIdByWorkspacePath: {
				...state.activeSessionIdByWorkspacePath,
				[normalizeWorkspacePath(workspacePath)]: sessionId,
			},
		})),
	clearAllSessions: () =>
		set({
			sessionsByWorkspacePath: {},
			activeSessionIdByWorkspacePath: {},
		}),

	openFilePath: null,
	openFileContent: null,
	setOpenFile: (path, content) =>
		set({ openFilePath: path, openFileContent: content }),
	clearOpenFile: () => set({ openFilePath: null, openFileContent: null }),

	quotaData: [],
	setQuotaData: (data) => set({ quotaData: data }),
}));
