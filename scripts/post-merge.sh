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

DB_SCHEMA_READY=false
if [ -n "${DB_URL}" ]; then
  if [ "$(psql "${DB_URL}" -Atqc "SELECT to_regclass('public.organizations') IS NOT NULL;")" = "t" ]; then
    DB_SCHEMA_READY=true
    psql "${DB_URL}" -c "ALTER TABLE IF EXISTS act_migration_apply_operations ADD COLUMN IF NOT EXISTS was_created boolean;"
  else
    echo "post-merge: database schema is not initialized; skipping schema migrations"
  fi
fi

# Rebuild shared db declarations so both artifacts pick up schema changes.
pnpm --filter @workspace/db run build

# Apply any pending custom-DDL migrations (lib/db/migrations/*.sql).
# These cover schema changes drizzle-kit push cannot express, such as deferrable
# constraints. The runner is idempotent and skips gracefully when DATABASE_URL
# is not configured (code-only environments).
if [ "${DB_SCHEMA_READY}" = true ]; then
  pnpm --filter @workspace/db run run-migrations
fi
