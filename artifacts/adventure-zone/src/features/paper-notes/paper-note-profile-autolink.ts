import type { PaperNoteMatch } from "./paper-note-review-types";

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
