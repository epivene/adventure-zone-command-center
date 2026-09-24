export type ModelConfig = {
  enabled: boolean;
  allowedActorIds: string[];
  model: string;
  models: string[];
  apiKey: string;
  maxSteps: number;
  maxOutputTokens: number;
  maxRunTokens: number;
  timeoutMs: number;
  error: string | null;
};
export function readModelConfig(
  env: Record<string, string | undefined>,
): ModelConfig {
  const allowedActorIds = (env.ASSISTANT_WORKSPACE_ACTOR_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const model = (env.ASSISTANT_OPENAI_MODEL ?? "").trim(),
    apiKey = env.OPENAI_API_KEY ?? "";
  const limits: [string, number, number, number][] = [
    ["ASSISTANT_MAX_STEPS", 12, 1, 30],
    ["ASSISTANT_MAX_OUTPUT_TOKENS", 8192, 256, 32768],
    ["ASSISTANT_MAX_RUN_TOKENS", 100000, 1000, 500000],
    ["ASSISTANT_MODEL_TIMEOUT_MS", 120000, 1000, 180000],
  ];
  let invalid = false;
  const values = limits.map(([key, fallback, min, max]) => {
    const n = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(n) || n < min || n > max) {
      invalid = true;
      return fallback;
    }
    return n;
  });
  const models = [
    ...new Set(
      (env.ASSISTANT_OPENAI_MODELS ?? model)
        .split(",")
        .map((x) => x.trim())
        .filter((x) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(x)),
    ),
  ];
  const configured =
    allowedActorIds.length > 0 &&
    models.includes(model) &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model) &&
    Boolean(apiKey.trim()) &&
    !invalid;
  return {
    enabled: env.ASSISTANT_WORKSPACE_ENABLED === "true" && configured,
    allowedActorIds,
    model,
    models,
    apiKey,
    maxSteps: values[0],
    maxOutputTokens: values[1],
    maxRunTokens: values[2],
    timeoutMs: values[3],
    error: configured ? null : "ASSISTANT_CONFIGURATION_REQUIRED",
  };
}
