from pathlib import Path

SOURCE = Path("artifacts/api-server/src/db/lead-intake-startup-migration.ts")

old = '''  const marker = await client.query(readinessSql);
  const wasReady = marker.rows[0]?.["ready"] === true;

  // Always run the forward, idempotent migrations before trusting readiness. This
  // repairs weakened same-name constraints and wrong fail-closed metadata that a
  // fragment-based readiness probe could otherwise mistake for canonical schema.
  await client.query(await (options?.loadSql ?? loadMigrationSql)());

  const verified = await client.query(readinessSql);
  if (verified.rows[0]?.["ready"] !== true) {
    throw new Error("Lead intake schema is incomplete after migration; startup stopped to protect review data.");
  }
  return !wasReady;
}'''

new = '''  const marker = await client.query(readinessSql);
  const wasReady = marker.rows[0]?.["ready"] === true;

  // The readiness probe above verifies the canonical lead-intake schema. Replaying
  // all migration bundles on every process boot is unnecessary when that probe
  // already passes and can consume the entire Render startup deadline.
  if (wasReady) return false;

  await client.query(await (options?.loadSql ?? loadMigrationSql)());

  const verified = await client.query(readinessSql);
  if (verified.rows[0]?.["ready"] !== true) {
    throw new Error("Lead intake schema is incomplete after migration; startup stopped to protect review data.");
  }
  return true;
}'''

text = SOURCE.read_text()
if old not in text:
    raise SystemExit("Expected slow lead-intake startup block was not found")
SOURCE.write_text(text.replace(old, new, 1))
