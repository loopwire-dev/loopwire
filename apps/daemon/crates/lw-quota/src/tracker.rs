use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaData {
    pub session_id: String,
    pub agent_type: String,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_usd: Option<f64>,
    pub source: String,
    pub source_confidence: SourceConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SourceConfidence {
    Authoritative,
    Estimated,
}

impl SourceConfidence {
    pub fn as_str(&self) -> &str {
        match self {
            SourceConfidence::Authoritative => "authoritative",
            SourceConfidence::Estimated => "estimated",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "authoritative" => SourceConfidence::Authoritative,
            _ => SourceConfidence::Estimated,
        }
    }
}

pub struct QuotaTracker {
    store: std::sync::Arc<crate::store::QuotaStore>,
}

impl QuotaTracker {
    pub fn new(store: std::sync::Arc<crate::store::QuotaStore>) -> Self {
        Self { store }
    }

    pub fn record(
        &self,
        session_id: &str,
        agent_type: &str,
        tokens_in: i64,
        tokens_out: i64,
        cost_usd: Option<f64>,
        source: &str,
        confidence: &SourceConfidence,
    ) -> anyhow::Result<()> {
        self.store.record_usage(
            session_id, agent_type, tokens_in, tokens_out, cost_usd, source, confidence,
        )
    }

    pub fn get_local_usage(&self, agent_type: Option<&str>) -> anyhow::Result<Vec<QuotaData>> {
        self.store.get_usage(agent_type)
    }
}
