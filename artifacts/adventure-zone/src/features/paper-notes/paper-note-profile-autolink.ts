import { findUnambiguousSavedContact } from "./paper-note-contact-autolink";
import type {
  PaperNoteMatch,
  PaperNoteReviewDraft,
} from "./paper-note-review-types";

function hasExactIdentity(match: PaperNoteMatch) {
  return match.reasons.some((reason) =>
    reason === "same phone number"
    || reason === "same phone number and extension"
    || reason === "same email address");
}

function hasCorroboratingContext(match: PaperNoteMatch) {
  return match.reasons.some((reason) =>
    reason === "same event/profile name and city/state"
    || reason === "same event/profile name"
    || reason === "same city/state"
    || reason === "same venue"
    || reason === "same contact name");
}

export function chooseAutomaticPaperNoteProfileMatch(matches: PaperNoteMatch[]): PaperNoteMatch | null {
  const ranked = [...matches].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  const first = ranked[0];
  if (!first || first.strength !== "strong" || first.score < 125) return null;
  if (!hasExactIdentity(first) || !hasCorroboratingContext(first)) return null;

  const second = ranked[1];
  if (second && second.score > first.score - 40) return null;
  return first;
}

export function applyAutomaticPaperNoteProfileMatch(
  review: PaperNoteReviewDraft,
  matches: PaperNoteMatch[],
): PaperNoteReviewDraft | null {
  if (review.destination) return null;
  const match = chooseAutomaticPaperNoteProfileMatch(matches);
  if (!match) return null;

  return {
    ...review,
    destination: {
      mode: "existing_profile",
      organizationId: match.organizationId,
      organizationLocationId: match.organizationLocationId,
    },
    contacts: review.contacts.map((contact) => {
      const saved = findUnambiguousSavedContact(contact, match.contacts);
      return saved
        ? {
            ...contact,
            mode: "existing_contact" as const,
            selectedContactId: saved.id,
          }
        : contact;
    }),
    conflicts: {},
  };
}
