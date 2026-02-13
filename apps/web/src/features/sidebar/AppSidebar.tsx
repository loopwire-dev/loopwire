import { Fragment, useEffect, useRef, useState } from "react";
import { PanelLeft, PanelRight, Plus, Settings } from "lucide-react";
import logo from "../../assets/images/logo.svg";
import { api } from "../../shared/lib/api";
import { useAppStore } from "../../shared/stores/app-store";
import { Tooltip } from "../../shared/ui/Tooltip";
import { SettingsDialog } from "../../shared/layout/SettingsDialog";
import { normalizePath } from "./workspace-sidebar-utils";
import { WorkspaceItem } from "./WorkspaceItem";
import { IconPickerDialog } from "./IconPickerDialog";

interface BackendWorkspaceEntry {
  path: string;
  name: string;
  pinned: boolean;
  icon: string | null;
}

function syncSettingsToBackend(entry: {
  path: string;
  name?: string;
  pinned?: boolean;
  icon?: string | null;
}) {
  api.post("/workspaces/settings", entry).catch(() => {});
}

export function AppSidebar() {
  const workspaceRoots = useAppStore((s) => s.workspaceRoots);
  const workspacePath = useAppStore((s) => s.workspacePath);
  const sessionsByWorkspacePath = useAppStore((s) => s.sessionsByWorkspacePath);
  const browsingForWorkspace = useAppStore((s) => s.browsingForWorkspace);
  const setBrowsingForWorkspace = useAppStore((s) => s.setBrowsingForWorkspace);
  const setWorkspacePath = useAppStore((s) => s.setWorkspacePath);
  const removeWorkspaceRoot = useAppStore((s) => s.removeWorkspaceRoot);
  const setWorkspacePinned = useAppStore((s) => s.setWorkspacePinned);
  const renameWorkspaceRoot = useAppStore((s) => s.renameWorkspaceRoot);
  const setWorkspaceIcon = useAppStore((s) => s.setWorkspaceIcon);
  const reorderWorkspaceRoots = useAppStore((s) => s.reorderWorkspaceRoots);
  const mergeBackendWorkspaces = useAppStore((s) => s.mergeBackendWorkspaces);
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

  const selectedIconWorkspace =
    workspaceRoots.find((root) => root.path === iconDialogPath) ?? null;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-workspace-menu-container='true']") && !target?.closest("[data-workspace-menu='true']")) {
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

  // Load workspaces from backend on mount (source of truth)
  const didFetchWorkspaces = useRef(false);
  useEffect(() => {
    if (didFetchWorkspaces.current) return;
    didFetchWorkspaces.current = true;
    api
      .get<BackendWorkspaceEntry[]>("/workspaces")
      .then((entries) => {
        mergeBackendWorkspaces(entries);
      })
      .catch(() => {});
  }, [mergeBackendWorkspaces]);

  const runningCount = (path: string): number => {
    const normalized = normalizePath(path);
    let count = 0;
    for (const [sessionPath, sessions] of Object.entries(
      sessionsByWorkspacePath,
    )) {
      if (normalizePath(sessionPath) === normalized) {
        count += sessions.length;
      }
    }
    return count;
  };

  const activateWorkspace = async (path: string) => {
    if (path !== workspacePath) {
      setWorkspacePath(path);
    }
    setBrowsingForWorkspace(false);

    // Sessions are already hydrated by useDaemon — read from the store
    const normalizedPath = normalizePath(path);
    const allSessions = useAppStore.getState().sessionsByWorkspacePath;
    const existing = allSessions[normalizedPath] ?? [];
    if (existing.length === 1) {
      attachWorkspaceSession(path, existing[0]?.sessionId ?? null);
    } else {
      attachWorkspaceSession(path, null);
    }

    try {
      const res = await api.post<{ workspace_id: string }>(
        "/workspaces/register",
        { path },
      );
      setWorkspace(path, res.workspace_id);
    } catch {
      // Workspace will work without ID, just no file tree
    }
  };

  const removeWorkspace = (path: string) => {
    removeWorkspaceRoot(path);
    api.post("/workspaces/remove", { path }).catch(() => {});
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

  return (
    <>
      <div
        className={`relative h-full flex flex-col border-r border-border bg-sidebar shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${
          sidebarCompact ? "w-14.5" : "w-64"
        }`}
      >
        {/* Header */}
        <div className={`h-11 border-b border-border flex items-center shrink-0 transition-[padding] duration-200 ease-in-out ${
          sidebarCompact ? "px-3" : "px-2"
        }`}>
          <button
            type="button"
            onClick={sidebarCompact ? toggleSidebarCompact : undefined}
            className={`group relative shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              sidebarCompact
                ? "hover:bg-surface-raised cursor-pointer"
                : "cursor-default"
            }`}
            aria-label={sidebarCompact ? "Expand sidebar" : undefined}
          >
            <img
              src={logo}
              alt="Loopwire"
              className={`h-6 w-6 transition-opacity duration-150 ${
                sidebarCompact
                  ? "group-hover:opacity-0 group-focus-visible:opacity-0"
                  : ""
              }`}
            />
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
          <div className={`min-w-0 transition-[flex] duration-200 ease-in-out ${
            sidebarCompact ? "flex-none" : "flex-1"
          }`} />
          <button
            type="button"
            onClick={toggleSidebarCompact}
            className={`shrink-0 rounded-lg text-muted hover:bg-surface-raised transition-all duration-200 ease-in-out ${
              sidebarCompact ? "opacity-0 pointer-events-none w-0 p-0 overflow-hidden" : "opacity-100 p-1.5"
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
              className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                browsingForWorkspace
                  ? "bg-surface-raised"
                  : "bg-transparent hover:bg-surface-raised"
              }`}
            >
              <Plus aria-hidden="true" size={14} className="shrink-0" />
              <span
                className={`whitespace-nowrap transition-opacity duration-200 ${
                  sidebarCompact ? "opacity-0" : "opacity-100"
                }`}
              >
                New Workspace
              </span>
            </button>
          </Tooltip>
        </div>

        {/* Workspace list */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {!sidebarCompact && (
            <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted uppercase tracking-wider">
              Workspaces
            </p>
          )}
          {!sidebarCompact && workspaceRoots.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted text-center">
              No workspaces
            </p>
          )}
          {workspaceRoots.map((root, index) => {
            const isActive =
              !browsingForWorkspace && root.path === workspacePath;
            const count = runningCount(root.path);
            const prevRoot = workspaceRoots[index - 1];
            const showSeparator =
              prevRoot?.pinned && !root.pinned;
            return (
              <Fragment key={root.path}>
                {showSeparator && (
                  <div className="mx-3 my-3 border-t border-border" />
                )}
                <WorkspaceItem
                  root={root}
                  isActive={isActive}
                  compact={sidebarCompact}
                  isDragging={draggingPath !== null}
                  isDragOver={dragOverPath === root.path}
                  runningCount={count}
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
                  onActivate={() => void activateWorkspace(root.path)}
                  onTogglePin={() => {
                    const newPinned = !root.pinned;
                    setWorkspacePinned(root.path, newPinned);
                    syncSettingsToBackend({ path: root.path, pinned: newPinned });
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
              className="w-full inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-raised transition-colors"
            >
              <Settings aria-hidden="true" size={16} className="shrink-0" />
              <span
                className={`whitespace-nowrap transition-opacity duration-200 ${
                  sidebarCompact ? "opacity-0" : "opacity-100"
                }`}
              >
                Settings
              </span>
            </button>
          </Tooltip>
        </div>
      </div>
      <IconPickerDialog
        workspace={selectedIconWorkspace}
        runningCount={
          selectedIconWorkspace ? runningCount(selectedIconWorkspace.path) : 0
        }
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
