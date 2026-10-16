import { createHash } from "node:crypto";
import { pool as defaultPool } from "@workspace/db";

import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import type { GoogleWorkspaceReadClient, GoogleThreadDetail } from "./google-api-types";
import { PostgresGoogleValidationRepository } from "./google-validation-repository";
import {
  GoogleCloudPrivateObjectStorage,
  type PrivateObjectStorage,
} from "@/lib/private-object-storage";

export type GoogleProfileFileAvailability =
  | "available"
  | "file_unavailable"
  | "retry_required";

export type GoogleProfileFile = {
  id: string;
  organizationId: string;
  threadId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string | null;
  storageObjectKey: string | null;
  availability: GoogleProfileFileAvailability;
  lastErrorCode: string | null;
  createdAt: string;
};

export type SaveGoogleProfileFileInput = Omit<
  GoogleProfileFile,
  "id" | "createdAt" | "lastErrorCode" | "availability"
>;

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function toFile(row: Record<string, unknown>): GoogleProfileFile | null {
  if (
    typeof row.id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.thread_id !== "string" ||
    typeof row.message_id !== "string" ||
    typeof row.attachment_id !== "string" ||
    typeof row.filename !== "string" ||
    typeof row.mime_type !== "string" ||
    (row.availability !== "available" &&
      row.availability !== "file_unavailable" &&
      row.availability !== "retry_required")
  ) {
    return null;
  }
  const size = typeof row.size_bytes === "number" ? row.size_bytes : Number(row.size_bytes);
  return {
    id: row.id,
    organizationId: row.organization_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    attachmentId: row.attachment_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number.isFinite(size) ? size : 0,
    contentSha256: typeof row.content_sha256 === "string" ? row.content_sha256 : null,
    storageObjectKey:
      typeof row.storage_object_key === "string" ? row.storage_object_key : null,
    availability: row.availability,
    lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code : null,
    createdAt: iso(row.created_at),
  };
}

export class PostgresGoogleProfileFileRepository {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool,private readonly pinnedConnectionId?:string) {}

  private async currentConnectionId(): Promise<string> {
    if(this.pinnedConnectionId)return this.pinnedConnectionId;
    const result = await this.pool.query(
      `SELECT id
         FROM google_workspace_connections
        WHERE status IN ('connected', 'reauthorization_required')
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    if (typeof id !== "string") throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    return id;
  }

  async saveFile(input: SaveGoogleProfileFileInput): Promise<GoogleProfileFile> {
    const connectionId = await this.currentConnectionId();
    const result = await this.pool.query(
      `INSERT INTO google_workspace_profile_files (
         connection_id, organization_id, thread_id, message_id, attachment_id,
         filename, mime_type, size_bytes, content_sha256, storage_object_key,
         availability, last_error_code, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'available', NULL, now(), now())
       ON CONFLICT (connection_id, message_id, attachment_id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         thread_id = EXCLUDED.thread_id,
         filename = EXCLUDED.filename,
         mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         content_sha256 = EXCLUDED.content_sha256,
         storage_object_key = EXCLUDED.storage_object_key,
         availability = 'available',
         last_error_code = NULL,
         updated_at = now()
       RETURNING *`,
      [
        connectionId,
        input.organizationId,
        input.threadId,
        input.messageId,
        input.attachmentId,
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.contentSha256,
        input.storageObjectKey,
      ],
    );
    const file = result.rows[0] ? toFile(result.rows[0]) : null;
    if (!file) throw new Error("GOOGLE_WORKSPACE_PROFILE_FILE_SAVE_FAILED");
    return file;
  }

  async markUnavailable(input: {
    organizationId: string;
    threadId: string;
    messageId: string;
    attachmentId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    errorCode: string;
  }): Promise<void> {
    const connectionId = await this.currentConnectionId();
    await this.pool.query(
      `INSERT INTO google_workspace_profile_files (
         connection_id, organization_id, thread_id, message_id, attachment_id,
         filename, mime_type, size_bytes, availability, last_error_code,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'retry_required', $9, now(), now())
       ON CONFLICT (connection_id, message_id, attachment_id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         thread_id = EXCLUDED.thread_id,
         filename = EXCLUDED.filename,
         mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         availability = CASE
           WHEN google_workspace_profile_files.availability = 'available'
             THEN 'available'
           ELSE 'retry_required'
         END,
         last_error_code = CASE
           WHEN google_workspace_profile_files.availability = 'available'
             THEN NULL
           ELSE EXCLUDED.last_error_code
         END,
         updated_at = now()`,
      [
        connectionId,
        input.organizationId,
        input.threadId,
        input.messageId,
        input.attachmentId,
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.errorCode,
      ],
    );
  }

  async listForOrganization(organizationId: string): Promise<GoogleProfileFile[]> {
    const connectionId = await this.currentConnectionId();
    const result = await this.pool.query(
      `SELECT *
         FROM google_workspace_profile_files
        WHERE connection_id = $1
          AND organization_id = $2
        ORDER BY updated_at DESC, filename, id`,
      [connectionId, organizationId],
    );
    return result.rows.flatMap((row) => {
      const file = toFile(row);
      return file ? [file] : [];
    });
  }

  async getOwnedFile(
    organizationId: string,
    fileId: string,
  ): Promise<Pick<GoogleProfileFile, "id" | "organizationId" | "storageObjectKey" | "availability"> | null> {
    const connectionId = await this.currentConnectionId();
    const result = await this.pool.query(
      `SELECT id, organization_id, storage_object_key, availability
         FROM google_workspace_profile_files
        WHERE connection_id = $1
          AND organization_id = $2
          AND id = $3
        LIMIT 1`,
      [connectionId, organizationId, fileId],
    );
    const row = result.rows[0];
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.organization_id !== "string" ||
      (row.availability !== "available" &&
        row.availability !== "file_unavailable" &&
        row.availability !== "retry_required")
    ) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      storageObjectKey:
        typeof row.storage_object_key === "string" ? row.storage_object_key : null,
      availability: row.availability,
    };
  }
}

type ConnectionAccess = {
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

type ValidationAccess = {
  organizationOwnsApprovedThread(input: {
    organizationId: string;
    threadId: string;
  }): Promise<boolean>;
};

type FileRepositoryAccess = {
  saveFile(input: SaveGoogleProfileFileInput): Promise<GoogleProfileFile>;
  markUnavailable(input: {
    organizationId: string;
    threadId: string;
    messageId: string;
    attachmentId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    errorCode: string;
  }): Promise<void>;
  listForOrganization(organizationId: string): Promise<GoogleProfileFile[]>;
  getOwnedFile(
    organizationId: string,
    fileId: string,
  ): Promise<Pick<GoogleProfileFile, "id" | "organizationId" | "storageObjectKey" | "availability"> | null>;
};

function safeFileError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_PROFILE_FILE_COPY_FAILED";
}

export class GoogleProfileFileService {
  private readonly connection: ConnectionAccess;
  private readonly validation: ValidationAccess;
  private readonly repository: FileRepositoryAccess;
  private readonly storage: PrivateObjectStorage;

  constructor(options?: {
    connection?: ConnectionAccess;
    validation?: ValidationAccess;
    repository?: FileRepositoryAccess;
    storage?: PrivateObjectStorage;
  }) {
    this.connection = options?.connection ?? new PostgresGoogleConnectionRepository();
    this.validation = options?.validation ?? new PostgresGoogleValidationRepository();
    this.repository = options?.repository ?? new PostgresGoogleProfileFileRepository();
    this.storage = options?.storage ?? new GoogleCloudPrivateObjectStorage();
  }

  async copyApprovedThreadAttachments(input: {
    organizationId: string;
    threadId: string;
    detail?: GoogleThreadDetail;
  }): Promise<GoogleProfileFile[]> {
    const owns = await this.validation.organizationOwnsApprovedThread(input);
    if (!owns) throw new Error("GOOGLE_WORKSPACE_PROFILE_THREAD_NOT_FOUND");

    const client = await this.connection.createReadClient();
    if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    if (!client.getThreadDetail || !client.getAttachment) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_FILES_UNAVAILABLE");
    }
    // Reuse the archive's snapshot: Gmail attachment handles can differ on a
    // second read, which otherwise leaves successfully copied files "partial".
    const detail = input.detail ?? await client.getThreadDetail(input.threadId);
    if (detail.id !== input.threadId) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_THREAD_NOT_FOUND");
    }

    const existing=await this.repository.listForOrganization(input.organizationId);
    for (const message of detail.messages) {
      for (const attachment of message.attachments) {
        try {
          const cached=existing.find(file=>file.threadId===input.threadId&&file.messageId===message.id&&file.attachmentId===attachment.attachmentId&&file.availability==='available'&&file.storageObjectKey);
          if(cached?.storageObjectKey&&await this.storage.exists(cached.storageObjectKey))continue;
          const bytes = await client.getAttachment({
            messageId: message.id,
            attachmentId: attachment.attachmentId,
          });
          const checksum = createHash("sha256").update(bytes).digest("hex");
          const storageObjectKey =
            `google-workspace/attachments/${checksum.slice(0, 2)}/${checksum}`;
          if (!(await this.storage.exists(storageObjectKey))) {
            await this.storage.put(storageObjectKey, bytes, attachment.mimeType);
          }
          await this.repository.saveFile({
            organizationId: input.organizationId,
            threadId: input.threadId,
            messageId: message.id,
            attachmentId: attachment.attachmentId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: bytes.byteLength,
            contentSha256: checksum,
            storageObjectKey,
          });
        } catch (error) {
          await this.repository.markUnavailable({
            organizationId: input.organizationId,
            threadId: input.threadId,
            messageId: message.id,
            attachmentId: attachment.attachmentId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            errorCode: safeFileError(error),
          });
        }
      }
    }

    return this.repository.listForOrganization(input.organizationId);
  }

  async listProfileFiles(organizationId: string): Promise<GoogleProfileFile[]> {
    if (!organizationId.trim()) throw new Error("GOOGLE_WORKSPACE_PROFILE_ID_INVALID");
    return this.repository.listForOrganization(organizationId);
  }

  async openProfileFile(input: {
    organizationId: string;
    fileId: string;
  }): Promise<string> {
    const file = await this.repository.getOwnedFile(input.organizationId, input.fileId);
    if (!file) throw new Error("GOOGLE_WORKSPACE_PROFILE_FILE_NOT_FOUND");
    if (file.availability !== "available" || !file.storageObjectKey) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_FILE_UNAVAILABLE");
    }
    return this.storage.getSignedReadUrl(file.storageObjectKey, 900);
  }
}
