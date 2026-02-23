import { create } from "zustand";

export interface AvailableAgent {
	agent_type: string;
	name: string;
	installed: boolean;
	version: string | null;
}

export interface WorkspaceRoot {
	id?: string;
	path: string;
	name: string;
	pinned: boolean;
	icon?: string | null;
}

export interface WorkspaceSession {
	sessionId: string;
	agentType: string;
	customName?: string | null;
	workspaceId?: string | null;
	pinned?: boolean;
	icon?: string | null;
	sortOrder?: number | null;
	status: string;
	resumeFailureReason?: string | null;
	createdAt: string;
	activity?: AgentActivity;
}

export type AgentActivityPhase =
	| "unknown"
	| "awaiting_user"
	| "user_input"
	| "processing"
	| "streaming_output";

export interface AgentActivity {
	phase: AgentActivityPhase;
	is_idle: boolean;
	updated_at: string;
	last_input_at: string | null;
	last_output_at: string | null;
	reason: string;
}

export function defaultAgentActivity(): AgentActivity {
	return {
		phase: "unknown",
		is_idle: false,
		updated_at: new Date().toISOString(),
		last_input_at: null,
		last_output_at: null,
		reason: "frontend_default",
	};
}

export type WorkspacePanel =
	| { kind: "panel"; panel: "files" | "git" }
	| { kind: "agent"; sessionId: string }
	| { kind: "new-agent" };

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

function normalizeWorkspaceId(
	workspaceId: string | null | undefined,
): string | null {
	if (typeof workspaceId !== "string") return null;
	const trimmed = workspaceId.trim();
	return trimmed || null;
}

function workspaceStoreKey(
	workspaceId: string | null | undefined,
): string | null {
	const normalizedId = normalizeWorkspaceId(workspaceId);
	if (normalizedId) return `id:${normalizedId}`;
	return null;
}

function resolveWorkspaceStoreKeyFromPath(
	workspacePath: string,
	roots: WorkspaceRoot[],
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

function normalizeWorkspaceIcon(
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

function mergeSessionsForWorkspaceKey(
	sessionsByWorkspacePath: Record<string, WorkspaceSession[]>,
	workspaceKey: string,
): WorkspaceSession[] {
	return normalizeWorkspaceSessions(
		sessionsByWorkspacePath[workspaceKey] ?? [],
	);
}

function findActiveSessionIdForWorkspaceKey(
	activeByWorkspacePath: Record<string, string | null>,
	workspaceKey: string,
): string | null {
	return activeByWorkspacePath[workspaceKey] ?? null;
}

function normalizeWorkspaceRoots(roots: WorkspaceRoot[]): WorkspaceRoot[] {
	const unique = new Map<string, WorkspaceRoot>();
	for (const root of roots) {
		if (!root?.path) continue;
		if (unique.has(root.path)) continue;
		unique.set(root.path, {
			id: root.id,
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

function isActiveStatus(status: string): boolean {
	return status === "running" || status === "restored";
}

function normalizeWorkspaceSessions(
	sessions: WorkspaceSession[],
): WorkspaceSession[] {
	const unique = new Map<string, WorkspaceSession>();
	for (const session of sessions) {
		if (!session.sessionId || !isActiveStatus(session.status)) continue;
		const customName =
			typeof session.customName === "string" ? session.customName.trim() : "";
		const normalizedWorkspaceId = normalizeWorkspaceId(session.workspaceId);
		unique.set(session.sessionId, {
			...session,
			customName: customName || null,
			workspaceId: normalizedWorkspaceId,
			sortOrder: session.sortOrder ?? null,
			activity: session.activity ?? defaultAgentActivity(),
		});
	}
	const all = [...unique.values()];
	const pinned = all.filter((s) => s.pinned);
	const unpinned = all.filter((s) => !s.pinned);
	return [...pinned, ...unpinned];
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
								id:
									"id" in entry && typeof entry.id === "string"
										? entry.id
										: undefined,
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

	// Agent sessions scoped by workspace key (`id:<workspace_id>` preferred)
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
	renameSessionCustomName: (
		sessionId: string,
		customName: string | null,
	) => void;
	updateSessionSettings: (
		sessionId: string,
		settings: {
			pinned?: boolean;
			icon?: string | null;
			sortOrder?: number | null;
		},
	) => void;
	updateSessionActivity: (sessionId: string, activity: AgentActivity) => void;
	removeWorkspaceSession: (sessionId: string) => void;
	removeSessionById: (sessionId: string) => void;
	attachWorkspaceSession: (
		workspacePath: string,
		sessionId: string | null,
		workspaceId?: string | null,
	) => void;
	clearAllSessions: () => void;

	// Workspace panels
	activePanelByWorkspacePath: Record<string, WorkspacePanel>;
	setActivePanel: (workspacePath: string, panel: WorkspacePanel) => void;

	// Available agents
	availableAgents: AvailableAgent[];
	setAvailableAgents: (agents: AvailableAgent[]) => void;

	// Editor
	openFilePath: string | null;
	openFileContent: string | null;
	openFileImageSrc: string | null;
	setOpenFile: (
		path: string,
		content: string | null,
		imageSrc?: string | null,
	) => void;
	clearOpenFile: () => void;
}

export const useAppStore = create<AppState>((set) => ({
	token: localStorage.getItem(TOKEN_KEY),
	exchangingToken: (() => {
		if (new URLSearchParams(window.location.search).has("token")) return true;
		const hash = window.location.hash || "";
		const queryIndex = hash.indexOf("?");
		if (queryIndex === -1) return false;
		return new URLSearchParams(hash.slice(queryIndex + 1)).has("token");
	})(),
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
			openFileImageSrc: null,

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
			openFileImageSrc: null,
		}),
	clearWorkspace: () =>
		set({
			workspacePath: null,
			workspaceId: null,
			openFilePath: null,
			openFileContent: null,
			openFileImageSrc: null,
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
					id: entry.id,
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

	activePanelByWorkspacePath: {},
	setActivePanel: (workspacePath, panel) =>
		set((state) => {
			const workspaceKey = resolveWorkspaceStoreKeyFromPath(
				workspacePath,
				state.workspaceRoots,
			);
			if (!workspaceKey) return state;
			return {
				activePanelByWorkspacePath: {
					...state.activePanelByWorkspacePath,
					[workspaceKey]: panel,
				},
			};
		}),

	sessionsByWorkspacePath: {},
	activeSessionIdByWorkspacePath: {},
	setWorkspaceSessions: (path, sessions) =>
		set((state) => {
			const normalized = normalizeWorkspaceSessions(sessions);
			const workspaceKey =
				workspaceStoreKey(normalized[0]?.workspaceId ?? null) ??
				resolveWorkspaceStoreKeyFromPath(path, state.workspaceRoots);
			if (!workspaceKey) return state;
			const nextSessionsByWorkspacePath = {
				...state.sessionsByWorkspacePath,
			};
			nextSessionsByWorkspacePath[workspaceKey] = normalized;

			const nextActive = {
				...state.activeSessionIdByWorkspacePath,
			};
			const activeSessionId =
				findActiveSessionIdForWorkspaceKey(
					state.activeSessionIdByWorkspacePath,
					workspaceKey,
				) ?? null;
			const activeStillExists = normalized.some(
				(session) => session.sessionId === activeSessionId,
			);
			nextActive[workspaceKey] = activeStillExists ? activeSessionId : null;

			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
				activeSessionIdByWorkspacePath: nextActive,
			};
		}),
	hydrateWorkspaceSessions: (sessions) =>
		set(() => {
			const grouped = sessions.reduce<Record<string, WorkspaceSession[]>>(
				(acc, session) => {
					if (!isActiveStatus(session.status)) return acc;
					const key = workspaceStoreKey(session.workspaceId ?? null);
					if (!key) return acc;
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
					groupedSessions.length === 1
						? (groupedSessions[0]?.sessionId ?? null)
						: null;
			}

			return {
				sessionsByWorkspacePath,
				activeSessionIdByWorkspacePath,
			};
		}),
	upsertWorkspaceSession: (session) =>
		set((state) => {
			if (!isActiveStatus(session.status)) {
				return state;
			}
			const workspaceKey = workspaceStoreKey(session.workspaceId ?? null);
			if (!workspaceKey) return state;
			const existing = mergeSessionsForWorkspaceKey(
				state.sessionsByWorkspacePath,
				workspaceKey,
			);
			const filtered = existing.filter(
				(s) => s.sessionId !== session.sessionId,
			);
			const nextSessions = normalizeWorkspaceSessions([...filtered, session]);
			const nextSessionsByWorkspacePath = {
				...state.sessionsByWorkspacePath,
			};
			nextSessionsByWorkspacePath[workspaceKey] = nextSessions;
			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
			};
		}),
	reorderWorkspaceSession: (workspacePath, fromSessionId, toSessionId) =>
		set((state) => {
			if (fromSessionId === toSessionId) return state;
			const workspaceKey = resolveWorkspaceStoreKeyFromPath(
				workspacePath,
				state.workspaceRoots,
			);
			if (!workspaceKey) return state;
			const current = mergeSessionsForWorkspaceKey(
				state.sessionsByWorkspacePath,
				workspaceKey,
			);
			const fromIndex = current.findIndex((s) => s.sessionId === fromSessionId);
			const toIndex = current.findIndex((s) => s.sessionId === toSessionId);
			if (fromIndex === -1 || toIndex === -1) return state;

			const next = [...current];
			const [moved] = next.splice(fromIndex, 1);
			if (!moved) return state;
			next.splice(toIndex, 0, moved);

			// Once an explicit reorder happens, assign sortOrder to every session
			// so ordering is fully deterministic and no session falls back to createdAt.
			let sortIndex = 0;
			for (let i = 0; i < next.length; i++) {
				const s = next[i];
				if (!s) continue;
				next[i] = { ...s, sortOrder: sortIndex };
				sortIndex++;
			}

			const nextSessionsByWorkspacePath = {
				...state.sessionsByWorkspacePath,
			};
			nextSessionsByWorkspacePath[workspaceKey] = next;

			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
			};
		}),
	renameSessionCustomName: (sessionId, customName) =>
		set((state) => {
			const trimmedName = customName?.trim() ?? "";
			let changed = false;
			const nextSessionsByWorkspacePath = Object.fromEntries(
				Object.entries(state.sessionsByWorkspacePath).map(
					([path, sessions]) => {
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
					},
				),
			);

			if (!changed) return state;
			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
			};
		}),
	updateSessionSettings: (sessionId, settings) =>
		set((state) => {
			let changed = false;
			const nextSessionsByWorkspacePath = Object.fromEntries(
				Object.entries(state.sessionsByWorkspacePath).map(
					([path, sessions]) => {
						let pathChanged = false;
						const nextSessions = sessions.map((session) => {
							if (session.sessionId !== sessionId) return session;
							pathChanged = true;
							changed = true;
							return {
								...session,
								...("pinned" in settings ? { pinned: settings.pinned } : {}),
								...("icon" in settings ? { icon: settings.icon } : {}),
								...("sortOrder" in settings
									? { sortOrder: settings.sortOrder }
									: {}),
							};
						});
						return [path, pathChanged ? nextSessions : sessions];
					},
				),
			);
			if (!changed) return state;

			// Re-sort to maintain pinned-first order
			const resorted = Object.fromEntries(
				Object.entries(nextSessionsByWorkspacePath).map(([path, sessions]) => [
					path,
					normalizeWorkspaceSessions(sessions),
				]),
			);
			return { sessionsByWorkspacePath: resorted };
		}),
	updateSessionActivity: (sessionId, activity) =>
		set((state) => {
			let changed = false;
			const nextSessionsByWorkspacePath = Object.fromEntries(
				Object.entries(state.sessionsByWorkspacePath).map(
					([path, sessions]) => {
						let pathChanged = false;
						const nextSessions = sessions.map((session) => {
							if (session.sessionId !== sessionId) return session;
							pathChanged = true;
							changed = true;
							return {
								...session,
								activity,
							};
						});
						return [path, pathChanged ? nextSessions : sessions];
					},
				),
			);
			if (!changed) return state;
			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
			};
		}),
	removeWorkspaceSession: (sessionId) =>
		set((state) => {
			const targetKey = Object.entries(state.sessionsByWorkspacePath).find(
				([, sessions]) =>
					sessions.some((session) => session.sessionId === sessionId),
			)?.[0];
			if (!targetKey) return state;
			const existing = mergeSessionsForWorkspaceKey(
				state.sessionsByWorkspacePath,
				targetKey,
			);
			const filtered = existing.filter((s) => s.sessionId !== sessionId);
			const nextSessionsByWorkspacePath = {
				...state.sessionsByWorkspacePath,
			};
			if (filtered.length === 0) {
				delete nextSessionsByWorkspacePath[targetKey];
			} else {
				nextSessionsByWorkspacePath[targetKey] = filtered;
			}

			const activeId =
				findActiveSessionIdForWorkspaceKey(
					state.activeSessionIdByWorkspacePath,
					targetKey,
				) ?? null;
			const nextActive = {
				...state.activeSessionIdByWorkspacePath,
			};
			if (targetKey in nextSessionsByWorkspacePath) {
				nextActive[targetKey] = activeId === sessionId ? null : activeId;
			} else {
				delete nextActive[targetKey];
			}

			// Clear stale agent panel
			const nextPanels = { ...state.activePanelByWorkspacePath };
			const currentPanel = nextPanels[targetKey];
			if (
				currentPanel?.kind === "agent" &&
				currentPanel.sessionId === sessionId
			) {
				nextPanels[targetKey] = { kind: "panel", panel: "files" };
			}

			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
				activeSessionIdByWorkspacePath: nextActive,
				activePanelByWorkspacePath: nextPanels,
			};
		}),
	removeSessionById: (sessionId) =>
		set((state) => {
			const nextSessionsByWorkspacePath = { ...state.sessionsByWorkspacePath };
			const nextActive = { ...state.activeSessionIdByWorkspacePath };
			const nextPanels = { ...state.activePanelByWorkspacePath };
			for (const [path, sessions] of Object.entries(
				nextSessionsByWorkspacePath,
			)) {
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
				// Clear stale agent panel
				const currentPanel = nextPanels[path];
				if (
					currentPanel?.kind === "agent" &&
					currentPanel.sessionId === sessionId
				) {
					nextPanels[path] = { kind: "panel", panel: "files" };
				}
			}
			return {
				sessionsByWorkspacePath: nextSessionsByWorkspacePath,
				activeSessionIdByWorkspacePath: nextActive,
				activePanelByWorkspacePath: nextPanels,
			};
		}),
	attachWorkspaceSession: (workspacePath, sessionId, workspaceId) =>
		set((state) => {
			const workspaceKey =
				workspaceStoreKey(workspaceId ?? null) ??
				resolveWorkspaceStoreKeyFromPath(workspacePath, state.workspaceRoots);
			if (!workspaceKey) return state;
			return {
				activeSessionIdByWorkspacePath: {
					...state.activeSessionIdByWorkspacePath,
					[workspaceKey]: sessionId,
				},
			};
		}),
	clearAllSessions: () =>
		set({
			sessionsByWorkspacePath: {},
			activeSessionIdByWorkspacePath: {},
		}),

	availableAgents: [],
	setAvailableAgents: (agents) => set({ availableAgents: agents }),

	openFilePath: null,
	openFileContent: null,
	openFileImageSrc: null,
	setOpenFile: (path, content, imageSrc = null) =>
		set({
			openFilePath: path,
			openFileContent: content,
			openFileImageSrc: imageSrc,
		}),
	clearOpenFile: () =>
		set({ openFilePath: null, openFileContent: null, openFileImageSrc: null }),
}));
