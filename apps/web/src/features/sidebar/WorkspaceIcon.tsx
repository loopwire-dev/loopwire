import { Folder } from "lucide-react";
import {
	isThemeMaskDisabled,
	stripMaskMetadata,
} from "../../shared/lib/icon-masking";
import { isEmojiShortcode } from "./workspace-sidebar-utils";

export function WorkspaceIcon({
	icon,
	emojiClassName = "inline-flex h-4 w-4 items-center justify-center text-[15px] leading-none align-middle",
	shortcodeClassName = "inline-block max-w-20 truncate rounded border border-border bg-surface px-1 py-0.5 text-[10px] font-medium leading-none text-muted",
	imageClassName = "h-4 w-4",
	folderSize = 14,
}: {
	icon: string | null | undefined;
	emojiClassName?: string;
	shortcodeClassName?: string;
	imageClassName?: string;
	folderSize?: number;
}) {
	if (!icon) {
		return (
			<Folder
				aria-hidden="true"
				size={folderSize}
				className="text-muted shrink-0 align-middle"
			/>
		);
	}
	if (isEmojiShortcode(icon)) {
		return <span className={shortcodeClassName}>{icon}</span>;
	}
	if (/^data:image\//i.test(icon)) {
		const maskDisabled = isThemeMaskDisabled(icon);
		const src = stripMaskMetadata(icon);
		return (
			<span
				aria-hidden="true"
				className={`relative inline-flex shrink-0 overflow-hidden rounded-full ${imageClassName}`}
			>
				<img
					src={src}
					alt=""
					className={`h-full w-full object-cover ${
						maskDisabled
							? ""
							: "grayscale contrast-125 brightness-[0.45] dark:invert dark:brightness-[1.35]"
					}`}
				/>
			</span>
		);
	}
	return (
		<span aria-hidden="true" className={emojiClassName}>
			{icon}
		</span>
	);
}
