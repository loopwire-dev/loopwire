// Auto-generated from backend schema — do not edit manually

export type SourceConfidence = "authoritative" | "estimated";

export interface QuotaData {
  session_id: string;
  agent_type: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
  source: string;
  source_confidence: SourceConfidence;
}

export interface ProviderUsageResponse {
  data: QuotaData[];
  source: string;
  source_confidence: SourceConfidence;
  available: boolean;
  message?: string;
}
