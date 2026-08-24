import {
  createAiClient as createConfiguredAiClient,
  type AiCompletionClient,
} from "@/features/ai-suggestions/ai-client";

import { buildAssistantPrompt } from "./assistant-prompt";
import { buildBookingBrief, type BookingBrief } from "./booking-brief";
import { answerDeterministically } from "./deterministic-answers";
import type {
  AssistantAnswer,
  AssistantContextKind,
  BookingAssistantContextBundle,
} from "./assistant-types";

export type AssistantAskResult = {
  answer: AssistantAnswer;
  brief: BookingBrief;
  context: BookingAssistantContextBundle;
};

type AssistantServiceDependencies = {
  loadContext: (input: {
    contextKind: AssistantContextKind;
    contextRecordId: string;
  }) => Promise<BookingAssistantContextBundle | null>;
  createAiClient?: () => Promise<AiCompletionClient>;
};

type CloudAnswerPayload = {
  text: string;
  confidence: "high" | "medium" | "low";
  sourceIds: string[];
};

function parseCloudAnswer(raw: string): CloudAnswerPayload | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null;
    if (
      parsed.confidence !== "high" &&
      parsed.confidence !== "medium" &&
      parsed.confidence !== "low"
    ) {
      return null;
    }
    if (
      !Array.isArray(parsed.sourceIds) ||
      parsed.sourceIds.some((sourceId) => typeof sourceId !== "string")
    ) {
      return null;
    }
    return {
      text: parsed.text.trim(),
      confidence: parsed.confidence,
      sourceIds: parsed.sourceIds as string[],
    };
  } catch {
    return null;
  }
}

function fallbackAnswer(
  context: BookingAssistantContextBundle,
  brief: BookingBrief,
  text: string,
): AssistantAnswer {
  const sourceIds = new Set(brief.items.flatMap((item) => item.sourceIds));
  const sources = context.sources.filter((source) => sourceIds.has(source.id));
  return {
    text,
    mode: "deterministic",
    confidence: "low",
    sources,
    needsAdmin: false,
  };
}

export class AssistantService {
  private readonly createAiClient: () => Promise<AiCompletionClient>;

  constructor(private readonly dependencies: AssistantServiceDependencies) {
    this.createAiClient = dependencies.createAiClient ?? createConfiguredAiClient;
  }

  async getContext(input: {
    contextKind: AssistantContextKind;
    contextRecordId: string;
  }): Promise<BookingAssistantContextBundle | null> {
    return this.dependencies.loadContext(input);
  }

  async getBrief(input: {
    contextKind: AssistantContextKind;
    contextRecordId: string;
  }): Promise<BookingBrief | null> {
    const context = await this.getContext(input);
    return context ? buildBookingBrief(context) : null;
  }

  async ask(input: {
    contextKind: AssistantContextKind;
    contextRecordId: string;
    question: string;
    timeZone?: string;
  }): Promise<AssistantAskResult> {
    const context = await this.getContext(input);
    if (!context) {
      throw new Error("ASSISTANT_CONTEXT_NOT_FOUND");
    }
    const brief = buildBookingBrief(context);
    const deterministic = answerDeterministically({
      question: input.question,
      context,
      brief,
      timeZone: input.timeZone,
    });
    if (deterministic) {
      return { answer: deterministic, brief, context };
    }

    try {
      const client = await this.createAiClient();
      const raw = await client.complete(
        buildAssistantPrompt({ question: input.question, context, brief }),
      );
      const parsed = parseCloudAnswer(raw);
      if (!parsed) {
        return {
          answer: fallbackAnswer(
            context,
            brief,
            "I can use the saved Command Terminal records, but I couldn't get a reliable deeper AI answer from them right now.",
          ),
          brief,
          context,
        };
      }

      const sourceById = new Map(
        context.sources.map((source) => [source.id, source]),
      );
      const uniqueSourceIds = [...new Set(parsed.sourceIds)];
      if (
        uniqueSourceIds.length === 0 ||
        uniqueSourceIds.some((sourceId) => !sourceById.has(sourceId))
      ) {
        return {
          answer: fallbackAnswer(
            context,
            brief,
            "I can't support that answer from the saved Command Terminal records, so I won't present it as a fact.",
          ),
          brief,
          context,
        };
      }

      return {
        answer: {
          text: parsed.text,
          mode: "cloud",
          confidence: parsed.confidence,
          sources: uniqueSourceIds.flatMap((sourceId) => {
            const source = sourceById.get(sourceId);
            return source ? [source] : [];
          }),
          needsAdmin: false,
        },
        brief,
        context,
      };
    } catch {
      return {
        answer: fallbackAnswer(
          context,
          brief,
          "I can still use the saved Command Terminal records, but deeper AI analysis needs an available internet/provider connection right now.",
        ),
        brief,
        context,
      };
    }
  }
}
