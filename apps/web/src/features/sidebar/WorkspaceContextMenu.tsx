import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Pin, PinOff, Smile, Trash2 } from "lucide-react";
import type { WorkspaceRoot } from "../../shared/stores/app-store";

interface WorkspaceContextMenuProps {
	root: WorkspaceRoot;
	anchorRef: React.RefObject<HTMLButtonElement | null>;
	onTogglePin: () => void;
	onRename: () => void;
	onSetIcon: () => void;
	onDelete: () => void;
}

export function WorkspaceContextMenu({
	root,
	anchorRef,
	onTogglePin,
	onRename,
	onSetIcon,
	onDelete,
}: WorkspaceContextMenuProps) {
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

	useLayoutEffect(() => {
		const el = anchorRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		setPos({ top: rect.bottom + 4, left: rect.left });
	}, [anchorRef]);

	if (!pos) return null;

	return createPortal(
		<div
			data-workspace-menu="true"
			className="fixed z-50 flex flex-col rounded-lg border border-border bg-surface shadow-xl py-1.5 pl-1.5 pr-4"
			style={{ top: pos.top, left: pos.left }}
		>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onTogglePin();
				}}
				className="inline-flex items-center gap-2 text-left px-2.5 py-2 text-sm rounded-md hover:bg-surface-overlay transition-colors whitespace-nowrap"
			>
				{root.pinned ? (
					<PinOff aria-hidden="true" size={14} />
				) : (
					<Pin aria-hidden="true" size={14} />
				)}
				{root.pinned ? "Unpin" : "Pin"}
			</button>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onRename();
				}}
				className="inline-flex items-center gap-2 text-left px-2.5 py-2 text-sm rounded-md hover:bg-surface-overlay transition-colors whitespace-nowrap"
			>
				<Pencil aria-hidden="true" size={14} />
				Rename
			</button>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onSetIcon();
				}}
				className="inline-flex items-center gap-2 text-left px-2.5 py-2 text-sm rounded-md hover:bg-surface-overlay transition-colors whitespace-nowrap"
			>
				<Smile aria-hidden="true" size={14} />
				Set Icon
			</button>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onDelete();
				}}
				className="inline-flex items-center gap-2 text-left px-2.5 py-2 text-sm rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors whitespace-nowrap"
			>
				<Trash2 aria-hidden="true" size={14} />
				Delete
			</button>
		</div>,
		document.body,
	);
}
