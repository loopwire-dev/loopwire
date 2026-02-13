use rusqlite::Connection;

struct Migration {
    version: u32,
    up_sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    up_sql: r#"
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS usage_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                tokens_in INTEGER NOT NULL DEFAULT 0,
                tokens_out INTEGER NOT NULL DEFAULT 0,
                cost_usd REAL,
                source TEXT NOT NULL DEFAULT 'local',
                source_confidence TEXT NOT NULL DEFAULT 'estimated',
                recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(session_id, recorded_at)
            );
            CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_records(session_id);
            CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_records(agent_type);
            CREATE INDEX IF NOT EXISTS idx_usage_recorded ON usage_records(recorded_at);
        "#,
}];

pub fn run_migrations(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);")?;

    let current_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for migration in MIGRATIONS {
        if migration.version > current_version {
            tracing::info!("Running migration v{}", migration.version);
            conn.execute_batch(migration.up_sql)?;
            conn.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                [migration.version],
            )?;
        }
    }

    Ok(())
}
