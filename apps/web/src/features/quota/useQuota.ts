import { useEffect, useCallback } from "react";
import { api } from "../../shared/lib/api";
import { useAppStore, type QuotaData } from "../../shared/stores/app-store";
import { wsClient, type WsEnvelope } from "../../shared/lib/ws";

export function useQuota() {
  const quotaData = useAppStore((s) => s.quotaData);
  const setQuotaData = useAppStore((s) => s.setQuotaData);

  const fetchLocalUsage = useCallback(async () => {
    try {
      const data = await api.get<QuotaData[]>("/quota/local");
      setQuotaData(data);
    } catch {
      // Best-effort
    }
  }, [setQuotaData]);

  // Listen for quota updates via WebSocket
  useEffect(() => {
    return wsClient.on("quota:update", (envelope: WsEnvelope) => {
      const usage = envelope.payload.usage as QuotaData;
      setQuotaData([
        usage,
        ...quotaData.filter((q) => q.session_id !== usage.session_id),
      ]);
    });
  }, [quotaData, setQuotaData]);

  // Fetch on mount
  useEffect(() => {
    fetchLocalUsage();
  }, [fetchLocalUsage]);

  const totalTokensIn = quotaData.reduce((sum, q) => sum + q.tokens_in, 0);
  const totalTokensOut = quotaData.reduce((sum, q) => sum + q.tokens_out, 0);
  const totalCost = quotaData.reduce(
    (sum, q) => sum + (q.cost_usd ?? 0),
    0,
  );

  return {
    quotaData,
    totalTokensIn,
    totalTokensOut,
    totalCost,
    refresh: fetchLocalUsage,
  };
}
