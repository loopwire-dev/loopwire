import { useState, useEffect, useCallback } from "react";
import { Folder } from "lucide-react";
import { Button } from "../../shared/ui/Button";
import { api } from "../../shared/lib/api";
import type { DirEntry } from "./useFileSystem";

interface FolderBrowserProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function FolderBrowser({
  initialPath,
  onSelect,
  onCancel,
}: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? "/");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<DirEntry[]>("/fs/browse", {
        path,
      });
      setEntries(res.filter((e) => e.kind === "directory"));
      setCurrentPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialPath && initialPath !== "~") {
      loadDirectory(initialPath);
    } else {
      // Resolve home directory from the daemon
      api
        .get<{ roots: string[] }>("/fs/roots")
        .then((res) => {
          const home = res.roots[res.roots.length - 1] ?? "/";
          loadDirectory(home);
        })
        .catch(() => loadDirectory("/"));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
    loadDirectory(parent);
  };

  const navigateInto = (name: string) => {
    const next = currentPath.endsWith("/")
      ? `${currentPath}${name}`
      : `${currentPath}/${name}`;
    loadDirectory(next);
  };

  const pathSegments = currentPath.split("/").filter(Boolean);
  const visibleEntries = showHidden
    ? entries
    : entries.filter((e) => !e.name.startsWith("."));

  return (
    <div className="flex flex-col h-[420px]">
      {/* Breadcrumb */}
      <div className="h-[26.5px] flex items-center justify-between gap-2 px-3 border-b border-border text-xs overflow-x-auto shrink-0">
        <div className="flex items-center gap-1">
        {pathSegments.length === 0 ? (
          <span className="text-muted">/</span>
        ) : (
          pathSegments.map((segment, i) => {
            const segmentPath = "/" + pathSegments.slice(0, i + 1).join("/");
            return (
              <span key={segmentPath} className="flex items-center gap-1">
                <span className="text-muted">/</span>
                <button
                  onClick={() => loadDirectory(segmentPath)}
                  className="text-muted hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors truncate max-w-[120px]"
                >
                  {segment}
                </button>
              </span>
            );
          })
        )}
        </div>
        <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none text-muted hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="accent-accent"
          />
          Hidden
        </label>
      </div>

      {/* Directory listing */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-sm text-muted">Loading...</div>
        )}
        {error && (
          <div className="p-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        {!loading && !error && (
          <div className="p-1">
            {currentPath !== "/" && (
              <button
                onClick={navigateUp}
                className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-surface-raised transition-colors flex items-center gap-2 text-muted"
              >
                <span className="text-xs">..</span>
              </button>
            )}
            {visibleEntries.map((entry) => (
              <button
                key={entry.name}
                onClick={() => navigateInto(entry.name)}
                className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-surface-raised transition-colors flex items-center gap-2"
              >
                <Folder aria-hidden="true" size={14} className="text-muted shrink-0" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
            {!loading && visibleEntries.length === 0 && currentPath !== "/" && (
              <div className="p-4 text-sm text-muted text-center">
                No subdirectories
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-border shrink-0">
        <p className="text-xs font-mono text-muted truncate flex-1">
          {currentPath}
        </p>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSelect(currentPath)}>
            Select
          </Button>
        </div>
      </div>
    </div>
  );
}
