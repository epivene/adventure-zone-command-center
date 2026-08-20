import type { PaperNoteExtraction } from "./paper-note-extraction-schema";
import { validatePaperNoteEventDate } from "./paper-note-event-date-validation";
import { validatePaperNotePrimaryContact } from "./paper-note-primary-contact-validation";
import { validatePaperNotePrimaryPhones } from "./paper-note-primary-phone-validation";
import type { PaperNoteEntryState } from "./paper-note-types";
import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";
import {
  validatePaperNoteReview,
  type PaperNoteReviewIssue,
  type PaperNoteReviewPayload,
} from "./paper-note-review-schema";

export type PaperNoteReviewMutationView = {
  id: string;
  review: PaperNoteReviewDraft;
  reviewVersion: number;
  state: PaperNoteEntryState;
  validationIssues: PaperNoteReviewIssue[];
  approvedAt: string | null;
};

export type PaperNoteReviewEntryDetails = {
  review: PaperNoteReviewDraft;
  validationIssues: PaperNoteReviewIssue[];
  state: PaperNoteEntryState;
  reviewVersion: number;
  extraction: PaperNoteExtraction;
  approvedAt: string | null;
};

export interface PaperNoteReviewStore {
  saveReview(input: {
    actorId: string;
    entryId: string;
    expectedVersion: number;
    review: PaperNoteReviewDraft;
    state: "needs_review" | "ready";
    validationIssues: PaperNoteReviewIssue[];
    approvedAt: null;
    now: Date;
  }): Promise<PaperNoteReviewMutationView>;
  getForReview(actorId: string, entryId: string): Promise<PaperNoteReviewEntryDetails | null>;
  approve(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }): Promise<PaperNoteReviewMutationView>;
  unapprove(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }): Promise<PaperNoteReviewMutationView>;
  skip(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }): Promise<PaperNoteReviewMutationView>;
}

export type PaperNoteReviewServiceErrorCode = "ENTRY_NOT_FOUND" | "ENTRY_NOT_READY";

export class PaperNoteReviewServiceError extends Error {
  constructor(public readonly code: PaperNoteReviewServiceErrorCode, message: string) {
    super(message);
    this.name = "PaperNoteReviewServiceError";
  }
}

function validateDraft(review: PaperNoteReviewDraft): PaperNoteReviewIssue[] {
  if (!review.destination) {
    return [{
      fieldPath: "destination",
      message: "Choose where this paper entry belongs before approving it.",
      severity: "blocking",
    }];
  }
  return [
    ...validatePaperNoteReview(review as PaperNoteReviewPayload),
    ...validatePaperNoteEventDate(review.event),
    ...validatePaperNotePrimaryContact(review),
    ...validatePaperNotePrimaryPhones(review),
  ];
}

export class PaperNoteReviewService {
  constructor(private readonly store: PaperNoteReviewStore) {}

  async getEntry(actorId: string, entryId: string) {
    const current = await this.store.getForReview(actorId, entryId);
    if (!current) throw new PaperNoteReviewServiceError("ENTRY_NOT_FOUND", "Paper-note entry was not found.");
    return { id: entryId, ...current };
  }

  async updateEntry(input: {
    actorId: string;
    entryId: string;
    expectedVersion: number;
    review: PaperNoteReviewDraft;
    now: Date;
  }) {
    const issues = validateDraft(input.review);
    const state = issues.some((issue) => issue.severity === "blocking") ? "needs_review" : "ready";
    return this.store.saveReview({ ...input, state, validationIssues: issues, approvedAt: null });
  }

  async approveEntry(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }) {
    const current = await this.store.getForReview(input.actorId, input.entryId);
    if (!current) throw new PaperNoteReviewServiceError("ENTRY_NOT_FOUND", "Paper-note entry was not found.");
    const issues = validateDraft(current.review);
    if (current.state !== "ready" || issues.some((issue) => issue.severity === "blocking")) {
      throw new PaperNoteReviewServiceError("ENTRY_NOT_READY", "Review the highlighted paper-note fields before approving this entry.");
    }
    return this.store.approve(input);
  }

  unapproveEntry(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }) {
    return this.store.unapprove(input);
  }

  skipEntry(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }) {
    return this.store.skip(input);
  }
}
