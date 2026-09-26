// Published standard USD prices, verified 2026-09-25:
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/guides/prompt-caching
// https://developers.openai.com/api/docs/models/gpt-5.4-mini
// https://developers.openai.com/api/docs/models/gpt-5.4-nano
// Only exact model IDs and measured standard-tier usage are eligible. Keeping the
// rate version with each call prevents later price changes from rewriting history.
const PRICING_VERSION = "openai-standard-2026-09-25";
const rates: Record<
  string,
  { input: number; cached: number; write: number | null; output: number }
> = {
  "gpt-6-astra": { input: 10, cached: 1, write: 12.5, output: 50 },
  "gpt-6-sol": { input: 2, cached: 0.2, write: 2.5, output: 10 },
  "gpt-6-luna": { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, write: null, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, write: null, output: 1.25 },
};
const snapshots: Record<string, string> = {
  "gpt-5.4-mini-2026-03-17": "gpt-5.4-mini",
  "gpt-5.4-nano-2026-03-17": "gpt-5.4-nano",
};
export type ProviderCostCall = {
  responseId: string | null;
  source: "assistant" | "document" | "research";
  model: string | null;
  serviceTier: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  observedAt: string;
  pricingVersion: string | null;
  estimatedUsd: number | null;
  excluded: string[];
};
export type CostCheckpoint = {
  calls: Record<string, ProviderCostCall>;
  excluded: string[];
  pendingModel?: boolean;
};
export type UsageCostSummary = {
  currency: "USD";
  estimatedUsd: number | null;
  status: "complete" | "partial" | "unavailable";
  pricedCalls: number;
  unpricedCalls: number;
  pricingVersions: string[];
  excluded: string[];
};
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const string = (value: unknown) => (typeof value === "string" ? value : null);
export function meterOpenAiResponse(
  raw: unknown,
  source: ProviderCostCall["source"],
  exclusions: string[] = [],
): ProviderCostCall {
  const response = raw as any;
  const model = string(response?.model);
  const rate = model ? rates[snapshots[model] ?? model] : undefined;
  const inputTokens = count(response?.usage?.input_tokens);
  const cachedInputTokens = count(
    response?.usage?.input_tokens_details?.cached_tokens,
  );
  const cacheWriteTokens = count(
    response?.usage?.input_tokens_details?.cache_write_tokens ??
      (rate?.write === null ? 0 : undefined),
  );
  const outputTokens = count(response?.usage?.output_tokens);
  const serviceTier = string(response?.service_tier);
  const excluded = [...exclusions];
  let estimatedUsd: number | null = null;
  if (!rate)
    excluded.push(
      "The actual model has no verified price in this pricing version.",
    );
  else if (serviceTier !== "default")
    excluded.push("The actual service tier has no verified standard price.");
  else if (
    inputTokens === null ||
    cachedInputTokens === null ||
    cacheWriteTokens === null ||
    outputTokens === null ||
    cachedInputTokens + cacheWriteTokens > inputTokens ||
    (rate.write === null && cacheWriteTokens > 0)
  )
    excluded.push("Provider token and cache usage is missing or invalid.");
  else if (inputTokens > 272000)
    excluded.push("Long-context pricing is excluded from this estimate.");
  else {
    // Integer nanodollars retain sub-cent calls and avoid double charging cached tokens.
    const nanos =
      (inputTokens - cachedInputTokens - cacheWriteTokens) *
        Math.round(rate.input * 1000) +
      cachedInputTokens * Math.round(rate.cached * 1000) +
      cacheWriteTokens * Math.round((rate.write ?? 0) * 1000) +
      outputTokens * Math.round(rate.output * 1000);
    if (Number.isSafeInteger(nanos)) estimatedUsd = nanos / 1_000_000_000;
    else excluded.push("Provider usage exceeds the supported estimate range.");
  }
  if (response?.status !== "completed")
    excluded.push(
      "The provider response did not complete; final billing may include additional usage.",
    );
  return {
    responseId: string(response?.id),
    source,
    model,
    serviceTier,
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    observedAt: new Date().toISOString(),
    pricingVersion: estimatedUsd === null ? null : PRICING_VERSION,
    estimatedUsd,
    excluded: [...new Set(excluded)],
  };
}
export class ModelCostError extends Error {
  constructor(
    message: string,
    readonly costCall: ProviderCostCall,
  ) {
    super(message);
  }
}
export function summarizeCost(
  calls: ProviderCostCall[],
  exclusions: string[] = [],
): UsageCostSummary {
  const priced = calls.filter(
    (c) => c.estimatedUsd !== null && Number.isFinite(c.estimatedUsd),
  );
  const excluded = [
    ...new Set([...exclusions, ...calls.flatMap((c) => c.excluded)]),
  ];
  const unknown = calls.length - priced.length;
  return {
    currency: "USD",
    estimatedUsd: priced.length
      ? Math.round(
          priced.reduce((n, c) => n + c.estimatedUsd! * 1_000_000_000, 0),
        ) / 1_000_000_000
      : null,
    status: !priced.length
      ? "unavailable"
      : unknown || excluded.length
        ? "partial"
        : "complete",
    pricedCalls: priced.length,
    unpricedCalls: unknown,
    pricingVersions: [
      ...new Set(
        priced.flatMap((c) => (c.pricingVersion ? [c.pricingVersion] : [])),
      ),
    ],
    excluded,
  };
}
export function summarizeRunCost(run: {
  status: string;
  turn?: { cost?: CostCheckpoint; tokens?: number; final?: unknown };
}): UsageCostSummary {
  const cost = run.turn?.cost;
  const excluded = [...(cost?.excluded ?? [])];
  if (!cost) excluded.push("Historical or unmetered run usage is unavailable.");
  if (cost?.pendingModel)
    excluded.push("An interrupted model call has unverified usage.");
  if (["queued", "running"].includes(run.status))
    excluded.push("This run is still in progress.");
  if (!run.turn?.final && ["failed", "cancelled"].includes(run.status))
    excluded.push(
      "An interrupted run may include usage that was not checkpointed.",
    );
  return summarizeCost(Object.values(cost?.calls ?? {}), excluded);
}
export function combineCostSummaries(
  summaries: UsageCostSummary[],
): UsageCostSummary {
  const known = summaries.filter((s) => s.estimatedUsd !== null);
  const excluded = [...new Set(summaries.flatMap((s) => s.excluded))];
  return {
    currency: "USD",
    estimatedUsd: !summaries.length
      ? 0
      : known.length
        ? Math.round(
            known.reduce((n, s) => n + s.estimatedUsd! * 1_000_000_000, 0),
          ) / 1_000_000_000
        : null,
    status: !summaries.length
      ? "complete"
      : !known.length
        ? "unavailable"
        : summaries.some((s) => s.status !== "complete")
          ? "partial"
          : "complete",
    pricedCalls: summaries.reduce((n, s) => n + s.pricedCalls, 0),
    unpricedCalls: summaries.reduce((n, s) => n + s.unpricedCalls, 0),
    pricingVersions: [...new Set(summaries.flatMap((s) => s.pricingVersions))],
    excluded,
  };
}
