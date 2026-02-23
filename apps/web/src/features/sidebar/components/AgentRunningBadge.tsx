import { Bot } from "lucide-react";
import { getAgentIcon } from "../../agent/lib/agentIcons";

export function AgentRunningBadge({
	count,
	agentType,
	showCount = true,
}: {
	count: number;
	agentType?: string | null;
	showCount?: boolean;
}) {
	if (count <= 0) return null;
	const iconSrc =
		typeof agentType === "string" ? getAgentIcon(agentType) : null;
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium leading-none text-muted">
			{iconSrc ? (
				<img src={iconSrc} alt="" aria-hidden="true" className="h-3 w-3" />
			) : (
				<Bot aria-hidden="true" size={12} />
			)}
			{showCount ? count : null}
		</span>
	);
}
