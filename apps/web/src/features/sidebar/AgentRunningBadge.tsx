import { Bot } from "lucide-react";

export function AgentRunningBadge({ count }: { count: number }) {
	if (count <= 0) return null;
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium leading-none text-muted">
			<Bot aria-hidden="true" size={12} />
			{count}
		</span>
	);
}
