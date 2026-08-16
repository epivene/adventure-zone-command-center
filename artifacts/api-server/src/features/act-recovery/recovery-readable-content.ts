const reviewTextKeys = [
  "details",
  "Details",
  "noteText",
  "NoteText",
  "body",
  "Body",
  "regarding",
  "Regarding",
  "subject",
  "Subject",
] as const;

export function hasReadableActReviewText(snapshot: Record<string, unknown>): boolean {
  return reviewTextKeys.some((key) => {
    const value = snapshot[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}
