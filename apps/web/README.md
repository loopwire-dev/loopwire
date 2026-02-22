# Web App (`apps/web`)

Loopwire frontend application.

## Purpose

- User-facing interface for workspaces, editor, terminal, and agent sessions.
- Connects to the local daemon over HTTP/WebSocket.

## Common commands

```bash
bun install
bun run dev
bun run build
bun run preview
```

## Quality

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run coverage
```

## Moon tasks

```bash
moon run web:dev
moon run web:build
moon run web:quality
moon run web:coverage
```
