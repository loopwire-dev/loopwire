#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCHEMA_DIR="$ROOT_DIR/apps/daemon/schema"
OUTPUT_DIR="$ROOT_DIR/packages/types/src/generated"

echo "Generating TypeScript types from backend schema..."

if [ ! -d "$SCHEMA_DIR" ]; then
  echo "Schema directory not found at $SCHEMA_DIR"
  echo "Run 'cargo run --bin loopwired -- schema export' first to generate schemas."
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# Generate types from JSON Schema files using json-schema-to-typescript
for schema in "$SCHEMA_DIR"/*.json; do
  if [ -f "$schema" ]; then
    name=$(basename "$schema" .json)
    echo "  Generating $name.ts"
    npx json-schema-to-typescript "$schema" > "$OUTPUT_DIR/$name.ts" 2>/dev/null || \
      echo "  Warning: Failed to generate $name.ts"
  fi
done

echo "Type generation complete. Output: $OUTPUT_DIR"
