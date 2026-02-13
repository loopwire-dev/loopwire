interface AgentStatusProps {
  status: string;
  agentType: string;
}

function formatAgentName(agentType: string): string {
  const labels: Record<string, string> = {
    claude_code: "Claude Code",
    codex: "Codex",
    gemini: "Gemini",
  };
  return labels[agentType] ?? agentType;
}

export function AgentStatus({ status, agentType }: AgentStatusProps) {
  const statusColors: Record<string, string> = {
    running:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    starting:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    stopped:
      "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
    failed:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <div className="flex items-center gap-1.5 min-w-0 leading-none">
      <span className={`px-1.5 py-px rounded-full text-xs font-semibold tracking-[0.06em] uppercase ${statusColors[status] ?? statusColors.stopped}`}>
        {status}
      </span>
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate">
        {formatAgentName(agentType)}
      </span>
    </div>
  );
}
