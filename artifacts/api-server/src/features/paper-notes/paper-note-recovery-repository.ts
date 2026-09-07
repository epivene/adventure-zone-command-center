import { and, eq, inArray, ne, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  paperNoteBatches,
  paperNoteEntries,
  paperNotePages,
} from "@/db/schema";
import type { PaperNoteExtraction } from "./paper-note-extraction-schema";
import { firstQueryRow } from "./paper-note-query-rows";

type DrizzleDatabase = typeof database;

type LockedPageRow = {
  id: string;
  status: string;
  extractedAt: Date | null;
  batchStatus: string;
};

function isValueRow(row: Record<string, unknown>): row is { value: number } {
  return typeof row.value === "number";
}

function isCountRow(row: Record<string, unknown>): row is { count: number } {
  return typeof row.count === "number";
}

function isLockedPageRow(row: Record<string, unknown>): row is LockedPageRow {
  return typeof row.id === "string"
    && typeof row.status === "string"
    && (row.extractedAt === null || row.extractedAt instanceof Date)
    && typeof row.batchStatus === "string";
}

export type PaperNoteRecoveryErrorCode =
  | "BATCH_NOT_FOUND"
  | "PAGE_NOT_FOUND"
  | "PAGE_NOT_RETRYABLE"
  | "PAGE_NOT_EDITABLE";

export class PaperNoteRecoveryError extends Error {
  constructor(
    public readonly code: PaperNoteRecoveryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaperNoteRecoveryError";
  }
}

function manualExtraction(transcription: string): PaperNoteExtraction {
  return {
    source: "manual",
    transcription,
    sourceRegion: null,
    mayContinue: false,
    event: { name: null, city: null, region: null, venue: null },
    eventDates: [],
    activity: {
      rawDateText: null,
      occurredOn: null,
      dateSource: "unknown",
      method: "unknown",
      outcome: null,
      summary: null,
    },
    contacts: [],
    organizationPhones: [],
    oldReminder: null,
    starredOnPaper: false,
    generalNotes: [],
    warnings: [{
      fieldPath: "event.name",
      message: "Review the manual transcription and enter the event/profile name.",
      severity: "blocking",
    }],
  };
}

export class PaperNoteRecoveryRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async retryPage(createdBy: string, batchId: string, pageId: string, now: Date) {
    await this.database.transaction(async (tx) => {
      const page = await this.lockOwnedPage(tx as unknown as DrizzleDatabase, createdBy, batchId, pageId);
      if (page.status !== "needs_retry") {
        throw new PaperNoteRecoveryError(
          "PAGE_NOT_RETRYABLE",
          "Only a page that needs attention can be retried.",
        );
      }
      await tx.update(paperNotePages).set({
        status: "queued",
        currentStage: "prepare",
        attemptCount: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: now,
      }).where(eq(paperNotePages.id, pageId));
      await tx.update(paperNoteBatches).set({
        status: "queued",
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      }).where(eq(paperNoteBatches.id, batchId));
    });
  }

  async addManualEntry(
    createdBy: string,
    batchId: string,
    pageId: string,
    transcription: string,
    now: Date,
  ) {
    const clean = transcription.trim();
    return this.database.transaction(async (tx) => {
      const page = await this.lockOwnedPage(tx as unknown as DrizzleDatabase, createdBy, batchId, pageId);
      if (page.status === "reviewed_empty") {
        throw new PaperNoteRecoveryError(
          "PAGE_NOT_EDITABLE",
          "This page was already marked as having no importable entries.",
        );
      }
      const [protectedEntry] = await tx.select({ id: paperNoteEntries.id })
        .from(paperNoteEntries)
        .where(and(
          eq(paperNoteEntries.pageId, pageId),
          inArray(paperNoteEntries.state, ["approved", "imported"]),
        ))
        .limit(1);
      if (protectedEntry) {
        throw new PaperNoteRecoveryError(
          "PAGE_NOT_EDITABLE",
          "Approved or imported entries cannot be replaced by a manual entry.",
        );
      }

      const orderResult = await tx.execute(sql`
        select coalesce(max(source_order), -1)::int as value
        from paper_note_entries
        where page_id = ${pageId}::uuid
      `);
      const currentMax = Number(firstQueryRow(orderResult, isValueRow)?.value ?? -1);
      const extraction = manualExtraction(clean);
      const [entry] = await tx.insert(paperNoteEntries).values({
        batchId,
        pageId,
        sourceOrder: currentMax + 1,
        sourceRegion: null,
        extractionPayload: extraction as unknown as Record<string, unknown>,
        reviewPayload: {},
        reviewVersion: 0,
        state: "needs_review",
        validationIssues: extraction.warnings,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: paperNoteEntries.id });
      if (!entry) throw new Error("Manual paper-note entry could not be created.");

      await tx.update(paperNotePages).set({
        status: "extracted",
        currentStage: "complete",
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        extractedAt: page.extractedAt ?? now,
        updatedAt: now,
      }).where(eq(paperNotePages.id, pageId));
      await this.refreshBatchState(tx as unknown as DrizzleDatabase, batchId, now);
      return entry.id;
    });
  }

  async markReviewedEmpty(createdBy: string, batchId: string, pageId: string, now: Date) {
    await this.database.transaction(async (tx) => {
      await this.lockOwnedPage(tx as unknown as DrizzleDatabase, createdBy, batchId, pageId);
      const [protectedEntry] = await tx.select({ id: paperNoteEntries.id })
        .from(paperNoteEntries)
        .where(and(
          eq(paperNoteEntries.pageId, pageId),
          inArray(paperNoteEntries.state, ["approved", "imported"]),
        ))
        .limit(1);
      if (protectedEntry) {
        throw new PaperNoteRecoveryError(
          "PAGE_NOT_EDITABLE",
          "Approved or imported entries prevent marking this page empty.",
        );
      }
      await tx.delete(paperNoteEntries).where(and(
        eq(paperNoteEntries.pageId, pageId),
        ne(paperNoteEntries.state, "imported"),
      ));
      await tx.update(paperNotePages).set({
        status: "reviewed_empty",
        currentStage: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: now,
      }).where(eq(paperNotePages.id, pageId));
      await this.refreshBatchState(tx as unknown as DrizzleDatabase, batchId, now);
    });
  }

  private async lockOwnedPage(
    tx: DrizzleDatabase,
    createdBy: string,
    batchId: string,
    pageId: string,
  ) {
    const result = await tx.execute(sql`
      select
        pages.id,
        pages.status,
        pages.extracted_at as "extractedAt",
        batches.status as "batchStatus"
      from paper_note_pages pages
      join paper_note_batches batches on batches.id = pages.batch_id
      where pages.id = ${pageId}::uuid
        and pages.batch_id = ${batchId}::uuid
        and batches.created_by = ${createdBy}
      for update of pages, batches
      limit 1
    `);
    const row = firstQueryRow(result, isLockedPageRow);
    if (!row) {
      throw new PaperNoteRecoveryError(
        "PAGE_NOT_FOUND",
        "Paper-note page was not found.",
      );
    }
    if (row.batchStatus === "importing" || row.batchStatus === "imported" || row.batchStatus === "archived") {
      throw new PaperNoteRecoveryError(
        "PAGE_NOT_EDITABLE",
        "Imported paper-note pages cannot be changed.",
      );
    }
    return row;
  }

  private async refreshBatchState(tx: DrizzleDatabase, batchId: string, now: Date) {
    const result = await tx.execute(sql`
      select count(*)::int as count
      from paper_note_pages
      where batch_id = ${batchId}::uuid
        and status not in ('extracted', 'needs_retry', 'reviewed_empty')
    `);
    const unresolved = Number(firstQueryRow(result, isCountRow)?.count ?? 0);
    await tx.execute(unresolved === 0 ? sql`
      update paper_note_batches
      set status = 'review',
          review_started_at = coalesce(review_started_at, ${now}),
          updated_at = ${now}
      where id = ${batchId}::uuid
    ` : sql`
      update paper_note_batches
      set status = 'extracting', updated_at = ${now}
      where id = ${batchId}::uuid
    `);
  }
}
