use crate::tracker::{QuotaData, SourceConfidence};
use serde::Deserialize;

pub struct ProviderClient {
    http: reqwest::Client,
    anthropic_api_key: Option<String>,
    openai_api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicUsageResponse {
    #[serde(default)]
    usage: Vec<AnthropicUsageEntry>,
}

#[derive(Debug, Deserialize)]
struct AnthropicUsageEntry {
    #[serde(default)]
    input_tokens: i64,
    #[serde(default)]
    output_tokens: i64,
    #[serde(default)]
    cost_usd: Option<f64>,
}

impl ProviderClient {
    pub fn new(anthropic_api_key: Option<String>, openai_api_key: Option<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            anthropic_api_key,
            openai_api_key,
        }
    }

    pub async fn get_anthropic_usage(
        &self,
        _agent_type: &str,
    ) -> anyhow::Result<Option<QuotaData>> {
        let api_key = match &self.anthropic_api_key {
            Some(k) => k,
            None => return Ok(None),
        };

        // Anthropic usage API — this is a best-effort query
        let resp = self
            .http
            .get("https://api.anthropic.com/v1/usage")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await?;

        if !resp.status().is_success() {
            tracing::warn!("Anthropic usage API returned {}", resp.status());
            return Ok(None);
        }

        let data: AnthropicUsageResponse = resp.json().await?;
        let total_in: i64 = data.usage.iter().map(|u| u.input_tokens).sum();
        let total_out: i64 = data.usage.iter().map(|u| u.output_tokens).sum();
        let total_cost: Option<f64> = {
            let costs: Vec<f64> = data.usage.iter().filter_map(|u| u.cost_usd).collect();
            if costs.is_empty() {
                None
            } else {
                Some(costs.iter().sum())
            }
        };

        Ok(Some(QuotaData {
            session_id: "provider".to_string(),
            agent_type: "claude_code".to_string(),
            tokens_in: total_in,
            tokens_out: total_out,
            cost_usd: total_cost,
            source: "anthropic_api".to_string(),
            source_confidence: SourceConfidence::Authoritative,
        }))
    }

    pub fn has_anthropic_key(&self) -> bool {
        self.anthropic_api_key.is_some()
    }

    pub fn has_openai_key(&self) -> bool {
        self.openai_api_key.is_some()
    }
}
