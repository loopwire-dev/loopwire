import { Square } from "lucide-react";
import type { WorkspaceSession } from "../../shared/stores/app-store";
import { AgentStatus } from "./AgentStatus";
import { useAgent } from "./useAgent";

interface AgentToolbarProps {
	session: WorkspaceSession;
}

export function AgentToolbar({ session }: AgentToolbarProps) {
	const { stopSession } = useAgent();

	const stopAgent = async () => {
		try {
			await stopSession(session.sessionId);
		} catch {
			// Best effort
		}
	};

	return (
		<div className="h-[26.5px] flex items-center justify-between px-2.5 border-b border-border bg-surface-raised shrink-0">
			<AgentStatus status={session.status} agentType={session.agentType} />
			<button
				type="button"
				onClick={stopAgent}
				className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-red-200/70 dark:border-red-900/40 text-xs font-medium leading-none text-red-500 hover:bg-red-50/60 dark:hover:bg-red-900/20 transition-colors"
			>
				<Square aria-hidden="true" size={10} />
				Stop
			</button>
		</div>
	);
}
