import { pool as defaultPool } from "@workspace/db";
import { BusinessDocumentIngestion } from "./business-document-ingestion";
import { GoogleDriveDocumentSource } from "./google-drive-document-source";

type ImportCounts = { discovered: number; imported: number; deduplicated: number; linked: number; review: number; skipped: number; retry: number; failed: number };
export type BusinessDocumentImportRun = { id: string; status: string; mode: string; scope: Record<string, unknown>; counts: ImportCounts };
type Store = {
  create(input: { mode: "preview" | "pilot"; folderIds: string[]; actor: string }): Promise<string>;
  checkpoint(input: { runId: string; externalId: string; status: string; documentId?: string; errorCode?: string }): Promise<void>;
  finish(runId: string, counts: ImportCounts): Promise<void>;
  get(runId: string): Promise<BusinessDocumentImportRun | null>;
};
type Ingestion = Pick<BusinessDocumentIngestion, "ingest">;

function counts(discovered = 0): ImportCounts {
  return { discovered, imported: 0, deduplicated: 0, linked: 0, review: 0, skipped: 0, retry: 0, failed: 0 };
}

export class BusinessDocumentImportService {
  constructor(private readonly dependencies: {
    source: GoogleDriveDocumentSource;
    store: Store;
    ingestion: Ingestion;
    accountKey: string;
  }) {}

  async preview(folderIds: string[], actor: string) {
    const files = await this.dependencies.source.inventory(folderIds);
    const runId = await this.dependencies.store.create({ mode: "preview", folderIds, actor });
    for (const file of files) await this.dependencies.store.checkpoint({ runId, externalId: file.id, status: "discovered" });
    const report = counts(files.length);
    await this.dependencies.store.finish(runId, report);
    return { runId, folderIds, ...report };
  }

  async start(folderIds: string[], actor: string, pilotLimit = 25) {
    const files = (await this.dependencies.source.inventory(folderIds)).slice(0, Math.min(100, Math.max(1, pilotLimit)));
    const runId = await this.dependencies.store.create({ mode: "pilot", folderIds, actor });
    const report = counts(files.length);
    for (const file of files) {
      await this.dependencies.store.checkpoint({ runId, externalId: file.id, status: "discovered" });
      try {
        const candidate = await this.dependencies.source.candidate(file, this.dependencies.accountKey);
        const result = await this.dependencies.ingestion.ingest(candidate);
        if (result.outcome === "skipped") {
          report.skipped += 1;
          await this.dependencies.store.checkpoint({ runId, externalId: file.id, status: "skipped", errorCode: result.errorCode });
        } else {
          report[result.outcome] += 1;
          report.linked += result.linkedProfileIds.length + result.linkedBookingIds.length + result.linkedEventFamilyIds.length;
          if (result.reviewState === "needs_review") report.review += 1;
          await this.dependencies.store.checkpoint({ runId, externalId: file.id, status: result.outcome, documentId: result.documentId });
        }
      } catch (error) {
        report.retry += 1;
        await this.dependencies.store.checkpoint({ runId, externalId: file.id, status: "retry", errorCode: error instanceof Error ? error.message : "DRIVE_IMPORT_FAILED" });
      }
    }
    await this.dependencies.store.finish(runId, report);
    return { runId, folderIds, ...report };
  }

  async startApproved(previewRunId: string, actor: string, pilotLimit = 25) {
    const preview = await this.get(previewRunId);
    if (preview.mode !== "preview" || preview.status !== "completed") throw new Error("BUSINESS_DOCUMENT_PREVIEW_NOT_APPROVED");
    const folderIds = Array.isArray(preview.scope.folderIds)
      ? preview.scope.folderIds.filter((value): value is string => typeof value === "string")
      : [];
    if (!folderIds.length) throw new Error("BUSINESS_DOCUMENT_PREVIEW_NOT_APPROVED");
    return this.start(folderIds, actor, pilotLimit);
  }

  async get(runId: string) {
    const run = await this.dependencies.store.get(runId);
    if (!run) throw new Error("BUSINESS_DOCUMENT_IMPORT_NOT_FOUND");
    return run;
  }

  async retry(runId: string, actor: string) {
    const previous = await this.get(runId);
    const folderIds = Array.isArray(previous.scope.folderIds)
      ? previous.scope.folderIds.filter((value): value is string => typeof value === "string")
      : [];
    if (previous.mode !== "pilot" || !folderIds.length || !["completed", "completed_with_errors"].includes(previous.status)) {
      throw new Error("BUSINESS_DOCUMENT_IMPORT_RETRY_NOT_ALLOWED");
    }
    return this.start(folderIds, actor, 100);
  }
}

type QueryPool = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };

export class PostgresBusinessDocumentImportStore implements Store {
  constructor(private readonly pool: QueryPool = defaultPool as unknown as QueryPool) {}
  async create(input: { mode: "preview" | "pilot"; folderIds: string[]; actor: string }) {
    const result = await this.pool.query(
      "INSERT INTO business_document_import_runs (source_kind, mode, status, scope, created_by, started_at) VALUES ('drive',$1,'running',$2::jsonb,$3,now()) RETURNING id",
      [input.mode, JSON.stringify({ folderIds: input.folderIds }), input.actor],
    );
    return String(result.rows[0]?.id);
  }
  async checkpoint(input: { runId: string; externalId: string; status: string; documentId?: string; errorCode?: string }) {
    await this.pool.query(
      `INSERT INTO business_document_import_items (run_id, source_external_id, status, document_id, error_code)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (run_id, source_external_id) DO UPDATE SET status = EXCLUDED.status, document_id = EXCLUDED.document_id, error_code = EXCLUDED.error_code, updated_at = now()`,
      [input.runId, input.externalId, input.status, input.documentId ?? null, input.errorCode ?? null],
    );
  }
  async finish(runId: string, report: ImportCounts) {
    await this.pool.query("UPDATE business_document_import_runs SET status = $2, counts = $3::jsonb, finished_at = now(), updated_at = now() WHERE id = $1", [runId, report.failed || report.retry ? "completed_with_errors" : "completed", JSON.stringify(report)]);
  }
  async get(runId: string) {
    const result = await this.pool.query("SELECT id, status, mode, scope, counts FROM business_document_import_runs WHERE id = $1 AND source_kind = 'drive'", [runId]);
    const row = result.rows[0];
    return row ? { id: String(row.id), status: String(row.status), mode: String(row.mode), scope: row.scope as Record<string, unknown>, counts: row.counts as ImportCounts } : null;
  }
}
