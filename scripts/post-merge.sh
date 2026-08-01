#!/bin/bash
set -e

pnpm install --frozen-lockfile

# Apply idempotent schema migrations before rebuilding declarations.
# Use IF NOT EXISTS / DO NOTHING guards so reruns are safe.
# drizzle-kit push is not used here because it may prompt for confirmation
# on destructive changes; targeted psql migrations are non-interactive.
if [ -n "${RENDER_DATABASE_URL}" ]; then
  DB_URL="${RENDER_DATABASE_URL}?sslmode=require"
elif [ -n "${DATABASE_URL}" ]; then
  DB_URL="${DATABASE_URL}"
fi

if [ -n "${DB_URL}" ]; then
  psql "${DB_URL}" -c "ALTER TABLE act_migration_apply_operations ADD COLUMN IF NOT EXISTS was_created boolean;"
fi

# Rebuild shared db declarations so both artifacts pick up schema changes.
pnpm --filter @workspace/db run build
