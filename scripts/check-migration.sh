#!/usr/bin/env bash
# scripts/check-migration.sh
# Fails CI if latest migration has unguarded DROP statements.
# Override: add '-- healthtracker-migration-safe: drop' on the same line as the DROP.
set -euo pipefail

LATEST=$(ls -t packages/db/migrations/*.sql 2>/dev/null | head -1)
[ -z "$LATEST" ] && echo "No migrations found — skipping check" && exit 0

# Extract DROP lines. A DROP is safe if the override comment appears on the same line.
UNSAFE=$(grep -iE '(DROP TABLE|DROP COLUMN|ALTER TABLE[[:space:]]+[^;]+DROP)' "$LATEST" \
  | grep -iv '-- healthtracker-migration-safe: drop' || true)

if [ -n "$UNSAFE" ]; then
  echo "ERROR: Destructive statement in $LATEST without override comment:"
  echo "$UNSAFE"
  echo "Add '-- healthtracker-migration-safe: drop' at the end of the DROP line if intentional"
  exit 1
fi
echo "Migration safety check passed: $LATEST"
