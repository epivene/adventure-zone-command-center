/**
 * AI analysis: sends batches of Act! history records to Claude and extracts
 * structured booking suggestions.
 */

import crypto from "crypto";
import { addSuggestion, type HistorySuggestion } from "./suggestion-store";

export type ActivityRecord = {
  id: string;
  body: string | null;
  subject: string | null;
  kind: string;
  timelineSortAt: Date | null;
  actRecordId: string | null;
  contactId: string | null;
  organizationId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  organizationName: string | null;
};

export type ProgressEvent =
  | {
      type: "progress";
      batchIndex: number;
      totalBatches: number;
      recordsScanned: number;
      suggestionsFound: number;
    }
  | { type: "suggestion"; suggestion: HistorySuggestion }
  | {
      type: "done";
      totalRecords: number;
      totalSuggestions: number;
      /** True when at least one batch AI call failed; the analysis may be partial. */
      hadErrors: boolean;
      /** Human-readable descriptions of any batch errors. */
      errors: string[];
    }
  | { type: "error"; message: string };

const BATCH_SIZE = 50;

/**
 * Raw suggestion shape returned by Claude in each batch response.
 * All fields are optional/nullable to handle imperfect AI output.
 */
type RawSuggestion = {
  clientName?: string | null;
  tripDescription?: string | null;
  suggestedDate?: string | null;
  suggestedDateEnd?: string | null;
  location?: string | null;
  confidence?: string | null;
  sourceSnippet?: string | null;
  actRecordId?: string | null;
};

function buildPrompt(
  records: ActivityRecord[],
  analysisDateStr: string,
): string {
  const lines = records.map((r, i) => {
    const contact =
      r.contactFirstName && r.contactLastName
        ? `${r.contactFirstName} ${r.contactLastName}`
        : r.organizationName ?? "Unknown";
    const date = r.timelineSortAt
      ? r.timelineSortAt.toISOString().slice(0, 10)
      : "unknown date";
    const text = [r.subject, r.body]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 400);
    return `[${i + 1}] Date: ${date} | Client: ${contact} | actRecordId: ${r.actRecordId ?? "n/a"}\n${text}`;
  });

  return `You are analyzing notes, history, and activity records from an adventure tour company's CRM to find context clues about future bookings.

Today's date: ${analysisDateStr}

Look for evidence of:
- Recurring/annual clients who mention "next year", "same time", "again"  
- Future dates or periods mentioned (summer 2026, August, etc.)
- Verbal commitments or expressed interest in booking again
- Deposits or partial payments for future events
- Strong positive language suggesting they will return

Only suggest bookings for FUTURE dates (after ${analysisDateStr}). Ignore purely historical records unless they clearly indicate a future intent.

Respond ONLY with a JSON array (no markdown, no explanation). Each element has these fields:
- clientName: string | null  
- tripDescription: string (1-2 sentences about the trip/event)
- suggestedDate: string | null  (YYYY-MM-DD, the suggested start date)
- suggestedDateEnd: string | null (YYYY-MM-DD, the suggested end date if mentioned)
- location: string | null (city/region if mentioned)
- confidence: "high" | "medium" | "low"
- sourceSnippet: string (the specific text that led to this suggestion, max 200 chars)
- actRecordId: string | null (the actRecordId from the record above)

If no suggestions are found, return [].

RECORDS TO ANALYZE:
${lines.join("\n\n")}`;
}

function parseConfidence(raw: unknown): "high" | "medium" | "low" {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "low";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns true iff dateStr is a strict YYYY-MM-DD string representing a valid
 * calendar date that falls strictly after today (UTC).  Rejects past dates and
 * any non-ISO or non-existent dates the AI may hallucinate.
 */
export function isValidFutureDate(dateStr: unknown): dateStr is string {
  if (typeof dateStr !== "string") return false;
  if (!DATE_RE.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return false;
  // Reject dates JS silently rolls over (e.g. "2099-02-30" → Mar 2).
  if (d.toISOString().slice(0, 10) !== dateStr) return false;
  const todayStr = new Date().toISOString().slice(0, 10);
  return dateStr > todayStr;
}

function parseSuggestionsFromResponse(text: string): RawSuggestion[] {
  // Claude may wrap the JSON in a code block; strip it
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RawSuggestion =>
        item !== null && typeof item === "object" && !Array.isArray(item),
    );
  } catch {
    return [];
  }
}

function normalizeSuggestion(
  raw: RawSuggestion,
  recordsByActId: Map<string, ActivityRecord>,
): HistorySuggestion | null {
  const tripDescription =
    typeof raw.tripDescription === "string" && raw.tripDescription.trim()
      ? raw.tripDescription.trim()
      : null;
  if (!tripDescription) return null;

  // A valid future start date is required — this feature is about future bookings.
  // Suggestions with a past, absent, or malformed start date are not actionable
  // and are discarded entirely rather than kept with a null date.
  if (!isValidFutureDate(raw.suggestedDate)) return null;
  const suggestedDate = raw.suggestedDate as string;

  // End date must also be valid AND not earlier than the start date.
  const rawEnd = raw.suggestedDateEnd;
  const suggestedDateEnd =
    isValidFutureDate(rawEnd) && (rawEnd as string) >= suggestedDate
      ? (rawEnd as string)
      : null;

  const actRecordId =
    typeof raw.actRecordId === "string" && raw.actRecordId.trim()
      ? raw.actRecordId.trim()
      : null;
  // Carry the source record's contact/organization IDs so the UI can link
  // the suggestion to the matching profile pages.
  const source = actRecordId ? recordsByActId.get(actRecordId) : undefined;

  return {
    id: crypto.randomUUID(),
    suggestedDate,
    suggestedDateEnd,
    clientName:
      typeof raw.clientName === "string" && raw.clientName.trim()
        ? raw.clientName.trim()
        : null,
    tripDescription,
    location:
      typeof raw.location === "string" && raw.location.trim()
        ? raw.location.trim()
        : null,
    confidence: parseConfidence(raw.confidence),
    sourceSnippet:
      typeof raw.sourceSnippet === "string" && raw.sourceSnippet.trim()
        ? raw.sourceSnippet.trim().slice(0, 300)
        : "(no source snippet)",
    actRecordId,
    status: "pending",
    bookingId: null,
    contactId: source?.contactId ?? null,
    organizationId: source?.organizationId ?? null,
  };
}

/**
 * Analyzes Act! history records in batches and streams progress events.
 *
 * @param records - All activity records to analyze
 * @param onEvent - Callback called for each progress/suggestion/done event
 */
export async function analyzeHistory(
  records: ActivityRecord[],
  onEvent: (event: ProgressEvent) => void,
): Promise<void> {
  // Re-analysis MERGES with existing suggestions rather than wiping them.
  // The AI is non-deterministic — a suggestion found in one run may not be
  // found in the next, and losing it on re-analyze is confusing and can
  // discard something the owner intended to accept. Accepted/dismissed
  // suggestions are also preserved so their state isn't lost.
  // Deduplication happens on insert: the store's dedupe_key unique index
  // (same key logic as before) makes duplicate inserts no-ops.

  if (records.length === 0) {
    onEvent({ type: "done", totalRecords: 0, totalSuggestions: 0, hadErrors: false, errors: [] });
    return;
  }

  // Resolve provider lazily — throws NOT_CONFIGURED_ERROR if unconfigured.
  // The route catches that code before opening the SSE stream and returns 503.
  const { createAiClient } = await import("./ai-client");
  const aiClient = await createAiClient();

  const batches: ActivityRecord[][] = [];
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    batches.push(records.slice(i, i + BATCH_SIZE));
  }

  const analysisDateStr = new Date().toISOString().slice(0, 10);
  let totalSuggestions = 0;
  const batchErrors: string[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]!;

    onEvent({
      type: "progress",
      batchIndex,
      totalBatches: batches.length,
      recordsScanned: batchIndex * BATCH_SIZE,
      suggestionsFound: totalSuggestions,
    });

    try {
      const responseText = await aiClient.complete(
        buildPrompt(batch, analysisDateStr),
      );

      const rawSuggestions = parseSuggestionsFromResponse(responseText);
      const recordsByActId = new Map<string, ActivityRecord>();
      for (const record of batch) {
        if (record.actRecordId) recordsByActId.set(record.actRecordId, record);
      }
      for (const raw of rawSuggestions) {
        const suggestion = normalizeSuggestion(raw, recordsByActId);
        if (suggestion) {
          const inserted = await addSuggestion(suggestion);
          if (!inserted) continue; // already known from a prior run
          totalSuggestions++;
          onEvent({ type: "suggestion", suggestion });
        }
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "AI analysis error";
      const batchLabel = `Batch ${batchIndex + 1} of ${batches.length}: ${errMsg}`;
      batchErrors.push(batchLabel);
      // Emit a per-batch error event so the client can show live feedback,
      // but continue analysing the remaining batches.
      onEvent({ type: "error", message: batchLabel });
    }
  }

  onEvent({
    type: "done",
    totalRecords: records.length,
    totalSuggestions,
    hadErrors: batchErrors.length > 0,
    errors: batchErrors,
  });
}
