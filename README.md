# Loopwire

A platform for controlling coding agents (Claude Code, Codex) on your machine. Split-pane IDE with terminal, editor, file tree, and quota tracking — all driven by a local daemon.

## Architecture

```
┌────────────────────────────────────────────────────┐
│  Frontend (React + Vite + Bun)                     │
│  localhost:5173                                    │
│                                                    │
│  ┌───────────┬───────────────┬──────────────────┐  │
│  │ File      │ Code Editor   │ Terminal (PTY)   │  │
│  │ Tree      │ (CodeMirror)  │ (xterm.js)       │  │
│  │           │               │                  │  │
│  │           │               │ Quota Panel      │  │
│  └───────────┴───────────────┴──────────────────┘  │
└──────────────────────┬─────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────▼─────────────────────────────┐
│  Daemon — loopwired (Rust)                         │
│  localhost:9400                                    │
│                                                    │
│  ┌───────┬──────────┬────────┬───────┬──────────┐  │
│  │ Auth  │  Agents  │  PTY   │  FS   │  Quota   │  │
│  │       │  Runner  │  Mgmt  │  Ops  │ Tracker  │  │
│  └───────┴──────────┴────────┴───────┴──────────┘  │
└────────────────────────────────────────────────────┘
```

**Daemon** binds to `127.0.0.1` only. On start it generates a one-time bootstrap token and prints a URL. The frontend auto-extracts the token, exchanges it for a session token, and removes it from the URL. All subsequent calls require bearer auth.

## Quick Start

```bash
# Start the daemon
cd apps/daemon
cargo run --release -- start

# The daemon prints a URL like:
#   http://localhost:5173/?token=abc123...

# In another terminal, start the frontend
cd apps/web
bun install
bun run dev

# Open the printed URL in your browser
```

## Project Structure

```
loopwire/
├── .moon/                    # Moonrepo workspace config
├── apps/
│   ├── web/                  # React + Vite + Bun frontend
│   │   └── src/
│   │       ├── features/     # auth, workspace, agent, terminal, editor, quota, ide
│   │       └── shared/       # ui primitives, hooks, stores, lib
│   └── daemon/               # Rust daemon (Cargo workspace)
│       └── crates/
│           ├── loopwired/    # CLI binary (clap)
│           ├── lw-api/       # HTTP + WS server (axum)
│           ├── lw-pty/       # PTY management (portable-pty)
│           ├── lw-agent/     # Agent runners (Claude Code, Codex)
│           ├── lw-quota/     # Quota tracking (SQLite + provider APIs)
│           ├── lw-fs/        # Filesystem ops with security enforcement
│           └── lw-config/    # Config loading (~/.loopwire/config.toml)
├── packages/
│   └── types/                # Shared TypeScript types (generated from backend)
└── scripts/
    ├── install.sh            # Binary installer with checksum verification
    └── generate-types.sh     # Backend schema → TypeScript codegen
```

## Daemon CLI

```bash
loopwired start [--port 9400]   # Start daemon, print auth URL
loopwired status                # Check if running, show version/uptime
loopwired stop                  # Graceful shutdown
loopwired token                 # Generate a new bootstrap token
loopwired version               # Print version
```

## REST API

All endpoints under `/api/v1`. Protected routes require `Authorization: Bearer <token>`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/bootstrap` | No | Session metadata |
| POST | `/auth/exchange` | No | Bootstrap token → session token |
| POST | `/auth/rotate` | Yes | Rotate session token |
| POST | `/auth/revoke` | Yes | Logout |
| GET | `/health` | No | Daemon status + version |
| GET | `/fs/roots` | Yes | Suggested workspace directories |
| GET | `/fs/list` | Yes | List directory contents |
| GET | `/fs/read` | Yes | Read file |
| GET | `/agents/available` | Yes | List installed agents |
| GET | `/agents/sessions` | Yes | List running sessions |
| POST | `/agents/sessions` | Yes | Start agent session |
| GET | `/agents/sessions/{id}` | Yes | Session details |
| POST | `/agents/sessions/{id}/stop` | Yes | Stop session (idempotent) |
| POST | `/agents/sessions/{id}/resize` | Yes | Resize PTY |
| POST | `/agents/sessions/{id}/input` | Yes | Send PTY input (REST fallback) |
| GET | `/quota/local` | Yes | Local usage stats |
| GET | `/quota/provider` | Yes | Provider API usage |

## WebSocket Protocol

Connect to `/api/v1/ws?token=<session_token>`. Messages use a versioned envelope:

```json
{
  "version": 1,
  "request_id": "uuid-or-null",
  "type": "pty:input",
  "payload": { "session_id": "...", "data": "..." },
  "error": null
}
```

**Client → Server:** `pty:subscribe`, `pty:input`, `pty:resize`, `pty:unsubscribe`, `fs:watch`, `fs:unwatch`

**Server → Client:** `pty:subscribed`, `pty:output`, `pty:exit`, `fs:change`, `quota:update`, `error`

## Security

- Daemon binds to `127.0.0.1` only — not exposed to the network
- Bootstrap tokens are single-use; session tokens are stored hashed (SHA-256)
- All filesystem operations are scoped to registered workspaces
- Path traversal (`..`) rejected at the API layer
- Symlinks that escape the workspace boundary are blocked
- CORS restricted to the configured frontend origin

## Configuration

Optional config at `~/.loopwire/config.toml`:

```toml
host = "127.0.0.1"
port = 9400
frontend_url = "http://localhost:5173"
allowed_origins = []

[quota]
anthropic_api_key = "sk-ant-..."
openai_api_key = "sk-..."
```

## Development

### Prerequisites

- [Rust 1.84+](https://rustup.rs/)
- [Bun 1.1+](https://bun.sh/)
- [moon](https://moonrepo.dev/) (optional, for task orchestration)

### Building

```bash
# Backend
cd apps/daemon && cargo build

# Frontend
cd apps/web && bun install && bun run build

# With moon (from repo root)
moon run daemon:build
moon run web:build
```

### Moon Commands

All tasks can be run from the repo root via [moon](https://moonrepo.dev/). Use `moon run <project>:<task>`.

#### Inherited tasks (available on all matching projects)

| Command | Bun/TS projects | Rust projects |
|---------|-----------------|---------------|
| `moon run <project>:typecheck` | `tsc --noEmit` | — |
| `moon run <project>:lint` | `biome check .` | `cargo clippy --workspace -- -D warnings` |
| `moon run <project>:check` | — | `cargo check --workspace` |
| `moon run <project>:build` | — | `cargo build --workspace` |
| `moon run <project>:build-release` | — | `cargo build --workspace --release` |
| `moon run <project>:test` | — | `cargo test --workspace` |
| `moon run <project>:format` | — | `cargo fmt --all -- --check` |

#### Per-project tasks

| Command | Description |
|---------|-------------|
| `moon run web:dev` | Start Vite dev server |
| `moon run web:build` | Production build (`vite build`) |
| `moon run web:preview` | Preview production build |
| `moon run types:build` | Compile types package (`tsc --build`) |
| `moon run types:generate` | Regenerate TS types from backend schema |

#### Running across all projects

```bash
moon run :typecheck       # Typecheck every TS project
moon run :lint            # Lint everything (Biome + Clippy)
moon run :build           # Build all projects
moon run :test            # Test all projects
```

#### Project names

| Name | Path |
|------|------|
| `web` | `apps/web` |
| `daemon` | `apps/daemon` |
| `types` | `packages/types` |

## License

MIT
