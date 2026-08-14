/**
 * Provider-agnostic AI completion client factory.
 *
 * Priority order:
 *   1. Replit Anthropic proxy   (AI_INTEGRATIONS_ANTHROPIC_BASE_URL + AI_INTEGRATIONS_ANTHROPIC_API_KEY)
 *   2. Direct Anthropic key     (ANTHROPIC_API_KEY)
 *   3. OpenAI key               (OPENAI_API_KEY)
 *
 * Throws with code NOT_CONFIGURED_ERROR when none of the above is available.
 * The analyze route catches this code and returns 503 before opening the SSE stream.
 */

export const NOT_CONFIGURED_ERROR = "NO_AI_PROVIDER_CONFIGURED";

export type AiCompletionClient = {
  /** Human-readable provider + model label for diagnostics. */
  providerName: string;
  /**
   * Send a text prompt and return the raw text response.
   * The caller is responsible for JSON-parsing the result.
   */
  complete(prompt: string): Promise<string>;
};

type AnthropicMessage = { content: Array<{ type: string; text?: string }> };
type AnthropicClient = {
  messages: {
    create(input: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: "user"; content: string }>;
    }): Promise<AnthropicMessage>;
  };
};
type AnthropicConstructor = new (input: {
  apiKey: string;
  baseURL?: string;
}) => AnthropicClient;
type OpenAiClient = {
  chat: {
    completions: {
      create(input: {
        model: string;
        max_tokens: number;
        messages: Array<{ role: "user"; content: string }>;
      }): Promise<{ choices: Array<{ message: { content: string | null } }> }>;
    };
  };
};
type OpenAiConstructor = new (input: { apiKey: string }) => OpenAiClient;

/**
 * Returns a ready-to-use client for the first configured AI provider.
 * All SDK imports are deferred so the server starts even when no keys are set.
 */
export async function createAiClient(): Promise<AiCompletionClient> {
  // ── Priority 1: Replit managed Anthropic proxy ──────────────────────────
  // All three vars must be present. REPL_ID is injected automatically by
  // Replit and is never present on Render or other hosts — this prevents
  // the proxy path from being chosen when AI_INTEGRATIONS_* vars are
  // accidentally set on Render (where the proxy URL is unreachable).
  if (
    process.env.REPL_ID &&
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
  ) {
    const anthropic = await createAnthropicSdkClient({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
    return {
      providerName: "Anthropic via Replit proxy (claude-sonnet-4-6)",
      async complete(prompt: string): Promise<string> {
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        });
        const block = msg.content[0];
        return block?.type === "text" ? block.text ?? "[]" : "[]";
      },
    };
  }

  // ── Priority 2: Direct Anthropic API key ─────────────────────────────────
  if (process.env.ANTHROPIC_API_KEY) {
    const client = await createAnthropicSdkClient({ apiKey: process.env.ANTHROPIC_API_KEY });
    return {
      providerName: "Anthropic direct (claude-3-5-haiku-20241022)",
      async complete(prompt: string): Promise<string> {
        const msg = await client.messages.create({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        });
        const block = msg.content[0];
        return block?.type === "text" ? block.text ?? "[]" : "[]";
      },
    };
  }

  // ── Priority 3: OpenAI API key ───────────────────────────────────────────
  if (process.env.OPENAI_API_KEY) {
    const moduleName = "openai";
    const { default: OpenAI } = await import(moduleName) as { default: OpenAiConstructor };
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return {
      providerName: "OpenAI (gpt-4o-mini)",
      async complete(prompt: string): Promise<string> {
        const response = await client.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        });
        return response.choices[0]?.message?.content ?? "[]";
      },
    };
  }

  // ── Nothing configured ────────────────────────────────────────────────────
  const err = new Error(
    "No AI provider configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY on Render",
  );
  (err as NodeJS.ErrnoException).code = NOT_CONFIGURED_ERROR;
  throw err;
}

async function createAnthropicSdkClient(input: {
  apiKey: string;
  baseURL?: string;
}): Promise<AnthropicClient> {
  const moduleName = "@anthropic-ai/sdk";
  const { default: Anthropic } = await import(moduleName) as { default: AnthropicConstructor };
  return new Anthropic(input);
}
