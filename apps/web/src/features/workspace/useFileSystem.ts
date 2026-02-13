import { useState, useCallback } from "react";
import { api } from "../../shared/lib/api";
import { useAppStore } from "../../shared/stores/app-store";

export interface DirEntry {
  name: string;
  kind: "file" | "directory" | "symlink";
  size: number | null;
  modified: number | null;
}

export function useFileSystem() {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceId = useAppStore((s) => s.workspaceId);

  const fetchRoots = useCallback(async () => {
    const res = await api.get<{ roots: string[] }>("/fs/roots");
    return res.roots;
  }, []);

  const listDirectory = useCallback(
    async (relativePath = ".") => {
      if (!workspaceId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<DirEntry[]>("/fs/list", {
          workspace_id: workspaceId,
          relative_path: relativePath,
        });
        setEntries(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to list directory");
      } finally {
        setLoading(false);
      }
    },
    [workspaceId],
  );

  const readFile = useCallback(
    async (relativePath: string) => {
      if (!workspaceId) return null;
      const res = await api.get<{
        content: string;
        size: number;
        is_binary: boolean;
      }>("/fs/read", {
        workspace_id: workspaceId,
        relative_path: relativePath,
      });
      return res;
    },
    [workspaceId],
  );

  return { entries, loading, error, fetchRoots, listDirectory, readFile };
}
