import { useRef, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import type { WorkspaceRoot } from "../../shared/stores/app-store";
import { Tooltip } from "../../shared/ui/Tooltip";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { AgentRunningBadge } from "./AgentRunningBadge";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";

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
	runningCount: number;
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
	runningCount,
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
					className={`group relative w-full rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors text-left ${
						isActive
							? "font-medium"
							: "hover:bg-surface-raised"
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
					{isActive && (
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-black/[0.04] bg-white/55 shadow-sm backdrop-blur-2xl backdrop-saturate-200 dark:ring-white/[0.08] dark:bg-surface-raised dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
						/>
					)}
					<div className="relative flex w-full items-center gap-2">
						<WorkspaceIcon icon={root.icon} />
						{isEditing && !compact ? (
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
							<span
								className={`truncate flex-1 min-w-0 whitespace-nowrap transition-opacity duration-200 ${
									compact ? "opacity-0" : "opacity-100"
								}`}
							>
								{root.name}
							</span>
						)}
						{runningCount > 0 && (
							compact ? (
								<span className="absolute -top-1 -right-1">
									<AgentRunningBadge count={runningCount} />
								</span>
							) : (
								<AgentRunningBadge count={runningCount} />
							)
						)}
						<div
							className={`relative shrink-0 self-center transition-opacity duration-200 ${
								compact
									? "opacity-0 pointer-events-none"
									: "opacity-100"
							}`}
							data-workspace-menu-container="true"
						>
							<button
								ref={menuButtonRef}
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									onToggleMenu();
								}}
								className="inline-flex h-6 w-6 translate-y-px items-center justify-center text-muted hover:text-foreground transition-colors rounded-md hover:bg-surface hover:shadow-sm"
								title="Workspace actions"
								tabIndex={compact ? -1 : 0}
							>
								<Ellipsis aria-hidden="true" size={14} />
							</button>
							{isMenuOpen && !compact && (
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
					</div>
				</div>
			</MaybeTooltip>
		</div>
	);
}
