import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import type { InternalEventDateEvidence } from "@/features/event-date-coverage/internal-event-date-evidence";

const MAX_NOTES = 30;
const MAX_CLUES = 8;

function plain(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCapture(value: string | undefined) {
  if (!value) return "";
  return value
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function capitalizedPhrase(text: string, prefix: RegExp) {
  const match = text.match(prefix);
  return cleanCapture(match?.[1]);
}

export function extractProfileHistoryIdentityClues(profile: EventProfile): string[] {
  const clues = new Set<string>();
  const add = (value: string) => {
    const clue = cleanCapture(value);
    if (clue.length >= 3 && clue.length <= 80) clues.add(clue);
  };

  for (const note of profile.notes.slice(0, MAX_NOTES)) {
    const text = plain(String(note.body ?? ""));
    if (!text) continue;

    // Only extract small public-identity-shaped phrases. We intentionally do
    // not forward the surrounding note, pricing discussion, outcome, etc.
    add(capitalizedPhrase(text, /\b(?:spoke with|talked to|contact(?: is| was)?|organizer(?: is| was)?|coordinator(?: is| was)?)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,3})/));
    add(capitalizedPhrase(text, /\b(?:venue|location|held at|event at|at venue)\s*[:\-]?\s*([A-Z][A-Za-z0-9&'’.-]+(?:\s+[A-Z][A-Za-z0-9&'’.-]+){0,4})/));
    add(capitalizedPhrase(text, /\b(?:parks? and recreation|parks? & recreation|chamber|fair board|festival committee)\s*[:\-]?\s*([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,3})/i));

    if (clues.size >= MAX_CLUES) break;
  }

  return [...clues].slice(0, MAX_CLUES);
}

const EXPLICIT_EVENT_DATE = /\b(?:event|festival|fair|show)\s+date(?:s)?\s*[:\-]\s*(\d{4}-\d{2}-\d{2})(?:\s*(?:to|through|–|—)\s*(\d{4}-\d{2}-\d{2}))?/i;

/**
 * Extract only explicitly labelled ISO event dates. This intentionally avoids
 * treating arbitrary dates in call notes (deadlines, calls, invoices) as event
 * evidence.
 */
export function extractProfileHistoryEventDateEvidence(
  profile: EventProfile,
): InternalEventDateEvidence[] {
  return profile.notes.slice(0, MAX_NOTES).flatMap((note) => {
    const text = String(note.body ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const match = text.match(EXPLICIT_EVENT_DATE);
    if (!match?.[1]) return [];
    return [{
      startsOn: match[1],
      endsOn: match[2] ?? null,
      evidenceKind: "published_exact" as const,
      sourceKind: "internal" as const,
      sourceType: note.importedFromAct ? "act_import" : "activity_note",
      sourceId: note.id,
      sourceLabel: note.subject?.trim() || "Profile activity",
      excerpt: match[0].slice(0, 160),
    }];
  });
}
