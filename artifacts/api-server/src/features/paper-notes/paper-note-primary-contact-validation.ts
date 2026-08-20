import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";
import type { PaperNoteReviewIssue } from "./paper-note-review-schema";

export function validatePaperNotePrimaryContact(
  review: PaperNoteReviewDraft,
): PaperNoteReviewIssue[] {
  const primaryCount = review.contacts.filter((contact) =>
    contact.mode !== "note_only" && contact.primary,
  ).length;
  if (primaryCount <= 1) return [];
  return [{
    fieldPath: "contacts",
    severity: "blocking",
    message: "Choose only one primary contact for this paper entry.",
  }];
}
