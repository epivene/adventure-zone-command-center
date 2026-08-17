import { actHtmlToPlainText } from "@/features/act-replacement/normalizers/act-html-text";
import { normalizeTimeline } from "@/features/act-replacement/normalizers/timeline-normalizer";

function text(snapshot: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function capturedAt(snapshot: Record<string, unknown>) {
  for (const key of ["edited", "Edited", "createDate", "CreateDate", "created", "Created", "startTime", "StartTime", "displayDate", "DisplayDate"]) {
    const value = snapshot[key];
    if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) return value;
  }
  return new Date(0).toISOString();
}

export function reviewDisplay(input: {
  streamType: string;
  rawSnapshot: Record<string, unknown>;
}) {
  if (input.streamType === "note" || input.streamType === "history" || input.streamType === "activity") {
    const normalized = normalizeTimeline(
      input.rawSnapshot,
      capturedAt(input.rawSnapshot),
      input.streamType,
    );
    if (normalized.ok) {
      return {
        subject: normalized.value.subject ? actHtmlToPlainText(normalized.value.subject) : null,
        body: normalized.value.body,
      };
    }
  }

  const subject = actHtmlToPlainText(text(input.rawSnapshot, ["regarding", "Regarding", "subject", "Subject"]));
  const body = actHtmlToPlainText(text(input.rawSnapshot, [
    "details", "Details", "noteText", "NoteText", "body", "Body", "regarding", "Regarding", "subject", "Subject",
  ]));
  return { subject: subject || null, body };
}

export function shouldDropLinkedToReview(input: {
  streamType: string;
  rawSnapshot: Record<string, unknown>;
}) {
  if (input.streamType !== "note" && input.streamType !== "history" && input.streamType !== "activity") return false;
  const display = reviewDisplay(input);
  const values = [display.subject ?? "", display.body]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return values.some((value) =>
    /^\(\s*linked to\s*\)(?:\s|$)/i.test(value)
    || /^linked to\s+(?:company|contact|opportunity)\b/i.test(value)
    || /^\(\s*linked to\s*\)$/i.test(value),
  );
}
