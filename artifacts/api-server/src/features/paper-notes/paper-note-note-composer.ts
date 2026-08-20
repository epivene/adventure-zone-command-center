import type { PaperNoteReviewPayload } from "./paper-note-review-schema";

function compact(parts: Array<string | null | undefined | false>) {
  return parts.filter((value): value is string => Boolean(value && value.trim())).join(" ");
}

function methodLabel(method: PaperNoteReviewPayload["activity"]["method"]) {
  if (method === "call") return "Called";
  if (method === "email") return "Emailed";
  if (method === "mail") return "Mailed";
  if (method === "text") return "Texted";
  return "Historical activity";
}

function phoneLine(label: string, number: string, extension: string | null, instructions: string | null) {
  return compact([
    "Phone noted:",
    label,
    number,
    extension ? `extension ${extension}.` : ".",
    instructions,
  ]);
}

export function composePaperNoteHistory(input: {
  review: PaperNoteReviewPayload;
  originalTranscription: string;
}) {
  const { review } = input;
  const lines: string[] = ["Imported from paper notes"];

  const activity = compact([
    `${methodLabel(review.activity.method)}${review.activity.occurredOn ? ` ${review.activity.occurredOn}` : ""}.`,
    review.activity.summary,
    review.activity.outcome,
  ]);
  if (activity) lines.push(`Historical activity: ${activity}`);
  else lines.push("Historical activity: Historical date unknown.");

  if (review.event.eventDateText.trim()) {
    const normalized = review.event.startsOn
      ? ` (${review.event.startsOn}${review.event.endsOn ? ` through ${review.event.endsOn}` : ""}${review.event.pageYearConfirmed ? "; page-year interpretation confirmed" : ""})`
      : "";
    lines.push(`Event date noted: ${review.event.eventDateText.trim()}${normalized}.`);
  }

  for (const phone of review.organizationPhones) {
    if (!phone.number.trim()) continue;
    lines.push(phoneLine(phone.label ?? "", phone.number.trim(), phone.extension, phone.instructions));
  }
  for (const contact of review.contacts) {
    for (const phone of contact.phones) {
      if (!phone.number.trim()) continue;
      lines.push(phoneLine(contact.name || phone.label || "", phone.number.trim(), phone.extension, phone.instructions));
    }
  }

  if (review.oldReminder.trim()) {
    lines.push(
      `Original reminder: ${review.oldReminder.trim()}. This was a historical reminder and was not added as a current task.`,
    );
  }
  if (review.currentFollowUp.enabled && review.currentFollowUp.dueOn) {
    lines.push(`A separate current follow-up was requested for ${review.currentFollowUp.dueOn}.`);
  }
  if (review.starredOnPaper) lines.push("Starred on original paper.");
  for (const note of review.generalNotes) {
    if (note.trim()) lines.push(`Paper note: ${note.trim()}`);
  }
  if (input.originalTranscription.trim()) {
    lines.push(`Original transcription: ${input.originalTranscription.trim()}`);
  }

  return lines.join("\n");
}
