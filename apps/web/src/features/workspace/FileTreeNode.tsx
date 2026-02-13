import { useState } from "react";
import type { DirEntry } from "./useFileSystem";
import { getFileIconSrc, getFolderIconSrc } from "./vscodeIcons";

interface FileTreeNodeProps {
  entry: DirEntry;
  path: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onExpand: (path: string) => Promise<DirEntry[]>;
}

export function FileTreeNode({
  entry,
  path,
  selectedPath,
  onSelect,
  onExpand,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);

  const fullPath = path ? `${path}/${entry.name}` : entry.name;
  const isSelected = entry.kind !== "directory" && selectedPath === fullPath;
  const iconSrc =
    entry.kind === "directory"
      ? getFolderIconSrc(entry.name, expanded)
      : getFileIconSrc(entry.name);

  const handleClick = async () => {
    if (entry.kind === "directory") {
      if (!expanded) {
        const items = await onExpand(fullPath);
        setChildren(items);
      }
      setExpanded(!expanded);
    } else {
      onSelect(fullPath);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={`w-full h-5 text-left px-1.5 text-[12px] hover:bg-surface-raised flex items-center gap-1 truncate ${
          isSelected ? "bg-surface-overlay" : ""
        }`}
      >
        <span className="w-3 shrink-0 text-[10px] text-muted">
          {entry.kind === "directory" ? (expanded ? "\u25BE" : "\u25B8") : ""}
        </span>
        <img
          src={iconSrc}
          alt=""
          className="w-4 h-4 shrink-0"
          loading="lazy"
          decoding="async"
        />
        <span className="truncate">{entry.name}</span>
      </button>
      {expanded && children.length > 0 && (
        <div className="pl-3">
          {children.map((child) => (
            <FileTreeNode
              key={child.name}
              entry={child}
              path={fullPath}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onExpand={onExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}
