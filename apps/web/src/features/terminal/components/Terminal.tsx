import { AlertTriangle } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { attachToSession } from "../../../shared/lib/daemon/rest";
import { useAppStore } from "../../../shared/stores/app-store";
import { LoopwireSpinner } from "../../../shared/ui/LoopwireSpinner";
import { useTerminal } from "../hooks/useTerminal";
import {
	findResumeFailureReason,
	getBase64FromDataUrl,
	pickSupportedImageFileFromClipboard,
	pickSupportedImageFileFromFiles,
} from "../lib/terminalUtils";
import { ScrollbackOverlay } from "./ScrollbackOverlay";

interface TerminalProps {
	sessionId: string;
}

export function Terminal({ sessionId }: TerminalProps) {
	const { resolvedTheme } = useTheme();
	const [showScrollback, setShowScrollback] = useState(false);
	const termTheme = resolvedTheme === "dark" ? "dark" : ("light" as const);
	const sessionsByWorkspacePath = useAppStore((s) => s.sessionsByWorkspacePath);
	const resumeFailureReason = useMemo(() => {
		return findResumeFailureReason(sessionsByWorkspacePath, sessionId);
	}, [sessionsByWorkspacePath, sessionId]);
	const [dismissedWarning, setDismissedWarning] = useState(false);
	const { ref, isLoading, connectionError, sendInput } = useTerminal(
		sessionId,
		termTheme,
		useCallback(() => setShowScrollback(true), []),
	);
	const [isDragOver, setIsDragOver] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const attachImage = useCallback(
		async (file: File) => {
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result as string);
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(file);
			});

			const base64 = getBase64FromDataUrl(dataUrl);
			if (!base64) return;

			const result = await attachToSession(sessionId, base64, file.name);

			sendInput(result.path);
		},
		[sendInput, sessionId],
	);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer.types.includes("Files")) {
			setIsDragOver(true);
		}
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(false);
	}, []);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragOver(false);

			const file = pickSupportedImageFileFromFiles(e.dataTransfer.files);
			if (!file) return;

			try {
				await attachImage(file);
			} catch (err) {
				console.error("[terminal] attachment upload failed:", err);
			}
		},
		[attachImage],
	);

	// Intercept paste events before xterm.js to handle image paste
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handlePaste = (e: ClipboardEvent) => {
			if (!e.clipboardData) return;

			const file = pickSupportedImageFileFromClipboard(
				e.clipboardData.files,
				e.clipboardData.items,
			);

			if (!file) return;

			e.preventDefault();
			e.stopPropagation();

			attachImage(file).catch((err) => {
				console.error("[terminal] paste attachment upload failed:", err);
			});
		};

		container.addEventListener("paste", handlePaste, { capture: true });
		return () => {
			container.removeEventListener("paste", handlePaste, { capture: true });
		};
	}, [attachImage]);

	return (
		<div
			ref={containerRef}
			className="h-full w-full relative"
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{isLoading && (
				<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/70">
					<LoopwireSpinner size={26} label="Loading terminal" />
					<p className="text-xs text-muted">Getting things ready...</p>
				</div>
			)}
			{connectionError && (
				<div className="absolute inset-0 z-30 flex items-center justify-center bg-surface/85 p-4">
					<div className="max-w-md rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
						{connectionError}
					</div>
				</div>
			)}
			{isDragOver && (
				<div className="absolute inset-0 z-20 flex items-center justify-center bg-surface/80 border-2 border-dashed border-accent rounded-lg pointer-events-none">
					<p className="text-sm text-accent font-medium">
						Drop image to attach
					</p>
				</div>
			)}
			{resumeFailureReason && !dismissedWarning && (
				<div className="absolute top-0 inset-x-0 z-10 flex items-center gap-2 border-b border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
					<AlertTriangle size={14} className="shrink-0" />
					<span className="flex-1">{resumeFailureReason}</span>
					<button
						type="button"
						onClick={() => setDismissedWarning(true)}
						className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide hover:bg-amber-500/15 transition-colors"
					>
						Dismiss
					</button>
				</div>
			)}
			{showScrollback && (
				<ScrollbackOverlay
					sessionId={sessionId}
					theme={termTheme}
					onDismiss={() => setShowScrollback(false)}
				/>
			)}
			<div ref={ref} className="h-full w-full p-2" />
		</div>
	);
}
