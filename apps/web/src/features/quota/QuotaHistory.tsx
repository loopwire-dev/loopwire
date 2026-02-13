import { useQuota } from "./useQuota";

export function QuotaHistory() {
  const { quotaData } = useQuota();

  if (quotaData.length === 0) {
    return (
      <div className="p-4 text-sm text-muted text-center">
        No usage data yet
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2 overflow-y-auto">
      <h3 className="text-sm font-medium mb-2">Usage History</h3>
      {quotaData.map((entry) => (
        <div
          key={entry.session_id}
          className="p-3 rounded-lg border border-border text-sm"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-xs truncate max-w-[60%]">
              {entry.session_id}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                entry.source_confidence === "authoritative"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
              }`}
            >
              {entry.source_confidence}
            </span>
          </div>
          <div className="flex gap-4 text-xs text-muted">
            <span>{entry.agent_type}</span>
            <span>In: {entry.tokens_in}</span>
            <span>Out: {entry.tokens_out}</span>
            {entry.cost_usd != null && (
              <span>${entry.cost_usd.toFixed(4)}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
