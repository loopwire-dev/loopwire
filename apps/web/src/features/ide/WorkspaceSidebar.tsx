import { Bot, FolderTree, GitBranch, MoreHorizontal, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type WorkspacePanel,
	type WorkspaceSession,
	workspaceStoreKeyForSelection,
	useAppStore,
} from "../../shared/stores/app-store";
import {
	isThemeMaskDisabled,
	stripMaskMetadata,
} from "../../shared/lib/icon-masking";
import { AgentActivityIcon } from "../agent/AgentActivityIcon";
import { getAgentIcon } from "../agent/agent-icons";
import { useAgent } from "../agent/useAgent";
import { SessionContextMenu } from "./SessionContextMenu";
import { SessionIconPickerDialog } from "./SessionIconPickerDialog";

function formatAgentName(agentType: string): string {
	const labels: Record<string, string> = {
		codex: "Codex",
		claude_code: "Claude Code",
		gemini: "Gemini",
	};
	return labels[agentType] ?? agentType;
}

function getSessionBaseName(session: {
	agentType: string;
	customName?: string | null;
}): string {
	const customName = session.customName?.trim();
	if (customName) return customName;
	return formatAgentName(session.agentType);
}

const TAB_HIGHLIGHT_BASE_CLASS =
	"pointer-events-none absolute inset-x-1 inset-y-0 rounded-md transition-opacity duration-150";

const TAB_ACTIVE_HIGHLIGHT_CLASS =
	"border border-border bg-surface-raised/75 dark:bg-white/12";

const TAB_HOVER_HIGHLIGHT_CLASS =
	"bg-surface-raised/80 dark:bg-white/8";

const PANEL_ITEMS: {
	panel: "files" | "git";
	label: string;
	Icon: typeof FolderTree;
}[] = [
	{ panel: "files", label: "Files", Icon: FolderTree },
	{ panel: "git", label: "Git Diff", Icon: GitBranch },
];

interface WorkspaceSidebarProps {
	sessions: WorkspaceSession[];
	activePanel: WorkspacePanel;
}

export function WorkspaceSidebar({
	sessions,
	activePanel,
}: WorkspaceSidebarProps) {
	const workspacePath = useAppStore((s) => s.workspacePath);
	const workspaceId = useAppStore((s) => s.workspaceId);
	const setActivePanel = useAppStore((s) => s.setActivePanel);
	const reorderWorkspaceSession = useAppStore((s) => s.reorderWorkspaceSession);
	const renameSessionCustomName = useAppStore((s) => s.renameSessionCustomName);
	const updateSessionSettings = useAppStore((s) => s.updateSessionSettings);
	const { stopSession, renameSession, updateSessionSettings: updateSessionSettingsApi } = useAgent();

	const [draggingSessionId, setDraggingSessionId] = useState<string | null>(
		null,
	);
	const [dragOverSessionId, setDragOverSessionId] = useState<string | null>(
		null,
	);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState("");
	const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
	const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
	const [iconPickerSessionId, setIconPickerSessionId] = useState<string | null>(null);

	const sortByOrder = (a: WorkspaceSession, b: WorkspaceSession) => {
		const aHas = a.sortOrder != null;
		const bHas = b.sortOrder != null;
		if (aHas && bHas) return (a.sortOrder as number) - (b.sortOrder as number);
		if (aHas) return -1;
		if (bHas) return 1;
		return a.createdAt.localeCompare(b.createdAt);
	};

	const pinnedSessions = useMemo(
		() => sessions.filter((s) => s.pinned).sort(sortByOrder),
		[sessions],
	);
	const unpinnedSessions = useMemo(
		() => sessions.filter((s) => !s.pinned).sort(sortByOrder),
		[sessions],
	);

	const labelsBySessionId = useMemo(() => {
		const grouped = new Map<string, typeof sessions>();
		for (const session of sessions) {
			const base = getSessionBaseName(session);
			const existing = grouped.get(base);
			if (existing) {
				existing.push(session);
			} else {
				grouped.set(base, [session]);
			}
		}
		const labels = new Map<string, string>();
		for (const [base, group] of grouped.entries()) {
			if (group.length <= 1) {
				const only = group[0];
				if (only) labels.set(only.sessionId, base);
				continue;
			}
			const ordered = [...group].sort((a, b) =>
				a.createdAt.localeCompare(b.createdAt),
			);
			ordered.forEach((session, index) => {
				labels.set(session.sessionId, `${base} - ${index + 1}`);
			});
		}
		return labels;
	}, [sessions]);

	const submitEditingSessionName = (sessionId: string) => {
		renameSessionCustomName(sessionId, editingName);
		void renameSession(sessionId, editingName.trim() || null);
		setEditingSessionId(null);
		setEditingName("");
	};

	const cancelEditingSessionName = () => {
		setEditingSessionId(null);
		setEditingName("");
	};

	// Clear editing when session disappears
	useEffect(() => {
		if (!editingSessionId) return;
		if (!sessions.some((s) => s.sessionId === editingSessionId)) {
			setEditingSessionId(null);
			setEditingName("");
		}
	}, [editingSessionId, sessions]);

	// Clear menu when session disappears
	useEffect(() => {
		if (!menuSessionId) return;
		if (!sessions.some((s) => s.sessionId === menuSessionId)) {
			setMenuSessionId(null);
		}
	}, [menuSessionId, sessions]);

	// Global dismiss for context menu
	useEffect(() => {
		if (!menuSessionId) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest("[data-session-menu='true']")) return;
			if (target?.closest(`[data-menu-button-session-id='${menuSessionId}']`)) return;
			setMenuSessionId(null);
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setMenuSessionId(null);
			}
		};

		document.addEventListener("pointerdown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [menuSessionId]);

	const selectPanel = (panel: WorkspacePanel) => {
		if (!workspacePath) return;
		setActivePanel(workspacePath, panel);
	};

	const isPanelActive = (panel: "files" | "git") =>
		activePanel.kind === "panel" && activePanel.panel === panel;

	const isAgentActive = (sessionId: string) =>
		activePanel.kind === "agent" && activePanel.sessionId === sessionId;

	const menuSession = menuSessionId
		? sessions.find((s) => s.sessionId === menuSessionId) ?? null
		: null;

	const iconPickerSession = iconPickerSessionId
		? sessions.find((s) => s.sessionId === iconPickerSessionId) ?? null
		: null;

	const handleTogglePin = useCallback(() => {
		if (!menuSession) return;
		const newPinned = !menuSession.pinned;
		updateSessionSettings(menuSession.sessionId, { pinned: newPinned });
		void updateSessionSettingsApi(menuSession.sessionId, { pinned: newPinned });
		setMenuSessionId(null);
	}, [menuSession, updateSessionSettings, updateSessionSettingsApi]);

	const handleMenuRename = useCallback(() => {
		if (!menuSession) return;
		setEditingSessionId(menuSession.sessionId);
		setEditingName(menuSession.customName?.trim() ?? "");
		setMenuSessionId(null);
	}, [menuSession]);

	const handleMenuSetIcon = useCallback(() => {
		if (!menuSession) return;
		setIconPickerSessionId(menuSession.sessionId);
		setMenuSessionId(null);
	}, [menuSession]);

	const handleMenuDelete = useCallback(() => {
		if (!menuSession) return;
		void stopSession(menuSession.sessionId);
		setMenuSessionId(null);
	}, [menuSession, stopSession]);

	const handleIconConfirm = useCallback(
		(icon: string | null) => {
			if (!iconPickerSessionId) return;
			updateSessionSettings(iconPickerSessionId, { icon });
			void updateSessionSettingsApi(iconPickerSessionId, { icon });
			setIconPickerSessionId(null);
		},
		[iconPickerSessionId, updateSessionSettings, updateSessionSettingsApi],
	);

	const renderSessionItem = (session: WorkspaceSession) => {
		const active = isAgentActive(session.sessionId);
		const label =
			labelsBySessionId.get(session.sessionId) ??
			getSessionBaseName(session);
		const isEditing = editingSessionId === session.sessionId;
		const activityPhase = session.activity?.phase;
		const showActivityIcon = activityPhase != null && activityPhase !== "unknown";

		return (
			<div
				key={session.sessionId}
				draggable={!isEditing}
				onDragStart={() => {
					if (isEditing) return;
					setDraggingSessionId(session.sessionId);
				}}
				onDragEnd={() => {
					setDraggingSessionId(null);
					setDragOverSessionId(null);
				}}
				onDragOver={(event) => {
					event.preventDefault();
					if (dragOverSessionId !== session.sessionId) {
						setDragOverSessionId(session.sessionId);
					}
				}}
				onDragLeave={() => {
					if (dragOverSessionId === session.sessionId) {
						setDragOverSessionId(null);
					}
				}}
				onDrop={(event) => {
					event.preventDefault();
					if (!workspacePath || !draggingSessionId) return;
					if (draggingSessionId !== session.sessionId) {
						reorderWorkspaceSession(
							workspacePath,
							draggingSessionId,
							session.sessionId,
						);

						// Persist explicit sort order for all sessions in the workspace.
						const workspaceKey = workspaceStoreKeyForSelection(
							workspaceId,
							workspacePath,
						);
						const updatedSessions =
							(workspaceKey
								? useAppStore.getState().sessionsByWorkspacePath[workspaceKey]
								: undefined) ?? [];
						for (const s of updatedSessions) {
							void updateSessionSettingsApi(s.sessionId, { sort_order: s.sortOrder ?? null });
						}
					}
					setDragOverSessionId(null);
				}}
				className={`relative mb-0.5 last:mb-0 ${
					dragOverSessionId === session.sessionId &&
					draggingSessionId !== session.sessionId
						? "ring-1 ring-accent/50 rounded-md mx-1"
						: ""
				}`}
			>
				<div
					className={`group relative w-full flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors ${
						active ? "font-medium" : ""
					}`}
					onClick={() =>
						selectPanel({
							kind: "agent",
							sessionId: session.sessionId,
						})
					}
					onDoubleClick={(event) => {
						event.preventDefault();
						setEditingSessionId(session.sessionId);
						setEditingName(session.customName?.trim() ?? "");
					}}
				>
					<span
						aria-hidden="true"
						className={`${TAB_HIGHLIGHT_BASE_CLASS} ${
							active
								? `${TAB_ACTIVE_HIGHLIGHT_CLASS} opacity-100`
								: `${TAB_HOVER_HIGHLIGHT_CLASS} opacity-0 group-hover:opacity-100`
						}`}
					/>
					<span className="relative shrink-0 inline-flex items-center">
						{renderSessionIcon(session)}
					</span>
					{isEditing ? (
						<input
							autoFocus
							type="text"
							value={editingName}
							onChange={(event) => setEditingName(event.target.value)}
							onClick={(event) => event.stopPropagation()}
							onDoubleClick={(event) => event.stopPropagation()}
							onBlur={() => submitEditingSessionName(session.sessionId)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									submitEditingSessionName(session.sessionId);
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									cancelEditingSessionName();
								}
							}}
							className="relative flex-1 min-w-0 bg-transparent text-sm text-foreground outline-none"
							aria-label="Edit agent name"
						/>
					) : (
						<span
							className="relative flex flex-1 min-w-0 items-center gap-1 text-left"
							title="Double-click to rename"
						>
							<span className="truncate flex-1 min-w-0">{label}</span>
							{showActivityIcon ? (
								<span className="relative shrink-0 inline-flex items-center">
									<AgentActivityIcon phase={activityPhase} />
								</span>
							) : null}
						</span>
					)}
					{isEditing && showActivityIcon ? (
						<span className="relative shrink-0 inline-flex items-center">
							<AgentActivityIcon phase={activityPhase} />
						</span>
					) : null}
					<button
						type="button"
						ref={menuSessionId === session.sessionId ? menuAnchorRef : undefined}
						data-menu-button-session-id={session.sessionId}
						onClick={(event) => {
							event.stopPropagation();
							if (menuSessionId === session.sessionId) {
								setMenuSessionId(null);
							} else {
								menuAnchorRef.current = event.currentTarget;
								setMenuSessionId(session.sessionId);
							}
						}}
						className={`relative inline-flex h-5 w-5 items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity ${
							menuSessionId === session.sessionId
								? "!opacity-100 text-foreground"
								: "text-muted hover:text-foreground"
						}`}
						aria-label={`Menu for ${label}`}
					>
						<MoreHorizontal size={14} />
					</button>
				</div>
			</div>
		);
	};

	const renderSessionIcon = (session: WorkspaceSession) => {
		if (session.icon) {
			if (session.icon.startsWith("data:")) {
				const maskDisabled = isThemeMaskDisabled(session.icon);
				const src = stripMaskMetadata(session.icon);
				return (
					<img
						src={src}
						alt=""
						aria-hidden="true"
						className={`h-3.5 w-3.5 rounded-full object-cover ${
							maskDisabled
								? ""
								: "grayscale contrast-125 brightness-[0.45] dark:invert dark:brightness-[1.35]"
						}`}
					/>
				);
			}
			return <span className="text-sm leading-none">{session.icon}</span>;
		}
		const agentIcon = getAgentIcon(session.agentType);
		if (agentIcon) {
			return (
				<img
					src={agentIcon}
					alt=""
					aria-hidden="true"
					className="h-3.5 w-3.5"
				/>
			);
		}
		return <Bot size={14} className="text-muted" />;
	};

	return (
		<div className="h-full flex flex-col bg-surface w-[208px] shrink-0 select-none overflow-y-auto">
			{/* PANELS */}
			<div className="pt-3 pb-1">
					<div className="text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-1.5">
						Workspace
					</div>
				{PANEL_ITEMS.map(({ panel, label, Icon }) => {
					const active = isPanelActive(panel);
					return (
						<button
							key={panel}
							type="button"
							onClick={() => selectPanel({ kind: "panel", panel })}
							className={`group relative mb-0.5 last:mb-0 w-full flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors ${
								active ? "font-medium" : ""
							}`}
						>
							<span
								aria-hidden="true"
								className={`${TAB_HIGHLIGHT_BASE_CLASS} ${
									active
										? `${TAB_ACTIVE_HIGHLIGHT_CLASS} opacity-100`
										: `${TAB_HOVER_HIGHLIGHT_CLASS} opacity-0 group-hover:opacity-100`
								}`}
							/>
							<Icon size={14} className="relative shrink-0 text-muted" />
							<span className="relative truncate">{label}</span>
						</button>
					);
				})}
			</div>

			{/* AGENTS */}
			<div className="pt-2 pb-3 flex-1">
				<div className="text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-1.5">
					Agents
				</div>
				{pinnedSessions.map((session) => renderSessionItem(session))}
				{pinnedSessions.length > 0 && unpinnedSessions.length > 0 && (
					<div className="mx-3 my-2.5 border-t border-border" />
				)}
				{unpinnedSessions.map((session) => renderSessionItem(session))}

				{/* + New Agent */}
				<button
					type="button"
					onClick={() => selectPanel({ kind: "new-agent" })}
					className={`group relative w-full flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors ${
						activePanel.kind === "new-agent"
							? "font-medium"
							: "text-muted hover:text-foreground"
					}`}
				>
					<span
						aria-hidden="true"
						className={`${TAB_HIGHLIGHT_BASE_CLASS} ${
							activePanel.kind === "new-agent"
								? `${TAB_ACTIVE_HIGHLIGHT_CLASS} opacity-100`
								: `${TAB_HOVER_HIGHLIGHT_CLASS} opacity-0 group-hover:opacity-100`
						}`}
					/>
					<Plus size={14} className="relative shrink-0" />
					<span className="relative truncate">New Agent</span>
				</button>
			</div>

			{/* Session context menu */}
			{menuSession && (
				<SessionContextMenu
					pinned={menuSession.pinned ?? false}
					anchorRef={menuAnchorRef}
					onTogglePin={handleTogglePin}
					onRename={handleMenuRename}
					onSetIcon={handleMenuSetIcon}
					onDelete={handleMenuDelete}
				/>
			)}

			{/* Session icon picker dialog */}
			<SessionIconPickerDialog
				open={iconPickerSessionId !== null}
				sessionLabel={
					iconPickerSession
						? (labelsBySessionId.get(iconPickerSession.sessionId) ??
							getSessionBaseName(iconPickerSession))
						: ""
				}
				currentIcon={iconPickerSession?.icon}
				defaultIcon={iconPickerSession ? getAgentIcon(iconPickerSession.agentType) : null}
				onConfirm={handleIconConfirm}
				onClose={() => setIconPickerSessionId(null)}
			/>
		</div>
	);
}
