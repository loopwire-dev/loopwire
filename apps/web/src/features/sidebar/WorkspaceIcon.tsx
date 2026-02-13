import { Folder } from "lucide-react";
import { isEmojiShortcode } from "./workspace-sidebar-utils";

export function WorkspaceIcon({
	icon,
	emojiClassName = "text-base leading-none",
	shortcodeClassName = "inline-block max-w-20 truncate rounded border border-border bg-surface px-1 py-0.5 text-[10px] font-medium leading-none text-muted",
	folderSize = 14,
}: {
	icon: string | null | undefined;
	emojiClassName?: string;
	shortcodeClassName?: string;
	folderSize?: number;
}) {
	if (!icon) {
		return <Folder aria-hidden="true" size={folderSize} className="text-muted shrink-0" />;
	}
	if (isEmojiShortcode(icon)) {
		return <span className={shortcodeClassName}>{icon}</span>;
	}
	return (
		<span aria-hidden="true" className={emojiClassName}>
			{icon}
		</span>
	);
}
