import type { PaperNoteReviewIssue } from "./paper-note-review-schema";

export function validatePaperNoteEventDate(event: {
  startsOn: string | null;
  endsOn: string | null;
  pageYearConfirmed: boolean;
}): PaperNoteReviewIssue[] {
  if (!(event.startsOn || event.endsOn) || event.pageYearConfirmed) return [];
  return [{
    fieldPath: "event.pageYearConfirmed",
    message: "The event year came from page context. Confirm it if you want to rely on the structured date; otherwise the paper text can remain historical context only.",
    severity: "warning",
  }];
}
