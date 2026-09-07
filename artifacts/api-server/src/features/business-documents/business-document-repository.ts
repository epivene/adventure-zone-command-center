import { pool as defaultPool } from "@workspace/db";
import type {
  BusinessDocumentCategory,
  BusinessDocumentReviewState,
} from "@workspace/db";

import type {
  BusinessDocumentIngestInput,
  BusinessDocumentView,
  DocumentIngestionOutcome,
  DocumentLinkInput,
} from "./business-document-types";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release?: () => void;
};
type SqlPool = { connect(): Promise<SqlClient> };

function requiredId(row: Record<string, unknown> | undefined, code: string) {
  const id = row?.id;
  if (typeof id !== "string") throw new Error(code);
  return id;
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
}

function isoTime(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function documentLinks(value: unknown): BusinessDocumentView["links"] {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((link) => {
    if (!link || typeof link !== "object") return [];
    const candidate = link as Record<string, unknown>;
    if (
      typeof candidate.id !== "string"
      || !["profile", "booking", "event_family"].includes(String(candidate.targetKind))
      || typeof candidate.targetId !== "string"
    ) return [];
    return [{
      id: candidate.id,
      targetKind: candidate.targetKind as BusinessDocumentView["links"][number]["targetKind"],
      targetId: candidate.targetId,
    }];
  });
}

function toView(row: Record<string, unknown>): BusinessDocumentView {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    originalFilename: String(row.original_filename),
    category: row.category as BusinessDocumentCategory,
    lifecycle: row.lifecycle as BusinessDocumentView["lifecycle"],
    reviewState: row.review_state as BusinessDocumentReviewState,
    currentVersionId: typeof row.current_version_id === "string" ? row.current_version_id : null,
    effectiveDate: isoDate(row.effective_date),
    issueDate: isoDate(row.issue_date),
    expirationDate: isoDate(row.expiration_date),
    notes: typeof row.notes === "string" ? row.notes : null,
    fileAvailable: row.file_available === true,
    links: documentLinks(row.links),
    createdAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
  };
}

export class BusinessDocumentRepository {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

  private async addLinks(
    client: SqlClient,
    documentId: string,
    links: DocumentLinkInput[],
    actor: string,
  ) {
    for (const link of links) {
      const organizationId = link.targetKind === "profile" ? link.targetId : null;
      const bookingId = link.targetKind === "booking" ? link.targetId : null;
      const eventFamilyId = link.targetKind === "event_family" ? link.targetId : null;
      await client.query(
        `INSERT INTO business_document_links (
           document_id, target_kind, organization_id, booking_id, event_family_id,
           confirmation_mode, confidence, evidence, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         ON CONFLICT DO NOTHING`,
        [
          documentId,
          link.targetKind,
          organizationId,
          bookingId,
          eventFamilyId,
          link.confirmationMode,
          link.confidence,
          JSON.stringify(link.evidence),
          actor,
        ],
      );
    }
  }

  async ingest(input: BusinessDocumentIngestInput): Promise<DocumentIngestionOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingSource = await client.query(
        `SELECT s.document_id, d.current_version_id, v.blob_id, d.review_state
           FROM business_document_sources s
           JOIN business_documents d ON d.id = s.document_id
           LEFT JOIN business_document_versions v ON v.id = d.current_version_id
          WHERE s.source_kind = $1 AND s.source_account_key = $2 AND s.external_id = $3
          LIMIT 1`,
        [input.source.sourceKind, input.source.sourceAccountKey, input.source.externalId],
      );
      const sourceRow = existingSource.rows[0];
      if (sourceRow && typeof sourceRow.document_id === "string") {
        await this.addLinks(client, sourceRow.document_id, input.links, input.actor);
        await client.query("COMMIT");
        return this.outcome(
          "deduplicated",
          sourceRow.document_id,
          String(sourceRow.current_version_id),
          String(sourceRow.blob_id),
          sourceRow.review_state as BusinessDocumentReviewState,
          input.links,
        );
      }

      const insertedBlob = await client.query(
        `INSERT INTO business_document_blobs (sha256_hex, storage_key, mime_type, size_bytes)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (sha256_hex) DO NOTHING
         RETURNING id`,
        [input.blob.sha256Hex, input.blob.storageKey, input.blob.mimeType, input.blob.sizeBytes],
      );
      let blobId: string | null =
        typeof insertedBlob.rows[0]?.id === "string" ? insertedBlob.rows[0].id : null;
      if (!blobId) {
        const existingBlob = await client.query(
          "SELECT id FROM business_document_blobs WHERE sha256_hex = $1 LIMIT 1",
          [input.blob.sha256Hex],
        );
        blobId = requiredId(existingBlob.rows[0], "BUSINESS_DOCUMENT_BLOB_NOT_FOUND");
      }

      const existingVersion = await client.query(
        `SELECT v.document_id, v.id AS version_id, d.review_state
           FROM business_document_versions v
           JOIN business_documents d ON d.id = v.document_id
          WHERE v.blob_id = $1 AND d.lifecycle <> 'deleted'
          ORDER BY v.created_at ASC LIMIT 1`,
        [blobId],
      );
      const duplicate = existingVersion.rows[0];
      if (duplicate && typeof duplicate.document_id === "string") {
        await client.query(
          `INSERT INTO business_document_sources (
             document_id, source_kind, source_account_key, external_id, original_url, metadata
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
           ON CONFLICT (source_kind, source_account_key, external_id) DO NOTHING`,
          [
            duplicate.document_id,
            input.source.sourceKind,
            input.source.sourceAccountKey,
            input.source.externalId,
            input.source.originalUrl,
            JSON.stringify(input.source.metadata),
          ],
        );
        await this.addLinks(client, duplicate.document_id, input.links, input.actor);
        await client.query(
          "INSERT INTO business_document_audit_events (document_id, action, actor, metadata) VALUES ($1,'source_deduplicated',$2,$3::jsonb)",
          [duplicate.document_id, input.actor, JSON.stringify({ sourceKind: input.source.sourceKind })],
        );
        await client.query("COMMIT");
        return this.outcome(
          "deduplicated",
          duplicate.document_id,
          String(duplicate.version_id),
          blobId,
          duplicate.review_state as BusinessDocumentReviewState,
          input.links,
        );
      }

      const insertedDocument = await client.query(
        `INSERT INTO business_documents (
           display_name, original_filename, category, review_state, effective_date,
           issue_date, expiration_date, notes, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          input.displayName,
          input.originalFilename,
          input.category,
          input.reviewState,
          input.effectiveDate ?? null,
          input.issueDate ?? null,
          input.expirationDate ?? null,
          input.notes ?? null,
          input.actor,
        ],
      );
      const documentId = requiredId(insertedDocument.rows[0], "BUSINESS_DOCUMENT_CREATE_FAILED");
      const insertedVersion = await client.query(
        `INSERT INTO business_document_versions (
           document_id, blob_id, version_number, original_filename, created_by
         ) VALUES ($1,$2,1,$3,$4) RETURNING id`,
        [documentId, blobId, input.originalFilename, input.actor],
      );
      const versionId = requiredId(insertedVersion.rows[0], "BUSINESS_DOCUMENT_VERSION_CREATE_FAILED");
      await client.query(
        "UPDATE business_documents SET current_version_id = $2, updated_at = now() WHERE id = $1",
        [documentId, versionId],
      );
      await client.query(
        `INSERT INTO business_document_sources (
           document_id, source_kind, source_account_key, external_id, original_url, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          documentId,
          input.source.sourceKind,
          input.source.sourceAccountKey,
          input.source.externalId,
          input.source.originalUrl,
          JSON.stringify(input.source.metadata),
        ],
      );
      await this.addLinks(client, documentId, input.links, input.actor);
      if (input.reviewState === "needs_review") {
        await client.query(
          `INSERT INTO business_document_review_items (document_id, kind, proposals, reason_codes)
           VALUES ($1,'classification',$2::jsonb,$3::text[])`,
          [documentId, JSON.stringify({ category: input.category }), ["classification_unconfirmed"]],
        );
      }
      await client.query(
        "INSERT INTO business_document_audit_events (document_id, action, actor, metadata) VALUES ($1,'imported',$2,$3::jsonb)",
        [documentId, input.actor, JSON.stringify({ sourceKind: input.source.sourceKind })],
      );
      await client.query("COMMIT");
      return this.outcome("imported", documentId, versionId, blobId, input.reviewState, input.links);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release?.();
    }
  }

  private outcome(
    outcome: DocumentIngestionOutcome["outcome"],
    documentId: string,
    versionId: string,
    blobId: string,
    reviewState: BusinessDocumentReviewState,
    links: DocumentLinkInput[],
  ): DocumentIngestionOutcome {
    return {
      outcome,
      documentId,
      versionId,
      blobId,
      reviewState,
      linkedProfileIds: links.filter((link) => link.targetKind === "profile").map((link) => link.targetId),
      linkedBookingIds: links.filter((link) => link.targetKind === "booking").map((link) => link.targetId),
      linkedEventFamilyIds: links.filter((link) => link.targetKind === "event_family").map((link) => link.targetId),
    };
  }

  async list(input: { profileId?: string; category?: BusinessDocumentCategory; reviewState?: BusinessDocumentReviewState; limit?: number } = {}) {
    const client = await this.pool.connect();
    try {
      const values: unknown[] = [];
      const conditions = ["d.lifecycle <> 'deleted'"];
      if (input.profileId) {
        values.push(input.profileId);
        conditions.push(`EXISTS (
          SELECT 1 FROM business_document_links profile_link
          WHERE profile_link.document_id = d.id AND profile_link.organization_id = $${values.length}
        )`);
      }
      if (input.category) { values.push(input.category); conditions.push(`d.category = $${values.length}`); }
      if (input.reviewState) { values.push(input.reviewState); conditions.push(`d.review_state = $${values.length}`); }
      values.push(Math.min(100, Math.max(1, input.limit ?? 50)));
      const result = await client.query(
        `SELECT d.*,
           EXISTS (
             SELECT 1 FROM business_document_versions version
             JOIN business_document_blobs blob ON blob.id = version.blob_id
             WHERE version.id = d.current_version_id AND blob.validation_state = 'accepted'
           ) AS file_available,
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', document_link.id,
               'targetKind', document_link.target_kind,
               'targetId', COALESCE(document_link.organization_id, document_link.booking_id, document_link.event_family_id)
             ) ORDER BY document_link.created_at)
             FROM business_document_links document_link
             WHERE document_link.document_id = d.id
           ), '[]'::json) AS links
         FROM business_documents d
         WHERE ${conditions.join(" AND ")}
         ORDER BY d.updated_at DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(toView);
    } finally { client.release?.(); }
  }

  async getById(documentId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT d.*,
           EXISTS (
             SELECT 1 FROM business_document_versions version
             JOIN business_document_blobs blob ON blob.id = version.blob_id
             WHERE version.id = d.current_version_id AND blob.validation_state = 'accepted'
           ) AS file_available,
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', document_link.id,
               'targetKind', document_link.target_kind,
               'targetId', COALESCE(document_link.organization_id, document_link.booking_id, document_link.event_family_id)
             ) ORDER BY document_link.created_at)
             FROM business_document_links document_link
             WHERE document_link.document_id = d.id
           ), '[]'::json) AS links
         FROM business_documents d
         WHERE d.id = $1 AND d.lifecycle <> 'deleted' LIMIT 1`,
        [documentId],
      );
      return result.rows[0] ? toView(result.rows[0]) : null;
    } finally { client.release?.(); }
  }

  async addLink(documentId: string, link: DocumentLinkInput, actor: string) {
    const client = await this.pool.connect();
    try { await this.addLinks(client, documentId, [link], actor); }
    finally { client.release?.(); }
  }

  async removeLink(documentId: string, linkId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query("DELETE FROM business_document_links WHERE id = $1 AND document_id = $2 RETURNING id", [linkId, documentId]);
      return result.rows.length > 0;
    } finally { client.release?.(); }
  }

  async getOpenableFile(documentId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT b.storage_key
           FROM business_documents d
           JOIN business_document_versions v ON v.id = d.current_version_id
           JOIN business_document_blobs b ON b.id = v.blob_id
          WHERE d.id = $1
            AND d.lifecycle <> 'deleted'
            AND b.validation_state = 'accepted'
          LIMIT 1`,
        [documentId],
      );
      const storageKey = result.rows[0]?.storage_key;
      return typeof storageKey === "string" ? { storageKey } : null;
    } finally { client.release?.(); }
  }

  async archive(documentId: string, actor: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE business_documents
            SET lifecycle = 'archived', archived_at = now(), updated_at = now()
          WHERE id = $1 AND lifecycle = 'active' RETURNING id`,
        [documentId],
      );
      if (result.rows.length) {
        await client.query(
          "INSERT INTO business_document_audit_events (document_id, action, actor) VALUES ($1,'archived',$2)",
          [documentId, actor],
        );
      }
      await client.query("COMMIT");
      return result.rows.length > 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release?.(); }
  }

  async softDelete(documentId: string, actor: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE business_documents
            SET lifecycle = 'deleted', deleted_at = now(), updated_at = now()
          WHERE id = $1 AND lifecycle <> 'deleted' RETURNING id`,
        [documentId],
      );
      if (result.rows.length) {
        await client.query(
          "INSERT INTO business_document_audit_events (document_id, action, actor) VALUES ($1,'deleted',$2)",
          [documentId, actor],
        );
      }
      await client.query("COMMIT");
      return result.rows.length > 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release?.(); }
  }

  async countPendingReviews() {
    const client = await this.pool.connect();
    try {
      const result = await client.query("SELECT count(*)::int AS count FROM business_document_review_items WHERE state = 'pending' OR (state = 'deferred' AND deferred_until <= now())");
      return Number(result.rows[0]?.count ?? 0);
    } finally { client.release?.(); }
  }
}
