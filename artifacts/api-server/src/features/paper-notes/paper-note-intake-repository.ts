import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, max, ne } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  paperNoteBatches,
  paperNoteEntries,
  paperNotePages,
} from "@/db/schema";
import { paperNoteOriginalObjectKey } from "./paper-note-object-storage";
import type {
  PaperNoteBatchListItem,
  PaperNoteBatchView,
  PaperNoteEntryView,
  PaperNotePageView,
} from "./paper-note-types";

type DrizzleDatabase = typeof database;

export type PaperNoteEditablePage = {
  id: string;
  batchId: string;
  status: string;
  originalObjectKey: string | null;
  analysisObjectKey: string | null;
  sha256: string | null;
};

function pageView(row: typeof paperNotePages.$inferSelect): PaperNotePageView {
  return {
    id: row.id,
    batchId: row.batchId,
    sortOrder: row.sortOrder,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    rotationDegrees: row.rotationDegrees as 0 | 90 | 180 | 270,
    status: row.status,
    currentStage: row.currentStage,
    pageHeading: row.pageHeading,
    pageActivityDate: row.pageActivityDate,
    attemptCount: row.attemptCount,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    extractedAt: row.extractedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function entryView(row: typeof paperNoteEntries.$inferSelect): PaperNoteEntryView {
  const issues = Array.isArray(row.validationIssues) ? row.validationIssues : [];
  return {
    id: row.id,
    batchId: row.batchId,
    pageId: row.pageId,
    sourceOrder: row.sourceOrder,
    sourceRegion: row.sourceRegion as PaperNoteEntryView["sourceRegion"],
    reviewVersion: row.reviewVersion,
    state: row.state,
    destinationMode: row.destinationMode,
    selectedOrganizationId: row.selectedOrganizationId,
    selectedOrganizationLocationId: row.selectedOrganizationLocationId,
    validationIssues: issues as PaperNoteEntryView["validationIssues"],
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PaperNoteRepositoryError extends Error {
  constructor(
    public readonly code:
      | "BATCH_NOT_FOUND"
      | "BATCH_NOT_EDITABLE"
      | "PAGE_NOT_FOUND"
      | "PAGE_LIMIT_REACHED"
      | "DUPLICATE_PAGE"
      | "PAGES_INCOMPLETE",
    message: string,
  ) {
    super(message);
    this.name = "PaperNoteRepositoryError";
  }
}

export class PaperNoteIntakeRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async createBatch(input: { createdBy: string; name: string | null; now: Date }) {
    const [row] = await this.database.insert(paperNoteBatches).values({
      createdBy: input.createdBy,
      name: input.name,
      status: "draft",
      pageCount: 0,
      createdAt: input.now,
      updatedAt: input.now,
    }).returning({ id: paperNoteBatches.id });
    if (!row) throw new Error("Paper note batch could not be created.");
    return row.id;
  }

  async listBatches(createdBy: string): Promise<PaperNoteBatchListItem[]> {
    const rows = await this.database.select().from(paperNoteBatches)
      .where(eq(paperNoteBatches.createdBy, createdBy))
      .orderBy(desc(paperNoteBatches.updatedAt));
    return Promise.all(rows.map((row) => this.toBatchListItem(row)));
  }

  async getBatch(createdBy: string, batchId: string): Promise<PaperNoteBatchView | null> {
    const [batch] = await this.database.select().from(paperNoteBatches)
      .where(and(eq(paperNoteBatches.id, batchId), eq(paperNoteBatches.createdBy, createdBy)))
      .limit(1);
    if (!batch) return null;
    const [pages, entries, listItem] = await Promise.all([
      this.database.select().from(paperNotePages)
        .where(eq(paperNotePages.batchId, batchId))
        .orderBy(asc(paperNotePages.sortOrder)),
      this.database.select().from(paperNoteEntries)
        .where(eq(paperNoteEntries.batchId, batchId))
        .orderBy(asc(paperNoteEntries.sourceOrder)),
      this.toBatchListItem(batch),
    ]);
    return {
      ...listItem,
      pages: pages.map(pageView),
      entries: entries.map(entryView),
      importSummary: (batch.importSummary as PaperNoteBatchView["importSummary"]) ?? null,
      failureCode: batch.failureCode,
      failureMessage: batch.failureMessage,
      extractionStartedAt: batch.extractionStartedAt?.toISOString() ?? null,
      reviewStartedAt: batch.reviewStartedAt?.toISOString() ?? null,
      importStartedAt: batch.importStartedAt?.toISOString() ?? null,
    };
  }

  async createUploadingPage(input: {
    createdBy: string;
    batchId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    now: Date;
  }) {
    return this.database.transaction(async (tx) => {
      const [batch] = await tx
        .select({ id: paperNoteBatches.id, status: paperNoteBatches.status })
        .from(paperNoteBatches)
        .where(and(
          eq(paperNoteBatches.id, input.batchId),
          eq(paperNoteBatches.createdBy, input.createdBy),
        ))
        .limit(1)
        .for("update");
      if (!batch) throw new PaperNoteRepositoryError("BATCH_NOT_FOUND", "Paper note batch was not found.");
      if (batch.status !== "draft") {
        throw new PaperNoteRepositoryError("BATCH_NOT_EDITABLE", "This paper note batch can no longer be changed.");
      }

      const [pageCountRow] = await tx
        .select({ value: count() })
        .from(paperNotePages)
        .where(eq(paperNotePages.batchId, input.batchId));
      const pageCount = Number(pageCountRow?.value ?? 0);
      if (pageCount >= 25) {
        throw new PaperNoteRepositoryError("PAGE_LIMIT_REACHED", "A paper note batch can contain up to 25 pages.");
      }

      const [maxSortRow] = await tx
        .select({ value: max(paperNotePages.sortOrder) })
        .from(paperNotePages)
        .where(eq(paperNotePages.batchId, input.batchId));
      const maxSort = maxSortRow?.value ?? null;
      const pageId = randomUUID();
      await tx.insert(paperNotePages).values({
        id: pageId,
        batchId: input.batchId,
        sortOrder: maxSort === null ? 0 : Number(maxSort) + 1,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        originalObjectKey: paperNoteOriginalObjectKey(input.batchId, pageId),
        status: "uploading",
        createdAt: input.now,
        updatedAt: input.now,
      });
      await tx.update(paperNoteBatches)
        .set({ pageCount: pageCount + 1, updatedAt: input.now })
        .where(eq(paperNoteBatches.id, input.batchId));
      return pageId;
    });
  }

  async getUploadTarget(
    createdBy: string,
    batchId: string,
    pageId: string,
  ): Promise<PaperNoteEditablePage | null> {
    const [row] = await this.database.select({
      id: paperNotePages.id,
      batchId: paperNotePages.batchId,
      status: paperNotePages.status,
      originalObjectKey: paperNotePages.originalObjectKey,
      analysisObjectKey: paperNotePages.analysisObjectKey,
      sha256: paperNotePages.sha256,
    }).from(paperNotePages)
      .innerJoin(paperNoteBatches, eq(paperNoteBatches.id, paperNotePages.batchId))
      .where(and(
        eq(paperNotePages.id, pageId),
        eq(paperNotePages.batchId, batchId),
        eq(paperNoteBatches.createdBy, createdBy),
      ))
      .limit(1);
    return row ?? null;
  }

  async findDuplicateHash(batchId: string, pageId: string, sha256: string) {
    const [row] = await this.database.select({ id: paperNotePages.id }).from(paperNotePages)
      .where(and(
        eq(paperNotePages.batchId, batchId),
        eq(paperNotePages.sha256, sha256),
        ne(paperNotePages.id, pageId),
      ))
      .limit(1);
    return row?.id ?? null;
  }

  async finalizeUploadedPage(input: {
    pageId: string;
    sha256: string;
    width: number | null;
    height: number | null;
    now: Date;
  }) {
    const [row] = await this.database.update(paperNotePages).set({
      sha256: input.sha256,
      width: input.width,
      height: input.height,
      status: "uploaded",
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: input.now,
    }).where(eq(paperNotePages.id, input.pageId)).returning({ id: paperNotePages.id });
    if (!row) throw new PaperNoteRepositoryError("PAGE_NOT_FOUND", "Paper note page was not found.");
  }

  async reorderDraftPages(
    createdBy: string,
    batchId: string,
    orderedPageIds: string[],
    now: Date,
  ) {
    await this.database.transaction(async (tx) => {
      const [batch] = await tx.select({ status: paperNoteBatches.status })
        .from(paperNoteBatches)
        .where(and(eq(paperNoteBatches.id, batchId), eq(paperNoteBatches.createdBy, createdBy)))
        .limit(1)
        .for("update");
      if (!batch) throw new PaperNoteRepositoryError("BATCH_NOT_FOUND", "Paper note batch was not found.");
      if (batch.status !== "draft") {
        throw new PaperNoteRepositoryError("BATCH_NOT_EDITABLE", "This paper note batch can no longer be changed.");
      }

      const pages = await tx.select({ id: paperNotePages.id })
        .from(paperNotePages)
        .where(eq(paperNotePages.batchId, batchId));
      if (
        pages.length !== orderedPageIds.length ||
        new Set(orderedPageIds).size !== orderedPageIds.length ||
        pages.some((page) => !orderedPageIds.includes(page.id))
      ) {
        throw new PaperNoteRepositoryError("PAGE_NOT_FOUND", "Page order does not match this batch.");
      }

      // The database requires sort_order >= 0 and uniqueness is immediate.
      // Move every row into a collision-free positive range first, then write 0..N.
      const temporaryOffset = 1000;
      for (let index = 0; index < orderedPageIds.length; index += 1) {
        await tx.update(paperNotePages)
          .set({ sortOrder: temporaryOffset + index, updatedAt: now })
          .where(eq(paperNotePages.id, orderedPageIds[index]!));
      }
      for (let index = 0; index < orderedPageIds.length; index += 1) {
        await tx.update(paperNotePages)
          .set({ sortOrder: index, updatedAt: now })
          .where(eq(paperNotePages.id, orderedPageIds[index]!));
      }
      await tx.update(paperNoteBatches)
        .set({ updatedAt: now })
        .where(eq(paperNoteBatches.id, batchId));
    });
  }

  async setDraftPageRotation(
    createdBy: string,
    batchId: string,
    pageId: string,
    rotationDegrees: 0 | 90 | 180 | 270,
    now: Date,
  ) {
    await this.database.transaction(async (tx) => {
      const [batch] = await tx.select({ status: paperNoteBatches.status })
        .from(paperNoteBatches)
        .where(and(eq(paperNoteBatches.id, batchId), eq(paperNoteBatches.createdBy, createdBy)))
        .limit(1)
        .for("update");
      if (!batch) throw new PaperNoteRepositoryError("BATCH_NOT_FOUND", "Paper note batch was not found.");
      if (batch.status !== "draft") {
        throw new PaperNoteRepositoryError("BATCH_NOT_EDITABLE", "This paper note batch can no longer be changed.");
      }

      const [page] = await tx.select({ id: paperNotePages.id })
        .from(paperNotePages)
        .where(and(eq(paperNotePages.id, pageId), eq(paperNotePages.batchId, batchId)))
        .limit(1)
        .for("update");
      if (!page) throw new PaperNoteRepositoryError("PAGE_NOT_FOUND", "Paper note page was not found.");

      await tx.update(paperNotePages)
        .set({ rotationDegrees, updatedAt: now })
        .where(eq(paperNotePages.id, pageId));
      await tx.update(paperNoteBatches)
        .set({ updatedAt: now })
        .where(eq(paperNoteBatches.id, batchId));
    });
  }

  async deletePageRow(createdBy: string, batchId: string, pageId: string, now: Date) {
    return this.database.transaction(async (tx) => {
      const [batch] = await tx.select({ status: paperNoteBatches.status })
        .from(paperNoteBatches)
        .where(and(eq(paperNoteBatches.id, batchId), eq(paperNoteBatches.createdBy, createdBy)))
        .limit(1)
        .for("update");
      if (!batch) throw new PaperNoteRepositoryError("BATCH_NOT_FOUND", "Paper note batch was not found.");
      if (batch.status !== "draft") {
        throw new PaperNoteRepositoryError("BATCH_NOT_EDITABLE", "This paper note batch can no longer be changed.");
      }

      const [page] = await tx.select({
        originalObjectKey: paperNotePages.originalObjectKey,
        analysisObjectKey: paperNotePages.analysisObjectKey,
      }).from(paperNotePages)
        .where(and(eq(paperNotePages.id, pageId), eq(paperNotePages.batchId, batchId)))
        .limit(1);
      if (!page) throw new PaperNoteRepositoryError("PAGE_NOT_FOUND", "Paper note page was not found.");

      await tx.delete(paperNotePages).where(eq(paperNotePages.id, pageId));
      const [pageCountRow] = await tx.select({ value: count() })
        .from(paperNotePages)
        .where(eq(paperNotePages.batchId, batchId));
      await tx.update(paperNoteBatches)
        .set({ pageCount: Number(pageCountRow?.value ?? 0), updatedAt: now })
        .where(eq(paperNoteBatches.id, batchId));
      return page;
    });
  }

  async listDraftPageObjects(createdBy: string, batchId: string) {
    const [batch] = await this.database.select({ status: paperNoteBatches.status })
      .from(paperNoteBatches)
      .where(and(eq(paperNoteBatches.id, batchId), eq(paperNoteBatches.createdBy, createdBy)))
      .limit(1);
    if (!batch) throw new PaperNoteRepositoryError("BATCH_NOT_FOUND", "Paper note batch was not found.");
    if (batch.status !== "draft" && batch.status !== "failed") {
      throw new PaperNoteRepositoryError("BATCH_NOT_EDITABLE", "This paper note batch can no longer be deleted.");
    }
    return this.database.select({
      originalObjectKey: paperNotePages.originalObjectKey,
      analysisObjectKey: paperNotePages.analysisObjectKey,
    }).from(paperNotePages).where(eq(paperNotePages.batchId, batchId));
  }

  async deleteDraftBatchRow(createdBy: string, batchId: string) {
    const [row] = await this.database.delete(paperNoteBatches).where(and(
      eq(paperNoteBatches.id, batchId),
      eq(paperNoteBatches.createdBy, createdBy),
    )).returning({ id: paperNoteBatches.id });
    if (!row) throw new PaperNoteRepositoryError("BATCH_NOT_FOUND", "Paper note batch was not found.");
  }

  async queueBatch(createdBy: string, batchId: string, now: Date) {
    await this.database.transaction(async (tx) => {
      const [batch] = await tx.select({ status: paperNoteBatches.status })
        .from(paperNoteBatches)
        .where(and(eq(paperNoteBatches.id, batchId), eq(paperNoteBatches.createdBy, createdBy)))
        .limit(1)
        .for("update");
      if (!batch) throw new PaperNoteRepositoryError("BATCH_NOT_FOUND", "Paper note batch was not found.");
      if (batch.status !== "draft" && batch.status !== "failed") {
        throw new PaperNoteRepositoryError("BATCH_NOT_EDITABLE", "This paper note batch cannot be queued.");
      }

      const pages = await tx.select({ id: paperNotePages.id, status: paperNotePages.status })
        .from(paperNotePages)
        .where(eq(paperNotePages.batchId, batchId));
      if (!pages.length || pages.some((page) => page.status !== "uploaded" && page.status !== "needs_retry")) {
        throw new PaperNoteRepositoryError(
          "PAGES_INCOMPLETE",
          "Finish uploading every retained page before reading paper notes.",
        );
      }

      await tx.update(paperNotePages)
        .set({ status: "queued", currentStage: "prepare", updatedAt: now })
        .where(eq(paperNotePages.batchId, batchId));
      await tx.update(paperNoteBatches)
        .set({ status: "queued", failureCode: null, failureMessage: null, updatedAt: now })
        .where(eq(paperNoteBatches.id, batchId));
    });
  }

  private async toBatchListItem(
    batch: typeof paperNoteBatches.$inferSelect,
  ): Promise<PaperNoteBatchListItem> {
    const [pageCountRows, entryRows] = await Promise.all([
      this.database.select({ value: count() })
        .from(paperNotePages)
        .where(eq(paperNotePages.batchId, batch.id)),
      this.database.select({ state: paperNoteEntries.state, value: count() })
        .from(paperNoteEntries)
        .where(eq(paperNoteEntries.batchId, batch.id))
        .groupBy(paperNoteEntries.state),
    ]);
    const states = new Map(entryRows.map((row) => [row.state, Number(row.value)]));
    const [failedPages] = await this.database.select({ value: count() })
      .from(paperNotePages)
      .where(and(eq(paperNotePages.batchId, batch.id), eq(paperNotePages.status, "needs_retry")));
    return {
      id: batch.id,
      name: batch.name,
      status: batch.status,
      pageCount: Number(pageCountRows[0]?.value ?? 0),
      extractedEntryCount: [...states.values()].reduce((sum, value) => sum + value, 0),
      needsReviewCount: states.get("needs_review") ?? 0,
      readyCount: states.get("ready") ?? 0,
      approvedCount: states.get("approved") ?? 0,
      skippedCount: states.get("skipped") ?? 0,
      failedPageCount: Number(failedPages?.value ?? 0),
      importedAt: batch.importedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
    };
  }
}
