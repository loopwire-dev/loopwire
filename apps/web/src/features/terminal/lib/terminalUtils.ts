const IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/svg+xml",
];

interface SessionLike {
	sessionId: string;
	resumeFailureReason?: string | null;
}

type SessionsByWorkspacePath = Record<string, SessionLike[]>;

interface ClipboardItemLike {
	kind: string;
	type: string;
	getAsFile(): File | null;
}

export function isSupportedTerminalImageType(type: string): boolean {
	return IMAGE_TYPES.includes(type);
}

export function findResumeFailureReason(
	sessionsByWorkspacePath: SessionsByWorkspacePath,
	sessionId: string,
): string | null {
	for (const sessions of Object.values(sessionsByWorkspacePath)) {
		const match = sessions.find((s) => s.sessionId === sessionId);
		if (match?.resumeFailureReason) return match.resumeFailureReason;
	}
	return null;
}

export function pickSupportedImageFileFromFiles(
	files: File[] | FileList,
): File | null {
	return (
		Array.from(files).find((file) => isSupportedTerminalImageType(file.type)) ??
		null
	);
}

export function pickSupportedImageFileFromClipboard(
	files: File[] | FileList,
	items: ClipboardItemLike[] | DataTransferItemList,
): File | null {
	const fromFiles = pickSupportedImageFileFromFiles(files);
	if (fromFiles) return fromFiles;

	const item = Array.from(items).find(
		(entry) =>
			entry.kind === "file" && isSupportedTerminalImageType(entry.type || ""),
	);
	return item?.getAsFile() ?? null;
}

export function getBase64FromDataUrl(dataUrl: string): string | null {
	return dataUrl.split(",")[1] || null;
}
