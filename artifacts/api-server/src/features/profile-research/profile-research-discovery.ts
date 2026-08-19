import { boundedExcerpt, isSafeResearchUrl } from "./profile-research-matching";

export type ResearchFinding = {
  label: string;
  value: string;
  rationale: string;
  sourceUrls: string[];
};

export type RelatedEventOpportunity = {
  name: string;
  city: string | null;
  region: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  url: string;
  rationale: string;
};

export function summarizeResearchFinding(input: Partial<ResearchFinding>): ResearchFinding | null {
  const label = String(input.label ?? "").trim();
  const value = String(input.value ?? "").trim();
  const sourceUrls = (input.sourceUrls ?? []).filter((url) => typeof url === "string" && isSafeResearchUrl(url));
  if (!label || !value || !sourceUrls.length) return null;
  return {
    label: boundedExcerpt(label, 120),
    value: boundedExcerpt(value, 500),
    rationale: boundedExcerpt(String(input.rationale ?? "Supported by cited public sources."), 500),
    sourceUrls: [...new Set(sourceUrls)],
  };
}

export function normalizeRelatedEvent(input: Partial<RelatedEventOpportunity>): RelatedEventOpportunity | null {
  const name = String(input.name ?? "").trim();
  const url = String(input.url ?? "").trim();
  if (!name || !isSafeResearchUrl(url)) return null;
  const clean = (value: unknown, max = 180) => {
    const text = String(value ?? "").trim();
    return text ? boundedExcerpt(text, max) : null;
  };
  return {
    name: boundedExcerpt(name, 180),
    city: clean(input.city, 120),
    region: clean(input.region, 40),
    startsAt: clean(input.startsAt, 60),
    endsAt: clean(input.endsAt, 60),
    venue: clean(input.venue, 180),
    url,
    rationale: boundedExcerpt(String(input.rationale ?? "Found on a cited public event source."), 500),
  };
}
