import { ChevronsDownUp, ChevronsUpDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFileSystem, type DirEntry } from "./useFileSystem";
import { FileTreeNode, type TreeCommand } from "./FileTreeNode";
import { useAppStore } from "../../shared/stores/app-store";
import { api } from "../../shared/lib/api";
import { fetchGitDiffFiles } from "../editor/diffUtils";
import { useGitStatus } from "./useGitStatus";

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
};

function getLowerExtension(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1).toLowerCase();
}

function getImageMimeType(path: string): string | null {
  const ext = getLowerExtension(path);
  return IMAGE_MIME_BY_EXTENSION[ext] ?? null;
}

export function FileTree() {
  const { entries, loading, listDirectory } = useFileSystem();
  const workspaceId = useAppStore((s) => s.workspaceId);
  const workspacePath = useAppStore((s) => s.workspacePath);
  const openFilePath = useAppStore((s) => s.openFilePath);
  const setOpenFile = useAppStore((s) => s.setOpenFile);
  const gitStatus = useGitStatus(workspaceId);
  const [treeCommand, setTreeCommand] = useState<TreeCommand | null>(null);
  const [allExpanded, setAllExpanded] = useState(false);
  const commandIdRef = useRef(0);

  // Pre-fetch git diff data so gutter decorations appear instantly when opening files
  useEffect(() => {
    if (!workspaceId) return;
    fetchGitDiffFiles(workspaceId).catch(() => {});
  }, [workspaceId]);
  const workspaceName = workspacePath?.split("/").pop() ?? "Workspace";

  const fileCount = entries.length;

  const handleSelect = useCallback(
    async (path: string) => {
      if (!workspaceId) return;
      try {
        const file = await api.get<{
          content: string;
          size: number;
          is_binary: boolean;
          binary_content_base64: string | null;
        }>("/fs/read", {
          workspace_id: workspaceId,
          relative_path: path,
          include_binary: "true",
        });
        const imageMimeType = getImageMimeType(path);

        if (imageMimeType) {
          if (file.is_binary) {
            if (!file.binary_content_base64) return;
            setOpenFile(path, null, `data:${imageMimeType};base64,${file.binary_content_base64}`);
            return;
          }
          if (imageMimeType === "image/svg+xml") {
            const encoded = encodeURIComponent(file.content);
            setOpenFile(path, null, `data:${imageMimeType};charset=utf-8,${encoded}`);
            return;
          }
        }

        if (!file.is_binary) {
          setOpenFile(path, file.content, null);
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

  const handleRefresh = useCallback(() => {
    void listDirectory(".");
  }, [listDirectory]);

  const handleToggleExpandAll = useCallback(() => {
    const nextType = allExpanded ? "collapse_all" : "expand_all";
    commandIdRef.current += 1;
    setTreeCommand({ id: commandIdRef.current, type: nextType });
    setAllExpanded(!allExpanded);
  }, [allExpanded]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border bg-surface-raised px-4 py-3">
        <p className="text-sm">
          <span className="font-semibold">{workspaceName}</span>
          <span className="text-muted text-xs ml-2">
            {loading ? "Loading..." : `${fileCount} item${fileCount === 1 ? "" : "s"}`}
          </span>
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleExpandAll}
            className="inline-flex items-center rounded-md border border-border bg-surface p-1.5 text-xs font-medium text-muted hover:bg-surface-overlay"
            title={allExpanded ? "Collapse all" : "Expand all"}
            aria-label={allExpanded ? "Collapse all" : "Expand all"}
          >
            {allExpanded ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center rounded-md border border-border bg-surface p-1.5 text-xs font-medium text-muted hover:bg-surface-overlay disabled:opacity-50 disabled:pointer-events-none"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1" data-file-tree="true" role="tree" aria-label="File tree">
        {entries.map((entry) => (
          <FileTreeNode
            key={entry.name}
            entry={entry}
            path=""
            selectedPath={openFilePath}
            onSelect={handleSelect}
            onExpand={handleExpand}
            gitStatus={gitStatus}
            treeCommand={treeCommand}
          />
        ))}
        {!loading && entries.length === 0 && (
          <div className="px-4 py-3 text-xs text-muted">
            No files found.
          </div>
        )}
      </div>
    </div>
  );
}
