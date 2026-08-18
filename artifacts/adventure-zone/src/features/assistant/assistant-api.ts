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
  AssistantProfileSearchResult,
  AssistantSourceReference,
  BookingBrief,
  GeneralAssistantResponse,
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

type CachedBookingSchedule = {
  id: string;
  label: string;
  startsAt: string | null;
  endsAt: string | null;
  venueName: string | null;
  city: string | null;
  region: string | null;
};

function params(context: Exclude<ActiveAssistantContext, null>): string {
  return new URLSearchParams({
    kind: context.kind,
    id: context.recordId,
  }).toString();
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function normalizedText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[?!.,'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function cachedBooking(value: unknown): CachedBookingSchedule | null {
  const row = recordValue(value);
  if (!row || typeof row["id"] !== "string" || typeof row["label"] !== "string") {
    return null;
  }
  return {
    id: row["id"],
    label: row["label"],
    startsAt: row["startsAt"] === null ? null : optionalString(row["startsAt"]),
    endsAt: row["endsAt"] === null ? null : optionalString(row["endsAt"]),
    venueName: optionalString(row["venueName"]),
    city: optionalString(row["city"]),
    region: optionalString(row["region"]),
  };
}

function asksCachedSchedule(question: string): boolean {
  if (/follow ?up|next action|call due/.test(question)) return false;
  return (
    /\bwhat time\b/.test(question) ||
    /\bwhat (date|day)\b/.test(question) ||
    /\bwhen (is|was|does|did|will)\b/.test(question) ||
    /\b(start|starting|end|ending) time\b/.test(question) ||
    /\b(event|booking) schedule\b/.test(question)
  );
}

function phraseIncluded(question: string, value: string | null): boolean {
  const phrase = normalizedText(value ?? "");
  return Boolean(phrase) && ` ${question} `.includes(` ${phrase} `);
}

function cachedBookingScore(booking: CachedBookingSchedule, question: string): number {
  let score = 0;
  if (phraseIncluded(question, booking.label)) score += 1_000;
  if (phraseIncluded(question, booking.city)) score += 900;
  if (phraseIncluded(question, booking.venueName)) score += 800;
  const location = [booking.city, booking.region].filter(Boolean).join(" ");
  if (phraseIncluded(question, location)) score += 950;
  if (booking.startsAt) {
    const year = String(new Date(booking.startsAt).getUTCFullYear());
    if (phraseIncluded(question, year)) score += 150;
  }
  return score;
}

function selectCachedScheduleBooking(
  snapshot: AssistantCachedSnapshot,
  question: string,
): CachedBookingSchedule | null {
  const current = cachedBooking(snapshot.context["currentBooking"]);
  const priorValue = snapshot.context["priorBookings"];
  const prior = Array.isArray(priorValue)
    ? priorValue.flatMap((value) => {
        const booking = cachedBooking(value);
        return booking ? [booking] : [];
      })
    : [];
  const bookings = [
    ...(current ? [current] : []),
    ...prior.filter((booking) => booking.id !== current?.id),
  ];
  if (bookings.length === 0) return null;
  const ranked = bookings
    .map((booking, index) => ({ booking, index, score: cachedBookingScore(booking, question) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if ((ranked[0]?.score ?? 0) > 0) return ranked[0]?.booking ?? null;
  return current ?? (bookings.length === 1 ? bookings[0] ?? null : null);
}

function safeDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cachedBookingDescriptor(booking: CachedBookingSchedule): string {
  const location = [booking.city, booking.region].filter(Boolean).join(", ");
  if (booking.venueName && location) {
    return `${booking.label} at ${booking.venueName} in ${location}`;
  }
  if (location) return `${booking.label} in ${location}`;
  if (booking.venueName) return `${booking.label} at ${booking.venueName}`;
  return booking.label;
}

function localDayKey(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function cachedScheduleAnswer(
  question: string,
  snapshot: AssistantCachedSnapshot,
): AssistantAnswer | null {
  if (!asksCachedSchedule(question)) return null;
  const booking = selectCachedScheduleBooking(snapshot, question);
  if (!booking) return null;

  const descriptor = cachedBookingDescriptor(booking);
  const startsAt = safeDate(booking.startsAt);
  const sources = snapshot.context.sources.filter(
    (source) => source.kind === "booking" && source.recordId === booking.id,
  );
  if (!startsAt) {
    return {
      text: `${descriptor} doesn't have a start time saved in the cached booking.`,
      mode: "offline_cached",
      confidence: "low",
      sources,
      needsAdmin: false,
    };
  }

  const endsAt = safeDate(booking.endsAt);
  const timeZone = browserTimeZone();
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const dateText = dateFormatter.format(startsAt);
  let text = `${descriptor} is saved for ${dateText} at ${timeFormatter.format(startsAt)}.`;
  if (endsAt) {
    text = localDayKey(startsAt, timeZone) === localDayKey(endsAt, timeZone)
      ? `${descriptor} is saved for ${dateText}, from ${timeFormatter.format(startsAt)} to ${timeFormatter.format(endsAt)}.`
      : `${descriptor} is saved from ${dateText} at ${timeFormatter.format(startsAt)} through ${dateFormatter.format(endsAt)} at ${timeFormatter.format(endsAt)}.`;
  }

  return {
    text,
    mode: "offline_cached",
    confidence: "high",
    sources,
    needsAdmin: false,
  };
}

export async function askGeneralAssistant(question: string): Promise<GeneralAssistantResponse> {
  return apiPost<GeneralAssistantResponse>("/assistant/general/ask", { question });
}

export async function searchAssistantProfiles(query: string): Promise<AssistantProfileSearchResult[]> {
  const response = await apiGet<{ results: AssistantProfileSearchResult[] }>(
    `/assistant/profile-search?${new URLSearchParams({ q: query }).toString()}`,
  );
  return response.results;
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
  const normalized = normalizedText(question);
  const schedule = cachedScheduleAnswer(normalized, snapshot);
  if (schedule) return schedule;

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
      timeZone: browserTimeZone(),
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
