import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/test"; });
import { buildBusinessDocumentReconciliation } from "./business-document-reconciliation";

describe("business document reconciliation", () => {
  it("accounts for every discovered import item", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: "run-1", source_kind: "gmail", mode: "pilot", status: "completed", discovered: 10, imported: 3, deduplicated: 2, review: 2, skipped: 2, retry: 0, failed: 1, linked: 4, error_codes: ["GMAIL_IMPORT_FAILED"] }] }) };
    const report = await buildBusinessDocumentReconciliation("run-1", pool as any);
    expect(report.discovered).toBe(report.imported + report.deduplicated + report.review + report.skipped + report.retry + report.failed);
    expect(report.reconciled).toBe(true);
  });

  it("fails reconciliation when an item remains only discovered", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: "run-1", source_kind: "drive", mode: "pilot", status: "completed", discovered: 3, imported: 1, deduplicated: 0, review: 0, skipped: 1, retry: 0, failed: 0, linked: 0, error_codes: [] }] }) };
    await expect(buildBusinessDocumentReconciliation("run-1", pool as any)).resolves.toMatchObject({ reconciled: false, unaccounted: 1 });
  });
});
