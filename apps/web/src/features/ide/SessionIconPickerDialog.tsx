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
	isDataImageUrl,
	isThemeMaskDisabled,
	stripMaskMetadata,
	withThemeMask,
} from "../../shared/lib/icon-masking";
import { Dialog } from "../../shared/ui/Dialog";

interface SessionIconPickerDialogProps {
	open: boolean;
	sessionLabel: string;
	currentIcon?: string | null;
	defaultIcon?: string | null;
	onConfirm: (icon: string | null) => void;
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

export function SessionIconPickerDialog({
	open,
	sessionLabel,
	currentIcon,
	defaultIcon,
	onConfirm,
	onClose,
}: SessionIconPickerDialogProps) {
	const [iconDraft, setIconDraft] = useState<string>(currentIcon ?? "");
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
		if (!open) {
			resetCropState();
			return;
		}
		setIconDraft(currentIcon ?? "");
		setUseThemeMask(!isThemeMaskDisabled(currentIcon ?? null));
		resetCropState();
	}, [open, currentIcon, resetCropState]);

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

	const isDataUrl = isDataImageUrl(iconDraft);
	const draftMaskDisabled = isThemeMaskDisabled(iconDraft);
	const displayIcon = isDataUrl ? stripMaskMetadata(iconDraft) : iconDraft;
	const cropperImageFilter =
		resolvedTheme === "dark"
			? "grayscale(1) contrast(1.25) invert(1) brightness(1.35)"
			: "grayscale(1) contrast(1.25) brightness(0.45)";

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) {
					resetCropState();
					onClose();
				}
			}}
			title="Set Agent Icon"
		>
			<div className="space-y-5">
				{/* Preview */}
				<div className="rounded-lg border border-border px-2.5 pt-2 pb-2.5">
					<p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted">
						Preview
					</p>
					<div className="relative w-full flex items-center gap-2 px-3 py-1.5 text-sm">
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-x-1 inset-y-0 rounded-md border border-border bg-surface-raised/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] opacity-100"
						/>
						<span
							key={iconBounceKey}
							className={`relative shrink-0 inline-flex items-center ${iconDraft ? "animate-icon-pop" : ""}`}
						>
							{isDataUrl ? (
								<img
									src={displayIcon}
									alt=""
									className={`h-3.5 w-3.5 rounded-full object-cover ${
										draftMaskDisabled
											? ""
											: "grayscale contrast-125 brightness-[0.45] dark:invert dark:brightness-[1.35]"
									}`}
								/>
							) : iconDraft ? (
								<span className="text-sm leading-none">{iconDraft}</span>
							) : defaultIcon ? (
								<img src={defaultIcon} alt="" className="h-3.5 w-3.5" />
							) : (
								<span className="h-3.5 w-3.5 rounded-full bg-muted/30 inline-block" />
							)}
						</span>
						<span className="relative truncate flex-1 min-w-0 font-medium">
							{sessionLabel}
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
							onClick={() => onConfirm(iconDraft || null)}
							className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm text-white hover:bg-accent-hover"
						>
							Confirm
						</button>
					</div>
				)}
			</div>
		</Dialog>
	);
}
