import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  businessSourceDocumentFiles,
  businessSourceDocuments,
} from "@/db/schema";
import type { SourceDocumentObjectStorage } from "./source-document-storage";

export const allowedSourceDocumentMimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const MAX_SOURCE_DOCUMENT_BYTES = 30 * 1024 * 1024;

export type SourceDocumentFileRecord = {
  id: string;
  sourceDocumentId: string;
  storageKey: string;
  mimeType: string;
  originalSizeBytes: number;
  sha256Hex: string;
  uploadedBy: string;
  uploadedAt: Date;
};

export interface SourceDocumentFileMetadataStore {
  documentExists(documentId: string): Promise<boolean>;
  get(documentId: string): Promise<SourceDocumentFileRecord | null>;
  replace(
    input: Omit<SourceDocumentFileRecord, "id">,
  ): Promise<SourceDocumentFileRecord>;
  delete(documentId: string): Promise<SourceDocumentFileRecord | null>;
}

export function sourceDocumentStorageKey(documentId: string, sha256Hex: string) {
  return `business-source-documents/${documentId}/${sha256Hex}`;
}

function validateUpload(input: { mimeType: string; bytes: Uint8Array }) {
  if (!(allowedSourceDocumentMimeTypes as readonly string[]).includes(input.mimeType)) {
    throw new Error("Unsupported source document file type");
  }
  if (input.bytes.byteLength > MAX_SOURCE_DOCUMENT_BYTES) {
    throw new Error("Source document file is too large");
  }
}

export async function uploadSourceDocumentFile(
  store: SourceDocumentFileMetadataStore,
  storage: SourceDocumentObjectStorage,
  input: {
    documentId: string;
    originalFilename: string;
    mimeType: string;
    bytes: Uint8Array;
    actorId: string;
  },
): Promise<SourceDocumentFileRecord> {
  validateUpload(input);
  if (!(await store.documentExists(input.documentId))) {
    throw new Error("SOURCE_DOCUMENT_NOT_FOUND");
  }

  const sha256Hex = createHash("sha256").update(input.bytes).digest("hex");
  const storageKey = sourceDocumentStorageKey(input.documentId, sha256Hex);
  const current = await store.get(input.documentId);
  if (current?.sha256Hex === sha256Hex) return current;

  await storage.put(storageKey, input.bytes, input.mimeType);

  let saved: SourceDocumentFileRecord;
  try {
    saved = await store.replace({
      sourceDocumentId: input.documentId,
      storageKey,
      mimeType: input.mimeType,
      originalSizeBytes: input.bytes.byteLength,
      sha256Hex,
      uploadedBy: input.actorId,
      uploadedAt: new Date(),
    });
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }

  if (current?.storageKey && current.storageKey !== saved.storageKey) {
    await storage.delete(current.storageKey).catch(() => undefined);
  }
  return saved;
}

export async function getSourceDocumentSignedReadUrl(
  store: SourceDocumentFileMetadataStore,
  storage: SourceDocumentObjectStorage,
  documentId: string,
) {
  const record = await store.get(documentId);
  if (!record) return null;
  return storage.getSignedReadUrl(record.storageKey, 300);
}

export async function deleteSourceDocumentFile(
  store: SourceDocumentFileMetadataStore,
  storage: SourceDocumentObjectStorage,
  documentId: string,
) {
  const current = await store.get(documentId);
  if (!current) return null;
  const deleted = await store.delete(documentId);
  if (deleted?.storageKey) {
    await storage.delete(deleted.storageKey).catch(() => undefined);
  }
  return deleted;
}

type Database = typeof database;

export class DrizzleSourceDocumentFileMetadataStore
implements SourceDocumentFileMetadataStore {
  constructor(private readonly database: Database) {}

  async documentExists(documentId: string) {
    return Boolean(
      (
        await this.database
          .select({ id: businessSourceDocuments.id })
          .from(businessSourceDocuments)
          .where(eq(businessSourceDocuments.id, documentId))
          .limit(1)
      )[0],
    );
  }

  async get(documentId: string): Promise<SourceDocumentFileRecord | null> {
    return (
      (
        await this.database
          .select()
          .from(businessSourceDocumentFiles)
          .where(eq(businessSourceDocumentFiles.sourceDocumentId, documentId))
          .limit(1)
      )[0] ?? null
    );
  }

  async replace(
    input: Omit<SourceDocumentFileRecord, "id">,
  ): Promise<SourceDocumentFileRecord> {
    return this.database.transaction(async (transaction) => {
      const [saved] = await transaction
        .insert(businessSourceDocumentFiles)
        .values(input)
        .onConflictDoUpdate({
          target: businessSourceDocumentFiles.sourceDocumentId,
          set: {
            storageKey: input.storageKey,
            mimeType: input.mimeType,
            originalSizeBytes: input.originalSizeBytes,
            sha256Hex: input.sha256Hex,
            uploadedBy: input.uploadedBy,
            uploadedAt: input.uploadedAt,
          },
        })
        .returning();
      if (!saved) throw new Error("SOURCE_DOCUMENT_FILE_SAVE_FAILED");
      return saved;
    });
  }

  async delete(documentId: string): Promise<SourceDocumentFileRecord | null> {
    return (
      (
        await this.database
          .delete(businessSourceDocumentFiles)
          .where(eq(businessSourceDocumentFiles.sourceDocumentId, documentId))
          .returning()
      )[0] ?? null
    );
  }
}
