import { pool as defaultPool } from "@workspace/db";
import type {
  BusinessDocumentCategory,
  BusinessDocumentSourceKind,
} from "@workspace/db";

import { BusinessDocumentRepository } from "./business-document-repository";
import { BusinessDocumentStorage } from "./business-document-storage";
import type {
  BusinessDocumentIngestInput,
  DocumentIngestionOutcome,
  StoredBusinessDocumentBlob,
} from "./business-document-types";

export const legacyDocumentSourceNames = [
  "business_source",
  "google_profile_file",
  "design_asset",
  "design_output",
  "design_certificate",
] as const;
export type LegacyDocumentSourceName = typeof legacyDocumentSourceNames[number];

export type LegacyDocumentCandidate = {
  cursor: string;
  sourceName: LegacyDocumentSourceName;
  sourceKind: BusinessDocumentSourceKind;
  sourceAccountKey: string;
  externalId: string;
  displayName: string;
  filename: string;
  mimeType: string;
  storageKey: string | null;
  sha256Hex: string | null;
  sizeBytes: number | null;
  category: BusinessDocumentCategory;
  reviewState: "accepted" | "needs_review";
  profileIds: string[];
  bookingIds: string[];
  metadata: Record<string, unknown>;
};

export type MigrationReport = {
  dryRun: boolean;
  discovered: number;
  imported: number;
  deduplicated: number;
  review: number;
  skipped: number;
  failed: number;
  nextAfterId: string | null;
  bySource: Record<LegacyDocumentSourceName, number>;
};

type Reader = { discover(input: { batchSize: number; afterId: string | null }): Promise<LegacyDocumentCandidate[]> };
type Repository = { ingest(input: BusinessDocumentIngestInput): Promise<DocumentIngestionOutcome> };
type Storage = {
  get(storageKey: string): Promise<Uint8Array>;
  putIfAbsent(bytes: Uint8Array, mimeType: string): Promise<StoredBusinessDocumentBlob>;
};
type Finalizer = (candidate: LegacyDocumentCandidate, outcome: DocumentIngestionOutcome) => Promise<void>;

function emptySourceCounts(): MigrationReport["bySource"] {
  return { business_source: 0, google_profile_file: 0, design_asset: 0, design_output: 0, design_certificate: 0 };
}

function validChecksum(value: string | null) {
  return Boolean(value && /^[0-9a-f]{64}$/.test(value));
}

export class LegacyDocumentMigration {
  constructor(private readonly dependencies: {
    reader: Reader;
    repository: Repository;
    storage: Storage;
    finalize?: Finalizer;
  }) {}

  async migrate(input: { dryRun: boolean; batchSize: number; afterId: string | null }): Promise<MigrationReport> {
    const candidates = await this.dependencies.reader.discover({
      batchSize: Math.min(500, Math.max(1, input.batchSize)),
      afterId: input.afterId,
    });
    const report: MigrationReport = {
      dryRun: input.dryRun,
      discovered: candidates.length,
      imported: 0,
      deduplicated: 0,
      review: 0,
      skipped: 0,
      failed: 0,
      nextAfterId: candidates.at(-1)?.cursor ?? null,
      bySource: emptySourceCounts(),
    };
    for (const candidate of candidates) {
      report.bySource[candidate.sourceName] += 1;
      if (candidate.reviewState === "needs_review") report.review += 1;
      if (input.dryRun) continue;
      if (!candidate.storageKey) { report.skipped += 1; continue; }
      try {
        const blob = validChecksum(candidate.sha256Hex) && candidate.sizeBytes !== null
          ? {
              sha256Hex: candidate.sha256Hex!,
              storageKey: candidate.storageKey,
              sizeBytes: candidate.sizeBytes,
              mimeType: candidate.mimeType,
            }
          : await this.dependencies.storage.putIfAbsent(
              await this.dependencies.storage.get(candidate.storageKey),
              candidate.mimeType,
            );
        const outcome = await this.dependencies.repository.ingest({
          displayName: candidate.displayName,
          originalFilename: candidate.filename,
          category: candidate.category,
          reviewState: candidate.reviewState,
          actor: "legacy_document_migration",
          blob,
          source: {
            sourceKind: candidate.sourceKind,
            sourceAccountKey: candidate.sourceAccountKey,
            externalId: candidate.externalId,
            originalUrl: null,
            metadata: candidate.metadata,
          },
          links: [
            ...candidate.profileIds.map((targetId) => ({ targetKind: "profile" as const, targetId })),
            ...candidate.bookingIds.map((targetId) => ({ targetKind: "booking" as const, targetId })),
          ].map((link) => ({
            ...link,
            confirmationMode: "migrated" as const,
            confidence: 1,
            evidence: [{ kind: "legacy_relationship" }],
          })),
          notes: null,
        });
        report[outcome.outcome] += 1;
        await this.dependencies.finalize?.(candidate, outcome);
      } catch {
        report.failed += 1;
      }
    }
    return report;
  }
}

type QueryPool = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };

function strings(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function categoryFor(name: string, source: LegacyDocumentSourceName): BusinessDocumentCategory {
  const text = name.toLowerCase();
  if (source === "design_certificate" || /\bcoi\b|certificate of insurance/.test(text)) return "coi";
  if (source === "design_output" && /contract/.test(text)) return "contract";
  if (/template|checklist|script/.test(text)) return "operational_template";
  if (/proposal|estimate|quote/.test(text)) return "proposal";
  if (/permit/.test(text)) return "permit";
  if (/w[- ]?9|tax/.test(text)) return "w9_tax";
  return "other";
}

export class PostgresLegacyDocumentReader implements Reader {
  constructor(private readonly pool: QueryPool = defaultPool as unknown as QueryPool) {}

  async discover(input: { batchSize: number; afterId: string | null }) {
    const result = await this.pool.query(
      `WITH legacy AS (
        SELECT 'business_source:' || document.id AS cursor, 'business_source' AS source_name,
          'business_source' AS source_kind, 'legacy' AS source_account_key, document.id::text AS external_id,
          document.display_title AS display_name, document.original_filename AS filename,
          file.mime_type, file.storage_key, file.sha256_hex, file.original_size_bytes::bigint AS size_bytes,
          ARRAY(SELECT link.organization_id::text FROM business_source_document_links link WHERE link.source_document_id = document.id AND link.organization_id IS NOT NULL) AS profile_ids,
          ARRAY(SELECT link.booking_id::text FROM business_source_document_links link WHERE link.source_document_id = document.id AND link.booking_id IS NOT NULL) AS booking_ids
        FROM business_source_documents document JOIN business_source_document_files file ON file.source_document_id = document.id
        UNION ALL
        SELECT 'google_profile_file:' || file.id, 'google_profile_file', 'google_profile_file', file.connection_id::text,
          file.message_id || ':' || file.attachment_id, file.filename, file.filename, file.mime_type,
          file.storage_object_key, file.content_sha256, file.size_bytes,
          ARRAY[file.organization_id::text], ARRAY[]::text[]
        FROM google_workspace_profile_files file WHERE file.storage_object_key IS NOT NULL
        UNION ALL
        SELECT 'design_asset:' || asset.id, 'design_asset', 'design_asset', asset.uploaded_by_account_id::text,
          asset.id::text, asset.name, asset.name, COALESCE(asset.mime_type, 'application/octet-stream'),
          asset.storage_key, NULL, CASE WHEN asset.size_bytes ~ '^[0-9]+$' THEN asset.size_bytes::bigint ELSE NULL END,
          CASE WHEN asset.organization_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[asset.organization_id::text] END,
          CASE WHEN asset.booking_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[asset.booking_id::text] END
        FROM design_assets asset WHERE asset.storage_key IS NOT NULL
        UNION ALL
        SELECT 'design_output:' || output.id, 'design_output', 'design_output', output.created_by_account_id::text,
          output.id::text, project.name, project.name || '.pdf', 'application/pdf', output.storage_key, NULL, NULL,
          CASE WHEN project.linked_organization_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[project.linked_organization_id::text] END,
          CASE WHEN project.linked_booking_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[project.linked_booking_id::text] END
        FROM design_outputs output JOIN design_projects project ON project.id = output.project_id WHERE output.storage_key IS NOT NULL
        UNION ALL
        SELECT 'design_certificate:' || certificate.id, 'design_certificate', 'business_source', certificate.office_account_id::text,
          'design_certificate:' || certificate.id, certificate.name, COALESCE(asset.name, certificate.name),
          COALESCE(asset.mime_type, 'application/pdf'), asset.storage_key, NULL, CASE WHEN asset.size_bytes ~ '^[0-9]+$' THEN asset.size_bytes::bigint ELSE NULL END,
          CASE WHEN certificate.organization_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[certificate.organization_id::text] END,
          CASE WHEN certificate.booking_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[certificate.booking_id::text] END
        FROM design_certificates certificate JOIN design_assets asset ON asset.id = certificate.asset_id
        WHERE asset.storage_key IS NOT NULL AND certificate.document_id IS NULL
      ) SELECT * FROM legacy WHERE ($1::text IS NULL OR cursor > $1) ORDER BY cursor LIMIT $2`,
      [input.afterId, input.batchSize],
    );
    return result.rows.map((row) => {
      const sourceName = String(row.source_name) as LegacyDocumentSourceName;
      const displayName = String(row.display_name);
      const category = categoryFor(displayName, sourceName);
      return {
        cursor: String(row.cursor),
        sourceName,
        sourceKind: String(row.source_kind) as BusinessDocumentSourceKind,
        sourceAccountKey: String(row.source_account_key),
        externalId: String(row.external_id),
        displayName,
        filename: String(row.filename),
        mimeType: String(row.mime_type),
        storageKey: typeof row.storage_key === "string" ? row.storage_key : null,
        sha256Hex: typeof row.sha256_hex === "string" ? row.sha256_hex : null,
        sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
        category,
        reviewState: category === "other" ? "needs_review" as const : "accepted" as const,
        profileIds: strings(row.profile_ids),
        bookingIds: strings(row.booking_ids),
        metadata: { legacySource: sourceName },
      };
    });
  }
}

export function migrateLegacyDocuments(
  input: { dryRun: boolean; batchSize: number; afterId: string | null },
  dependencies?: ConstructorParameters<typeof LegacyDocumentMigration>[0],
) {
  const storage = new BusinessDocumentStorage();
  return new LegacyDocumentMigration(dependencies ?? {
    reader: new PostgresLegacyDocumentReader(),
    repository: new BusinessDocumentRepository(),
    storage,
    finalize: async (candidate, outcome) => {
      if (candidate.sourceName !== "design_certificate") return;
      const certificateId = candidate.externalId.replace(/^design_certificate:/, "");
      const pool = defaultPool as unknown as QueryPool;
      await pool.query("UPDATE business_documents SET category = 'coi', updated_at = now() WHERE id = $1", [outcome.documentId]);
      await pool.query(
        `INSERT INTO business_document_coi_metadata (
           document_id, office_account_id, certificate_name, issue_date, expiration_date, review_state
         ) SELECT $1, office_account_id, name, issue_date, expiration_date, review_state
             FROM design_certificates WHERE id = $2
         ON CONFLICT (document_id) DO UPDATE SET
           office_account_id = EXCLUDED.office_account_id,
           certificate_name = EXCLUDED.certificate_name,
           issue_date = EXCLUDED.issue_date,
           expiration_date = EXCLUDED.expiration_date,
           review_state = EXCLUDED.review_state,
           updated_at = now()`,
        [outcome.documentId, certificateId],
      );
      await pool.query("UPDATE design_certificates SET document_id = $1, updated_at = now() WHERE id = $2", [outcome.documentId, certificateId]);
    },
  }).migrate(input);
}
