import { Activity, Circle, Hand, Keyboard, Loader2 } from "lucide-react";
import type { AgentActivityPhase } from "../../../shared/stores/app-store";

interface AgentActivityIconProps {
	phase?: AgentActivityPhase;
	className?: string;
}

function activityLabel(phase: AgentActivityPhase): string {
	switch (phase) {
		case "awaiting_user":
			return "Waiting for input";
		case "user_input":
			return "User typing";
		case "processing":
			return "Processing";
		case "streaming_output":
			return "Streaming output";
		default:
			return "Unknown state";
	}
}

export function AgentActivityIcon({
	phase = "unknown",
	className = "h-3.5 w-3.5",
}: AgentActivityIconProps) {
	const label = activityLabel(phase);

	switch (phase) {
		case "awaiting_user":
			return (
				<span aria-label={label} title={label}>
					<Hand size={14} className={`${className} text-amber-400`} />
				</span>
			);
		case "user_input":
			return (
				<span aria-label={label} title={label}>
					<Keyboard size={14} className={`${className} text-zinc-400`} />
				</span>
			);
		case "processing":
			return (
				<span aria-label={label} title={label}>
					<Loader2
						size={14}
						className={`${className} animate-spin text-amber-500`}
					/>
				</span>
			);
		case "streaming_output":
			return (
				<span aria-label={label} title={label}>
					<Activity size={14} className={`${className} text-sky-500`} />
				</span>
			);
		default:
			return (
				<span aria-label={label} title={label}>
					<Circle size={14} className={`${className} text-muted`} />
				</span>
			);
	}
}
