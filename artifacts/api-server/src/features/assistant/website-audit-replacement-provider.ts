import type { WebsiteAuditHttpClient } from "./website-audit-http";
import { SafeWebsiteAuditHttpClient } from "./website-audit-http";
import type { WebsiteAuditRecord } from "./website-audit-record-repository";

export interface WebsiteReplacementProvider {
  findOfficialReplacement(input: WebsiteAuditRecord): Promise<{
    url: string;
    confidence: "high" | "medium" | "low";
    reasons: string[];
    sourceRefs: string[];
  } | null>;
}

type SearchResult = {
  url: string;
  title: string;
  snippet: string;
  sourceRef: string;
};

type SearchFn = (query: string) => Promise<SearchResult[]>;

function normalizedTokens(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !["the", "and", "event", "events", "festival", "fair", "county"].includes(token));
}

function identityScore(record: WebsiteAuditRecord, result: SearchResult): { score: number; reasons: string[] } {
  const evidence = `${result.title} ${result.snippet}`.toLowerCase();
  const nameTokens = normalizedTokens(record.label);
  const nameHits = nameTokens.filter((token) => evidence.includes(token)).length;
  const strongName = nameTokens.length > 0 && (nameHits >= 2 || nameHits / nameTokens.length >= 0.6);
  const city = record.city?.toLowerCase() ?? "";
  const region = record.region?.toLowerCase() ?? "";
  const cityMatch = Boolean(city && evidence.includes(city));
  const regionMatch = Boolean(region && evidence.includes(region));
  let domainMatch = false;
  try {
    const host = new URL(result.url).hostname.toLowerCase().replace(/^www\./, "");
    const emailDomain = record.primaryEmailDomain?.toLowerCase().replace(/^www\./, "") ?? "";
    domainMatch = Boolean(emailDomain && (host === emailDomain || host.endsWith(`.${emailDomain}`)));
  } catch {
    domainMatch = false;
  }

  const reasons: string[] = [];
  let score = 0;
  if (strongName) { score += 3; reasons.push("Search result matches the event/profile name."); }
  if (cityMatch) { score += 2; reasons.push("Search result matches the saved city."); }
  else if (regionMatch) { score += 1; reasons.push("Search result matches the saved region."); }
  if (domainMatch) { score += 3; reasons.push("Candidate domain matches the primary contact email domain."); }
  if (/\bofficial\b/i.test(result.snippet) || /\bofficial\b/i.test(result.title)) {
    score += 1;
    reasons.push("Search evidence identifies the result as official.");
  }
  return { score, reasons };
}

async function defaultSearch(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return [];
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PROFILE_RESEARCH_OPENAI_MODEL || "gpt-5-mini",
      store: false,
      tools: [{ type: "web_search", search_context_size: "medium" }],
      input: `Find the official website for this event/profile. Return only JSON with a results array of up to 5 objects containing url, title, snippet. Query: ${query}`,
    }),
  });
  if (!response.ok) return [];
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const raw = payload.output_text ?? (payload.output ?? []).flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n");
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned) as { results?: unknown[] };
    if (!Array.isArray(parsed.results)) return [];
    return parsed.results.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      if (typeof row.url !== "string" || typeof row.title !== "string") return [];
      return [{
        url: row.url,
        title: row.title.slice(0, 300),
        snippet: typeof row.snippet === "string" ? row.snippet.slice(0, 1000) : "",
        sourceRef: row.url,
      }];
    }).slice(0, 5);
  } catch {
    return [];
  }
}

export class SearchWebsiteReplacementProvider implements WebsiteReplacementProvider {
  private readonly search: SearchFn;
  private readonly inspect: WebsiteAuditHttpClient;

  constructor(input?: { search?: SearchFn; inspect?: WebsiteAuditHttpClient }) {
    this.search = input?.search ?? defaultSearch;
    this.inspect = input?.inspect ?? new SafeWebsiteAuditHttpClient();
  }

  async findOfficialReplacement(record: WebsiteAuditRecord) {
    const query = `${record.label} ${record.city ?? ""} ${record.region ?? ""} official website`.replace(/\s+/g, " ").trim();
    const results = await this.search(query);
    let best: { url: string; score: number; reasons: string[]; sourceRefs: string[] } | null = null;

    for (const result of results.slice(0, 5)) {
      const inspected = await this.inspect.inspect(result.url);
      if (!inspected.reachable || inspected.failure || !inspected.finalUrl) continue;
      const scored = identityScore(record, { ...result, url: inspected.finalUrl });
      if (!best || scored.score > best.score) {
        best = {
          url: inspected.finalUrl,
          score: scored.score,
          reasons: scored.reasons,
          sourceRefs: [result.sourceRef].filter(Boolean).slice(0, 4),
        };
      }
    }

    if (!best) return null;
    return {
      url: best.url,
      confidence: best.score >= 5 ? "high" as const : best.score >= 2 ? "medium" as const : "low" as const,
      reasons: best.reasons.length ? best.reasons : ["A possible replacement website was found, but identity evidence is weak."],
      sourceRefs: best.sourceRefs,
    };
  }
}
