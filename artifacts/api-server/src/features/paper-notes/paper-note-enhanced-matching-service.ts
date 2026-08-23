import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";
import type {
  PaperNoteMatch,
  PaperNoteMatchCandidate,
  PaperNoteMatchDetails,
  PaperNoteMatchRepository,
} from "./paper-note-matching-service";
import { paperNoteNameSimilarity } from "./paper-note-reading-improvements";

const emptyDetails = (): PaperNoteMatchDetails => ({ contacts: [], organizationPhones: [] });

function normalizedDigits(value: string) {
  return normalizeNorthAmericanPhone(value)?.replace(/\D/g, "") ?? "";
}

function differsByOneDigit(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let differences = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) differences += 1;
    if (differences > 1) return false;
  }
  return differences === 1;
}

function rankCandidate(candidate: PaperNoteMatchCandidate, review: PaperNoteReviewDraft) {
  let score = 0;
  const reasons: string[] = [];
  if (candidate.exactPhone) {
    score += candidate.compatibleExtension ? 110 : 100;
    reasons.push(candidate.compatibleExtension ? "same phone number and extension" : "same phone number");
  }
  if (candidate.exactEmail) {
    score += 90;
    reasons.push("same email address");
  }
  const similarity = paperNoteNameSimilarity(review.event.name, candidate.name);
  if (candidate.exactName) {
    score += candidate.sameCityRegion ? 70 : 45;
    reasons.push(candidate.sameCityRegion ? "same event/profile name and city/state" : "same event/profile name");
  } else if (similarity >= 0.8) {
    score += candidate.sameCityRegion ? 62 : 38;
    reasons.push(candidate.sameCityRegion ? "very similar event/profile name and city/state" : "very similar event/profile name");
  } else if (similarity >= 0.6) {
    score += candidate.sameCityRegion ? 48 : 25;
    reasons.push(candidate.sameCityRegion ? "similar event/profile name and city/state" : "similar event/profile name");
  } else if (candidate.sameCityRegion) {
    score += 15;
    reasons.push("same city/state");
  }
  if (candidate.venueMatch) {
    score += 30;
    reasons.push("same venue");
  }
  if (candidate.contactNameMatch) {
    score += 25;
    reasons.push("same contact name");
  }
  return { score, reasons, similarity };
}

function nearPhoneReason(review: PaperNoteReviewDraft, details: PaperNoteMatchDetails) {
  const paper = [
    ...review.organizationPhones,
    ...review.contacts.flatMap((contact) => contact.phones),
  ].map((phone) => normalizedDigits(phone.number)).filter(Boolean);
  if (!paper.length) return null;
  const saved = [
    ...details.organizationPhones,
    ...details.contacts.flatMap((contact) => contact.phones),
  ].map((phone) => normalizedDigits(phone.number)).filter(Boolean);
  for (const paperNumber of paper) {
    for (const savedNumber of saved) {
      if (differsByOneDigit(paperNumber, savedNumber)) {
        return "possible handwritten phone-digit misread; saved profile differs by one digit";
      }
    }
  }
  return null;
}

export class EnhancedPaperNoteMatchingService {
  constructor(private readonly repository: PaperNoteMatchRepository) {}

  async match(review: PaperNoteReviewDraft): Promise<PaperNoteMatch[]> {
    const candidates = await this.repository.findCandidates(review);
    const prelim = candidates
      .map((candidate) => ({ candidate, ranking: rankCandidate(candidate, review) }))
      .sort((left, right) => right.ranking.score - left.ranking.score || left.candidate.name.localeCompare(right.candidate.name))
      .slice(0, 8);
    const details = this.repository.findDetails
      ? await this.repository.findDetails([...new Set(prelim.map(({ candidate }) => candidate.organizationId))])
      : new Map<string, PaperNoteMatchDetails>();

    return prelim.map(({ candidate, ranking }) => {
      const detail = details.get(candidate.organizationId) ?? emptyDetails();
      const nearPhone = nearPhoneReason(review, detail);
      const score = ranking.score + (nearPhone && candidate.sameCityRegion && ranking.similarity >= 0.55 ? 8 : 0);
      const reasons = [...ranking.reasons];
      if (nearPhone) reasons.push(nearPhone);
      return {
        organizationId: candidate.organizationId,
        organizationLocationId: candidate.organizationLocationId,
        name: candidate.name,
        city: candidate.city,
        region: candidate.region,
        strength: score >= 80 ? "strong" as const : "possible" as const,
        score,
        reasons: reasons.length ? reasons : ["similar profile/location details"],
        ...detail,
      };
    })
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, 5);
  }
}
