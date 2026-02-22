# Daemon (`apps/daemon`)

Rust workspace for the local Loopwire daemon and core backend libraries.

## Purpose

- Runs the `loopwired` binary.
- Exposes local API + WebSocket services.
- Manages agent sessions, PTY, filesystem operations, and auth flow.

## Common commands

```bash
cargo run --bin loopwired -- start
cargo check --workspace
cargo test --workspace
cargo fmt --all -- --check
qlty check --all --filter=clippy --fail-level=low
```

## Coverage

```bash
cargo llvm-cov --workspace --lcov --output-path lcov.info --fail-under-lines 1
```

## Moon tasks

```bash
moon run daemon:dev
moon run daemon:quality
moon run daemon:coverage
```
