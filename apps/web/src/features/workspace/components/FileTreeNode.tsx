import { ChevronDown, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { DirEntry } from "../hooks/useFileSystem";
import type { GitStatusMap } from "../hooks/useGitStatus";
import { getFileIconSrc, getFolderIconSrc } from "../lib/vscodeIcons";

export interface TreeCommand {
	id: number;
	type: "expand_all" | "collapse_all";
}

interface FileTreeNodeProps {
	entry: DirEntry;
	path: string;
	depth?: number;
	selectedPath: string | null;
	onSelect: (path: string) => void;
	onExpand: (path: string) => Promise<DirEntry[]>;
	gitStatus: GitStatusMap;
	treeCommand: TreeCommand | null;
}

function getStatusColorClass(status: string | undefined): string {
	switch (status) {
		case "added":
		case "untracked":
			return "text-[#73c991]";
		case "modified":
			return "text-[#e2c08d]";
		case "deleted":
			return "text-[#c74e39]";
		default:
			return "";
	}
}

function focusRelativeTreeNode(current: HTMLButtonElement, delta: number) {
	const tree = current.closest<HTMLElement>("[data-file-tree='true']");
	if (!tree) return;
	const nodes = Array.from(
		tree.querySelectorAll<HTMLButtonElement>("[data-tree-node='true']"),
	);
	const currentIndex = nodes.findIndex(
		(node) => node.dataset.path === current.dataset.path,
	);
	if (currentIndex === -1) return;
	const targetIndex = currentIndex + delta;
	if (targetIndex < 0 || targetIndex >= nodes.length) return;
	nodes[targetIndex]?.focus();
}

function focusTreeNodeByPath(
	current: HTMLButtonElement,
	targetPath: string | null,
) {
	if (!targetPath) return;
	const tree = current.closest<HTMLElement>("[data-file-tree='true']");
	if (!tree) return;
	const nodes = Array.from(
		tree.querySelectorAll<HTMLButtonElement>("[data-tree-node='true']"),
	);
	const target = nodes.find((node) => node.dataset.path === targetPath);
	target?.focus();
}

function parentPathOf(path: string): string | null {
	const idx = path.lastIndexOf("/");
	if (idx <= 0) return null;
	return path.slice(0, idx);
}

export function FileTreeNode({
	entry,
	path,
	depth = 0,
	selectedPath,
	onSelect,
	onExpand,
	gitStatus,
	treeCommand,
}: FileTreeNodeProps) {
	const [expanded, setExpanded] = useState(false);
	const [children, setChildren] = useState<DirEntry[]>([]);
	const [hasLoadedChildren, setHasLoadedChildren] = useState(false);
	const handledCommandIdRef = useRef<number | null>(null);

	const fullPath = path ? `${path}/${entry.name}` : entry.name;
	const isSelected = entry.kind !== "directory" && selectedPath === fullPath;
	const isDir = entry.kind === "directory";
	const iconSrc = isDir
		? getFolderIconSrc(entry.name, expanded)
		: getFileIconSrc(entry.name);

	const ignored = gitStatus.isIgnored(fullPath);
	const fileInfo = !isDir ? gitStatus.getFile(fullPath) : null;
	const folderStatus = isDir ? gitStatus.getFolder(fullPath) : undefined;
	const statusForColor = isDir ? folderStatus : fileInfo?.status;
	const colorClass = ignored
		? "text-[#9e9e9e]"
		: getStatusColorClass(statusForColor);

	const loadChildren = async (): Promise<DirEntry[]> => {
		if (hasLoadedChildren) return children;
		const items = await onExpand(fullPath);
		setChildren(items);
		setHasLoadedChildren(true);
		return items;
	};

	useEffect(() => {
		if (!treeCommand) return;
		if (handledCommandIdRef.current === treeCommand.id) return;
		handledCommandIdRef.current = treeCommand.id;

		if (treeCommand.type === "collapse_all") {
			setExpanded(false);
			return;
		}

		if (!isDir) return;

		let cancelled = false;
		(async () => {
			if (!hasLoadedChildren) {
				const items = await onExpand(fullPath);
				if (cancelled) return;
				setChildren(items);
				setHasLoadedChildren(true);
			}
			if (!cancelled) setExpanded(true);
		})();

		return () => {
			cancelled = true;
		};
	}, [treeCommand, isDir, hasLoadedChildren, onExpand, fullPath]);

	const handleClick = async () => {
		if (isDir) {
			if (!expanded) {
				await loadChildren();
				setExpanded(true);
			} else {
				setExpanded(false);
			}
		} else {
			onSelect(fullPath);
		}
	};

	const handleKeyDown = async (e: KeyboardEvent<HTMLButtonElement>) => {
		const current = e.currentTarget;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			focusRelativeTreeNode(current, 1);
			return;
		}

		if (e.key === "ArrowUp") {
			e.preventDefault();
			focusRelativeTreeNode(current, -1);
			return;
		}

		if (e.key === "ArrowRight") {
			if (!isDir) return;
			e.preventDefault();
			if (!expanded) {
				await loadChildren();
				setExpanded(true);
				return;
			}
			if (children.length > 0) {
				const firstChildPath = `${fullPath}/${children[0]?.name}`;
				focusTreeNodeByPath(current, firstChildPath);
			}
			return;
		}

		if (e.key === "ArrowLeft") {
			e.preventDefault();
			if (isDir && expanded) {
				setExpanded(false);
				return;
			}
			focusTreeNodeByPath(current, parentPathOf(fullPath));
		}
	};

	return (
		<div>
			<button
				type="button"
				onClick={handleClick}
				onKeyDown={handleKeyDown}
				style={{ paddingLeft: `${depth * 12 + 8}px` }}
				data-tree-node="true"
				data-path={fullPath}
				aria-level={depth + 1}
				aria-expanded={isDir ? expanded : undefined}
				aria-selected={isSelected}
				className={`group w-full min-h-[26px] text-left pr-2 text-[12px] flex items-center gap-1.5 truncate transition-colors ${
					isSelected
						? "bg-accent/10 text-foreground"
						: "hover:bg-surface-overlay/70"
				}`}
			>
				<span className="w-3.5 shrink-0 flex items-center justify-center text-muted">
					{isDir ? (
						expanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)
					) : null}
				</span>
				<img
					src={iconSrc}
					alt=""
					className="w-4 h-4 shrink-0"
					loading="lazy"
					decoding="async"
				/>
				<span className={`truncate ${colorClass}`}>{entry.name}</span>
				{fileInfo &&
					(fileInfo.additions != null || fileInfo.deletions != null) && (
						<span className="ml-auto shrink-0 font-mono text-[10px] flex gap-1">
							{fileInfo.additions != null && (
								<span className="text-[#73c991]">+{fileInfo.additions}</span>
							)}
							{fileInfo.deletions != null && (
								<span className="text-[#c74e39]">-{fileInfo.deletions}</span>
							)}
						</span>
					)}
			</button>
			{expanded && children.length > 0 && (
				<div>
					{children.map((child) => (
						<FileTreeNode
							key={child.name}
							entry={child}
							path={fullPath}
							depth={depth + 1}
							selectedPath={selectedPath}
							onSelect={onSelect}
							onExpand={onExpand}
							gitStatus={gitStatus}
							treeCommand={treeCommand}
						/>
					))}
				</div>
			)}
		</div>
	);
}
