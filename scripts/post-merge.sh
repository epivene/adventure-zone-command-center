#!/bin/bash
set -e

pnpm install --frozen-lockfile

# Rebuild shared db declarations so both artifacts pick up schema changes.
# Schema migrations must be applied deliberately via drizzle-kit push (not here)
# because drizzle may prompt for confirmation in destructive cases.
pnpm --filter @workspace/db run build
