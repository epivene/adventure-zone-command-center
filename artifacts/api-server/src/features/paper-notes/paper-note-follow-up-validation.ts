import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";
import type { PaperNoteReviewIssue } from "./paper-note-review-schema";

export function validatePaperNoteCurrentFollowUp(
  review: PaperNoteReviewDraft,
): PaperNoteReviewIssue[] {
  if (!review.currentFollowUp.enabled || !review.currentFollowUp.contactKey) return [];

  const selected = review.contacts.find((contact) => contact.key === review.currentFollowUp.contactKey);
  if (selected && selected.mode !== "note_only") return [];

  return [{
    fieldPath: "currentFollowUp.contactKey",
    severity: "blocking",
    message: "Choose a reviewed contact that will be created or linked, or use the primary reviewed contact.",
  }];
}
