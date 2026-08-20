import { PaperNoteImageError, preparePaperNoteImage } from "./paper-note-image";
import type { PaperNoteObjectStorage } from "./paper-note-object-storage";
import {
  PaperNoteIntakeRepository,
  PaperNoteRepositoryError,
} from "./paper-note-intake-repository";

export type PaperNoteIntakeErrorCode =
  | "BATCH_NOT_FOUND"
  | "BATCH_NOT_EDITABLE"
  | "PAGE_NOT_FOUND"
  | "PAGE_LIMIT_REACHED"
  | "DUPLICATE_PAGE"
  | "PAGES_INCOMPLETE"
  | "INVALID_IMAGE"
  | "IMAGE_TYPE_MISMATCH"
  | "IMAGE_TOO_LARGE"
  | "STORAGE_UNAVAILABLE";

export class PaperNoteIntakeError extends Error {
  constructor(public readonly code: PaperNoteIntakeErrorCode, message: string) {
    super(message);
    this.name = "PaperNoteIntakeError";
  }
}

type Repository = Pick<
  PaperNoteIntakeRepository,
  | "createBatch"
  | "listBatches"
  | "getBatch"
  | "createUploadingPage"
  | "getUploadTarget"
  | "findDuplicateHash"
  | "finalizeUploadedPage"
  | "reorderDraftPages"
  | "setDraftPageRotation"
  | "deletePageRow"
  | "listDraftPageObjects"
  | "deleteDraftBatchRow"
  | "queueBatch"
>;

function translate(error: unknown): never {
  if (error instanceof PaperNoteIntakeError) throw error;
  if (error instanceof PaperNoteRepositoryError) {
    throw new PaperNoteIntakeError(error.code, error.message);
  }
  if (error instanceof PaperNoteImageError) {
    throw new PaperNoteIntakeError(error.code, error.message);
  }
  throw error;
}

export class PaperNoteIntakeService {
  constructor(
    private readonly repository: Repository,
    private readonly storage: PaperNoteObjectStorage,
  ) {}

  async createBatch(input: { createdBy: string; name: string | null; now: Date }) {
    try {
      return await this.repository.createBatch({
        createdBy: input.createdBy,
        name: input.name?.trim() || null,
        now: input.now,
      });
    } catch (error) {
      translate(error);
    }
  }

  listBatches(createdBy: string) {
    return this.repository.listBatches(createdBy);
  }

  getBatch(createdBy: string, batchId: string) {
    return this.repository.getBatch(createdBy, batchId);
  }

  async createPage(input: {
    createdBy: string;
    batchId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    now: Date;
  }) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(input.mimeType)) {
      throw new PaperNoteIntakeError("INVALID_IMAGE", "Use a JPEG, PNG, or WebP image.");
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > 12 * 1024 * 1024) {
      throw new PaperNoteIntakeError("IMAGE_TOO_LARGE", "Each paper-note photo must be 12 MB or smaller.");
    }
    try {
      return await this.repository.createUploadingPage({
        ...input,
        filename: input.filename.trim() || "paper-note-image",
      });
    } catch (error) {
      translate(error);
    }
  }

  async uploadPage(input: {
    createdBy: string;
    batchId: string;
    pageId: string;
    bytes: Uint8Array;
    mimeType: string;
    now: Date;
  }) {
    let prepared;
    try {
      prepared = await preparePaperNoteImage({
        bytes: input.bytes,
        declaredMimeType: input.mimeType,
      });
    } catch (error) {
      translate(error);
    }

    const target = await this.repository.getUploadTarget(input.createdBy, input.batchId, input.pageId);
    if (!target) throw new PaperNoteIntakeError("PAGE_NOT_FOUND", "Paper note page was not found.");
    if (target.status !== "uploading") {
      if (target.status === "uploaded" && target.sha256 === prepared.sha256) return { ok: true as const };
      throw new PaperNoteIntakeError("BATCH_NOT_EDITABLE", "This paper note page can no longer be replaced.");
    }

    const duplicatePageId = await this.repository.findDuplicateHash(input.batchId, input.pageId, prepared.sha256);
    if (duplicatePageId) {
      throw new PaperNoteIntakeError("DUPLICATE_PAGE", "That photo is already in this batch.");
    }

    let objectWritten = false;
    try {
      const key = await this.storage.putOriginal({
        batchId: input.batchId,
        pageId: input.pageId,
        bytes: input.bytes,
        mimeType: prepared.detectedMimeType,
      });
      objectWritten = true;
      if (target.originalObjectKey && key !== target.originalObjectKey) {
        throw new Error("Paper note storage key mismatch.");
      }
      await this.repository.finalizeUploadedPage({
        pageId: input.pageId,
        sha256: prepared.sha256,
        width: prepared.width,
        height: prepared.height,
        now: input.now,
      });
      return { ok: true as const };
    } catch (error) {
      if (objectWritten) {
        try {
          await this.storage.deletePageObjects({
            originalObjectKey: target.originalObjectKey,
            analysisObjectKey: null,
          });
        } catch {
          throw new PaperNoteIntakeError(
            "STORAGE_UNAVAILABLE",
            "The photo was stored but cleanup failed. Try again before continuing.",
          );
        }
      }
      if (error instanceof PaperNoteIntakeError) throw error;
      throw error;
    }
  }

  async reorderPages(input: { createdBy: string; batchId: string; orderedPageIds: string[]; now: Date }) {
    try {
      await this.repository.reorderDraftPages(input.createdBy, input.batchId, input.orderedPageIds, input.now);
    } catch (error) {
      translate(error);
    }
  }

  async rotatePage(input: {
    createdBy: string;
    batchId: string;
    pageId: string;
    rotationDegrees: 0 | 90 | 180 | 270;
    now: Date;
  }) {
    try {
      await this.repository.setDraftPageRotation(
        input.createdBy,
        input.batchId,
        input.pageId,
        input.rotationDegrees,
        input.now,
      );
    } catch (error) {
      translate(error);
    }
  }

  async deletePage(input: { createdBy: string; batchId: string; pageId: string; now: Date }) {
    const target = await this.repository.getUploadTarget(input.createdBy, input.batchId, input.pageId);
    if (!target) throw new PaperNoteIntakeError("PAGE_NOT_FOUND", "Paper note page was not found.");
    try {
      await this.storage.deletePageObjects({
        originalObjectKey: target.originalObjectKey,
        analysisObjectKey: target.analysisObjectKey,
      });
    } catch {
      throw new PaperNoteIntakeError("STORAGE_UNAVAILABLE", "Could not remove the stored paper-note photo.");
    }
    try {
      await this.repository.deletePageRow(input.createdBy, input.batchId, input.pageId, input.now);
    } catch (error) {
      translate(error);
    }
  }

  async deleteBatch(input: { createdBy: string; batchId: string }) {
    let objects;
    try {
      objects = await this.repository.listDraftPageObjects(input.createdBy, input.batchId);
    } catch (error) {
      translate(error);
    }
    try {
      for (const object of objects) {
        await this.storage.deletePageObjects(object);
      }
    } catch {
      throw new PaperNoteIntakeError("STORAGE_UNAVAILABLE", "Could not remove every stored paper-note photo.");
    }
    try {
      await this.repository.deleteDraftBatchRow(input.createdBy, input.batchId);
    } catch (error) {
      translate(error);
    }
  }

  async queueBatch(input: { createdBy: string; batchId: string; now: Date }) {
    try {
      await this.repository.queueBatch(input.createdBy, input.batchId, input.now);
    } catch (error) {
      translate(error);
    }
  }
}
