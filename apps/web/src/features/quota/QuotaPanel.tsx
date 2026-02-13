import { useQuota } from "./useQuota";

export function QuotaPanel() {
  const { totalTokensIn, totalTokensOut, totalCost, quotaData } = useQuota();

  const formatNumber = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString();

  return (
    <div className="border-t border-border bg-surface-raised px-3 py-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted">Usage</span>
        {quotaData.length > 0 && (
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] ${
              quotaData[0]?.source_confidence === "authoritative"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
            }`}
          >
            {quotaData[0]?.source_confidence ?? "estimated"}
          </span>
        )}
      </div>
      <div className="flex gap-4 mt-1 text-xs text-muted">
        <span>In: {formatNumber(totalTokensIn)}</span>
        <span>Out: {formatNumber(totalTokensOut)}</span>
        {totalCost > 0 && <span>${totalCost.toFixed(4)}</span>}
      </div>
    </div>
  );
}
