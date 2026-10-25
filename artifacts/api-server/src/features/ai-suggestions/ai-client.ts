/**
 * Provider-agnostic AI completion client factory.
 *
 * Priority order:
 *   1. Replit Anthropic proxy   (AI_INTEGRATIONS_ANTHROPIC_BASE_URL + AI_INTEGRATIONS_ANTHROPIC_API_KEY)
 *   2. Direct Anthropic key     (ANTHROPIC_API_KEY)
 *   3. OpenAI key               (OPENAI_API_KEY)
 */

import { internalAiEnabled } from "../../lib/execution-policy";
export const NOT_CONFIGURED_ERROR = "NO_AI_PROVIDER_CONFIGURED";

export function imageTokenBudget(value?: number) {
  return Math.max(256, Math.min(4096, value ?? 1200));
}

export type AiCompletionClient = {
  providerName: string;
  complete(prompt: string): Promise<string>;
  completeImage?(input: {
    prompt: string;
    mimeType: string;
    base64: string;
    maxTokens?: number;
  }): Promise<string>;
};

type AnthropicMessage = { content: Array<{ type: string; text?: string }> };
type AnthropicClient = { messages: { create(input: any): Promise<AnthropicMessage> } };
type AnthropicConstructor = new (input: { apiKey: string; baseURL?: string }) => AnthropicClient;
type OpenAiClient = { chat: { completions: { create(input: any): Promise<{ choices: Array<{ message: { content: string | null } }> }> } } };
type OpenAiConstructor = new (input: { apiKey: string }) => OpenAiClient;

function anthropicClient(providerName: string, anthropic: AnthropicClient, model: string): AiCompletionClient {
  return {
    providerName,
    async complete(prompt: string): Promise<string> {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      const block = msg.content[0];
      return block?.type === "text" ? block.text ?? "[]" : "[]";
    },
    async completeImage({ prompt, mimeType, base64, maxTokens }): Promise<string> {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: imageTokenBudget(maxTokens),
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
            { type: "text", text: prompt },
          ],
        }],
      });
      const block = msg.content[0];
      return block?.type === "text" ? block.text ?? "{}" : "{}";
    },
  };
}

export async function createAiClient(): Promise<AiCompletionClient> {
  if(!internalAiEnabled()) {
    const disabled=async():Promise<string>=>{throw Object.assign(new Error("Internal AI is disabled. Use Draft with COM."),{code:"INTERNAL_AI_DISABLED"});};
    // Constructing the send/schedule runtime must remain possible without AI.
    return {providerName:"Disabled",complete:disabled,completeImage:disabled};
  }
  if (
    process.env.REPL_ID &&
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
  ) {
    const anthropic = await createAnthropicSdkClient({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
    return anthropicClient("Anthropic via Replit proxy (claude-sonnet-4-6)", anthropic, "claude-sonnet-4-6");
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const client = await createAnthropicSdkClient({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropicClient("Anthropic direct (claude-3-5-haiku-20241022)", client, "claude-3-5-haiku-20241022");
  }

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
      async completeImage({ prompt, mimeType, base64, maxTokens }): Promise<string> {
        const response = await client.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: imageTokenBudget(maxTokens),
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          }],
        });
        return response.choices[0]?.message?.content ?? "{}";
      },
    };
  }

  const err = new Error(
    "No AI provider configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY on Render",
  );
  (err as NodeJS.ErrnoException).code = NOT_CONFIGURED_ERROR;
  throw err;
}

async function createAnthropicSdkClient(input: { apiKey: string; baseURL?: string }): Promise<AnthropicClient> {
  const moduleName = "@anthropic-ai/sdk";
  const { default: Anthropic } = await import(moduleName) as { default: AnthropicConstructor };
  return new Anthropic(input);
}

