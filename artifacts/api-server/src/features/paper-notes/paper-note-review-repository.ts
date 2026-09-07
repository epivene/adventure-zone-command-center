import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import type { PaperNoteExtraction } from "./paper-note-extraction-schema";
import { recoverPaperNoteFutureActionReminder } from "./paper-note-future-action-reminder";
import { initializePaperNoteReview, type PaperNoteReviewDraft } from "./paper-note-review-initializer";
import type { PaperNoteReviewIssue } from "./paper-note-review-schema";
import { firstQueryRow } from "./paper-note-query-rows";
import { paperNoteEntryStateValues, type PaperNoteEntryState } from "./paper-note-types";
import type {
  PaperNoteReviewMutationView,
  PaperNoteReviewStore,
} from "./paper-note-review-service";
import { capturePaperNoteTargetSnapshot } from "./paper-note-target-snapshot";

type DrizzleDatabase = typeof database;

export type PaperNoteReviewRepositoryErrorCode =
  | "ENTRY_NOT_FOUND"
  | "STALE_REVIEW_VERSION"
  | "ENTRY_NOT_EDITABLE";

export class PaperNoteReviewRepositoryError extends Error {
  constructor(
    public readonly code: PaperNoteReviewRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaperNoteReviewRepositoryError";
  }
}

type ReviewRow = {
  id: string;
  extractionPayload: unknown;
  reviewPayload: unknown;
  reviewVersion: number;
  state: PaperNoteReviewMutationView["state"];
  validationIssues: unknown;
  approvedAt: Date | string | null;
};

type ReviewMutationMissRow = { reviewVersion: number; state: string };

function isPaperNoteEntryState(value: unknown): value is PaperNoteEntryState {
  return typeof value === "string"
    && paperNoteEntryStateValues.some((state) => state === value);
}

function isReviewRow(row: Record<string, unknown>): row is ReviewRow {
  return typeof row.id === "string"
    && "extractionPayload" in row
    && "reviewPayload" in row
    && typeof row.reviewVersion === "number"
    && isPaperNoteEntryState(row.state)
    && "validationIssues" in row
    && (row.approvedAt === null || typeof row.approvedAt === "string" || row.approvedAt instanceof Date);
}

function isReviewMutationMissRow(row: Record<string, unknown>): row is ReviewMutationMissRow {
  return typeof row.reviewVersion === "number" && typeof row.state === "string";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonBlank(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function applyRecoveredFutureActionReminder(
  extractionPayload: PaperNoteExtraction,
  review: PaperNoteReviewDraft,
  savedActivity: Record<string, unknown>,
): PaperNoteReviewDraft {
  const existingReminder = extractionPayload.oldReminder?.trim() || review.oldReminder.trim();
  const recovered = recoverPaperNoteFutureActionReminder(
    existingReminder || extractionPayload.transcription,
  );
  if (!recovered) return review;

  const extractionHasAlternateMethodEvidence = Boolean(
    extractionPayload.activity.outcome?.trim()
    || extractionPayload.activity.summary?.trim(),
  );
  const savedHasAlternateMethodEvidence = Boolean(
    nonBlank(savedActivity.outcome)
    || nonBlank(savedActivity.summary),
  );
  const savedMethod = typeof savedActivity.method === "string"
    ? savedActivity.method
    : review.activity.method;
  const shouldUseCallMethod = Boolean(
    recovered.method
    && recovered.method === extractionPayload.activity.method
    && savedMethod === extractionPayload.activity.method
    && !extractionHasAlternateMethodEvidence
    && !savedHasAlternateMethodEvidence,
  );

  return {
    ...review,
    oldReminder: review.oldReminder.trim() || extractionPayload.oldReminder?.trim() || recovered.text,
    activity: shouldUseCallMethod
      ? { ...review.activity, method: "call" }
      : review.activity,
  };
}

export function hydratePaperNoteReview(
  extractionPayload: PaperNoteExtraction,
  reviewPayload: unknown,
): PaperNoteReviewDraft {
  const base = initializePaperNoteReview(extractionPayload);
  const saved = asObject(reviewPayload);
  if (!saved.event || !saved.activity || !("destination" in saved)) {
    return applyRecoveredFutureActionReminder(extractionPayload, base, {});
  }

  const savedEvent = asObject(saved.event);
  const savedActivity = asObject(saved.activity);
  const savedCurrentFollowUp = asObject(saved.currentFollowUp);

  const hydrated = {
    ...base,
    ...saved,
    event: { ...base.event, ...savedEvent },
    activity: { ...base.activity, ...savedActivity },
    contacts: Array.isArray(saved.contacts)
      ? saved.contacts as PaperNoteReviewDraft["contacts"]
      : base.contacts,
    organizationPhones: Array.isArray(saved.organizationPhones)
      ? saved.organizationPhones as PaperNoteReviewDraft["organizationPhones"]
      : base.organizationPhones,
    generalNotes: Array.isArray(saved.generalNotes)
      ? saved.generalNotes as PaperNoteReviewDraft["generalNotes"]
      : base.generalNotes,
    conflicts: saved.conflicts && typeof saved.conflicts === "object" && !Array.isArray(saved.conflicts)
      ? saved.conflicts as PaperNoteReviewDraft["conflicts"]
      : base.conflicts,
    currentFollowUp: {
      ...base.currentFollowUp,
      ...savedCurrentFollowUp,
    },
    destination: saved.destination as PaperNoteReviewDraft["destination"],
  } as PaperNoteReviewDraft;

  return applyRecoveredFutureActionReminder(extractionPayload, hydrated, savedActivity);
}

function reviewFrom(row: Pick<ReviewRow, "extractionPayload" | "reviewPayload">): PaperNoteReviewDraft {
  return hydratePaperNoteReview(
    row.extractionPayload as PaperNoteExtraction,
    row.reviewPayload,
  );
}

function issuesFrom(value: unknown): PaperNoteReviewIssue[] {
  return Array.isArray(value) ? value as PaperNoteReviewIssue[] : [];
}

function mutationView(row: ReviewRow): PaperNoteReviewMutationView {
  return {
    id: row.id,
    review: reviewFrom(row),
    reviewVersion: Number(row.reviewVersion),
    state: row.state,
    validationIssues: issuesFrom(row.validationIssues),
    approvedAt: row.approvedAt ? new Date(row.approvedAt).toISOString() : null,
  };
}

export class PaperNoteReviewRepository implements PaperNoteReviewStore {
  constructor(private readonly database: DrizzleDatabase) {}

  async getForReview(actorId: string, entryId: string) {
    const result = await this.database.execute(sql`
      select
        entries.id,
        entries.extraction_payload as "extractionPayload",
        entries.review_payload as "reviewPayload",
        entries.review_version as "reviewVersion",
        entries.state,
        entries.validation_issues as "validationIssues",
        entries.approved_at as "approvedAt"
      from paper_note_entries entries
      join paper_note_batches batches on batches.id = entries.batch_id
      where entries.id = ${entryId}::uuid
        and batches.created_by = ${actorId}
      limit 1
    `);
    const row = firstQueryRow(result, isReviewRow);
    if (!row) return null;
    return {
      review: reviewFrom(row),
      validationIssues: issuesFrom(row.validationIssues),
      state: row.state,
      reviewVersion: Number(row.reviewVersion),
      extraction: row.extractionPayload as PaperNoteExtraction,
      approvedAt: row.approvedAt ? new Date(row.approvedAt).toISOString() : null,
    };
  }

  async saveReview(input: {
    actorId: string;
    entryId: string;
    expectedVersion: number;
    review: PaperNoteReviewDraft;
    state: "needs_review" | "ready";
    validationIssues: PaperNoteReviewIssue[];
    approvedAt: null;
    now: Date;
  }) {
    const targetSnapshot = await capturePaperNoteTargetSnapshot(this.database, input.review);
    const result = await this.database.execute(sql`
      update paper_note_entries entries
      set
        review_payload = ${JSON.stringify(input.review)}::jsonb,
        review_version = entries.review_version + 1,
        state = ${input.state},
        validation_issues = ${JSON.stringify(input.validationIssues)}::jsonb,
        target_snapshot = ${targetSnapshot ? JSON.stringify(targetSnapshot) : null}::jsonb,
        approved_at = null,
        updated_at = ${input.now}
      from paper_note_batches batches
      where entries.id = ${input.entryId}::uuid
        and entries.batch_id = batches.id
        and batches.created_by = ${input.actorId}
        and entries.review_version = ${input.expectedVersion}
        and entries.state <> 'imported'
      returning
        entries.id,
        entries.extraction_payload as "extractionPayload",
        entries.review_payload as "reviewPayload",
        entries.review_version as "reviewVersion",
        entries.state,
        entries.validation_issues as "validationIssues",
        entries.approved_at as "approvedAt"
    `);
    const row = firstQueryRow(result, isReviewRow);
    if (!row) await this.throwMutationMiss(input.actorId, input.entryId, input.expectedVersion);
    return mutationView(row!);
  }

  approve(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }) {
    return this.changeState(input, "approved", input.now);
  }

  unapprove(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }) {
    return this.changeState(input, "ready", null);
  }

  skip(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }) {
    return this.changeState(input, "skipped", null);
  }

  private async changeState(
    input: { actorId: string; entryId: string; expectedVersion: number; now: Date },
    state: "approved" | "ready" | "skipped",
    approvedAt: Date | null,
  ) {
    const result = await this.database.execute(sql`
      update paper_note_entries entries
      set
        review_version = entries.review_version + 1,
        state = ${state},
        approved_at = ${approvedAt},
        updated_at = ${input.now}
      from paper_note_batches batches
      where entries.id = ${input.entryId}::uuid
        and entries.batch_id = batches.id
        and batches.created_by = ${input.actorId}
        and entries.review_version = ${input.expectedVersion}
        and entries.state <> 'imported'
      returning
        entries.id,
        entries.extraction_payload as "extractionPayload",
        entries.review_payload as "reviewPayload",
        entries.review_version as "reviewVersion",
        entries.state,
        entries.validation_issues as "validationIssues",
        entries.approved_at as "approvedAt"
    `);
    const row = firstQueryRow(result, isReviewRow);
    if (!row) await this.throwMutationMiss(input.actorId, input.entryId, input.expectedVersion);
    return mutationView(row!);
  }

  private async throwMutationMiss(actorId: string, entryId: string, expectedVersion: number): Promise<never> {
    const result = await this.database.execute(sql`
      select entries.review_version as "reviewVersion", entries.state
      from paper_note_entries entries
      join paper_note_batches batches on batches.id = entries.batch_id
      where entries.id = ${entryId}::uuid
        and batches.created_by = ${actorId}
      limit 1
    `);
    const row = firstQueryRow(result, isReviewMutationMissRow);
    if (!row) throw new PaperNoteReviewRepositoryError("ENTRY_NOT_FOUND", "Paper-note entry was not found.");
    if (row.state === "imported") throw new PaperNoteReviewRepositoryError("ENTRY_NOT_EDITABLE", "Imported paper-note entries are read-only.");
    if (Number(row.reviewVersion) !== expectedVersion) {
      throw new PaperNoteReviewRepositoryError("STALE_REVIEW_VERSION", "This paper-note entry changed since you opened it. Reload the latest review before saving again.");
    }
    throw new PaperNoteReviewRepositoryError("ENTRY_NOT_EDITABLE", "This paper-note entry cannot be changed right now.");
  }
}
