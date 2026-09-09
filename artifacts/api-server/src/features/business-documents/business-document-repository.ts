import { pool as defaultPool } from "@workspace/db";
import type {
  BusinessDocumentCategory,
  BusinessDocumentReviewState,
} from "@workspace/db";

import type {
  BusinessDocumentIngestInput,
  BusinessDocumentReviewAction,
  BusinessDocumentReviewItemView,
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
      targetLabel: typeof candidate.targetLabel === "string" ? candidate.targetLabel : null,
    }];
  });
}

function sourceKinds(value: unknown): BusinessDocumentView["sourceKinds"] {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is BusinessDocumentView["sourceKinds"][number] =>
    ["manual", "gmail", "drive", "business_source", "google_profile_file", "design_asset", "design_output"].includes(String(item)),
  );
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
    sourceKinds: sourceKinds(row.source_kinds),
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

  private async ensureCoiMetadata(client: SqlClient, documentId: string, input: BusinessDocumentIngestInput) {
    if (input.category !== "coi") return;
    await client.query(
      "UPDATE business_documents SET category = 'coi', issue_date = COALESCE(issue_date, $2), expiration_date = COALESCE(expiration_date, $3), updated_at = now() WHERE id = $1",
      [documentId, input.issueDate ?? null, input.expirationDate ?? null],
    );
    await client.query(
      `INSERT INTO business_document_coi_metadata (document_id, certificate_name, issue_date, expiration_date, review_state)
       VALUES ($1,$4,$2,$3,$5)
       ON CONFLICT (document_id) DO UPDATE SET
         certificate_name = EXCLUDED.certificate_name,
         issue_date = COALESCE(business_document_coi_metadata.issue_date, EXCLUDED.issue_date),
         expiration_date = COALESCE(business_document_coi_metadata.expiration_date, EXCLUDED.expiration_date),
         updated_at = now()`,
      [documentId, input.issueDate ?? null, input.expirationDate ?? null, input.displayName, input.reviewState === "accepted" ? "reviewed" : "needs_review"],
    );
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
        await this.ensureCoiMetadata(client, sourceRow.document_id, input);
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
        if (!input.preserveMetadataOnDuplicate) await this.ensureCoiMetadata(client, duplicate.document_id, input);
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
      await this.ensureCoiMetadata(client, documentId, input);
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

  async list(input: { profileId?: string; category?: BusinessDocumentCategory; reviewState?: BusinessDocumentReviewState; limit?: number; offset?: number } = {}) {
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
      const limitParameter = values.length;
      values.push(Math.min(100_000, Math.max(0, input.offset ?? 0)));
      const offsetParameter = values.length;
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
               'targetId', COALESCE(document_link.organization_id, document_link.booking_id, document_link.event_family_id),
               'targetLabel', CASE document_link.target_kind
                 WHEN 'profile' THEN (SELECT organization.name FROM organizations organization WHERE organization.id = document_link.organization_id)
                 WHEN 'booking' THEN (SELECT booking.name FROM bookings booking WHERE booking.id = document_link.booking_id)
                 WHEN 'event_family' THEN (SELECT event_family.name FROM event_families event_family WHERE event_family.id = document_link.event_family_id)
               END
             ) ORDER BY document_link.created_at)
             FROM business_document_links document_link
             WHERE document_link.document_id = d.id
           ), '[]'::json) AS links,
           COALESCE((
             SELECT json_agg(DISTINCT document_source.source_kind)
             FROM business_document_sources document_source
             WHERE document_source.document_id = d.id
           ), '[]'::json) AS source_kinds
         FROM business_documents d
         WHERE ${conditions.join(" AND ")}
         ORDER BY d.updated_at DESC, d.id DESC LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
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
               'targetId', COALESCE(document_link.organization_id, document_link.booking_id, document_link.event_family_id),
               'targetLabel', CASE document_link.target_kind
                 WHEN 'profile' THEN (SELECT organization.name FROM organizations organization WHERE organization.id = document_link.organization_id)
                 WHEN 'booking' THEN (SELECT booking.name FROM bookings booking WHERE booking.id = document_link.booking_id)
                 WHEN 'event_family' THEN (SELECT event_family.name FROM event_families event_family WHERE event_family.id = document_link.event_family_id)
               END
             ) ORDER BY document_link.created_at)
             FROM business_document_links document_link
             WHERE document_link.document_id = d.id
           ), '[]'::json) AS links,
           COALESCE((
             SELECT json_agg(DISTINCT document_source.source_kind)
             FROM business_document_sources document_source
             WHERE document_source.document_id = d.id
           ), '[]'::json) AS source_kinds
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

  async updateMetadata(documentId: string, input: {
    displayName: string;
    category: BusinessDocumentCategory;
    notes: string | null;
  }, actor: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE business_documents
            SET display_name = $2, category = $3, notes = $4, updated_at = now()
          WHERE id = $1 AND lifecycle <> 'deleted'
          RETURNING id`,
        [documentId, input.displayName, input.category, input.notes],
      );
      if (!result.rows.length) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO business_document_audit_events (document_id, action, actor, metadata)
         VALUES ($1,'metadata_updated',$2,$3::jsonb)`,
        [documentId, actor, JSON.stringify(input)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release?.(); }
    return this.getById(documentId);
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

  async listPendingReviews(limit = 50): Promise<BusinessDocumentReviewItemView[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT review.*, document.display_name, document.original_filename, document.category
           FROM business_document_review_items review
           JOIN business_documents document ON document.id = review.document_id
          WHERE review.state = 'pending' OR (review.state = 'deferred' AND review.deferred_until <= now())
          ORDER BY review.created_at ASC LIMIT $1`,
        [Math.min(100, Math.max(1, limit))],
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        documentId: String(row.document_id),
        kind: row.kind as BusinessDocumentReviewItemView["kind"],
        state: row.state as BusinessDocumentReviewItemView["state"],
        proposals: jsonObject(row.proposals),
        reasonCodes: Array.isArray(row.reason_codes) ? row.reason_codes.filter((value): value is string => typeof value === "string") : [],
        lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code : null,
        deferredUntil: row.deferred_until ? isoTime(row.deferred_until) : null,
        displayName: String(row.display_name),
        originalFilename: String(row.original_filename),
        category: row.category as BusinessDocumentCategory,
        createdAt: isoTime(row.created_at),
      }));
    } finally { client.release?.(); }
  }

  async actOnReview(reviewId: string, action: BusinessDocumentReviewAction, actor: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT * FROM business_document_review_items
          WHERE id = $1 AND state IN ('pending','deferred') FOR UPDATE`,
        [reviewId],
      );
      const review = selected.rows[0];
      if (!review) { await client.query("ROLLBACK"); return false; }
      const documentId = String(review.document_id);

      if (action.action === "defer") {
        await client.query(
          "UPDATE business_document_review_items SET state = 'deferred', deferred_until = $2, updated_at = now() WHERE id = $1",
          [reviewId, action.deferredUntil],
        );
      } else if (action.action === "retry") {
        if (review.kind !== "source_failure" || review.last_error_code !== "retry_required") {
          throw new Error("BUSINESS_DOCUMENT_RETRY_NOT_ALLOWED");
        }
        await client.query(
          "UPDATE business_document_review_items SET state = 'pending', attempts = attempts + 1, last_error_code = null, deferred_until = null, updated_at = now() WHERE id = $1",
          [reviewId],
        );
      } else if (action.action === "non_business") {
        await client.query("UPDATE business_documents SET lifecycle = 'archived', archived_at = now(), updated_at = now() WHERE id = $1", [documentId]);
        await client.query("UPDATE business_document_review_items SET state = 'rejected', resolved_by = $2, resolved_at = now(), updated_at = now() WHERE id = $1", [reviewId, actor]);
      } else {
        const corrections = action.action === "correct_and_approve" ? action.corrections : jsonObject(review.proposals);
        const category = typeof corrections.category === "string" ? corrections.category : null;
        const effectiveDate = typeof corrections.effectiveDate === "string" ? corrections.effectiveDate : null;
        const issueDate = typeof corrections.issueDate === "string" ? corrections.issueDate : null;
        const expirationDate = typeof corrections.expirationDate === "string" ? corrections.expirationDate : null;
        await client.query(
          `UPDATE business_documents SET
             category = COALESCE($2, category), effective_date = COALESCE($3, effective_date),
             issue_date = COALESCE($4, issue_date), expiration_date = COALESCE($5, expiration_date),
             review_state = 'accepted', updated_at = now()
           WHERE id = $1`,
          [documentId, category, effectiveDate, issueDate, expirationDate],
        );
        if (Array.isArray(corrections.targets)) {
          await client.query("DELETE FROM business_document_links WHERE document_id = $1", [documentId]);
          const links = corrections.targets.flatMap((target): DocumentLinkInput[] => {
            if (!target || typeof target !== "object") return [];
            const item = target as Record<string, unknown>;
            if (!["profile", "booking", "event_family"].includes(String(item.targetKind)) || typeof item.targetId !== "string") return [];
            return [{ targetKind: item.targetKind as DocumentLinkInput["targetKind"], targetId: item.targetId, confirmationMode: "manual", confidence: 1, evidence: [{ kind: "review_correction" }] }];
          });
          await this.addLinks(client, documentId, links, actor);
        }
        await client.query("UPDATE business_document_review_items SET state = 'approved', proposals = $3::jsonb, resolved_by = $2, resolved_at = now(), updated_at = now() WHERE id = $1", [reviewId, actor, JSON.stringify(corrections)]);
      }
      await client.query(
        "INSERT INTO business_document_audit_events (document_id, action, actor, metadata) VALUES ($1,$2,$3,$4::jsonb)",
        [documentId, `review_${action.action}`, actor, JSON.stringify({ reviewId })],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release?.(); }
  }
}
