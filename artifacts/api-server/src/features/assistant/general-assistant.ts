import type { AssistantAnswer } from "./assistant-types";
import type { LeadScoutRunView } from "./lead-scout-types";
import type { ProfileSearchRepository } from "./profile-search-repository";
import type { AssistantProfileSearchResult, ProfileSearchRequest } from "./profile-search-types";

export type GeneralAssistantResponse =
  | { kind: "profile_results"; text: string; results: AssistantProfileSearchResult[] }
  | { kind: "lead_discovery"; text: string; run: LeadScoutRunView }
  | { kind: "lead_discovery_clarification"; text: string; runId: string }
  | { kind: "answer"; answer: AssistantAnswer }
  | { kind: "needs_context"; text: string };

const stateNames: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

const namedEventCategories = /^(christmas|halloween|oktoberfest|octoberfest|fourth of july|4th of july|independence day|holiday|winter carnival|summer festival)$/i;
const genericEventPhrase = /^(.+?)\s+(events?|fairs?|festivals?|parades?|celebrations?)$/i;
const discoveryNoun = /\b(events?|fairs?|festivals?|vendors?|leads?|opportunit(?:y|ies)|parades?|celebrations?|carnivals?)\b/i;
const discoveryVerb = /\b(find|search|look for|need|show me|scout)\b/i;
const monthOrSeason = /\b(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter)\b/i;

export function isLeadDiscoveryQuestion(question: string): boolean {
  const value = question.trim();
  if (!discoveryVerb.test(value) || !discoveryNoun.test(value)) return false;
  const hasExplicitTimeScope = monthOrSeason.test(value) || /\b20\d{2}\b/.test(value) || /\b\d{4}-\d{2}-\d{2}\b/.test(value);
  const hasRouteScope = /\bbetween\b.+\band\b/i.test(value) || /\bleg\s*\d+\b/i.test(value) || /\b(route|corridor)\b/i.test(value);
  const hasGeographicScope = /\b(around|near|nearby|within|radius|miles?\s+(?:of|from)|around this event|near this booking)\b/i.test(value);
  const hasOpportunityScope = /\b(vendor|exhibitor|booth|sponsor(?:ship)?|book(?:ed|ing)?\s+.*entertainment)\b/i.test(value);
  return hasExplicitTimeScope || hasRouteScope || hasGeographicScope || hasOpportunityScope;
}

function cleanSearchSubject(value: string) {
  return value
    .replace(/^(find|search for|search|show me|show)\s+(?:me\s+)?(?:all\s+)?/i, "")
    .replace(/^(the\s+)?(profile|profiles|contact|contacts|customer|customers|event|events)\s+(for\s+)?/i, "")
    .replace(/[?.!]+$/g, "")
    .trim();
}

function searchRequest(question: string): ProfileSearchRequest | null {
  const raw = question.trim();
  const lower = raw.toLowerCase();

  if (/overdue follow[- ]?ups|who need(?:s)? (?:a )?(?:call|follow[- ]?up)|who.*overdue/.test(lower)) {
    return { query: "follow-up", overdueFollowUp: true, limit: 8 };
  }

  const packageMatch = raw.match(/(?:usually\s+books?|book(?:s|ed)?|with)\s+(.+?)(?:\?|$)/i);
  if (packageMatch && /who|profile|customer|event/i.test(raw)) {
    const packageName = packageMatch[1]?.replace(/[?.!]+$/g, "").trim();
    if (packageName) return { query: packageName, packageName, limit: 8 };
  }

  const cleanedSubject = cleanSearchSubject(raw);
  const plainEventMatch = cleanedSubject.match(genericEventPhrase);
  const plainEventSubject = namedEventCategories.test(cleanedSubject)
    ? cleanedSubject
    : plainEventMatch?.[1]?.trim();

  const explicitSearch = /^(find|search|show)/i.test(raw) || /\b(profile|contact|customer|event family)\b/i.test(raw);
  const looksLikeSearch = explicitSearch || Boolean(plainEventSubject);
  if (!looksLikeSearch) return null;

  let subject = plainEventSubject ?? cleanedSubject;
  let city: string | undefined;
  let region: string | undefined;

  for (const [name, abbreviation] of Object.entries(stateNames)) {
    const pattern = new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i");
    if (pattern.test(subject)) {
      region = abbreviation;
      subject = subject.replace(pattern, "").replace(/\bin\s*$/i, "").trim();
      if (!subject || /^(profiles?|contacts?|customers?|events?)$/i.test(subject)) subject = abbreviation;
      break;
    }
  }

  const cityMatch = subject.match(/^(.*?)\s+in\s+([A-Za-z .'-]{2,80})$/i);
  if (cityMatch) {
    subject = cityMatch[1]?.trim() || cityMatch[2]?.trim() || subject;
    city = cityMatch[2]?.trim();
  }

  subject = subject.replace(/^(profiles?|contacts?|customers?|events?)\s*/i, "").trim();
  if (!subject && region) subject = region;
  if (!subject && city) subject = city;
  if (!subject) return null;

  return { query: subject, city, region, limit: 8 };
}

export async function answerGeneralAssistant(input: {
  question: string;
  profileSearch: ProfileSearchRepository;
}): Promise<GeneralAssistantResponse> {
  const request = searchRequest(input.question);
  if (!request) {
    return {
      kind: "needs_context",
      text: "I can help you find profiles, contacts, event families, seasonal events, overdue follow-ups, or customers by package history. For customer-specific history or call help, choose a profile first.",
    };
  }

  const results = await input.profileSearch.search(request);
  return {
    kind: "profile_results",
    text: results.length
      ? `I found ${results.length} matching ${results.length === 1 ? "profile" : "profiles"}.`
      : "I couldn't find a matching profile or event. Try a broader name, city, state, contact, event type, or package search.",
    results,
  };
}