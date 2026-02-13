use crate::migrations;
use crate::tracker::{QuotaData, SourceConfidence};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct QuotaStore {
    conn: Mutex<Connection>,
}

impl QuotaStore {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn in_memory() -> anyhow::Result<Self> {
        let conn = Connection::open_in_memory()?;
        migrations::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn record_usage(
        &self,
        session_id: &str,
        agent_type: &str,
        tokens_in: i64,
        tokens_out: i64,
        cost_usd: Option<f64>,
        source: &str,
        source_confidence: &SourceConfidence,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO usage_records (session_id, agent_type, tokens_in, tokens_out, cost_usd, source, source_confidence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                session_id,
                agent_type,
                tokens_in,
                tokens_out,
                cost_usd,
                source,
                source_confidence.as_str(),
            ],
        )?;
        Ok(())
    }

    pub fn get_usage(&self, agent_type: Option<&str>) -> anyhow::Result<Vec<QuotaData>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = if let Some(at) = agent_type {
            let mut stmt = conn.prepare(
                "SELECT session_id, agent_type, SUM(tokens_in), SUM(tokens_out), SUM(cost_usd), source, source_confidence
                 FROM usage_records WHERE agent_type = ?1
                 GROUP BY session_id ORDER BY MAX(recorded_at) DESC",
            )?;
            let rows = stmt
                .query_map([at], |row| {
                    Ok(QuotaData {
                        session_id: row.get(0)?,
                        agent_type: row.get(1)?,
                        tokens_in: row.get(2)?,
                        tokens_out: row.get(3)?,
                        cost_usd: row.get(4)?,
                        source: row.get(5)?,
                        source_confidence: SourceConfidence::from_str(&row.get::<_, String>(6)?),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            return Ok(rows);
        } else {
            conn.prepare(
                "SELECT session_id, agent_type, SUM(tokens_in), SUM(tokens_out), SUM(cost_usd), source, source_confidence
                 FROM usage_records
                 GROUP BY session_id ORDER BY MAX(recorded_at) DESC",
            )?
        };
        let rows = stmt
            .query_map([], |row| {
                Ok(QuotaData {
                    session_id: row.get(0)?,
                    agent_type: row.get(1)?,
                    tokens_in: row.get(2)?,
                    tokens_out: row.get(3)?,
                    cost_usd: row.get(4)?,
                    source: row.get(5)?,
                    source_confidence: SourceConfidence::from_str(&row.get::<_, String>(6)?),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}
