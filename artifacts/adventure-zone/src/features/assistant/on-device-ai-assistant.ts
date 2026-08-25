import { askBookingAssistant } from "./assistant-api";
import {
  getAssistantSnapshot,
  type AssistantCachedSnapshot,
} from "./assistant-offline-cache";
import type { ActiveAssistantContext, AssistantSourceReference } from "./assistant-types";
import { tryOnDeviceSemanticAnswer } from "./on-device-ai-answer";
import type {
  ClientAssistantAnswer,
  ClientAssistantAskResponse,
} from "./on-device-ai-client-types";
import { routeLocalAssistantQuestion } from "./on-device-ai-router";

const ONLINE_LOCAL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sourceList(snapshot: AssistantCachedSnapshot, sourceIds: readonly string[]): AssistantSourceReference[] {
  const ids = new Set(sourceIds);
  return snapshot.context.sources.filter((source) => ids.has(source.id));
}

function cachedBriefItems(snapshot: AssistantCachedSnapshot, keys: string[]) {
  const wanted = new Set(keys);
  return snapshot.brief.items.filter((item) => wanted.has(item.key));
}

function answerFromBrief(
  snapshot: AssistantCachedSnapshot,
  keys: string[],
  mode: ClientAssistantAnswer["mode"],
): ClientAssistantAnswer | null {
  const items = cachedBriefItems(snapshot, keys);
  if (!items.length) return null;
  const sourceIds = [...new Set(items.flatMap((item) => item.sourceIds))];
  return {
    text: items.map((item) => item.text).join(" "),
    mode,
    confidence: items.every((item) => item.confidence === "high")
      ? "high"
      : items.some((item) => item.confidence === "low")
        ? "low"
        : "medium",
    sources: sourceList(snapshot, sourceIds),
    needsAdmin: false,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cachedSchedule(snapshot: AssistantCachedSnapshot, mode: ClientAssistantAnswer["mode"]): ClientAssistantAnswer | null {
  const booking = record(snapshot.context.currentBooking);
  if (!booking || typeof booking.label !== "string") return null;
  const startsAt = typeof booking.startsAt === "string" ? new Date(booking.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return null;
  const endsAt = typeof booking.endsAt === "string" ? new Date(booking.endsAt) : null;
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const label = booking.label;
  const text = endsAt && !Number.isNaN(endsAt.getTime())
    ? `${label} is saved from ${formatter.format(startsAt)} through ${formatter.format(endsAt)}.`
    : `${label} is saved for ${formatter.format(startsAt)}.`;
  const bookingId = typeof booking.id === "string" ? booking.id : null;
  const sources = bookingId
    ? snapshot.context.sources.filter((source) => source.kind === "booking" && source.recordId === bookingId)
    : [];
  return { text, mode, confidence: "high", sources, needsAdmin: false };
}

function exactCachedAnswer(
  question: string,
  snapshot: AssistantCachedSnapshot,
  mode: ClientAssistantAnswer["mode"],
): ClientAssistantAnswer | null {
  const normalized = question.toLowerCase().replace(/[?!.,'’]/g, " ").replace(/\s+/g, " ").trim();
  if (/\bwhat time\b|\bwhat (?:date|day)\b|\bwhen (?:is|was|does|did|will)\b|\b(?:event|booking) schedule\b/.test(normalized)) {
    return cachedSchedule(snapshot, mode);
  }
  if (/main contact|primary contact|who should i call/.test(normalized)) {
    return answerFromBrief(snapshot, ["contact"], mode);
  }
  if (/follow ?up|what .* due|next action|call due/.test(normalized)) {
    return answerFromBrief(snapshot, ["follow_up", "next_action"], mode);
  }
  if (/normally|usually .* book|usual package/.test(normalized)) {
    return answerFromBrief(snapshot, ["package_history"], mode);
  }
  if (/what happened last year|what did they book last year|last year .* book/.test(normalized)) {
    return answerFromBrief(snapshot, ["package_history", "attraction_count", "last_outcome"], mode);
  }
  return null;
}

function response(
  snapshot: AssistantCachedSnapshot,
  answer: ClientAssistantAnswer,
  conversationId?: string,
): ClientAssistantAskResponse {
  return {
    answer,
    brief: snapshot.brief,
    context: snapshot.context,
    conversationId,
  };
}

function offlineFallback(snapshot: AssistantCachedSnapshot, conversationId?: string): ClientAssistantAskResponse {
  return response(snapshot, {
    text: "I'm offline. I couldn't find that in the saved profile context. This question needs a live connection for deeper analysis.",
    mode: "offline_cached",
    confidence: "low",
    sources: [],
    needsAdmin: false,
  }, conversationId);
}

function freshEnoughForOnlineLocalUse(snapshot: AssistantCachedSnapshot) {
  const savedAt = new Date(snapshot.savedAt).getTime();
  return Number.isFinite(savedAt) && Date.now() - savedAt <= ONLINE_LOCAL_CACHE_MAX_AGE_MS;
}

export async function askBookingAssistantLocalFirst(input: {
  context: Exclude<ActiveAssistantContext, null>;
  question: string;
  conversationId?: string;
}): Promise<ClientAssistantAskResponse> {
  const cached = await getAssistantSnapshot(input.context).catch(() => null);
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  const localSnapshot = cached && (!online || freshEnoughForOnlineLocalUse(cached)) ? cached : null;
  const intent = routeLocalAssistantQuestion(input.question);

  if (localSnapshot && intent === "exact_cached_answer") {
    const exact = exactCachedAnswer(input.question, localSnapshot, online ? "deterministic" : "offline_cached");
    if (exact) return response(localSnapshot, exact, input.conversationId);
  }

  if (localSnapshot && intent === "semantic_cached_search") {
    const local = await tryOnDeviceSemanticAnswer(input.question, localSnapshot).catch(() => null);
    if (local) return response(localSnapshot, local, input.conversationId);
  }

  if (!online) {
    if (!cached) return askBookingAssistant(input);
    return offlineFallback(cached, input.conversationId);
  }

  return askBookingAssistant(input);
}