import EmojiPicker, {
	Theme,
	SkinTonePickerLocation,
	SuggestionMode,
	type EmojiClickData,
} from "emoji-picker-react";
import { Upload } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import {
	isThemeMaskDisabled,
	withThemeMask,
} from "../../shared/lib/icon-masking";
import type { WorkspaceRoot } from "../../shared/stores/app-store";
import { Dialog } from "../../shared/ui/Dialog";
import { WorkspaceIcon } from "./WorkspaceIcon";

interface IconPickerDialogProps {
	workspace: WorkspaceRoot | null;
	onConfirm: (path: string, icon: string) => void;
	onClose: () => void;
}

function getCroppedImg(
	imageSrc: string,
	croppedAreaPixels: Area,
	size: number,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("Canvas context unavailable"));
				return;
			}
			ctx.beginPath();
			ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
			ctx.closePath();
			ctx.clip();
			ctx.drawImage(
				img,
				croppedAreaPixels.x,
				croppedAreaPixels.y,
				croppedAreaPixels.width,
				croppedAreaPixels.height,
				0,
				0,
				size,
				size,
			);
			resolve(canvas.toDataURL("image/png"));
		};
		img.onerror = () => reject(new Error("Failed to load image"));
		img.src = imageSrc;
	});
}

export function IconPickerDialog({
	workspace,
	onConfirm,
	onClose,
}: IconPickerDialogProps) {
	const [iconDraft, setIconDraft] = useState("");
	const [iconBounceKey, setIconBounceKey] = useState(0);
	const { resolvedTheme } = useTheme();
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Crop state
	const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
	const [crop, setCrop] = useState({ x: 0, y: 0 });
	const [zoom, setZoom] = useState(1);
	const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
	const [useThemeMask, setUseThemeMask] = useState(true);
	const resetCropState = useCallback(() => {
		setCropImageSrc(null);
		setCrop({ x: 0, y: 0 });
		setZoom(1);
		setCroppedAreaPixels(null);
	}, []);

	useEffect(() => {
		if (!workspace) {
			resetCropState();
			return;
		}
		setIconDraft(workspace.icon ?? "");
		setUseThemeMask(!isThemeMaskDisabled(workspace.icon ?? null));
		resetCropState();
	}, [workspace, resetCropState]);

	const handleOpen = (open: boolean) => {
		if (!open) {
			resetCropState();
			onClose();
		}
	};

	const handleEmojiClick = (emojiData: EmojiClickData) => {
		setIconDraft(emojiData.emoji);
		setIconBounceKey((k) => k + 1);
	};

	const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
		setCroppedAreaPixels(areaPixels);
	}, []);

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			setCropImageSrc(reader.result as string);
			setCrop({ x: 0, y: 0 });
			setZoom(1);
			setCroppedAreaPixels(null);
		};
		reader.readAsDataURL(file);
		event.target.value = "";
	};

	const handleCropApply = async () => {
		if (!cropImageSrc || !croppedAreaPixels) return;
		try {
			const cropped = await getCroppedImg(cropImageSrc, croppedAreaPixels, 64);
			setIconDraft(withThemeMask(cropped, useThemeMask));
			setIconBounceKey((k) => k + 1);
			setCropImageSrc(null);
		} catch {
			// ignore
		}
	};

	const handleCropCancel = () => {
		resetCropState();
	};

	const cropperImageFilter =
		resolvedTheme === "dark"
			? "grayscale(1) contrast(1.25) invert(1) brightness(1.35)"
			: "grayscale(1) contrast(1.25) brightness(0.45)";

	return (
		<Dialog
			open={Boolean(workspace)}
			onOpenChange={handleOpen}
			title="Set Workspace Icon"
		>
			{workspace ? (
				<div className="space-y-5">
					{/* Preview */}
					<div className="rounded-lg border border-border px-2.5 pt-2 pb-2.5">
						<p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted">
							Preview
						</p>
						<div className="relative h-9 w-full flex items-center gap-2 rounded-lg px-[12.5px] text-sm">
							<span
								aria-hidden="true"
								className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-black/[0.04] bg-white/55 shadow-sm backdrop-blur-2xl backdrop-saturate-200 dark:ring-white/[0.08] dark:bg-surface-raised dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
							/>
							<span
								key={iconBounceKey}
								className={`relative inline-flex h-4 w-4 shrink-0 items-center justify-center leading-none ${iconDraft ? "animate-icon-pop" : ""}`}
							>
								<WorkspaceIcon
									icon={iconDraft || null}
									emojiClassName="inline-flex h-4 w-4 items-center justify-center text-[15px] leading-none align-middle"
									imageClassName="h-4 w-4"
								/>
							</span>
							<span className="relative truncate flex-1 min-w-0 whitespace-nowrap font-medium">
								{workspace.name}
							</span>
						</div>
					</div>

					{/* Crop UI */}
					{cropImageSrc && (
						<div className="space-y-3">
							<div className="relative h-56 w-full rounded-lg overflow-hidden bg-black/80">
								<Cropper
									image={cropImageSrc}
									crop={crop}
									zoom={zoom}
									aspect={1}
									cropShape="round"
									showGrid={false}
									style={
										useThemeMask
											? {
													mediaStyle: { filter: cropperImageFilter },
												}
											: undefined
									}
									onCropChange={setCrop}
									onZoomChange={setZoom}
									onCropComplete={onCropComplete}
								/>
							</div>
							<label className="inline-flex items-center gap-2 text-xs text-muted">
								<input
									type="checkbox"
									checked={useThemeMask}
									onChange={(event) => setUseThemeMask(event.target.checked)}
								/>
								Apply theme mask
							</label>
							<div className="flex items-center gap-3">
								<span className="text-xs text-muted shrink-0">Zoom</span>
								<input
									type="range"
									min={1}
									max={3}
									step={0.05}
									value={zoom}
									onChange={(e) => setZoom(Number(e.target.value))}
									className="flex-1"
								/>
							</div>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => void handleCropApply()}
									className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm text-white hover:bg-accent-hover"
								>
									Apply
								</button>
								<button
									type="button"
									onClick={handleCropCancel}
									className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-raised"
								>
									Cancel
								</button>
							</div>
						</div>
					)}

					{/* Emoji picker */}
					{!cropImageSrc && (
						<EmojiPicker
							onEmojiClick={handleEmojiClick}
							theme={resolvedTheme === "dark" ? Theme.DARK : Theme.LIGHT}
							skinTonePickerLocation={SkinTonePickerLocation.SEARCH}
							width="100%"
							previewConfig={{ showPreview: false }}
							suggestedEmojisMode={SuggestionMode.RECENT}
							lazyLoadEmojis
						/>
					)}

					{/* Actions — hidden during crop */}
					{!cropImageSrc && (
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => setIconDraft("")}
									className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-raised"
								>
									Clear
								</button>
								<input
									ref={fileInputRef}
									type="file"
									accept="image/*"
									className="hidden"
									onChange={handleFileChange}
								/>
								<button
									type="button"
									onClick={() => fileInputRef.current?.click()}
									className="inline-flex items-center gap-2 h-8 rounded-md border border-border px-3 text-sm hover:bg-surface-raised transition-colors"
								>
									<Upload size={14} />
									Upload Image
								</button>
							</div>
							<button
								type="button"
								onClick={() => onConfirm(workspace.path, iconDraft)}
								className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm text-white hover:bg-accent-hover"
							>
								Confirm
							</button>
						</div>
					)}
				</div>
			) : null}
		</Dialog>
	);
}
