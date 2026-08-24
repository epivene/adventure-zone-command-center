import type { GoogleRelevanceCandidate } from "./google-relevance-classifier";
import { matchGoogleTextToProfiles } from "./google-weighted-profile-matcher";

export type GoogleBodyProfileMatch = {
  status: "matched" | "review" | "none";
  evidenceCodes: string[];
  candidates: GoogleRelevanceCandidate[];
};

const INTERNAL_PROFILE_PREFIXES = ["adventure zone"] as const;

function canonical(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coreProfileName(value: string): string {
  return canonical(
    value
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b[A-Z]{2}\s*$/i, " "),
  );
}

function bodyEligibleName(value: string): string | null {
  const core = coreProfileName(value);
  if (!core) return null;
  if (INTERNAL_PROFILE_PREFIXES.some((prefix) => core.startsWith(prefix))) {
    return null;
  }
  const words = core.split(" ").filter(Boolean);
  if (core.length < 8 && words.length < 2) return null;
  return core;
}

function containsWholePhrase(body: string, phrase: string): boolean {
  if (!body || !phrase) return false;
  return ` ${body} `.includes(` ${phrase} `);
}

export function matchGoogleBodyToProfiles(input: {
  bodyText: string;
  profiles: Array<{ id: string; name: string }>;
}): GoogleBodyProfileMatch {
  const body = canonical(input.bodyText.slice(0, 50_000));
  if (!body) return { status: "none", evidenceCodes: [], candidates: [] };

  const eligibleProfiles = input.profiles.filter(
    (profile) => bodyEligibleName(profile.name) !== null,
  );
  const matches = eligibleProfiles.flatMap((profile) => {
    const phrase = bodyEligibleName(profile.name);
    if (!phrase || !containsWholePhrase(body, phrase)) return [];
    return [{ id: profile.id, name: profile.name, kind: "profile" as const }];
  });

  const unique = [...new Map(matches.map((candidate) => [candidate.id, candidate])).values()];
  if (unique.length === 1) {
    return {
      status: "matched",
      evidenceCodes: ["exact_profile_name_body"],
      candidates: unique,
    };
  }
  if (unique.length > 1) {
    return {
      status: "review",
      evidenceCodes: ["ambiguous_profile_name_body"],
      candidates: unique,
    };
  }

  const weighted = matchGoogleTextToProfiles({
    text: body,
    profiles: eligibleProfiles,
  });
  if (weighted.status === "matched") {
    return {
      status: "matched",
      evidenceCodes: ["weighted_profile_body_match"],
      candidates: weighted.candidates,
    };
  }
  if (weighted.status === "review") {
    return {
      status: "review",
      evidenceCodes: ["weighted_profile_body_ambiguous"],
      candidates: weighted.candidates,
    };
  }

  return { status: "none", evidenceCodes: [], candidates: [] };
}
