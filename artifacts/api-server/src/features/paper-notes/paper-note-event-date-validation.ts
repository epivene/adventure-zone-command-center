import type { PaperNoteReviewIssue } from "./paper-note-review-schema";

export function validatePaperNoteEventDate(event: {
  startsOn: string | null;
  endsOn: string | null;
  pageYearConfirmed: boolean;
}): PaperNoteReviewIssue[] {
  if (!(event.startsOn || event.endsOn) || event.pageYearConfirmed) return [];
  return [{
    fieldPath: "event.pageYearConfirmed",
    message: "Confirm the event year against the original paper before approving this entry.",
    severity: "blocking",
  }];
}
