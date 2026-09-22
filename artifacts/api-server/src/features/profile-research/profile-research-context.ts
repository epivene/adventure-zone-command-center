import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import type {
  ProfileResearchContext,
  ProfileResearchContextInput,
  ProfileResearchGap,
  ProfileResearchKnownFact,
} from "./profile-research-types";

const MAX_HISTORY_CLUES = 8;
const MAX_SEARCH_CLUES = 12;
const MAX_CLUE_LENGTH = 120;

function clean(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function locationLabel(profile: EventProfile) {
  return [clean(profile.place.city), clean(profile.place.region)].filter(Boolean).join(", ");
}

function hasUsableLocation(profile: EventProfile) {
  return Boolean(clean(profile.place.city) && clean(profile.place.region));
}

function hasReachableContact(profile: EventProfile) {
  return profile.contacts.some((contact) => clean(contact.email) || clean(contact.phone));
}

function hasUpcomingDatedBooking(profile: EventProfile, now: Date) {
  return profile.bookings.some((booking) => booking.startsAt && booking.startsAt.getTime() >= now.getTime());
}

function hasHistoricalDatedBooking(profile: EventProfile, now: Date) {
  return profile.bookings.some((booking) => booking.startsAt && booking.startsAt.getTime() < now.getTime());
}

function sanitizeIdentityClue(value: string) {
  const normalized = clean(value).slice(0, MAX_CLUE_LENGTH);
  if (!normalized) return "";
  // Minimized clues may contain public names/venues/organizations, but reject
  // strings that look like pasted notes, HTML, emails, phone numbers, or URLs.
  if (/[<>]/.test(normalized)) return "";
  if (/https?:\/\//i.test(normalized)) return "";
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(normalized)) return "";
  if (/\+?\d[\d\s().-]{7,}\d/.test(normalized)) return "";
  if (normalized.length > 80 && /[.!?].*[.!?]/.test(normalized)) return "";
  return normalized;
}

function addFact(
  facts: ProfileResearchKnownFact[],
  key: string,
  value: string | null | undefined,
  source: ProfileResearchKnownFact["source"] = "crm",
) {
  const normalized = clean(value);
  if (!normalized) return;
  if (facts.some((fact) => fact.key === key && fact.value === normalized)) return;
  facts.push({ key, value: normalized, source });
}

export function detectProfileResearchGaps(profile: EventProfile, now = new Date()): ProfileResearchGap[] {
  const gaps: ProfileResearchGap[] = [];
  if (!clean(profile.place.website)) {
    gaps.push({ field: "website", label: "Website", targetKind: "organization", targetId: profile.id });
  }
  if (!clean(profile.place.phone)) {
    gaps.push({ field: "phone", label: "Public phone", targetKind: "organization", targetId: profile.id });
  }
  if (!hasUsableLocation(profile)) {
    gaps.push({ field: "location", label: "City / state", targetKind: "organization", targetId: profile.id });
  }
  if (!profile.contacts.length) {
    gaps.push({ field: "contact", label: "Organizer contact", targetKind: "contact", targetId: null });
  } else if (!hasReachableContact(profile)) {
    const primary = profile.contacts.find((contact) => contact.isPrimary) ?? profile.contacts[0];
    gaps.push({ field: "contact_method", label: "Contact email or phone", targetKind: "contact", targetId: primary?.id ?? null });
  }
  if (
    hasHistoricalDatedBooking(profile, now) &&
    !hasUpcomingDatedBooking(profile, now) &&
    !profile.effectiveEventDate
  ) {
    gaps.push({ field: "next_event_dates", label: "Next event dates", targetKind: "event_date_fact", targetId: null });
  }
  return gaps;
}

export function buildProfileResearchContext(
  input: ProfileResearchContextInput,
  now = new Date(),
): ProfileResearchContext {
  const { profile, mode } = input;
  const facts: ProfileResearchKnownFact[] = [];
  const location = locationLabel(profile);

  addFact(facts, "profile_name", profile.place.name);
  addFact(facts, "location", location);
  addFact(facts, "website", profile.place.website);
  addFact(facts, "public_phone", profile.place.phone);
  addFact(facts, "category", profile.place.placeType);

  const primaryContact = profile.contacts.find((contact) => contact.isPrimary) ?? profile.contacts[0];
  if (primaryContact) {
    addFact(facts, "primary_contact", primaryContact.name);
    addFact(facts, "primary_contact_role", primaryContact.role);
  }

  for (const booking of profile.bookings.slice(0, 4)) {
    addFact(facts, `booking:${booking.id}:name`, booking.name);
    if (booking.startsAt) addFact(facts, `booking:${booking.id}:date`, booking.startsAt.toISOString().slice(0, 10));
  }

  for (const group of profile.groups.slice(0, 4)) {
    addFact(facts, `group:${group.id}`, group.name);
  }

  const historyClues = (input.historyIdentityClues ?? [])
    .map(sanitizeIdentityClue)
    .filter(Boolean)
    .slice(0, MAX_HISTORY_CLUES);
  historyClues.forEach((clue, index) => addFact(facts, `history_clue:${index}`, clue, "history"));

  const clueSet = new Set<string>();
  const addClue = (parts: Array<string | null | undefined>) => {
    const clue = parts.map(clean).filter(Boolean).join(" ").trim();
    if (clue) clueSet.add(clue.slice(0, MAX_CLUE_LENGTH));
  };

  addClue([profile.place.name, profile.place.city, profile.place.region]);
  addClue([profile.place.name, primaryContact?.name]);
  addClue([profile.place.name, primaryContact?.role, profile.place.city, profile.place.region]);
  for (const booking of profile.bookings.slice(0, 3)) addClue([booking.name, booking.city, booking.region]);
  for (const group of profile.groups.slice(0, 3)) addClue([profile.place.name, group.name, profile.place.city, profile.place.region]);
  for (const clue of historyClues) addClue([profile.place.name, clue, profile.place.city, profile.place.region]);

  return {
    profileId: profile.id,
    profileName: clean(profile.place.name) || "Unnamed profile",
    mode,
    knownFacts: facts,
    searchClues: [...clueSet].slice(0, MAX_SEARCH_CLUES),
    gaps: detectProfileResearchGaps(profile, now),
  };
}
