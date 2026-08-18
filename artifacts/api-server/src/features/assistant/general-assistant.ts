import type { AssistantAnswer } from "./assistant-types";
import type { ProfileSearchRepository } from "./profile-search-repository";
import type { AssistantProfileSearchResult, ProfileSearchRequest } from "./profile-search-types";

export type GeneralAssistantResponse =
  | { kind: "profile_results"; text: string; results: AssistantProfileSearchResult[] }
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

const recurringEventTheme = /\b(christmas|xmas|halloween|oktoberfest|octoberfest|4th of july|fourth of july|independence day|easter|thanksgiving|memorial day|labor day|new year(?:'s)?|st\.? patrick(?:'s)? day|valentine(?:'s)? day)\b/i;

function cleanSearchSubject(value: string) {
  return value
    .replace(/^(find|search for|search|show me|show)\s+/i, "")
    .replace(/^(the\s+)?(profile|profiles|contact|contacts|customer|customers|event|events)\s+(for\s+)?/i, "")
    .replace(/[?.!]+$/g, "")
    .trim();
}

function searchRequest(question: string): ProfileSearchRequest | null {
  const raw = question.trim();
  const lower = raw.toLowerCase();

  if (/overdue follow[- ]?ups|who needs (a )?(call|follow[- ]?up)|who.*overdue/.test(lower)) {
    return { query: "follow-up", overdueFollowUp: true, limit: 8 };
  }

  const packageMatch = raw.match(/(?:usually\s+books?|book(?:s|ed)?|with)\s+(.+?)(?:\?|$)/i);
  if (packageMatch && /who|profile|customer|event/i.test(raw)) {
    const packageName = packageMatch[1]?.replace(/[?.!]+$/g, "").trim();
    if (packageName) return { query: packageName, packageName, limit: 8 };
  }

  // Holiday/theme discovery should work even when the user does not say
  // "find" or "profile". Retrieval still goes through the same bounded,
  // server-side profile search repository.
  const themeMatch = raw.match(recurringEventTheme);
  if (themeMatch?.[1]) {
    return { query: themeMatch[1], limit: 8 };
  }

  const looksLikeSearch = /^(find|search|show)/i.test(raw) || /\b(profile|contact|customer|event family)\b/i.test(raw);
  if (!looksLikeSearch) return null;

  let subject = cleanSearchSubject(raw);
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
      text: "I can search Command Center profiles and event families by name, holiday/theme, contact, city, state, overdue follow-up, or package history. Try something like ‘Christmas events,’ ‘Oktoberfest,’ or ‘events in North Dakota.’",
    };
  }

  const results = await input.profileSearch.search(request);
  return {
    kind: "profile_results",
    text: results.length
      ? `I found ${results.length} matching ${results.length === 1 ? "profile" : "profiles"}.`
      : "I couldn't find a matching profile or event. Try a broader event/theme name, city, state, contact, or package search.",
    results,
  };
}
