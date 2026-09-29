import type { ModelConfig } from "./model-config";

// Standard prices verified 2026-09-26 at https://developers.openai.com/api/docs/pricing.
// Budget amounts are conservative estimates, not an OpenAI invoice: cache hits
// are charged at the highest applicable input rate until billing is reconciled.
export const SPENDING_PRICING_VERSION = "openai-conservative-2026-09-26";
export const LONG_CONTEXT_THRESHOLD = 272_000;
export const MAX_MODEL_CONTEXT = 1_050_000;
// https://developers.openai.com/api/docs/guides/tools-web-search limits the
// Responses web-search context to 128k even when the model supports more.
export const SEARCH_CONTEXT = 128_000;
export const SEARCH_CALL_NANOS = 10_000_000;
type Rate = { input: number; output: number };
const rates: Record<string, { short: Rate; long?: Rate }> = {
  "gpt-6-astra": {
    short: { input: 12_500, output: 50_000 },
    long: { input: 25_000, output: 75_000 },
  },
  "gpt-6-sol": {
    short: { input: 2_500, output: 10_000 },
    long: { input: 5_000, output: 15_000 },
  },
  "gpt-6-luna": {
    short: { input: 125, output: 500 },
    long: { input: 250, output: 750 },
  },
  // Mini/nano model pages publish flat pricing for their 400k context.
  "gpt-5.4-mini": {
    short: { input: 750, output: 4_500 },
    long: { input: 750, output: 4_500 },
  },
  "gpt-5.4-nano": {
    short: { input: 200, output: 1_250 },
    long: { input: 200, output: 1_250 },
  },
};
const snapshots: Record<string, string> = {
  "gpt-5.4-mini-2026-03-17": "gpt-5.4-mini",
  "gpt-5.4-nano-2026-03-17": "gpt-5.4-nano",
};
export const canonicalSpendingModel = (model: string) =>
  snapshots[model] ?? model;
export function spendingContextLimit(model: string): number | undefined {
  const canonical = canonicalSpendingModel(model);
  return !rates[canonical]
    ? undefined
    : canonical.startsWith("gpt-5.4-")
      ? 400_000
      : MAX_MODEL_CONTEXT;
}
export function spendingRate(
  model: string,
  inputTokens: number,
): Rate | undefined {
  const price = rates[canonicalSpendingModel(model)];
  return inputTokens > LONG_CONTEXT_THRESHOLD ? price?.long : price?.short;
}
export function chooseEconomyModel(
  models: readonly string[],
): string | undefined {
  for (const candidate of [
    "gpt-6-luna",
    "gpt-5.4-nano",
    "gpt-5.4-mini",
    "gpt-6-sol",
    "gpt-6-astra",
  ]) {
    const configured = models.find(
      (model) => canonicalSpendingModel(model) === candidate,
    );
    if (configured) return configured;
  }
  return undefined;
}
export function modelForEconomy(
  config: Pick<ModelConfig, "models" | "model">,
  selected: string | undefined,
  economy: boolean,
): string {
  return (
    (economy ? chooseEconomyModel(config.models) : undefined) ??
    selected ??
    config.model
  );
}
