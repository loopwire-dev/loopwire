import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";

interface SlideDeleteButtonProps {
	onDelete: () => void;
}

const TRACK_PADDING = 4;
const CONFIRM_THRESHOLD = 0.9;
const KNOB_WIDTH = 70;
const LABEL_SLOT_WIDTH = KNOB_WIDTH;

export function SlideDeleteButton({ onDelete }: SlideDeleteButtonProps) {
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [dragOffset, setDragOffset] = useState(0);
	const [dragging, setDragging] = useState(false);
	const trackRef = useRef<HTMLDivElement>(null);
	const knobRef = useRef<HTMLButtonElement>(null);
	const pointerIdRef = useRef<number | null>(null);
	const dragOffsetRef = useRef(0);
	const dragStartXRef = useRef(0);
	const dragStartOffsetRef = useRef(0);

	const setDragValue = (value: number) => {
		dragOffsetRef.current = value;
		setDragOffset(value);
	};

	const getMaxDrag = () => {
		const trackWidth = trackRef.current?.clientWidth ?? 0;
		const knobWidth = knobRef.current?.offsetWidth ?? 28;
		return Math.max(0, trackWidth - knobWidth - TRACK_PADDING * 2);
	};

	const finishDrag = () => {
		setDragging(false);
		const maxDrag = getMaxDrag();
		if (maxDrag <= 0) {
			setDragValue(0);
			return;
		}
		if (dragOffsetRef.current >= maxDrag * CONFIRM_THRESHOLD) {
			onDelete();
			return;
		}
		setDragValue(0);
	};

	return (
		<div className="relative h-9 w-full overflow-hidden rounded-md">
			<div
				className={`flex h-full w-[200%] transition-transform duration-200 ease-out ${
					confirmingDelete ? "-translate-x-1/2" : "translate-x-0"
				}`}
			>
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						setConfirmingDelete(true);
						setDragValue(0);
					}}
					className="inline-flex w-1/2 items-center gap-2 px-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors whitespace-nowrap"
				>
					<Trash2 aria-hidden="true" size={14} />
					Delete
				</button>
				<div className="flex h-full w-1/2 px-1">
					<div
						ref={trackRef}
						className="relative h-full w-full rounded-md border border-red-200/80 dark:border-red-900/40 bg-red-50/70 dark:bg-red-900/20 overflow-hidden"
					>
						<span
							className="pointer-events-none absolute inset-y-1 right-1 inline-flex items-center justify-center rounded-md bg-red-100/90 dark:bg-red-900/35 text-[9px] font-medium text-red-700 dark:text-red-300 whitespace-nowrap"
							style={{ width: LABEL_SLOT_WIDTH }}
						>
							Slide to delete
						</span>
						<button
							ref={knobRef}
							type="button"
							onClick={(event) => event.preventDefault()}
							onPointerDown={(event) => {
								event.stopPropagation();
								pointerIdRef.current = event.pointerId;
								dragStartXRef.current = event.clientX;
								dragStartOffsetRef.current = dragOffsetRef.current;
								setDragging(true);
								event.currentTarget.setPointerCapture(event.pointerId);
							}}
							onPointerMove={(event) => {
								if (!dragging || pointerIdRef.current !== event.pointerId) return;
								event.stopPropagation();
								const delta = event.clientX - dragStartXRef.current;
								const next = Math.min(
									Math.max(0, dragStartOffsetRef.current + delta),
									getMaxDrag(),
								);
								setDragValue(next);
							}}
							onPointerUp={(event) => {
								if (pointerIdRef.current !== event.pointerId) return;
								event.stopPropagation();
								pointerIdRef.current = null;
								finishDrag();
							}}
								onPointerCancel={(event) => {
									if (pointerIdRef.current !== event.pointerId) return;
									event.stopPropagation();
									pointerIdRef.current = null;
									setDragging(false);
									setDragValue(0);
								}}
								className={`absolute inset-y-1 left-1 inline-flex items-center justify-center rounded-md bg-white dark:bg-zinc-800 text-red-600 shadow-sm touch-none select-none ${
									dragging ? "cursor-grabbing" : "cursor-grab"
								}`}
								aria-label="Slide to delete"
								style={{
									transform: `translateX(${dragOffset}px)`,
									width: KNOB_WIDTH,
								}}
							>
							<Trash2 aria-hidden="true" size={13} />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
