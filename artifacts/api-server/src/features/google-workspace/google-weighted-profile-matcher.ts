import type { GoogleRelevanceCandidate } from "./google-relevance-classifier";

export type GoogleWeightedProfileMatch = {
  status: "matched" | "review" | "none";
  evidenceCodes: string[];
  candidates: GoogleRelevanceCandidate[];
};

const GENERIC_EVENT_WORDS = new Set([
  "fair",
  "festival",
  "fest",
  "days",
  "day",
  "city",
  "county",
  "state",
  "event",
  "events",
  "show",
  "shows",
  "rodeo",
  "annual",
  "the",
  "and",
  "of",
]);

const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY",
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token));
}

function uniqueTokens(value: string): Set<string> {
  return new Set(tokens(value));
}

function explicitStates(value: string): Set<string> {
  const matches = value.match(/\b[A-Z]{2}\b/g) ?? [];
  return new Set(matches.filter((code) => STATE_CODES.has(code)));
}

function scoreProfile(input: {
  textTokens: Set<string>;
  textStates: Set<string>;
  profileName: string;
}) {
  const profileTokens = uniqueTokens(input.profileName);
  const profileStates = explicitStates(input.profileName);

  let score = 0;
  let distinctiveShared = 0;
  let genericShared = 0;

  for (const token of profileTokens) {
    if (!input.textTokens.has(token)) continue;
    const upper = token.toUpperCase();
    if (profileStates.has(upper) && input.textStates.has(upper)) {
      score += 5;
      continue;
    }
    if (GENERIC_EVENT_WORDS.has(token)) {
      genericShared += 1;
      score += 0.5;
      continue;
    }
    if (STATE_CODES.has(upper) && profileStates.has(upper)) {
      continue;
    }
    distinctiveShared += 1;
    score += token.length >= 7 ? 4 : 3;
  }

  if (
    profileStates.size > 0 &&
    input.textStates.size > 0 &&
    ![...profileStates].some((state) => input.textStates.has(state))
  ) {
    score -= 4;
  }

  return { score, distinctiveShared, genericShared };
}

export function matchGoogleTextToProfiles(input: {
  text: string;
  profiles: Array<{ id: string; name: string }>;
}): GoogleWeightedProfileMatch {
  const boundedText = input.text.slice(0, 50_000);
  const textTokens = uniqueTokens(boundedText);
  const textStates = explicitStates(boundedText);
  if (textTokens.size === 0) {
    return { status: "none", evidenceCodes: [], candidates: [] };
  }

  const ranked = input.profiles
    .map((profile) => ({
      profile,
      ...scoreProfile({ textTokens, textStates, profileName: profile.name }),
    }))
    .filter((entry) => entry.distinctiveShared > 0 && entry.score >= 3)
    .sort((left, right) => right.score - left.score || left.profile.name.localeCompare(right.profile.name));

  if (!ranked.length) {
    return { status: "none", evidenceCodes: [], candidates: [] };
  }

  const top = ranked[0];
  const second = ranked[1];
  const gap = top.score - (second?.score ?? 0);
  const confident = top.score >= 8 && gap >= 3;
  const candidates = ranked.slice(0, 5).map(({ profile }) => ({
    id: profile.id,
    name: profile.name,
    kind: "profile" as const,
  }));

  if (confident) {
    return {
      status: "matched",
      evidenceCodes: ["weighted_profile_text_match"],
      candidates: [candidates[0]],
    };
  }

  return {
    status: "review",
    evidenceCodes: ["weighted_profile_text_ambiguous"],
    candidates,
  };
}
