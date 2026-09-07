import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { PaperNoteImageError, preparePaperNoteImage } from "./paper-note-image";
import type { PaperNoteObjectStorage } from "./paper-note-object-storage";
import { firstQueryRow } from "./paper-note-query-rows";

type DrizzleDatabase = typeof database;

export type PaperNoteRestoreTarget = {
  batchId: string;
  pageId: string;
  sha256: string | null;
  originalObjectKey: string;
};

function isPaperNoteRestoreTarget(row: Record<string, unknown>): row is PaperNoteRestoreTarget {
  return typeof row.batchId === "string"
    && typeof row.pageId === "string"
    && (row.sha256 === null || typeof row.sha256 === "string")
    && typeof row.originalObjectKey === "string";
}

export interface PaperNoteRestoreRepository {
  findRestoreTarget(
    actorId: string,
    batchId: string,
    pageId: string,
  ): Promise<PaperNoteRestoreTarget | null>;
}

export type PaperNoteSourceRestoreErrorCode =
  | "SOURCE_NOT_FOUND"
  | "SOURCE_HASH_UNAVAILABLE"
  | "SOURCE_HASH_MISMATCH"
  | "SOURCE_STORAGE_MISMATCH"
  | "INVALID_IMAGE";

export class PaperNoteSourceRestoreError extends Error {
  constructor(
    public readonly code: PaperNoteSourceRestoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaperNoteSourceRestoreError";
  }
}

type RestoreStorage = Pick<PaperNoteObjectStorage, "putOriginal">;
type ImageValidator = (input: {
  bytes: Uint8Array;
  declaredMimeType: string;
}) => Promise<{ sha256: string; detectedMimeType: "image/jpeg" | "image/png" | "image/webp" }>;

export class PaperNoteSourceRestoreService {
  constructor(
    private readonly repository: PaperNoteRestoreRepository,
    private readonly storage: RestoreStorage,
    private readonly validateImage: ImageValidator = preparePaperNoteImage,
  ) {}

  async restore(input: {
    actorId: string;
    batchId: string;
    pageId: string;
    bytes: Uint8Array;
    mimeType: string;
  }) {
    const target = await this.repository.findRestoreTarget(
      input.actorId,
      input.batchId,
      input.pageId,
    );
    if (!target) {
      throw new PaperNoteSourceRestoreError(
        "SOURCE_NOT_FOUND",
        "Paper-note source was not found.",
      );
    }
    if (!target.sha256) {
      throw new PaperNoteSourceRestoreError(
        "SOURCE_HASH_UNAVAILABLE",
        "This paper-note page does not have an original hash to verify against.",
      );
    }

    let prepared;
    try {
      prepared = await this.validateImage({
        bytes: input.bytes,
        declaredMimeType: input.mimeType,
      });
    } catch (error) {
      if (error instanceof PaperNoteImageError) {
        throw new PaperNoteSourceRestoreError(
          "INVALID_IMAGE",
          "Choose the exact original JPEG, PNG, or WebP paper photo.",
        );
      }
      throw error;
    }
    if (prepared.sha256 !== target.sha256) {
      throw new PaperNoteSourceRestoreError(
        "SOURCE_HASH_MISMATCH",
        "That is not the exact original paper photo. Choose the same file that was originally uploaded.",
      );
    }

    const key = await this.storage.putOriginal({
      batchId: input.batchId,
      pageId: input.pageId,
      bytes: input.bytes,
      mimeType: prepared.detectedMimeType,
    });
    if (key !== target.originalObjectKey) {
      throw new PaperNoteSourceRestoreError(
        "SOURCE_STORAGE_MISMATCH",
        "The original paper photo could not be restored to its expected private location.",
      );
    }
    return { ok: true as const };
  }
}

export class DrizzlePaperNoteRestoreRepository implements PaperNoteRestoreRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async findRestoreTarget(actorId: string, batchId: string, pageId: string) {
    const result = await this.database.execute(sql`
      select
        batches.id as "batchId",
        pages.id as "pageId",
        pages.sha256,
        pages.original_object_key as "originalObjectKey"
      from paper_note_pages pages
      join paper_note_batches batches on batches.id = pages.batch_id
      where pages.id = ${pageId}::uuid
        and pages.batch_id = ${batchId}::uuid
        and batches.created_by = ${actorId}
      limit 1
    `);
    return firstQueryRow(result, isPaperNoteRestoreTarget);
  }
}
