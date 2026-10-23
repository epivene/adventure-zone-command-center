import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";

import type {
  CallerFinderCandidate,
  CallerFinderResult,
  CallerMatchReason,
  CallerSuggestion,
} from "./caller-finder-types";

export type CallerFinderInput = {
  phone: string;
  query: string;
};

export type CallerCandidateQuery = {
  normalizedPhone: string | null;
  phoneFragment: string | null;
  query: string;
  includeNotes: boolean;
};

export type CallerExactQuery = {
  normalizedPhone: string | null;
  normalizedEmail: string | null;
};

export type CallerExactMetadata = {
  exactPhoneContactIds: string[];
  hasExactEmail: boolean;
};

export interface CallerFinderRepository {
  findCallerCandidates(query: CallerCandidateQuery): Promise<CallerFinderCandidate[]>;
  findCallerExactMetadata(query: CallerExactQuery): Promise<CallerExactMetadata>;
}

const scores: Record<CallerMatchReason, number> = {
  "Exact phone": 1000,
  "Exact email": 900,
  Name: 700,
  "Organization or event": 700,
  "Due today": 300,
  "Recently contacted": 200,
  Location: 150,
  "Route leg": 150,
  "Phone number": 600,
  "Same area code": 50,
  "Note text": 25,
};
const reasonOrder = Object.keys(scores) as CallerMatchReason[];

function folded(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function timestampMillis(value: Date | string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function areaCode(normalizedPhone: string | null) {
  return normalizedPhone?.startsWith("+1") && normalizedPhone.length === 12
    ? normalizedPhone.slice(2, 5)
    : null;
}

function noteSnippet(note: string) {
  const compact = note.trim().replace(/\s+/g, " ");
  return compact.length <= 160 ? compact : compact.slice(0, 160);
}

function scoredSuggestion(
  candidate: CallerFinderCandidate,
  normalizedPhone: string | null,
  phoneFragment: string | null,
  query: string,
  includeNotes: boolean,
): CallerSuggestion | null {
  const reasons: CallerMatchReason[] = [];
  const normalizedQuery = folded(query);
  const candidatePhones = new Set(candidate.normalizedPhones.filter(Boolean));
  const requestedAreaCode = areaCode(normalizedPhone);

  if (normalizedPhone && candidatePhones.has(normalizedPhone)) {
    reasons.push("Exact phone");
  }
  if (
    phoneFragment &&
    candidate.normalizedPhones.some((phone) =>
      phone.replace(/\D/g, "").includes(phoneFragment),
    )
  ) {
    reasons.push("Phone number");
  }
  if (
    normalizedQuery &&
    candidate.email &&
    folded(candidate.email) === normalizedQuery
  ) {
    reasons.push("Exact email");
  }
  if (normalizedQuery && folded(candidate.name).includes(normalizedQuery)) {
    reasons.push("Name");
  }
  if (
    normalizedQuery &&
    (
      candidate.matchedOrganizationOrEvent ||
      [candidate.organizationName, candidate.bookingName]
        .some((value) => folded(value).includes(normalizedQuery))
    )
  ) {
    reasons.push("Organization or event");
  }
  if (
    normalizedQuery &&
    (
      candidate.matchedLocation ||
      candidate.matchedContactPostalCode ||
      [candidate.city, candidate.region]
        .some((value) => folded(value).includes(normalizedQuery))
    )
  ) {
    reasons.push("Location");
  }
  if (
    normalizedQuery &&
    (
      candidate.matchedRouteLeg ||
      folded(candidate.routeLegName).includes(normalizedQuery)
    )
  ) {
    reasons.push("Route leg");
  }
  if (
    normalizedQuery &&
    folded(candidate.bookingStatus).replaceAll("_", " ").includes(normalizedQuery)
  ) {
    if (!reasons.includes("Organization or event")) reasons.push("Organization or event");
  }
  if (
    normalizedPhone &&
    requestedAreaCode &&
    !candidatePhones.has(normalizedPhone) &&
    candidate.normalizedPhones.some((phone) => areaCode(phone) === requestedAreaCode)
  ) {
    reasons.push("Same area code");
  }
  const hasNoteMatch =
    includeNotes &&
    normalizedQuery &&
    folded(candidate.noteText).includes(normalizedQuery);
  if (hasNoteMatch) reasons.push("Note text");
  const hasRealMatch = reasons.length > 0;
  if (candidate.dueToday && (!normalizedQuery || hasRealMatch)) reasons.push("Due today");
  if (candidate.lastContactedAt && (!normalizedQuery || hasRealMatch)) reasons.push("Recently contacted");
  if (!reasons.length) return null;
  reasons.sort((left, right) => reasonOrder.indexOf(left) - reasonOrder.indexOf(right));

  return {
    contactId: candidate.contactId,
    name: candidate.name,
    organizationName: candidate.organizationName,
    city: candidate.city,
    region: candidate.region,
    bookingStatus: candidate.bookingStatus,
    routeLegName: candidate.routeLegName,
    lastContactedAt: candidate.lastContactedAt,
    reasons,
    score: reasons.reduce((total, reason) => total + scores[reason], 0),
    ...(hasNoteMatch && candidate.noteText
      ? { noteSnippet: noteSnippet(candidate.noteText) }
      : {}),
  };
}

export class CallerFinderService {
  constructor(private readonly repository: CallerFinderRepository) {}

  async find(input: CallerFinderInput): Promise<CallerFinderResult> {
    const query = input.query.trim();
    const normalizedPhone = normalizeNorthAmericanPhone(input.phone);
    const phoneDigits = input.phone.replace(/\D/g, "");
    const phoneFragment = !normalizedPhone && phoneDigits.length >= 7 && phoneDigits.length <= 9
      ? phoneDigits
      : null;
    const includeNotes = query.length >= 3;
    const [candidates, exactMetadata] = await Promise.all([
      this.repository.findCallerCandidates({
        normalizedPhone,
        phoneFragment,
        query,
        includeNotes,
      }),
      this.repository.findCallerExactMetadata({
        normalizedPhone,
        normalizedEmail: looksLikeEmail(query) ? folded(query) : null,
      }),
    ]);

    const suggestions = candidates
      .map((candidate) =>
        scoredSuggestion(
          candidate,
          normalizedPhone,
          phoneFragment,
          query,
          includeNotes,
        ),
      )
      .filter((suggestion): suggestion is CallerSuggestion => suggestion !== null)
      .toSorted((left, right) =>
        right.score - left.score ||
        timestampMillis(right.lastContactedAt as Date | string | null) -
          timestampMillis(left.lastContactedAt as Date | string | null) ||
        left.contactId.localeCompare(right.contactId),
      )
      .slice(0, 8);

    return {
      exact: exactMetadata.exactPhoneContactIds.length === 1
        ? { kind: "one", contactId: exactMetadata.exactPhoneContactIds[0]! }
        : { kind: "none" },
      suggestions,
      canCreate:
        exactMetadata.exactPhoneContactIds.length === 0 &&
        !exactMetadata.hasExactEmail,
    };
  }
}
