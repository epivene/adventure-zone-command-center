import { randomUUID } from "node:crypto";

import { and, eq, ne, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  paperNoteBatches,
  paperNoteEntries,
  paperNotePages,
} from "@/db/schema";
import type { PaperNotePageStage } from "./paper-note-types";
import { firstQueryRow } from "./paper-note-query-rows";
import type {
  PaperNoteExtraction,
  PaperNotePageSegmentation,
} from "./paper-note-extraction-schema";

export type ClaimedPaperNotePage = {
  batchId: string;
  pageId: string;
  originalObjectKey: string;
  analysisObjectKey: string | null;
  declaredMimeType: string;
  rotationDegrees: 0 | 90 | 180 | 270;
  attemptCount: number;
  leaseToken: string;
  leaseExpiresAt: Date;
};

export class PaperNoteExtractionRepositoryError extends Error {
  constructor(
    public readonly code: "STALE_LEASE" | "IMPORTED_ENTRY_PRESENT",
    message: string,
  ) {
    super(message);
    this.name = "PaperNoteExtractionRepositoryError";
  }
}

type DrizzleDatabase = typeof database;

type ClaimedRow = {
  pageId: string;
  batchId: string;
  originalObjectKey: string;
  analysisObjectKey: string | null;
  mimeType: string;
  rotationDegrees: number;
  attemptCount: number;
};

function isClaimedRow(row: Record<string, unknown>): row is ClaimedRow {
  return typeof row.pageId === "string"
    && typeof row.batchId === "string"
    && typeof row.originalObjectKey === "string"
    && (row.analysisObjectKey === null || typeof row.analysisObjectKey === "string")
    && typeof row.mimeType === "string"
    && typeof row.rotationDegrees === "number"
    && typeof row.attemptCount === "number";
}

function isCountRow(row: Record<string, unknown>): row is { count: number } {
  return typeof row.count === "number";
}

export class PaperNoteExtractionRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async claimNextPage(input: {
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<ClaimedPaperNotePage | null> {
    void input.workerId;
    return this.database.transaction(async (tx) => {
      const result = await tx.execute(sql`
        select
          pages.id as "pageId",
          pages.batch_id as "batchId",
          pages.original_object_key as "originalObjectKey",
          pages.analysis_object_key as "analysisObjectKey",
          pages.mime_type as "mimeType",
          pages.rotation_degrees as "rotationDegrees",
          pages.attempt_count as "attemptCount"
        from paper_note_pages pages
        join paper_note_batches batches on batches.id = pages.batch_id
        where (
          pages.status = 'queued'
          or (
            pages.status = 'extracting'
            and pages.lease_expires_at is not null
            and pages.lease_expires_at < ${input.now}
          )
        )
          and batches.status in ('queued', 'extracting')
          and pages.attempt_count < 3
        order by pages.created_at asc, pages.sort_order asc, pages.id asc
        for update of pages skip locked
        limit 1
      `);
      const row = firstQueryRow(result, isClaimedRow);
      if (!row) return null;

      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
      const attemptCount = Number(row.attemptCount) + 1;
      await tx.update(paperNotePages).set({
        status: "extracting",
        currentStage: "prepare",
        attemptCount,
        leaseToken,
        leaseExpiresAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: input.now,
      }).where(eq(paperNotePages.id, row.pageId));
      await tx.execute(sql`
        update paper_note_batches
        set
          status = 'extracting',
          extraction_started_at = coalesce(extraction_started_at, ${input.now}),
          updated_at = ${input.now}
        where id = ${row.batchId}::uuid
      `);

      return {
        batchId: row.batchId,
        pageId: row.pageId,
        originalObjectKey: row.originalObjectKey,
        analysisObjectKey: row.analysisObjectKey,
        declaredMimeType: row.mimeType,
        rotationDegrees: row.rotationDegrees as 0 | 90 | 180 | 270,
        attemptCount,
        leaseToken,
        leaseExpiresAt,
      };
    });
  }

  async updateStage(input: {
    pageId: string;
    leaseToken: string;
    stage: PaperNotePageStage;
    contextPatch?: Record<string, unknown>;
    now: Date;
  }) {
    await this.database.transaction(async (tx) => {
      const [page] = await tx.select({
        id: paperNotePages.id,
        pageContext: paperNotePages.pageContext,
      }).from(paperNotePages).where(and(
        eq(paperNotePages.id, input.pageId),
        eq(paperNotePages.status, "extracting"),
        eq(paperNotePages.leaseToken, input.leaseToken),
      )).limit(1).for("update");
      if (!page) {
        throw new PaperNoteExtractionRepositoryError(
          "STALE_LEASE",
          "This paper-note extraction lease is no longer current.",
        );
      }
      const currentContext = page.pageContext && typeof page.pageContext === "object"
        ? page.pageContext
        : {};
      await tx.update(paperNotePages).set({
        currentStage: input.stage,
        pageContext: { ...currentContext, ...(input.contextPatch ?? {}) },
        updatedAt: input.now,
      }).where(eq(paperNotePages.id, input.pageId));
    });
  }

  async completePage(input: {
    pageId: string;
    leaseToken: string;
    analysisObjectKey: string;
    segmentation: PaperNotePageSegmentation;
    entries: PaperNoteExtraction[];
    now: Date;
  }) {
    await this.database.transaction(async (tx) => {
      const [page] = await tx.select({
        id: paperNotePages.id,
        batchId: paperNotePages.batchId,
      }).from(paperNotePages).where(and(
        eq(paperNotePages.id, input.pageId),
        eq(paperNotePages.status, "extracting"),
        eq(paperNotePages.leaseToken, input.leaseToken),
      )).limit(1).for("update");
      if (!page) {
        throw new PaperNoteExtractionRepositoryError(
          "STALE_LEASE",
          "This paper-note extraction lease is no longer current.",
        );
      }

      const [imported] = await tx.select({ id: paperNoteEntries.id })
        .from(paperNoteEntries)
        .where(and(
          eq(paperNoteEntries.pageId, input.pageId),
          eq(paperNoteEntries.state, "imported"),
        ))
        .limit(1);
      if (imported) {
        throw new PaperNoteExtractionRepositoryError(
          "IMPORTED_ENTRY_PRESENT",
          "Imported paper-note entries cannot be replaced.",
        );
      }

      await tx.delete(paperNoteEntries).where(and(
        eq(paperNoteEntries.pageId, input.pageId),
        ne(paperNoteEntries.state, "imported"),
      ));

      if (input.entries.length) {
        await tx.insert(paperNoteEntries).values(input.entries.map((entry, index) => ({
          batchId: page.batchId,
          pageId: input.pageId,
          sourceOrder: input.segmentation.entries[index]?.sourceOrder ?? index,
          sourceRegion: entry.sourceRegion ?? input.segmentation.entries[index]?.region ?? null,
          extractionPayload: entry as unknown as Record<string, unknown>,
          reviewPayload: {},
          reviewVersion: 0,
          state: "needs_review" as const,
          validationIssues: entry.warnings,
          createdAt: input.now,
          updatedAt: input.now,
        })));
      }

      await tx.update(paperNotePages).set({
        analysisObjectKey: input.analysisObjectKey,
        status: "extracted",
        currentStage: "complete",
        pageHeading: input.segmentation.pageHeading,
        pageActivityDate: input.segmentation.pageActivityDate,
        pageContext: { notes: input.segmentation.pageContext },
        roughTranscription: input.segmentation.roughTranscription,
        leaseToken: null,
        leaseExpiresAt: null,
        extractedAt: input.now,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: input.now,
      }).where(eq(paperNotePages.id, input.pageId));

      await this.refreshBatchState(tx as unknown as DrizzleDatabase, page.batchId, input.now);
    });
  }

  async failPage(input: {
    pageId: string;
    leaseToken: string;
    errorCode: string;
    safeMessage: string;
    retryable: boolean;
    now: Date;
  }) {
    await this.database.transaction(async (tx) => {
      const [page] = await tx.select({
        id: paperNotePages.id,
        batchId: paperNotePages.batchId,
      }).from(paperNotePages).where(and(
        eq(paperNotePages.id, input.pageId),
        eq(paperNotePages.status, "extracting"),
        eq(paperNotePages.leaseToken, input.leaseToken),
      )).limit(1).for("update");
      if (!page) {
        throw new PaperNoteExtractionRepositoryError(
          "STALE_LEASE",
          "This paper-note extraction lease is no longer current.",
        );
      }
      await tx.update(paperNotePages).set({
        status: "needs_retry",
        currentStage: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode.slice(0, 120),
        lastErrorMessage: input.safeMessage.slice(0, 500),
        updatedAt: input.now,
      }).where(eq(paperNotePages.id, input.pageId));
      void input.retryable;
      await this.refreshBatchState(tx as unknown as DrizzleDatabase, page.batchId, input.now);
    });
  }

  private async refreshBatchState(
    tx: DrizzleDatabase,
    batchId: string,
    now: Date,
  ) {
    const result = await tx.execute(sql`
      select count(*)::int as count
      from paper_note_pages
      where batch_id = ${batchId}::uuid
        and status not in ('extracted', 'needs_retry', 'reviewed_empty')
    `);
    const unresolved = Number(firstQueryRow(result, isCountRow)?.count ?? 0);
    if (unresolved === 0) {
      await tx.execute(sql`
        update paper_note_batches
        set
          status = 'review',
          review_started_at = coalesce(review_started_at, ${now}),
          updated_at = ${now}
        where id = ${batchId}::uuid
      `);
    } else {
      await tx.execute(sql`
        update paper_note_batches
        set status = 'extracting', updated_at = ${now}
        where id = ${batchId}::uuid
      `);
    }
  }
}
