import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import type { PaperNoteObjectStorage } from "./paper-note-object-storage";

type DrizzleDatabase = typeof database;

export type PaperNoteRereadTarget = {
  batchId: string;
  pageId: string;
  batchStatus: string;
  pageStatus: string;
  analysisObjectKey: string | null;
  hasEntries: boolean;
  hasImportedEntries: boolean;
};

export interface PaperNoteRereadRepository {
  getRereadTarget(
    actorId: string,
    batchId: string,
    pageId: string,
  ): Promise<PaperNoteRereadTarget | null>;
  resetForReread(input: {
    actorId: string;
    batchId: string;
    pageId: string;
    rotationDegrees: 0 | 90 | 180 | 270;
    now: Date;
  }): Promise<void>;
}

export type PaperNoteRereadErrorCode =
  | "PAGE_NOT_FOUND"
  | "PAGE_IMMUTABLE"
  | "PAGE_NOT_REREADABLE"
  | "REREAD_CONFIRMATION_REQUIRED"
  | "STORAGE_UNAVAILABLE";

export class PaperNoteRereadError extends Error {
  constructor(
    public readonly code: PaperNoteRereadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaperNoteRereadError";
  }
}

type RereadStorage = Pick<PaperNoteObjectStorage, "deletePageObjects">;

export class PaperNoteRereadService {
  constructor(
    private readonly repository: PaperNoteRereadRepository,
    private readonly storage: RereadStorage,
  ) {}

  async reread(input: {
    actorId: string;
    batchId: string;
    pageId: string;
    rotationDegrees: 0 | 90 | 180 | 270;
    confirmDiscardReview: boolean;
    now: Date;
  }) {
    const target = await this.repository.getRereadTarget(
      input.actorId,
      input.batchId,
      input.pageId,
    );
    if (!target) {
      throw new PaperNoteRereadError("PAGE_NOT_FOUND", "Paper-note page was not found.");
    }
    if (
      target.batchStatus === "imported" ||
      target.batchStatus === "archived" ||
      target.hasImportedEntries
    ) {
      throw new PaperNoteRereadError(
        "PAGE_IMMUTABLE",
        "Imported paper-note pages cannot be re-read.",
      );
    }
    if (!["extracted", "needs_retry", "reviewed_empty"].includes(target.pageStatus)) {
      throw new PaperNoteRereadError(
        "PAGE_NOT_REREADABLE",
        "This paper-note page is not ready to be re-read.",
      );
    }
    if (target.hasEntries && !input.confirmDiscardReview) {
      throw new PaperNoteRereadError(
        "REREAD_CONFIRMATION_REQUIRED",
        "Re-reading this page will discard its extracted entries and review corrections.",
      );
    }

    if (target.analysisObjectKey) {
      try {
        await this.storage.deletePageObjects({
          originalObjectKey: null,
          analysisObjectKey: target.analysisObjectKey,
        });
      } catch {
        throw new PaperNoteRereadError(
          "STORAGE_UNAVAILABLE",
          "The old analysis copy could not be removed. Try again before re-reading this page.",
        );
      }
    }

    await this.repository.resetForReread({
      actorId: input.actorId,
      batchId: input.batchId,
      pageId: input.pageId,
      rotationDegrees: input.rotationDegrees,
      now: input.now,
    });
    return { ok: true as const };
  }
}

export class DrizzlePaperNoteRereadRepository implements PaperNoteRereadRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async getRereadTarget(actorId: string, batchId: string, pageId: string) {
    const result = await this.database.execute(sql`
      select
        batches.id as "batchId",
        pages.id as "pageId",
        batches.status as "batchStatus",
        pages.status as "pageStatus",
        pages.analysis_object_key as "analysisObjectKey",
        exists(
          select 1 from paper_note_entries entries
          where entries.page_id = pages.id
        ) as "hasEntries",
        exists(
          select 1 from paper_note_entries entries
          where entries.page_id = pages.id and entries.state = 'imported'
        ) as "hasImportedEntries"
      from paper_note_pages pages
      join paper_note_batches batches on batches.id = pages.batch_id
      where pages.id = ${pageId}::uuid
        and pages.batch_id = ${batchId}::uuid
        and batches.created_by = ${actorId}
      limit 1
    `);
    return (result as { rows?: PaperNoteRereadTarget[] }).rows?.[0] ?? null;
  }

  async resetForReread(input: {
    actorId: string;
    batchId: string;
    pageId: string;
    rotationDegrees: 0 | 90 | 180 | 270;
    now: Date;
  }) {
    await this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as DrizzleDatabase;
      const locked = await tx.execute(sql`
        select pages.id
        from paper_note_pages pages
        join paper_note_batches batches on batches.id = pages.batch_id
        where pages.id = ${input.pageId}::uuid
          and pages.batch_id = ${input.batchId}::uuid
          and batches.created_by = ${input.actorId}
          and batches.status not in ('imported', 'archived')
          and not exists (
            select 1 from paper_note_entries entries
            where entries.page_id = pages.id and entries.state = 'imported'
          )
        for update of pages
      `);
      if (!(locked as { rows?: unknown[] }).rows?.length) {
        throw new PaperNoteRereadError(
          "PAGE_IMMUTABLE",
          "This paper-note page changed and can no longer be re-read.",
        );
      }

      await tx.execute(sql`
        delete from paper_note_entries
        where page_id = ${input.pageId}::uuid
          and state <> 'imported'
      `);
      await tx.execute(sql`
        update paper_note_pages
        set
          rotation_degrees = ${input.rotationDegrees},
          analysis_object_key = null,
          status = 'queued',
          current_stage = 'prepare',
          page_heading = null,
          page_activity_date = null,
          page_context = '{}'::jsonb,
          rough_transcription = null,
          attempt_count = 0,
          lease_token = null,
          lease_expires_at = null,
          last_error_code = null,
          last_error_message = null,
          extracted_at = null,
          updated_at = ${input.now}
        where id = ${input.pageId}::uuid
      `);
      await tx.execute(sql`
        update paper_note_batches
        set
          status = 'queued',
          failure_code = null,
          failure_message = null,
          updated_at = ${input.now}
        where id = ${input.batchId}::uuid
      `);
    });
  }
}
