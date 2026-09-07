import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { validatePaperNoteEventDate } from "./paper-note-event-date-validation";
import { firstQueryRow, queryRows } from "./paper-note-query-rows";
import { validatePaperNoteCurrentFollowUp } from "./paper-note-follow-up-validation";
import { validatePaperNotePrimaryContact } from "./paper-note-primary-contact-validation";
import { validatePaperNotePrimaryPhones } from "./paper-note-primary-phone-validation";
import type { PaperNoteObjectStorage } from "./paper-note-object-storage";
import type { PaperNoteImportSummary } from "./paper-note-types";
import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";
import { validatePaperNoteReview, type PaperNoteReviewPayload } from "./paper-note-review-schema";
import {
  loadPaperNoteTargetSnapshotValue,
  paperNoteTargetChanged,
  paperNoteTargetSnapshotHasMissing,
  type PaperNoteStoredTargetSnapshot,
  type PaperNoteTargetSnapshotValue,
} from "./paper-note-target-snapshot";

export type PaperNoteBatchPreflight = {
  ready: boolean;
  batchId: string;
  approvedCount: number;
  skippedCount: number;
  blocking: Array<{ entryId: string | null; code: string; message: string }>;
  preview: PaperNoteImportSummary;
};

export type PaperNotePreflightBatch = {
  id: string;
  status: string;
  pages: Array<{ id: string; status: string; originalObjectKey: string | null }>;
  entries: Array<{
    id: string;
    pageId: string;
    state: string;
    review: PaperNoteReviewDraft;
    targetSnapshot: PaperNoteStoredTargetSnapshot | null;
  }>;
};

export interface PaperNotePreflightRepository {
  loadBatch(actorId: string, batchId: string): Promise<PaperNotePreflightBatch | null>;
  targetExists(destination: NonNullable<PaperNoteReviewDraft["destination"]>): Promise<boolean>;
  currentTargetSnapshot(review: PaperNoteReviewDraft): Promise<PaperNoteTargetSnapshotValue | null>;
  returnEntryToReview(entryId: string, message: string, now: Date): Promise<void>;
}

type Storage = Pick<PaperNoteObjectStorage, "exists">;

function emptySummary(): PaperNoteImportSummary {
  return {
    profilesCreated: 0,
    profilesUpdated: 0,
    locationsCreated: 0,
    contactsCreated: 0,
    contactsLinked: 0,
    phonesCreatedOrUpdated: 0,
    historicalNotesCreated: 0,
    followUpsCreated: 0,
    entriesSkipped: 0,
  };
}

function addPreview(summary: PaperNoteImportSummary, entry: PaperNotePreflightBatch["entries"][number]) {
  if (entry.state === "skipped") {
    summary.entriesSkipped += 1;
    return;
  }
  const destination = entry.review.destination;
  if (!destination) return;
  if (destination.mode === "new_profile") summary.profilesCreated += 1;
  if (destination.mode === "existing_profile") summary.profilesUpdated += 1;
  if (destination.mode === "existing_profile_new_location") {
    summary.profilesUpdated += 1;
    summary.locationsCreated += 1;
  }
  summary.contactsCreated += entry.review.contacts.filter((contact) => contact.mode === "new_contact").length;
  summary.contactsLinked += entry.review.contacts.filter((contact) => contact.mode === "existing_contact").length;
  summary.phonesCreatedOrUpdated += entry.review.organizationPhones.filter((phone) => phone.importAsStructuredValue).length;
  summary.phonesCreatedOrUpdated += entry.review.contacts.reduce(
    (count, contact) => count + contact.phones.filter((phone) => phone.importAsStructuredValue).length,
    0,
  );
  summary.historicalNotesCreated += 1;
  if (entry.review.currentFollowUp.enabled) summary.followUpsCreated += 1;
}

function isExistingDestination(destination: NonNullable<PaperNoteReviewDraft["destination"]>) {
  return destination.mode === "existing_profile" || destination.mode === "existing_profile_new_location";
}

export class PaperNotePreflightService {
  constructor(
    private readonly repository: PaperNotePreflightRepository,
    private readonly storage: Storage,
  ) {}

  async preflight(input: { actorId: string; batchId: string; now: Date }): Promise<PaperNoteBatchPreflight> {
    const batch = await this.repository.loadBatch(input.actorId, input.batchId);
    const preview = emptySummary();
    const blocking: PaperNoteBatchPreflight["blocking"] = [];
    if (!batch) {
      return {
        ready: false,
        batchId: input.batchId,
        approvedCount: 0,
        skippedCount: 0,
        blocking: [{ entryId: null, code: "BATCH_NOT_FOUND", message: "Paper-note batch was not found." }],
        preview,
      };
    }

    if (batch.status === "importing") blocking.push({ entryId: null, code: "BATCH_IMPORTING", message: "This batch is already being imported." });
    if (batch.status === "imported" || batch.status === "archived") blocking.push({ entryId: null, code: "BATCH_ALREADY_IMPORTED", message: "This paper-note batch has already been imported." });

    for (const page of batch.pages) {
      if (page.status !== "extracted" && page.status !== "reviewed_empty") {
        blocking.push({ entryId: null, code: "PAGE_NOT_RESOLVED", message: "Every paper page must finish reading, be retried, or be marked as having no importable entries." });
      }
      if (!page.originalObjectKey || !(await this.storage.exists(page.originalObjectKey))) {
        blocking.push({ entryId: null, code: "SOURCE_MISSING", message: "A source paper photo is missing and must be restored before import." });
      }
    }

    const skipped = batch.entries.filter((entry) => entry.state === "skipped");
    let approvedCount = batch.entries.filter((entry) => entry.state === "approved").length;

    for (const entry of batch.entries) {
      if (entry.state !== "approved" && entry.state !== "skipped") {
        blocking.push({ entryId: entry.id, code: "ENTRY_NOT_FINAL", message: "Every paper entry must be Approved or Skipped before import." });
        continue;
      }
      if (entry.state === "skipped") {
        addPreview(preview, entry);
        continue;
      }
      if (!entry.review.destination) {
        blocking.push({ entryId: entry.id, code: "DESTINATION_MISSING", message: "Choose where this paper entry belongs." });
        continue;
      }

      const reviewIssues = [
        ...validatePaperNoteReview(entry.review as PaperNoteReviewPayload),
        ...validatePaperNoteEventDate(entry.review.event),
        ...validatePaperNoteCurrentFollowUp(entry.review),
        ...validatePaperNotePrimaryContact(entry.review),
        ...validatePaperNotePrimaryPhones(entry.review),
      ];
      for (const issue of reviewIssues.filter((issue) => issue.severity === "blocking")) {
        blocking.push({ entryId: entry.id, code: "ENTRY_INVALID", message: issue.message });
      }

      if (isExistingDestination(entry.review.destination)) {
        if (!(await this.repository.targetExists(entry.review.destination))) {
          const message = "The selected CRM profile or location is no longer available. Review this entry again.";
          await this.repository.returnEntryToReview(entry.id, message, input.now);
          approvedCount = Math.max(0, approvedCount - 1);
          blocking.push({ entryId: entry.id, code: "TARGET_MISSING", message });
          continue;
        }
        if (!entry.targetSnapshot) {
          const message = "This CRM destination was approved before stale-data protection was available. Review and approve this paper entry again.";
          await this.repository.returnEntryToReview(entry.id, message, input.now);
          approvedCount = Math.max(0, approvedCount - 1);
          blocking.push({ entryId: entry.id, code: "TARGET_REVIEW_REQUIRED", message });
          continue;
        }
        const currentTarget = await this.repository.currentTargetSnapshot(entry.review);
        if (!currentTarget || paperNoteTargetSnapshotHasMissing(currentTarget)) {
          const message = "A saved CRM record used by this paper entry is no longer available. Review the entry again before importing.";
          await this.repository.returnEntryToReview(entry.id, message, input.now);
          approvedCount = Math.max(0, approvedCount - 1);
          blocking.push({ entryId: entry.id, code: "TARGET_CHANGED", message });
          continue;
        }
        if (paperNoteTargetChanged(entry.targetSnapshot, currentTarget)) {
          const message = "The CRM information used for this paper entry changed since this paper entry was reviewed. Review it again before importing.";
          await this.repository.returnEntryToReview(entry.id, message, input.now);
          approvedCount = Math.max(0, approvedCount - 1);
          blocking.push({ entryId: entry.id, code: "TARGET_CHANGED", message });
          continue;
        }
      }

      addPreview(preview, entry);
    }

    if (approvedCount === 0) {
      blocking.push({ entryId: null, code: "NO_APPROVED_ENTRIES", message: "Approve at least one paper entry before importing the batch." });
    }

    return {
      ready: blocking.length === 0,
      batchId: batch.id,
      approvedCount,
      skippedCount: skipped.length,
      blocking,
      preview,
    };
  }
}

type DrizzleDatabase = typeof database;
type BatchRow = { id: string; status: string };
type PageRow = PaperNotePreflightBatch["pages"][number];
type EntryRow = { id: string; pageId: string; state: string; reviewPayload: unknown; targetSnapshot: unknown };

function isBatchRow(row: Record<string, unknown>): row is BatchRow {
  return typeof row.id === "string" && typeof row.status === "string";
}

function isPageRow(row: Record<string, unknown>): row is PageRow {
  return typeof row.id === "string"
    && typeof row.status === "string"
    && (row.originalObjectKey === null || typeof row.originalObjectKey === "string");
}

function isEntryRow(row: Record<string, unknown>): row is EntryRow {
  return typeof row.id === "string"
    && typeof row.pageId === "string"
    && typeof row.state === "string"
    && "reviewPayload" in row
    && "targetSnapshot" in row;
}

function targetSnapshotFrom(value: unknown): PaperNoteStoredTargetSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PaperNoteStoredTargetSnapshot>;
  return candidate.version === 1 && typeof candidate.fingerprint === "string"
    ? candidate as PaperNoteStoredTargetSnapshot
    : null;
}

export class DrizzlePaperNotePreflightRepository implements PaperNotePreflightRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async loadBatch(actorId: string, batchId: string): Promise<PaperNotePreflightBatch | null> {
    const batchResult = await this.database.execute(sql`
      select id, status
      from paper_note_batches
      where id = ${batchId}::uuid and created_by = ${actorId}
      limit 1
    `);
    const batch = firstQueryRow(batchResult, isBatchRow);
    if (!batch) return null;

    const [pagesResult, entriesResult] = await Promise.all([
      this.database.execute(sql`
        select id, status, original_object_key as "originalObjectKey"
        from paper_note_pages
        where batch_id = ${batchId}::uuid
        order by sort_order asc
      `),
      this.database.execute(sql`
        select
          id,
          page_id as "pageId",
          state,
          review_payload as "reviewPayload",
          target_snapshot as "targetSnapshot"
        from paper_note_entries
        where batch_id = ${batchId}::uuid
        order by page_id asc, source_order asc
      `),
    ]);

    return {
      id: batch.id,
      status: batch.status,
      pages: queryRows(pagesResult, isPageRow),
      entries: queryRows(entriesResult, isEntryRow).map((entry) => ({
        id: entry.id,
        pageId: entry.pageId,
        state: entry.state,
        review: entry.reviewPayload as PaperNoteReviewDraft,
        targetSnapshot: targetSnapshotFrom(entry.targetSnapshot),
      })),
    };
  }

  async targetExists(destination: NonNullable<PaperNoteReviewDraft["destination"]>) {
    if (destination.mode === "new_profile" || destination.mode === "skip") return true;
    if (destination.mode === "existing_profile_new_location") {
      const result = await this.database.execute(sql`
        select 1 from organizations
        where id = ${destination.organizationId}::uuid and consolidated_into_id is null
        limit 1
      `);
      return Boolean((result as { rows?: unknown[] }).rows?.length);
    }
    if (destination.organizationLocationId) {
      const result = await this.database.execute(sql`
        select 1 from organization_locations
        where id = ${destination.organizationLocationId}::uuid
          and organization_id = ${destination.organizationId}::uuid
        limit 1
      `);
      return Boolean((result as { rows?: unknown[] }).rows?.length);
    }
    const result = await this.database.execute(sql`
      select 1 from organizations
      where id = ${destination.organizationId}::uuid and consolidated_into_id is null
      limit 1
    `);
    return Boolean((result as { rows?: unknown[] }).rows?.length);
  }

  currentTargetSnapshot(review: PaperNoteReviewDraft) {
    return loadPaperNoteTargetSnapshotValue(this.database, review);
  }

  async returnEntryToReview(entryId: string, message: string, now: Date) {
    const issue = { fieldPath: "destination", severity: "blocking", message };
    await this.database.execute(sql`
      update paper_note_entries
      set
        state = 'needs_review',
        approved_at = null,
        review_version = review_version + 1,
        validation_issues = ${JSON.stringify([issue])}::jsonb,
        updated_at = ${now}
      where id = ${entryId}::uuid
        and state = 'approved'
    `);
  }
}
