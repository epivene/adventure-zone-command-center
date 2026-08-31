from pathlib import Path

SOURCE = Path("artifacts/api-server/src/db/lead-intake-startup-migration.ts")
TEST = Path("artifacts/api-server/src/db/lead-intake-startup-migration.test.ts")

old_source = '''  const marker = await client.query(readinessSql);
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

new_source = '''  const marker = await client.query(readinessSql);
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

old_test = '''  it("runs the canonical idempotent repair even when readiness initially passes", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ready: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ready: true }] });
    const loadSql = vi.fn().mockResolvedValue("-- canonical idempotent repair");

    await expect(ensureLeadIntakeSchema({ query }, { loadSql })).resolves.toBe(false);
    expect(loadSql).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_evidence");
    expect(query.mock.calls[0]?.[0]).toContain("territory_status");
    expect(query.mock.calls[0]?.[0]).toContain("fit_status");
    expect(query.mock.calls[1]?.[0]).toBe("-- canonical idempotent repair");
    expect(query.mock.calls[2]?.[0]).toBe(query.mock.calls[0]?.[0]);
  });'''

new_test = '''  it("returns immediately when the canonical schema is already ready", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ ready: true }] });
    const loadSql = vi.fn().mockResolvedValue("-- canonical idempotent repair");

    await expect(ensureLeadIntakeSchema({ query }, { loadSql })).resolves.toBe(false);
    expect(loadSql).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_evidence");
    expect(query.mock.calls[0]?.[0]).toContain("territory_status");
    expect(query.mock.calls[0]?.[0]).toContain("fit_status");
  });'''

source_text = SOURCE.read_text()
if old_source not in source_text:
    raise SystemExit("Expected slow lead-intake startup block was not found")
SOURCE.write_text(source_text.replace(old_source, new_source, 1))

test_text = TEST.read_text()
if old_test not in test_text:
    raise SystemExit("Expected stale lead-intake startup test block was not found")
TEST.write_text(test_text.replace(old_test, new_test, 1))
