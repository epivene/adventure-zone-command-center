import {
  normalizeMatchingEmail,
  normalizeMatchingText,
} from "../act-migration/matching-normalization";
import { WebsiteInquiryNotFoundError } from "./website-inquiry-review-service";

export type MatchCandidate = {
  id: string;
  label: string;
  score: number;
  reasons: string[];
  context: Record<string, string | null>;
};

export type WebsiteInquiryMatches = {
  contacts: MatchCandidate[];
  organizations: MatchCandidate[];
  parsedLocation: { city: string; region: string } | null;
};

export type InquiryMatchSource = {
  id: string;
  name: string;
  normalizedEmail: string | null;
  eventName: string;
  eventDate: string | null;
  eventLocation: string | null;
};

export type ContactMatchSource = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  organizations: Array<{
    id: string;
    name: string;
    city: string | null;
    region: string | null;
  }>;
};

export type OrganizationMatchSource = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  bookings: Array<{ startsAt: Date | null }>;
  relatedContactIds: string[];
};

export interface WebsiteInquiryMatchRepository {
  loadInquiry(id: string): Promise<InquiryMatchSource | null>;
  loadContactCandidates(
    inquiry: InquiryMatchSource,
  ): Promise<ContactMatchSource[]>;
  loadOrganizationCandidates(
    inquiry: InquiryMatchSource,
  ): Promise<OrganizationMatchSource[]>;
  search(input: {
    entity: "contact" | "organization";
    query: string;
  }): Promise<MatchCandidate[]>;
}

export function parseCityRegion(
  value: string | null,
): { city: string; region: string } | null {
  const match = value?.match(/^\s*(.+?)\s*,\s*([a-z]{2})\s*$/i);
  if (!match?.[1] || !match[2]) return null;
  return { city: match[1].trim(), region: match[2].toUpperCase() };
}

function levenshteinDistance(left: string, right: string): number {
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1]! +
        (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function similarity(left: string | null, right: string | null): number {
  if (!left || !right) return 0;
  const longest = Math.max(left.length, right.length);
  return longest === 0 ? 1 : 1 - levenshteinDistance(left, right) / longest;
}

function sortCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  return candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftLabel = normalizeMatchingText(left.label) ?? "";
    const rightLabel = normalizeMatchingText(right.label) ?? "";
    return leftLabel.localeCompare(rightLabel) || left.id.localeCompare(right.id);
  });
}

function bookingDateEvidence(
  eventDate: string | null,
  bookings: Array<{ startsAt: Date | null }>,
): { score: number; nearest: string | null } {
  if (!eventDate) return { score: 0, nearest: null };
  const eventMs = Date.parse(`${eventDate}T00:00:00.000Z`);
  if (!Number.isFinite(eventMs)) return { score: 0, nearest: null };
  let nearestDays = Number.POSITIVE_INFINITY;
  let nearest: string | null = null;
  for (const booking of bookings) {
    if (!booking.startsAt) continue;
    const date = booking.startsAt.toISOString().slice(0, 10);
    const days = Math.abs(Date.parse(`${date}T00:00:00.000Z`) - eventMs) / 86_400_000;
    if (days < nearestDays) {
      nearestDays = days;
      nearest = date;
    }
  }
  if (nearestDays > 30) return { score: 0, nearest: null };
  return {
    score: Math.max(1, Math.round(((31 - nearestDays) / 31) * 20)),
    nearest,
  };
}

export function rankWebsiteInquiryMatches(input: {
  inquiry: InquiryMatchSource;
  contacts: ContactMatchSource[];
  organizations: OrganizationMatchSource[];
}): WebsiteInquiryMatches {
  const inquiryName = normalizeMatchingText(input.inquiry.name);
  const inquiryEmail = normalizeMatchingEmail(input.inquiry.normalizedEmail);
  const eventName = normalizeMatchingText(input.inquiry.eventName);
  const parsedLocation = parseCityRegion(input.inquiry.eventLocation);

  const contactScores = new Map<string, { score: number; reasons: string[] }>();
  for (const contact of input.contacts) {
    const reasons: string[] = [];
    let score = 0;
    if (
      inquiryEmail &&
      normalizeMatchingEmail(contact.email) === inquiryEmail
    ) {
      score += 100;
      reasons.push("Exact email match");
    }
    const displayName = `${contact.firstName} ${contact.lastName}`.trim();
    const contactName = normalizeMatchingText(displayName);
    if (inquiryName && contactName === inquiryName) {
      score += 70;
      reasons.push("Exact normalized name match");
    } else {
      const fuzzy = similarity(inquiryName, contactName);
      if (fuzzy >= 0.72) {
        score += Math.round(fuzzy * 60);
        reasons.push("Similar contact name");
      }
    }
    contactScores.set(contact.id, { score, reasons });
  }

  const organizationScores = new Map<
    string,
    { score: number; reasons: string[]; nearest: string | null }
  >();
  for (const organization of input.organizations) {
    const reasons: string[] = [];
    let score = 0;
    const normalizedName = normalizeMatchingText(organization.name);
    if (eventName && normalizedName === eventName) {
      score += 80;
      reasons.push("Exact normalized event name match");
    } else {
      const fuzzy = similarity(eventName, normalizedName);
      if (fuzzy >= 0.72) {
        score += Math.round(fuzzy * 65);
        reasons.push("Similar event profile name");
      }
    }
    if (
      parsedLocation &&
      normalizeMatchingText(organization.city) ===
        normalizeMatchingText(parsedLocation.city) &&
      organization.region?.toUpperCase() === parsedLocation.region
    ) {
      score += 20;
      reasons.push("Same city and state");
    }
    const dateEvidence = bookingDateEvidence(
      input.inquiry.eventDate,
      organization.bookings,
    );
    if (dateEvidence.score > 0) {
      score += dateEvidence.score;
      reasons.push("Event date is within 30 days");
    }
    organizationScores.set(organization.id, {
      score,
      reasons,
      nearest: dateEvidence.nearest,
    });
  }

  for (const contact of input.contacts) {
    const scored = contactScores.get(contact.id)!;
    if (
      contact.organizations.some(
        ({ id }) => (organizationScores.get(id)?.score ?? 0) > 0,
      )
    ) {
      scored.score += 15;
      scored.reasons.push("Related to a likely event profile");
    }
  }
  for (const organization of input.organizations) {
    const scored = organizationScores.get(organization.id)!;
    if (
      organization.relatedContactIds.some(
        (id) => (contactScores.get(id)?.score ?? 0) >= 43,
      )
    ) {
      scored.score += 15;
      scored.reasons.push("Related to a likely contact match");
    }
  }

  const contacts = sortCandidates(
    input.contacts.flatMap((contact) => {
      const scored = contactScores.get(contact.id)!;
      if (scored.score < 43) return [];
      const organization = contact.organizations[0] ?? null;
      return [
        {
          id: contact.id,
          label: `${contact.firstName} ${contact.lastName}`.trim(),
          score: scored.score,
          reasons: scored.reasons,
          context: {
            email: contact.email,
            organization: organization?.name ?? null,
          },
        },
      ];
    }),
  ).slice(0, 10);

  const organizations = sortCandidates(
    input.organizations.flatMap((organization) => {
      const scored = organizationScores.get(organization.id)!;
      if (scored.score < 21) return [];
      return [
        {
          id: organization.id,
          label: organization.name,
          score: scored.score,
          reasons: scored.reasons,
          context: {
            city: organization.city,
            region: organization.region,
            nearestBookingDate: scored.nearest,
          },
        },
      ];
    }),
  ).slice(0, 10);

  return { contacts, organizations, parsedLocation };
}

export class WebsiteInquiryMatchingService {
  constructor(private readonly repository: WebsiteInquiryMatchRepository) {}

  async matches(inquiryId: string): Promise<WebsiteInquiryMatches> {
    const inquiry = await this.repository.loadInquiry(inquiryId);
    if (!inquiry) throw new WebsiteInquiryNotFoundError();
    const [contacts, organizations] = await Promise.all([
      this.repository.loadContactCandidates(inquiry),
      this.repository.loadOrganizationCandidates(inquiry),
    ]);
    return rankWebsiteInquiryMatches({ inquiry, contacts, organizations });
  }

  async search(input: {
    entity: "contact" | "organization";
    query: string;
  }): Promise<MatchCandidate[]> {
    return (await this.repository.search(input)).slice(0, 20);
  }
}
