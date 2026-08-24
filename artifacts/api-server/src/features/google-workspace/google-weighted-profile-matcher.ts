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
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms",
  "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
  "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
  "wi", "wy",
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

function scoreProfile(textTokens: Set<string>, profileName: string) {
  const profileTokens = uniqueTokens(profileName);
  const profileStates = [...profileTokens].filter((token) => STATE_CODES.has(token));
  const textStates = [...textTokens].filter((token) => STATE_CODES.has(token));

  let score = 0;
  let distinctiveShared = 0;
  let genericShared = 0;

  for (const token of profileTokens) {
    if (!textTokens.has(token)) continue;
    if (STATE_CODES.has(token)) {
      score += 5;
      continue;
    }
    if (GENERIC_EVENT_WORDS.has(token)) {
      genericShared += 1;
      score += 0.5;
      continue;
    }
    distinctiveShared += 1;
    score += token.length >= 7 ? 4 : 3;
  }

  if (
    profileStates.length > 0 &&
    textStates.length > 0 &&
    !profileStates.some((state) => textStates.includes(state))
  ) {
    score -= 4;
  }

  return { score, distinctiveShared, genericShared };
}

export function matchGoogleTextToProfiles(input: {
  text: string;
  profiles: Array<{ id: string; name: string }>;
}): GoogleWeightedProfileMatch {
  const textTokens = uniqueTokens(input.text.slice(0, 50_000));
  if (textTokens.size === 0) {
    return { status: "none", evidenceCodes: [], candidates: [] };
  }

  const ranked = input.profiles
    .map((profile) => ({
      profile,
      ...scoreProfile(textTokens, profile.name),
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
