import type {
  LeadScoutEvidenceFact,
  LeadScoutSourceCategory,
  LeadScoutSourceInput,
} from "./lead-scout-types";

const authorityRank: Record<LeadScoutSourceCategory, number> = {
  official_event: 800,
  government: 700,
  tourism_chamber: 700,
  vendor_application: 650,
  venue_partner: 550,
  news_recap: 450,
  social: 250,
  review_forum: 150,
  other: 100,
};

const confidenceRank = { high: 30, medium: 20, low: 10 } as const;
const hardFactCategories = new Set<LeadScoutEvidenceFact["category"]>([
  "identity",
  "schedule",
  "vendor",
  "attendance",
  "logistics",
  "competition",
  "contact",
]);

const officialOperationalSources = new Set<LeadScoutSourceCategory>([
  "official_event",
  "government",
  "tourism_chamber",
  "vendor_application",
  "venue_partner",
]);

function sourceAuthority(fact: LeadScoutEvidenceFact, sources: LeadScoutSourceInput[]) {
  const byUrl = new Map(sources.map((source) => [source.url, source.category] as const));
  return Math.max(0, ...fact.sourceUrls.map((url) => authorityRank[byUrl.get(url) ?? "other"]));
}

function normalizedConfidence(
  fact: LeadScoutEvidenceFact,
  sources: LeadScoutSourceInput[],
): LeadScoutEvidenceFact["confidence"] {
  if (!hardFactCategories.has(fact.category)) return fact.confidence;
  const categories = fact.sourceUrls
    .map((url) => sources.find((source) => source.url === url)?.category)
    .filter((value): value is LeadScoutSourceCategory => Boolean(value));
  if (categories.length && categories.every((category) => category === "social" || category === "review_forum" || category === "other")) {
    return "low";
  }
  return fact.confidence;
}

export function selectBestFact(
  facts: LeadScoutEvidenceFact[],
  sources: LeadScoutSourceInput[] = [],
): LeadScoutEvidenceFact | null {
  if (!facts.length) return null;
  return facts
    .map((fact, index) => {
      const confidence = normalizedConfidence(fact, sources);
      return {
        fact: { ...fact, confidence },
        score: sourceAuthority(fact, sources) + confidenceRank[confidence],
        index,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.fact ?? null;
}

export function isOperationallyReliableFact(
  fact: LeadScoutEvidenceFact | null,
  sources: LeadScoutSourceInput[],
): fact is LeadScoutEvidenceFact {
  if (!fact || fact.confidence === "low" || fact.category === "social_review") return false;
  const categories = fact.sourceUrls
    .map((url) => sources.find((source) => source.url === url)?.category)
    .filter((value): value is LeadScoutSourceCategory => Boolean(value));
  if (!categories.length) return false;
  if (fact.category === "attendance" || fact.category === "recurrence") {
    return categories.some((category) => officialOperationalSources.has(category) || category === "news_recap");
  }
  return categories.some((category) => officialOperationalSources.has(category));
}

export function sourceAuthorityScore(category: LeadScoutSourceCategory): number {
  return authorityRank[category];
}
