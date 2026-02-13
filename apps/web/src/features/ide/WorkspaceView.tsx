import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useAppStore } from "../../shared/stores/app-store";
import { useAgent } from "../agent/useAgent";
import { InlineAgentPicker } from "../agent/InlineAgentPicker";
import { CodeEditor } from "../editor/CodeEditor";
import { Terminal } from "../terminal/Terminal";
import { FileTree } from "../workspace/FileTree";
import { Sidebar } from "./Sidebar";
import { SplitPane } from "./SplitPane";

function normalizePath(path: string): string {
	return path === "/" ? "/" : path.replace(/\/+$/, "");
}

function getActiveSessionIdForWorkspace(
	activeSessionIdByWorkspacePath: Record<string, string | null>,
	workspacePath: string,
): string | null {
	const normalized = normalizePath(workspacePath);
	const exact = activeSessionIdByWorkspacePath[workspacePath];
	if (exact) return exact;
	const normalizedMatch = activeSessionIdByWorkspacePath[normalized];
	if (normalizedMatch) return normalizedMatch;
	for (const [path, sessionId] of Object.entries(activeSessionIdByWorkspacePath)) {
		if (normalizePath(path) === normalized && sessionId) {
			return sessionId;
		}
	}
	return null;
}

function formatAgentName(agentType: string): string {
	const labels: Record<string, string> = {
		codex: "Codex",
		claude_code: "Claude Code",
		gemini: "Gemini",
	};
	return labels[agentType] ?? agentType;
}

function getSessionBaseName(session: { agentType: string; customName?: string | null }): string {
	const customName = session.customName?.trim();
	if (customName) return customName;
	return formatAgentName(session.agentType);
}

export function WorkspaceView() {
	const workspacePath = useAppStore((s) => s.workspacePath);
	const sessionsByWorkspacePath = useAppStore((s) => s.sessionsByWorkspacePath);
	const activeSessionIdByWorkspacePath = useAppStore(
		(s) => s.activeSessionIdByWorkspacePath,
	);
	const attachWorkspaceSession = useAppStore((s) => s.attachWorkspaceSession);
	const reorderWorkspaceSession = useAppStore((s) => s.reorderWorkspaceSession);
	const renameSessionCustomName = useAppStore((s) => s.renameSessionCustomName);
	const openFilePath = useAppStore((s) => s.openFilePath);
	const showEditor = Boolean(openFilePath);
	const { stopSession } = useAgent();
	const [showStartPicker, setShowStartPicker] = useState(false);
	const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
	const [dragOverSessionId, setDragOverSessionId] = useState<string | null>(null);
	const [confirmStopSessionId, setConfirmStopSessionId] = useState<string | null>(null);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState("");
	const prevSessionCountRef = useRef(0);

	const sessions = useMemo(() => {
		if (!workspacePath) return [];
		const exact = sessionsByWorkspacePath[workspacePath];
		if (exact) return exact;
		const normalized = normalizePath(workspacePath);
		for (const [path, mappedSessions] of Object.entries(sessionsByWorkspacePath)) {
			if (normalizePath(path) === normalized) {
				return mappedSessions;
			}
		}
		return [];
	}, [workspacePath, sessionsByWorkspacePath]);

	const activeSession = useMemo(() => {
		if (!workspacePath) return null;
		const activeSessionId = getActiveSessionIdForWorkspace(
			activeSessionIdByWorkspacePath,
			workspacePath,
		);
		if (!activeSessionId) return null;
		return sessions.find((s) => s.sessionId === activeSessionId) ?? null;
	}, [activeSessionIdByWorkspacePath, sessions, workspacePath]);

	const tabNamesBySessionId = useMemo(() => {
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

	useEffect(() => {
		if (!workspacePath) return;
		if (sessions.length === 0) {
			attachWorkspaceSession(workspacePath, null);
			return;
		}
		if (!activeSession) {
			attachWorkspaceSession(workspacePath, sessions[0]?.sessionId ?? null);
		}
	}, [activeSession, attachWorkspaceSession, sessions, workspacePath]);

	useEffect(() => {
		if (sessions.length > prevSessionCountRef.current) {
			setShowStartPicker(false);
		}
		prevSessionCountRef.current = sessions.length;
	}, [sessions.length]);

	useEffect(() => {
		if (!confirmStopSessionId) return;
		if (!sessions.some((s) => s.sessionId === confirmStopSessionId)) {
			setConfirmStopSessionId(null);
		}
	}, [confirmStopSessionId, sessions]);

	useEffect(() => {
		if (!editingSessionId) return;
		if (!sessions.some((s) => s.sessionId === editingSessionId)) {
			setEditingSessionId(null);
			setEditingName("");
		}
	}, [editingSessionId, sessions]);

	const startEditingSessionName = (sessionId: string, name: string | null | undefined) => {
		setEditingSessionId(sessionId);
		setEditingName(name?.trim() ?? "");
	};

	const submitEditingSessionName = (sessionId: string) => {
		renameSessionCustomName(sessionId, editingName);
		setEditingSessionId(null);
		setEditingName("");
	};

	const cancelEditingSessionName = () => {
		setEditingSessionId(null);
		setEditingName("");
	};

	useEffect(() => {
		if (!confirmStopSessionId) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.closest(
					`[data-stop-button-session-id='${confirmStopSessionId}']`,
				)
			) {
				return;
			}
			setConfirmStopSessionId(null);
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setConfirmStopSessionId(null);
			}
		};

		document.addEventListener("pointerdown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [confirmStopSessionId]);

	const terminal = (() => {
		if (sessions.length === 0) {
			return <InlineAgentPicker />;
		}
		return (
			<div className="h-full flex flex-col">
				<div className="h-[26.5px] shrink-0 border-b border-border flex items-stretch bg-surface-raised">
					<div className="min-w-0 flex-1 flex items-stretch overflow-x-auto">
						{sessions.map((session) => {
							const isActive =
								!showStartPicker && session.sessionId === activeSession?.sessionId;
							const tabLabel =
								tabNamesBySessionId.get(session.sessionId) ??
								getSessionBaseName(session);
							const isEditing = editingSessionId === session.sessionId;
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
										}
										setDragOverSessionId(null);
									}}
									className={`group h-full min-w-36 max-w-56 border-r border-border border-t-2 transition-colors ${
										showStartPicker
											? "border-t-transparent bg-surface-raised text-muted hover:text-foreground"
										: isActive
											? "border-t-accent bg-surface text-foreground"
											: "border-t-transparent bg-surface-raised text-muted hover:text-foreground"
									} ${
										dragOverSessionId === session.sessionId &&
										draggingSessionId !== session.sessionId
											? "ring-1 ring-accent/50"
											: ""
									}`}
								>
									<div className="h-full flex items-center gap-1 pl-3 pr-1">
										{isEditing ? (
											<input
												autoFocus
												type="text"
												value={editingName}
												onChange={(event) => {
													setEditingName(event.target.value);
												}}
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
												className="flex-1 min-w-0 bg-transparent text-xs font-medium text-foreground outline-none"
												aria-label="Edit agent tab name"
											/>
										) : (
											<button
												type="button"
												onClick={() => {
													if (!workspacePath) return;
													attachWorkspaceSession(workspacePath, session.sessionId);
													setShowStartPicker(false);
												}}
												onDoubleClick={(event) => {
													event.preventDefault();
													startEditingSessionName(
														session.sessionId,
														session.customName,
													);
												}}
												className="flex-1 text-left text-xs font-medium truncate"
												title="Double-click to rename"
											>
												{tabLabel}
											</button>
										)}
										<button
											type="button"
											data-stop-button-session-id={session.sessionId}
											onClick={() => {
												if (confirmStopSessionId === session.sessionId) {
													setConfirmStopSessionId(null);
													void stopSession(session.sessionId, session.workspacePath);
													return;
												}
												setConfirmStopSessionId(session.sessionId);
											}}
											className={`inline-flex h-5 w-5 items-center justify-center rounded hover:bg-surface-raised ${
												confirmStopSessionId === session.sessionId
													? "text-red-500 hover:text-red-600"
													: "text-muted hover:text-foreground"
											}`}
											aria-label={
												confirmStopSessionId === session.sessionId
													? `Confirm remove ${tabLabel}`
													: `Prepare remove ${tabLabel}`
											}
										>
											{confirmStopSessionId === session.sessionId ? (
												<Trash2 size={12} />
											) : (
												<X size={12} />
											)}
										</button>
									</div>
								</div>
							);
						})}
					</div>
					<div
						className={`h-full shrink-0 border-l border-border px-2 flex items-center transition-colors ${
							showStartPicker ? "bg-surface" : "bg-surface-raised"
						}`}
					>
						<button
							type="button"
							onClick={() => setShowStartPicker((v) => !v)}
							className={`h-5 w-5 inline-flex items-center justify-center rounded transition-colors ${
								showStartPicker
									? "text-accent bg-accent/10"
									: "text-muted hover:text-foreground hover:bg-surface"
							}`}
							aria-label={showStartPicker ? "Close new agent picker" : "Start new agent"}
						>
							<Plus aria-hidden="true" size={12} />
						</button>
					</div>
				</div>
				<div className="flex-1 overflow-hidden">
					{showStartPicker ? (
						<InlineAgentPicker />
					) : activeSession ? (
						<Terminal
							key={activeSession.sessionId}
							sessionId={activeSession.sessionId}
						/>
					) : (
						<div className="h-full flex items-center justify-center text-sm text-muted">
							Select an agent tab.
						</div>
					)}
				</div>
			</div>
		);
	})();

	return (
		<SplitPane
			sidebar={
				<Sidebar>
					<FileTree />
				</Sidebar>
			}
			editor={showEditor ? <CodeEditor /> : undefined}
			terminal={terminal}
		/>
	);
}
