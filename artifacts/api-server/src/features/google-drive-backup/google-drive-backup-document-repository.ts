import type { BusinessDocumentCategory } from "@workspace/db";
import type { DocumentPathInput } from "./google-drive-backup-types";
import type { GoogleDriveBackupSqlPool } from "./google-drive-backup-repository";

export interface DocumentBackupSource {
  pathInput: DocumentPathInput;
  sourceVersion: string;
  storageKey: string;
  mimeType: string;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class GoogleDriveBackupDocumentRepository {
  constructor(private readonly pool: GoogleDriveBackupSqlPool) {}

  async getCurrent(documentId: string): Promise<DocumentBackupSource | null> {
    const result = await this.pool.query(
      `SELECT d.id, d.display_name, d.original_filename, d.category,
              d.effective_date, d.issue_date, d.created_at, d.updated_at,
              v.id AS version_id, v.original_filename AS version_filename,
              v.created_at AS version_created_at,
              blob.storage_key, blob.mime_type,
              COALESCE(link.organization_id, booking.organization_id) AS organization_id,
              organization.name AS organization_name,
              booking.starts_at AS booking_starts_at
         FROM business_documents d
         JOIN business_document_versions v ON v.id = d.current_version_id
         JOIN business_document_blobs blob ON blob.id = v.blob_id
         LEFT JOIN LATERAL (
           SELECT l.organization_id, l.booking_id
             FROM business_document_links l
            WHERE l.document_id = d.id
            ORDER BY (l.organization_id IS NOT NULL) DESC, l.created_at, l.id
            LIMIT 1
         ) link ON true
         LEFT JOIN bookings booking ON booking.id = link.booking_id
         LEFT JOIN organizations organization
           ON organization.id = COALESCE(link.organization_id, booking.organization_id)
        WHERE d.id = $1
          AND d.lifecycle <> 'deleted'
          AND blob.validation_state = 'accepted'
        LIMIT 1`,
      [documentId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const storageKey = nullableText(row.storage_key);
    const mimeType = nullableText(row.mime_type);
    const versionId = nullableText(row.version_id);
    if (!storageKey || !mimeType || !versionId) {
      throw new Error("GOOGLE_DRIVE_BACKUP_DOCUMENT_SOURCE_CORRUPT");
    }
    const versionFilename = nullableText(row.version_filename);
    return {
      pathInput: {
        documentId,
        displayName: nullableText(row.display_name) ?? "Unnamed document",
        originalFilename: versionFilename ?? nullableText(row.original_filename) ?? "document",
        category: (nullableText(row.category) ?? "other") as BusinessDocumentCategory,
        organizationId: nullableText(row.organization_id),
        organizationName: nullableText(row.organization_name),
        effectiveDate: nullableText(row.effective_date),
        bookingStartsAt: nullableText(row.booking_starts_at),
        issueDate: nullableText(row.issue_date),
        createdAt: nullableText(row.created_at),
      },
      sourceVersion: `${versionId}:${nullableText(row.updated_at) ?? nullableText(row.version_created_at) ?? "unknown"}`,
      storageKey,
      mimeType,
    };
  }
}
