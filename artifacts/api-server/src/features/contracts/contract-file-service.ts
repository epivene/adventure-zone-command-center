import { createHash } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { contractFiles, contractVersions } from "@/db/schema";
import type { SourceDocumentObjectStorage } from "@/features/business-sources/source-document-storage";

const PDF_MIME_TYPE = "application/pdf";
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const SIGNED_URL_SECONDS = 5 * 60;

export type ContractFileKind = "unsigned_generated" | "signed_completed";

export type ContractFileRecord = {
  id: string;
  contractVersionId: string;
  kind: ContractFileKind;
  revision: number;
  storageKey: string;
  mimeType: string;
  originalFilename: string;
  originalSizeBytes: number;
  sha256Hex: string;
  uploadedBy: string;
  uploadedAt: Date;
  confirmedAt: Date | null;
};

export interface ContractFileMetadataStore {
  versionContext(versionId: string): Promise<{ organizationId: string } | null>;
  findByChecksum(contractVersionId: string, sha256Hex: string): Promise<ContractFileRecord | null>;
  nextRevision(contractVersionId: string, kind: ContractFileKind): Promise<number>;
  insert(input: Omit<ContractFileRecord, "id">): Promise<ContractFileRecord>;
  get(contractVersionId: string, fileId: string): Promise<ContractFileRecord | null>;
}

export class ContractFileServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ContractFileServiceError";
  }
}

function validatePdf(bytes: Uint8Array, mimeType: string) {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new ContractFileServiceError("CONTRACT_FILE_TOO_LARGE", "Contract PDFs cannot exceed 20 MB.");
  }
  if (mimeType !== PDF_MIME_TYPE) {
    throw new ContractFileServiceError("CONTRACT_FILE_MIME_INVALID", "Upload a PDF contract.");
  }
  if (bytes.byteLength === 0 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new ContractFileServiceError("CONTRACT_FILE_CONTENT_INVALID", "The uploaded file is not a valid PDF.");
  }
}

export class ContractFileService {
  constructor(
    private readonly metadata: ContractFileMetadataStore,
    private readonly storage: SourceDocumentObjectStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  storeGenerated(input: { contractVersionId: string; bytes: Uint8Array; actorId: string }) {
    return this.store({
      ...input,
      kind: "unsigned_generated",
      mimeType: PDF_MIME_TYPE,
      originalFilename: "contract-unsigned.pdf",
    });
  }

  storeSigned(input: {
    contractVersionId: string;
    bytes: Uint8Array;
    mimeType: string;
    originalFilename: string;
    actorId: string;
  }) {
    return this.store({ ...input, kind: "signed_completed" });
  }

  private async store(input: {
    contractVersionId: string;
    bytes: Uint8Array;
    kind: ContractFileKind;
    mimeType: string;
    originalFilename: string;
    actorId: string;
  }) {
    validatePdf(input.bytes, input.mimeType);
    const context = await this.metadata.versionContext(input.contractVersionId);
    if (!context) throw new ContractFileServiceError("CONTRACT_VERSION_NOT_FOUND", "Contract version not found.");
    const sha256Hex = createHash("sha256").update(input.bytes).digest("hex");
    const duplicate = await this.metadata.findByChecksum(input.contractVersionId, sha256Hex);
    if (duplicate) return duplicate;
    const revision = await this.metadata.nextRevision(input.contractVersionId, input.kind);
    const storageKey = `contracts/${context.organizationId}/${input.contractVersionId}/${input.kind}/${revision}-${sha256Hex}.pdf`;
    const uploadedAt = this.now();
    await this.storage.put(storageKey, input.bytes, PDF_MIME_TYPE);
    try {
      return await this.metadata.insert({
        contractVersionId: input.contractVersionId,
        kind: input.kind,
        revision,
        storageKey,
        mimeType: PDF_MIME_TYPE,
        originalFilename: input.originalFilename,
        originalSizeBytes: input.bytes.byteLength,
        sha256Hex,
        uploadedBy: input.actorId,
        uploadedAt,
        confirmedAt: null,
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async open(input: { contractVersionId: string; fileId: string }) {
    const file = await this.metadata.get(input.contractVersionId, input.fileId);
    if (!file) throw new ContractFileServiceError("CONTRACT_FILE_NOT_FOUND", "Contract file not found.");
    return this.storage.getSignedReadUrl(file.storageKey, SIGNED_URL_SECONDS);
  }
}

type Database = typeof database;

function fileRecord(row: typeof contractFiles.$inferSelect): ContractFileRecord {
  return row;
}

export class DrizzleContractFileMetadataStore implements ContractFileMetadataStore {
  constructor(private readonly database: Database) {}

  async versionContext(versionId: string) {
    const [row] = await this.database.select({ organizationId: contractVersions.organizationId })
      .from(contractVersions).where(eq(contractVersions.id, versionId)).limit(1);
    return row ?? null;
  }

  async findByChecksum(contractVersionId: string, sha256Hex: string) {
    const [row] = await this.database.select().from(contractFiles).where(and(
      eq(contractFiles.contractVersionId, contractVersionId),
      eq(contractFiles.sha256Hex, sha256Hex),
    )).limit(1);
    return row ? fileRecord(row) : null;
  }

  async nextRevision(contractVersionId: string, kind: ContractFileKind) {
    const [row] = await this.database.select({ revision: sql<number>`coalesce(max(${contractFiles.revision}), 0)` })
      .from(contractFiles).where(and(eq(contractFiles.contractVersionId, contractVersionId), eq(contractFiles.kind, kind)));
    return Number(row?.revision ?? 0) + 1;
  }

  async insert(input: Omit<ContractFileRecord, "id">) {
    const [row] = await this.database.insert(contractFiles).values(input).returning();
    if (!row) throw new Error("CONTRACT_FILE_METADATA_CREATE_FAILED");
    return fileRecord(row);
  }

  async get(contractVersionId: string, fileId: string) {
    const [row] = await this.database.select().from(contractFiles).where(and(
      eq(contractFiles.contractVersionId, contractVersionId),
      eq(contractFiles.id, fileId),
    )).orderBy(desc(contractFiles.uploadedAt)).limit(1);
    return row ? fileRecord(row) : null;
  }
}
