import {
	MoveHorizontal,
	PanelLeft,
	PanelRight,
	Plus,
	Settings,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { SettingsDialog } from "../../../shared/layout/SettingsDialog";
import {
	removeWorkspace as removeWorkspaceApi,
	updateWorkspaceSettings,
} from "../../../shared/lib/daemon/rest";
import {
	useAppStore,
	workspaceStoreKeyForSelection,
} from "../../../shared/stores/app-store";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { LoopwireLogo } from "../../landing/components/LoopwireLogo";
import {
	COMPACT_SIDEBAR_INTERACTIVE_SELECTOR,
	getSingleSessionId,
	isInteractiveSidebarTarget,
	shouldCloseWorkspaceMenu,
} from "../lib/appSidebarLogic";
import {
	SIDEBAR_TAB_HOVER_CLASS,
	SIDEBAR_TAB_SELECTED_OVERLAY_CLASS,
} from "../lib/sidebarTabStyles";
import { IconPickerDialog } from "./IconPickerDialog";
import { WorkspaceItem } from "./WorkspaceItem";

function syncSettingsToBackend(entry: {
	path: string;
	name?: string;
	pinned?: boolean;
	icon?: string | null;
}) {
	updateWorkspaceSettings(entry).catch(() => {});
}

export function AppSidebar() {
	const workspaceRoots = useAppStore((s) => s.workspaceRoots);
	const workspacePath = useAppStore((s) => s.workspacePath);
	const browsingForWorkspace = useAppStore((s) => s.browsingForWorkspace);
	const setBrowsingForWorkspace = useAppStore((s) => s.setBrowsingForWorkspace);
	const setWorkspacePath = useAppStore((s) => s.setWorkspacePath);
	const removeWorkspaceRoot = useAppStore((s) => s.removeWorkspaceRoot);
	const setWorkspacePinned = useAppStore((s) => s.setWorkspacePinned);
	const renameWorkspaceRoot = useAppStore((s) => s.renameWorkspaceRoot);
	const setWorkspaceIcon = useAppStore((s) => s.setWorkspaceIcon);
	const reorderWorkspaceRoots = useAppStore((s) => s.reorderWorkspaceRoots);
	const clearWorkspace = useAppStore((s) => s.clearWorkspace);
	const sidebarCompact = useAppStore((s) => s.sidebarCompact);
	const toggleSidebarCompact = useAppStore((s) => s.toggleSidebarCompact);
	const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
	const setWorkspace = useAppStore((s) => s.setWorkspace);
	const attachWorkspaceSession = useAppStore((s) => s.attachWorkspaceSession);
	const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
	const [editingPath, setEditingPath] = useState<string | null>(null);
	const [editingName, setEditingName] = useState("");
	const [draggingPath, setDraggingPath] = useState<string | null>(null);
	const [dragOverPath, setDragOverPath] = useState<string | null>(null);
	const [iconDialogPath, setIconDialogPath] = useState<string | null>(null);
	const [compactCursorPosition, setCompactCursorPosition] = useState<{
		x: number;
		y: number;
	} | null>(null);

	const selectedIconWorkspace =
		workspaceRoots.find((root) => root.path === iconDialogPath) ?? null;

	useEffect(() => {
		const handlePointerDown = (event: MouseEvent) => {
			if (shouldCloseWorkspaceMenu(event.target)) {
				setOpenMenuPath(null);
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpenMenuPath(null);
				setEditingPath(null);
			}
		};

		document.addEventListener("pointerdown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	useEffect(() => {
		if (!sidebarCompact) {
			setCompactCursorPosition(null);
		}
	}, [sidebarCompact]);

	const activateWorkspace = (path: string) => {
		const root = useAppStore
			.getState()
			.workspaceRoots.find((r) => r.path === path);
		if (path !== workspacePath) {
			if (root?.id) {
				setWorkspace(path, root.id);
			} else {
				setWorkspacePath(path);
			}
		}
		setBrowsingForWorkspace(false);

		// Sessions are already hydrated by useDaemon — read from the store
		const workspaceKey = workspaceStoreKeyForSelection(root?.id ?? null, path);
		const allSessions = useAppStore.getState().sessionsByWorkspacePath;
		const existing = workspaceKey ? (allSessions[workspaceKey] ?? []) : [];
		attachWorkspaceSession(path, getSingleSessionId(existing), root?.id);
	};

	const removeWorkspace = (path: string) => {
		removeWorkspaceRoot(path);
		removeWorkspaceApi(path).catch(() => {});
		if (path === workspacePath) {
			clearWorkspace();
		}
	};

	const startRenameWorkspace = (path: string, currentName: string) => {
		setEditingPath(path);
		setEditingName(currentName);
		setOpenMenuPath(null);
	};

	const submitRenameWorkspace = (path: string) => {
		const trimmed = editingName.trim();
		if (!trimmed) {
			setEditingPath(null);
			return;
		}
		renameWorkspaceRoot(path, trimmed);
		syncSettingsToBackend({ path, name: trimmed });
		setEditingPath(null);
	};

	const isHoveringInteractiveSidebarElement = (
		target: EventTarget | null,
	): boolean => {
		return isInteractiveSidebarTarget(
			target,
			COMPACT_SIDEBAR_INTERACTIVE_SELECTOR,
		);
	};

	return (
		<>
			<div
				onMouseMove={(event) => {
					if (!sidebarCompact) return;
					if (isHoveringInteractiveSidebarElement(event.target)) {
						setCompactCursorPosition(null);
						return;
					}
					const rect = event.currentTarget.getBoundingClientRect();
					setCompactCursorPosition({
						x: event.clientX - rect.left,
						y: event.clientY - rect.top,
					});
				}}
				onMouseLeave={() => {
					setCompactCursorPosition(null);
				}}
				onPointerDownCapture={(event) => {
					if (!sidebarCompact) return;
					if (isHoveringInteractiveSidebarElement(event.target)) {
						setCompactCursorPosition(null);
					}
				}}
				onClickCapture={(event) => {
					if (!sidebarCompact) return;
					if (isHoveringInteractiveSidebarElement(event.target)) {
						setCompactCursorPosition(null);
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					toggleSidebarCompact();
				}}
				className={`relative h-full flex flex-col border-r border-border bg-sidebar shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${
					sidebarCompact
						? `w-14.5 ${compactCursorPosition ? "lw-sidebar-compact-cursor" : ""}`
						: "w-64"
				}`}
			>
				{sidebarCompact && compactCursorPosition && (
					<div
						aria-hidden="true"
						className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2"
						style={{
							left: `${compactCursorPosition.x}px`,
							top: `${compactCursorPosition.y}px`,
						}}
					>
						<MoveHorizontal
							aria-hidden="true"
							size={14}
							className="text-foreground drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"
						/>
					</div>
				)}
				{/* Header */}
				<div className="h-11 flex items-center px-2 shrink-0">
					<button
						type="button"
						onClick={sidebarCompact ? toggleSidebarCompact : undefined}
						className={`group relative ml-1 shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
							sidebarCompact
								? "hover:bg-surface-raised cursor-pointer"
								: "cursor-default"
						}`}
						title={sidebarCompact ? "Expand sidebar" : undefined}
						aria-label={sidebarCompact ? "Expand sidebar" : undefined}
					>
						<div
							className={`transition-opacity duration-150 ${
								sidebarCompact
									? "group-hover:opacity-0 group-focus-visible:opacity-0"
									: ""
							}`}
						>
							<LoopwireLogo size={26} />
						</div>
						<PanelRight
							aria-hidden="true"
							size={14}
							className={`absolute text-muted transition-opacity duration-150 ${
								sidebarCompact
									? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
									: "opacity-0 pointer-events-none"
							}`}
						/>
					</button>
					<div
						className={`min-w-0 transition-[flex] duration-200 ease-in-out ${
							sidebarCompact ? "flex-none" : "flex-1"
						}`}
					/>
					<button
						type="button"
						onClick={toggleSidebarCompact}
						className={`shrink-0 rounded-lg text-muted hover:bg-surface-raised transition-all duration-200 ease-in-out ${
							sidebarCompact
								? "opacity-0 pointer-events-none w-0 p-0 overflow-hidden"
								: "opacity-100 p-1.5"
						}`}
						title="Collapse sidebar"
						tabIndex={sidebarCompact ? -1 : 0}
					>
						<PanelLeft aria-hidden="true" size={16} />
					</button>
				</div>

				{/* New Workspace */}
				<div className="px-2 pt-3 pb-1 shrink-0">
					<Tooltip content={sidebarCompact ? "New Workspace" : ""}>
						<button
							type="button"
							onClick={() => setBrowsingForWorkspace(true)}
							className={`group relative w-full flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium overflow-hidden transition-colors ${
								browsingForWorkspace || !workspacePath
									? ""
									: `bg-transparent ${SIDEBAR_TAB_HOVER_CLASS}`
							}`}
						>
							<span
								aria-hidden="true"
								className={`${SIDEBAR_TAB_SELECTED_OVERLAY_CLASS} ${
									browsingForWorkspace || !workspacePath
										? "opacity-100"
										: "opacity-0"
								}`}
							/>
							<span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center leading-none">
								<Plus aria-hidden="true" size={14} className="shrink-0" />
							</span>
							{!sidebarCompact && (
								<span className="relative whitespace-nowrap">
									New Workspace
								</span>
							)}
						</button>
					</Tooltip>
				</div>

				{/* Workspace list */}
				<div className="flex-1 overflow-hidden px-2 py-1">
					<div className="px-3 pt-2 pb-1">
						<div className="relative h-4">
							<p
								className={`absolute inset-0 text-xs leading-4 font-medium text-muted uppercase tracking-wider transition-opacity duration-150 ${
									sidebarCompact ? "opacity-0" : "opacity-100"
								}`}
								aria-hidden={sidebarCompact}
							>
								Workspaces
							</p>
							<div
								className={`absolute inset-0 flex items-center transition-opacity duration-150 ${
									sidebarCompact
										? "justify-center opacity-100"
										: "justify-start opacity-0 pointer-events-none"
								}`}
								aria-hidden={!sidebarCompact}
							>
								<div className="h-px w-4 rounded-full bg-muted/35 dark:bg-border" />
							</div>
						</div>
					</div>
					{!sidebarCompact && workspaceRoots.length === 0 && (
						<p className="px-3 py-4 text-xs text-muted text-center">
							No workspaces
						</p>
					)}
					{workspaceRoots.length > 0 && <div className="h-1" />}
					{workspaceRoots.map((root, index) => {
						const isActive =
							!browsingForWorkspace && root.path === workspacePath;
						const prevRoot = workspaceRoots[index - 1];
						const showSeparator = prevRoot?.pinned && !root.pinned;
						return (
							<Fragment key={root.path}>
								{showSeparator &&
									(sidebarCompact ? (
										<div className="my-3 flex justify-center">
											<div className="h-px w-4 rounded-full bg-muted/35 dark:bg-border" />
										</div>
									) : (
										<div className="mx-3 my-3 border-t border-border" />
									))}
								<WorkspaceItem
									root={root}
									isActive={isActive}
									compact={sidebarCompact}
									isDragging={draggingPath !== null}
									isDragOver={dragOverPath === root.path}
									isEditing={editingPath === root.path}
									editingName={editingName}
									onEditingNameChange={setEditingName}
									onSubmitRename={() => submitRenameWorkspace(root.path)}
									onCancelEdit={() => setEditingPath(null)}
									isMenuOpen={openMenuPath === root.path}
									onToggleMenu={() =>
										setOpenMenuPath((prev) =>
											prev === root.path ? null : root.path,
										)
									}
									onActivate={() => activateWorkspace(root.path)}
									onTogglePin={() => {
										const newPinned = !root.pinned;
										setWorkspacePinned(root.path, newPinned);
										syncSettingsToBackend({
											path: root.path,
											pinned: newPinned,
										});
										setOpenMenuPath(null);
									}}
									onRename={() => startRenameWorkspace(root.path, root.name)}
									onSetIcon={() => {
										setIconDialogPath(root.path);
										setOpenMenuPath(null);
									}}
									onDelete={() => {
										removeWorkspace(root.path);
										setOpenMenuPath(null);
									}}
									onDragStart={() => setDraggingPath(root.path)}
									onDragEnd={() => {
										setDraggingPath(null);
										setDragOverPath(null);
									}}
									onDragOver={(event) => {
										event.preventDefault();
										setDragOverPath(root.path);
									}}
									onDragLeave={() => {
										if (dragOverPath === root.path) {
											setDragOverPath(null);
										}
									}}
									onDrop={(event) => {
										event.preventDefault();
										if (draggingPath && draggingPath !== root.path) {
											reorderWorkspaceRoots(draggingPath, root.path);
										}
										setDragOverPath(null);
									}}
								/>
							</Fragment>
						);
					})}
				</div>

				{/* Settings */}
				<div className="border-t border-border px-2 py-3 shrink-0">
					<Tooltip content={sidebarCompact ? "Settings" : ""}>
						<button
							type="button"
							onClick={() => setSettingsOpen(true)}
							className="w-full inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted overflow-hidden hover:bg-surface-raised transition-colors"
						>
							<span className="inline-flex h-4 w-4 shrink-0 items-center justify-center leading-none">
								<Settings aria-hidden="true" size={14} className="shrink-0" />
							</span>
							{!sidebarCompact && (
								<span className="whitespace-nowrap">Settings</span>
							)}
						</button>
					</Tooltip>
				</div>
			</div>
			<IconPickerDialog
				workspace={selectedIconWorkspace}
				onConfirm={(path, icon) => {
					setWorkspaceIcon(path, icon);
					syncSettingsToBackend({ path, icon });
					setIconDialogPath(null);
				}}
				onClose={() => setIconDialogPath(null)}
			/>
			<SettingsDialog />
		</>
	);
}
