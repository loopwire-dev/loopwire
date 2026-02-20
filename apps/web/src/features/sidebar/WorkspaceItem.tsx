import { Ellipsis } from "lucide-react";
import { type ReactNode, useRef } from "react";
import type { WorkspaceRoot } from "../../shared/stores/app-store";
import { Tooltip } from "../../shared/ui/Tooltip";
import {
	SIDEBAR_TAB_HOVER_CLASS,
	SIDEBAR_TAB_SELECTED_OVERLAY_CLASS,
} from "./sidebar-tab-styles";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";
import { WorkspaceIcon } from "./WorkspaceIcon";

function MaybeTooltip({
	active,
	content,
	children,
}: {
	active: boolean;
	content: string;
	children: ReactNode;
}) {
	if (!active) return children;
	return <Tooltip content={content}>{children}</Tooltip>;
}

interface WorkspaceItemProps {
	root: WorkspaceRoot;
	isActive: boolean;
	compact: boolean;
	isDragging: boolean;
	isDragOver: boolean;
	isEditing: boolean;
	editingName: string;
	onEditingNameChange: (name: string) => void;
	onSubmitRename: () => void;
	onCancelEdit: () => void;
	isMenuOpen: boolean;
	onToggleMenu: () => void;
	onActivate: () => void;
	onTogglePin: () => void;
	onRename: () => void;
	onSetIcon: () => void;
	onDelete: () => void;
	onDragStart: () => void;
	onDragEnd: () => void;
	onDragOver: (event: React.DragEvent) => void;
	onDragLeave: () => void;
	onDrop: (event: React.DragEvent) => void;
}

export function WorkspaceItem({
	root,
	isActive,
	compact,
	isDragging,
	isDragOver,
	isEditing,
	editingName,
	onEditingNameChange,
	onSubmitRename,
	onCancelEdit,
	isMenuOpen,
	onToggleMenu,
	onActivate,
	onTogglePin,
	onRename,
	onSetIcon,
	onDelete,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDragLeave,
	onDrop,
}: WorkspaceItemProps) {
	const menuButtonRef = useRef<HTMLButtonElement>(null);

	return (
		<div
			draggable={!compact}
			onDragStart={compact ? undefined : onDragStart}
			onDragEnd={compact ? undefined : onDragEnd}
			onDragOver={compact ? undefined : onDragOver}
			onDragLeave={compact ? undefined : onDragLeave}
			onDrop={compact ? undefined : onDrop}
			className={`relative rounded-lg mb-1.5 last:mb-0 ${
				isMenuOpen ? "z-30" : ""
			} ${isDragOver && !compact ? "ring-1 ring-accent/50" : ""}`}
		>
			<MaybeTooltip
				active={compact || !isDragging}
				content={compact ? root.name : root.path}
			>
					<div
						role="button"
						tabIndex={0}
						className={`group relative h-9 w-full rounded-lg px-3 text-sm cursor-pointer overflow-hidden transition-colors text-left ${
							isActive
								? "font-medium"
								: SIDEBAR_TAB_HOVER_CLASS
						}`}
					onClick={() => {
						if (isEditing) return;
						onActivate();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							if (isEditing) return;
							onActivate();
						}
					}}
				>
						<span
							aria-hidden="true"
							className={`${SIDEBAR_TAB_SELECTED_OVERLAY_CLASS} ${
								isActive ? "opacity-100" : "opacity-0"
							}`}
						/>
					<div className="relative flex h-full w-full items-center gap-2">
						<span className="inline-flex h-4 w-4 shrink-0 items-center justify-center leading-none">
							<WorkspaceIcon
								icon={root.icon}
								emojiClassName="inline-flex h-4 w-4 items-center justify-center text-[15px] leading-none align-middle"
							/>
						</span>
						{compact ? null : isEditing ? (
							<input
								autoFocus
								value={editingName}
								onChange={(event) => onEditingNameChange(event.target.value)}
								onBlur={onSubmitRename}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										onSubmitRename();
									}
									if (event.key === "Escape") {
										onCancelEdit();
									}
								}}
								className="flex-1 min-w-0 rounded border border-border bg-surface px-1.5 py-0.5 text-sm"
							/>
						) : (
							<span className="truncate flex-1 min-w-0 whitespace-nowrap">
								{root.name}
							</span>
						)}
						{compact ? null : (
							<div
								className="relative shrink-0 self-center"
								data-workspace-menu-container="true"
							>
								<button
									ref={menuButtonRef}
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										onToggleMenu();
									}}
									className={`inline-flex h-6 w-6 translate-y-px items-center justify-center rounded-md transition-all ${
										isMenuOpen
											? "!opacity-100 text-foreground"
											: "opacity-0 group-hover:opacity-100 text-muted hover:text-foreground"
									}`}
									title="Workspace actions"
								>
									<Ellipsis aria-hidden="true" size={14} />
								</button>
								{isMenuOpen && (
									<WorkspaceContextMenu
										root={root}
										anchorRef={menuButtonRef}
										onTogglePin={onTogglePin}
										onRename={onRename}
										onSetIcon={onSetIcon}
										onDelete={onDelete}
									/>
								)}
							</div>
						)}
					</div>
				</div>
			</MaybeTooltip>
		</div>
	);
}
