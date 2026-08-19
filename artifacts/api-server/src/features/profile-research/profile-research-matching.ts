import type { ProfileResearchContext, ResearchConfidence } from "./profile-research-types";

export type IdentityEvidence = {
  url: string;
  title: string;
  publisher?: string | null;
  name?: string | null;
  city?: string | null;
  region?: string | null;
  contactNames?: string[];
  venue?: string | null;
  official?: boolean;
  government?: boolean;
  pageAccessible?: boolean;
};

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return new Set(normalize(value).split(/\s+/).filter(Boolean));
}

function tokenOverlap(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.min(a.size, b.size);
}

export function evaluateIdentityMatch(
  context: ProfileResearchContext,
  evidence: IdentityEvidence,
): { confidence: ResearchConfidence; rationale: string; writable: boolean } {
  if (evidence.pageAccessible === false) {
    return { confidence: "low", rationale: "The page could not be opened and verified.", writable: false };
  }

  const regionFact = context.knownFacts.find((fact) => fact.key === "region")?.value ?? "";
  const cityFact = context.knownFacts.find((fact) => fact.key === "city")?.value ?? "";
  const profileName = context.profileName;

  if (regionFact && evidence.region && normalize(regionFact) !== normalize(evidence.region)) {
    return { confidence: "low", rationale: "A same-name result is in a different state or region.", writable: false };
  }

  const nameScore = tokenOverlap(profileName, evidence.name ?? evidence.title);
  const cityMatches = !cityFact || !evidence.city || normalize(cityFact) === normalize(evidence.city);
  const contactFacts = context.knownFacts
    .filter((fact) => fact.key.startsWith("contact:"))
    .map((fact) => normalize(fact.value));
  const contactMatch = (evidence.contactNames ?? []).some((name) =>
    contactFacts.some((fact) => fact.includes(normalize(name)) || normalize(name).includes(fact)),
  );

  if (nameScore >= 0.8 && cityMatches && (evidence.official || evidence.government)) {
    return {
      confidence: "high",
      rationale: evidence.official
        ? "The event name/location match an official source."
        : "The event name/location match an official government source.",
      writable: true,
    };
  }

  if (nameScore >= 0.6 && cityMatches && contactMatch) {
    return {
      confidence: "high",
      rationale: "The event name/location and a known organizer contact match.",
      writable: true,
    };
  }

  if (nameScore >= 0.6 && cityMatches) {
    return {
      confidence: "medium",
      rationale: "The event name and location are consistent, but the source is not authoritative enough for a high-confidence match.",
      writable: true,
    };
  }

  return {
    confidence: "low",
    rationale: "The public result does not match enough saved profile details to safely identify the same event.",
    writable: false,
  };
}

export function isSafeResearchUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function boundedExcerpt(value: string, max = 500) {
  const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
