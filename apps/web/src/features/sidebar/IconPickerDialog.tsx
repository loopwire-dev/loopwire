import { useState } from "react";
import EmojiPicker, { Theme, SkinTonePickerLocation, SuggestionMode, type EmojiClickData } from "emoji-picker-react";
import { useTheme } from "next-themes";
import type { WorkspaceRoot } from "../../shared/stores/app-store";
import { Dialog } from "../../shared/ui/Dialog";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { AgentRunningBadge } from "./AgentRunningBadge";

interface IconPickerDialogProps {
	workspace: WorkspaceRoot | null;
	runningCount: number;
	onConfirm: (path: string, icon: string) => void;
	onClose: () => void;
}

export function IconPickerDialog({
	workspace,
	runningCount,
	onConfirm,
	onClose,
}: IconPickerDialogProps) {
	const [iconDraft, setIconDraft] = useState("");
	const [iconBounceKey, setIconBounceKey] = useState(0);
	const { resolvedTheme } = useTheme();

	const handleOpen = (open: boolean) => {
		if (!open) {
			onClose();
		}
	};

	// Reset draft state when workspace changes (dialog opens)
	const prevPathRef = useState<string | null>(null);
	if (workspace && prevPathRef[0] !== workspace.path) {
		prevPathRef[1](workspace.path);
		setIconDraft(workspace.icon ?? "");
	}
	if (!workspace && prevPathRef[0] !== null) {
		prevPathRef[1](null);
	}

	const handleEmojiClick = (emojiData: EmojiClickData) => {
		setIconDraft(emojiData.emoji);
		setIconBounceKey((k) => k + 1);
	};

	return (
		<Dialog open={Boolean(workspace)} onOpenChange={handleOpen} title="Set Workspace Icon">
			{workspace ? (
				<div className="space-y-5">
					<div className="rounded-lg border border-border px-2.5 pt-2 pb-2.5">
						<p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted">
							Preview
						</p>
						<div
							className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm border border-border"
						>
							<span
							key={iconBounceKey}
							className={iconDraft ? "animate-icon-pop" : undefined}
						>
							<WorkspaceIcon icon={iconDraft || null} />
						</span>
							<span className="truncate flex-1">{workspace.name}</span>
							{runningCount > 0 && <AgentRunningBadge count={runningCount} />}
						</div>
					</div>
					<EmojiPicker
						onEmojiClick={handleEmojiClick}
						theme={resolvedTheme === "dark" ? Theme.DARK : Theme.LIGHT}
						skinTonePickerLocation={SkinTonePickerLocation.SEARCH}
						width="100%"
						previewConfig={{ showPreview: false }}
						suggestedEmojisMode={SuggestionMode.RECENT}
						lazyLoadEmojis
					/>
					<div className="flex items-center justify-between gap-2">
						<button
							type="button"
							onClick={() => {
								setIconDraft("");
							}}
							className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-raised"
						>
							Clear
						</button>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => {
									onConfirm(workspace.path, iconDraft);
								}}
								className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm text-white hover:bg-accent-hover"
							>
								Confirm
							</button>
						</div>
					</div>
				</div>
			) : null}
		</Dialog>
	);
}
