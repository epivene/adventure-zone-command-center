import type { WebsiteAuditStatus } from "./assistant-job-types";
import type { WebsiteFetchResult } from "./website-audit-http";
import type { WebsiteAuditRecord } from "./website-audit-record-repository";

export type WebsiteMatchAssessment = {
  status: WebsiteAuditStatus;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

const STOP_WORDS = new Set([
  "the", "and", "of", "in", "at", "for", "event", "events", "festival", "fair",
  "county", "city", "inc", "llc", "co", "association", "community",
]);

function tokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function hostname(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostnameMatchesEmailDomain(record: WebsiteAuditRecord, fetched: WebsiteFetchResult): boolean {
  if (!record.primaryEmailDomain) return false;
  const emailDomain = record.primaryEmailDomain.toLowerCase().replace(/^www\./, "");
  const host = hostname(fetched.finalUrl ?? fetched.requestedUrl);
  return Boolean(host && (host === emailDomain || host.endsWith(`.${emailDomain}`) || emailDomain.endsWith(`.${host}`)));
}

function overlapCount(needles: string[], haystack: string): number {
  const normalized = ` ${haystack.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ")} `;
  return needles.filter((token) => normalized.includes(` ${token} `)).length;
}

export function assessWebsiteMatch(input: {
  record: WebsiteAuditRecord;
  fetched: WebsiteFetchResult;
}): WebsiteMatchAssessment {
  const { record, fetched } = input;
  if (!fetched.reachable || fetched.failure) {
    return {
      status: "broken",
      confidence: fetched.failure === "timeout" || fetched.failure === "dns" ? "high" : "medium",
      reasons: [fetched.failure ? `Website check failed: ${fetched.failure}.` : "Website did not respond."],
    };
  }

  const evidence = `${fetched.title ?? ""} ${fetched.textSample}`;
  const nameTokens = tokens(record.label);
  const nameHits = overlapCount(nameTokens, evidence);
  const nameRatio = nameTokens.length ? nameHits / nameTokens.length : 0;
  const city = record.city?.trim().toLowerCase() ?? "";
  const region = record.region?.trim().toLowerCase() ?? "";
  const evidenceText = evidence.toLowerCase();
  const cityMatch = Boolean(city && evidenceText.includes(city));
  const regionMatch = Boolean(region && new RegExp(`(^|[^a-z])${region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(evidence));
  const domainMatch = hostnameMatchesEmailDomain(record, fetched);
  const strongName = nameTokens.length === 0 ? false : nameRatio >= 0.6 || nameHits >= 2;

  if (strongName && (cityMatch || regionMatch || domainMatch)) {
    return {
      status: fetched.redirected ? "redirected" : "verified_match",
      confidence: "high",
      reasons: [
        "Website content matches the profile name.",
        cityMatch ? "Website content matches the saved city." : regionMatch ? "Website content matches the saved region." : "Website domain matches the primary contact email domain.",
        ...(fetched.redirected ? ["Saved URL redirects to the matching website."] : []),
      ],
    };
  }

  if (domainMatch && (cityMatch || regionMatch || nameHits >= 1)) {
    return {
      status: fetched.redirected ? "redirected" : "verified_match",
      confidence: "high",
      reasons: ["Website domain matches the primary contact email domain.", "Page contains additional profile identity evidence."],
    };
  }

  if (strongName || cityMatch || domainMatch) {
    return {
      status: "reachable_uncertain",
      confidence: "medium",
      reasons: ["Website is reachable and contains some matching profile evidence, but not enough to verify confidently."],
    };
  }

  const evidenceTokens = tokens(evidence);
  if (evidenceTokens.length >= 3 && nameTokens.length >= 1 && nameHits === 0 && !cityMatch && !domainMatch) {
    return {
      status: "likely_mismatch",
      confidence: "medium",
      reasons: ["Website is reachable, but the page identity does not match the saved profile name or location."],
    };
  }

  return {
    status: "reachable_uncertain",
    confidence: "low",
    reasons: ["Website is reachable, but there is not enough identity evidence to verify the match."],
  };
}
