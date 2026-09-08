import { pool as defaultPool } from "@workspace/db";

type QueryPool = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
export type BusinessDocumentReconciliationReport = {
  runId: string;
  sourceKind: string;
  mode: string;
  status: string;
  discovered: number;
  imported: number;
  deduplicated: number;
  review: number;
  skipped: number;
  retry: number;
  failed: number;
  linked: number;
  unaccounted: number;
  reconciled: boolean;
  errorCodes: string[];
};

const count = (value: unknown) => Number(value ?? 0);
export async function buildBusinessDocumentReconciliation(
  runId: string,
  pool: QueryPool = defaultPool as unknown as QueryPool,
): Promise<BusinessDocumentReconciliationReport> {
  const result = await pool.query(
    `SELECT run.id, run.source_kind, run.mode, run.status,
       count(DISTINCT item.id)::int AS discovered,
       count(DISTINCT item.id) FILTER (WHERE item.status = 'imported')::int AS imported,
       count(DISTINCT item.id) FILTER (WHERE item.status = 'deduplicated')::int AS deduplicated,
       count(DISTINCT item.id) FILTER (WHERE item.status = 'review')::int AS review,
       count(DISTINCT item.id) FILTER (WHERE item.status = 'skipped')::int AS skipped,
       count(DISTINCT item.id) FILTER (WHERE item.status = 'retry')::int AS retry,
       count(DISTINCT item.id) FILTER (WHERE item.status = 'failed')::int AS failed,
       count(DISTINCT link.id)::int AS linked,
       array_remove(array_agg(DISTINCT CASE WHEN item.error_code ~ '^[A-Z][A-Z0-9_:-]{0,79}$' THEN item.error_code END), NULL) AS error_codes
     FROM business_document_import_runs run
     LEFT JOIN business_document_import_items item ON item.run_id = run.id
     LEFT JOIN business_document_links link ON link.document_id = item.document_id
     WHERE run.id = $1 GROUP BY run.id, run.source_kind, run.mode, run.status`,
    [runId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("BUSINESS_DOCUMENT_IMPORT_NOT_FOUND");
  const discovered = count(row.discovered);
  const imported = count(row.imported);
  const deduplicated = count(row.deduplicated);
  const review = count(row.review);
  const skipped = count(row.skipped);
  const retry = count(row.retry);
  const failed = count(row.failed);
  const unaccounted = discovered - imported - deduplicated - review - skipped - retry - failed;
  return {
    runId: String(row.id), sourceKind: String(row.source_kind), mode: String(row.mode), status: String(row.status),
    discovered, imported, deduplicated, review, skipped, retry, failed, linked: count(row.linked), unaccounted,
    reconciled: unaccounted === 0,
    errorCodes: Array.isArray(row.error_codes)
      ? row.error_codes.filter((value): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_:-]{0,79}$/.test(value))
      : [],
  };
}
