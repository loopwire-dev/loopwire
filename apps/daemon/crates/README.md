# Daemon Crates

Internal crates used by `loopwired`:

- `loopwired`: daemon binary + CLI entrypoints.
- `lw-api`: REST/WS routing and application state.
- `lw-agent`: agent process/session management.
- `lw-pty`: terminal/PTY lifecycle.
- `lw-fs`: filesystem access helpers and safety checks.
- `lw-config`: config loading and defaults.

Keep cross-crate interfaces explicit and versioned through workspace dependencies.
