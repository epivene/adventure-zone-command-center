import { pool as defaultPool } from "@workspace/db";
import type { GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import type { BusinessDocumentIngestion } from "./business-document-ingestion";
import { GoogleGmailDocumentSource, type GmailDocumentInventoryItem } from "./google-gmail-document-source";

export type GoogleDocumentCursor = { internalDateMs: number; messageId: string };
export type GoogleDocumentRunSummary = {
  connected: boolean;
  discovered: number;
  imported: number;
  deduplicated: number;
  linked: number;
  review: number;
  skipped: number;
  retry: number;
  failed: number;
};

type WorkerState = {
  loadCursor(accountKey: string): Promise<GoogleDocumentCursor | null>;
  startRun(input: { accountKey: string; cursor: GoogleDocumentCursor }): Promise<string>;
  hasProcessed(accountKey: string, externalId: string): Promise<boolean>;
  checkpoint(input: { runId: string; externalId: string; status: "imported" | "deduplicated" | "review" | "skipped" | "retry"; documentId?: string; errorCode?: string }): Promise<void>;
  finishRun(input: { runId: string; cursor: GoogleDocumentCursor; counts: GoogleDocumentRunSummary }): Promise<void>;
};
type Source = Pick<GoogleGmailDocumentSource, "inventoryIncrementalGmail" | "candidate">;
type Connection = { createReadClient(): Promise<GoogleWorkspaceReadClient | null> };

const emptySummary = (connected: boolean): GoogleDocumentRunSummary => ({ connected, discovered: 0, imported: 0, deduplicated: 0, linked: 0, review: 0, skipped: 0, retry: 0, failed: 0 });
const tupleAfter = (item: GmailDocumentInventoryItem, cursor: GoogleDocumentCursor) =>
  item.internalDateMs > cursor.internalDateMs || (item.internalDateMs === cursor.internalDateMs && item.messageId > cursor.messageId);

export class GoogleDocumentWorker {
  constructor(private readonly dependencies: {
    connection: Connection;
    sourceFactory(client: GoogleWorkspaceReadClient): Source;
    ingestion: Pick<BusinessDocumentIngestion, "ingest">;
    state: WorkerState;
    accountKey: string;
  }) {}

  async runOnce(now: Date): Promise<GoogleDocumentRunSummary> {
    const client = await this.dependencies.connection.createReadClient();
    if (!client) return emptySummary(false);
    const summary = emptySummary(true);
    const initialCursor = await this.dependencies.state.loadCursor(this.dependencies.accountKey)
      ?? { internalDateMs: now.getTime() - 2 * 60 * 60 * 1_000, messageId: "" };
    let nextCursor = initialCursor;
    const runId = await this.dependencies.state.startRun({ accountKey: this.dependencies.accountKey, cursor: initialCursor });
    const source = this.dependencies.sourceFactory(client);

    for await (const item of source.inventoryIncrementalGmail(initialCursor, now)) {
      const externalId = `${item.messageId}:${item.attachmentId}`;
      if (tupleAfter(item, nextCursor)) nextCursor = { internalDateMs: item.internalDateMs, messageId: item.messageId };
      if (await this.dependencies.state.hasProcessed(this.dependencies.accountKey, externalId)) continue;
      summary.discovered += 1;
      let lastError = "GMAIL_DOCUMENT_IMPORT_FAILED";
      let completed = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await this.dependencies.ingestion.ingest(await source.candidate(item, this.dependencies.accountKey));
          if (result.outcome === "skipped") {
            summary.skipped += 1;
            await this.dependencies.state.checkpoint({ runId, externalId, status: "skipped", errorCode: result.errorCode });
          } else {
            summary[result.outcome] += 1;
            summary.linked += result.linkedProfileIds.length + result.linkedBookingIds.length + result.linkedEventFamilyIds.length;
            if (result.reviewState === "needs_review") summary.review += 1;
            await this.dependencies.state.checkpoint({ runId, externalId, status: result.outcome, documentId: result.documentId });
          }
          completed = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : lastError;
          if (attempt < 3) {
            await this.dependencies.state.checkpoint({ runId, externalId, status: "retry", errorCode: lastError });
          }
        }
      }
      if (!completed) {
        summary.review += 1;
        await this.dependencies.state.checkpoint({ runId, externalId, status: "review", errorCode: lastError });
      }
    }
    await this.dependencies.state.finishRun({ runId, cursor: nextCursor, counts: summary });
    return summary;
  }
}

type QueryPool = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
export class PostgresGoogleDocumentWorkerState implements WorkerState {
  constructor(private readonly pool: QueryPool = defaultPool as unknown as QueryPool) {}
  async loadCursor(accountKey: string) {
    const result = await this.pool.query(
      `SELECT cursor FROM business_document_import_runs
       WHERE source_kind = 'gmail' AND mode = 'incremental' AND status IN ('completed','completed_with_errors') AND scope->>'accountKey' = $1
       ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT 1`, [accountKey],
    );
    const cursor = result.rows[0]?.cursor as Record<string, unknown> | undefined;
    return typeof cursor?.internalDateMs === "number" && typeof cursor.messageId === "string"
      ? { internalDateMs: cursor.internalDateMs, messageId: cursor.messageId }
      : null;
  }
  async startRun(input: { accountKey: string; cursor: GoogleDocumentCursor }) {
    const result = await this.pool.query(
      `INSERT INTO business_document_import_runs (source_kind, mode, status, scope, cursor, created_by, started_at)
       VALUES ('gmail','incremental','running',$1::jsonb,$2::jsonb,'system:google-document-worker',now()) RETURNING id`,
      [JSON.stringify({ accountKey: input.accountKey }), JSON.stringify(input.cursor)],
    );
    return String(result.rows[0]?.id);
  }
  async hasProcessed(accountKey: string, externalId: string) {
    const result = await this.pool.query(
      `SELECT 1 FROM business_document_sources WHERE source_kind = 'gmail' AND source_account_key = $1 AND external_id = $2
       UNION ALL
       SELECT 1 FROM business_document_import_items item JOIN business_document_import_runs run ON run.id = item.run_id
       WHERE run.source_kind = 'gmail' AND run.scope->>'accountKey' = $1 AND item.source_external_id = $2 AND item.status IN ('imported','deduplicated','review','skipped') LIMIT 1`,
      [accountKey, externalId],
    );
    return result.rows.length > 0;
  }
  async checkpoint(input: { runId: string; externalId: string; status: "imported" | "deduplicated" | "review" | "skipped" | "retry"; documentId?: string; errorCode?: string }) {
    await this.pool.query(
      `INSERT INTO business_document_import_items (run_id, source_external_id, status, document_id, error_code)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (run_id, source_external_id) DO UPDATE
       SET status = EXCLUDED.status, document_id = EXCLUDED.document_id, error_code = EXCLUDED.error_code, updated_at = now()`,
      [input.runId, input.externalId, input.status, input.documentId ?? null, input.errorCode ?? null],
    );
  }
  async finishRun(input: { runId: string; cursor: GoogleDocumentCursor; counts: GoogleDocumentRunSummary }) {
    await this.pool.query(
      "UPDATE business_document_import_runs SET status = 'completed', cursor = $2::jsonb, counts = $3::jsonb, finished_at = now(), updated_at = now() WHERE id = $1",
      [input.runId, JSON.stringify(input.cursor), JSON.stringify(input.counts)],
    );
  }
}
