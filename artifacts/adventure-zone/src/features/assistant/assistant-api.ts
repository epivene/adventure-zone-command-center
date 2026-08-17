import { apiGet, apiPost } from "@/lib/auth-token";

import {
  getAssistantSnapshot,
  saveAssistantSnapshot,
  type AssistantCachedSnapshot,
} from "./assistant-offline-cache";
import type {
  ActiveAssistantContext,
  AssistantAnswer,
  AssistantAskResponse,
  AssistantContextBundle,
  AssistantConversation,
  AssistantSourceReference,
  BookingBrief,
} from "./assistant-types";

export type DerivedFactReviewItem = {
  id: string;
  factKind: string;
  summary: string;
  value: unknown;
  confidence: "high" | "medium" | "low";
  sourceActivityId: string | null;
  sourceRecordId: string | null;
  sourceVersionId: string | null;
  status: "proposed" | "confirmed" | "dismissed";
  createdAt: string;
};

function params(context: Exclude<ActiveAssistantContext, null>): string {
  return new URLSearchParams({
    kind: context.kind,
    id: context.recordId,
  }).toString();
}

export async function getAssistantContext(
  context: Exclude<ActiveAssistantContext, null>,
): Promise<AssistantContextBundle> {
  const response = await apiGet<{ context: AssistantContextBundle }>(
    `/assistant/context?${params(context)}`,
  );
  return response.context;
}

export async function getBookingBrief(
  context: Exclude<ActiveAssistantContext, null>,
): Promise<BookingBrief> {
  const response = await apiGet<{ brief: BookingBrief }>(
    `/assistant/brief?${params(context)}`,
  );
  return response.brief;
}

export async function getLatestAssistantConversation(
  context: Exclude<ActiveAssistantContext, null>,
): Promise<AssistantConversation | null> {
  const response = await apiGet<{ conversation: AssistantConversation | null }>(
    `/assistant/conversation?${params(context)}`,
  );
  return response.conversation;
}

export async function analyzeProfileHistory(organizationId: string) {
  return apiPost<{
    ok: true;
    activityCount: number;
    candidateCount: number;
    inserted: number;
    skipped: number;
  }>("/assistant/derived-facts/extract", { organizationId });
}

export async function listProfileDerivedFacts(
  organizationId: string,
  status?: "proposed" | "confirmed" | "dismissed",
): Promise<DerivedFactReviewItem[]> {
  const query = new URLSearchParams({ organizationId });
  if (status) query.set("status", status);
  const response = await apiGet<{ facts: DerivedFactReviewItem[] }>(
    `/assistant/derived-facts?${query.toString()}`,
  );
  return response.facts;
}

export async function decideDerivedFact(
  factId: string,
  status: "confirmed" | "dismissed",
): Promise<void> {
  await apiPost(`/assistant/derived-facts/${factId}/decision`, { status });
}

export type AssistantLoadedSnapshot = {
  context: AssistantContextBundle;
  brief: BookingBrief;
  offline: boolean;
  savedAt: string | null;
};

export async function loadAssistantSnapshot(
  contextRef: Exclude<ActiveAssistantContext, null>,
): Promise<AssistantLoadedSnapshot> {
  try {
    const [context, brief] = await Promise.all([
      getAssistantContext(contextRef),
      getBookingBrief(contextRef),
    ]);
    await saveAssistantSnapshot({ contextRef, context, brief }).catch(() => undefined);
    return { context, brief, offline: false, savedAt: null };
  } catch (networkError) {
    const cached = await getAssistantSnapshot(contextRef).catch(() => null);
    if (cached) {
      return {
        context: cached.context,
        brief: cached.brief,
        offline: true,
        savedAt: cached.savedAt,
      };
    }
    throw networkError;
  }
}

function sourceList(
  snapshot: AssistantCachedSnapshot,
  sourceIds: readonly string[],
): AssistantSourceReference[] {
  const ids = new Set(sourceIds);
  return snapshot.context.sources.filter((source) => ids.has(source.id));
}

function cachedBriefItem(
  snapshot: AssistantCachedSnapshot,
  key: string,
) {
  return snapshot.brief.items.find((item) => item.key === key);
}

function offlineAnswer(
  question: string,
  snapshot: AssistantCachedSnapshot,
): AssistantAnswer | null {
  const normalized = question.toLowerCase().replace(/[?!.,'’]/g, " ").replace(/\s+/g, " ").trim();
  let keys: string[] = [];
  if (/normally|usually.*book|usual package/.test(normalized)) {
    keys = ["package_history"];
  } else if (/different from last year|what changed|compare.*last/.test(normalized)) {
    keys = ["attraction_count", "package_history"];
  } else if (/follow ?up|what.*due|next action/.test(normalized)) {
    keys = ["follow_up", "next_action"];
  } else if (/main contact|who should i call|primary contact/.test(normalized)) {
    keys = ["contact"];
  } else if (/what am i forgetting|anything missing|what.*missing/.test(normalized)) {
    keys = ["objection_or_promise", "follow_up", "next_action", "package_history"];
  } else if (/what happened last year|what did they book last year/.test(normalized)) {
    keys = ["package_history", "attraction_count", "last_outcome"];
  }

  const items = keys
    .map((key) => cachedBriefItem(snapshot, key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (items.length === 0) return null;
  const sourceIds = [...new Set(items.flatMap((item) => item.sourceIds))];
  return {
    text: items.map((item) => item.text).join(" "),
    mode: "offline_cached",
    confidence: items.every((item) => item.confidence === "high")
      ? "high"
      : items.some((item) => item.confidence === "low")
        ? "low"
        : "medium",
    sources: sourceList(snapshot, sourceIds),
    needsAdmin: false,
  };
}

export async function askBookingAssistant(input: {
  context: Exclude<ActiveAssistantContext, null>;
  question: string;
  conversationId?: string;
}): Promise<AssistantAskResponse> {
  try {
    const result = await apiPost<AssistantAskResponse>("/assistant/ask", {
      conversationId: input.conversationId,
      contextKind: input.context.kind,
      contextRecordId: input.context.recordId,
      question: input.question,
    });
    await saveAssistantSnapshot({
      contextRef: input.context,
      context: result.context,
      brief: result.brief,
    }).catch(() => undefined);
    return result;
  } catch (networkError) {
    const cached = await getAssistantSnapshot(input.context).catch(() => null);
    if (!cached) throw networkError;
    const answer = offlineAnswer(input.question, cached);
    if (!answer) {
      return {
        answer: {
          text: "I'm offline. I can show the saved Booking Brief for this record, but this question needs a live connection for deeper analysis.",
          mode: "offline_cached",
          confidence: "low",
          sources: [],
          needsAdmin: false,
        },
        brief: cached.brief,
        context: cached.context,
        conversationId: input.conversationId,
      };
    }
    return {
      answer,
      brief: cached.brief,
      context: cached.context,
      conversationId: input.conversationId,
    };
  }
}
