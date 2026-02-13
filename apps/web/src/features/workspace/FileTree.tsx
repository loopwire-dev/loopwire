import { useEffect, useCallback } from "react";
import { useFileSystem, type DirEntry } from "./useFileSystem";
import { FileTreeNode } from "./FileTreeNode";
import { useAppStore } from "../../shared/stores/app-store";
import { api } from "../../shared/lib/api";

export function FileTree() {
  const { entries, loading, listDirectory } = useFileSystem();
  const workspaceId = useAppStore((s) => s.workspaceId);
  const workspacePath = useAppStore((s) => s.workspacePath);
  const openFilePath = useAppStore((s) => s.openFilePath);
  const setOpenFile = useAppStore((s) => s.setOpenFile);
  const workspaceName = workspacePath?.split("/").pop() ?? "Workspace";

  useEffect(() => {
    listDirectory(".");
  }, [listDirectory]);

  const handleSelect = useCallback(
    async (path: string) => {
      if (!workspaceId) return;
      try {
        const file = await api.get<{
          content: string;
          size: number;
          is_binary: boolean;
        }>("/fs/read", {
          workspace_id: workspaceId,
          relative_path: path,
        });
        if (!file.is_binary) {
          setOpenFile(path, file.content);
        }
      } catch (err) {
        console.error("Failed to read file:", err);
      }
    },
    [workspaceId, setOpenFile],
  );

  const handleExpand = useCallback(
    async (path: string): Promise<DirEntry[]> => {
      if (!workspaceId) return [];
      try {
        return await api.get<DirEntry[]>("/fs/list", {
          workspace_id: workspaceId,
          relative_path: path,
        });
      } catch {
        return [];
      }
    },
    [workspaceId],
  );

  if (loading) {
    return (
      <div className="p-3 text-xs text-muted">Loading files...</div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="h-[26.5px] px-3 flex items-center text-xs leading-none font-medium text-zinc-700 dark:text-zinc-200 border-y border-border bg-surface-raised truncate">
        {workspaceName}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {entries.map((entry) => (
          <FileTreeNode
            key={entry.name}
            entry={entry}
            path=""
            selectedPath={openFilePath}
            onSelect={handleSelect}
            onExpand={handleExpand}
          />
        ))}
      </div>
    </div>
  );
}
