import type {
  PaperNoteReviewedContact,
  PaperNoteSavedContact,
} from "./paper-note-review-types";

function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizedName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreSavedContact(paper: PaperNoteReviewedContact, saved: PaperNoteSavedContact) {
  let score = 0;
  const paperPhones = paper.phones
    .map((phone) => normalizedPhone(phone.number))
    .filter(Boolean);
  const savedPhones = saved.phones
    .map((phone) => normalizedPhone(phone.number))
    .filter(Boolean);

  if (paperPhones.some((phone) => savedPhones.includes(phone))) score += 100;

  const paperEmail = paper.email?.trim().toLowerCase() ?? "";
  const savedEmail = saved.email?.trim().toLowerCase() ?? "";
  if (paperEmail && savedEmail && paperEmail === savedEmail) score += 90;

  const paperName = normalizedName(paper.name);
  const savedName = normalizedName(saved.name);
  if (paperName && savedName && paperName === savedName) score += 60;

  return score;
}

export function findUnambiguousSavedContact(
  paper: PaperNoteReviewedContact,
  savedContacts: PaperNoteSavedContact[],
): PaperNoteSavedContact | null {
  const ranked = savedContacts
    .map((saved) => ({ saved, score: scoreSavedContact(paper, saved) }))
    .filter((candidate) => candidate.score >= 60)
    .sort((left, right) => right.score - left.score || left.saved.name.localeCompare(right.saved.name));

  const best = ranked[0];
  if (!best) return null;
  if (ranked[1]?.score === best.score) return null;
  return best.saved;
}
