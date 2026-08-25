import type { AssistantCachedSnapshot } from "./assistant-offline-cache";

export type LocalAssistantDocument = {
  id: string;
  text: string;
  sourceIds: string[];
  kind: "brief" | "booking" | "context";
};

const MAX_DOCUMENTS = 80;
const MAX_TEXT = 1_200;
const ALLOWED_CONTEXT_FIELDS = [
  "eventDescription",
  "relationshipSummary",
  "historySummary",
  "specialNotes",
  "nextAction",
  "contactSummary",
] as const;

function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeKey(value: string) {
  return normalized(value).toLowerCase();
}

function safeText(value: unknown) {
  if (typeof value !== "string") return null;
  const clean = normalized(value);
  if (!clean || /^<[^>]+>/.test(clean)) return null;
  return clean.slice(0, MAX_TEXT);
}

function sourceIdsForBooking(snapshot: AssistantCachedSnapshot, bookingId: string) {
  return snapshot.context.sources
    .filter((source) => source.kind === "booking" && source.recordId === bookingId)
    .map((source) => source.id);
}

function bookingDocument(
  snapshot: AssistantCachedSnapshot,
  value: unknown,
): LocalAssistantDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.label !== "string") return null;

  const parts = [safeText(row.label)];
  if (typeof row.venueName === "string" && safeText(row.venueName)) {
    parts.push(`Venue: ${safeText(row.venueName)}`);
  }
  const location = [safeText(row.city), safeText(row.region)].filter(Boolean).join(", ");
  if (location) parts.push(`Location: ${location}`);
  if (typeof row.startsAt === "string" && row.startsAt) parts.push(`Starts: ${row.startsAt.slice(0, 10)}`);
  if (typeof row.endsAt === "string" && row.endsAt) parts.push(`Ends: ${row.endsAt.slice(0, 10)}`);

  const text = safeText(parts.filter(Boolean).join(" · "));
  if (!text) return null;
  return {
    id: `booking:${row.id}`,
    text,
    sourceIds: sourceIdsForBooking(snapshot, row.id),
    kind: "booking",
  };
}

export function buildLocalAssistantDocuments(
  snapshot: AssistantCachedSnapshot,
): LocalAssistantDocument[] {
  const result: LocalAssistantDocument[] = [];
  const seen = new Set<string>();

  function add(document: LocalAssistantDocument | null) {
    if (!document || result.length >= MAX_DOCUMENTS) return;
    const text = safeText(document.text);
    if (!text) return;
    const key = dedupeKey(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push({
      ...document,
      text,
      sourceIds: [...new Set(document.sourceIds.filter(Boolean))].slice(0, 20),
    });
  }

  for (const item of snapshot.brief.items) {
    add({
      id: `brief:${item.key}`,
      text: item.text,
      sourceIds: item.sourceIds,
      kind: "brief",
    });
  }

  add(bookingDocument(snapshot, snapshot.context.currentBooking));
  const prior = snapshot.context.priorBookings;
  if (Array.isArray(prior)) {
    for (const booking of prior) add(bookingDocument(snapshot, booking));
  }

  for (const field of ALLOWED_CONTEXT_FIELDS) {
    const value = safeText(snapshot.context[field]);
    if (!value) continue;
    add({
      id: `context:${field}`,
      text: value,
      sourceIds: [],
      kind: "context",
    });
  }

  for (const source of snapshot.context.sources) {
    const label = safeText(source.label);
    if (!label) continue;
    add({
      id: `context-source:${source.id}`,
      text: label,
      sourceIds: [source.id],
      kind: "context",
    });
  }

  return result.slice(0, MAX_DOCUMENTS);
}
