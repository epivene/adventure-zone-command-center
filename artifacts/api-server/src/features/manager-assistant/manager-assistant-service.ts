import { createAiClient, type AiCompletionClient } from "@/features/ai-suggestions/ai-client";
import { buildManagerAssistantContext, type ManagerAssistantContextSource } from "./manager-assistant-context";
import { buildManagerAssistantPrompt } from "./manager-assistant-prompt";
import { answerManagerDeterministically } from "./manager-deterministic-answers";
import type { ManagerAskInput, ManagerContextInput } from "./manager-assistant-input";
import type { ManagerAssistantAnswer } from "./manager-assistant-types";

type AiFactory = () => Promise<AiCompletionClient>;

function parseCloudAnswer(raw: string, sourceIds: Set<string>): {
  text: string;
  confidence: "high" | "medium" | "low";
  sourceIds: string[];
  needsAdmin: boolean;
} | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const value = JSON.parse(match[0]) as Record<string, unknown>;
    const text = typeof value.text === "string" ? value.text.trim() : "";
    const confidence = value.confidence === "high" || value.confidence === "medium" || value.confidence === "low"
      ? value.confidence
      : "low";
    const cited = Array.isArray(value.sourceIds)
      ? value.sourceIds.filter((id): id is string => typeof id === "string")
      : [];
    const needsAdmin = value.needsAdmin === true;
    if (!text) return null;
    if (cited.some((id) => !sourceIds.has(id))) return null;
    if (!needsAdmin && cited.length === 0) return null;
    return { text, confidence, sourceIds: cited, needsAdmin };
  } catch {
    return null;
  }
}

export class ManagerAssistantService {
  constructor(
    private readonly source: ManagerAssistantContextSource,
    private readonly aiFactory: AiFactory = createAiClient,
  ) {}

  async getContext(input: {
    authenticatedLegId: string;
    request: ManagerContextInput;
  }) {
    return buildManagerAssistantContext({
      authenticatedLegId: input.authenticatedLegId,
      request: input.request,
      source: this.source,
    });
  }

  async ask(input: {
    authenticatedLegId: string;
    request: ManagerAskInput;
  }) {
    const context = await this.getContext({
      authenticatedLegId: input.authenticatedLegId,
      request: input.request,
    });
    if (!context) return null;

    const deterministic = answerManagerDeterministically({
      question: input.request.question,
      context,
    });
    if (deterministic && !deterministic.needsAdmin) {
      return { context, answer: deterministic };
    }

    try {
      const client = await this.aiFactory();
      const raw = await client.complete(
        buildManagerAssistantPrompt({
          question: input.request.question,
          context,
        }),
      );
      const parsed = parseCloudAnswer(raw, new Set(context.sources.map((source) => source.id)));
      if (parsed && !parsed.needsAdmin) {
        const sources = context.sources.filter((source) => parsed.sourceIds.includes(source.id));
        const answer: ManagerAssistantAnswer = {
          text: parsed.text,
          mode: "cloud",
          confidence: parsed.confidence,
          sources,
          needsAdmin: false,
          escalationReason: null,
        };
        return { context, answer };
      }
    } catch {
      // Provider availability must never make the manager portal unusable.
    }

    return {
      context,
      answer:
        deterministic ?? {
          text: "I need an admin to confirm this.",
          mode: "deterministic",
          confidence: "low",
          sources: [],
          needsAdmin: true,
          escalationReason: "The scoped operational context did not support a confident answer.",
        },
    };
  }
}
