# Types Package (`packages/types`)

Shared TypeScript types for Loopwire.

## Purpose

- Central source of API-related types consumed by the web app.
- Generated models live in `src/generated/`.

## Commands

```bash
bun run typecheck
bun run build
bun run generate
```

`generate` uses `scripts/generate-types.sh` and expects daemon JSON schemas in `apps/daemon/schema/`.
