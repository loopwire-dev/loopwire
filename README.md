# Loopwire – *Agents write the code. You own the loop.*

<p align="center">
  <img src="brand-assets/social/og-image-1200x630.png" alt="Loopwire cover" width="760" />
</p>

[![Docs Coverage](https://github.com/loopwire-dev/loopwire/actions/workflows/docs-coverage.yml/badge.svg)](https://github.com/loopwire-dev/loopwire/actions/workflows/docs-coverage.yml)
[![Tests Coverage](https://codecov.io/gh/loopwire-dev/loopwire/branch/main/graph/badge.svg)](https://codecov.io/gh/loopwire-dev/loopwire)
[![Web Deploy](https://github.com/loopwire-dev/loopwire/actions/workflows/deploy.yml/badge.svg)](https://github.com/loopwire-dev/loopwire/actions/workflows/deploy.yml)
[![Daemon Release](https://github.com/loopwire-dev/loopwire/actions/workflows/release.yml/badge.svg)](https://github.com/loopwire-dev/loopwire/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Loopwire is a desktop-like platform that helps you run, observe, and steer coding agents from one place.
Instead of juggling terminals, editor tabs, and agent sessions manually, Loopwire gives you a single workflow to keep work organized and under control.

Official website: https://loopwire.dev

## What Is Loopwire?

Loopwire is where you:

- Start and manage coding-agent sessions.
- Work on your files with an integrated editor and terminal.
- Keep visibility on what agents are doing in real time.
- Stay in control of your local project context.

It is built for people who want practical agent-assisted coding without giving up oversight.

## Why Use Loopwire

- Simpler workflow: one interface instead of scattered tools.
- More control: you decide when to start, stop, and review agent activity.
- Local-first mindset: your day-to-day development context stays on your machine.
- Open source: transparent behavior, inspectable code, community-driven improvements.

## Quick Start

### 1. Install Loopwire

```bash
curl -fsSL https://loopwire.dev/install.sh | sh
```

This installs Loopwire and starts the local daemon automatically.
On macOS and Linux, it also registers daemon auto-start and daily auto-update.

### 2. Open Loopwire in your browser

Go to https://loopwire.dev.

### 3. Find your machine

Use **Scan for machine** to discover your local Loopwire daemon.

### 4. Connect a workspace and begin

- Add or select a project folder.
- Open files in the editor.
- Start an agent session and iterate.

## Security Model

- Daemon listens on localhost by default.
- Bootstrap tokens are single-use.
- Session tokens protect authenticated routes.
- Filesystem access is restricted to registered workspaces.

## Development

This section is for contributors working from this repository.

### Prerequisites

- Rust `1.84+`
- Bun `1.1+`
- `cargo-llvm-cov` (for backend coverage): `cargo install cargo-llvm-cov --locked`
- moon (optional): https://moonrepo.dev/

### Bootstrap

From repo root:

```bash
bun install
```

### Run in development

Terminal 1 (daemon):

```bash
cd apps/daemon
cargo run -- start
```

Terminal 2 (web):

```bash
cd apps/web
bun run dev
```

### Build

```bash
# backend
cd apps/daemon && cargo build --workspace

# frontend
cd apps/web && bun run build
```

### Quality checks

```bash
# backend
cd apps/daemon
cargo check --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --all -- --check
cargo test --workspace
cargo llvm-cov --workspace --lcov --output-path lcov.info --fail-under-lines 1

# frontend
cd apps/web
bun run format:check
bun run typecheck
bun run lint
bun run test
bun run coverage
bun run quality
```

### Optional moon commands (repo root)

```bash
moon run daemon:build
moon run web:build
moon run web:quality
moon run web:coverage
moon run daemon:quality
moon run daemon:coverage
moon run root:git-add
moon run :lint
moon run :test
```

### Pre-commit hooks (prek)

Install `prek` and enable project hooks:

```bash
prek install --hook-type pre-commit --hook-type pre-push
```

Run the full hook suite manually:

```bash
prek run --all-files
prek run --hook-stage pre-push --all-files
```

The hook config lives at `.pre-commit-config.yaml` and includes formatting, linting, type checks, Rust checks, and pre-push tests.
Formatting hooks run in auto-fix mode before checks (`Biome format` and `cargo fmt`).

### Git shortcuts (format before add)

Use these moon tasks to format then stage changes:

```bash
moon run root:git-add
```

The task composes existing moon tasks (`types:generate`, `web:format`, `daemon:format`) and then stages the entire repository (`git add -A .`).

## Contributing

1. Open an issue.
2. Create a focused branch.
3. Submit a PR using the template.
4. Ensure CI passes before review.

## License

MIT
